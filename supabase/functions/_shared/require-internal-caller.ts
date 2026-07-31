// _shared/require-internal-caller.ts — WO-CHECK5-BURNDOWN-01.
//
// ONE shared gate for machine-only (cron / service-to-service) edge functions. Modeled exactly on
// alert-delivery's authorizeInternal — the single gate in INC-AITOOLS-XTENANT that HELD. Hand-rolled
// per-function gates are the root cause of every finding in that incident: use THIS, do not fork it.
//
// Contract (AUTHORIZATION FIRST):
//   - Validates a dedicated internal header (x-fortress-internal) against FORTRESS_INTERNAL_SECRET,
//     constant-time. A service-role or user bearer ALONE is NEVER accepted — a leaked service key must
//     not grant cron/mutation access; internal callers must send the dedicated header.
//   - Fails CLOSED if the secret is unset or too short (503).
//   - MUST be called BEFORE creating a service-role client and BEFORE reading the request body.
//
// Usage:
//   Deno.serve(async (req) => {
//     if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
//     const gate = requireInternalCaller(req);        // BEFORE createServiceClient / req.json()
//     if (gate) return gate;                           // 401/403/503 short-circuit
//     const supabase = createServiceClient();
//     const body = await req.json();
//     ...
//   });
//
// Callers must send:  headers: { "x-fortress-internal": <FORTRESS_INTERNAL_SECRET> }

export const INTERNAL_HEADER = "x-fortress-internal";

/** Constant-time string comparison (inspects every byte of the longer input). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const n = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export type InternalAuth = { ok: true } | { ok: false; status: 401 | 403 | 503; error: string };

/** Pure check — testable without a Request. Fails closed if the secret is unset/short. */
export function checkInternalCaller(
  headers: Headers,
  secret: string | undefined = Deno.env.get("FORTRESS_INTERNAL_SECRET"),
): InternalAuth {
  if (!secret || secret.length < 16) return { ok: false, status: 503, error: "service_unavailable" };
  const provided = headers.get(INTERNAL_HEADER) ?? "";
  if (!provided) return { ok: false, status: 401, error: "missing internal authorization" };
  if (!timingSafeEqual(provided, secret)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

/**
 * Ergonomic wrapper: returns a Response to short-circuit with (401/403/503) when the caller is not an
 * authorized internal caller, or null when authorized. Call BEFORE any service-role client or body read.
 */
export function requireInternalCaller(req: Request): Response | null {
  const auth = checkInternalCaller(req.headers);
  if (auth.ok) return null;
  return new Response(JSON.stringify({ error: auth.error }), {
    status: auth.status,
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  });
}
