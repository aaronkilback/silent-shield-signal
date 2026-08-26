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
  /process-geospatial-map/,                     // Petronas-bespoke single-client tool (writes petronas_assets); documented + allowlisted, like wildfire
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
const fabFindings = [];

// Detector 3 (WO-CONFIDENCE-SIGNAL-INTEGRITY-01): a citation marker, reliability figure, or
// confidence percentage rendered as a LITERAL — not derived from a computed value or resolved
// source. Rule: if nothing computes it, it does not render.
const FAB_PATTERNS = [
  { kind: "citation-marker", re: /\[S\d+\]/g },                                  // [S1], [S2] literals ([S${…}] excluded)
  { kind: "reliability-figure", re: /Reliability(?:\s+Score)?:?\s*\d+\s*%/gi },   // "Reliability: 100%"
  { kind: "confidence-pct", re: /\d+\s*%\s*confidence|confidence:?\s*\d+\s*%/gi }, // "85% confidence"
];
// Exclude PROHIBITION rules (forbid the pattern), the belt-and-braces stripper, and THRESHOLD
// descriptions ("entries below 50% confidence" is a computed filter, not a decorative claim).
const FAB_ALLOW = /\bdo not\b|\bdon't\b|\bnever\b|\bmust not\b|do NOT|🚫|\.replace\(|not invent|\bbelow\b|\babove\b|\bthreshold\b|[<>]=?\s*\d/i;

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
    // Detector 3 — fabricated confidence/citation signals
    if (!/^\s*(\/\/|\*|\/\*)/.test(line) && !FAB_ALLOW.test(line)) {
      for (const p of FAB_PATTERNS) {
        const re = new RegExp(p.re.source, p.re.flags);
        let fm3;
        while ((fm3 = re.exec(line)) !== null) {
          if (inComment(line, fm3.index)) continue;
          fabFindings.push({ file: f, line: i + 1, kind: p.kind, match: fm3[0].trim(), text: line.trim().slice(0, 110) });
        }
      }
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

console.log(`── Detector 3 (BLOCKING): fabricated confidence/citation signals ──`);
console.log(`   Hits: ${fabFindings.length}  (citation markers / reliability figures / confidence % not from a computed value or resolved source)\n`);
for (const x of fabFindings) console.log(`   ✗ ${x.file}:${x.line}  [${x.kind}: ${x.match}]  ${x.text}`);
if (!fabFindings.length) console.log(`   ✓ zero fabricated confidence/citation signals.`);

console.log(`\n═══ RESULT ═══`);
if (promptNoun.length > 0 || fabFindings.length > 0) {
  if (promptNoun.length > 0) {
    console.log(`  ✗ FAIL — ${promptNoun.length} hardcoded client proper noun(s) in a prompt/code line.`);
    console.log(`    Replace with \${client.name}-relative or client-neutral phrasing.`);
  }
  if (fabFindings.length > 0) {
    console.log(`  ✗ FAIL — ${fabFindings.length} fabricated confidence/citation signal(s).`);
    console.log(`    A confidence, reliability, verification count, or citation marker rendered to a user`);
    console.log(`    MUST derive from a computed value or a resolved source. If nothing computes it, it does not render.`);
  }
  process.exit(1);
}
console.log(`  ✓ PASS — Detector 1 clean. (Detector 2: ${readFindings.length} audit-only candidates, non-blocking.)`);
process.exit(0);
