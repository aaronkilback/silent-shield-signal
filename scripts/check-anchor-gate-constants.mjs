#!/usr/bin/env node
// Fails the build if the anchor-gate classification constants diverge between the shared TS module and
// the SQL migration. Documentation of the lockstep contract does not stop drift — this test does.
// Constants checked: BROKER_DOMAINS, CORROBORATION_MIN_DOMAINS, ADVERSE_CATEGORIES.
import fs from "node:fs";

const TS = "supabase/functions/_shared/exposure-anchor-gate.ts";
const SQL = "supabase/migrations/20260829120000_subject_exposure_identity_anchor_gate.sql";

const ts = fs.readFileSync(TS, "utf8");
const sql = fs.readFileSync(SQL, "utf8");
const fail = [];

// ── extract from TS ──
const tsBrokers = [...(ts.match(/export const BROKER_DOMAINS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const tsThreshold = Number(ts.match(/CORROBORATION_MIN_DOMAINS\s*=\s*(\d+)/)?.[1]);
const tsAdverse = [...(ts.match(/ADVERSE_CATEGORIES\s*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// ── extract from SQL (the c_brokers / c_corroboration_min / c_adverse literals) ──
const sqlBrokers = [...(sql.match(/c_brokers\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
const sqlThreshold = Number(sql.match(/c_corroboration_min\s+int\s*:=\s*(\d+)/)?.[1]);
const sqlAdverse = [...(sql.match(/c_adverse\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

const eqSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

if (tsBrokers.length === 0 || sqlBrokers.length === 0) fail.push(`could not parse broker lists (ts=${tsBrokers.length}, sql=${sqlBrokers.length})`);
else if (!eqSet(tsBrokers, sqlBrokers)) {
  const only = (a, b) => a.filter((x) => !b.includes(x));
  fail.push(`BROKER_DOMAINS diverge — TS-only: [${only(tsBrokers, sqlBrokers)}]  SQL-only: [${only(sqlBrokers, tsBrokers)}]`);
}
if (!Number.isFinite(tsThreshold) || tsThreshold !== sqlThreshold) fail.push(`CORROBORATION threshold: TS=${tsThreshold} SQL=${sqlThreshold}`);
if (tsAdverse.length === 0 || sqlAdverse.length === 0) fail.push(`could not parse adverse sets (ts=${tsAdverse.length}, sql=${sqlAdverse.length})`);
else if (!eqSet(tsAdverse, sqlAdverse)) {
  const only = (a, b) => a.filter((x) => !b.includes(x));
  fail.push(`ADVERSE_CATEGORIES diverge — TS-only: [${only(tsAdverse, sqlAdverse)}]  SQL-only: [${only(sqlAdverse, tsAdverse)}]`);
}

if (fail.length) {
  console.error("❌ anchor-gate constants DIVERGED between " + TS + " and the SQL migration:");
  for (const f of fail) console.error("   - " + f);
  console.error("Update BOTH so they match, or the DB and the renderer will classify differently.");
  process.exit(1);
}
console.log(`✅ anchor-gate constants agree: ${tsBrokers.length} brokers, threshold=${tsThreshold}, ${tsAdverse.length} adverse categories (TS ↔ SQL).`);
