// Deno tests for the Posting-Time axis. Run with:
//   deno test supabase/functions/_shared/er-axes/posting-time.test.ts
//
// All tests use deterministic fixtures — no clock-of-the-day dependencies.
//
// G-9: the axis now buckets on actor-time-grounded `event_date`, never
// `created_at`. The `g()` helper builds a grounded signal (event_date = the
// supplied actor time; created_at = +30 min, so it is neither cosmetic-midnight
// nor copied-from-created). Ungrounded fixtures are built explicitly per test.

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
import type { TemporalSignal } from "../temporal-grounding.ts";

/** Build a grounded signal: event_date = actor time; created_at = +30 min. */
function g(eventIso: string): TemporalSignal {
  const eventMs = Date.parse(eventIso);
  return {
    event_date: eventIso,
    created_at: new Date(eventMs + 30 * 60 * 1000).toISOString(),
  };
}

/** Build N grounded signals all at the given UTC hour-of-day, on distinct days. */
function groundedAtHour(n: number, hourUtc: number): TemporalSignal[] {
  return Array.from({ length: n }, (_, i) =>
    g(`2024-01-${String((i % 28) + 1).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`)
  );
}

// ─── pure helpers (unchanged by G-9) ────────────────────────────────────────

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

// ─── axis: sample floor (now on the GROUNDED count) ──────────────────────────

Deno.test("computePostingTimeAxis: insufficient samples below floor", () => {
  const result = computePostingTimeAxis({
    signalsA: [g("2024-01-01T14:00:00Z"), g("2024-01-02T14:00:00Z")],
    signalsB: [g("2024-01-01T14:00:00Z")],
  });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assertEquals(result.has_high_confidence_evidence, false);
  assertEquals(result.pearson_r, null);
  assertEquals(result.grounded_signal_count_a, 2);
  assertEquals(result.grounded_signal_count_b, 1);
  assert(result.stub_reason !== null);
  assert(result.stub_reason!.includes(String(POSTING_TIME_MIN_SIGNALS_PER_ACTOR)));
});

// ─── axis: correlation behavior (preserved; now on event_date) ───────────────

Deno.test("computePostingTimeAxis: identical activity patterns → strong + high_confidence", () => {
  const ts = Array.from({ length: 20 }, (_, i) =>
    g(new Date(Date.UTC(2024, 0, 1 + Math.floor(i / 4), 14 + (i % 4))).toISOString())
  );
  const result = computePostingTimeAxis({ signalsA: ts, signalsB: ts });
  assertEquals(result.status, "computed");
  assert(result.pearson_r !== null);
  assert(result.pearson_r! > POSTING_TIME_STRONG_PEARSON);
  assertEquals(result.exceeds_strong, true);
  assertEquals(result.exceeds_moderate, true);
  assertEquals(result.has_high_confidence_evidence, true);
  assertEquals(result.grounded_signal_count_a, 20);
  assertEquals(result.grounded_signal_count_b, 20);
  assert(result.evidence_summary.includes("pearson_r="));
  assert(result.evidence_summary.includes("actor-time-grounded"));
  assert(result.most_active_shared_hours.length > 0);
});

Deno.test("computePostingTimeAxis: disjoint activity patterns → no thresholds met", () => {
  // A always at hour 14; B always at hour 2.
  const result = computePostingTimeAxis({
    signalsA: groundedAtHour(15, 14),
    signalsB: groundedAtHour(15, 2),
  });
  assertEquals(result.status, "computed");
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assertEquals(result.has_high_confidence_evidence, false);
});

Deno.test("computePostingTimeAxis: moderate correlation passes moderate but not strong", () => {
  const tsA = [
    "2024-01-01T14:00:00Z", "2024-01-01T15:00:00Z", "2024-01-01T16:00:00Z",
    "2024-01-02T14:00:00Z", "2024-01-02T15:00:00Z", "2024-01-02T16:00:00Z",
    "2024-01-03T14:00:00Z", "2024-01-03T15:00:00Z", "2024-01-03T16:00:00Z",
    "2024-01-04T14:00:00Z", "2024-01-04T15:00:00Z", "2024-01-04T16:00:00Z",
  ].map(g);
  const tsB = [
    "2024-01-01T14:00:00Z", "2024-01-01T15:00:00Z", "2024-01-01T21:00:00Z",
    "2024-01-02T14:00:00Z", "2024-01-02T15:00:00Z", "2024-01-02T22:00:00Z",
    "2024-01-03T14:00:00Z", "2024-01-03T15:00:00Z", "2024-01-03T23:00:00Z",
    "2024-01-04T14:00:00Z", "2024-01-04T15:00:00Z", "2024-01-04T03:00:00Z",
  ].map(g);
  const result = computePostingTimeAxis({ signalsA: tsA, signalsB: tsB });
  assertEquals(result.status, "computed");
  assert(result.pearson_r !== null);
  assert(
    result.pearson_r! >= POSTING_TIME_MODERATE_PEARSON,
    `expected pearson_r ≥ ${POSTING_TIME_MODERATE_PEARSON}, got ${result.pearson_r}`,
  );
});

