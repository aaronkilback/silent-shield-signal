// Deno tests for the Source-Class axis (incl. the A′ non-ubiquitous shared-class guard).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeSourceClassAxis,
  SOURCE_CLASS_MIN_CLASSES_PER_ACTOR,
} from "./source-class.ts";

Deno.test("source-class: insufficient when actor sees < 2 distinct classes", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC News", "Reuters", "Associated Press"], // all normalize → "news"
    sourceLabelsB: ["reddit.com/r/something"],                    // → "social_reddit"
  });
  assertEquals(result.status, "insufficient_samples");
  assert(result.stub_reason !== null);
  assert(result.stub_reason!.includes(String(SOURCE_CLASS_MIN_CLASSES_PER_ACTOR)));
});

// ─── A′ NEGATIVE CONTROLS (the confound the guard closes) ────────────────────

Deno.test("A′ NEGATIVE CONTROL: news+social only → NOT behavioral corroboration", () => {
  // Identical class sets, but ALL ubiquitous (news + social). Pre-guard this was
  // exceeds_strong=true — a shared-infrastructure false positive. Post-guard it
  // contributes nothing: distinctive_shared is empty.
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC News", "reddit.com", "twitter.com"], // news + social_reddit + social_x
    sourceLabelsB: ["Reuters",  "reddit.com", "twitter.com"], // news + social_reddit + social_x
  });
  assertEquals(result.status, "computed");
  assertEquals(result.shared_classes, ["news", "social_reddit", "social_x"]);
  assertEquals(result.distinctive_shared_classes, []);
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assert(result.evidence_summary.includes("ubiquitous"));
});

Deno.test("A′ NEGATIVE CONTROL: shared ubiquitous classes CANNOT produce strong overlap", () => {
  // Maximal ubiquitous overlap across many common platforms → still NOT strong.
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC", "reddit", "twitter.com", "youtube.com", "rss feed"], // news+social_reddit+social_x+video+rss
    sourceLabelsB: ["CNN", "reddit", "twitter.com", "youtube.com", "rss feed"],
  });
  assertEquals(result.status, "computed");
  assertEquals(result.overlap_ratio, 1); // perfect raw overlap...
  assertEquals(result.exceeds_strong, false); // ...but zero distinctive corroboration
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.distinctive_shared_classes, []);
});

// ─── A′ POSITIVE CONTROLS (distinctive classes DO corroborate) ───────────────

Deno.test("A′: one shared DISTINCTIVE class (government_cyber) → moderate, not strong", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC News", "CISA Alert AA24-001"],  // news + government_cyber
    sourceLabelsB: ["Reuters",  "nvd.nist.gov"],         // news + government_cyber
  });
  assertEquals(result.status, "computed");
  assertEquals(result.distinctive_shared_classes, ["government_cyber"]);
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.exceeds_strong, false);
  // ubiquitous shared (news) is acknowledged but excluded
  assert(result.evidence_summary.includes("government_cyber"));
});

Deno.test("A′: two shared DISTINCTIVE classes (government + government_cyber) → strong", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["CSIS Public Report", "CISA KEV catalog"], // government + government_cyber
    sourceLabelsB: ["rcmp.gc.ca", "nvd.nist.gov"],             // government + government_cyber
  });
  assertEquals(result.status, "computed");
  assertEquals(result.distinctive_shared_classes.sort(), ["government", "government_cyber"]);
  assertEquals(result.exceeds_strong, true);
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.has_high_confidence_evidence, false); // never high-confidence alone
});

// ─── unchanged structural behavior ───────────────────────────────────────────

Deno.test("source-class: disjoint class sets → no moderate", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["reddit.com", "twitter.com"],     // social_reddit + social_x
    sourceLabelsB: ["facebook.com", "instagram.com"], // social_facebook + social_instagram
  });
  assertEquals(result.status, "computed");
  assertEquals(result.shared_classes.length, 0);
  assertEquals(result.distinctive_shared_classes, []);
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
});

Deno.test("source-class: deterministic ordering", () => {
  const r1 = computeSourceClassAxis({
    sourceLabelsA: ["twitter.com", "reddit.com", "BBC"],
    sourceLabelsB: ["BBC", "reddit.com", "twitter.com"],
  });
  assertEquals(r1.classes_a, r1.classes_a.slice().sort());
  assertEquals(r1.classes_b, r1.classes_b.slice().sort());
});

Deno.test("source-class: unknown_source labels are discarded", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["<no_source>", "BBC", "reddit"], // unknown discarded; news + social_reddit
    sourceLabelsB: ["", "Reuters", "twitter"],        // news + social_x
  });
  assertEquals(result.status, "computed");
  assert(!result.classes_a.includes("unknown_source"));
  assert(!result.classes_b.includes("unknown_source"));
});
