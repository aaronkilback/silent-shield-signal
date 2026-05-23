#!/usr/bin/env node
/**
 * Branch 2A.5 (optional) — audit-only `.from('signals').single()` detector.
 *
 * AUDIT-ONLY: exits 0 always. No --enforce flag yet. This is a leading-
 * indicator surfacing tool — Branch 1A converted analyst-facing signal point
 * lookups from `.single()` to `.maybeSingle()` because the quarantine doctrine
 * requires denied responses to be indistinguishable from row-not-found, and
 * `.single()` throws PostgrestError 406 on empty result (which leaks existence
 * via the error path). This detector watches for regressions reintroducing
 * `.single()` on the signals table.
 *
 * Operator/diagnostic surfaces may legitimately use `.single()` because they
 * have intentional access to quarantined rows. Annotate those with:
 *   // @qa-allow:signal-single <reason>
 *
 * Usage:
 *   node scripts/check-signal-single-regression.mjs
 *
 * Exit codes:
 *   0 — always (audit-only); printed findings require human review
 *   2 — script error
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'supabase/functions'];
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.turbo',
  'playwright-report', 'test-results', 'coverage', '.lovable', 'docs',
]);
const EXCLUDE_FILES = new Set([
  'scripts/check-signal-single-regression.mjs',
]);

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');

const ALLOW_RE = /@qa-allow:signal-single(?:\s+([A-Za-z0-9_\-]+))?/;

// Match `.from('signals')` ... `.single()` within a 400-char window.
// Limited window keeps regex bounded; signal-row chains rarely exceed it.
// `.single()` is case-sensitive and `.maybeSingle()` is excluded by the
// capitalization rule (`.maybeSingle` contains uppercase S after the dot
// in `Single`, while this regex requires lowercase `single` right after
// the dot — so it cannot match inside `.maybeSingle(`).
const FROM_SIGNALS_RE = /\.from\s*\(\s*['"`]signals['"`]\s*\)/g;
const SINGLE_RE = /\.single\s*\(\s*\)/;
// Limited tail window — must not include another `.from('` (would mean a
// later, unrelated chain).
const TAIL_WINDOW = 400;

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.eslintrc') continue;
    if (EXCLUDE_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    const rel = relative(REPO_ROOT, full);
    if (EXCLUDE_FILES.has(rel)) continue;
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && /\.(ts|tsx|mjs|js|jsx)$/.test(ent.name)) out.push(full);
  }
}

async function scanFile(absPath) {
  let body;
  try { body = await readFile(absPath, 'utf-8'); } catch { return []; }
  const lines = body.split('\n');
  const findings = [];
  FROM_SIGNALS_RE.lastIndex = 0;
  let m;
  while ((m = FROM_SIGNALS_RE.exec(body)) !== null) {
    const start = m.index;
    const tail = body.slice(start, start + TAIL_WINDOW);
    // Exclude if another .from('...') appears in the tail — that means the
    // current chain ended before reaching the next .from, and the .single()
    // (if any) belongs to a later chain.
    const nextFrom = tail.slice(m[0].length).search(/\.from\s*\(/);
    const truncatedTail = nextFrom === -1 ? tail : tail.slice(0, m[0].length + nextFrom);
    if (!SINGLE_RE.test(truncatedTail)) continue;

    // Compute line for the `.from('signals')` occurrence.
    const lineNum = body.slice(0, start).split('\n').length;
    const lineText = lines[lineNum - 1] ?? '';
    const prevLineText = lineNum >= 2 ? lines[lineNum - 2] : '';
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const inlineAllow = ALLOW_RE.exec(lineText) || ALLOW_RE.exec(prevLineText);
    findings.push({
      file: relative(REPO_ROOT, absPath),
      line: lineNum,
      text: lineText.trim().slice(0, 200),
      allowed: Boolean(inlineAllow),
      allow_reason: inlineAllow?.[1] ?? null,
    });
  }
  return findings;
}

async function main() {
  const files = [];
  for (const root of SCAN_ROOTS) await walk(join(REPO_ROOT, root), files);
  const all = (await Promise.all(files.map(scanFile))).flat();
  const unallowed = all.filter((f) => !f.allowed);
  const allowed = all.filter((f) => f.allowed);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      mode: 'audit',
      total: all.length,
      unallowed: unallowed.length,
      allowed: allowed.length,
      findings: all,
    }, null, 2));
  } else {
    console.log(`check-signal-single-regression: mode=audit scanned=${files.length} files`);
    console.log(`  total .from('signals').single() chains: ${all.length}`);
    console.log(`  un-annotated:                            ${unallowed.length}`);
    console.log(`  annotated (allow):                       ${allowed.length}`);
    if (unallowed.length > 0) {
      console.log('\nUN-ANNOTATED FINDINGS (analyst-facing paths must use .maybeSingle()):');
      for (const f of unallowed) {
        console.log(`  ${f.file}:${f.line}`);
        console.log(`      ${f.text}`);
      }
    }
    if (allowed.length > 0) {
      console.log(`\nANNOTATED (operator/diagnostic surfaces):`);
      for (const f of allowed) {
        console.log(`  ${f.file}:${f.line}  allow=${f.allow_reason ?? '(no key)'}`);
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('check-signal-single-regression: script error', err);
  process.exit(2);
});
