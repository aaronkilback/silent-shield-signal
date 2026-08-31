// WO-EXPOSURE-CORROBORATION — fused backfill (Deno). Steps 3+4 fused: gates every location, writes the
// verdict, then ABORTS before Migration B if any row is still ungated. Cannot run the two apart.
//
//   deno run --allow-env --allow-net scripts/backfill-corroboration.ts
//
// Order enforced by the calling runbook: Migration A + TS deploy MUST be done first (columns exist; the
// OLD trigger is still live so findings stay intact until Migration B).
import { createClient } from "npm:@supabase/supabase-js@2";
import { gateLocation } from "../supabase/functions/_shared/corroboration-gate.ts";
import { readFileSync } from "node:fs";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// 1) gate every location from its stored snippet+title (no capture, no network)
const { data: locs } = await sb.from("subject_exposure_locations")
  .select("id, snippet, title, exposure_item_id, subject_exposure_items!inner(category, title, subject_entity_id, entities:subject_entity_id(name))");
for (const l of locs ?? []) {
  const it: any = (l as any).subject_exposure_items;
  const v = gateLocation({ subjectName: it.entities?.name ?? "", category: it.category, findingTitle: it.title, snippet: l.snippet, title: l.title });
  await sb.from("subject_exposure_locations").update({ corroborates: v.corroborates, gate_failed: v.gate_failed }).eq("id", l.id);
}

// 2) ABORT CONDITION — do not apply Migration B if ANY row is still ungated. A live counter over ungated
//    rows would wipe findings. This is the fuse: the migration only runs after every row is gated.
const { count: notGated } = await sb.from("subject_exposure_locations")
  .select("id", { count: "exact", head: true }).eq("gate_failed", "not_gated");
if ((notGated ?? 0) > 0) {
  console.error(`ABORT: ${notGated} row(s) still gate_failed='not_gated'. Migration B NOT applied.`);
  Deno.exit(1);
}
console.log("All rows gated (0 not_gated). Applying Migration B (pure counter + recompute).");

// 3) apply Migration B in the same run — recompute happens inside the migration DO block
const migB = readFileSync(new URL("../supabase/migrations/20260831130000_corroboration_gate_counter.sql", import.meta.url), "utf8");
const { error } = await sb.rpc("exec_sql", { sql: migB }); // service-role DDL apply
if (error) { console.error("Migration B failed:", error.message); Deno.exit(1); }
console.log("Migration B applied. Backfill + counter live.");
