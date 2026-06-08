// Caller authorization for service-role edge functions.
//
// Problem: functions that use createServiceClient() BYPASS RLS. If such a
// function takes a row id/owner from the HTTP request and returns (or acts on)
// that row's tenant data, it MUST verify the caller is entitled to that tenant
// — otherwise any logged-in user can pull/act-on any tenant's data by id.
// (See generate-sra-report for the reference fix.)
//
// This helper resolves the USER caller and their entitlement. It deliberately
// does NOT treat "getUser() returned no user" as a trusted/service caller — a
// malformed/expired token must fail closed (resolveUserCaller -> null -> 401),
// never be mistaken for an internal call. Functions that ALSO accept internal
// service-to-service / cron callers (e.g. multi-agent-debate) must add an
// explicit positive service-key check separately; this helper is the user path.

import { createUserClient } from "./supabase-client.ts";

export interface CallerAuth {
  userId: string;
  isSuperAdmin: boolean;
  clientIds: string[];   // clients the caller can access (get_user_accessible_client_ids)
  tenantIds: string[];   // tenants the caller belongs to (tenant_users)
}

/**
 * Resolve + validate the user caller from the request's Authorization bearer.
 * Returns null when there is no valid authenticated user (caller should 401).
 */
export async function resolveUserCaller(req: Request, serviceSb: any): Promise<CallerAuth | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await createUserClient(token).auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return null;

  const [supRes, clientRes, tenantRes] = await Promise.all([
    serviceSb.rpc("is_super_admin", { _user_id: userId }),
    serviceSb.rpc("get_user_accessible_client_ids", { _user_id: userId }),
    serviceSb.from("tenant_users").select("tenant_id").eq("user_id", userId),
  ]);

  return {
    userId,
    isSuperAdmin: supRes?.data === true,
    clientIds: ((clientRes?.data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id),
    tenantIds: ((tenantRes?.data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id),
  };
}

/**
 * Owner-based access decision. Super_admin always allowed. Otherwise:
 *  - client-owned row  -> caller must have that client_id
 *  - tenant-owned row (no client_id) -> caller must belong to that tenant_id
 *  - owner-less row (no client_id AND no tenant_id) -> denied to normal users
 *    (e.g. global OSINT entities are reachable only via a tenant-owned parent,
 *    never by direct id from a normal user). super_admin retains direct access.
 */
export function canAccessOwned(
  caller: CallerAuth,
  clientId: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (caller.isSuperAdmin) return true;
  if (clientId) return caller.clientIds.includes(clientId);
  if (tenantId) return caller.tenantIds.includes(tenantId);
  return false;
}
