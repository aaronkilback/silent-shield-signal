// Per-response Coverage Confidence — Deno test suite.
// Run via: deno test supabase/functions/_shared/aegis-coverage-confidence.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertGreater,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPromptInjectionBlock,
  buildReasonBullets,
  computeContributors,
  computeCoverageConfidence,
  deriveClass,
  isTemporallyGrounded,
  normalizeSourceClass,
  scanProhibitedPhrases,
  THRESHOLDS,
  type CitedSignal,
  type CoverageInput,
} from "./aegis-coverage-confidence.ts";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
const sig = (over: Partial<CitedSignal>): CitedSignal => ({
  signal_id: "s1",
  source_class: "news",
  publisher_lineage: "host.example.com",
  event_date: iso(daysAgo(2)),
  created_at: iso(daysAgo(1)),
  is_quarantined: false,
  ...over,
});

// ─── source-class normalization ────────────────────────────────────────────
Deno.test("normalize: government_cyber matches CISA/NVD/KEV", () => {
  assertEquals(normalizeSourceClass("CISA Alert AA24-001"), "government_cyber");
  assertEquals(normalizeSourceClass("nvd.nist.gov"), "government_cyber");
  assertEquals(normalizeSourceClass("KEV catalog"), "government_cyber");
});
Deno.test("normalize: gov.ca / CSIS → government", () => {
  assertEquals(normalizeSourceClass("CSIS Public Report"), "government");
  assertEquals(normalizeSourceClass("publicsafety.gc.ca"), "government");
});
Deno.test("normalize: social platforms each get distinct class", () => {
  assertEquals(normalizeSourceClass("reddit.com"), "social_reddit");
  assertEquals(normalizeSourceClass("twitter.com"), "social_x");
  assertEquals(normalizeSourceClass("instagram"), "social_instagram");
});
Deno.test("normalize: empty / unknown → unknown_source", () => {
  assertEquals(normalizeSourceClass(""), "unknown_source");
  assertEquals(normalizeSourceClass("<no_source>"), "unknown_source");
});
Deno.test("normalize: default fallback → news", () => {
  assertEquals(normalizeSourceClass("nytimes.com"), "news");
  assertEquals(normalizeSourceClass("unknown-publisher.example"), "news");
});

// ─── temporal grounding ─────────────────────────────────────────────────────
Deno.test("isTemporallyGrounded: explicit column current_grounded → true", () => {
  assert(
    isTemporallyGrounded(
      sig({ temporal_grounding: "current_grounded", event_date: null }),
    ),
  );
});
Deno.test("isTemporallyGrounded: 'unknown' = no determination → falls through to structural", () => {
  // 'unknown' is the schema default (100% of prod today) — not a determination
  // that the signal is ungrounded. It falls through to the structural check; a
  // real event_date 2 days before created_at is grounded. (Previously this
  // returned false, zeroing temporal_grounding_rate across all of prod.)
  assertEquals(
    isTemporallyGrounded(
      sig({ temporal_grounding: "unknown", event_date: iso(daysAgo(2)) }),
    ),
    true,
  );
});
Deno.test("isTemporallyGrounded: NULL event_date and no column → false", () => {
  assertEquals(isTemporallyGrounded(sig({ event_date: null })), false);
});
Deno.test("isTemporallyGrounded: cosmetic midnight of created_at → false", () => {
  const created = new Date("2026-05-30T14:23:45Z");
  const midnight = new Date("2026-05-30T00:00:00Z");
  const result = isTemporallyGrounded(
    sig({ event_date: iso(midnight), created_at: iso(created) }),
  );
  assertEquals(result, false);
});
Deno.test("isTemporallyGrounded: event_date 1 day before created_at → true", () => {
  const created = new Date("2026-05-30T14:00:00Z");
  const event = new Date("2026-05-29T11:00:00Z");
  assert(
    isTemporallyGrounded(
      sig({ event_date: iso(event), created_at: iso(created) }),
    ),
  );
});

// ─── contributor computation ────────────────────────────────────────────────
Deno.test("contributors: distinct source classes counted correctly", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ signal_id: "1", source_class: "nytimes" }),
      sig({ signal_id: "2", source_class: "cbc" }),
      sig({ signal_id: "3", source_class: "reddit.com" }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const c = computeContributors(input);
  // news + news + social_reddit = 2 distinct classes
  assertEquals(c.source_diversity_count, 2);
});
Deno.test("contributors: corroboration = distinct publisher lineages", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ signal_id: "1", publisher_lineage: "a.com" }),
      sig({ signal_id: "2", publisher_lineage: "a.com" }), // dup
      sig({ signal_id: "3", publisher_lineage: "b.com" }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const c = computeContributors(input);
  assertEquals(c.corroboration_strength, 2); // a.com + b.com
});
Deno.test("contributors: quarantined signals excluded", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ signal_id: "1", is_quarantined: false }),
      sig({ signal_id: "2", is_quarantined: true }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const c = computeContributors(input);
  assertEquals(c.cited_signal_count, 1);
});
Deno.test("contributors: all quarantined flagged", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ is_quarantined: true }),
      sig({ is_quarantined: true }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const c = computeContributors(input);
  assertEquals(c.all_signals_quarantined, true);
});

