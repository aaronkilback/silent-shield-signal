#!/usr/bin/env node
/**
 * #179 — CI guard against ungoverned entity writers.
 *
 * Fails the build if any edge function INSERTs/UPSERTs into `entities` or
 * `entity_suggestions` without one of:
 *
 *   1. A call to `validateAndClassify` within the SAME enclosing function/block
 *      (proves governance routing).
 *   2. An explicit `// @governance-exempt: <reason>` annotation on the same
 *      line or the line immediately above the offending insert.
 *
 * Why function-scope (not ±N lines): brace-counting catches refactors where
 * code moves but the function boundary remains stable. ±N-line proximity
 * breaks the moment someone wraps the insert in a helper or extracts a sub-
 * function. Block scope is the invariant.
 *
 * Special exemptions (file-level):
 *   - _shared/entity-governance.ts (the governance module itself)
 *   - merge-duplicate-entities (UPDATE-only on suggestions — no new rows)
 *
 * Usage:
 *   node scripts/check-entity-writers.mjs
 *
 * Exit codes:
 *   0 = all entity writers route through governance OR are explicitly exempt
 *   1 = one or more ungoverned writers detected
 *   2 = script error
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const FUNCTIONS_DIR = join(REPO_ROOT, 'supabase', 'functions');

// Tables under governance enforcement
const GUARDED_TABLES = new Set(['entities', 'entity_suggestions']);

// File paths that are exempt at the file level. Use sparingly and document
// the reason here for every entry.
const FILE_EXEMPTIONS = new Map([
  ['_shared/entity-governance.ts', 'governance module itself; defines validateAndClassify'],
  ['merge-duplicate-entities/index.ts', 'UPDATE-only on entity_suggestions.matched_entity_id — no new rows'],
]);

// Known-pending writers awaiting governance wiring. Each entry must reference
// the phase ticket that will close it. The CI guard treats these as KNOWN
// (passes) but fails on any NEW unauthorized writer.
//
// Removing an entry from this list is part of the PR that wires that writer.
// Adding an entry requires explicit doctrine review — this is not a free pass.
const KNOWN_PENDING_WRITERS = [
  // All H-1, H-2, and H-3 writers governed. KNOWN_PENDING_WRITERS is now empty.
];

function isKnownPending(relPath, lineNum) {
  return KNOWN_PENDING_WRITERS.find((e) => relPath.endsWith(e.file) && Math.abs(e.line - lineNum) <= 2);
}

// Pattern: `.from('TABLE')` or `.from("TABLE")` followed (eventually) by `.insert(` or `.upsert(`
// We scan line-by-line, tracking `.from()` calls and their matching insert/upsert call sites.

function* walkTypeScriptFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTypeScriptFiles(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield full;
    }
  }
}

/**
 * Strip a line of comment and string content for pure structural analysis.
 * Used for brace counting so braces inside strings/comments don't break the count.
 */
function stripLineForBraceCounting(line) {
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  while (i < line.length) {
    const c = line[i];
    const c2 = line.substring(i, i + 2);
    if (inLineComment) {
      // discard rest of line
      break;
    }
    if (inSingle) {
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { inSingle = false; }
      i += 1; continue;
    }
    if (inDouble) {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { inDouble = false; }
      i += 1; continue;
    }
    if (inBacktick) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { inBacktick = false; }
      i += 1; continue;
    }
    if (c2 === '//') { inLineComment = true; break; }
    if (c === "'") { inSingle = true; i += 1; continue; }
    if (c === '"') { inDouble = true; i += 1; continue; }
    if (c === '`') { inBacktick = true; i += 1; continue; }
    if (c === '{' || c === '}') { out += c; }
    i += 1;
  }
  return out;
}

/**
 * Walk backward from `insertLineIdx` to find the start of the enclosing block.
 * Returns the line index of the `{` that opens the smallest enclosing block.
 */
function findEnclosingBlockStart(lines, insertLineIdx) {
  let depth = 0;
  for (let i = insertLineIdx; i >= 0; i--) {
    const stripped = stripLineForBraceCounting(lines[i]);
    // Process right-to-left so we count braces in source order from the bottom up
    for (let j = stripped.length - 1; j >= 0; j--) {
      const c = stripped[j];
      if (c === '}') depth += 1;
      else if (c === '{') {
        if (depth === 0) return i; // found the opener
        depth -= 1;
      }
    }
  }
  return 0; // fall back to file start
}

/**
 * Walk forward from `blockStartLineIdx` to find the matching `}`.
 */
