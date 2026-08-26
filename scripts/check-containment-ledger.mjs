#!/usr/bin/env node
// check-containment-ledger.mjs — reconcile the INC-AITOOLS-XTENANT containment ledger against reality.
//
// WHY: on 2026-08-05 the ledger (WO-CHECK5-BURNDOWN-01) documented 17 of 19 actual 503 stubs —
// entity-deep-scan + correlate-entities were contained in code but never listed. A ledger that
// undercounts what's disabled hides dead capability (the POI workflow was off for a week, unnoticed).
// This check fails CI when the set of 503-containment stubs in supabase/functions/ diverges from the
// set documented in the ledger, forcing the ledger to be updated whenever a function is contained OR restored.
//
// Documented set  = LOG A table rows (| N | fn | …) + the "Batch 1 outcome" CONTAINED (503,…) line.
// Actual set      = small index.ts files (<= MAX_STUB_LINES) carrying a containment marker + a 503 response.
// Exit 0 iff the two sets match exactly; else exit 1 and print the diff.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCS = join(root, 'supabase', 'functions');
const LEDGER = join(root, 'docs', 'platform-operations', 'backlog', 'WO-CHECK5-BURNDOWN-01.md');
const MAX_STUB_LINES = 40;
const MARKER = /(security containment|CONTAINED 2026-07-31|HARD-DISABLED|disabled for security)/;

// ── actual: scan functions for 503 containment stubs ──
const actual = new Set();
for (const name of readdirSync(FUNCS)) {
  const idx = join(FUNCS, name, 'index.ts');
  if (!existsSync(idx) || !statSync(idx).isFile()) continue;
  const src = readFileSync(idx, 'utf8');
  const lines = src.split('\n').length;
  // Disabled-containment stub = small file + containment marker + a hard-disable status (503 for the
  // INC-AITOOLS-XTENANT batch; 403 for query-fortress-data / Generic Tool Path Clearance).
  if (lines <= MAX_STUB_LINES && MARKER.test(src) && /\b(403|503)\b/.test(src)) actual.add(name);
}

// ── documented: parse the ledger ──
const md = readFileSync(LEDGER, 'utf8');
const documented = new Set();
for (const m of md.matchAll(/^\|\s*\d+\s*\|\s*`?([a-z0-9][a-z0-9-]+)`?\s*\|/gm)) documented.add(m[1]);
const batch1 = md.match(/CONTAINED \(503[^\n]*\n?[^\n]*/i);
if (batch1) for (const m of batch1[0].matchAll(/\b([a-z][a-z0-9-]+)\s*\(v\d+\)/g)) documented.add(m[1]);

// ── diff ──
const missingFromLedger = [...actual].filter((f) => !documented.has(f)).sort(); // contained but undocumented
const staleInLedger = [...documented].filter((f) => !actual.has(f)).sort();      // documented but no longer a stub (restored?)

console.log(`Containment ledger reconciliation`);
console.log(`  actual 503 stubs in code : ${actual.size}`);
console.log(`  documented in ledger     : ${documented.size}`);

let ok = true;
if (missingFromLedger.length) {
  ok = false;
  console.error(`\n✗ ${missingFromLedger.length} function(s) CONTAINED in code but NOT in the ledger — add to WO-CHECK5-BURNDOWN-01 LOG A:`);
  for (const f of missingFromLedger) console.error(`    - ${f}`);
}
if (staleInLedger.length) {
  ok = false;
  console.error(`\n✗ ${staleInLedger.length} function(s) in the ledger are NO LONGER 503 stubs (restored/removed?) — reconcile the ledger:`);
  for (const f of staleInLedger) console.error(`    - ${f}`);
}
if (ok) { console.log(`\n✅ PASS — ledger matches the ${actual.size} contained stubs in code.`); process.exit(0); }
console.error(`\nFAIL — the containment ledger is out of sync with the code. Update WO-CHECK5-BURNDOWN-01.`);
process.exit(1);
