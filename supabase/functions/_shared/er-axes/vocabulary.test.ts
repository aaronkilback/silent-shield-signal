// Deno tests for the Vocabulary axis. Run with:
//   deno test supabase/functions/_shared/er-axes/vocabulary.test.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeVocabularyAxis,
  tokenize,
  buildTermFreq,
  topDistinctiveTerms,
  VOCAB_MIN_WORDS_PER_ACTOR,
  VOCAB_MODERATE_SHARED_COUNT,
  VOCAB_STRONG_SHARED_COUNT,
  VOCAB_HIGH_CONFIDENCE_SHARED_COUNT,
} from "./vocabulary.ts";

Deno.test("tokenize: drops stopwords and short tokens", () => {
  const toks = tokenize("The quick brown fox is jumping over the lazy dog");
  // "the", "is", "over" are stopwords; "fox" passes (length 3); "the" length 3 → stopword
  assert(toks.includes("quick"));
  assert(toks.includes("brown"));
  assert(toks.includes("jumping"));
  assert(!toks.includes("the"));
  assert(!toks.includes("is"));
});

Deno.test("tokenize: deterministic on punctuation", () => {
  const a = tokenize("Hello, world! How's it going?");
  const b = tokenize("Hello world How's it going");
  assertEquals(a, b);
});

Deno.test("buildTermFreq: counts occurrences", () => {
  const tf = buildTermFreq([
    "tailings tailings tailings",
    "tailings consent",
    "consent decree",
  ]);
  assertEquals(tf.get("tailings"), 4);
  assertEquals(tf.get("consent"), 2);
  assertEquals(tf.get("decree"), 1);
});

Deno.test("topDistinctiveTerms: rare in corpus → high score", () => {
  const actorTf = new Map([
    ["common-word", 10], // in every signal
    ["rare-word", 3],    // in few signals
  ]);
  const globalDf = new Map([
    ["common-word", 1000], // in 1000 global signals
    ["rare-word", 5],      // in only 5 global signals
  ]);
  const top = topDistinctiveTerms(actorTf, globalDf, 1000, 2);
  // The rare word should be ranked first
  assertEquals(top[0], "rare-word");
});

Deno.test("topDistinctiveTerms: ties broken by lexical order ascending", () => {
  const actorTf = new Map([["alpha", 5], ["bravo", 5]]);
  const globalDf = new Map([["alpha", 10], ["bravo", 10]]);
  const top = topDistinctiveTerms(actorTf, globalDf, 100, 2);
  assertEquals(top[0], "alpha");
  assertEquals(top[1], "bravo");
});

Deno.test("computeVocabularyAxis: insufficient when both actors thin", () => {
  const result = computeVocabularyAxis({
    textsA: ["short text only"],
    textsB: ["another short one"],
    globalDf: new Map(),
    globalSignalCount: 1,
  });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assert(result.stub_reason !== null);
});

function makeTexts(count: number, distinctiveBag: string[]): string[] {
  const base =
    "pipeline regulation environment activist coalition operations infrastructure development project";
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const sprinkle = distinctiveBag[i % distinctiveBag.length];
    texts.push(`${base} ${base} ${sprinkle}`);
  }
  return texts;
}

Deno.test("computeVocabularyAxis: high overlap on shared distinctive terms", () => {
  const distinctiveTermsShared = [
    "tailings", "wet'suwet'en", "consent-decree", "molybdenum", "fugitive",
    "anonymizer", "encryption", "polysilicon", "tritium", "hexavalent",
    "chromium", "arsenic", "tailing", "sluice", "decant",
  ];
  // Both actors use the same distinctive terms heavily
  const textsA = makeTexts(20, distinctiveTermsShared);
  const textsB = makeTexts(20, distinctiveTermsShared);
  // Build global DF that makes these terms RARE in the rest of the corpus
  const globalDf = new Map<string, number>();
  // 1000 global signals; distinctive terms appear in only ~20 of them
  for (const t of distinctiveTermsShared) globalDf.set(t, 20);
  // Common terms are in many
  for (const t of ["pipeline", "regulation", "operations", "infrastructure", "environment", "activist", "coalition", "project", "development"]) {
    globalDf.set(t, 800);
  }
  const result = computeVocabularyAxis({
    textsA, textsB, globalDf, globalSignalCount: 1000,
  });
  assertEquals(result.status, "computed");
  assert(result.top_shared_distinctive_terms.length >= VOCAB_HIGH_CONFIDENCE_SHARED_COUNT,
    `expected ≥${VOCAB_HIGH_CONFIDENCE_SHARED_COUNT} shared distinctive terms, got ${result.top_shared_distinctive_terms.length}`);
  assertEquals(result.exceeds_strong, true);
  assertEquals(result.has_high_confidence_evidence, true);
});

Deno.test("computeVocabularyAxis: disjoint distinctive terms → low overlap", () => {
  const distinctiveA = ["alpha-one", "alpha-two", "alpha-three", "alpha-four", "alpha-five"];
  const distinctiveB = ["beta-one", "beta-two", "beta-three", "beta-four", "beta-five"];
  const textsA = makeTexts(20, distinctiveA);
  const textsB = makeTexts(20, distinctiveB);
  const globalDf = new Map<string, number>();
  for (const t of [...distinctiveA, ...distinctiveB]) globalDf.set(t, 20);
  const result = computeVocabularyAxis({
    textsA, textsB, globalDf, globalSignalCount: 1000,
  });
  assertEquals(result.status, "computed");
  assertEquals(result.top_shared_distinctive_terms.length, 0);
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
});

Deno.test("computeVocabularyAxis: deterministic", () => {
  const textsA = makeTexts(15, ["tailings", "consent-decree", "wet'suwet'en"]);
  const textsB = makeTexts(15, ["tailings", "consent-decree", "wet'suwet'en"]);
  const globalDf = new Map<string, number>([
    ["tailings", 20], ["consent-decree", 15], ["wet'suwet'en", 8],
    ["pipeline", 800], ["regulation", 750],
  ]);
  const r1 = computeVocabularyAxis({ textsA, textsB, globalDf, globalSignalCount: 1000 });
  const r2 = computeVocabularyAxis({ textsA, textsB, globalDf, globalSignalCount: 1000 });
  assertEquals(r1.top_shared_distinctive_terms, r2.top_shared_distinctive_terms);
  assertEquals(r1.overlap_ratio, r2.overlap_ratio);
  assertEquals(r1.evidence_summary, r2.evidence_summary);
});
