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

    // Match either:
    //   - object literal style: job_name: 'some-name' or job_name: "some-name"
    //   - shared helper style: startHeartbeat(supabase, 'some-name') or
    //                          recordHeartbeat(supabase, 'some-name', ...)
    const literalMatches = [...src.matchAll(/job_name:\s*['"]([^'"]+)['"]/g)];
    const helperMatches = [...src.matchAll(/(?:start|record)Heartbeat\s*\(\s*\w+\s*,\s*['"]([^'"]+)['"]/g)];
    const unique = [...new Set([...literalMatches, ...helperMatches].map(m => m[1]))];
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

// ── Check 5: Live pg_cron drift (requires SUPABASE_PAT) ───────────────────
// Compares the static schedule manifest from migrations against what is
// actually loaded in pg_cron right now. Catches schedules that were applied
// out-of-band (via SQL Editor) but never made it into a migration, AND
// migrations that were never applied to prod.
//
// Optional — only runs if SUPABASE_PAT or SUPABASE_ACCESS_TOKEN is set.
// CI runs the static-only path; ops/release scripts can opt in to live drift.
console.log('\n── Check 5: Live pg_cron drift (optional) ──');
const livePat = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'kpuqukppbmwebiptqmog';
if (!livePat) {
  console.log('  ⚪ SKIPPED — set SUPABASE_PAT to compare against live pg_cron');
} else {
  try {
    const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${livePat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "SELECT jobname, schedule FROM cron.job WHERE active = true ORDER BY jobname" }),
    });
    if (!resp.ok) {
      console.log(`  ⚠️  Live check API call failed: ${resp.status} ${resp.statusText}`);
      warnings++;
    } else {
      const live = await resp.json();
      const liveByName = new Map(live.map(r => [r.jobname, r.schedule]));
      const manifestNames = new Set(activeByName.keys());

      // In live but not in manifest = applied out-of-band
      const ghostsInLive = [...liveByName.keys()].filter(n => !manifestNames.has(n));
      // In manifest but not in live = migration not applied
      const missingInLive = [...manifestNames].filter(n => !liveByName.has(n));

      let driftFound = false;
      for (const name of ghostsInLive) {
        // Some non-Fortress system jobs are expected (e.g. pg_cron internals)
        // — only flag jobs whose names follow our schedule pattern
        const isFortressJob = /^(monitor-|agent-|knowledge-|self-|watchdog|fortress|thread-|auto-|review-|daily-|generate-|run-|invoke-|process-|scan-|sync-|track-|trigger-|aegis-|wraith-|ingest-|enrich-)/i.test(name);
        if (isFortressJob) {
          console.log(`  ❌ GHOST     '${name}' — exists in pg_cron but no migration declares it`);
          errors++;
          driftFound = true;
        }
      }
      for (const name of missingInLive) {
        console.log(`  ❌ MISSING   '${name}' — declared in migration but not loaded in pg_cron`);
        errors++;
        driftFound = true;
      }
      if (!driftFound) {
        console.log(`  ✅ Live pg_cron matches migration manifest (${liveByName.size} jobs live, ${manifestNames.size} declared)`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Live check error: ${e.message}`);
    warnings++;
  }
}

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
