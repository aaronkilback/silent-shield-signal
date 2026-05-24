#!/usr/bin/env node
/**
 * Branch 2A.5b (T.4 fold-in) — runtime toast-raw-error detector.
 *
 * AUDIT-ONLY by default. Pass --enforce to fail on un-annotated findings.
 *
 * Background — defect class this guards against:
 *   PROD-T (2026-05-23) surfaced a live production leak of raw OpenAI quota
 *   error text into the Aegis red error toast. Root cause was the global
 *   React Query mutation onError handler in App.tsx piping
 *   `error.message` directly to `toast.error()`. The PROD-T hotfix wrapped
 *   that one site with `redactProviderLeak()`; this detector exists to find
 *   the same shape at any OTHER call site so a future regression cannot
 *   reopen the leak class via a different surface.
 *
 *   The defect class is RUNTIME DATA FLOW, not static source content:
 *   the error.message string is constructed at execution time by Supabase
 *   functions / fetch / RPC handlers and may contain provider envelopes
 *   (OPENAI_API_KEY, "You exceeded your current quota", anthropic_error,
 *   etc.) that classifyUserSafeError / redactProviderLeak should sanitize.
 *   Static-string detectors (check-provider-leak.mjs P0.5) cannot catch
 *   this; only flow-pattern detection can.
 *
 * Patterns matched (HEURISTIC — false positives expected, hence audit-only):
 *   1. toast.error(<ident>.message)            — interpolation of error message
 *   2. toast.error(<ident>)                    — passing whole error/string
 *   3. toast.error(`...${<ident>.message}...`) — template-literal interp
 *
 * Patterns NOT matched (intentional pass-through):
 *   - toast.error("literal string")             — safe, no flow
 *   - toast.error(localizedKey(...))            — wrapped, intent explicit
 *   - toast.error(redactProviderLeak(...))      — already sanitized
 *   - toast.error(classifyUserSafeError(...))   — already sanitized
 *   - Pure comment lines containing the pattern (documentation only)
 *
 * Annotation for intentional exceptions:
 *   // @qa-allow:toast-raw-error <reason-key>
 *
 * Usage:
 *   node scripts/check-toast-raw-error.mjs           # audit (default)
 *   node scripts/check-toast-raw-error.mjs --enforce # blocking CI
 *   node scripts/check-toast-raw-error.mjs --json    # JSON output
 *
 * Exit codes:
 *   0 — audit mode always; enforce mode if no un-annotated findings
 *   1 — enforce mode with un-annotated findings
 *   2 — script error
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
// Frontend-only: toast is a browser-side concern.
const SCAN_ROOTS = ['src'];
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.turbo',
  'playwright-report', 'test-results', 'coverage', '.lovable', 'docs',
]);
const EXCLUDE_FILES = new Set([
  'scripts/check-toast-raw-error.mjs',
]);

const args = new Set(process.argv.slice(2));
const ENFORCE = args.has('--enforce');
const JSON_OUT = args.has('--json');

const ALLOW_RE = /@qa-allow:toast-raw-error(?:\s+([A-Za-z0-9_\-]+))?/;

// Patterns. Each is a regex that captures one defect-class shape.
// All match `toast.error(` followed by a specific argument shape that is
// not pre-sanitized.
const PATTERNS = [
  {
    key: 'toast-error-dot-message',
    // toast.error(error.message) / toast.error(err.message) / toast.error(e.message)
    // Negative lookbehind for `redactProviderLeak(` / `classifyUserSafeError(`
    // is implemented post-match by examining the line text — JS regex
    // doesn't support variable-width lookbehind reliably across runtimes.
    regex: /toast\.error\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\.message\b/g,
    reason: 'Raw `error.message` interpolated into toast. Wrap with redactProviderLeak() (frontend) or classifyUserSafeError() (backend) to prevent provider-text leaks (PROD-T class).',
  },
  {
    key: 'toast-error-bare-ident',
    // toast.error(error) / toast.error(err) / toast.error(e) / toast.error(exception)
    // Restricted to identifiers commonly named after errors to limit FP.
    regex: /toast\.error\s*\(\s*(error|err|e|exception)\s*\)/g,
    reason: 'Whole error object passed to toast (sonner coerces via String()). May leak provider text in error.message. Use redactProviderLeak(err instanceof Error ? err.message : String(err)).',
  },
  {
    key: 'toast-error-template-interp',
    // toast.error(`...${error.message}...`) or toast.error(`...${err.message}...`)
    regex: /toast\.error\s*\(\s*`[^`]*\$\{[^}]*\.message[^}]*\}[^`]*`/g,
    reason: 'Template literal interpolates error.message into toast — same leak class as direct .message pass. Sanitize before interpolation.',
  },
];

// Lines that contain these sanitizer wrappers are explicitly safe; suppress
// findings on those lines even without an @qa-allow annotation.
const SAFE_WRAPPERS = /redactProviderLeak\s*\(|classifyUserSafeError\s*\(/;

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
  for (const pat of PATTERNS) {
    pat.regex.lastIndex = 0;
    let m;
    while ((m = pat.regex.exec(body)) !== null) {
      const lineNum = body.slice(0, m.index).split('\n').length;
      const lineText = lines[lineNum - 1] ?? '';
      const prevLineText = lineNum >= 2 ? lines[lineNum - 2] : '';
      const trimmed = lineText.trim();

      // Skip pure comment lines (documentation references).
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      // Skip if line already wraps with a known sanitizer.
      if (SAFE_WRAPPERS.test(lineText)) continue;

      // Inline annotation suppression.
      const inlineAllow = ALLOW_RE.exec(lineText) || ALLOW_RE.exec(prevLineText);

      findings.push({
        pattern: pat.key,
        reason: pat.reason,
        file: relative(REPO_ROOT, absPath),
        line: lineNum,
        text: trimmed.slice(0, 200),
        allowed: Boolean(inlineAllow),
        allow_reason: inlineAllow?.[1] ?? null,
      });
    }
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
      mode: ENFORCE ? 'enforce' : 'audit',
      total: all.length,
      unallowed: unallowed.length,
      allowed: allowed.length,
      findings: all,
    }, null, 2));
  } else {
    console.log(`check-toast-raw-error: mode=${ENFORCE ? 'enforce' : 'audit'} scanned=${files.length} files`);
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
      console.log(`\nANNOTATED (allowed):`);
      for (const f of allowed) {
        console.log(`  [${f.pattern}] ${f.file}:${f.line}  allow=${f.allow_reason ?? '(no key)'}`);
      }
    }
  }

  if (ENFORCE && unallowed.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('check-toast-raw-error: script error', err);
  process.exit(2);
});
