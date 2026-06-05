/**
 * Golden Contradiction Test — Threat Metrics Aggregator (P1.1)
 *
 * Fixture is the REAL prod tenant feff5c44 (Petronas/energy) 24h population,
 * captured read-only on 2026-06-05. Severities/types are exact; ids are the
 * 8-char prefixes only (no internal UUIDs in the test).
 *
 * Purpose:
 *  1. Prove the canonical reducer computes the CORRECT picture (0 critical, 1 high).
 *  2. Codify the CURRENT divergence — the COP-style tally (no pattern/quarantine
 *     filter) reports 1 critical / 3 high from the same rows — so any drift back
 *     toward counting projections as observations fails this test.
 *
 * Run: deno test supabase/functions/_shared/threat-metrics.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCountableObservation,
  tallySeverities,
  type CountableSignalRow,
} from "./threat-metrics.ts";

// The 7 real rows (tenant feff5c44, 24h, 2026-06-05). 3 of them are pattern projections.
const PROD_FIXTURE: (CountableSignalRow & { id8: string })[] = [
  { id8: "fa68737b", severity: "critical", signal_type: "pattern",    quality_status: "active", is_test: false, status: "new" },
  { id8: "919fa30c", severity: "high",     signal_type: "pattern",    quality_status: "active", is_test: false, status: "new" },
  { id8: "811c4ae0", severity: "high",     signal_type: "pattern",    quality_status: "active", is_test: false, status: "new" },
  { id8: "d3e87a15", severity: "high",     signal_type: "regulatory", quality_status: "active", is_test: false, status: "new" },
  { id8: "a1759790", severity: "low",      signal_type: null,         quality_status: "active", is_test: false, status: "triaged" },
  { id8: "d1ae7778", severity: "medium",   signal_type: "regulatory", quality_status: "active", is_test: false, status: "new" },
  { id8: "fad8bb39", severity: "medium",   signal_type: "regulatory", quality_status: "active", is_test: false, status: "new" },
];

/** Replica of the COP-style tally: severity in (crit,high), is_test=false, NO
 *  pattern/quarantine exclusion. This is the path that fed the bad voice answer. */
function copStyleTally(rows: CountableSignalRow[]) {
  const cands = rows.filter((r) => r.is_test !== true && ["critical", "high"].includes((r.severity ?? "").toLowerCase()));
  return {
    critical: cands.filter((r) => r.severity === "critical").length,
    high: cands.filter((r) => r.severity === "high").length,
  };
}

Deno.test("canonical: pattern projections are NOT countable observations", () => {
  assertEquals(isCountableObservation(PROD_FIXTURE[0]), false); // critical pattern
  assertEquals(isCountableObservation(PROD_FIXTURE[3]), true);  // real regulatory high
});

Deno.test("canonical: true tenant picture is 0 critical / 1 high / 2 medium / 1 low", () => {
  const m = tallySeverities(PROD_FIXTURE);
  assertEquals(m.by_severity, { critical: 0, high: 1, medium: 2, low: 1 });
  assertEquals(m.total, 4); // 7 minus the 3 pattern projections
});

Deno.test("GOLDEN CONTRADICTION: COP-style tally reports 1/3, canonical reports 0/1", () => {
  const cop = copStyleTally(PROD_FIXTURE);
  const canon = tallySeverities(PROD_FIXTURE).by_severity;
  assertEquals(cop, { critical: 1, high: 3 });               // what the operator saw (75% projections)
  assertEquals({ critical: canon.critical, high: canon.high }, { critical: 0, high: 1 }); // the truth
  // The contradiction is real and quantified: +1 phantom critical, +2 phantom high.
});

Deno.test("canonical: quarantined and test rows are excluded", () => {
  const withNoise: CountableSignalRow[] = [
    ...PROD_FIXTURE,
    { severity: "critical", signal_type: "regulatory", quality_status: "quarantined", is_test: false, status: "new" },
    { severity: "critical", signal_type: "regulatory", quality_status: "active", is_test: true, status: "new" },
  ];
  // Both extra criticals must be excluded; canonical critical stays 0.
  assertEquals(tallySeverities(withNoise).by_severity.critical, 0);
});

Deno.test("canonical: closed signals (false_positive/archived) are excluded", () => {
  const closed: CountableSignalRow = { severity: "critical", signal_type: "regulatory", quality_status: "active", is_test: false, status: "false_positive" };
  assertEquals(isCountableObservation(closed), false);
});
