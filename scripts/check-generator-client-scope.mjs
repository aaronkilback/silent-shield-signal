#!/usr/bin/env node
// WO-PARTITION-01 (a): report-generator client-scope static guard.
// A report generator that reads signals/incidents/entities/beliefs WITHOUT a client_id (or
// tenant_id) predicate on that read is a cross-engagement contamination path. This greps the
// report-generating edge functions and flags any tenant-bearing `.from(<table>)` read that has
// no client_id/tenant_id predicate within its query chain.
//
// TRANSITIONAL / AUDIT-ONLY (audit-before-blocking doctrine): prints findings, exits 0. Promote
// to blocking (exit 1) only after the surfaced set is triaged and annotated. Long-term the real
// guarantee is a client-scoped retrieval seam, not a regex.
import { readFileSync, existsSync } from 'node:fs';

const GENERATORS = [
  'generate-executive-report', 'generate-report', 'generate-poi-report',
  'generate-security-briefing', 'generate-daily-briefing', 'generate-consortium-briefing',
  'generate-executive-report', 'send-daily-briefing',
];
const SCOPED_TABLES = ['signals', 'incidents', 'entities', 'entity_content', 'entity_mentions',
  'agent_beliefs', 'agent_investigation_memory', 'expert_knowledge'];

let findings = 0;
for (const fn of [...new Set(GENERATORS)]) {
  const path = `supabase/functions/${fn}/index.ts`;
  if (!existsSync(path)) continue;
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\.from\(['"]([a-z_]+)['"]\)/);
    if (!m || !SCOPED_TABLES.includes(m[1])) continue;
    // Look at the query chain: this line + next ~12 lines until the statement likely ends.
    const chain = lines.slice(i, Math.min(i + 13, lines.length)).join('\n');
    const scoped = /\.(eq|in|filter)\(\s*['"](client_id|tenant_id)['"]/.test(chain)
      || /\bincident_id\b/.test(chain); // transitively scoped via client-scoped incident ids
    if (!scoped) {
      findings++;
      console.log(`  UNSCOPED READ  ${fn}:${i + 1}  .from('${m[1]}') — no client_id/tenant_id predicate in chain`);
    }
  }
}
if (findings === 0) console.log("check-generator-client-scope: no unscoped generator reads found ✓");
else console.log(`check-generator-client-scope: ${findings} unscoped read(s) — AUDIT ONLY (not failing the build)`);
process.exit(0);
