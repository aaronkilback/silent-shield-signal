#!/usr/bin/env node
// scripts/check-cop-timeline-writer-discipline.mjs
//
// RC4 — Decision Layer Option C (G2 architecture).
// Fails CI on any direct cop_timeline_events write outside the canonical helper
// (src/lib/cop-timeline-writer.ts).
//
// ─────────────────────────────────────────────────────────────────────────────
// TRANSITIONAL ENFORCEMENT — long-term migration direction
// ─────────────────────────────────────────────────────────────────────────────
// Per operator directive 2026-05-30: regex-based source detection is a
// TRANSITIONAL enforcement mechanism for this writer-discipline class. The
// long-term direction is canonical APIs + database guarantees, not pattern
// matching on source code. As the codebase evolves, prefer:
//   1. DB-layer guarantees (this surface already has the C.0 + C.1 triggers;
//      a wrong-tenant row cannot be persisted regardless of which writer
//      created it).
//   2. Canonical typed-API contracts (e.g., a tenant-scoped client that
//      structurally cannot reach cop_timeline_events outside the helper).
// This script ships because the DB guarantees + canonical API pattern aren't
// fully in place across all Aegis surfaces yet. As they spread, this guard
// becomes redundant and can be deprecated.
//
// ─────────────────────────────────────────────────────────────────────────────
// Design notes
// ─────────────────────────────────────────────────────────────────────────────
// The current COPCanvas.tsx chain pattern is:
//   await supabase
//     .from('cop_timeline_events')
//     .insert({...})
// The `.from(...)` and `.insert(...)` calls are on separate lines.
// LINE-ORIENTED grep CANNOT match this pattern. This script reads each file
// whole and applies a regex with `s` (dotAll) so the chain matches regardless
// of how the caller formats it.
//
// Pure Node — no external grep/rg dependency. Works identically in CI and
// local dev.
//
// References:
//   docs/platform-operations/decision-layer-c2-authorization-package-2026-05-30.md
//   docs/platform-operations/architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ALLOWED_WRITERS = new Set([
  'src/lib/cop-timeline-writer.ts',
]);

const SCAN_ROOTS = ['src', 'supabase/functions'];
const FILE_EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

// Multi-line method-chain pattern, scoped to ONE statement. `[^;]*?` matches
// any character (including newlines) except `;`, which terminates statements
// in TypeScript. This prevents the regex from spanning across statements and
// false-matching when one statement reads cop_timeline_events and a later
// (unrelated) statement writes to a different table. Within a single chain
// `.from(...).insert(...)` there is no semicolon between `from` and `insert`.
const PATTERN = /\.from\(['"]cop_timeline_events['"]\)[^;]*?\.(insert|upsert|update|delete)\s*\(/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir doesn't exist (e.g., supabase/functions absent in some checkouts)
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.');
      const ext = dot === -1 ? '' : e.name.slice(dot);
      if (FILE_EXTS.has(ext)) yield full;
    }
  }
}

async function findCopTimelineWriters() {
  const hits = new Set();
  for (const root of SCAN_ROOTS) {
    for await (const file of walk(root)) {
      const content = await readFile(file, 'utf-8');
      if (PATTERN.test(content)) {
        // Normalize to repo-relative path with forward slashes
        hits.add(relative(process.cwd(), file).replaceAll('\\', '/'));
      }
    }
  }
  return [...hits].sort();
}

const candidates = await findCopTimelineWriters();
const violations = candidates.filter((file) => !ALLOWED_WRITERS.has(file));

if (violations.length > 0) {
  console.error('cop_timeline_events writer discipline FAILED.');
  console.error('Found direct writes outside the canonical helper in:');
  violations.forEach((f) => console.error(`  ${f}`));
  console.error('');
  console.error(`Allowed writers: ${[...ALLOWED_WRITERS].join(', ')}`);
  console.error('Route all writes through src/lib/cop-timeline-writer.ts.');
  console.error(
    'If a new writer is genuinely required, add it to ALLOWED_WRITERS in this script + reviewer approval.',
  );
  process.exit(1);
}

console.log(
  `cop_timeline_events writer discipline OK (${candidates.length} matching file(s) found, all in allowlist).`,
);
