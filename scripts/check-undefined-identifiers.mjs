#!/usr/bin/env node
/**
 * PROD-E regression guard — narrow TS undefined-identifier gate.
 *
 * Runs `tsc -b --noEmit` and filters output for TS2304 ("Cannot find name")
 * and TS2552 ("Cannot find name — did you mean…"). Any hit fails the build.
 *
 * Why this narrow check instead of full --strict typecheck gating:
 *   The codebase carries ~2,667 pre-existing TS errors (mostly TS2339 from
 *   PostgREST SelectQueryError generic-collapse). Cleaning those is a
 *   separate multi-day effort tracked elsewhere. PROD-E
 *   ("useQuery is not defined") was specifically a missing-import / undefined
 *   identifier failure — TS2304. Catching that class alone is the
 *   operational guard installed during the 2026-05-22 stabilization
 *   checkpoint. Do NOT widen this gate without explicit owner approval —
 *   doing so would block every build until the broader cleanup ships.
 *
 * Usage:
 *   node scripts/check-undefined-identifiers.mjs
 *
 * Exit codes:
 *   0 — no TS2304/TS2552 errors found
 *   1 — at least one undefined identifier; offending lines printed
 *   2 — tsc failed to run at all (bad config, missing deps, etc.)
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['tsc', '-b', '--noEmit'], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const combined = (result.stdout || '') + (result.stderr || '');

// tsc -b returning non-zero is expected today because of the broader 2,667
// pre-existing errors. We only treat it as a meta-failure when there is no
// output at all (genuine spawn / config breakage).
if (!combined.trim()) {
  if (result.status !== 0) {
    console.error('check-undefined-identifiers: tsc produced no output and exited non-zero');
    console.error('  This usually means a tsconfig or dependency problem — not an undefined identifier.');
    process.exit(2);
  }
  console.log('check-undefined-identifiers: no TS output (clean tree) ✓');
  process.exit(0);
}

const offending = combined
  .split('\n')
  .filter((l) => /error TS2304\b|error TS2552\b/.test(l));

if (offending.length === 0) {
  console.log('check-undefined-identifiers: no TS2304/TS2552 errors found ✓');
  process.exit(0);
}

console.error('check-undefined-identifiers: FAIL — undefined identifier(s) detected.');
console.error('This is the PROD-E regression class (missing import / undeclared name).');
console.error('Fix each line below before building:');
console.error();
for (const line of offending) {
  console.error('  ' + line);
}
console.error();
console.error(`Total: ${offending.length} undefined identifier error(s).`);
process.exit(1);
