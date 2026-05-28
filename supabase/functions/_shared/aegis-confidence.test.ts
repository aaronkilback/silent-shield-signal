// Workstream D — Deno test suite for the slim-slice evaluator, framing,
// and prose-lint library. Run via `deno test supabase/functions/_shared/aegis-confidence.test.ts`.

import { assert, assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  scoreCorroboration,
  scoreProvenanceQuality,
  scoreFreshness,
  internalComposite,
  summarizeConfidence,
  type ConfidenceAxes,
  type SourceRecord,
} from "./aegis-confidence.ts";
import { frameClaim } from "./aegis-claim-frame.ts";
import { proseLintReport } from "./aegis-prose-lint.ts";

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
const baseAxes: ConfidenceAxes = {
  corroboration: 0.6,
  provenance_quality: 0.85,
  freshness: 0.9,
  validation_state: "not_yet_reviewed",
  trajectory_confidence: null,
  grounded: true,
};

// ─── §3.1 corroboration ───────────────────────────────────────────────────
Deno.test("corroboration: 3 distinct lineages → 0.6", () => {
  const s: SourceRecord[] = ["a", "b", "c"].map((f) => ({
    surface: "audited_monitor_allowlist", lineage_fingerprint: f, observed_at: isoDaysAgo(1),
  }));
  assertAlmostEquals(scoreCorroboration(s), 0.6, 1e-9);
});
Deno.test("corroboration: dedupes identical lineages", () => {
  const s: SourceRecord[] = ["x", "x", "x"].map((f) => ({
    surface: "audited_monitor_allowlist", lineage_fingerprint: f, observed_at: isoDaysAgo(1),
  }));
  assertAlmostEquals(scoreCorroboration(s), 0.2, 1e-9);
});
Deno.test("corroboration: caps at 1.0 above CORROB_CAP", () => {
  const s: SourceRecord[] = Array.from({ length: 10 }, (_, i) => ({
    surface: "audited_monitor_allowlist", lineage_fingerprint: `f${i}`, observed_at: isoDaysAgo(1),
  }));
  assertEquals(scoreCorroboration(s), 1.0);
});

// ─── §3.2 provenance quality ──────────────────────────────────────────────
Deno.test("provenance_quality: MAX wins (high not lowered by low)", () => {
  const s: SourceRecord[] = [
    { surface: "ai_only", lineage_fingerprint: "a", observed_at: isoDaysAgo(1) },
    { surface: "analyst_confirmed", lineage_fingerprint: "b", observed_at: isoDaysAgo(1) },
    { surface: "audited_monitor_openweb", lineage_fingerprint: "c", observed_at: isoDaysAgo(1) },
  ];
  assertEquals(scoreProvenanceQuality(s), 1.0);
});
Deno.test("provenance_quality: quarantined → 0", () => {
  const s: SourceRecord[] = [{ surface: "quarantined", lineage_fingerprint: "q", observed_at: isoDaysAgo(1) }];
  assertEquals(scoreProvenanceQuality(s), 0);
});

// ─── §3.3 freshness ───────────────────────────────────────────────────────
Deno.test("freshness: operational 14d half-life, 14d old → 0.5", () => {
  const s: SourceRecord[] = [{ surface: "audited_monitor_allowlist", lineage_fingerprint: "a", observed_at: isoDaysAgo(14) }];
  assertAlmostEquals(scoreFreshness(s, "operational"), 0.5, 0.02);
});
Deno.test("freshness: 0d old → ~1.0", () => {
  const s: SourceRecord[] = [{ surface: "audited_monitor_allowlist", lineage_fingerprint: "a", observed_at: new Date().toISOString() }];
  assertAlmostEquals(scoreFreshness(s, "operational"), 1.0, 0.01);
});
Deno.test("freshness: document class → 1.0 regardless of age", () => {
  const s: SourceRecord[] = [{ surface: "tenant_document", lineage_fingerprint: "a", observed_at: isoDaysAgo(3650) }];
  assertEquals(scoreFreshness(s, "document"), 1);
});

// ─── §3.7 internal composite ──────────────────────────────────────────────
Deno.test("internalComposite: ungrounded → 0", () => {
  const axes: ConfidenceAxes = {
    corroboration: 1, provenance_quality: 1, freshness: 1,
    validation_state: "accepted", trajectory_confidence: 1, grounded: false,
  };
  assertEquals(internalComposite(axes), 0);
});

