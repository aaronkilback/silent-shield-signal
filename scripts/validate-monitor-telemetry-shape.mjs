#!/usr/bin/env node
// scripts/validate-monitor-telemetry-shape.mjs
//
// PROD-N Phase 1 (2026-05-22) — telemetry-shape soft-warn CI invariant.
//
// Verifies every supabase/functions/monitor-*/index.ts that writes
// `signals_created` in its heartbeat completion ALSO writes the typed
// telemetry shape defined in supabase/functions/_shared/monitor-telemetry-shape.ts:
//
//   - rejection_counters  (object)
//   - queries_executed    (number)
//   - distinct_clients_iterated (number)
//   - fixture_clients_iterated  (string[])
//
// SOFT-WARN MODE (Phase 1): warnings are reported but exit code is 0.
// Hard-error promotion is a tracked follow-up; flip EXIT_ON_WARN to
// true once all monitors have converged to the shape.
//
// REQUIRED_FIELDS must stay in sync with the TypeScript contract in
// supabase/functions/_shared/monitor-telemetry-shape.ts. Adding a
// field to the contract WITHOUT updating this list will produce a
// false ✅ OK.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(REPO_ROOT, 'supabase', 'functions');

// Keep in sync with MonitorTelemetry in _shared/monitor-telemetry-shape.ts
const REQUIRED_FIELDS = [
  'rejection_counters',
  'queries_executed',
  'distinct_clients_iterated',
  'fixture_clients_iterated',
];

const EXIT_ON_WARN = false; // PROD-N Phase 1: soft warn. Promote later.

/**
 * Does the file call completeHeartbeat / recordHeartbeat with a
 * payload that mentions `signals_created`? If so, it's a monitor
 * that's expected to emit the full typed shape.
 */
function writesSignalsCreatedInHeartbeat(content) {
  // Match the heartbeat-completion verb + a payload containing
  // signals_created within the next ~600 chars. The 's' flag lets
  // '.' match newlines so multi-line payloads are caught.
  return /(?:completeHeartbeat|recordHeartbeat)\s*\([\s\S]{0,600}\bsignals_created\b/m.test(content);
}

/**
 * Cheap heuristic: does the field name appear anywhere in the file?
 * Phase 1 accepts a presence check. Phase 2 may tighten to require
 * the field to be written into the heartbeat payload specifically.
 */
function fileMentionsField(content, field) {
  const re = new RegExp(`\\b${field}\\b`);
  return re.test(content);
}

function listMonitorFiles() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter(d => d.startsWith('monitor-'))
    .map(d => path.join(FUNCTIONS_DIR, d, 'index.ts'))
    .filter(p => fs.existsSync(p))
    .sort();
}

function scan() {
  const files = listMonitorFiles();
  console.log('── PROD-N Phase 1 — monitor telemetry shape soft-warn ──\n');

  if (files.length === 0) {
    console.log('  (no monitor-* functions found)');
    return 0;
  }

  let ok = 0;
  let warn = 0;
  let skipped = 0;

  for (const file of files) {
    const fnName = path.basename(path.dirname(file));
    const content = fs.readFileSync(file, 'utf8');

    if (!writesSignalsCreatedInHeartbeat(content)) {
      console.log(`  ⏭  SKIP  ${fnName} — doesn't write signals_created in heartbeat`);
      skipped++;
      continue;
    }

    const missing = REQUIRED_FIELDS.filter(f => !fileMentionsField(content, f));
    if (missing.length === 0) {
      console.log(`  ✅ OK    ${fnName}`);
      ok++;
    } else {
      console.log(`  ⚪ WARN  ${fnName} — missing: ${missing.join(', ')}`);
      warn++;
    }
  }

  console.log(`\nSummary: ${ok} ok | ${warn} warn | ${skipped} skipped (of ${files.length} monitor-* functions)`);

  if (warn > 0) {
    console.log('\nPhase 1: soft-warn mode. Exit code 0. Once all monitors converge to the shape,');
    console.log('promote EXIT_ON_WARN=true in this script to hard-error on regressions.');
    console.log('\nReference contract: supabase/functions/_shared/monitor-telemetry-shape.ts');
  }

  return EXIT_ON_WARN && warn > 0 ? 1 : 0;
}

process.exit(scan());
