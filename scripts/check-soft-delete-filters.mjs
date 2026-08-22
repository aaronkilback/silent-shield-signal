#!/usr/bin/env node
/**
 * Soft-delete / retire filter gate (WO-LEAK-SWEEP, 2026-08-21). AUDIT-ONLY for now (always exit 0);
 * promote to blocking once the client-facing worklist reaches zero.
 *
 * Rule: every READ (.from(table).select) of a soft-deletable table must EITHER call its named helper
 * (src/lib | _shared soft-delete-filters.ts) OR carry an explicit `// @soft-delete-exempt: <reason>`
 * marker naming why it is deliberately unfiltered. The EXEMPTION is the per-call marker ONLY — there is
 * no path-based auto-exemption, so a client surface added inside a monitor directory is still flagged.
 *
 * Paths are used ONLY to LABEL a violation client-facing-vs-other in the report (a reporting lens), never
 * to decide exemption. `--list` prints the client-facing worklist.
 *
 * ── THE RULE for an ambiguous read (ratified 2026-08-21) ──────────────────────────────────────────────
 * A read that ASKS "does this already exist?" is EXEMPT — deleted and merged rows are part of the answer.
 *   - "does an entity with this name exist?" (create/dedup): filtering would MISS a merged-away record and
 *     create a duplicate. Exempt — AND it must follow merged_into to the live survivor, never return the
 *     tombstone id (exemption without the follow makes it worse, not better).
 *   - "have I seen this content_hash before?" (ingest/dedup): a quarantined signal HAS been seen; filtering
 *     would let deliberately-quarantined content return on the next ingest. Exempt.
 * A read that SHOWS rows to a human is FILTERED (call the helper). Existence is not display.
 * When exempting, the @soft-delete-exempt reason must say which of these it is.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TABLES = {
  signals: "excludeDeletedSignals",
  incidents: "excludeDeletedIncidents",
  entities: "excludeMergedEntities",
  subject_exposure_items: "excludeSupersededExposure",
};
const ROOTS = ["src", "supabase/functions"];
const EXEMPT = "@soft-delete-exempt";
// Reporting lens only (NOT exemption): where a human sees the rows / an edge fn serves a client surface.
const CLIENT_FACING = /(^|\/)(src\/(components|pages|hooks)\/|supabase\/functions\/(generate-|send-daily-briefing|deliver-subject-exposure|view-subject-exposure|subject-exposure|dashboard-ai-assistant|agent-chat|briefing))/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (!/node_modules|dist|\.git/.test(p)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith("soft-delete-filters.ts")) out.push(p);
  }
  return out;
}

const fromRe = /\.from\(\s*['"](signals|incidents|entities|subject_exposure_items)['"]\s*\)/;
const writeRe = /\.(insert|update|delete|upsert)\s*\(/;
const violations = [];

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fromRe);
    if (!m) continue;
    const table = m[1];
    // Skip writes: an insert/update/delete/upsert within 2 lines of .from is a write, not a read.
    if (writeRe.test(lines[i]) || writeRe.test(lines[i + 1] || "") || writeRe.test(lines[i + 2] || "")) continue;
    // Backward window of 6 lines so a multi-line `@soft-delete-exempt: <reason>` comment above the read is
    // still detected (the reason often needs 2-4 lines). Forward window covers the statement body.
    const win = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 18)).join("\n");
    if (!/\.select\s*\(/.test(win)) continue;      // not a read
    const helper = TABLES[table];
    if (win.includes(helper)) continue;            // calls the named helper
    if (win.includes(EXEMPT)) continue;            // explicitly, reviewably exempt
    violations.push({ file, line: i + 1, table, helper, clientFacing: CLIENT_FACING.test(file) });
  }
}

const cf = violations.filter((v) => v.clientFacing);
console.log(`[soft-delete-gate] AUDIT-ONLY — ${violations.length} read(s) neither call the named helper nor carry ${EXEMPT}.`);
for (const t of Object.keys(TABLES)) {
  const vt = violations.filter((v) => v.table === t);
  console.log(`  ${t.padEnd(23)} ${String(vt.length).padStart(3)}  (client-facing ${vt.filter((v) => v.clientFacing).length}, other ${vt.filter((v) => !v.clientFacing).length})  -> ${TABLES[t]}`);
}
console.log(`  CLIENT-FACING to fix: ${cf.length}   |   OTHER (mark ${EXEMPT} or fix): ${violations.length - cf.length}`);
if (process.argv.includes("--list")) for (const v of cf) console.log(`    ${v.file}:${v.line} [${v.table}] needs ${v.helper}`);
process.exit(0); // audit-only
