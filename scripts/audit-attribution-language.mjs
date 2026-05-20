#!/usr/bin/env node
/**
 * Attribution-language audit.
 * Greps the codebase for definitive-attribution phrasing that could expose
 * Silent Shield to defamation / negligent-misrepresentation claims when AEGIS
 * outputs correlations between entities or accounts.
 *
 * Read-only by default. To auto-rewrite high-confidence cases, pass --apply.
 *
 * Usage:
 *   node scripts/audit-attribution-language.mjs
 *   node scripts/audit-attribution-language.mjs --apply
 *   node scripts/audit-attribution-language.mjs --paths src/components,src/pages
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const pathsArg = process.argv.find((a) => a.startsWith("--paths="));
const SEARCH_PATHS = pathsArg
  ? pathsArg.slice("--paths=".length).split(",")
  : [
      "src/",
      "supabase/functions/",
      "supabase/migrations/",  // SQL strings can leak risky copy too
    ];

// ── Risky patterns ──────────────────────────────────────────────────────────
// Each entry: { match: RegExp, severity: "high"|"medium", suggest: string|null }
// Severity high = definitive attribution that should not appear without
// extraordinary evidence. Severity medium = ambiguous; review case-by-case.
const PATTERNS = [
  // === High-severity: definitive attribution ===
  { match: /\bconfirmed actor\b/gi, severity: "high", suggest: "behavioral correlation indicator" },
  { match: /\bidentified (?:as )?(?:the )?same actor\b/gi, severity: "high", suggest: "observed pattern consistency" },
  { match: /\battribution certainty\b/gi, severity: "high", suggest: "confidence-based similarity" },
  { match: /\bdefinitively (?:linked|identified|associated|connected)\b/gi, severity: "high", suggest: "shows confidence-based correlation with" },
  { match: /\bproven (?:link|connection|match|association)\b/gi, severity: "high", suggest: "confidence-based correlation" },
  { match: /\bsame_actor\s*:\s*true\b/g, severity: "high", suggest: null /* code; review manually */ },
  { match: /\bis_same_actor\b/g, severity: "high", suggest: null },
  // === Medium-severity: needs hedging ===
  { match: /\b(?:is|are) the same person\b/gi, severity: "medium", suggest: "shows behavioral consistency with the same person" },
  { match: /\bconfirmed (?:match|link|identity)\b/gi, severity: "medium", suggest: "high-confidence correlation" },
  { match: /\battribution (?:is|=)\s*['"]?confirmed['"]?/gi, severity: "medium", suggest: null },
  { match: /\bbelongs to (?:the )?same (?:actor|individual)\b/gi, severity: "medium", suggest: "correlates with the same actor based on behavioral indicators" },
];

// Helper: list source files via git ls-files (respects .gitignore).
function listFiles() {
  try {
    const out = execSync(
      `git ls-files -- ${SEARCH_PATHS.map((p) => `'${p}'`).join(" ")}`,
      { encoding: "utf8", cwd: process.cwd() }
    );
    return out
      .split("\n")
      .filter(Boolean)
      .filter((f) => /\.(ts|tsx|js|jsx|sql|md)$/.test(f));
  } catch (e) {
    console.error("git ls-files failed:", e.message);
    return [];
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────
const files = listFiles();
const findings = [];
let totalHits = 0;

for (const file of files) {
  let body;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  let modified = body;
  let fileTouched = false;

  for (const { match, severity, suggest } of PATTERNS) {
    match.lastIndex = 0;
    const re = new RegExp(match.source, match.flags);
    let m;
    while ((m = re.exec(body)) !== null) {
      totalHits++;
      const lineStart = body.lastIndexOf("\n", m.index) + 1;
      const lineEnd = body.indexOf("\n", m.index);
      const line = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd).trim();
      const lineNumber = body.slice(0, m.index).split("\n").length;
      findings.push({
        file,
        line: lineNumber,
        severity,
        matched: m[0],
        suggest,
        context: line.slice(0, 200),
      });
    }

    if (APPLY && suggest) {
      const replaceRe = new RegExp(match.source, match.flags);
      if (replaceRe.test(modified)) {
        modified = modified.replace(replaceRe, suggest);
        fileTouched = true;
      }
    }
  }

  if (APPLY && fileTouched) {
    writeFileSync(file, modified);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const highCount = findings.filter((f) => f.severity === "high").length;
const mediumCount = findings.filter((f) => f.severity === "medium").length;

console.log(`Attribution-language audit — ${APPLY ? "APPLIED" : "read-only report"}`);
console.log(`Scanned ${files.length} files across: ${SEARCH_PATHS.join(", ")}`);
console.log(`Total hits: ${totalHits}  (high: ${highCount}, medium: ${mediumCount})`);
console.log("");

if (totalHits === 0) {
  console.log("No risky attribution phrasing found. Codebase clean for the current pattern set.");
  process.exit(0);
}

const byFile = {};
for (const f of findings) {
  (byFile[f.file] = byFile[f.file] || []).push(f);
}
for (const [file, hits] of Object.entries(byFile)) {
  console.log(`── ${file}`);
  for (const h of hits) {
    const tag = h.severity === "high" ? "HIGH  " : "med   ";
    const suggestion = h.suggest ? `  → suggest: "${h.suggest}"` : "  (manual review — code identifier)";
    console.log(`  ${tag} L${h.line}  ${h.matched}${suggestion}`);
    console.log(`         ${h.context}`);
  }
  console.log("");
}

if (!APPLY) {
  console.log("Re-run with --apply to auto-rewrite high-confidence text replacements.");
  console.log("(Code identifiers like 'is_same_actor' are NEVER auto-rewritten — they need a hand-pass.)");
}
