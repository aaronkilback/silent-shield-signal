// aegis-qualify-sweep — reconciliation backstop for the qualification assistant (WO-AEGIS-QUALIFIER Step 4).
// Runs every minute (Fortress pg_cron). Two jobs, both firing the CALLBACK PATH (not merely flipping status):
//   1. Abandoned waiting: a waiting_operator row past the join grace with no operator join → ensure the
//      callback SMS fired (backstop), then terminalize. A visitor who waited must never get nothing.
//   2. Operator silent after join: a live row with no operator turn for the silence window → tell the visitor
//      plainly that Aaron stepped away (system turn → broadcast), fire the callback, terminalize. The model
//      stays hard-stopped (status becomes terminal; the message gate never reaches the model).
// Gated on the x-sweep-secret header (self-generated); verify_jwt=false so pg_cron can call it with the header.

import { createClient } from "npm:@supabase/supabase-js@2";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { crmClient, fireCallbackOnce, appendSystemTurn } from "../_shared/qualifier-handoff.ts";

const WAIT_GRACE_SEC = Number(Deno.env.get("QUALIFY_JOIN_GRACE_SEC") ?? "300"); // 5 min joinable
const SILENCE_SEC = Number(Deno.env.get("QUALIFY_SILENCE_SEC") ?? "180");       // 3 min operator silence
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  const expected = Deno.env.get("QUALIFY_SWEEP_SECRET") || "";
  if (!expected || req.headers.get("x-sweep-secret") !== expected) return j({ error: "forbidden" }, 403);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const crm = crmClient();
  const hb = await startHeartbeat(supa, "aegis-qualify-sweep-1m");
  try {
    const now = Date.now();
    let abandoned = 0, steppedAway = 0;

    // 1. Abandoned waiting (past join grace, never joined).
    const graceCut = new Date(now - WAIT_GRACE_SEC * 1000).toISOString();
    const { data: stale } = await crm.from("aegis_qualifier_conversations").select("*")
      .eq("status", "waiting_operator").lt("waiting_started_at", graceCut);
    for (const c of stale ?? []) {
      await fireCallbackOnce(crm, c);
      await crm.from("aegis_qualifier_conversations").update({ status: "qualified", updated_at: new Date().toISOString() }).eq("id", c.id);
      abandoned++;
    }

    // 2. Operator silent after joining live.
    const silenceCut = new Date(now - SILENCE_SEC * 1000).toISOString();
    const { data: live } = await crm.from("aegis_qualifier_conversations").select("*").eq("status", "live");
    for (const c of live ?? []) {
      const lastAt: string | null = c.last_operator_at ?? c.operator_joined_at;
      if (!lastAt || lastAt >= silenceCut) continue; // still within silence window
      await appendSystemTurn(crm, c, "Aaron has had to step away — he'll follow up with you directly. Thank you for your patience.");
      await fireCallbackOnce(crm, c);
      await crm.from("aegis_qualifier_conversations").update({ status: "qualified", updated_at: new Date().toISOString() }).eq("id", c.id);
      steppedAway++;
    }

    await completeHeartbeat(supa, hb, { abandoned_waiting: abandoned, operator_stepped_away: steppedAway });
    return j({ ok: true, abandoned_waiting: abandoned, operator_stepped_away: steppedAway });
  } catch (e) {
    await failHeartbeat(supa, hb, e);
    return j({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
