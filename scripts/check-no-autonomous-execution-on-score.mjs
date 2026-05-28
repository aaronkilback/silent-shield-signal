#!/usr/bin/env node
// scripts/check-no-autonomous-execution-on-score.mjs
//
// Workstream D — CI gate (audit-only on first ship per the
// audit-before-blocking-CI-guards policy).
//
// Statically asserts that no code path mutates user-visible state based on a
// confidence-score-threshold crossing. This is the structural guarantee that
// D cannot accidentally enable autonomous execution.
//
// Rules:
//   1. `consideration.executed` must never be assigned `true` anywhere in the
//      codebase. The TS literal `false` on the type itself is the primary
//      guard; this is the secondary grep.
//   2. `consideration.requires_operator_approval` must never be assigned
//      `false`.
//   3. No pattern like `if (axes.* > THRESHOLD) { /* mutating call */ }` where
//      the mutating call is one of the action verbs we know about.
//
// Audit-only: prints findings and exits 0 unless --strict is passed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const STRICT = process.argv.includes("--strict");

const SCAN_DIRS = ["supabase/functions", "src"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const ALLOW_FILES = new Set([
  // The gate is exempt from itself.
  "scripts/check-no-autonomous-execution-on-score.mjs",
  // Test files demonstrating the rule may reference the patterns.
  "scripts/test-workstream-d-confidence.mjs",
  // The ADR contains banned-pattern *examples* as documentation.
  "docs/platform-operations/architecture-decisions/workstream-d-confidence-and-provenance-layers.md",
]);

const ACTION_VERBS = [
  "executeAction",
  "performAction",
  "applyMutation",
  "writeSignal",
  "deleteEntity",
  "mergeEntities",
  "collapseCluster",
];

const findings = [];

function walk(dir, accum) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, accum);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(name)) accum.push(full);
  }
}

const files = [];
for (const d of SCAN_DIRS) {
  try { walk(join(repoRoot, d), files); } catch { /* dir may not exist */ }
}

const rxExecutedTrue       = /\bconsideration\s*\.\s*executed\s*[:=]\s*true\b/;
const rxRequiresApprovFalse = /\brequires_operator_approval\s*[:=]\s*false\b/;
// Two-step check (split to keep regex parens balanced):
//   1. find lines that branch on `axes.<numeric_axis> <op> <number>`
//   2. flag if any action verb appears within ~400 chars on the same/next lines
const AXES_NAMES = ["corroboration", "provenance_quality", "freshness", "trajectory_confidence", "composite", "score"];
const rxAxisBranch = new RegExp(
  String.raw`if\s*\([^)]*\.\s*(?:` + AXES_NAMES.join("|") + String.raw`)\s*[><]=?\s*[\d.]+`,
);
const rxActionVerbWindow = new RegExp(String.raw`\b(?:` + ACTION_VERBS.join("|") + String.raw`)\s*\(`);

for (const f of files) {
  const rel = f.slice(repoRoot.length + 1);
  if (ALLOW_FILES.has(rel)) continue;
  const src = readFileSync(f, "utf8");

  if (rxExecutedTrue.test(src)) {
    findings.push({ file: rel, rule: "R-executed-true", note: "consideration.executed = true is banned (invariant)" });
  }
  if (rxRequiresApprovFalse.test(src)) {
    findings.push({ file: rel, rule: "R-requires-approval-false", note: "requires_operator_approval = false is banned (invariant)" });
  }
  // Find each axis-branch line, then look at a ~400-char window for a banned action verb call.
  let m;
  const reAll = new RegExp(rxAxisBranch.source, "g");
  while ((m = reAll.exec(src)) !== null) {
    const window = src.slice(m.index, m.index + 400);
    if (rxActionVerbWindow.test(window)) {
      findings.push({ file: rel, rule: "R-score-gated-mutation", note: "mutating call inside an axis-threshold branch — autonomous execution risk" });
      break; // one finding per file is enough
    }
  }
}

if (findings.length === 0) {
  console.log("✓ check-no-autonomous-execution-on-score: no violations found");
  process.exit(0);
}

console.error(`✗ check-no-autonomous-execution-on-score: ${findings.length} finding(s):`);
for (const v of findings) {
  console.error(`  • [${v.rule}] ${v.file} — ${v.note}`);
}
if (STRICT) process.exit(1);
console.error("(audit-only mode — exiting 0; promote to --strict after triage)");
process.exit(0);