// ─── class derivation predicates ───────────────────────────────────────────
Deno.test("class: zero signals on signal-required question → UNKNOWN", () => {
  const input: CoverageInput = {
    cited_signals: [],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "UNKNOWN");
});
Deno.test("class: Unknowable question always → UNKNOWN", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({}), // even with cited signals
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: true,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "UNKNOWN");
});
Deno.test("class: mission_health critical → LOW", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ signal_id: "1", source_class: "cbc", publisher_lineage: "a.com" }),
      sig({ signal_id: "2", source_class: "reddit", publisher_lineage: "b.com" }),
      sig({ signal_id: "3", source_class: "gov.ca", publisher_lineage: "c.com" }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 1,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "LOW");
});
Deno.test("class: single publisher lineage → LOW", () => {
  const input: CoverageInput = {
    cited_signals: [
      sig({ signal_id: "1", source_class: "cbc", publisher_lineage: "same.com" }),
      sig({ signal_id: "2", source_class: "ctv", publisher_lineage: "same.com" }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "LOW"); // corroboration = 1 < floor 2
});
Deno.test("class: temporal grounding 25% → LOW", () => {
  const sigs = [];
  // 1 grounded + 3 ungrounded = 25%
  sigs.push(sig({ signal_id: "1", publisher_lineage: "a.com", source_class: "cbc" }));
  for (let i = 2; i <= 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: i === 2 ? "reddit" : i === 3 ? "gov.ca" : "cbc",
        event_date: null, // ungrounded
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "LOW");
});
Deno.test("class: well-corroborated multi-source → HIGH", () => {
  const sigs: CitedSignal[] = [];
  for (let i = 0; i < 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: ["cbc", "reddit", "gov.ca", "energetic-city"][i],
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "HIGH");
});
Deno.test("class: MEDIUM = corroboration=2 with all temporal grounded", () => {
  const sigs: CitedSignal[] = [
    sig({ signal_id: "1", publisher_lineage: "a.com", source_class: "cbc" }),
    sig({ signal_id: "2", publisher_lineage: "b.com", source_class: "ctv" }),
    sig({ signal_id: "3", publisher_lineage: "c.com", source_class: "energetic-city" }),
  ];
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  // corroboration=3 ≥ HIGH; sources = news + news + community = 2 distinct;
  // below SOURCE_DIVERSITY_HIGH=3, but at or above LOW_FLOOR=2 → MEDIUM
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "MEDIUM");
});

// ─── expanded-mode triggers ─────────────────────────────────────────────────
Deno.test("expanded: LOW class auto-triggers", () => {
  const input: CoverageInput = {
    cited_signals: [sig({ publisher_lineage: "same.com" })],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "LOW");
  assert(r.expanded_mode);
  assertEquals(r.expanded_trigger, "low_or_unknown_class");
});
Deno.test("expanded: operator_requested_detail on HIGH triggers EXPANDED", () => {
  const sigs: CitedSignal[] = [];
  for (let i = 0; i < 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: ["cbc", "reddit", "gov.ca", "energetic-city"][i],
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: true,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "HIGH");
  assert(r.expanded_mode);
  assertEquals(r.expanded_trigger, "operator_request");
});
Deno.test("expanded: material_risk triggers EXPANDED", () => {
  const sigs: CitedSignal[] = [];
  for (let i = 0; i < 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: ["cbc", "reddit", "gov.ca", "energetic-city"][i],
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: true,
  };
  const r = computeCoverageConfidence(input);
  assert(r.expanded_mode);
  assertEquals(r.expanded_trigger, "material_risk");
});
Deno.test("expanded: HIGH + no triggers stays SHORT", () => {
  const sigs: CitedSignal[] = [];
  for (let i = 0; i < 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: ["cbc", "reddit", "gov.ca", "energetic-city"][i],
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "HIGH");
  assertEquals(r.expanded_mode, false);
});

// ─── emit_coverage_section gating ─────────────────────────────────────────
Deno.test("emit_coverage_section=false when question_requires_signal_grounding=false", () => {
  const input: CoverageInput = {
    cited_signals: [],
    question_requires_signal_grounding: false,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.emit_coverage_section, false);
});

// ─── reason bullets emerge from contributors ──────────────────────────────
Deno.test("reasons: HIGH cites concrete numbers, not adjectives", () => {
  const sigs: CitedSignal[] = [];
  for (let i = 0; i < 4; i++) {
    sigs.push(
      sig({
        signal_id: String(i),
        publisher_lineage: `pub${i}.com`,
        source_class: ["cbc", "reddit", "gov.ca", "energetic-city"][i],
      }),
    );
  }
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertGreater(r.reason_bullets.length, 1);
  // Must include source-count, lineage-count, and temporal-percent
  const joined = r.reason_bullets.join(" ");
  assert(/\d+\s+source/i.test(joined), "should cite source class count");
  assert(/\d+\s+independent/i.test(joined), "should cite corroboration count");
  assert(/\d+%/.test(joined), "should cite temporal grounding percent");
});

// ─── prohibited-phrase scanner ────────────────────────────────────────────
Deno.test("prohibited: 'no evidence found' without UNKNOWN qualifier is caught", () => {
  const text = "Analysis shows no evidence found of cycling activity. Recommendation: stand down.";
  const findings = scanProhibitedPhrases(text);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].excused_by_unknown_qualifier, false);
});
Deno.test("prohibited: 'no evidence found' WITH 'Coverage Confidence: UNKNOWN' is excused", () => {
  const text = "Coverage Confidence: UNKNOWN — Reddit not collected. As such no evidence found of cycling.";
  const findings = scanProhibitedPhrases(text);
  // Excused entries are filtered OUT of the return value
  assertEquals(findings.length, 0);
});
Deno.test("prohibited: 'no evidence found' WITH 'Unknowable' nearby is excused", () => {
  const text = "Private DMs are Unknowable; therefore no evidence found of internal coordination.";
  const findings = scanProhibitedPhrases(text);
  assertEquals(findings.length, 0);
});
Deno.test("prohibited: 'no evidence of X' caught", () => {
  const text = "Conclusion: there is no evidence of cycling.";
  const findings = scanProhibitedPhrases(text);
  assertGreater(findings.length, 0);
});

