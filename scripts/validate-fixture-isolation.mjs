#!/usr/bin/env node
// scripts/validate-fixture-isolation.mjs
//
// PROD-N Tranche A (2026-05-22) — fixture-isolation soft-warn CI invariant.
//
// Scans supabase/functions/monitor-*/index.ts for `from('clients')` call
// sites and classifies each:
//
//   PASS — single-id lookup     : `.eq('id', ...)` within 5 lines after
//   PASS — explicit filter      : `.not('name', 'like'/'ilike', ...)` within 10 lines
//   PASS — exempt               : `// fixture-isolation:exempt: <reason>` within 3 lines
//   PASS — uses helper (weak)   : file imports `pickActiveClients` (file-level
//                                  heuristic, transparently weak — flagged in
//                                  output so promotion to hard-error doesn't
//                                  rely on it)
//   WARN — uncovered iteration  : none of the above
//
// SOFT-WARN MODE (Tranche A): warnings are reported with file:line numbers
// but exit code is 0. Hard-error promotion is tracked under PROD-N tech
// debt #232 and requires (a) all in-priority-order monitor-* functions
// migrated to pickActiveClients AND (b) the "uses helper" heuristic
// upgraded from file-level import-presence to per-call-site AST trace.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(REPO_ROOT, 'supabase', 'functions');

const EXIT_ON_WARN = false; // Tranche A: soft-warn. See task #232 for promotion.

const FROM_CLIENTS_RE = /from\(['"]clients['"]\)/g;
const SINGLE_ID_RE = /\.eq\(\s*['"]id['"]/;
const EXPLICIT_NAME_FILTER_RE = /\.not\(\s*['"]name['"]\s*,\s*['"](?:like|ilike)['"]/;
const EXEMPT_MARKER_RE = /\/\/\s*fixture-isolation:exempt(?::\s*\S.*)?/;
const HELPER_IMPORT_RE = /from\s+["'][^"']*pick-active-clients[^"']*["']/;

function listMonitorFiles() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter(d => d.startsWith('monitor-'))
    .map(d => path.join(FUNCTIONS_DIR, d, 'index.ts'))
    .filter(p => fs.existsSync(p))
    .sort();
}

function classify(content, lines, callLineIdx, hasHelperImport) {
  // Look ahead up to 10 lines for explicit filter or single-id lookup.
  const lookahead = lines.slice(callLineIdx, Math.min(lines.length, callLineIdx + 10)).join('\n');
  if (SINGLE_ID_RE.test(lookahead)) return { pass: true, reason: 'single-id lookup' };
  if (EXPLICIT_NAME_FILTER_RE.test(lookahead)) return { pass: true, reason: 'explicit name filter' };

  // Look back 3 lines for exemption comment.
  const lookback = lines.slice(Math.max(0, callLineIdx - 3), callLineIdx + 1).join('\n');
  if (EXEMPT_MARKER_RE.test(lookback)) return { pass: true, reason: 'fixture-isolation:exempt marker' };

  // File-level helper-import fallback. Transparently weak.
  if (hasHelperImport) return { pass: true, reason: 'pickActiveClients imported (weak file-level signal)' };

  return { pass: false, reason: 'uncovered iteration — no fixture filter detected' };
}

function scan() {
  console.log('── PROD-N Tranche A — fixture-isolation soft-warn ──\n');

  const files = listMonitorFiles();
  if (files.length === 0) {
    console.log('  (no monitor-* functions found)');
    return 0;
  }

  let pass = 0;
  let warn = 0;
  let callSites = 0;
  let filesWithCalls = 0;

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const hasHelperImport = HELPER_IMPORT_RE.test(content);

    let fileHadCall = false;
    for (let i = 0; i < lines.length; i++) {
      FROM_CLIENTS_RE.lastIndex = 0;
      if (!FROM_CLIENTS_RE.test(lines[i])) continue;
      callSites++;
      fileHadCall = true;

      const verdict = classify(content, lines, i, hasHelperImport);
      const marker = verdict.pass ? '✅ PASS' : '⚪ WARN';
      console.log(`  ${marker}  ${rel}:${i + 1}  (${verdict.reason})`);
      if (verdict.pass) pass++; else warn++;
    }
    if (fileHadCall) filesWithCalls++;
  }

  console.log(`\nSummary: ${pass} pass | ${warn} warn (of ${callSites} from('clients') call sites in ${filesWithCalls} monitor-* files)`);

  if (warn > 0) {
    console.log('\nPhase Tranche A: soft-warn mode. EXIT_ON_WARN=false. Exit 0.');
  }

  console.log('\n⚠ Heuristic limitations (acceptable in Tranche A, blocking promotion):');
  console.log('  - "uses helper" check is file-level (import-presence). A file may');
  console.log('    import pickActiveClients and still call from(\'clients\') directly');
  console.log('    elsewhere. PR review catches this; CI does not.');
  console.log('  - Promotion to hard-error requires per-call-site usage tracing.');
  console.log('  - Tracked under PROD-N tech debt #232.');

  return EXIT_ON_WARN && warn > 0 ? 1 : 0;
}

process.exit(scan());
