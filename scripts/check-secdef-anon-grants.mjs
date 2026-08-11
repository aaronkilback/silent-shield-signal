#!/usr/bin/env node
// check-secdef-anon-grants — pre-apply guard against anon-EXECUTE-able SECURITY DEFINER functions.
//
// Provenance: INC-GEO-ANON-EXPOSURE (2026-08-11). client_geo_points() shipped SECURITY DEFINER and
// returned every active client's asset lat/lon (incl. household school/residence coords) to the anon
// key for ~21.75h. Probe 2f (agent-sentinel) caught it AFTER apply. This guard catches it BEFORE.
//
// THE TRAP this exists to catch: Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, and
// `anon` inherits through PUBLIC. Revoking the named role `anon` (or `authenticated`) is NOT enough —
// you MUST `revoke ... from public`. The failing migration did `revoke ... from anon, authenticated`
// and left PUBLIC intact. So this guard requires, per SECURITY DEFINER function: a `revoke ... from
// ... public` naming it, AND no `grant execute ... to public|anon`.
//
// Transitional regex guard (see feedback_regex_ci_guards_are_transitional). The durable backstops are
// the migration template (convention) + Probe 2f (after-apply). This is the before-apply net.
// Trigger functions (`returns trigger`) are exempt — not RPC-exposed.
//
// Usage: node scripts/check-secdef-anon-grants.mjs [file1.sql file2.sql ...]   (default: all migrations)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = 'supabase/migrations';
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).map((f) => join(MIG_DIR, f));

const violations = [];

for (const path of files) {
  let sql;
  try { sql = readFileSync(path, 'utf8'); } catch { continue; }
  const lower = sql.toLowerCase();

  // Find every CREATE [OR REPLACE] FUNCTION <name> ... and inspect its header up to the body ($$).
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = fnRe.exec(sql)) !== null) {
    const name = m[1];
    // Header = from the CREATE to the first $$ (or 1000 chars) — where SECURITY DEFINER / RETURNS live.
    const header = sql.slice(m.index, sql.indexOf('$$', m.index) === -1 ? m.index + 1000 : sql.indexOf('$$', m.index)).toLowerCase();
    if (!/security\s+definer/.test(header)) continue;      // only SECURITY DEFINER matters
    if (/returns\s+trigger/.test(header)) continue;        // trigger fns are not RPC-exposed

    // REQUIRE a revoke naming this function whose FROM clause includes `public`.
    const revokeFromPublic = new RegExp(
      `revoke[^;]*\\bfunction\\b[^;]*\\b${name}\\b[^;]*\\bfrom\\b[^;]*\\bpublic\\b`, 'i'
    ).test(sql);
    if (!revokeFromPublic) {
      violations.push(`${path}: SECURITY DEFINER function "${name}" has no \`revoke ... from ... public\` — ` +
        `anon inherits EXECUTE via PUBLIC. Add: revoke execute on function public.${name}(...) from anon, public;`);
    }
  }

  // FORBID any explicit grant of EXECUTE to public/anon on a function.
  const grantRe = /grant\s+execute\s+on\s+function[^;]*\bto\b[^;]*?\b(public|anon)\b/gi;
  let g;
  while ((g = grantRe.exec(sql)) !== null) {
    violations.push(`${path}: explicit \`grant execute ... to ${g[1]}\` on a function — never grant function EXECUTE to ${g[1]}.`);
  }
}

if (violations.length) {
  console.error('❌ FAIL — anon-EXECUTE-able SECURITY DEFINER function(s) in migrations:\n');
  for (const v of violations) console.error('  • ' + v);
  console.error(`\n${violations.length} violation(s). A SECURITY DEFINER function must revoke EXECUTE from PUBLIC ` +
    `(not just anon). This is the INC-GEO-ANON-EXPOSURE trap.`);
  process.exit(1);
}
console.log(`✅ PASS — ${files.length} migration file(s) scanned; no SECURITY DEFINER function missing a public revoke.`);