// ─── §A1.1 confidence-summary derivation ──────────────────────────────────
Deno.test("summary: ungrounded → ungrounded", () => {
  assertEquals(summarizeConfidence("retrieved_fact", { ...baseAxes, grounded: false }), "ungrounded");
});
Deno.test("summary: ai_generated_hypothesis → hypothesis", () => {
  assertEquals(summarizeConfidence("ai_generated_hypothesis", baseAxes), "hypothesis");
});
Deno.test("summary: inferred + not_accepted → inferred", () => {
  assertEquals(summarizeConfidence("inferred_relationship", baseAxes), "inferred");
});
Deno.test("summary: accepted + fresh → confirmed", () => {
  assertEquals(summarizeConfidence("retrieved_fact", { ...baseAxes, validation_state: "accepted" }), "confirmed");
});
Deno.test("summary: accepted + stale → stale", () => {
  assertEquals(
    summarizeConfidence("retrieved_fact", { ...baseAxes, validation_state: "accepted", freshness: 0.2 }),
    "stale",
  );
});
Deno.test("summary: corroboration<0.4 + not_accepted → single-source", () => {
  assertEquals(summarizeConfidence("retrieved_fact", { ...baseAxes, corroboration: 0.2 }), "single-source");
});
Deno.test("summary: corroboration≥0.4 + provenance≥0.7 + fresh → well-attested", () => {
  assertEquals(summarizeConfidence("retrieved_fact", baseAxes), "well-attested");
});

// ─── frameClaim invariants ────────────────────────────────────────────────
Deno.test("frameClaim: type label + lineage_count + summary + consideration invariants", () => {
  const f = frameClaim({
    claim_type: "retrieved_fact",
    label: "Entity X has email Y",
    payload: { entity_id: "e1", email: "y@example.com" },
    sources: [
      { surface: "tenant_document", lineage_fingerprint: "hashA", observed_at: isoDaysAgo(2) },
      { surface: "tenant_document", lineage_fingerprint: "hashA", observed_at: isoDaysAgo(2) }, // dup → 1 lineage
    ],
    axes: baseAxes,
  });
  assertEquals(f.what.type, "retrieved_fact");
  assertEquals(f.how.lineage_count, 1);
  assert(f.confidence.summary);
  assert(f.consideration);
  assertEquals(f.consideration.executed, false);
  assertEquals(f.consideration.requires_operator_approval, true);
});

// ─── Prose-lint R1–R6 ─────────────────────────────────────────────────────
const fixture = (
  claimType: "retrieved_fact" | "inferred_relationship" | "analyst_confirmed_assessment" | "ai_generated_hypothesis",
  override?: Partial<ConfidenceAxes>,
  sources?: SourceRecord[],
) =>
  frameClaim({
    claim_type: claimType,
    label: "test",
    payload: {},
    sources: sources ?? [{ surface: "audited_monitor_allowlist", lineage_fingerprint: "f1", observed_at: isoDaysAgo(1) }],
    axes: { ...baseAxes, ...(override ?? {}) },
  });

Deno.test("R2: 'confirmed' rejected when validation_state !== accepted", () => {
  assert(!proseLintReport("This is confirmed by all sources.", fixture("retrieved_fact")).passed);
});
Deno.test("R2: 'confirmed' accepted when validation_state === accepted", () => {
  assert(proseLintReport("This is confirmed.", fixture("retrieved_fact", { validation_state: "accepted" })).passed);
});
Deno.test("R3: 'multiple sources' rejected when lineage_count < 2", () => {
  assert(!proseLintReport("Multiple sources report this.", fixture("retrieved_fact")).passed);
});
Deno.test("R4: 'reports indicate' rejected on ai_generated_hypothesis", () => {
  assert(!proseLintReport("Reports indicate a rising trend.", fixture("ai_generated_hypothesis")).passed);
});
Deno.test("R5: stale without age qualifier → violation", () => {
  const f = fixture("retrieved_fact", { validation_state: "accepted", freshness: 0.2 });
  assert(!proseLintReport("This is true.", f).passed);
});
Deno.test("R5: stale with age qualifier → pass", () => {
  const f = fixture("retrieved_fact", { validation_state: "accepted", freshness: 0.2 });
  assert(proseLintReport("Most recent evidence is 47 days old.", f).passed);
});
Deno.test("R6: 'confirmed' rejected on inferred_relationship", () => {
  assert(!proseLintReport("This is confirmed.", fixture("inferred_relationship")).passed);
});
Deno.test("R1: ungrounded frame triggers suppression violation", () => {
  const f = fixture("retrieved_fact", { grounded: false });
  const r = proseLintReport("anything", f);
  assert(!r.passed);
  assert(r.violations.some((v) => v.rule_id === "R1_ungrounded_must_be_suppressed"));
});
