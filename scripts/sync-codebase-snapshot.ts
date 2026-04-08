#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
/**
 * sync-codebase-snapshot.ts
 *
 * Reads all Edge Function source files, shared modules, and key project docs
 * then upserts them into the `codebase_snapshot` Supabase table.
 *
 * Aegis uses this table to audit the codebase before making recommendations.
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-net scripts/sync-codebase-snapshot.ts
 *
 * Prerequisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment.
 *
 * Run this after deploying new or modified Edge Functions.
 * See CODEBASE_AUDIT.md for full documentation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// Load .env if present
try {
  const env = await Deno.readTextFile(`${PROJECT_ROOT}/.env`);
  for (const line of env.split("\n")) {
    const [key, ...rest] = line.trim().split("=");
    if (key && rest.length && !key.startsWith("#")) {
      Deno.env.set(key, rest.join("=").replace(/^["']|["']$/g, ""));
    }
  }
} catch { /* .env not required */ }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

type FileType = "edge_function" | "shared" | "config" | "doc";

interface SnapshotEntry {
  file_path: string;
  file_type: FileType;
  function_name: string | null;
  content: string;
}

async function readFile(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

async function collectEdgeFunctions(): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  const functionsDir = `${PROJECT_ROOT}/supabase/functions`;

  for await (const entry of Deno.readDir(functionsDir)) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;

    const indexPath = `${functionsDir}/${entry.name}/index.ts`;
    const content = await readFile(indexPath);
    if (content === null) continue;

    entries.push({
      file_path: `supabase/functions/${entry.name}/index.ts`,
      file_type: "edge_function",
      function_name: entry.name,
      content,
    });
  }

  return entries;
}

async function collectSharedModules(): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  const sharedDir = `${PROJECT_ROOT}/supabase/functions/_shared`;

  for await (const entry of Deno.readDir(sharedDir)) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".md")) continue;

    const content = await readFile(`${sharedDir}/${entry.name}`);
    if (content === null) continue;

    entries.push({
      file_path: `supabase/functions/_shared/${entry.name}`,
      file_type: "shared",
      function_name: null,
      content,
    });
  }

  return entries;
}

async function collectDocs(): Promise<SnapshotEntry[]> {
  const docFiles = [
    "ARCHITECTURE.md",
    "DATABASE_SCHEMA.md",
    "API_DOCUMENTATION.md",
    "CRITICAL_WORKFLOWS.md",
    "CODEBASE_AUDIT.md",
    "README.md",
  ];

  const entries: SnapshotEntry[] = [];

  for (const filename of docFiles) {
    const content = await readFile(`${PROJECT_ROOT}/${filename}`);
    if (content === null) continue;

    entries.push({
      file_path: filename,
      file_type: "doc",
      function_name: null,
      content,
    });
  }

  return entries;
}

async function collectConfig(): Promise<SnapshotEntry[]> {
  const configFiles = [
    "supabase/config.toml",
  ];

  const entries: SnapshotEntry[] = [];

  for (const filePath of configFiles) {
    const content = await readFile(`${PROJECT_ROOT}/${filePath}`);
    if (content === null) continue;

    entries.push({
      file_path: filePath,
      file_type: "config",
      function_name: null,
      content,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Upsert to Supabase
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;

async function upsertBatch(entries: SnapshotEntry[]): Promise<{ ok: number; err: number }> {
  let ok = 0;
  let err = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE).map(e => ({
      ...e,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("codebase_snapshot")
      .upsert(batch, { onConflict: "file_path" });

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      err += batch.length;
    } else {
      ok += batch.length;
    }
  }

  return { ok, err };
}

// ---------------------------------------------------------------------------
// Remove stale entries (files that no longer exist on disk)
// ---------------------------------------------------------------------------

async function pruneStale(currentPaths: Set<string>): Promise<number> {
  const { data: existing } = await supabase
    .from("codebase_snapshot")
    .select("file_path");

  if (!existing) return 0;

  const stale = existing.filter(r => !currentPaths.has(r.file_path)).map(r => r.file_path);

  if (stale.length === 0) return 0;

  const { error } = await supabase
    .from("codebase_snapshot")
    .delete()
    .in("file_path", stale);

  if (error) {
    console.error("  Prune error:", error.message);
    return 0;
  }

  return stale.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Collecting source files...");

const [functions, shared, docs, config] = await Promise.all([
  collectEdgeFunctions(),
  collectSharedModules(),
  collectDocs(),
  collectConfig(),
]);

const all = [...functions, ...shared, ...docs, ...config];
const currentPaths = new Set(all.map(e => e.file_path));

console.log(`  Edge functions : ${functions.length}`);
console.log(`  Shared modules : ${shared.length}`);
console.log(`  Docs           : ${docs.length}`);
console.log(`  Config         : ${config.length}`);
console.log(`  Total          : ${all.length} files`);
console.log("");
console.log("Upserting to codebase_snapshot...");

const { ok, err } = await upsertBatch(all);

const pruned = await pruneStale(currentPaths);

console.log(`  Upserted : ${ok}`);
if (err > 0) console.log(`  Errors   : ${err}`);
if (pruned > 0) console.log(`  Pruned   : ${pruned} stale entries removed`);
console.log("");
console.log("Done. Aegis can now audit the current codebase.");
