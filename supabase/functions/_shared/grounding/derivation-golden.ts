// WO-GROUNDING-01 Phase 2 — golden test: a wildfire signal, even with a HALLUCINATING model, yields ZERO client
// claims. Proves the derivation pass does not trust the model — the constructor rejects at the binding step.
// Run: node --experimental-strip-types supabase/functions/_shared/grounding/derivation-golden.ts
import { deriveClaimsFromSignal, clientClaims, type DeriveCandidates } from "./derivation.ts";
import type { GroundingDeps } from "./derived-claim.ts";

const SIG_027390 = "00000000-0000-0000-0000-000000027390";
const WILDFIRE = "Crews were forced to rescue a resident who defied an evacuation order in a fire zone in British Columbia.";
const PECL_ALIASES = ["PETRONAS Canada", "Petronas Canada", "PECL", "PCL", "Petronas Canada Ltd", "Progress Energy Canada", "Progress Energy"];

const deps: GroundingDeps = {
  getSignalText: (id) => (id === SIG_027390 ? WILDFIRE : null),
  clientAliases: PECL_ALIASES,
  resolveAssetLink: () => false, // wildfire signal resolves no PECL asset
  onReject: (i) => console.log(`   [reject] ${i.reason}: ${i.detail.slice(0, 80)}`),
};

// A HALLUCINATING model: for a BC wildfire rescue it emits claims it cannot support.
const hallucinatingModel: DeriveCandidates = async () => [
  { text: "Coordinate the physical security review with Uniper for the LNG import terminal.", span: WILDFIRE, asserts_client_impact: true }, // R4
  { text: "Petronas Canada crews conducted the wildfire rescue.", span: WILDFIRE, asserts_client_impact: true }, // R4
  { text: "The evacuation threatens PECL Montney upstream operations.", span: WILDFIRE, asserts_client_impact: true }, // R4
  // R3 case: NO client language, but asserts terms absent from the span → must reject claim_not_grounded_in_span.
  { text: "The fire has disrupted LNG shipments through Kitimat.", span: WILDFIRE },
];
// A WELL-BEHAVED model: correctly returns nothing about the client for a wildfire signal.
const wellBehavedModel: DeriveCandidates = async () => [];

const run = async () => {
  console.log("═══ WO-GROUNDING-01 derivation golden test — wildfire signal → zero client claims ═══\n");

  const h = await deriveClaimsFromSignal(SIG_027390, WILDFIRE, deps, hallucinatingModel);
  const hClient = clientClaims(h, PECL_ALIASES);
  console.log(`hallucinating model: ${h.accepted.length} accepted, ${h.rejected.length} rejected, ${hClient.length} CLIENT claims`);
  h.rejected.forEach((r) => console.log(`   rejected "${r.text.slice(0, 50)}…" → ${r.reason}`));

  const w = await deriveClaimsFromSignal(SIG_027390, WILDFIRE, deps, wellBehavedModel);
  const wClient = clientClaims(w, PECL_ALIASES);
  console.log(`\nwell-behaved model:  ${w.accepted.length} accepted, ${wClient.length} CLIENT claims (silence is correct)`);

  // Prove R3 fires inside the loop (not only R4): the Kitimat/LNG claim rejects on grounding, not client scope.
  const r3 = h.rejected.find((r) => r.reason === "claim_not_grounded_in_span");
  const r3ok = !!r3 && /lng/.test(r3.detail) && /kitimat/.test(r3.detail);
  console.log(`\nR3-in-loop: ${r3ok ? "PASS" : "FAIL"} — ${r3 ? r3.detail : "no claim_not_grounded_in_span rejection found"}`);

  const pass = hClient.length === 0 && wClient.length === 0 && h.accepted.length === 0 && r3ok;
  console.log(`\n${pass ? "✅ GOLDEN PASS — wildfire → ZERO client claims; R3 (grounding) AND R4 (scope) both proven in-loop."
                       : "❌ GOLDEN FAIL."}`);
  process.exit(pass ? 0 : 1);
};
run();
