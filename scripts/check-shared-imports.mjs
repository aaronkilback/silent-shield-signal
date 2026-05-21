#!/usr/bin/env node
/**
 * #112 — CI guard: import/export consistency for supabase/functions/_shared/
 *
 * Fails the build if any function under supabase/functions/<fn>/ imports a
 * symbol from ../_shared/<X>.ts that is not actually exported by that file.
 *
 * Motivation: commit f2965d9c (2026-05-18) added an import of
 * `getAccessibleClientIds` from _shared/supabase-client.ts that was never
 * exported anywhere. The defect sat on main for 2 days and would have
 * bricked ingest-signal on next redeploy (per #102, #112, and the
 * DEPLOY-BLOCKED file-header banner the safety PR shipped).
 *
 * This guard catches that class of error at PR time, not at deploy time.
 *
 * Scope: only checks bare imports like `import { foo } from '../_shared/x.ts'`.
 * Default imports, namespace imports, type-only imports, and re-exports are
 * resolved as best-effort but not exhaustively checked. The goal is to catch
 * the common-case "imported symbol does not exist" failure, not to be a
 * full type-checker.
 *
 * Usage:
 *   node scripts/check-shared-imports.mjs
 *
 * Exit codes:
 *   0 = all imports resolve
 *   1 = one or more imports reference missing exports
 *   2 = script itself failed (filesystem, parse error, etc.)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const FUNCTIONS_DIR = join(REPO_ROOT, 'supabase', 'functions');
const SHARED_DIR = join(FUNCTIONS_DIR, '_shared');

/**
 * Parse `export ...` declarations from a TS file. Returns the set of symbol
 * names exported. Handles:
 *   export function foo(...)
 *   export async function foo(...)
 *   export const foo = ...
 *   export let foo = ...
 *   export class foo ...
 *   export interface foo ...
 *   export type foo ...
 *   export enum foo ...
 *   export { foo, bar, baz as qux } from '...';   (named re-exports)
 *   export { foo, bar };                          (named exports)
 *   export default ...                            (recorded as 'default')
 *
 * Not comprehensive — does not resolve `export * from` recursively, and
 * does not parse JSX or complex generics — but covers every shape used
 * across supabase/functions/_shared/ today.
 */
function parseExports(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const exports = new Set();

  // export function|class|interface|type|enum NAME
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    exports.add(m[1]);
  }

  // export const|let|var NAME
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    exports.add(m[1]);
  }

  // export { foo, bar, baz as qux } [from '...']
  for (const m of src.matchAll(/^\s*export\s*\{\s*([^}]+?)\s*\}\s*(?:from\s*['"][^'"]+['"]\s*)?;?/gm)) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      // handle `foo as bar` → record bar (the externally-visible name)
      const asMatch = name.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (asMatch) {
        exports.add(asMatch[1]);
      } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        exports.add(name);
      }
      // ignore anything weirder (default imports, complex generics, etc.)
    }
  }

  // export default ...
  if (/^\s*export\s+default\b/m.test(src)) {
    exports.add('default');
  }

  return exports;
}

/**
 * Parse `import { ... } from '../_shared/<file>'` declarations. Returns
 * an array of { sourceFile, sharedRelPath, symbols[] }. Skips type-only
 * imports (we can't easily verify those without a TS parser, and they
 * don't cause runtime WORKER_ERROR).
 */
function parseSharedImports(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const results = [];

  // Match: import { a, b as c, type d } from '../_shared/path.ts' (or .ts'-less)
  // Tolerate: leading whitespace, multi-line braces, trailing comments.
  const importRe = /^\s*import\s+(type\s+)?\{\s*([^}]+?)\s*\}\s*from\s*['"]((?:\.{1,2}\/)+_shared\/[^'"]+?)['"]\s*;?/gms;

  for (const m of src.matchAll(importRe)) {
    const isTypeOnly = !!m[1];
    if (isTypeOnly) continue; // type-only imports don't cause runtime errors

    const symbolsRaw = m[2];
    const sharedPath = m[3];

    const symbols = symbolsRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        // strip leading "type " on individual entries
        if (/^type\s+/.test(s)) return null;
        const asMatch = s.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (asMatch) return asMatch[1]; // we check the SOURCE symbol, not the alias
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) return s;
        return null;
      })
      .filter(Boolean);

    if (symbols.length === 0) continue;

    // Resolve the shared file's absolute path
    const fnDir = filePath.replace(/\/[^/]+\.ts$/, '');
    const absShared = resolve(fnDir, sharedPath);
    results.push({
      sourceFile: filePath,
      sharedRelPath: sharedPath,
      sharedAbsPath: absShared,
      symbols,
    });
  }

  return results;
}