// ─── G-9: grounding filter behavior ──────────────────────────────────────────

Deno.test("G-9 NEGATIVE CONTROL: two actors with only collection-cadence signals → no evidence", () => {
  // 20 cosmetic-midnight signals each: event_date = UTC midnight of created day.
  // This is the dominant Tier-C pattern (facebook/instagram/etc). The OLD axis
  // would have read created_at and produced a near-1.0 false positive; the new
  // axis must stub because zero signals are actor-time-grounded.
  const cadenceOnly = (): TemporalSignal[] =>
    Array.from({ length: 20 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      return {
        created_at: `2024-02-${day}T08:00:00Z`,
        event_date: `2024-02-${day}T00:00:00Z`, // cosmetic midnight of created day
      };
    });
  const result = computePostingTimeAxis({ signalsA: cadenceOnly(), signalsB: cadenceOnly() });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.grounded_signal_count_a, 0);
  assertEquals(result.grounded_signal_count_b, 0);
  assertEquals(result.n_signals_a, 20); // retrieved count still surfaced
  assertEquals(result.n_signals_b, 20);
  assertEquals(result.exceeds_moderate, false);
  assertEquals(result.exceeds_strong, false);
  assertEquals(result.pearson_r, null);
});

Deno.test("G-9: copied-from-created event_date is excluded", () => {
  const copied = (): TemporalSignal[] =>
    Array.from({ length: 15 }, (_, i) => {
      const iso = `2024-03-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z`;
      return { created_at: iso, event_date: iso }; // event_date === created_at
    });
  const result = computePostingTimeAxis({ signalsA: copied(), signalsB: copied() });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.grounded_signal_count_a, 0);
  assertEquals(result.grounded_signal_count_b, 0);
});

Deno.test("G-9: NULL event_date (created_at only) is excluded", () => {
  const nullEvent = (): TemporalSignal[] =>
    Array.from({ length: 15 }, (_, i) => ({
      created_at: `2024-04-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z`,
      event_date: null,
    }));
  const result = computePostingTimeAxis({ signalsA: nullEvent(), signalsB: nullEvent() });
  assertEquals(result.status, "insufficient_samples");
  assertEquals(result.grounded_signal_count_a, 0);
});

Deno.test("G-9: mixed feed counts only grounded signals toward the floor", () => {
  // 12 grounded + 8 cadence-only per side → 12 grounded ≥ floor → computed.
  const mixed = (hour: number): TemporalSignal[] => [
    ...groundedAtHour(12, hour),
    ...Array.from({ length: 8 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      return { created_at: `2024-05-${day}T08:00:00Z`, event_date: `2024-05-${day}T00:00:00Z` };
    }),
  ];
  const result = computePostingTimeAxis({ signalsA: mixed(14), signalsB: mixed(14) });
  assertEquals(result.status, "computed");
  assertEquals(result.grounded_signal_count_a, 12);
  assertEquals(result.grounded_signal_count_b, 12);
  assertEquals(result.n_signals_a, 20);
});

Deno.test("G-9: explicit temporal_grounding column overrides structural check", () => {
  // event_date == created_at (would be copied/excluded structurally) but the
  // column asserts current_grounded → trusted.
  const colGrounded = (): TemporalSignal[] =>
    Array.from({ length: 12 }, (_, i) => {
      const iso = `2024-06-${String((i % 28) + 1).padStart(2, "0")}T14:00:00Z`;
      return { created_at: iso, event_date: iso, temporal_grounding: "current_grounded" as const };
    });
  const result = computePostingTimeAxis({ signalsA: colGrounded(), signalsB: colGrounded() });
  assertEquals(result.status, "computed");
  assertEquals(result.grounded_signal_count_a, 12);
});

// ─── determinism ─────────────────────────────────────────────────────────────

Deno.test("computePostingTimeAxis: deterministic across runs", () => {
  const ts = Array.from({ length: 30 }, (_, i) =>
    g(`2024-01-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`)
  );
  const r1 = computePostingTimeAxis({ signalsA: ts, signalsB: ts });
  const r2 = computePostingTimeAxis({ signalsA: ts, signalsB: ts });
  assertEquals(r1.pearson_r, r2.pearson_r);
  assertEquals(r1.evidence_summary, r2.evidence_summary);
  assertEquals(r1.grounded_signal_count_a, r2.grounded_signal_count_a);
  assertEquals(JSON.stringify(r1.most_active_shared_hours), JSON.stringify(r2.most_active_shared_hours));
});