// ─── prompt injection block ────────────────────────────────────────────────
Deno.test("prompt block: includes COMPUTED class verbatim", () => {
  const sigs: CitedSignal[] = [
    sig({ publisher_lineage: "a.com", source_class: "cbc" }),
    sig({ publisher_lineage: "b.com", source_class: "reddit" }),
    sig({ publisher_lineage: "c.com", source_class: "gov.ca" }),
  ];
  const input: CoverageInput = {
    cited_signals: sigs,
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  const block = buildPromptInjectionBlock(r);
  assertStringIncludes(block, "CLASS: " + r.class);
  assertStringIncludes(block, "Coverage Confidence: " + r.class);
  assertStringIncludes(block, "DO NOT MODIFY");
  assertStringIncludes(block, "Operator Impact");
  assertStringIncludes(block, "Unknown");
  assertStringIncludes(block, "Unknowable");
});
Deno.test("prompt block: empty when emit_coverage_section=false", () => {
  const input: CoverageInput = {
    cited_signals: [],
    question_requires_signal_grounding: false,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  const block = buildPromptInjectionBlock(r);
  assertEquals(block, "");
});
Deno.test("prompt block: EXPANDED mode emits Why / Blind Spots / What Would Increase Confidence", () => {
  const input: CoverageInput = {
    cited_signals: [sig({ publisher_lineage: "same.com" })],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  };
  const r = computeCoverageConfidence(input);
  assertEquals(r.class, "LOW");
  const block = buildPromptInjectionBlock(r);
  assertStringIncludes(block, "Why:");
  assertStringIncludes(block, "Blind Spots:");
  assertStringIncludes(block, "What Would Increase Confidence:");
});

// ─── evidence-not-backfill smoke test ─────────────────────────────────────
Deno.test("evidence-not-backfill: identical evidence → identical class (determinism)", () => {
  const makeInput = (): CoverageInput => ({
    cited_signals: [
      sig({ signal_id: "1", publisher_lineage: "a.com", source_class: "cbc" }),
      sig({ signal_id: "2", publisher_lineage: "b.com", source_class: "reddit" }),
    ],
    question_requires_signal_grounding: true,
    is_unknowable_question: false,
    open_mission_health_critical_count: 0,
    operator_requested_detail: false,
    material_risk: false,
  });
  const r1 = computeCoverageConfidence(makeInput());
  const r2 = computeCoverageConfidence(makeInput());
  assertEquals(r1.class, r2.class);
  assertEquals(r1.reason_bullets, r2.reason_bullets);
  assertEquals(r1.expanded_mode, r2.expanded_mode);
});
