#!/usr/bin/env node
/**
 * setup-e2e-totp.mjs — one-time: enroll a verified TOTP factor for the E2E
 * super_admin (_aegis_test_super) on STAGING, and push the shared secret straight
 * into the GitHub Actions secret E2E_TOTP_SECRET WITHOUT ever printing it.
 *
 * Why: the main-lineage app enforces MFA at login (Auth.tsx). The E2E UI-login test
 * (auth.spec.ts "valid credentials + TOTP …") completes the real MFA challenge with a
 * code derived from this secret — so MFA stays ENFORCED and the test is honest to real
 * users. (The fixture-injected tests bypass login and run in platform-admin mode.)
 *
 * Covers the TOTP branch only; SMS MFA is impractical to automate in CI.
 *
 * Run (password via hidden prompt, never echoed):
 *   read -s -p "staging _aegis_test_super password: " P; echo; \
 *     E2E_ENROLL_PASSWORD="$P" node scripts/setup-e2e-totp.mjs
 *
 * Requires: gh authenticated (repo secret write); otplib + @supabase/supabase-js (devDeps).
 * Idempotent: unenrolls any existing TOTP factor first so re-runs rotate cleanly.
 */
import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';
import { execFileSync } from 'node:child_process';

const URL = process.env.STAGING_SUPABASE_URL || 'https://lkvyrvuakzguszbpwnfz.supabase.co';
const KEY = process.env.STAGING_PUBLISHABLE_KEY || 'sb_publishable_DjuXy74FwjiYmkP89iyL2g_RH12Mjtq';
const EMAIL = process.env.E2E_USER_EMAIL || '_aegis_test_super@example.com';
const PASSWORD = process.env.E2E_ENROLL_PASSWORD;
const GH = process.env.GH_BIN || 'gh';
const REPO = process.env.E2E_REPO || 'aaronkilback/silent-shield-signal';

if (!PASSWORD) {
  console.error('✗ Set E2E_ENROLL_PASSWORD to the staging user password (use the hidden-prompt run line in the header).');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { error: signErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signErr) { console.error('✗ sign-in failed:', signErr.message); process.exit(1); }

// Deterministic: drop any pre-existing TOTP factor so the enrolled secret is the live one.
const { data: existing } = await sb.auth.mfa.listFactors();
for (const f of (existing?.all ?? [])) {
  if (f.factor_type === 'totp') { await sb.auth.mfa.unenroll({ factorId: f.id }); }
}

const { data: enroll, error: enrErr } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e-ci' });
if (enrErr) { console.error('✗ enroll failed:', enrErr.message); process.exit(1); }
const secret = enroll.totp.secret;

const { data: chal, error: chErr } = await sb.auth.mfa.challenge({ factorId: enroll.id });
if (chErr) { console.error('✗ challenge failed:', chErr.message); process.exit(1); }

const { error: vErr } = await sb.auth.mfa.verify({ factorId: enroll.id, challengeId: chal.id, code: authenticator.generate(secret) });
if (vErr) { console.error('✗ verify failed:', vErr.message); process.exit(1); }

// Push the secret straight to CI via stdin — never printed, never an argv entry.
try {
  execFileSync(GH, ['secret', 'set', 'E2E_TOTP_SECRET', '--repo', REPO], { input: secret, stdio: ['pipe', 'ignore', 'inherit'] });
} catch {
  console.error('✗ `gh secret set` failed — ensure gh is authenticated and on PATH (or set GH_BIN to its full path). Secret NOT set.');
  process.exit(1);
}

console.log(`✓ TOTP factor enrolled + verified for ${EMAIL}; E2E_TOTP_SECRET set (value never printed).`);
