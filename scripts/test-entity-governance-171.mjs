#!/usr/bin/env node
/**
 * #171 — Entity governance regression test
 *
 * Validates that the governance module rejects known-bad entity proposals
 * AND queues known-good ones. Runs against an already-deployed environment
 * by invoking the dashboard-ai-assistant `create_entity` tool via its
 * tool-call dispatch path (not via the chat AI, to keep results deterministic).
 *
 * For correlate-entities and extract-signal-insights we validate by SELECTing
 * recent entity_governance_events rows after triggering invocations.
 *
 * Usage:
 *   STAGING=1 node scripts/test-entity-governance-171.mjs
 *   PROD=1    node scripts/test-entity-governance-171.mjs   # only after staging green
 */

const STAGING_URL = 'https://lkvyrvuakzguszbpwnfz.supabase.co';
const PROD_URL    = 'https://kpuqukppbmwebiptqmog.supabase.co';

const isProd = !!process.env.PROD;
const isStaging = !!process.env.STAGING;
if (!isProd && !isStaging) {
  console.error('Set STAGING=1 or PROD=1');
  process.exit(2);
}

const SUPABASE_URL = isProd ? PROD_URL : STAGING_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env[isProd ? 'PROD_SERVICE_ROLE_KEY' : 'STAGING_SERVICE_ROLE_KEY'];
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY (or PROD/STAGING_SERVICE_ROLE_KEY) required');
  process.exit(2);
}

// ── Test fixtures ───────────────────────────────────────────────────────────
//
// `expected` = expected governance verdict.
// `reasons`  = optional substring(s) that must appear in rejection_reasons.

const FIXTURES = [
  // ── Should auto_reject: ideology/category names ──
  { name: 'Militant Far-Left / Anarchist Direct Action Networks', type: 'organization',
    description: 'A category of militant networks', relevance_reason: 'general threat',
    expected: 'auto_reject', reasons: ['ideology_or_movement'] },
  { name: 'Nationalist-13', type: 'organization',
    description: 'A nationalist movement', relevance_reason: 'threat',
    expected: 'auto_reject', reasons: ['vague_category'] },
  { name: 'ISIS Core', type: 'organization',
    description: 'Core ISIS leadership', relevance_reason: 'threat actor',
    expected: 'suggestion_queue' }, // ISIS Core is specific enough — passes (description ≥20)

  // ── Should auto_reject: vulnerability classes ──
  { name: 'Directory Traversal Vulnerability', type: 'organization',
    description: 'CVE-style vuln class', relevance_reason: 'cyber threat',
    expected: 'auto_reject', reasons: ['vulnerability_class'] },
  { name: 'Error Vulnerability', type: 'person',
    description: 'a vulnerability', relevance_reason: 'cyber',
    expected: 'auto_reject', reasons: ['vulnerability_class'] },

  // ── Should auto_reject: abstract events ──
  { name: 'World Cup', type: 'organization',
    description: 'The FIFA World Cup tournament event in 2026', relevance_reason: 'event',
    expected: 'auto_reject', reasons: ['abstract_event'] },
  { name: 'Games Draw', type: 'person',
    description: 'The draw event for the games', relevance_reason: 'event',
    expected: 'auto_reject', reasons: ['common_noun_denylisted'] },

  // ── Should auto_reject: common nouns / single common nouns ──
  { name: 'cloud services', type: 'organization',
    description: 'general cloud services category', relevance_reason: 'cyber',
    expected: 'auto_reject' },
  { name: 'Social Intelligence', type: 'organization',
    description: 'general social intelligence concept', relevance_reason: 'osint',
    expected: 'auto_reject', reasons: ['common_noun_denylisted'] },
  { name: 'protest', type: 'organization',
    description: 'a generic protest', relevance_reason: 'event',
    expected: 'auto_reject', reasons: ['single_common_noun'] },

  // ── Should auto_reject: missing description ──
  { name: 'Some Real Organization', type: 'organization',
    description: '', relevance_reason: 'a real reason',
    expected: 'auto_reject', reasons: ['description_required'] },
  { name: 'Specific Real Org', type: 'organization',
    description: 'short', relevance_reason: 'a real reason',
    expected: 'auto_reject', reasons: ['description_required'] },

  // ── Should suggestion_queue: legitimate candidates ──
  { name: 'Trent Reznor', type: 'person',
    description: 'Musician and CRT principal under protective service contract',
    relevance_reason: 'Active CRT protectee, named in security plan',
    expected: 'suggestion_queue' },
  { name: 'BC Place Stadium', type: 'location',
    description: 'Major Vancouver venue hosting FIFA 2026 matches and large events',
    relevance_reason: 'Venue under CRT protective coverage during World Cup window',
    expected: 'suggestion_queue' },
  { name: 'Coastal GasLink', type: 'organization',
    description: 'BC natural gas pipeline operator targeted by environmental activism',
    relevance_reason: 'Activist campaigns mentioned in monitoring keywords',
    expected: 'suggestion_queue' },
  { name: 'bcchildrens.ca', type: 'domain',
    description: '', // identifier types don't need description
    relevance_reason: 'Tenant monitored domain',
    expected: 'suggestion_queue' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function callDashboardAssistantTool(toolName, args) {
  // We invoke the function directly with a synthetic tool_call envelope.
  // The dashboard-ai-assistant function dispatches `args` through the same
  // governance path that AEGIS uses at runtime.
  const url = `${SUPABASE_URL}/functions/v1/dashboard-ai-assistant`;
  const body = {
    mode: 'tool_call_direct',
    tool_name: toolName,
    tool_args: args,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function queryGovernanceEvents(candidateName) {
  const url = `${SUPABASE_URL}/rest/v1/entity_governance_events?candidate_name=eq.${encodeURIComponent(candidateName)}&order=created_at.desc&limit=1`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`#171 governance test — target=${isProd ? 'PROD' : 'STAGING'}`);
  console.log('NOTE: requires dashboard-ai-assistant to support mode=tool_call_direct,');
  console.log('      or run the SQL-only mode (see below) for module-only validation.\n');

  // For now: SQL-only mode — directly query entity_governance_events.
  // Operator should populate events by exercising AEGIS (manually creating entities
  // via the assistant UI) using each fixture name. Then this script verifies the
  // governance verdict that was recorded.
  let pass = 0, fail = 0;
  for (const fx of FIXTURES) {
    const evt = await queryGovernanceEvents(fx.name);
    if (!evt) {
      console.log(`  ⊘ NO EVENT  ${fx.name}  (expected ${fx.expected})`);
      continue;
    }
    const verdictOk = evt.verdict === fx.expected;
    let reasonsOk = true;
    if (fx.reasons && evt.rejection_reasons) {
      reasonsOk = fx.reasons.every((r) => evt.rejection_reasons.some((er) => er.includes(r)));
    }
    if (verdictOk && reasonsOk) {
      pass++;
      console.log(`  ✓ ${fx.name}  →  ${evt.verdict}  (${(evt.rejection_reasons || []).join(',')})`);
    } else {
      fail++;
      console.log(`  ✗ ${fx.name}  got=${evt.verdict} expected=${fx.expected}  reasons=${(evt.rejection_reasons || []).join(',')}`);
    }
  }
  console.log(`\nResult: ${pass} pass / ${fail} fail / ${FIXTURES.length - pass - fail} no-event`);
  process.exit(fail === 0 ? 0 : 1);
})();
