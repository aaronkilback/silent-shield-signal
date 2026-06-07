#!/usr/bin/env node
/**
 * A1 — Tier-1 Retrieval-Boundary Guard Pack (minimal, warn-only).
 *
 * Prevents the highest-frequency cross-tenant retrieval regressions from
 * reaching prod. Deterministic, sub-minute, no LLMs, no realtime, no fixtures.
 *
 * Checks:
 *   A1.1  null-tenant invariant          (DB, read-only)  — broken derive / missing stamp
 *   A1.2  service-role + request-id gate  (static)         — generate-poi-report class
 *   A1.5  verify_jwt drift                (static)         — gateway-auth flip
 *   A1.6  retrieval RPC purity            (DB, read-only)  — match_ / find_similar tenant scope
 *
 * Modes:
 *   default  = WARN-ONLY (always exit 0; prints findings + writes a1-report.json)
 *   --enforce = exit 1 on any BLOCKING finding (for later promotion to a gate)
 *
 * DB checks are skipped (with a notice, not a failure) when no *_DB_URL_RO env
 * is provided — so static checks always run on forks/local without secrets.
 *
 * Escape hatch (everywhere): `// @tenant-safe: <reason>` inline, or an entry in
 * security/a1-allowlist.json / security/verify-jwt-allowlist.json.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ENFORCE = process.argv.includes("--enforce");
const findings = [];
const notices = [];
const rel = (p) => relative(ROOT, p);

function add(check, severity, location, detail, remediation) {
  findings.push({ check, severity, location, detail, remediation });
}
function loadJSON(p, fallback) {
  try { return JSON.parse(readFileSync(join(ROOT, p), "utf8")); } catch { return fallback; }
}
function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { if (name !== "node_modules") walk(full, filter, out); }
    else if (filter(full)) out.push(full);
  }
  return out;
}
function psql(url, sql) {
  // returns array of rows (each row = array of columns), or null on failure
  try {
    const out = execFileSync("psql", [url, "-tAF", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.split("\n").filter((l) => l.length).map((l) => l.split(""));
  } catch (e) {
    notices.push(`psql failed: ${String(e.stderr || e.message).slice(0, 200)}`);
    return null;
  }
}

const allow = loadJSON("security/a1-allowlist.json", {
  serviceRoleGate: { allow: [] }, rpcPurity: { allow: [] }, nullTenant: { grace: [] },
});
const GATE_RE = /getCallerIdentity|resolveUserCaller|canAccessOwned|userCanAccessClient|getAccessibleClientIds|validateTenantAccess/;

// ── A1.2 — service-role + request-id without a caller gate (static) ──────────
function checkServiceRoleGate() {
  const fnDir = join(ROOT, "supabase/functions");
  const files = walk(fnDir, (f) => f.endsWith("/index.ts"));
  for (const f of files) {
    const fn = rel(f).split("/")[2]; // supabase/functions/<fn>/index.ts
    if (allow.serviceRoleGate.allow.includes(fn)) continue;
    const src = readFileSync(f, "utf8");
    const usesService = /createServiceClient\s*\(|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_JWT/.test(src);
    // Precise leak signal (generate-poi-report class): a TENANT-SCOPING id read
    // FROM the request body — not just any "*_id" mentioned anywhere in the file.
    // Matches: `const { ..., client_id } = await req.json()`,
    //          `const body = await req.json(); ... body.client_id`,
    //          `(await req.json()).tenant_id`.
    const ID = "(?:client_?id|clientId|tenant_?id|tenantId|entity_id|entityId|incident_id|incidentId)";
    const destructuredFromBody = new RegExp(`\\{[^}]*\\b${ID}\\b[^}]*\\}\\s*=\\s*await\\s+req\\.json\\s*\\(`, "i");
    const inlineFromBody = new RegExp(`\\(\\s*await\\s+req\\.json\\s*\\(\\s*\\)\\s*\\)\\s*\\.\\s*${ID}\\b`, "i");
    let readsBodyTenantId = destructuredFromBody.test(src) || inlineFromBody.test(src);
    // `const body = await req.json()` then later `body.client_id` / `payload.tenant_id`
    const bodyVar = src.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+req\.json\s*\(/);
    if (!readsBodyTenantId && bodyVar) {
      readsBodyTenantId = new RegExp(`\\b${bodyVar[1]}\\s*\\.\\s*${ID}\\b`, "i").test(src);
    }
    const hasGate = GATE_RE.test(src);
    const tenantSafe = /@tenant-safe/.test(src);
    if (usesService && readsBodyTenantId && !hasGate && !tenantSafe) {
      add("A1.2", "BLOCKING", `${rel(f)}`,
        "service-role + request-supplied id with no caller gate (generate-poi-report class).",
        "Add getCallerIdentity(req) (401 on unauthorized) + canAccessOwned()/userCanAccessClient() before reading tenant data; or `// @tenant-safe: <reason>` for trusted internal/cron callers; or add to security/a1-allowlist.json serviceRoleGate.allow.");
    }
  }
}

// parse `[functions.NAME] ... verify_jwt = true|false` from config.toml
function parseConfigVerifyJwt() {
  const cfgPath = join(ROOT, "supabase/config.toml");
  if (!existsSync(cfgPath)) return null;
  const cfg = readFileSync(cfgPath, "utf8");
  const configMap = {};
  let cur = null;
  for (const line of cfg.split("\n")) {
    const m = line.match(/^\s*\[functions\.([A-Za-z0-9_-]+)\]/);
    if (m) { cur = m[1]; continue; }
    if (cur) {
      const v = line.match(/^\s*verify_jwt\s*=\s*(true|false)/);
      if (v) { configMap[cur] = v[1] === "true"; cur = null; }
      else if (/^\s*\[/.test(line)) cur = null;
    }
  }
  return configMap;
}

// `--baseline-jwt`: snapshot current config.toml truth into the allowlist so the
// drift check starts GREEN and only FUTURE flips fire. Run once on adoption, then
// review the file in the same PR. Functions on disk relying on the platform
// default are recorded too (so a later config addition reads as a conscious flip).
function baselineVerifyJwt() {
  const configMap = parseConfigVerifyJwt();
  if (!configMap) { console.log("config.toml not found; nothing to baseline."); process.exit(1); }
  const out = {
    _doc: "BASELINE generated by `node scripts/security/a1/run.mjs --baseline-jwt` from config.toml. Each entry = the intended verify_jwt. A1.5 fails when config.toml drifts from this file. After a deliberate flip, re-run --baseline-jwt (or hand-edit) in the SAME PR. Review every value; this snapshot captures current truth, which the 2026-06-07 audit validated for the retrieval-boundary functions.",
  };
  for (const [fn, val] of Object.entries(configMap).sort()) out[fn] = val;
  writeFileSync(join(ROOT, "security/verify-jwt-allowlist.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`Baselined ${Object.keys(configMap).length} functions → security/verify-jwt-allowlist.json`);
  process.exit(0);
}
if (process.argv.includes("--baseline-jwt")) baselineVerifyJwt();

// ── A1.5 — verify_jwt drift (static) ────────────────────────────────────────
function checkVerifyJwtDrift() {
  const configMap = parseConfigVerifyJwt();
  if (!configMap) { notices.push("config.toml not found; A1.5 skipped"); return; }
  const allowlist = loadJSON("security/verify-jwt-allowlist.json", {});
  for (const [fn, val] of Object.entries(configMap)) {
    if (!(fn in allowlist)) {
      add("A1.5", "BLOCKING", `supabase/config.toml [functions.${fn}]`,
        `verify_jwt=${val} present in config but not declared in the allowlist.`,
        `Add "${fn}": ${val} to security/verify-jwt-allowlist.json with a reason (forces a conscious decision).`);
    } else if (allowlist[fn] !== val) {
      add("A1.5", "BLOCKING", `supabase/config.toml [functions.${fn}]`,
        `verify_jwt drift: config=${val}, allowlist=${allowlist[fn]}.`,
        `If intentional, update security/verify-jwt-allowlist.json in this PR; else revert the config change.`);
    }
  }
  // functions on disk relying on the platform default (not in config) must be declared too
  const fnDir = join(ROOT, "supabase/functions");
  if (existsSync(fnDir)) {
    for (const name of readdirSync(fnDir)) {
      if (!statSync(join(fnDir, name)).isDirectory() || name.startsWith("_")) continue;
      if (!(name in configMap) && !(name in allowlist)) {
        add("A1.5", "WARN", `supabase/functions/${name}`,
          "function not in config.toml (uses platform default) and not declared in the allowlist.",
          `Add "${name}": <expected verify_jwt> to security/verify-jwt-allowlist.json.`);
      }
    }
  }
}

// ── DB helpers: pick configured environments ────────────────────────────────
function dbEnvs() {
  const envs = [];
  if (process.env.STAGING_DB_URL_RO) envs.push(["staging", process.env.STAGING_DB_URL_RO]);
  if (process.env.PROD_DB_URL_RO) envs.push(["prod", process.env.PROD_DB_URL_RO]);
  return envs;
}

// ── A1.1 — null-tenant invariant (DB) ───────────────────────────────────────
function checkNullTenant() {
  const envs = dbEnvs();
  if (!envs.length) { notices.push("no *_DB_URL_RO set; A1.1 (null-tenant) skipped"); return; }
  const sql = `
    WITH t AS (
      SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='client_id'
      INTERSECT
      SELECT table_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name='tenant_id')
    SELECT t.table_name,
      (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) c FROM public.%I WHERE client_id IS NOT NULL AND tenant_id IS NULL', t.table_name),
        false, true, '')))[1]::text::int AS violators
    FROM t ORDER BY 1;`;
  for (const [env, url] of envs) {
    const rows = psql(url, sql);
    if (rows === null) continue;
    for (const [table, vio] of rows) {
      const n = parseInt(vio || "0", 10);
      if (n > 0 && !(allow.nullTenant.grace || []).includes(table)) {
        add("A1.1", "BLOCKING", `${env}:public.${table}`,
          `${n} client-owned row(s) with NULL tenant_id (broken derive-trigger or missing stamp).`,
          "Fix the writer/derive-trigger; backfill tenant_id from client_id; re-run. See the null-tenant watchdog.");
      }
    }
  }
}

// ── A1.6 — retrieval RPC purity (DB) ────────────────────────────────────────
function checkRpcPurity() {
  const envs = dbEnvs();
  if (!envs.length) { notices.push("no *_DB_URL_RO set; A1.6 (RPC purity) skipped"); return; }
  for (const [env, url] of envs) {
    const tblRows = psql(url, `SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('client_id','tenant_id') GROUP BY table_name;`);
    if (tblRows === null) continue;
    const tenantTables = new Set(tblRows.map((r) => r[0]));
    const fnRows = psql(url, `SELECT p.proname, p.prosecdef::text, replace(replace(replace(lower(pg_get_functiondef(p.oid)), E'\\n',' '), E'\\t',' '), chr(1),' ')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.prosecdef OR p.proname ~ '^(match_|find_similar)');`);
    if (fnRows === null) continue;
    for (const [name, secdef, body] of fnRows) {
      if ((allow.rpcPurity.allow || []).includes(name)) continue;
      const isFamily = /^(match_|find_similar)/.test(name);
      const readsTenantTable = [...tenantTables].some((t) => new RegExp(`from\\s+(public\\.)?${t}\\b|join\\s+(public\\.)?${t}\\b`).test(body));
      if (!isFamily && !readsTenantTable) continue; // SECURITY DEFINER that touches no tenant table
      const hasFailClosed = /tenant_id\s+is\s+not\s+null/.test(body) || /client_id\s*=\s*any\s*\(/.test(body);
      const hasGlobalOrNull = /or\s+\w*client_id\s+is\s+null/.test(body) || /or\s+scope_client_id\s+is\s+null/.test(body);
      if (isFamily && (!hasFailClosed || hasGlobalOrNull)) {
        add("A1.6", "BLOCKING", `${env}:public.${name}()`,
          hasGlobalOrNull ? "retrieval RPC contains a global OR-client-null path (cross-tenant)."
                          : "retrieval RPC missing a fail-closed tenant/client predicate.",
          "Restore `tenant_id IS NOT NULL AND tenant_id = _param` (or `client_id = ANY(_param)`); remove any `OR <col> IS NULL`. Allowlist in security/a1-allowlist.json rpcPurity.allow only if intentionally global.");
      } else if (!isFamily && readsTenantTable && !hasFailClosed && !/tenant_id\s*=|client_id\s*=|client_id\s+in\b/.test(body)) {
        add("A1.6", "WARN", `${env}:public.${name}() [SECURITY DEFINER]`,
          "SECURITY DEFINER function reads a tenant-owned table with no tenant/client predicate.",
          "Add a tenant/client predicate bound to a parameter, or allowlist if intentionally global.");
      }
    }
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
checkServiceRoleGate();
checkVerifyJwtDrift();
checkNullTenant();
checkRpcPurity();

const blocking = findings.filter((f) => f.severity === "BLOCKING");
const warns = findings.filter((f) => f.severity === "WARN");

console.log("\n=== A1 Retrieval-Boundary Guard Pack (warn-only) ===");
for (const f of findings) {
  console.log(`\n${f.severity === "BLOCKING" ? "❌" : "⚠️ "} ${f.severity} [${f.check}]`);
  console.log(`   Location: ${f.location}`);
  console.log(`   Detail:   ${f.detail}`);
  console.log(`   Fix:      ${f.remediation}`);
}
for (const n of notices) console.log(`\nℹ️  ${n}`);
console.log(`\nSummary: ${blocking.length} blocking, ${warns.length} warn, ${notices.length} notice(s).`);
writeFileSync(join(ROOT, "a1-report.json"), JSON.stringify({ blocking: blocking.length, warns: warns.length, findings, notices }, null, 2));

if (ENFORCE && blocking.length > 0) {
  console.log("\nMode: ENFORCE → failing build on blocking findings.");
  process.exit(1);
}
console.log(`\nMode: WARN-ONLY → exit 0 (set --enforce to gate).`);
process.exit(0);
