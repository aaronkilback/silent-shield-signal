// WO-GROUNDING-01 — Phase 1 regression fixtures. These DEFINE done: both must FAIL to construct.
// Run: node --experimental-strip-types supabase/functions/_shared/grounding/phase1-fixtures.ts
import { createDerivedClaim, type GroundingDeps } from "./derived-claim.ts";

// ── Real signal text (verbatim from prod signals, 2026-07-31) ──
const SIG_027390 = "00000000-0000-0000-0000-000000027390"; // SIG-2026-027390 (wildfire rescue)
const SIG_026745 = "00000000-0000-0000-0000-000000026745"; // SIG-2026-026745 (Alberta pipeline / killer whales)
const SIGNAL_TEXT: Record<string, string> = {
  [SIG_027390]: "Crews were forced to rescue a resident who defied an evacuation order in a fire zone in British Columbia.",
  [SIG_026745]: "Experts say the proposed Alberta pipeline route poses a risk to the endangered southern resident killer whales. Changes by the Carney government could exempt projects from species protection tests.",
};

// PECL client aliases resolved via the client entity's alias set (Amendment 7a).
const PECL_ALIASES = ["Petronas Canada Ltd", "PECL", "PCL", "Progress Energy", "Petronas Canada", "Petronas"];

// Gate-3 asset-link resolver — real PostGIS impl lands in Phase 2. Neither the BC wildfire nor the Alberta
// pipeline resolves to a PECL-operated asset point, so it returns false for both (Amendment 7b).
const deps: GroundingDeps = {
  getSignalText: (id) => SIGNAL_TEXT[id] ?? null,
  clientAliases: PECL_ALIASES,
  resolveAssetLink: (_signalId) => false,
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

console.log("═══ WO-GROUNDING-01 Phase 1 — regression fixtures (both MUST fail to construct) ═══\n");

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

// Positive control — a claim genuinely grounded in the wildfire signal, no client scope → MUST construct.
const c = createDerivedClaim({
  text: "A resident defied an evacuation order in a fire zone in British Columbia.",
  source_signal_ids: [SIG_027390],
  source_spans: [{ signal_id: SIG_027390, text: SIGNAL_TEXT[SIG_027390] }],
}, deps);
const cOk = show("(control) grounded wildfire claim, no client scope", false, c);

const allPass = aOk && bOk && cOk;
console.log(allPass ? "✅ ALL FIXTURES PASS — both regressions fail to construct; control constructs."
                    : "❌ FIXTURE SUITE FAILED");
process.exit(allPass ? 0 : 1);
