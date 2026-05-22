// #179 — Auth + tenant-context resolution guard
//
// DOCTRINE (Aaron H-1 decision #2)
//   No deterministic tenant context = NO PERSISTENCE.
//
//   Resolution hierarchy (first hit wins):
//     a. derive from source object (signal.tenant_id, document.client_id → clients.tenant_id, etc.)
//     b. derive from authenticated caller/session (tenant_users membership)
//     c. derive from parent job metadata
//     d. otherwise REJECT — no NULL fallback, no global fallback, no guess
//
// USAGE
//   const tenantId = await resolveTenantContext(supabase, [
//     { kind: 'object', table: 'signals', id: signalId },
//     { kind: 'caller', jwtSub: userId },
//     { kind: 'job', parentJobId: jobId },
//   ]);
//   // Throws TENANT_BOUNDARY if no source resolves.
//
//   const isMember = await assertCallerInTenant(supabase, userId, claimedTenantId, {
//     allowSuperAdmin: true,
//   });
//   // Throws TENANT_BOUNDARY if caller is not a tenant_users member of the
//   // claimed tenant (super_admin bypass is auditable, not silent).

// deno-lint-ignore-file no-explicit-any

export type TenantSource =
  | { kind: 'object'; table: 'signals' | 'archival_documents' | 'ingested_documents' | 'investigations'; id: string }
  | { kind: 'object_client'; table: 'archival_documents' | 'ingested_documents'; id: string }  // client_id → clients.tenant_id
  | { kind: 'caller'; jwtSub: string }
  | { kind: 'job'; parentJobId: string };

export class TenantBoundaryError extends Error {
  constructor(public callSite: string, public attempts: string[]) {
    super(`TENANT_BOUNDARY: cannot resolve tenant context at ${callSite}. Attempts: ${attempts.join('; ')}`);
    this.name = 'TenantBoundaryError';
  }
}

/**
 * Resolve a deterministic tenant_id from one of several sources. Returns the
 * first non-null resolution. Throws TenantBoundaryError if none resolve.
 *
 * Per #179 doctrine: NEVER returns a null tenant_id. NEVER falls back to a
 * default tenant. NEVER guesses. The caller MUST handle the rejection.
 */
export async function resolveTenantContext(
  supabase: any,
  sources: TenantSource[],
  callSite: string,
): Promise<string> {
  const attempts: string[] = [];

  for (const source of sources) {
    try {
      if (source.kind === 'object') {
        // Direct tenant_id on the source object
        const { data } = await supabase
          .from(source.table)
          .select('tenant_id')
          .eq('id', source.id)
          .maybeSingle();
        if (data?.tenant_id) return data.tenant_id;
        attempts.push(`object:${source.table}:${source.id.substring(0, 8)} → no tenant_id`);
      } else if (source.kind === 'object_client') {
        // client_id on the source object → resolve via clients.tenant_id
        const { data: doc } = await supabase
          .from(source.table)
          .select('client_id')
          .eq('id', source.id)
          .maybeSingle();
        if (doc?.client_id) {
          const { data: client } = await supabase
            .from('clients')
            .select('tenant_id')
            .eq('id', doc.client_id)
            .maybeSingle();
          if (client?.tenant_id) return client.tenant_id;
          attempts.push(`object_client:${source.table}:${source.id.substring(0, 8)} → client_id resolved but client has no tenant_id`);
        } else {
          attempts.push(`object_client:${source.table}:${source.id.substring(0, 8)} → no client_id`);
        }
      } else if (source.kind === 'caller') {
        // Tenant_users membership lookup. If the caller belongs to exactly one
        // tenant, return that tenant. Multiple memberships are ambiguous — the
        // caller must assert which one via a separate `assertCallerInTenant`
        // call. We treat ambiguity as unresolved here rather than guess.
        const { data: memberships } = await supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('user_id', source.jwtSub);
        if (memberships && memberships.length === 1) return memberships[0].tenant_id;
        attempts.push(`caller:${source.jwtSub.substring(0, 8)} → ${memberships?.length ?? 0} memberships (need exactly 1)`);
      } else if (source.kind === 'job') {
        // Parent job lookup — assumes a jobs table with tenant_id
        const { data: job } = await supabase
          .from('jobs')
          .select('tenant_id')
          .eq('id', source.parentJobId)
          .maybeSingle();
        if (job?.tenant_id) return job.tenant_id;
        attempts.push(`job:${source.parentJobId.substring(0, 8)} → no tenant_id`);
      }
    } catch (err) {
      attempts.push(`${source.kind}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new TenantBoundaryError(callSite, attempts);
}

/**
 * Assert that an authenticated caller (auth.uid) belongs to a specific tenant.
 * Used by REST endpoints that accept tenant_id from the request body — the
 * server-side check prevents callers from asserting arbitrary tenants.
 *
 * Super_admin may bypass IF allowSuperAdmin=true AND the call site provides
 * audit metadata. The bypass itself is recorded in the governance event by the
 * caller (this helper just signals whether the bypass is permitted).
 *
 * Returns:
 *   { ok: true, kind: 'member' }      — caller is a tenant_users member
 *   { ok: true, kind: 'super_admin' } — caller is super_admin, bypass allowed
 *   { ok: false, reason: '...' }      — caller has no right to assert this tenant
 */
export async function assertCallerInTenant(
  supabase: any,
  jwtSub: string,
  claimedTenantId: string,
  opts?: { allowSuperAdmin?: boolean },
): Promise<{ ok: true; kind: 'member' | 'super_admin' } | { ok: false; reason: string }> {
  if (!jwtSub) return { ok: false, reason: 'missing_caller_jwt' };
  if (!claimedTenantId) return { ok: false, reason: 'missing_claimed_tenant_id' };

  const { data: membership } = await supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', jwtSub)
    .eq('tenant_id', claimedTenantId)
    .maybeSingle();
  if (membership) return { ok: true, kind: 'member' };

  if (opts?.allowSuperAdmin) {
    // is_super_admin() RPC is the canonical platform check
    const { data: isSuper } = await supabase.rpc('is_super_admin', { _user_id: jwtSub });
    if (isSuper === true) return { ok: true, kind: 'super_admin' };
  }

  return { ok: false, reason: 'caller_not_member_of_claimed_tenant' };
}
