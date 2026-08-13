#!/usr/bin/env node
// Prompt-hygiene audit (report-leak order, 2026-08-13). AUDIT-ONLY — always exit 0.
// Two detectors over prompt-bearing / client-facing edge functions:
//   1. Hardcoded client proper nouns (denylist seeded from the 2026-08-12 sweep).
//   2. Unscoped shared reads — `.from(<tenant/client table>)` with no tenant/client filter,
//      in a file that feeds a prompt or a client-facing answer. The roster, the COP scan
//      score, and the client query path were all this shape.
// Excludes tests, fixtures, search config, and the wildfire product (allowlisted single-client).
// TRANSITIONAL regex guard (see feedback_regex_ci_guards_are_transitional): the durable control
// is dynamic-per-client context + tenant-scoped reads; this catches regressions until then.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PROPER_NOUNS = [
  "PECL", "Petronas", "Progress Energy", "Coastal GasLink", "Ksi Lisims", "Uniper",
  "LNG Canada", "Clinton", "Montney", "Wet'suwet'en", "BCCH", "BC Children",
  "Cascade Energy", "Dan Martell", "Amar Doman",
];

// Tables that carry tenant/client facts — an unscoped read of these into a prompt/answer leaks.
const SCOPED_TABLES = [
  "signals", "incidents", "entities", "clients", "investigations", "entity_content",
  "entity_watch_list", "predictive_incident_scores", "autonomous_scan_results",
  "agent_beliefs", "agent_investigation_memory", "generated_reports", "reports",
];

// EXCLUDE: tests, fixtures, search/monitor config, wildfire product, probes, watchdog.
const EXCLUDE = [
  /\.test\.ts$/, /_test\.ts$/, /\/tests?\//,
  /_shared\/grounding\/.*(golden|fixture)/i,
  /_shared\/(keyword-matcher|news-domain-allowlist|shadow-matcher|deterministic-matcher|bcws)\.ts$/,
  /\/monitor-[^/]+\//,                          // monitor-* = search config / query builders
  /generate-wildfire-daily-report|agent-tools-wildfire|wildfire-portal-chat/,  // wildfire product (allowlisted)
  /redteam-injection-probe|semantic-agreement-probe|fortress-qa-agent|fortress-chaos-monkey/,
  /anti-hallucination.*test|-daily-test/,
  /system-watchdog/,
];

const files = execSync("git ls-files 'supabase/functions/**/*.ts'", { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.some((re) => re.test(f)));

const isCommentLine = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);
const nounFindings = [];
const readFindings = [];

for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detector 1 — proper nouns
    for (const n of PROPER_NOUNS) {
      if (line.includes(n)) {
        nounFindings.push({ file: f, line: i + 1, term: n, comment: isCommentLine(line), text: line.trim().slice(0, 110) });
      }
    }
    // Detector 2 — unscoped shared read
    const m = line.match(/\.from\((['"])([a-z_]+)\1\)/);
    if (m && SCOPED_TABLES.includes(m[2])) {
      const win = lines.slice(i, i + 16).join("\n").split(";")[0];
      const scoped = /\.(eq|in)\((['"])(tenant_id|client_id)\2/.test(win);
      const pointLookup = /\.(eq)\((['"])(id|signal_id)\2/.test(win) && /\.(single|maybeSingle)\(/.test(win);
      const isWrite = /\.(insert|update|upsert|delete)\(/.test(line);
      if (!scoped && !pointLookup && !isWrite) {
        readFindings.push({ file: f, line: i + 1, table: m[2], text: line.trim().slice(0, 110) });
      }
    }
  }
}

const promptNoun = nounFindings.filter((x) => !x.comment);
const commentNoun = nounFindings.filter((x) => x.comment);

console.log("═══ PROMPT-HYGIENE AUDIT (audit-only, non-blocking) ═══\n");
console.log(`Files scanned: ${files.length} (tests/fixtures/search-config/wildfire excluded)\n`);

console.log(`── Detector 1: hardcoded client proper nouns ──`);
console.log(`   In prompt/code (NON-comment): ${promptNoun.length}   |   In comments: ${commentNoun.length}\n`);
for (const x of promptNoun) console.log(`   ★ ${x.file}:${x.line}  [${x.term}]  ${x.text}`);
if (commentNoun.length) {
  console.log(`\n   (comments — informational, do not inject into prompts:)`);
  for (const x of commentNoun) console.log(`     · ${x.file}:${x.line}  [${x.term}]`);
}

console.log(`\n── Detector 2: unscoped shared reads (no tenant/client filter) ──`);
console.log(`   Candidates: ${readFindings.length}  (heuristic 16-line window; triage before acting)\n`);
for (const x of readFindings) console.log(`   ? ${x.file}:${x.line}  from(${x.table})  ${x.text}`);

console.log(`\n═══ SUMMARY ═══`);
console.log(`  Proper nouns in non-comment lines: ${promptNoun.length}  (target: 0)`);
console.log(`  Proper nouns in comments:          ${commentNoun.length}  (informational)`);
console.log(`  Unscoped shared-read candidates:   ${readFindings.length}  (triage list)`);
console.log(`\n  AUDIT-ONLY — exit 0 regardless. Promote to blocking after findings are triaged/annotated.`);
process.exit(0);
