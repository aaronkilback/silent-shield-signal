#!/usr/bin/env node
// Prompt-hygiene check (report-leak order, 2026-08-13).
//   Detector 1 (BLOCKING): hardcoded client proper nouns in prompt/code (non-comment) → exit 1.
//   Detector 2 (AUDIT-ONLY): unscoped shared reads → printed, never affects exit (needs a
//     classifier before it can gate — WO-UNSCOPED-READ-CLASSIFIER-01).
// Excludes tests, fixtures, search/routing config, and the wildfire product (allowlisted).
// TRANSITIONAL regex guard (see feedback_regex_ci_guards_are_transitional): the durable control
// is dynamic-per-client context + tenant-scoped reads; this catches regressions until then.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PROPER_NOUNS = [
  "PECL", "Petronas", "Progress Energy", "Coastal GasLink", "Ksi Lisims", "Uniper",
  "LNG Canada", "Clinton", "Montney", "Wet'suwet'en", "BCCH", "BC Children",
  "Cascade Energy", "Dan Martell", "Amar Doman",
];

// Context exclusions — a denylist token that is NOT the client here (acronym collision etc.).
// PECL as the Physical/Environmental/Cyber/Legal taxonomy is not the client "PECL".
const CONTEXT_EXCLUDE = [
  { term: "PECL", re: /PECL\s*\(\s*Physical/i },
];

const SCOPED_TABLES = [
  "signals", "incidents", "entities", "clients", "investigations", "entity_content",
  "entity_watch_list", "predictive_incident_scores", "autonomous_scan_results",
  "agent_beliefs", "agent_investigation_memory", "generated_reports", "reports",
];

const EXCLUDE = [
  /\.test\.ts$/, /_test\.ts$/, /\/tests?\//,
  /_shared\/grounding\/.*(golden|fixture)/i,
  /_shared\/(keyword-matcher|news-domain-allowlist|shadow-matcher|deterministic-matcher|bcws)\.ts$/,
  /\/monitor-[^/]+\//,                          // monitor-* = search config
  /\/ingest-email-intel\//,                     // email→client ROUTING config (not a prompt)
  /generate-wildfire-daily-report|agent-tools-wildfire|wildfire-portal-chat/,  // wildfire product (allowlisted)
  /process-geospatial-map/,                     // NOTE: Petronas-bespoke (writes petronas_assets); allowlist candidate
  /redteam-injection-probe|semantic-agreement-probe|fortress-qa-agent|fortress-chaos-monkey/,
  /anti-hallucination.*test|-daily-test/,
  /system-watchdog/,
];

function boundaryRegex(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // word/token boundary that tolerates the apostrophe/space inside multiword terms
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "g");
}
// Is the match at index `at` inside a comment? Line-leading // * /*, OR a // earlier on the line.
function inComment(line, at) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return true;
  const slashes = line.indexOf("//");
  return slashes !== -1 && slashes < at;
}

const files = execSync("git ls-files 'supabase/functions/**/*.ts'", { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !EXCLUDE.some((re) => re.test(f)));

const nounFindings = [];
const readFindings = [];

for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const n of PROPER_NOUNS) {
      const re = boundaryRegex(n);
      let m;
      while ((m = re.exec(line)) !== null) {
        const ctx = CONTEXT_EXCLUDE.find((c) => c.term === n);
        if (ctx && ctx.re.test(line.slice(Math.max(0, m.index - 2)))) continue; // acronym collision
        nounFindings.push({ file: f, line: i + 1, term: n, comment: inComment(line, m.index), text: line.trim().slice(0, 110) });
      }
    }
    const fm = line.match(/\.from\((['"])([a-z_]+)\1\)/);
    if (fm && SCOPED_TABLES.includes(fm[2])) {
      const win = lines.slice(i, i + 16).join("\n").split(";")[0];
      const scoped = /\.(eq|in)\((['"])(tenant_id|client_id)\2/.test(win);
      const pointLookup = /\.(eq)\((['"])(id|signal_id)\2/.test(win) && /\.(single|maybeSingle)\(/.test(win);
      const isWrite = /\.(insert|update|upsert|delete)\(/.test(line);
      if (!scoped && !pointLookup && !isWrite) readFindings.push({ file: f, line: i + 1, table: fm[2] });
    }
  }
}

const promptNoun = nounFindings.filter((x) => !x.comment);
const commentNoun = nounFindings.filter((x) => x.comment);

console.log("═══ PROMPT-HYGIENE CHECK ═══\n");
console.log(`Files scanned: ${files.length} (tests/fixtures/search+routing config/wildfire/geospatial excluded)\n`);

console.log(`── Detector 1 (BLOCKING): hardcoded client proper nouns ──`);
console.log(`   Non-comment (prompt/code): ${promptNoun.length}   |   Comments (informational): ${commentNoun.length}\n`);
for (const x of promptNoun) console.log(`   ✗ ${x.file}:${x.line}  [${x.term}]  ${x.text}`);
if (!promptNoun.length) console.log(`   ✓ zero proper nouns in prompt/code.`);

console.log(`\n── Detector 2 (AUDIT-ONLY, never blocks): unscoped shared reads ──`);
console.log(`   Candidates: ${readFindings.length}  (heuristic; triage via WO-UNSCOPED-READ-CLASSIFIER-01 before gating)\n`);

console.log(`═══ RESULT ═══`);
if (promptNoun.length > 0) {
  console.log(`  ✗ FAIL — ${promptNoun.length} hardcoded client proper noun(s) in a prompt/code line.`);
  console.log(`    Replace with \${client.name}-relative or client-neutral phrasing.`);
  process.exit(1);
}
console.log(`  ✓ PASS — Detector 1 clean. (Detector 2: ${readFindings.length} audit-only candidates, non-blocking.)`);
process.exit(0);
