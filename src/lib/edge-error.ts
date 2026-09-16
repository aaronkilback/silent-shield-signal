/**
 * Extract the server-provided error message from a failed `supabase.functions.invoke`.
 *
 * supabase-js throws/returns a `FunctionsHttpError` whose `.message` is always the generic
 * "Edge Function returned a non-2xx status code" — the ACTUAL server message (e.g. the writer's
 * 400 "Select a tenant before creating a client" or "Resolved tenant does not exist") lives in the
 * response body, reachable via `error.context` (a Response). Callers must not swallow the status
 * behind a generic "try again" — a real 400 (e.g. the selected tenant was deleted) must surface its
 * cause. (WO-CLIENT-ONBOARD-SCOPE HOTFIX-3.)
 *
 * Returns the server's `error` string when the failure was an HTTP error carrying a JSON body,
 * else null (network/opaque failure → caller shows its generic fallback).
 */
export async function extractEdgeErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).clone === "function" && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).clone().json();
      const msg = (body as { error?: unknown })?.error;
      if (typeof msg === "string" && msg.trim().length > 0) return msg.trim();
    } catch {
      // body was not JSON — fall through to null
    }
  }
  return null;
}
