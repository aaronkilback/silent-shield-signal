#!/usr/bin/env node
/**
 * sync-codebase-snapshot.mjs
 *
 * Reads all Edge Function source files, shared modules, and key project docs
 * then upserts them into the `codebase_snapshot` Supabase table.
 *
 * Aegis uses this table to audit the codebase before making recommendations.
 *
 * Usage:
 *   node --env-file=.env scripts/sync-codebase-snapshot.mjs
 *
 * Or if .env vars are already in your environment:
 *   node scripts/sync-codebase-snapshot.mjs
 *
 * Prerequisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.
 *
 * Run this after deploying new or modified Edge Functions.
 * See CODEBASE_AUDIT.md for full documentation.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Load env from .env if not already set
// ---------------------------------------------------------------------------

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const env = await readFile(join(PROJECT_ROOT, ".env"), "utf8");
    for (const line of env.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env not required */ }
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error("Error: SUPABASE_URL (or VITE_SUPABASE_URL) must be set.");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY must be set.");
  console.error("  Find it in: Supabase Dashboard → Project Settings → API → service_role secret");
  console.error("  Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/sync-codebase-snapshot.mjs");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase REST helper (no SDK dependency needed)
// ---------------------------------------------------------------------------

async function supabaseRequest(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "resolution=merge-duplicates,return=minimal" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function safeReadFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function collectEdgeFunctions() {
  const entries = [];
  const functionsDir = join(PROJECT_ROOT, "supabase", "functions");

  let dirs;
  try {
    dirs = await readdir(functionsDir, { withFileTypes: true });
  } catch {
    console.warn("  Warning: could not read supabase/functions directory");
    return entries;
  }

  for (const entry of dirs) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

    const indexPath = join(functionsDir, entry.name, "index.ts");
    const content = await safeReadFile(indexPath);
    if (content === null) continue;

    entries.push({
      file_path: `supabase/functions/${entry.name}/index.ts`,
      file_type: "edge_function",
      function_name: entry.name,
      content,
      updated_at: new Date().toISOString(),
    });
  }

  return entries;
}

async function collectSharedModules() {
  const entries = [];
  const sharedDir = join(PROJECT_ROOT, "supabase", "functions", "_shared");

  let files;
  try {
    files = await readdir(sharedDir, { withFileTypes: true });
  } catch {
    console.warn("  Warning: could not read _shared directory");
    return entries;
  }

  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".md")) continue;

    const content = await safeReadFile(join(sharedDir, entry.name));
    if (content === null) continue;

    entries.push({
      file_path: `supabase/functions/_shared/${entry.name}`,
      file_type: "shared",
      function_name: null,
      content,
      updated_at: new Date().toISOString(),
    });
  }

  return entries;
}

async function collectDocs() {
  const docFiles = [
    "ARCHITECTURE.md",
    "DATABASE_SCHEMA.md",
    "API_DOCUMENTATION.md",
    "CRITICAL_WORKFLOWS.md",
    "CODEBASE_AUDIT.md",
    "README.md",
  ];

  const entries = [];
  for (const filename of docFiles) {
    const content = await safeReadFile(join(PROJECT_ROOT, filename));
    if (content === null) continue;

    entries.push({
      file_path: filename,
      file_type: "doc",
      function_name: null,
      content,
      updated_at: new Date().toISOString(),
    });
  }

  return entries;
}

async function collectConfig() {
  const configFiles = ["supabase/config.toml"];
  const entries = [];

  for (const filePath of configFiles) {
    const content = await safeReadFile(join(PROJECT_ROOT, filePath));
    if (content === null) continue;

    entries.push({
      file_path: filePath,
      file_type: "config",
      function_name: null,
      content,
      updated_at: new Date().toISOString(),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Upsert in batches
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;

async function upsertBatch(entries) {
  let ok = 0;
  let err = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    try {
      await supabaseRequest("POST", "codebase_snapshot", batch);
      ok += batch.length;
      process.stdout.write(".");
    } catch (e) {
      console.error(`\n  Batch error: ${e.message}`);
      err += batch.length;
    }
  }

  if (ok > 0) process.stdout.write("\n");
  return { ok, err };
}

// ---------------------------------------------------------------------------
// Prune stale entries
// ---------------------------------------------------------------------------

async function pruneStale(currentPaths) {
  let existing;
  try {
    existing = await supabaseRequest("GET", "codebase_snapshot?select=file_path");
  } catch {
    return 0;
  }

  if (!existing?.length) return 0;

  const stale = existing.filter(r => !currentPaths.has(r.file_path)).map(r => r.file_path);
  if (stale.length === 0) return 0;

  // Delete in chunks of 50
  const chunkSize = 50;
  for (let i = 0; i < stale.length; i += chunkSize) {
    const chunk = stale.slice(i, i + chunkSize).map(p => `"${p}"`).join(",");
    try {
      await supabaseRequest("DELETE", `codebase_snapshot?file_path=in.(${chunk})`);
    } catch (e) {
      console.error("  Prune error:", e.message);
    }
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
