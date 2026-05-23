#!/usr/bin/env node
/**
 * Branch 2A.2 (P0.1) — ingest-signal contract probe tests.
 *
 * Regression guard for #256 Phase 1 (2026-05-23) contract hardening. The
 * tenant-boundary contract is:
 *   - missing client_id + missing tenant_broadcast    → 400 missing_client_id
 *   - tenant_broadcast (until Phase 3)                → 501 broadcast_not_implemented
 *   - valid client_id (with auth)                      → success (200/202)
 *   - malformed client_id (non-UUID)                   → 400 zod validation reject
 *
 * Each probe asserts BOTH the HTTP status AND the response body shape. Probe
 * 3 additionally asserts the success path is NOT silently downgraded into the
 * rejection path — explicit NOT-assertions on `reason === 'missing_client_id'`
 * and `ticket === '#256'` per the Branch 2A spec.
 *
 * Required env vars:
 *   SUPABASE_STAGING_URL                — https://lkvyrvuakzguszbpwnfz.supabase.co
 *   SUPABASE_STAGING_SERVICE_ROLE_JWT   — staging service-role JWT
 *
 * Usage:
 *   node scripts/check-ingest-signal-contract.mjs
 *
 * Exit codes:
 *   0 — all 4 probes pass
 *   1 — at least one probe failed; failure detail printed
 *   2 — env vars missing or staging unreachable
 */

const URL_BASE = process.env.SUPABASE_STAGING_URL;
const JWT = process.env.SUPABASE_STAGING_SERVICE_ROLE_JWT;

// Staging Petronas Canada — canonical valid client_id (also the load fixture).
const VALID_CLIENT_ID = '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d';

if (!URL_BASE || !JWT) {
  console.error('check-ingest-signal-contract: missing env vars');
  console.error('  Required: SUPABASE_STAGING_URL, SUPABASE_STAGING_SERVICE_ROLE_JWT');
  process.exit(2);
}

const FUNCTION_URL = `${URL_BASE.replace(/\/$/, '')}/functions/v1/ingest-signal`;

// Stable probe marker so cleanup can target our test rows without scanning by
// title prefix or heuristics. Cleanup is by captured id only — see end of file.
const PROBE_RUN_ID = `branch2a-contract-probe-${Date.now()}`;

async function post(body) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JWT}`,
      'apikey': JWT,
    },
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = { _parseError: true };
  }
  return { status: res.status, body: parsed };
}

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${name}${detail ? `  — ${detail}` : ''}`);
}

console.log(`check-ingest-signal-contract: target=${FUNCTION_URL}`);
console.log(`  probe run id: ${PROBE_RUN_ID}\n`);

// ─────────────────────────────────────────────────────────────────────────
// PROBE 1 — no client_id + no tenant_broadcast → 400 missing_client_id
// ─────────────────────────────────────────────────────────────────────────
console.log('PROBE 1 — no client_id + no tenant_broadcast');
{
  const r = await post({
    source_key: 'qa.branch2a.contract',
    text: `Branch 2A contract probe (no client). marker=${PROBE_RUN_ID} probe=1`,
    url: 'https://example.com/branch2a-probe-1',
    source_url: 'https://example.com/branch2a-probe-1',
  });
  const statusOk = r.status === 400;
  const reasonOk = r.body?.reason === 'missing_client_id';
  const ticketOk = r.body?.ticket === '#256';
  record('status === 400', statusOk, `got ${r.status}`);
  record("body.reason === 'missing_client_id'", reasonOk, `got ${JSON.stringify(r.body?.reason)}`);
  record("body.ticket === '#256'", ticketOk, `got ${JSON.stringify(r.body?.ticket)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// PROBE 2 — tenant_broadcast (until #256 Phase 3) → 501
// ─────────────────────────────────────────────────────────────────────────
console.log('\nPROBE 2 — tenant_broadcast scope=all_active_tenants');
{
  const r = await post({
    source_key: 'qa.branch2a.contract',
    text: `Branch 2A contract probe (broadcast). marker=${PROBE_RUN_ID} probe=2`,
    url: 'https://example.com/branch2a-probe-2',
    source_url: 'https://example.com/branch2a-probe-2',
    tenant_broadcast: { scope: 'all_active_tenants' },
  });
  const statusOk = r.status === 501;
  const reasonOk = r.body?.reason === 'broadcast_not_implemented';
  const ticketOk = r.body?.ticket === '#256';
  record('status === 501', statusOk, `got ${r.status}`);
  record("body.reason === 'broadcast_not_implemented'", reasonOk, `got ${JSON.stringify(r.body?.reason)}`);
  record("body.ticket === '#256'", ticketOk, `got ${JSON.stringify(r.body?.ticket)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// PROBE 3 — valid explicit client_id → NOT contract-rejected.
// Per Branch 2A spec: explicitly assert NOT missing_client_id AND NOT
// ticket #256. The success branch must not silently fall through into a
// rejection-shaped response. We do NOT require status === 200 because the
// function may return 200 (accepted), 202 (queued), or another success-class
// code depending on dedup / gate outcomes; what we DO require is that the
// response is unambiguously not the missing_client_id rejection.
// ─────────────────────────────────────────────────────────────────────────
console.log('\nPROBE 3 — valid client_id (success path NOT silently rejected)');
{
  const r = await post({
    source_key: 'qa.branch2a.contract',
    text: `Branch 2A contract probe (valid client). marker=${PROBE_RUN_ID} probe=3 — synthetic test signal, safe to discard.`,
    url: 'https://example.com/branch2a-probe-3',
    source_url: 'https://example.com/branch2a-probe-3',
    client_id: VALID_CLIENT_ID,
    is_test: true,
  });
  const statusOk = r.status >= 200 && r.status < 400;
  const notMissingClient = r.body?.reason !== 'missing_client_id';
  const notTicket256 = r.body?.ticket !== '#256';
  record('status 2xx/3xx (not rejection)', statusOk, `got ${r.status}`);
  record("body.reason !== 'missing_client_id'", notMissingClient, `got ${JSON.stringify(r.body?.reason)}`);
  record("body.ticket !== '#256'", notTicket256, `got ${JSON.stringify(r.body?.ticket)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// PROBE 4 — malformed client_id (not a UUID) → zod validation reject 400
// Distinguishes "type contract violated" from "ownership contract violated".
// Both should reject; their reasons must NOT collide. Specifically, probe 4
// must NOT yield `reason === 'missing_client_id'` (the value was present, it
// was malformed — different defect class).
// ─────────────────────────────────────────────────────────────────────────
console.log('\nPROBE 4 — malformed client_id (non-UUID string)');
{
  const r = await post({
    source_key: 'qa.branch2a.contract',
    text: `Branch 2A contract probe (malformed client). marker=${PROBE_RUN_ID} probe=4`,
    url: 'https://example.com/branch2a-probe-4',
    source_url: 'https://example.com/branch2a-probe-4',
    client_id: 'not-a-uuid',
  });
  const statusOk = r.status === 400;
  const notMissingClient = r.body?.reason !== 'missing_client_id';
  record('status === 400', statusOk, `got ${r.status}`);
  record("body.reason !== 'missing_client_id' (different defect class)", notMissingClient, `got ${JSON.stringify(r.body?.reason)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\ncheck-ingest-signal-contract: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length > 0) {
  console.error(`  FAILED:`);
  for (const f of failed) console.error(`    - ${f.name}  (${f.detail})`);
  process.exit(1);
}
console.log('  ✓ all assertions passed');
process.exit(0);
