// WO-GROUNDING-01 — grounding fixtures. (a)+(b) MUST fail; (c) MUST construct via the Gate-3 asset link.
// Run: node --experimental-strip-types supabase/functions/_shared/grounding/phase1-fixtures.ts
import { createDerivedClaim, type GroundingDeps } from "./derived-claim.ts";

// ── Real signal text (verbatim from prod signals, 2026-07-31) ──
const SIG_027390 = "00000000-0000-0000-0000-000000027390"; // SIG-2026-027390 wildfire rescue
const SIG_026745 = "00000000-0000-0000-0000-000000026745"; // SIG-2026-026745 Alberta pipeline / killer whales
const SIG_025641 = "00000000-0000-0000-0000-000000025641"; // SIG-2026-025641 NorthRiver Midstream contamination near Taylor
const SIGNAL_TEXT: Record<string, string> = {
  [SIG_027390]: "Crews were forced to rescue a resident who defied an evacuation order in a fire zone in British Columbia.",
  [SIG_026745]: "Experts say the proposed Alberta pipeline route poses a risk to the endangered southern resident killer whales. Changes by the Carney government could exempt projects from species protection tests.",
  [SIG_025641]: "BC Energy Regulator mandates further investigation into contamination by NorthRiver Midstream near Taylor.",
};

// PECL client aliases resolved via the client entity's alias set (entity 85836824). NOTE: 'PCL' is a DATA GAP
// (missing from the entity's alias set) — not represented here on purpose; that gap is reported separately.
const PECL_ALIASES = ["PETRONAS Canada", "Petronas Canada", "PECL", "Petronas Canada Ltd", "Progress Energy Canada", "Progress Energy", "Petroliam Nasional Canada"];

// Gate-3 asset-link resolver. In prod this is the PostGIS query (place→gazetteer→ST_DWithin to client_geo_assets).
// Injected result here reflects the REAL query run 2026-07-31: SIG-2026-025641 → place 'taylor' → Montney/Fort St.
// John upstream 15.3km, within the 120km buffer → TRUE. 027390/026745 resolve no asset → FALSE.
const deps: GroundingDeps = {
  getSignalText: (id) => SIGNAL_TEXT[id] ?? null,
  clientAliases: PECL_ALIASES,
  resolveAssetLink: (id) => id === SIG_025641,
  onReject: (info) => console.log(`   [R3-log] reject=${info.reason} terms=[${(info.terms ?? []).join(", ")}] claim="${info.claimText}"`),
};

function show(label: string, expectFail: boolean, res: ReturnType<typeof createDerivedClaim>) {
  const failed = res.ok === false;
  const pass = failed === expectFail;
  console.log(`${pass ? "PASS" : "XXXX FAIL-OF-TEST"} — ${label}`);
  console.log(`   expected: ${expectFail ? "REJECT" : "CONSTRUCT"}   actual: ${failed ? "REJECT" : "CONSTRUCT"}`);
  if (res.ok === false) console.log(`   reason: ${res.reason}\n   detail: ${res.detail}`);
  else console.log(`   built DerivedClaim bound to: ${res.value.source_signal_ids.join(", ")}`);
  console.log("");
  return pass;
}

console.log("═══ WO-GROUNDING-01 grounding fixtures ═══\n");

// (a) SIG-2026-027390 (wildfire) attached to a Uniper LNG claim → structurally impossible.
const a = createDerivedClaim({
  text: "Coordinate the physical security review with Uniper for the LNG import terminal.",
  source_signal_ids: [SIG_027390],
  source_spans: [{ signal_id: SIG_027390, text: SIGNAL_TEXT[SIG_027390] }],
}, deps);
const aOk = show("(a) wildfire SIG-2026-027390 → 'Uniper LNG' claim", true, a);

// (b) "including those in which Petronas Canada has stakes" over SIG-2026-026745 → rejected at derivation.
const b = createDerivedClaim({
  text: "including those in which Petronas Canada has stakes",
  source_signal_ids: [SIG_026745],
  source_spans: [{ signal_id: SIG_026745, text: SIGNAL_TEXT[SIG_026745] }],
}, deps);
const bOk = show("(b) 'Petronas Canada has stakes' over SIG-2026-026745 (killer whale)", true, b);

// (c) Amendment 7b — asset-proximate signal that NAMES NO CLIENT ALIAS. A client-relevance claim (flagged by the
//     derivation pass) MUST construct via the resolved Gate-3 asset link. If it did NOT, the guard would be
//     over-tight — admitting only signals that name the client, the exact defect Amendment 7 exists to fix.
const c = createDerivedClaim({
  text: "BC Energy Regulator investigation into NorthRiver Midstream contamination near Taylor sits within the client upstream operating area.",
  source_signal_ids: [SIG_025641],
  source_spans: [{ signal_id: SIG_025641, text: SIGNAL_TEXT[SIG_025641] }],
  asserts_client_impact: true, // derivation flagged client relevance; guard validates via asset link, not alias
}, deps);
const cOk = show("(c) asset-proximate SIG-2026-025641 (near Taylor), client-relevance via asset link", false, c);

// (control) grounded wildfire claim, no client scope → MUST construct.
const d = createDerivedClaim({
  text: "A resident defied an evacuation order in a fire zone in British Columbia.",
  source_signal_ids: [SIG_027390],
  source_spans: [{ signal_id: SIG_027390, text: SIGNAL_TEXT[SIG_027390] }],
}, deps);
const dOk = show("(control) grounded wildfire claim, no client scope", false, d);

const allPass = aOk && bOk && cOk && dOk;
console.log(allPass ? "✅ ALL FIXTURES PASS — (a)(b) fail; (c) constructs via asset link; control constructs."
                    : "❌ FIXTURE SUITE FAILED");
process.exit(allPass ? 0 : 1);
