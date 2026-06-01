// Deno tests for the Source-Class axis.

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

Deno.test("source-class: identical class sets → strong overlap", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC News", "reddit.com", "twitter.com"], // news + social_reddit + social_x
    sourceLabelsB: ["Reuters",  "reddit.com", "twitter.com"], // news + social_reddit + social_x
  });
  assertEquals(result.status, "computed");
  assertEquals(result.classes_a, ["news", "social_reddit", "social_x"]);
  assertEquals(result.classes_b, ["news", "social_reddit", "social_x"]);
  assertEquals(result.shared_classes, ["news", "social_reddit", "social_x"]);
  assertEquals(result.overlap_ratio, 1);
  assertEquals(result.exceeds_strong, true);
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.has_high_confidence_evidence, false); // source-class alone is never high-confidence
});

Deno.test("source-class: partial overlap → moderate but not strong", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["BBC", "reddit.com"],          // news + social_reddit
    sourceLabelsB: ["Reuters", "facebook.com"],    // news + social_facebook
  });
  assertEquals(result.status, "computed");
  assertEquals(result.shared_classes, ["news"]);
  // overlap_ratio = 1/3 ≈ 0.33 → moderate (≥0.2) but not strong
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.exceeds_strong, false);
});

Deno.test("source-class: disjoint class sets → no moderate", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["reddit.com", "twitter.com"], // social_reddit + social_x
    sourceLabelsB: ["facebook.com", "instagram.com"], // social_facebook + social_instagram
  });
  assertEquals(result.status, "computed");
  assertEquals(result.shared_classes.length, 0);
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
});

Deno.test("source-class: deterministic ordering", () => {
  const r1 = computeSourceClassAxis({
    sourceLabelsA: ["twitter.com", "reddit.com", "BBC"],
    sourceLabelsB: ["BBC", "reddit.com", "twitter.com"],
  });
  // classes_a / classes_b should be lexically sorted for determinism
  assertEquals(r1.classes_a, r1.classes_a.slice().sort());
  assertEquals(r1.classes_b, r1.classes_b.slice().sort());
});

Deno.test("source-class: unknown_source labels are discarded", () => {
  const result = computeSourceClassAxis({
    sourceLabelsA: ["<no_source>", "BBC", "reddit"], // unknown gets discarded; "news" + "social_reddit"
    sourceLabelsB: ["", "Reuters", "twitter"],        // "news" + "social_x"
  });
  assertEquals(result.status, "computed");
  assert(!result.classes_a.includes("unknown_source"));
  assert(!result.classes_b.includes("unknown_source"));
});
