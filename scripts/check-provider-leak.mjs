#!/usr/bin/env node
/**
 * Branch 2A.4 (P0.5) — Raw provider leak detection (narrowed signatures).
 *
 * AUDIT-ONLY MODE (default): exit 0. Reports findings to stdout.
 * BLOCKING MODE: pass --enforce. Exit 1 on any un-annotated finding.
 *
 * Background — defect this guards against:
 *   PROD-Q (2026-05-22) was the worst-case form: provider SSE error
 *   envelopes streamed verbatim into the user-facing UI, exposing
 *   upstream identity, model name, and error shape. This script catches
 *   the structural precursors so a leak cannot ship undetected.
 *
 *   NOT a broad "mention of provider name" detector — those produce
 *   massive false-positive noise (variable names, import paths, comments,
 *   operator-side logs all reference provider names legitimately). The
 *   patterns here are intentionally narrow: actual raw key prefixes or
 *   provider-error-envelope JSON keys appearing as string literals.
 *
 * Patterns (all are STRING-LITERAL only, not identifier matches):
 *   1. API key prefixes: 'sk-ant-', 'sk-proj-', 'sk-', 'AIza'
 *   2. Provider error envelope tags: '"type":"anthropic_error"',
 *      '"status":"RESOURCE_EXHAUSTED"' (Gemini), '"error":{"type":"invalid_request_error"' (OpenAI)
 *
 * The ai-gateway file is allowed to reference these patterns because it
 * is the single boundary that handles raw provider envelopes. Everything
 * else is scope creep and a candidate leak.
 *
 * Annotation:
 *   Tag intentional exceptions with:
 *     // @qa-allow:provider-leak <reason>
 *
 * Usage:
 *   node scripts/check-provider-leak.mjs           # audit-only
 *   node scripts/check-provider-leak.mjs --enforce # blocking
 *
 * Exit codes:
 *   0 — audit mode always; enforce mode if no un-annotated findings
 *   1 — enforce mode with un-annotated findings
 *   2 — script error
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['supabase/functions', 'src'];
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.turbo',
  'playwright-report', 'test-results', 'coverage', '.lovable', 'docs',
]);
// Boundaries that legitimately handle raw provider envelopes. Add here
// only when you can document WHY a given file must contain provider-raw
// patterns. Each addition shrinks the audit's value — review carefully.
const ALLOWED_FILES = new Set([
  'supabase/functions/_shared/ai-gateway.ts',
  'supabase/functions/_shared/observability.ts',      // classifyError() inspects error strings
  'supabase/functions/_shared/user-safe-errors.ts',   // PROD-T: regex patterns for redactProviderLeak
  'src/lib/user-safe-errors.ts',                      // PROD-T: frontend mirror, same regex patterns
  'src/test/lib/user-safe-errors.test.ts',            // PROD-T: tests assert the same patterns
  'scripts/check-provider-leak.mjs',                  // this script's own pattern definitions
  'scripts/check-toast-raw-error.mjs',                // Branch 2A.5b sibling detector
]);

const args = new Set(process.argv.slice(2));
const ENFORCE = args.has('--enforce');
const JSON_OUT = args.has('--json');

// Each pattern matches a STRING LITERAL (or quoted JSON fragment) — not bare
// identifiers. We require the surrounding quote characters to avoid matching
// variable names like `anthropicError` or imports like `@anthropic-ai/sdk`.
const PATTERNS = [
  {
    key: 'api-key-prefix-sk-ant',
    // Matches literal 'sk-ant-...' or "sk-ant-..." — the Anthropic API key
    // prefix. A real key shouldn't appear in source at all; this catches
    // accidental commits and hardcoded test keys.
    regex: /['"`]sk-ant-[A-Za-z0-9_-]{8,}/g,
    reason: 'Anthropic API key prefix appears as string literal. Keys must live in env vars, never in source.',
  },
  {
    key: 'api-key-prefix-sk-proj',
    regex: /['"`]sk-proj-[A-Za-z0-9_-]{8,}/g,
    reason: 'OpenAI project key prefix as string literal. Move to env var.',
  },
  {
    key: 'api-key-prefix-aiza',
    // Google API keys start with `AIza` and are exactly 39 chars. Match the
    // prefix + at least 30 more chars as a literal.
    regex: /['"`]AIza[A-Za-z0-9_-]{30,}/g,
    reason: 'Google API key as string literal. Move to env var.',
  },
  {
    key: 'provider-envelope-anthropic-error',
    // Matches the Anthropic error envelope tag verbatim in source. If this
    // string appears outside ai-gateway.ts, the caller is likely catching
    // the raw provider envelope and routing it through a path that may
    // surface it to a user. PROD-Q SSE leak class.
    regex: /['"`]anthropic_error['"`]|['"`]anthropic-error['"`]/g,
    reason: "Anthropic error-envelope literal outside the gateway boundary. Raw provider envelopes must be classified in ai-gateway, not re-handled at call sites.",
  },
  {
    key: 'provider-envelope-gemini-resource-exhausted',
    regex: /['"`]RESOURCE_EXHAUSTED['"`]/g,
    reason: 'Gemini error-envelope status literal outside the gateway boundary. Same risk class as PROD-Q.',
  },
  {
    key: 'provider-envelope-openai-invalid-request',
    regex: /['"`]invalid_request_error['"`]/g,
    reason: 'OpenAI error-envelope literal outside the gateway boundary. Classify in ai-gateway, not at call sites.',
  },
];

const ALLOW_RE = /@qa-allow:provider-leak(?:\s+([A-Za-z0-9_\-]+))?/;

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
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && /\.(ts|tsx|mjs|js|jsx)$/.test(ent.name)) out.push(full);
  }
}

async function scanFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  if (ALLOWED_FILES.has(rel)) return [];
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
      // Comment-line stripping: documentation references are not runtime
      // leaks. (A pure comment that mentions 'sk-ant-...' is talking ABOUT
      // the pattern, not embedding a key.)
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      const inlineAllow = ALLOW_RE.exec(lineText);
      const aboveAllow = ALLOW_RE.exec(prevLineText);
      const allowed = Boolean(inlineAllow || aboveAllow);
      findings.push({
        pattern: pat.key,
        reason: pat.reason,
        file: rel,
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
    console.log(`check-provider-leak: mode=${ENFORCE ? 'enforce' : 'audit'} scanned=${files.length} files (boundary files excluded: ${ALLOWED_FILES.size})`);
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
  console.error('check-provider-leak: script error', err);
  process.exit(2);
});
