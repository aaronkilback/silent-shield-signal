/**
 * current-service-key — May 6 2026.
 *
 * Resolves the CURRENT service-role key for edge-function-to-
 * edge-function fetches. The Deno env var SUPABASE_SERVICE_ROLE_KEY
 * on this project is the legacy JWT format (missing `sub` claim);
 * the new Supabase auth layer rejects it with 401. The rotated key
 * lives in vault.decrypted_secrets and is exposed via the
 * `get_current_service_role_key()` SECURITY DEFINER RPC.
 *
 * Usage:
 *   import { resolveServiceRoleKey } from "../_shared/current-service-key.ts";
 *   const serviceKey = await resolveServiceRoleKey(supabase);
 *   await fetch(`${url}/functions/v1/other-fn`, {
 *     headers: { Authorization: `Bearer ${serviceKey}` },
 *     ...
 *   });
 *
 * Cache strategy: per-request (caller scope). Don't memoize across
 * invocations — Supabase may rotate keys and a cached stale value
 * would reintroduce the 401 cascade.
 *
 * Falls back to the env var if vault lookup fails so the function
 * stays partially functional in degraded conditions.
 */

export async function resolveServiceRoleKey(supabase: any): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('get_current_service_role_key');
    if (error) {
      console.warn('[resolveServiceRoleKey] RPC error, falling back to env:', error.message);
      return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    }
    if (typeof data === 'string' && data.length > 0) return data;
  } catch (e: any) {
    console.warn('[resolveServiceRoleKey] threw, falling back to env:', e?.message || e);
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
