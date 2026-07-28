// INC-JOBWORKER-SATURATION-2026-07-27 item 3 — evidence (a):
// prove the streaming (per-page) restructure yields IDENTICAL match output to
// matching all entities at once (the pre-refactor behavior).
// Run: deno test entity-correlation_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractEntityNames,
  matchEntitiesInPage,
  normaliseQuotes,
  type EntityMatch,
  type EntityRow,
} from "./entity-correlation.ts";

const TEXT =
  "Coastal GasLink faced a protest today. Sarah Mitchell Roberts spoke for " +
  "Acme Corporation about the pipeline near Houston BC. Roberts Sarah Mitchell " +
  "was also quoted separately.";

// Fixture entities exercising: direct match (e1,e2), multi-word direct (e3),
// cross-check-only match via word-set reorder that mutates extractedNames (e5),
// and a non-match (e4).
const ENTITIES: EntityRow[] = [
  { id: "e1", name: "Coastal GasLink", type: "organization" },
  { id: "e2", name: "Acme Corporation", type: "organization" },
  { id: "e3", name: "Sarah Mitchell Roberts", type: "person" },
  { id: "e4", name: "Nonmatch Industries", type: "organization" },
  { id: "e5", name: "Roberts Sarah Mitchell", type: "person" },
];

// Canonical, order-independent form for comparison.
function canonical(matches: EntityMatch[]): string {
  return JSON.stringify(
    matches
      .map((m) => ({ id: m.entityId, c: m.confidence, on: [...m.matchedOn].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function runWithPages(pageSize: number): { matches: EntityMatch[]; remaining: string[] } {
  const textNorm = normaliseQuotes(TEXT);
  const extractedNames = extractEntityNames(TEXT); // fresh per run — it is mutated
  const matches: EntityMatch[] = [];
  for (let i = 0; i < ENTITIES.length; i += pageSize) {
    matches.push(...matchEntitiesInPage(textNorm, extractedNames, ENTITIES.slice(i, i + pageSize)));
  }
  return { matches, remaining: [...extractedNames].sort() };
}

Deno.test("streaming (pages of 2) == all-at-once (single page)", () => {
  const all = runWithPages(ENTITIES.length); // one page = pre-refactor behavior
  const paged = runWithPages(2);
  assertEquals(canonical(paged.matches), canonical(all.matches), "match sets must be identical");
  assertEquals(paged.remaining, all.remaining, "remaining extracted names must be identical");
});

Deno.test("streaming (pages of 1) == all-at-once", () => {
  const all = runWithPages(ENTITIES.length);
  const paged = runWithPages(1);
  assertEquals(canonical(paged.matches), canonical(all.matches));
  assertEquals(paged.remaining, all.remaining);
});

Deno.test("sanity: expected entities match, non-match excluded", () => {
  const { matches } = runWithPages(ENTITIES.length);
  const ids = matches.map((m) => m.entityId).sort();
  // e1, e2, e3 match directly; e5 matches via cross-check; e4 never matches.
  assertEquals(ids.includes("e1"), true);
  assertEquals(ids.includes("e2"), true);
  assertEquals(ids.includes("e3"), true);
  assertEquals(ids.includes("e4"), false);
});
