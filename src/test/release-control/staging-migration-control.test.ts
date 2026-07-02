import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIXED_MANIFEST_PATH,
  PERMITTED_MUTATION_COMMAND,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertAfterHistory,
  assertPreflightHistory,
  loadManifest,
  parseMigrationList,
  pendingVersions,
  validateManifest,
} from '../../../scripts/release-control/staging-migration-control.mjs';

describe('staging migration control packet', () => {
  it('binds the fixed manifest to the approved staging project and exact migration bytes', () => {
    const manifest = loadManifest();
    const proof = validateManifest(manifest);

    expect(manifest.target.project_ref).toBe(STAGING_PROJECT_REF);
    expect(manifest.target.source_of_truth).toBe('docs/PROD_BASELINE.md');
    expect(manifest.disallowed_targets).toContainEqual({
      environment: 'production',
      project_ref: PRODUCTION_PROJECT_REF,
    });
    expect(manifest.migration.path).toBe('supabase/migrations/20260701090000_client_membership_substrate_v1.sql');
    expect(manifest.migration.version).toBe('20260701090000');
    expect(manifest.migration.sha256).toBe('84f30c728f59fbf7ed044f003474f6606d000ae95d9929c95db764925a7c6afa');
    expect(proof.migrationHash).toBe(manifest.migration.sha256);
  });

  it('does not accept a free-form manifest path', () => {
    expect(() => loadManifest('release-control/staging-db/other.json')).toThrow(/manifest path is fixed/);
    expect(FIXED_MANIFEST_PATH).toBe('release-control/staging-db/client-membership-substrate-v1.manifest.json');
  });

  it('permits only the supported Supabase migration command for mutation', () => {
    const manifest = loadManifest();

    expect(manifest.permitted_mutation_command).toEqual(PERMITTED_MUTATION_COMMAND);
    expect(manifest.permitted_mutation_command.join(' ')).toBe('supabase migration up --linked');

    const executableControlFiles = [
      'scripts/release-control/staging-migration-control.mjs',
      'docs/release-control/client-membership-staging-migration-v1.md',
      'release-control/staging-db/client-membership-substrate-v1.manifest.json',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');
    const executableRunner = readFileSync('scripts/release-control/staging-migration-control.mjs', 'utf8');

    expect(executableControlFiles).toContain('supabase migration up --linked');
    expect(executableRunner).not.toMatch(/supabase\s+db\s+query/);
    expect(executableRunner).not.toMatch(/--file\b/);
    expect(executableRunner).not.toMatch(/migration\s+repair/);
    expect(executableRunner).not.toMatch(/db\s+push/);
  });

  it('fails closed unless exactly the approved migration is pending', () => {
    const manifest = loadManifest();
    const valid = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
      remote: ['20260601000000_prior.sql'],
    }));

    expect(pendingVersions(valid)).toEqual(['20260701090000']);
    expect(() => assertPreflightHistory(manifest, valid)).not.toThrow();

    const nonePending = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
      remote: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
    }));
    expect(() => assertPreflightHistory(manifest, nonePending)).toThrow(/already present remotely/);

    const extraPending = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql', '20260702000000_other.sql'],
      remote: ['20260601000000_prior.sql'],
    }));
    expect(() => assertPreflightHistory(manifest, extraPending)).toThrow(/expected exactly one pending migration/);
  });

  it('after apply, remote history must contain only the expected newly applied version', () => {
    const manifest = loadManifest();
    const before = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
      remote: ['20260601000000_prior.sql'],
    }));
    const after = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
      remote: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql'],
    }));
    expect(() => assertAfterHistory(manifest, before, after)).not.toThrow();

    const unexpected = parseMigrationList(JSON.stringify({
      local: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql', '20260702000000_other.sql'],
      remote: ['20260601000000_prior.sql', '20260701090000_client_membership_substrate_v1.sql', '20260702000000_other.sql'],
    }));
    expect(() => assertAfterHistory(manifest, before, unexpected)).toThrow(/unexpected remote migration versions moved/);
  });

  it('requires the linked project ref to be staging before remote operations', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'staging-migration-control-'));
    const script = join(temp, 'mock-supabase.mjs');
    writeFileSync(script, 'console.log(JSON.stringify({ local: [], remote: [] }));\n');

    expect(STAGING_PROJECT_REF).toBe('lkvyrvuakzguszbpwnfz');
    expect(PRODUCTION_PROJECT_REF).toBe('kpuqukppbmwebiptqmog');
  });

  it('does not add a GitHub workflow capable of applying this migration on push', () => {
    const workflowFiles = [
      '.github/workflows/ci.yml',
      '.github/workflows/client-membership-substrate.yml',
    ].map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(workflowFiles).not.toContain('staging-migration-control.mjs apply');
    expect(workflowFiles).not.toContain('supabase migration up --linked');
  });
});
