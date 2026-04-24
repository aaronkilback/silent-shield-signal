#!/usr/bin/env node
/**
 * validate-cron-alignment.mjs
 *
 * Checks three things:
 *   1. Every edge function that writes a cron_heartbeat has a matching entry
 *      in a migration's cron.schedule() call — pg_cron job name = heartbeat name
 *   2. No duplicate cron.schedule() calls target the same function URL
 *   3. Every cron.schedule() job name matches what the function writes to heartbeat
 *      (catches the "half-built" naming drift that caused the April 10 incident)
 *
 * Run: node scripts/validate-cron-alignment.mjs
 * Exit 0 = all good, Exit 1 = problems found
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const FUNCTIONS_DIR = join(ROOT, 'supabase/functions');
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');

// ── Step 1: Extract heartbeat job_name from each function ──────────────────

function extractHeartbeatNames(fnDir) {
  const results = []; // { function, jobName }
  const dirs = readdirSync(fnDir).filter(d => {
    try { return statSync(join(fnDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const indexPath = join(fnDir, dir, 'index.ts');
    let src;
    try { src = readFileSync(indexPath, 'utf8'); } catch { continue; }

    // Match: job_name: 'some-name' or job_name: "some-name"
    const matches = [...src.matchAll(/job_name:\s*['"]([^'"]+)['"]/g)];
    const unique = [...new Set(matches.map(m => m[1]))];
    for (const jobName of unique) {
      results.push({ function: dir, jobName });
    }
  }
  return results;
}

// ── Step 2: Extract all cron.schedule() job names from migrations ──────────

function extractCronSchedules(migrationsDir) {
  const results = []; // { migration, jobName, url }
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const src = readFileSync(join(migrationsDir, file), 'utf8');

    // Match: cron.schedule( 'job-name', '...schedule...', $$ ... url := 'https://...' ... $$
    const scheduleBlocks = [...src.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/g)];
    const urlMatches = [...src.matchAll(/url\s*:=\s*'([^']+)'/g)];

    // Simple approach: pair them up by order within the file
    let urlIdx = 0;
    for (const match of scheduleBlocks) {
      const jobName = match[1];
      // Find the url that comes after this schedule call
      const schedulePos = match.index;
      const nextUrl = urlMatches.find(u => u.index > schedulePos);
      const url = nextUrl ? nextUrl[1] : null;
      // Extract function name from URL path
      const fnName = url ? url.replace(/.*\/functions\/v1\//, '') : null;
      results.push({ migration: file, jobName, url, fnName });
      urlIdx++;
    }
  }
  return results;
}

// ── Step 3: Extract cron.unschedule() to find removed jobs ─────────────────
// A job is only considered "removed" if it is unscheduled in a migration that does NOT
// also reschedule it (i.e. the "unschedule then reschedule" safety-guard pattern in
// the same file is NOT treated as a removal).

function extractUnscheduled(migrationsDir) {
  const removed = new Set();
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const src = readFileSync(join(migrationsDir, file), 'utf8');
    const unscheduled = [...src.matchAll(/cron\.unschedule\s*\(\s*'([^']+)'/g)].map(m => m[1]);
    const rescheduled = new Set([...src.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/g)].map(m => m[1]));
    // Only mark as removed if this file does not also reschedule the same job
    for (const name of unscheduled) {
      if (!rescheduled.has(name)) removed.add(name);
    }
  }
  return removed;
}

// ── Main ───────────────────────────────────────────────────────────────────

const heartbeats = extractHeartbeatNames(FUNCTIONS_DIR);
const scheduled = extractCronSchedules(MIGRATIONS_DIR);
const unscheduled = extractUnscheduled(MIGRATIONS_DIR);

// Active scheduled jobs (not later unscheduled)
const activeScheduled = scheduled.filter(s => !unscheduled.has(s.jobName));

// Dedup: keep only the last schedule entry per job name (later migrations win)
const activeByName = new Map();
for (const s of activeScheduled) {
  activeByName.set(s.jobName, s);
}

// Build lookup: function name → set of active cron job names
const cronByFunction = new Map();
for (const [jobName, s] of activeByName) {
  if (!s.fnName) continue;
  if (!cronByFunction.has(s.fnName)) cronByFunction.set(s.fnName, new Set());
  cronByFunction.get(s.fnName).add(jobName);
}

let errors = 0;
let warnings = 0;

console.log('\n=== FORTRESS CRON ALIGNMENT VALIDATION ===\n');

// ── Check 1: Heartbeat name matches a cron job name ────────────────────────
console.log('── Check 1: Heartbeat name matches cron job name ──');
for (const { function: fn, jobName } of heartbeats) {
  const cronJobs = cronByFunction.get(fn);
  if (!cronJobs) {
    console.log(`  ❌ MISS   ${fn}: writes heartbeat '${jobName}' but NO cron schedule found for this function`);
    errors++;
  } else if (!cronJobs.has(jobName)) {
    const actual = [...cronJobs].join(', ');
    console.log(`  ❌ MISMATCH  ${fn}:`);
    console.log(`       heartbeat writes: '${jobName}'`);
    console.log(`       cron schedules:   ${actual}`);
    errors++;
  } else {
    console.log(`  ✅ OK      ${fn}: '${jobName}'`);
  }
}

// ── Check 2: Duplicate cron schedules targeting same function ──────────────
// Some functions intentionally have multiple schedules at different frequencies
// (e.g., ingest-world-knowledge runs daily for regular updates AND weekly for
// a larger deep-sweep). Add known intentional multi-schedule functions here.
const INTENTIONAL_MULTI_SCHEDULE = new Set([
  'ingest-world-knowledge', // daily light sweep + weekly deep sweep
]);

console.log('\n── Check 2: Duplicate cron schedules for same function ──');
const dupeCheck = new Map();
for (const [jobName, s] of activeByName) {
  if (!s.fnName) continue;
  if (!dupeCheck.has(s.fnName)) dupeCheck.set(s.fnName, []);
  dupeCheck.get(s.fnName).push(jobName);
}
let dupesFound = false;
for (const [fn, jobs] of dupeCheck) {
  if (jobs.length > 1) {
    if (INTENTIONAL_MULTI_SCHEDULE.has(fn)) {
      console.log(`  ✅ OK (intentional multi-schedule)  ${fn}: ${jobs.join(', ')}`);
      continue;
    }
    console.log(`  ⚠️  DUPLICATE  ${fn} has ${jobs.length} active cron jobs:`);
    for (const j of jobs) console.log(`       - ${j}`);
    warnings++;
    dupesFound = true;
  }
}
if (!dupesFound) console.log('  ✅ No unexpected duplicates found');

// ── Check 3: Orphaned cron jobs (no matching function) ────────────────────
console.log('\n── Check 3: Cron jobs with no matching function directory ──');
const functionDirs = new Set(readdirSync(FUNCTIONS_DIR).filter(d => {
  try { return statSync(join(FUNCTIONS_DIR, d)).isDirectory(); } catch { return false; }
}));
let orphansFound = false;
for (const [jobName, s] of activeByName) {
  if (s.fnName && !functionDirs.has(s.fnName)) {
    console.log(`  ⚠️  ORPHAN  '${jobName}' targets '${s.fnName}' — function directory not found`);
    warnings++;
    orphansFound = true;
  }
}
if (!orphansFound) console.log('  ✅ All cron jobs target existing functions');

// ── Check 4: Deprecated serve() entry point (must be Deno.serve) ──────────
// Using serve(async...) instead of Deno.serve(async...) causes WORKER_ERROR
// on the current Supabase edge runtime. Functions deployed with the old pattern
// will fail silently until redeployed — at which point they break in production.
console.log('\n── Check 4: Deprecated serve() entry point ──');
const allFunctionDirs = readdirSync(FUNCTIONS_DIR).filter(d => {
  try { return statSync(join(FUNCTIONS_DIR, d)).isDirectory(); } catch { return false; }
});
let deprecatedServeFound = false;
for (const dir of allFunctionDirs) {
  if (dir === '_shared') continue;
  const indexPath = join(FUNCTIONS_DIR, dir, 'index.ts');
  let src;
  try { src = readFileSync(indexPath, 'utf8'); } catch { continue; }
  if (/^serve\s*\(async/m.test(src)) {
    console.log(`  ❌ DEPRECATED  ${dir}: uses serve() — must be Deno.serve()`);
    errors++;
    deprecatedServeFound = true;
  }
}
if (!deprecatedServeFound) console.log('  ✅ All functions use Deno.serve()');

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
console.log(`  ${heartbeats.length} monitored functions checked`);
console.log(`  ${activeByName.size} active cron jobs`);
console.log(`  ${errors} error(s)  |  ${warnings} warning(s)`);
console.log('═══════════════════════════════════════════\n');

if (errors > 0) {
  console.log('RESULT: ❌ FAIL — fix mismatches before deploying\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('RESULT: ⚠️  PASS WITH WARNINGS\n');
} else {
  console.log('RESULT: ✅ PASS\n');
}
