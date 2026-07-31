#!/usr/bin/env node
// WO-CI-SECURITY-GATE-01 — deploy-path drift check.
// Edge functions can reach prod via MCP deploy / direct deploy without a PR (proven 2026-07-30).
// The PR gate is blind to those. This compares DEPLOYED functions against the repo and fails on any
// function deployed but absent from the repo (an orphan) that is not in drift-baseline.json.
//
// Requires SUPABASE_ACCESS_TOKEN (or ~/.supabase/access-token) + SUPABASE_PROJECT_REF.
// Usage: node scripts/security-gate/drift.mjs [--update-baseline]
//
// NOTE on version drift: the API exposes ezbr_sha256 (deployed bundle hash), but reproducing it
// locally needs Supabase's exact bundler, so content-equality vs main is not verifiable here.
// This check enforces the ORPHAN invariant (deployed ⊆ repo); content drift is a tracked gap.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const BASELINE = path.join(HERE, "drift-baseline.json");
const REF = process.env.SUPABASE_PROJECT_REF || "kpuqukppbmwebiptqmog";

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = path.join(os.homedir(), ".supabase/access-token");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  throw new Error("no SUPABASE_ACCESS_TOKEN and no ~/.supabase/access-token");
}

async function deployedSlugs() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`Management API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const list = await r.json();
  return list.filter((f) => f.status === "ACTIVE").map((f) => f.slug);
}

function repoSlugs() {
  const dir = path.join(ROOT, "supabase/functions");
  return fs.readdirSync(dir).filter((n) => !n.startsWith("_") && fs.existsSync(path.join(dir, n, "index.ts")));
}

const main = async () => {
  const deployed = new Set(await deployedSlugs());
  const repo = new Set(repoSlugs());
  const orphans = [...deployed].filter((s) => !repo.has(s)).sort();

  if (process.argv.includes("--update-baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify(orphans, null, 2) + "\n");
    console.log(`[drift] baseline written: ${orphans.length} deployed-but-absent orphans`);
    return;
  }

  const baseline = new Set(JSON.parse(fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, "utf8") : "[]"));
  const newOrphans = orphans.filter((s) => !baseline.has(s));

  console.log("── security-gate DRIFT ──");
  console.log(`deployed(ACTIVE): ${deployed.size}  repo: ${repo.size}  orphans: ${orphans.length}  baselined: ${baseline.size}`);
  if (newOrphans.length) {
    console.log(`\n❌ FAIL — ${newOrphans.length} function(s) deployed but ABSENT from repo (not in drift-baseline):`);
    for (const s of newOrphans) console.log(`  ${s}`);
    process.exit(1);
  }
  // ratchet: baseline may only shrink
  if (orphans.length > baseline.size) {
    console.log(`\n❌ FAIL — orphan count increased (${orphans.length} > ${baseline.size})`);
    process.exit(1);
  }
  console.log("\n✅ no NEW deploy-path drift (baselined orphans pending land-to-repo / de-provision)");
};

main().catch((e) => { console.error("drift check error:", e.message); process.exit(2); });
