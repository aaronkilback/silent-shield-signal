#!/usr/bin/env node
/**
 * setup-invariant-users.mjs
 *
 * One-time setup for the tenant-isolation invariant test
 * (src/test/security/tenant-isolation.invariant.test.ts).
 *
 * Creates two auth users in the live Supabase project:
 *   - invariant_a@silentshieldsecurity.invariant  → analyst in tenant A
 *   - invariant_b@silentshieldsecurity.invariant  → analyst in tenant B
 *
 * The fixture tenants/clients themselves are seeded by migration
 * 20260519160000_invariant_isolation_fixtures.sql.
 *
 * Idempotent — re-runnable. Skips users that already exist; doesn't
 * rotate passwords on existing users (so CI secrets stay stable).
 *
 * Usage:
 *   VITE_SUPABASE_URL=https://kpuqukppbmwebiptqmog.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
 *   INVARIANT_USER_A_PASSWORD='<choose any random string>' \
 *   INVARIANT_USER_B_PASSWORD='<choose any random string>' \
 *   node scripts/setup-invariant-users.mjs
 *
 * After running, add the four resulting credentials to GitHub Actions
 * Secrets under the names the test reads:
 *   TEST_INVARIANT_USER_A_EMAIL = invariant_a@silentshieldsecurity.invariant
 *   TEST_INVARIANT_USER_A_PASSWORD = <the value you set above>
 *   TEST_INVARIANT_USER_B_EMAIL = invariant_b@silentshieldsecurity.invariant
 *   TEST_INVARIANT_USER_B_PASSWORD = <the value you set above>
 *
 * Why bcrypt-via-admin-API and not direct auth.users INSERT?
 *   Supabase's auth schema also writes auth.identities, raw_app_meta_data,
 *   etc., that direct DDL would skip. The admin API is the supported path.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD_A = process.env.INVARIANT_USER_A_PASSWORD;
const PASSWORD_B = process.env.INVARIANT_USER_B_PASSWORD;

if (!URL || !SECRET) {
  console.error(
    "❌ VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}
if (!PASSWORD_A || !PASSWORD_B) {
  console.error(
    "❌ INVARIANT_USER_A_PASSWORD and INVARIANT_USER_B_PASSWORD are required.\n" +
      "   Choose any sufficiently random string (≥24 chars). These same\n" +
      "   values must be added to GitHub Actions secrets as\n" +
      "   TEST_INVARIANT_USER_A_PASSWORD and TEST_INVARIANT_USER_B_PASSWORD.",
  );
  process.exit(1);
}

const TENANT_A = "11111111-aaaa-4aaa-aaaa-000000000001";
const TENANT_B = "22222222-bbbb-4bbb-bbbb-000000000002";
const EMAIL_A = "invariant_a@silentshieldsecurity.invariant";
const EMAIL_B = "invariant_b@silentshieldsecurity.invariant";

const sb = createClient(URL, SECRET, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // listUsers is paginated; we have very few invariant users so a single
  // page is plenty. Bump perPage if you ever have many.
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users.find((u) => u.email === email) ?? null;
}

async function ensureUser(email, password, tenantId, label) {
  let user = await findUserByEmail(email);
  if (user) {
    console.log(`✓ ${label}: user ${email} already exists (id=${user.id})`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { fixture: true, invariant_isolation_test: true },
    });
    if (error) throw new Error(`createUser ${email} failed: ${error.message}`);
    user = data.user;
    console.log(`✓ ${label}: created ${email} (id=${user.id})`);
  }

  // Ensure tenant_users membership (analyst role)
  const { data: existingTu } = await sb
    .from("tenant_users")
    .select("id")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingTu) {
    const { error: tuErr } = await sb
      .from("tenant_users")
      .insert({ user_id: user.id, tenant_id: tenantId, role: "analyst" });
    if (tuErr) throw new Error(`tenant_users insert failed: ${tuErr.message}`);
    console.log(`  + tenant_users row (analyst @ ${tenantId})`);
  } else {
    console.log(`  · tenant_users row already present`);
  }

  // Ensure platform user_roles 'analyst'
  const { data: existingUr } = await sb
    .from("user_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "analyst")
    .maybeSingle();
  if (!existingUr) {
    const { error: urErr } = await sb
      .from("user_roles")
      .insert({ user_id: user.id, role: "analyst" });
    if (urErr) throw new Error(`user_roles insert failed: ${urErr.message}`);
    console.log(`  + user_roles row (analyst)`);
  } else {
    console.log(`  · user_roles row already present`);
  }

  return user.id;
}

const userAId = await ensureUser(EMAIL_A, PASSWORD_A, TENANT_A, "User A");
const userBId = await ensureUser(EMAIL_B, PASSWORD_B, TENANT_B, "User B");

console.log("");
console.log("Done. Add these to GitHub Actions Secrets:");
console.log("  TEST_INVARIANT_USER_A_EMAIL    = " + EMAIL_A);
console.log("  TEST_INVARIANT_USER_A_PASSWORD = <the value you just supplied>");
console.log("  TEST_INVARIANT_USER_B_EMAIL    = " + EMAIL_B);
console.log("  TEST_INVARIANT_USER_B_PASSWORD = <the value you just supplied>");
console.log("");
console.log("User A id: " + userAId);
console.log("User B id: " + userBId);
