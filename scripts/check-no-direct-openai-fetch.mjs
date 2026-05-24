#!/usr/bin/env node
/**
 * PROD-X (2026-05-24) — static detector for direct OpenAI fetches that bypass
 * the ai-gateway helper.
 *
 * AUDIT-ONLY by default. Pass --enforce to fail on un-annotated findings.
 *
 * Background — defect class this guards against:
 *   PROD-X surfaced when dashboard-ai-assistant's post-tool synthesis paths
 *   called OpenAI directly via raw fetch(), bypassing ai-gateway's built-in
 *   OpenAI 429 → Gemini fallback (the PROD-Q work). With OpenAI in sustained
 *   429 quota exhaustion under PROD-R, every direct-fetch synthesis call
 *   failed silently and the user saw the frontend empty-stream fallback
 *   ("I'm having trouble generating a response. Please try again.").
 *
 *   The fix routed 6 sites through callAiGatewayStream(). This detector
 *   prevents new direct-fetch sites from being introduced without conscious
 *   `@qa-allow:openai-direct <reason>` annotation.
 *
 * Pattern matched (intentionally narrow):
 *   - `fetch(` / `fetchWithTimeout(` immediately followed by
 *     `"https://api.openai.com/v1/chat/completions"` (with whitespace tolerance)
 *
 * The ai-gateway file itself is the ONE legitimate caller — annotated below.
 *
 * Annotation for intentional exceptions:
 *   // @qa-allow:openai-direct <reason-key>
 *
 * Usage:
 *   node scripts/check-no-direct-openai-fetch.mjs           # audit (default)
 *   node scripts/check-no-direct-openai-fetch.mjs --enforce # blocking CI
 *   node scripts/check-no-direct-openai-fetch.mjs --json    # JSON output
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
// ai-gateway IS the boundary; it's allowed to call OpenAI directly.
const ALLOWED_FILES = new Set([
  'supabase/functions/_shared/ai-gateway.ts',
  'scripts/check-no-direct-openai-fetch.mjs', // this script's own pattern
]);

const args = new Set(process.argv.slice(2));
const ENFORCE = args.has('--enforce');
const JSON_OUT = args.has('--json');

const ALLOW_RE = /@qa-allow:openai-direct(?:\s+([A-Za-z0-9_\-]+))?/;

// Pattern: fetch(...) or fetchWithTimeout(...) where the next non-space arg
// is the OpenAI chat-completions URL. Tolerates the comma/whitespace between
// the function name and the URL literal.
const PATTERN = /(?:fetch|fetchWithTimeout)\s*\(\s*["'`]https?:\/\/api\.openai\.com\/v1\/chat\/completions/g;

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
    if (ALLOWED_FILES.has(rel)) continue;
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.isFile() && /\.(ts|tsx|mjs|js|jsx)$/.test(ent.name)) out.push(full);
  }
}

async function scanFile(absPath) {
  let body;
  try { body = await readFile(absPath, 'utf-8'); } catch { return []; }
  const lines = body.split('\n');
  const findings = [];
  PATTERN.lastIndex = 0;
  let m;
  while ((m = PATTERN.exec(body)) !== null) {
    const lineNum = body.slice(0, m.index).split('\n').length;
    const lineText = lines[lineNum - 1] ?? '';
    const prevLineText = lineNum >= 2 ? lines[lineNum - 2] : '';
    const prev2LineText = lineNum >= 3 ? lines[lineNum - 3] : '';
    const trimmed = lineText.trim();
    // Skip pure comment lines — documentation references are not runtime hazards.
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    // Annotation can appear on the same line OR anywhere in the contiguous
    // comment block immediately preceding the fetch (look back up to 10 lines,
    // stopping at the first non-comment / non-blank line).
    let inlineAllow = ALLOW_RE.exec(lineText);
    if (!inlineAllow) {
      for (let back = 1; back <= 10 && (lineNum - back) >= 1; back++) {
        const above = lines[lineNum - 1 - back] ?? '';
        const aboveTrim = above.trim();
        if (aboveTrim === '') continue;
        if (!aboveTrim.startsWith('//') && !aboveTrim.startsWith('/*') && !aboveTrim.startsWith('*')) break;
        inlineAllow = ALLOW_RE.exec(above);
        if (inlineAllow) break;
      }
    }
    // Unused now but kept readable above.
    void prev2LineText; void prevLineText;
    findings.push({
      file: relative(REPO_ROOT, absPath),
      line: lineNum,
      text: trimmed.slice(0, 200),
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
      mode: ENFORCE ? 'enforce' : 'audit',
      total: all.length,
      unallowed: unallowed.length,
      allowed: allowed.length,
      findings: all,
    }, null, 2));
  } else {
    console.log(`check-no-direct-openai-fetch: mode=${ENFORCE ? 'enforce' : 'audit'} scanned=${files.length} files (boundary files excluded: ${ALLOWED_FILES.size})`);
    console.log(`  total findings:    ${all.length}`);
    console.log(`  un-annotated:      ${unallowed.length}`);
    console.log(`  annotated (allow): ${allowed.length}`);
    if (unallowed.length > 0) {
      console.log('\nUN-ANNOTATED FINDINGS:');
      for (const f of unallowed) {
        console.log(`  ${f.file}:${f.line}`);
        console.log(`      ${f.text}`);
        console.log(`      → Route through callAiGateway() / callAiGatewayStream() in _shared/ai-gateway.ts for OpenAI 429 → Gemini fallback.`);
      }
    }
    if (allowed.length > 0) {
      console.log(`\nANNOTATED (allowed):`);
      for (const f of allowed) {
        console.log(`  ${f.file}:${f.line}  allow=${f.allow_reason ?? '(no key)'}`);
      }
    }
  }

  if (ENFORCE && unallowed.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('check-no-direct-openai-fetch: script error', err);
  process.exit(2);
});