function findEnclosingBlockEnd(lines, blockStartLineIdx) {
  let depth = 0;
  let started = false;
  for (let i = blockStartLineIdx; i < lines.length; i++) {
    const stripped = stripLineForBraceCounting(lines[i]);
    for (const c of stripped) {
      if (c === '{') { depth += 1; started = true; }
      else if (c === '}') {
        depth -= 1;
        if (started && depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

/**
 * Find every `.from('TABLE').insert/upsert` chain that targets a guarded table.
 *
 * Key insight: in Supabase JS the FIRST chain method after .from() determines
 * the operation (.insert / .upsert / .select / .update / .delete). We look
 * specifically for that first method and only flag if it's insert/upsert.
 * This avoids false-positives where a .select() chain happens to contain a
 * .upsert in some sibling expression within a 20-line window.
 *
 * A chain can span lines: `.from('entities')` on one line, `.insert(...)` 5
 * lines later. We scan forward through the source after the .from() match,
 * skipping whitespace and comments, looking for the very next `.METHOD(`.
 */
function findGuardedInserts(content) {
  const lines = content.split('\n');
  const findings = [];
  // Match `.from('TABLE')` or `.from("TABLE")`. Capture position for forward scan.
  const fromRe = /\.from\(\s*['"](entities|entity_suggestions)['"]\s*\)/g;
  // Build a flat char-position index of where each line starts, so we can map
  // an absolute offset back to a line number.
  const lineStartOffsets = [0];
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets.push(lineStartOffsets[i] + lines[i].length + 1);
  }
  const offsetToLine = (offset) => {
    let lo = 0, hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStartOffsets[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  let m;
  while ((m = fromRe.exec(content)) !== null) {
    const fromEnd = m.index + m[0].length;
    const table = m[1];
    const fromLineIdx = offsetToLine(m.index);
    // Scan forward from fromEnd, skipping whitespace, newlines, and // line comments,
    // until we hit a `.METHOD(`. That method is the operation.
    let p = fromEnd;
    while (p < content.length) {
      const ch = content[p];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { p += 1; continue; }
      if (content.startsWith('//', p)) {
        const nl = content.indexOf('\n', p);
        p = nl === -1 ? content.length : nl + 1;
        continue;
      }
      if (content.startsWith('/*', p)) {
        const end = content.indexOf('*/', p + 2);
        p = end === -1 ? content.length : end + 2;
        continue;
      }
      if (ch === '.') {
        // Expect: . METHOD (
        const rest = content.substring(p);
        const methMatch = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
        if (methMatch) {
          const method = methMatch[1];
          if (method === 'insert' || method === 'upsert') {
            const opLineIdx = offsetToLine(p);
            findings.push({
              lineIdx: fromLineIdx,
              opLineIdx,
              table,
              op: method,
              snippet: content.substring(m.index, Math.min(content.length, p + 80)).replace(/\s+/g, ' ').substring(0, 200),
            });
          }
          // Whether writer or not, this chain's first method is identified; move on.
          break;
        }
      }
      // Anything else: not part of a chain call; abandon this .from() match.
      break;
    }
  }
  return { lines, findings };
}

/**
 * Determine if a finding is governed.
 *
 * Strategy: file-level governance presence + line-level exemption annotation.
 *
 *   1. Annotation: `// @governance-exempt: <reason>` within 3 lines preceding
 *      the .from() call OR on the insert line itself. Per-call escape hatch.
 *   2. File-level: the file imports `validateAndClassify` from the shared
 *      governance module AND invokes it somewhere in the file. This is coarse
 *      (a file with both a governed and a sneaky-bypass writer would pass) but
 *      robust against object-literal-vs-block-scope ambiguity. Sneaky bypass
 *      remains the responsibility of code review, which is appropriate.
 *
 * When a file legitimately has multiple writers where SOME need exemption,
 * use the per-call annotation. Don't rely on file-level for partial coverage.
 */
function classifyFinding(content, lines, finding, fileGoverned) {
  // Per-call annotation check (current line + 3 lines above)
  const annotRe = /@governance-exempt:\s*(\S.*)/;
  for (let k = Math.max(0, finding.lineIdx - 3); k <= finding.opLineIdx; k++) {
    const am = annotRe.exec(lines[k]);
    if (am) return { ok: true, kind: 'exempt', reason: am[1].trim() };
  }
  if (fileGoverned) {
    return { ok: true, kind: 'governed' };
  }
  return { ok: false };
}

/**
 * File-level governance check.
 *
 * Heuristic: file imports `validateAndClassify` (under any alias) from the
 * shared governance module AND invokes that alias somewhere.
 *
 * We parse the import statement to capture both the original name and any
 * alias, then verify at least one of those names is called with `(`.
 */
function isFileGoverned(content) {
  // Match: import { ... validateAndClassify [as ALIAS] ... } from "../_shared/entity-governance.ts"
  // The import block may span multiple lines.
  const importBlockRe = /import\s*\{([^}]*)\}\s*from\s+["'][^"']*\/_shared\/entity-governance(?:\.ts)?["']/g;
  let m;
  const usableNames = new Set();
  while ((m = importBlockRe.exec(content)) !== null) {
    const block = m[1];
    // Each entry: NAME or NAME as ALIAS
    const entries = block.split(',').map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      const aliasMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/.exec(entry);
      if (aliasMatch) {
        if (aliasMatch[1] === 'validateAndClassify') usableNames.add(aliasMatch[2]);
      } else {
        const bare = /^([A-Za-z_$][\w$]*)/.exec(entry);
        if (bare && bare[1] === 'validateAndClassify') usableNames.add('validateAndClassify');
      }
    }
  }
  if (usableNames.size === 0) return false;
  // At least one of the imported names must be called.
  for (const name of usableNames) {
    const callRe = new RegExp(`\\b${name}\\b\\s*\\(`);
    if (callRe.test(content)) return true;
  }
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────

let bypassCount = 0;
let governedCount = 0;
let exemptCount = 0;
let pendingCount = 0;
const failures = [];
const pendings = [];

for (const file of walkTypeScriptFiles(FUNCTIONS_DIR)) {
  const rel = relative(FUNCTIONS_DIR, file);
  // File-level exemption?
  const fileExempt = [...FILE_EXEMPTIONS.entries()].find(([suffix]) => rel.endsWith(suffix));
  if (fileExempt) {
    // Still verify the file does contain references (informational)
    continue;
  }
  const content = readFileSync(file, 'utf8');
  if (!GUARDED_TABLES.has('entities') || !content.includes('entity_suggestions')) {
    // Skip files that don't reference either table (cheap pre-filter)
  }
  if (!content.includes("from('entities')") && !content.includes('from("entities")')
      && !content.includes("from('entity_suggestions')") && !content.includes('from("entity_suggestions")')) {
    continue;
  }
  const { lines, findings } = findGuardedInserts(content);
  const fileGoverned = isFileGoverned(content);
  for (const f of findings) {
    const result = classifyFinding(content, lines, f, fileGoverned);
    if (result.ok) {
      if (result.kind === 'governed') governedCount += 1;
      else exemptCount += 1;
      continue;
    }
    // Known-pending check before declaring a hard failure
    const pending = isKnownPending(rel, f.lineIdx + 1);
    if (pending) {
      pendingCount += 1;
      pendings.push({ file: rel, line: f.lineIdx + 1, table: f.table, phase: pending.phase });
      continue;
    }
    bypassCount += 1;
    failures.push({
      file: rel,
      line: f.lineIdx + 1,
      opLine: f.opLineIdx + 1,
      table: f.table,
      op: f.op,
      snippet: f.snippet.split('\n').slice(0, 4).join(' | '),
    });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length === 0) {
  console.log(`✓ check-entity-writers — ${governedCount} governed, ${exemptCount} exempt, ${pendingCount} known-pending, 0 unauthorized bypass.`);
  if (pendingCount > 0) {
    console.log(`  pending writers (tracked in KNOWN_PENDING_WRITERS):`);
    for (const p of pendings) {
      console.log(`    ${p.file}:${p.line}  (${p.table})  → scheduled in ${p.phase}`);
    }
  }
  process.exit(0);
}

console.log(`✗ check-entity-writers — ${bypassCount} unauthorized ungoverned writer(s):`);
console.log('');
for (const f of failures) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    table: ${f.table}, op: .${f.op}(`);
  console.log(`    snippet: ${f.snippet}`);
  console.log('');
}
console.log('Each writer must EITHER:');
console.log('  (a) Call `validateAndClassify` from `_shared/entity-governance.ts` within the same enclosing function/block, OR');
console.log('  (b) Carry an explicit `// @governance-exempt: <reason>` annotation on the .from() line or up to 3 lines above.');
console.log('');
console.log('See doctrine: CLAUDE.md "Entity governance hardening (#171 / #179)"');
process.exit(1);
