#!/usr/bin/env node
/**
 * Staging load-fixture assertion.
 *
 * Asserts that the high-keyword realistic-load fixture exists on staging at
 * the cardinality required to actually exercise monitor function code paths.
 * Without this, staging green is meaningless for monitor changes — PROD-G v1
 * illustrated the cost (passed staging with 5 thin clients, SIGKILLed
 * immediately on prod where PECL has 34 keywords and BCCH has 43).
 *
 * This is a mandatory pre-deploy check for any monitor function change.
 * See CLAUDE.md > Staging Load Fixtures for the surrounding policy.
 *
 * Required env vars:
 *   SUPABASE_STAGING_URL                — https://lkvyrvuakzguszbpwnfz.supabase.co
 *   SUPABASE_STAGING_SERVICE_ROLE_JWT   — staging service-role JWT
 *
 * Invariants asserted:
 *   - The fixture client exists by stable UUID (Petronas Canada on staging)
 *   - status = 'active'
 *   - array_length(monitoring_keywords, 1) >= MIN_KEYWORDS (30)
 *
 * Usage:
 *   node scripts/check-staging-load-fixture.mjs
 *
 * Exit codes:
 *   0 — fixture present and meets the cardinality contract
 *   1 — fixture missing, inactive, or below threshold
 *   2 — env vars missing or staging unreachable
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_STAGING_URL;
const KEY = process.env.SUPABASE_STAGING_SERVICE_ROLE_JWT;

// Stable identifier for the staging Petronas Canada client. If this fixture
// is ever deleted, recreate it by inserting a clients row with this id,
// status='active', and at least 30 entries in monitoring_keywords (a copy
// of production PECL's keyword list is acceptable). Document the re-seed in
// CLAUDE.md if the canonical fixture identity ever changes.
const FIXTURE_CLIENT_ID = '0f5c809d-60ec-4252-b94b-1f4b6c8ac95d';
const FIXTURE_NAME_HINT = 'Petronas Canada';
const MIN_KEYWORDS = 30;

if (!URL || !KEY) {
  console.error('check-staging-load-fixture: missing env vars');
  console.error('  Required: SUPABASE_STAGING_URL, SUPABASE_STAGING_SERVICE_ROLE_JWT');
  console.error('  Set them in your shell or .env before running this check.');
  process.exit(2);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('clients')
  .select('id, name, status, monitoring_keywords')
  .eq('id', FIXTURE_CLIENT_ID)
  .maybeSingle();

if (error) {
  console.error('check-staging-load-fixture: query failed:', error.message);
  process.exit(2);
}

if (!data) {
  console.error('check-staging-load-fixture: FAIL — fixture client missing');
  console.error(`  Expected id: ${FIXTURE_CLIENT_ID} (${FIXTURE_NAME_HINT})`);
  console.error('  See CLAUDE.md > Staging Load Fixtures for re-seed instructions.');
  process.exit(1);
}

if (data.status !== 'active') {
  console.error(`check-staging-load-fixture: FAIL — fixture status is "${data.status}", expected "active"`);
  console.error(`  Re-activate client ${FIXTURE_CLIENT_ID} or update the fixture spec.`);
  process.exit(1);
}

const kwCount = Array.isArray(data.monitoring_keywords) ? data.monitoring_keywords.length : 0;
if (kwCount < MIN_KEYWORDS) {
  console.error(`check-staging-load-fixture: FAIL — only ${kwCount} monitoring_keywords (min ${MIN_KEYWORDS})`);
  console.error(`  Top up monitoring_keywords on client ${FIXTURE_CLIENT_ID}.`);
  console.error('  Staging with thin keyword loads cannot exercise per-query budget paths.');
  process.exit(1);
}

console.log(`check-staging-load-fixture: ✓ ${data.name} (${kwCount} keywords, status=active)`);
process.exit(0);
