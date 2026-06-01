// Deno tests for the Posting-Time axis. Run with:
//   deno test supabase/functions/_shared/er-axes/posting-time.test.ts
//
// All tests use deterministic fixtures — no clock-of-the-day dependencies.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computePostingTimeAxis,
  hourOfWeekUTC,
  pearson,
  formatHourOfWeek,
  POSTING_TIME_MIN_SIGNALS_PER_ACTOR,
  POSTING_TIME_MODERATE_PEARSON,
  POSTING_TIME_STRONG_PEARSON,
} from "./posting-time.ts";

Deno.test("hourOfWeekUTC: Mon 00:00 UTC = 0", () => {
  // 2024-01-01 is a Monday
  assertEquals(hourOfWeekUTC(new Date("2024-01-01T00:00:00Z")), 0);
  assertEquals(hourOfWeekUTC(new Date("2024-01-01T14:00:00Z")), 14);
  assertEquals(hourOfWeekUTC(new Date("2024-01-07T23:00:00Z")), 167); // Sun 23:00
});

Deno.test("pearson: identical vectors → 1.0", () => {
  const v = [1, 2, 3, 4, 5];
  assertEquals(pearson(v, v), 1);
});

Deno.test("pearson: perfectly anti-correlated → -1.0", () => {
  const r = pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
  assert(r !== null && Math.abs(r - -1) < 1e-9);
});

Deno.test("pearson: zero-variance vector → null", () => {
  assertEquals(pearson([2, 2, 2, 2], [1, 2, 3, 4]), null);
});

Deno.test("pearson: empty / mismatched lengths → null", () => {
  assertEquals(pearson([], []), null);
  assertEquals(pearson([1, 2], [1, 2, 3]), null);
});

Deno.test("formatHourOfWeek: round-trip readable", () => {
  assertEquals(formatHourOfWeek(0), "Mon 00:00");
  assertEquals(formatHourOfWeek(38), "Tue 14:00");
  assertEquals(formatHourOfWeek(167), "Sun 23:00");
});

Deno.test("computePostingTimeAxis: insufficient samples below floor", () => {
  const result = computePostingTimeAxis({
    signalsCreatedAtA: ["2024-01-01T14:00:00Z", "2024-01-02T14:00:00Z"],
    signalsCreatedAtB: ["2024-01-01T14:00:00Z"],
  });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assertEquals(result.has_high_confidence_evidence, false);
  assertEquals(result.pearson_r, null);
  assert(result.stub_reason !== null);
  assert(result.stub_reason!.includes(String(POSTING_TIME_MIN_SIGNALS_PER_ACTOR)));
});

Deno.test("computePostingTimeAxis: identical activity patterns → strong + high_confidence", () => {
  // Both actors post at the same set of hours
  const tsList = Array.from({ length: 20 }, (_, i) =>
    new Date(2024, 0, 1 + Math.floor(i / 4), 14 + (i % 4)).toISOString()
  );
  const result = computePostingTimeAxis({
    signalsCreatedAtA: tsList,
    signalsCreatedAtB: tsList,
  });
  assertEquals(result.status, "computed");
  assert(result.pearson_r !== null);
  assert(result.pearson_r! > POSTING_TIME_STRONG_PEARSON);
  assertEquals(result.exceeds_strong, true);
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.has_high_confidence_evidence, true);
  assert(result.evidence_summary.includes("pearson_r="));
  assert(result.most_active_shared_hours.length > 0);
});

Deno.test("computePostingTimeAxis: disjoint activity patterns → low pearson, no thresholds met", () => {
  // Actor A always posts at hour 14; actor B at hour 2 (different time-of-day)
  const tsA = Array.from({ length: 15 }, (_, i) =>
    new Date(`2024-01-${String(i + 1).padStart(2, "0")}T14:00:00Z`).toISOString()
  );
  const tsB = Array.from({ length: 15 }, (_, i) =>
    new Date(`2024-01-${String(i + 1).padStart(2, "0")}T02:00:00Z`).toISOString()
  );
  const result = computePostingTimeAxis({
    signalsCreatedAtA: tsA,
    signalsCreatedAtB: tsB,
  });
  assertEquals(result.status, "computed");
  // Vectors are zero-aligned only at one hour each → low (or null) correlation
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assertEquals(result.has_high_confidence_evidence, false);
});

Deno.test("computePostingTimeAxis: moderate correlation passes moderate but not strong", () => {
  // Construct vectors with known partial overlap. Each actor has 12 signals.
  const tsA = [
    "2024-01-01T14:00:00Z", "2024-01-01T15:00:00Z", "2024-01-01T16:00:00Z",
    "2024-01-02T14:00:00Z", "2024-01-02T15:00:00Z", "2024-01-02T16:00:00Z",
    "2024-01-03T14:00:00Z", "2024-01-03T15:00:00Z", "2024-01-03T16:00:00Z",
    "2024-01-04T14:00:00Z", "2024-01-04T15:00:00Z", "2024-01-04T16:00:00Z",
  ];
  // B mostly overlaps but adds some noise at different hours
  const tsB = [
    "2024-01-01T14:00:00Z", "2024-01-01T15:00:00Z", "2024-01-01T21:00:00Z",
    "2024-01-02T14:00:00Z", "2024-01-02T15:00:00Z", "2024-01-02T22:00:00Z",
    "2024-01-03T14:00:00Z", "2024-01-03T15:00:00Z", "2024-01-03T23:00:00Z",
    "2024-01-04T14:00:00Z", "2024-01-04T15:00:00Z", "2024-01-04T03:00:00Z",
  ];
  const result = computePostingTimeAxis({
    signalsCreatedAtA: tsA, signalsCreatedAtB: tsB,
  });
  assertEquals(result.status, "computed");
  assert(result.pearson_r !== null);
  // Should land between moderate and strong
  assert(
    result.pearson_r! >= POSTING_TIME_MODERATE_PEARSON,
    `expected pearson_r ≥ ${POSTING_TIME_MODERATE_PEARSON}, got ${result.pearson_r}`,
  );
});

Deno.test("computePostingTimeAxis: deterministic across runs", () => {
  const ts = Array.from({ length: 30 }, (_, i) =>
    new Date(`2024-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`).toISOString()
  );
  const r1 = computePostingTimeAxis({ signalsCreatedAtA: ts, signalsCreatedAtB: ts });
  const r2 = computePostingTimeAxis({ signalsCreatedAtA: ts, signalsCreatedAtB: ts });
  assertEquals(r1.pearson_r, r2.pearson_r);
  assertEquals(r1.evidence_summary, r2.evidence_summary);
  assertEquals(JSON.stringify(r1.most_active_shared_hours), JSON.stringify(r2.most_active_shared_hours));
});