function findFunctionEntryFiles() {
  // Every subdir of supabase/functions/ that isn't _shared/, with an index.ts
  const fnEntries = [];
  for (const name of readdirSync(FUNCTIONS_DIR)) {
    if (name === '_shared' || name.startsWith('.')) continue;
    const fnDir = join(FUNCTIONS_DIR, name);
    if (!statSync(fnDir).isDirectory()) continue;
    // Walk for .ts files (some functions have multiple)
    const stack = [fnDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const child of readdirSync(dir)) {
        const childPath = join(dir, child);
        const s = statSync(childPath);
        if (s.isDirectory()) {
          stack.push(childPath);
        } else if (child.endsWith('.ts')) {
          fnEntries.push(childPath);
        }
      }
    }
  }
  return fnEntries;
}

function findSharedFiles() {
  // Map from absolute path → Set of exported symbols
  const map = new Map();
  const stack = [SHARED_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const child of readdirSync(dir)) {
      const childPath = join(dir, child);
      const s = statSync(childPath);
      if (s.isDirectory()) {
        stack.push(childPath);
      } else if (child.endsWith('.ts')) {
        map.set(childPath, parseExports(childPath));
      }
    }
  }
  return map;
}

function main() {
  const sharedExports = findSharedFiles();
  const fnEntries = findFunctionEntryFiles();

  const failures = [];

  for (const fnFile of fnEntries) {
    const imports = parseSharedImports(fnFile);
    for (const imp of imports) {
      // Resolve absolute shared path; tolerate .ts vs no-ext form
      const candidates = [
        imp.sharedAbsPath,
        imp.sharedAbsPath.endsWith('.ts') ? imp.sharedAbsPath : imp.sharedAbsPath + '.ts',
      ];
      const resolved = candidates.find(p => sharedExports.has(p));
      if (!resolved) {
        failures.push({
          fnFile: relative(REPO_ROOT, fnFile),
          sharedRelPath: imp.sharedRelPath,
          reason: `shared file does not exist or is not a .ts file`,
          symbols: imp.symbols,
        });
        continue;
      }
      const available = sharedExports.get(resolved);
      const missing = imp.symbols.filter(s => !available.has(s));
      if (missing.length > 0) {
        failures.push({
          fnFile: relative(REPO_ROOT, fnFile),
          sharedRelPath: imp.sharedRelPath,
          reason: `imported symbol(s) not exported by ${relative(REPO_ROOT, resolved)}`,
          symbols: missing,
        });
      }
    }
  }

  if (failures.length === 0) {
    console.log(`✓ check-shared-imports — ${fnEntries.length} function file(s) verified against ${sharedExports.size} shared file(s). All imports resolve.`);
    process.exit(0);
  }

  console.error(`✗ check-shared-imports — ${failures.length} broken import(s) found:\n`);
  for (const f of failures) {
    console.error(`  ${f.fnFile}`);
    console.error(`    → ${f.sharedRelPath}`);
    console.error(`    ✗ ${f.reason}`);
    for (const s of f.symbols) {
      console.error(`        - ${s}`);
    }
    console.error('');
  }
  console.error(`This usually means: a function imports a symbol from _shared/* that was renamed, removed, or never landed.`);
  console.error(`Fix by adding the export to the shared file, or removing the import from the function.\n`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('check-shared-imports script error:', err);
  process.exit(2);
}
