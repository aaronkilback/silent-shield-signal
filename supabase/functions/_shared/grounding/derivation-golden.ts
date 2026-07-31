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

// A HALLUCINATING model: for a BC wildfire rescue it emits client claims it cannot support.
const hallucinatingModel: DeriveCandidates = async () => [
  { text: "Coordinate the physical security review with Uniper for the LNG import terminal.", span: WILDFIRE, asserts_client_impact: true },
  { text: "Petronas Canada crews conducted the wildfire rescue.", span: WILDFIRE, asserts_client_impact: true },
  { text: "The evacuation threatens PECL Montney upstream operations.", span: WILDFIRE, asserts_client_impact: true },
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

  const pass = hClient.length === 0 && wClient.length === 0 && h.accepted.length === 0;
  console.log(`\n${pass ? "✅ GOLDEN PASS — a wildfire signal yields ZERO client claims, even from a hallucinating model."
                       : "❌ GOLDEN FAIL — a client claim survived a wildfire signal."}`);
  process.exit(pass ? 0 : 1);
};
run();
