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
    // Operator-only gate. The function is invoked with the service-role Bearer (by
    // operator tooling / scripts). Any non-service caller is rejected.
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
    if (!expected.endsWith(" ") && auth !== expected) {
      return new Response(JSON.stringify({ error: "operator (service-role) auth required" }),
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
