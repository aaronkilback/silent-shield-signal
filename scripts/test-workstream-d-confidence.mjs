#!/usr/bin/env node
// scripts/test-workstream-d-confidence.mjs
//
// Workstream D — slim slice — end-to-end regression suite for the confidence
// + provenance evaluator, frame helper, and prose-lint library.
//
// Runs under `deno test` (the modules under test are Supabase Edge Function
// .ts files, which import via Deno-native specifiers). This wrapper exists so
// CI can keep a uniform `node scripts/<name>.mjs` invocation surface — it
// shells out to `deno test`.
//
// Exits 0 on full pass, 1 on any failure.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const testFile = join(repoRoot, "supabase/functions/_shared/aegis-confidence.test.ts");

if (!existsSync(testFile)) {
  console.error(`✗ Test file not found: ${testFile}`);
  process.exit(1);
}

const result = spawnSync("deno", ["test", "--allow-none", testFile], {
  stdio: "inherit",
  cwd: repoRoot,
});

if (result.error) {
  console.error("✗ Failed to spawn 'deno' — install Deno or set DENO_INSTALL_PATH.");
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
