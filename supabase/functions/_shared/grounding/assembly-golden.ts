// WO-GROUNDING-01 Phase 3 golden test. Proves: (A) assembly cannot introduce a sentence not traceable to a bound
// claim — rejected BEFORE render, not flagged after; (B) binding travels with the claim, not the position — a
// claim's [SIG] id cannot be pinned to a different claim's sentence. Plus Flash selection + ranking rule.
// Run: node --experimental-strip-types supabase/functions/_shared/grounding/assembly-golden.ts
import { assembleSections, selectFlash, FLASH_RANKING_RULE, type TaggedClaim } from "./assembly.ts";
import type { DerivedClaim } from "./derived-claim.ts";

const S1 = "00000000-0000-0000-0000-000000027390"; // wildfire
const S2 = "00000000-0000-0000-0000-000000025641"; // Taylor / NorthRiver
const SA = "00000000-0000-0000-0000-0000000000aa";
const SB = "00000000-0000-0000-0000-0000000000bb";
const claim = (text: string, ids: string[]): DerivedClaim =>
  ({ kind: "derived_claim", text, source_signal_ids: ids, source_spans: ids.map((id) => ({ signal_id: id, text })) });

const CLAIMS: TaggedClaim[] = [
  { claim_id: "c0", claim: claim("A resident defied an evacuation order in a fire zone in British Columbia.", [S1]) },
  { claim_id: "c1", claim: claim("BC Energy Regulator investigation into NorthRiver Midstream contamination near Taylor sits within the client upstream operating area.", [S2]) },
  { claim_id: "c2", claim: claim("Copper theft was reported at a remote facility.", [SA, SB]) }, // corroborated by 2 signals
];

const items = [
  // positive — faithful restatement of c0 (only c0 terms) → renders with c0's id
  { claim_id: "c0", sentence: "A resident defied an evacuation order in a British Columbia fire zone." },
  // positive — faithful restatement of c1 → renders with c1's id (S2)
  { claim_id: "c1", sentence: "The BC Energy Regulator is investigating NorthRiver Midstream contamination near Taylor in the client upstream operating area." },
  // CASE A1 — sentence referencing NO input claim → introduced, rejected before render
  { claim_id: "c_intro", sentence: "Analysts assess the wildfire will spread toward Uniper's terminal." },
  // CASE A2 — new fact under a real claim id (Uniper/LNG not in c0)
  { claim_id: "c0", sentence: "A resident defied an evacuation order near the Uniper LNG terminal." },
  // CASE B — c1's content pinned to c0's id: binding must travel with the claim → rejected
  { claim_id: "c0", sentence: "BC Energy Regulator investigation into NorthRiver Midstream near Taylor." },
];

const r = assembleSections(items, CLAIMS);
console.log("═══ WO-GROUNDING-01 Phase 3 assembly golden ═══\n");
console.log("RENDERED (each carries its referenced claim's ids):");
r.rendered.forEach((s) => console.log(`   [${s.from_claim_id}] ids=${s.source_signal_ids.join(",")} :: ${s.sentence}`));
console.log("\nREJECTED (before render):");
r.rejected.forEach((s) => console.log(`   [${s.claim_id}] ${s.reason}: ${s.detail}`));

const byReason = (cid: string, reason: string) => r.rejected.some((x) => x.claim_id === cid && x.reason === reason);
const p0 = r.rendered.find((s) => s.from_claim_id === "c0");
const p1 = r.rendered.find((s) => s.from_claim_id === "c1");

const checks = {
  "c0 renders with S1 (its own id)": !!p0 && p0.source_signal_ids.length === 1 && p0.source_signal_ids[0] === S1,
  "c1 renders with S2 (its own id)": !!p1 && p1.source_signal_ids[0] === S2,
  "A1 introduced sentence rejected (unknown_claim_id)": byReason("c_intro", "unknown_claim_id"),
  "A2 new-fact sentence rejected (introduces_new_fact)": byReason("c0", "sentence_introduces_new_fact"),
  "B  c1-content-under-c0-id rejected (binding travels with claim)": r.rejected.filter((x) => x.claim_id === "c0" && x.reason === "sentence_introduces_new_fact").length >= 2,
  "no introduced sentence reached render": r.rendered.length === 2,
};

// Flash
const flash = selectFlash(CLAIMS);
console.log(`\nFLASH: ${flash?.claim_id} (ids=${flash?.claim.source_signal_ids.join(",")}) — "${flash?.claim.text}"`);
console.log(`FLASH RANKING RULE: ${FLASH_RANKING_RULE}`);
checks["Flash = most-corroborated bound claim (c2, 2 ids), carrying its own ids"] =
  flash?.claim_id === "c2" && (flash?.claim.source_signal_ids.length === 2);

console.log("");
let pass = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "XXXX FAIL"} — ${k}`); pass = pass && v; }
console.log(`\n${pass ? "✅ PHASE 3 GOLDEN PASS — assembly cannot introduce a sentence; binding travels with the claim; Flash selects a bound claim."
                     : "❌ PHASE 3 GOLDEN FAIL."}`);
process.exit(pass ? 0 : 1);
