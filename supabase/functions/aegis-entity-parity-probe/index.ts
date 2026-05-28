// aegis-entity-parity-probe — operator-only forensic endpoint that exposes the
// executable acceptance contract (G4) for the canonical entity + unified graph workstream.
// Compares UI · Aegis-Graph · DB realities per axis; returns a structured JSON report.
// No mutation, safe to run on prod. Auth: service_role (operator) only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { entityParityProbe } from "../_shared/entity-parity-probe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Operator-only gate — robust to env-var key drift (wraith note): decode the JWT
    // payload (signature already verified by verify_jwt=true upstream) and require
    // role=service_role. Comparing against the function-env service-role key was fragile
    // because that env can drift from the vault-issued key.
    const auth = req.headers.get("authorization") ?? "";
    const m = auth.match(/^Bearer\s+([^.\s]+\.[^.\s]+\.[^.\s]+)$/);
    let roleOk = false;
    if (m) {
      try {
        const payload = JSON.parse(atob(m[1].split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        roleOk = payload.role === "service_role";
      } catch { /* malformed → reject */ }
    }
    if (!roleOk) {
      return new Response(JSON.stringify({ error: "operator (service-role JWT) auth required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { ref, tenant_id } = body as { ref?: string; tenant_id?: string };
    if (!ref || !tenant_id) {
      return new Response(JSON.stringify({ error: "ref and tenant_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const result = await entityParityProbe(supabase, tenant_id, ref);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[aegis-entity-parity-probe] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
