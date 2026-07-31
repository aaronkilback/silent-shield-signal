#!/usr/bin/env node
// WO-CI-SECURITY-GATE-01 — fail-closed security gate. AST-based (TypeScript compiler API).
// Usage: node scripts/security-gate/run.mjs            (gate mode: fail on new/changed violations)
//        node scripts/security-gate/run.mjs --update-baseline
//        node scripts/security-gate/run.mjs --json
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, check1, check2, check3, check4Migration } from "./checks/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const FUNCS_DIR = path.join(ROOT, "supabase/functions");
const MIGR_DIR = path.join(ROOT, "supabase/migrations");
const CONFIG = path.join(ROOT, "supabase/config.toml");
const ALLOWLIST_PATH = path.join(HERE, "public-endpoints.json");
const BASELINE_PATH = path.join(HERE, "baseline.json");

const key = (v) => `${v.check}|${v.file}|${v.symbol}`;
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

// verify_jwt=false set from config.toml (line scan of [functions.X] blocks).
function verifyJwtFalseSet() {
  const txt = readIf(CONFIG) || "";
  const set = new Set();
  let cur = null;
  for (const line of txt.split("\n")) {
    const b = line.match(/^\s*\[functions\.([a-z0-9-]+)\]/i);
    if (b) { cur = b[1]; continue; }
    if (cur && /^\s*verify_jwt\s*=\s*false/.test(line)) set.add(cur);
  }
  return set;
}

// Exemption: // @security-exempt(check2): reason — 2026-07-31   (greppable, must carry a reason)
function exemptedChecks(source) {
  const set = new Set();
  const re = /@security-exempt\((check[1-4])\)\s*:\s*.+?—\s*\d{4}-\d{2}-\d{2}/g;
  let m; while ((m = re.exec(source)) !== null) set.add(m[1]);
  return set;
}

export function scanFile(fileName, source) {
  const sf = parse(fileName, source);
  let v = [...check2(fileName, sf), ...check3(fileName, sf)];
  const ex = exemptedChecks(source);
  return v.filter((x) => !ex.has(x.check));
}

function scanAll() {
  const violations = [];
  // checks 2 & 3 over edge functions
  for (const d of fs.readdirSync(FUNCS_DIR)) {
    if (d.startsWith("_")) continue;
    const idx = path.join(FUNCS_DIR, d, "index.ts");
    if (!fs.existsSync(idx)) continue;
    violations.push(...scanFile(`supabase/functions/${d}/index.ts`, fs.readFileSync(idx, "utf8")));
  }
  // check 1 over config.toml + allowlist
  const allow = new Set((JSON.parse(readIf(ALLOWLIST_PATH) || "[]")).map((e) => e.function));
  for (const fn of verifyJwtFalseSet()) violations.push(...check1(fn, true, allow.has(fn)));
  // check 4 over migrations
  if (fs.existsSync(MIGR_DIR)) {
    for (const f of fs.readdirSync(MIGR_DIR)) {
      if (!f.endsWith(".sql")) continue;
      const src = fs.readFileSync(path.join(MIGR_DIR, f), "utf8");
      if (exemptedChecks(src).has("check4")) continue;
      violations.push(...check4Migration(`supabase/migrations/${f}`, src));
    }
  }
  return violations;
}

function changedFiles() {
  const base = process.env.SECURITY_GATE_BASE || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null);
  if (!base) return null;
  try {
    return new Set(execSync(`git diff --name-only ${base}...HEAD`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean));
  } catch { return null; }
}

function countsByCheck(list) {
  const c = { check1: 0, check2: 0, check3: 0, check4: 0 };
  for (const v of list) c[v.check] = (c[v.check] || 0) + 1;
  return c;
}

function main() {
  const args = process.argv.slice(2);
  const current = scanAll();

  if (args.includes("--update-baseline")) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current.map(key).sort(), null, 2) + "\n");
    const c = countsByCheck(current);
    console.log(`[security-gate] baseline written: ${current.length} violations (check1 ${c.check1}, check2 ${c.check2}, check3 ${c.check3}, check4 ${c.check4})`);
    return;
  }

  const baseline = new Set(JSON.parse(readIf(BASELINE_PATH) || "[]"));
  const changed = changedFiles();

  const isNew = (v) => !baseline.has(key(v));
  const inChanged = (v) => changed && changed.has(v.file);

  const newV = current.filter(isNew);
  const changedV = current.filter((v) => !isNew(v) && inChanged(v)); // baselined but in a touched file → must fix

  // ratchet: per-check current must never exceed baseline count
  const baseCounts = countsByCheck([...baseline].map((k) => { const [check, file, symbol] = k.split("|"); return { check, file, symbol }; }));
  const curCounts = countsByCheck(current);
  const ratchetBreaches = Object.keys(curCounts).filter((c) => curCounts[c] > baseCounts[c]);

  if (args.includes("--json")) { console.log(JSON.stringify({ current, newV, changedV, baseCounts, curCounts }, null, 2)); }

  console.log("── WO-CI-SECURITY-GATE-01 ──");
  console.log(`baseline counts:  check1 ${baseCounts.check1}  check2 ${baseCounts.check2}  check3 ${baseCounts.check3}  check4 ${baseCounts.check4}  (total ${baseline.size})`);
  console.log(`current counts:   check1 ${curCounts.check1}  check2 ${curCounts.check2}  check3 ${curCounts.check3}  check4 ${curCounts.check4}  (total ${current.length})`);

  let failed = false;
  if (newV.length) {
    failed = true;
    console.log(`\nFAIL — ${newV.length} NEW violation(s) not in baseline:`);
    for (const v of newV) console.log(`  [${v.check}] ${v.file} :: ${v.symbol} (L${v.line}) — ${v.detail}`);
  }
  if (changedV.length) {
    failed = true;
    console.log(`\nFAIL — ${changedV.length} violation(s) in changed files must be fixed (no longer grandfathered):`);
    for (const v of changedV) console.log(`  [${v.check}] ${v.file} :: ${v.symbol} (L${v.line}) — ${v.detail}`);
  }
  if (ratchetBreaches.length) {
    failed = true;
    console.log(`\nFAIL — baseline ratchet breached (count increased): ${ratchetBreaches.join(", ")}`);
  }
  console.log(failed ? "\n❌ security-gate FAILED" : "\n✅ security-gate PASSED (no new or changed-file violations)");
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
