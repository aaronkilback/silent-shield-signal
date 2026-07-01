import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationPath = join(root, 'supabase/migrations/20260701090000_client_membership_substrate_v1.sql');
const migration = readFileSync(migrationPath, 'utf8');
const compact = migration.replace(/\s+/g, ' ');

describe('client membership substrate migration contract', () => {
  it('creates the authoritative membership table with required role and status constraints', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.client_memberships');
    expect(migration).toContain('user_id uuid NOT NULL REFERENCES auth.users(id)');
    expect(migration).toContain('tenant_id uuid NOT NULL REFERENCES public.tenants(id)');
    expect(migration).toContain('client_id uuid NOT NULL');
    expect(migration).toContain("role text NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin', 'owner'))");
    expect(migration).toContain("status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked'))");
    expect(migration).toContain('revocation_reason text');
  });

  it('enforces client-to-tenant consistency with a composite client foreign key', () => {
    expect(migration).toContain('ADD CONSTRAINT clients_id_tenant_id_key UNIQUE (id, tenant_id)');
    expect(migration).toContain('CONSTRAINT client_memberships_client_tenant_fkey');
    expect(compact).toContain('FOREIGN KEY (client_id, tenant_id) REFERENCES public.clients(id, tenant_id)');
  });

  it('prevents duplicate active membership while allowing explicit multi-client access', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS client_memberships_one_active_per_user_client');
    expect(compact).toContain('ON public.client_memberships (user_id, client_id) WHERE status = \'active\'');
    expect(compact).not.toContain('UNIQUE (user_id)');
  });

  it('revokes authenticated write access and allows users to read only their own active memberships', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.client_memberships FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON public.client_memberships FROM anon');
    expect(migration).toContain('REVOKE ALL ON public.client_memberships FROM authenticated');
    expect(migration).toContain('GRANT SELECT ON public.client_memberships TO authenticated');
    expect(migration).toContain('CREATE POLICY "client_memberships_read_own_active"');
    expect(compact).toContain('auth.uid() = user_id AND status = \'active\'');
    expect(compact).not.toContain('FOR INSERT TO authenticated');
    expect(compact).not.toContain('FOR UPDATE TO authenticated');
    expect(compact).not.toContain('FOR DELETE TO authenticated');
  });

  it('creates an RLS-safe helper that derives identity from auth.uid only', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.has_active_client_membership(_client_id uuid)');
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
    expect(compact).toContain('WHERE cm.user_id = auth.uid() AND cm.client_id = _client_id AND cm.status = \'active\'');
    expect(migration).not.toContain('has_active_client_membership(_user_id');
    expect(compact.toLowerCase()).not.toContain('from public.profiles');
    expect(compact.toLowerCase()).not.toContain('join public.profiles');
  });

  it('requires a super-admin-only RPC for membership writes and sets audit fields server-side', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.manage_client_membership');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
    expect(migration).toContain('v_actor uuid := auth.uid()');
    expect(migration).toContain('NOT public.is_super_admin(v_actor)');
    expect(migration).toContain('created_by');
    expect(migration).toContain('updated_by');
    expect(migration).toContain('revoked_by = v_actor');
    expect(migration).toContain("RAISE EXCEPTION 'client membership management requires super_admin'");
  });

  it('prevents self-grant, self-activation, self-revocation, and client reassignment through table writes', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.client_memberships_guard_immutable()');
    expect(migration).toContain('NEW.client_id IS DISTINCT FROM OLD.client_id');
    expect(migration).toContain('NEW.tenant_id IS DISTINCT FROM OLD.tenant_id');
    expect(migration).toContain('NEW.user_id IS DISTINCT FROM OLD.user_id');
    expect(migration).toContain('client_memberships immutable fields cannot be changed');
    expect(migration).toContain('CREATE TRIGGER client_memberships_guard_immutable_trg');
  });

  it('keeps pending and revoked memberships out of the canonical helper', () => {
    expect(compact).toContain("cm.status = 'active'");
    expect(compact).not.toContain("cm.status IN ('pending', 'active')");
    expect(compact).not.toContain("cm.status <> 'revoked'");
  });

  it('does not switch existing intelligence RLS or service-role read paths in this slice', () => {
    expect(migration).not.toContain('ALTER TABLE public.signals');
    expect(migration).not.toContain('ALTER TABLE public.incidents');
    expect(migration).not.toContain('ALTER TABLE public.entities');
    expect(migration).not.toContain('ALTER TABLE public.reports');
    expect(migration).not.toContain('CREATE POLICY "signals');
    expect(migration).not.toContain('CREATE POLICY "incidents');
  });

  it('documents non-executed backfill rules and denies ambiguous users by default', () => {
    const doc = readFileSync(join(root, 'docs/reliability/client-membership-substrate-v1.md'), 'utf8');
    expect(doc).toContain('No membership is backfilled automatically');
    expect(doc).toContain('Users in tenants with more than one client are ambiguous and must be denied by default');
    expect(doc).toContain('profiles.client_id');
    expect(doc).toContain('not an authorization source');
  });

  it('keeps behavioral proof in a real PostgreSQL service workflow with no remote Supabase secrets', () => {
    const workflow = readFileSync(join(root, '.github/workflows/client-membership-substrate.yml'), 'utf8');

    expect(workflow).toContain('postgres:16.4-alpine');
    expect(workflow).toContain('services:');
    expect(workflow).toContain('psql -v ON_ERROR_STOP=1 -f scripts/client-membership-substrate/behavioral-test.sql');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('supabase/migrations/20260701090000_client_membership_substrate_v1.sql');
    expect(workflow).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(workflow).not.toContain('SUPABASE_DB_PASSWORD');
    expect(workflow).not.toContain('secrets.');
  });

  it('runs the actual migration inside the PostgreSQL behavioral harness', () => {
    const harness = readFileSync(join(root, 'scripts/client-membership-substrate/behavioral-test.sql'), 'utf8');

    expect(harness).toContain('\\i supabase/migrations/20260701090000_client_membership_substrate_v1.sql');
    expect(harness).toContain('CREATE SCHEMA auth');
    expect(harness).toContain('CREATE OR REPLACE FUNCTION auth.uid()');
    expect(harness).toContain('CREATE ROLE anon NOLOGIN');
    expect(harness).toContain('CREATE ROLE authenticated NOLOGIN');
    expect(harness).toContain('CREATE ROLE service_role BYPASSRLS NOLOGIN');
    expect(harness).toContain('SET ROLE authenticated');
    expect(harness).toContain('SET ROLE anon');
    expect(harness).toContain('SET ROLE public_probe');
    expect(harness).toContain('SET ROLE service_role');
    expect(harness).toContain('service_role bypasses user-facing RLS and can see all fixture memberships');
    expect(harness).toContain('mismatched client_id and tenant_id fails through composite foreign key');
    expect(harness).toContain('migration does not add intelligence table policies');
  });
});
