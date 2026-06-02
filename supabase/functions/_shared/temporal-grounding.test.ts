// Deno tests for the shared actor-time grounding primitive (G-9). Run with:
//   deno test supabase/functions/_shared/temporal-grounding.test.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isActorTimeGrounded,
  groundedActorTime,
  isCosmeticMidnight,
  isCopiedFromCreated,
  type TemporalSignal,
} from "./temporal-grounding.ts";

// ─── structural detectors ────────────────────────────────────────────────────

Deno.test("isCosmeticMidnight: midnight UTC of created day → true", () => {
  const created = Date.parse("2024-01-05T08:00:00Z");
  assert(isCosmeticMidnight(Date.parse("2024-01-05T00:00:00Z"), created));
});

Deno.test("isCosmeticMidnight: real intraday time on created day → false", () => {
  const created = Date.parse("2024-01-05T08:00:00Z");
  assertEquals(isCosmeticMidnight(Date.parse("2024-01-05T14:23:00Z"), created), false);
});

Deno.test("isCosmeticMidnight: midnight of a DIFFERENT day is not cosmetic", () => {
  // A real historical event genuinely at midnight, days before ingestion.
  const created = Date.parse("2024-01-10T08:00:00Z");
  assertEquals(isCosmeticMidnight(Date.parse("2024-01-05T00:00:00Z"), created), false);
});

Deno.test("isCopiedFromCreated: equal timestamps → true", () => {
  const t = Date.parse("2024-01-05T14:00:00Z");
  assert(isCopiedFromCreated(t, t));
});

Deno.test("isCopiedFromCreated: 30-min latency → false", () => {
  const created = Date.parse("2024-01-05T14:30:00Z");
  const event = Date.parse("2024-01-05T14:00:00Z");
  assertEquals(isCopiedFromCreated(event, created), false);
});

// ─── canonical hierarchy ─────────────────────────────────────────────────────

Deno.test("isActorTimeGrounded: column current_grounded wins even if event==created", () => {
  const s: TemporalSignal = {
    created_at: "2024-01-05T14:00:00Z",
    event_date: "2024-01-05T14:00:00Z",
    temporal_grounding: "current_grounded",
  };
  assert(isActorTimeGrounded(s));
  assertEquals(groundedActorTime(s), "2024-01-05T14:00:00Z");
});

Deno.test("isActorTimeGrounded: column 'unknown' = no determination → falls through to structural", () => {
  // 'unknown' is the schema default (100% of prod today) — "no determination
  // made", NOT an assertion that the signal is ungrounded. It must fall through
  // to the structural event_date check; here event_date is real (30-min latency,
  // not cosmetic, not copied) so the signal IS grounded.
  const s: TemporalSignal = {
    created_at: "2024-01-05T14:30:00Z",
    event_date: "2024-01-05T14:00:00Z",
    temporal_grounding: "unknown",
  };
  assertEquals(isActorTimeGrounded(s), true);
  assertEquals(groundedActorTime(s), "2024-01-05T14:00:00Z");
});

Deno.test("isActorTimeGrounded: 'unknown' + cosmetic/NULL event_date → still not grounded (structural rejects)", () => {
  // Fall-through to structural must still reject write-artifact / missing event_date.
  assertEquals(isActorTimeGrounded({
    created_at: "2024-01-05T08:00:00Z", event_date: "2024-01-05T00:00:00Z", temporal_grounding: "unknown",
  }), false); // cosmetic-midnight
  assertEquals(isActorTimeGrounded({
    created_at: "2024-01-05T08:00:00Z", event_date: null, temporal_grounding: "unknown",
  }), false); // no event_date
});

Deno.test("isActorTimeGrounded: column inferred → not grounded", () => {
  for (const tg of ["current_inferred", "historical_inferred"] as const) {
    const s: TemporalSignal = {
      created_at: "2024-01-05T14:30:00Z",
      event_date: "2024-01-05T14:00:00Z",
      temporal_grounding: tg,
    };
    assertEquals(isActorTimeGrounded(s), false);
  }
});

Deno.test("isActorTimeGrounded: structural fallback grounds a real late-collected event", () => {
  // No column; event_date is real, 17h before ingestion. Honest-but-late MUST
  // remain grounded — we bucket on event_date, so latency does not corrupt it.
  const s: TemporalSignal = {
    created_at: "2024-01-06T07:00:00Z",
    event_date: "2024-01-05T14:00:00Z",
  };
  assert(isActorTimeGrounded(s));
  assertEquals(groundedActorTime(s), "2024-01-05T14:00:00Z");
});

Deno.test("isActorTimeGrounded: NULL / unparseable event_date → not grounded", () => {
  assertEquals(isActorTimeGrounded({ created_at: "2024-01-05T14:30:00Z", event_date: null }), false);
  assertEquals(isActorTimeGrounded({ created_at: "2024-01-05T14:30:00Z", event_date: "not-a-date" }), false);
});

Deno.test("isActorTimeGrounded: cosmetic-midnight + copied are rejected structurally", () => {
  assertEquals(
    isActorTimeGrounded({ created_at: "2024-01-05T08:00:00Z", event_date: "2024-01-05T00:00:00Z" }),
    false,
  );
  assertEquals(
    isActorTimeGrounded({ created_at: "2024-01-05T14:00:00Z", event_date: "2024-01-05T14:00:00Z" }),
    false,
  );
});
