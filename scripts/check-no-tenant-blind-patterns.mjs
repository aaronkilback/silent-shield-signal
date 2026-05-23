#!/usr/bin/env node
/**
 * Branch 2A.1 (P0.2) — Static grep guard for tenant-blind attribution defects.
 *
 * AUDIT-ONLY MODE (default): exit 0 always. Reports findings to stdout so the
 * owner can review false positives before promoting to a blocking CI gate.
 *
 * BLOCKING MODE: pass --enforce. Exit 1 on any finding that is not annotated
 * with an inline allow-comment.
 *
 * Background — defect class this guards against:
 *   The #256 sprint surfaced a recurring family of tenant-blind attribution
 *   defects in monitor/ingest paths:
 *     1. `clients[0]` arbitrary-first-row pick (no ownership invariant).
 *     2. Callers invoking ingest-signal with `client_id: null` and relying on
 *        the now-deleted cross-tenant scoring loop to pick a winner.
 *     3. AI heuristic re-attribution (LLM "best guess" replaces an explicit
 *        ownership invariant — see #256 Phase 1 contract hardening).
 *
 *   Phase 1 hardened ingest-signal to reject on the contract surface. P0.2
 *   adds upstream static enforcement so new callers cannot reintroduce the
 *   tenant-blind pattern without surfacing a finding.
 *
 * Annotation:
 *   Tag intentional / operator-surface exceptions with an inline comment on
 *   the same line OR the line immediately above:
 *     // @qa-allow:tenant-blind <reason-key>
 *
 * Usage:
 *   node scripts/check-no-tenant-blind-patterns.mjs           # audit-only
 *   node scripts/check-no-tenant-blind-patterns.mjs --enforce # blocking
 *   node scripts/check-no-tenant-blind-patterns.mjs --json    # JSON output
 *
 * Exit codes (audit mode):
 *   0 — always.
 * Exit codes (--enforce):
 *   0 — no un-annotated findings.
 *   1 — at least one un-annotated finding.
 *   2 — script error (missing dirs, etc.).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = [
  'supabase/functions',
  'src',
];
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.turbo',
  'playwright-report', 'test-results', 'coverage', '.lovable', 'docs',
]);
// Self-exclusion: this script and its inline patterns must not match itself.
const EXCLUDE_FILES = new Set([
  'scripts/check-no-tenant-blind-patterns.mjs',
]);

const args = new Set(process.argv.slice(2));
const ENFORCE = args.has('--enforce');
const JSON_OUT = args.has('--json');

/**
 * Patterns. Each has a `key`, a `regex`, and a `reason` shown in the report.
 *
 * Intentionally narrow — false-positive minimization is the explicit gate
 * requirement before this can be promoted to --enforce by default.
 */
const PATTERNS = [
  {
    key: 'clients-first-row-pick',
    // Matches `clients[0]`, `clients [0]`, `clients?.[0]`, allowing common
    // PostgrestJS / array-result shapes. Excludes obvious unrelated names by
    // requiring the identifier to be `clients` exactly (not `clientStubs`).
    regex: /(?<![A-Za-z0-9_])clients\s*(\?\s*\.\s*)?\[\s*0\s*\]/g,
    reason: 'arbitrary first-row pick over `clients` array (no ownership invariant). Use explicit lookup or .find(c => c.id === expectedId).',
  },
  {
    key: 'ingest-signal-null-client',
    // Matches `client_id: null` or `clientId: null` inside an object literal.
    // Targets call-sites that explicitly pass a null client (the deleted
    // scoring path). Annotate with @qa-allow:tenant-blind if the call is
    // legitimately a tenant_broadcast site.
    regex: /(?<![A-Za-z0-9_])client_?[iI]d\s*:\s*null\b/g,
    reason: 'explicit `client_id: null` passthrough. #256 Phase 1 rejects this at ingest-signal. If broadcast intent, use tenant_broadcast instead.',
  },
  {
    key: 'first-active-client',
    // Common rephrasing of clients[0]: chained .filter(active).find(0) or
    // .filter(c => c.status === 'active')[0]. Narrow form to avoid noise:
    // `.filter(...)[0]` where the chain mentions `active`.
    regex: /\.filter\([^\)]*active[^\)]*\)\s*\[\s*0\s*\]/g,
    reason: 'first-active-client pick. Same defect class as clients[0] — no ownership invariant.',
  },
];

const ALLOW_RE = /@qa-allow:tenant-blind(?:\s+([A-Za-z0-9_\-]+))?/;

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
    if (ent.isDirectory()) {
      await walk(full, out);
    } else if (ent.isFile()) {
      if (/\.(ts|tsx|mjs|js|jsx)$/.test(ent.name)) {
        out.push(full);
      }
    }
  }
}

async function scanFile(absPath) {
  let body;
  try {
    body = await readFile(absPath, 'utf-8');
  } catch (err) {
    return [];
  }
  const lines = body.split('\n');
  const findings = [];
  for (const pat of PATTERNS) {
    pat.regex.lastIndex = 0;
    let match;
    while ((match = pat.regex.exec(body)) !== null) {
      // Compute line number for this match.
      const before = body.slice(0, match.index);
      const lineNum = before.split('\n').length;
      const lineText = lines[lineNum - 1] ?? '';
      const prevLineText = lineNum >= 2 ? lines[lineNum - 2] : '';

      // Skip pure-comment lines — comments describing historical defects or
      // documentation references are not runtime hazards. Block-comment
      // continuations starting with `*` are also documentation. Lines that
      // contain code AND a trailing comment still match (they're executable).
      const trimmed = lineText.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Allow inline annotation on same line or the line immediately above.
      const inlineAllow = ALLOW_RE.exec(lineText);
      const aboveAllow = ALLOW_RE.exec(prevLineText);
      const allowed = Boolean(inlineAllow || aboveAllow);
      findings.push({
        pattern: pat.key,
        reason: pat.reason,
        file: relative(REPO_ROOT, absPath),
        line: lineNum,
        text: lineText.trim().slice(0, 200),
        allowed,
        allow_reason: (inlineAllow?.[1] || aboveAllow?.[1]) ?? null,
      });
    }
  }
  return findings;
}

async function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    await walk(join(REPO_ROOT, root), files);
  }
  const all = (await Promise.all(files.map(scanFile))).flat();

  const unallowed = all.filter((f) => !f.allowed);
  const allowed = all.filter((f) => f.allowed);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      mode: ENFORCE ? 'enforce' : 'audit',
      total: all.length,
      unallowed: unallowed.length,
      allowed: allowed.length,
      findings: all,
    }, null, 2));
  } else {
    console.log(`check-no-tenant-blind-patterns: mode=${ENFORCE ? 'enforce' : 'audit'} scanned=${files.length} files`);
    console.log(`  total findings:    ${all.length}`);
    console.log(`  un-annotated:      ${unallowed.length}`);
    console.log(`  annotated (allow): ${allowed.length}`);
    if (unallowed.length > 0) {
      console.log('\nUN-ANNOTATED FINDINGS:');
      for (const f of unallowed) {
        console.log(`  [${f.pattern}] ${f.file}:${f.line}`);
        console.log(`      ${f.text}`);
        console.log(`      → ${f.reason}`);
      }
    }
    if (allowed.length > 0) {
      console.log(`\nANNOTATED (allowed) — surface here for periodic audit:`);
      for (const f of allowed) {
        console.log(`  [${f.pattern}] ${f.file}:${f.line}  allow=${f.allow_reason ?? '(no key)'}`);
      }
    }
  }

  if (ENFORCE && unallowed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('check-no-tenant-blind-patterns: script error', err);
  process.exit(2);
});
