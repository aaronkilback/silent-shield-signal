import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIXED_MANIFEST_PATH,
  MIGRATION_HISTORY_TIMEOUT_MS,
  PERMITTED_MUTATION_COMMAND,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertAfterHistory,
  assertLinkedToStaging,
  assertPreflightHistory,
  loadManifest,
  preflight,
  parseMigrationList,
  pendingVersions,
  validateManifest,
} from '../../../scripts/release-control/staging-migration-control.mjs';


function cleanProof() {
  return {
    clean: true,
    allowed_receipt_paths: [],
    ignored_receipt_directory: 'release-control/staging-db/receipts',
  };
}

function receiptFiles() {
  const dir = 'release-control/staging-db/receipts';
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => `${dir}/${name}`).sort();
}

function removeReceiptFiles(paths: string[]) {
  for (const path of paths) rmSync(path, { force: true });
}

function withReceiptCapture(fn: () => void) {
  const before = new Set(receiptFiles());
  try {
    fn();
  } finally {
    const created = receiptFiles().filter((path) => !before.has(path));
    removeReceiptFiles(created);
  }
}

function validHistory() {
  return JSON.stringify({
    local_versions: ['20260601000000', '20260701090000'],
    remote_versions: ['20260601000000'],
  });
}

function withProjectRef(value: string | null, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-link-'));
  const path = join(dir, 'project-ref');
  if (value !== null) writeFileSync(path, value);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

  it('proves linked-project assertion with a real project-ref file', () => {
    withProjectRef(STAGING_PROJECT_REF, (path) => {
      expect(assertLinkedToStaging(path)).toBe(STAGING_PROJECT_REF);
    });

    withProjectRef(PRODUCTION_PROJECT_REF, (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/linked to production/);
    });

    withProjectRef('abcdefghijklmnopqrst', (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/not linked to approved staging/);
    });

    withProjectRef(null, (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/project ref is missing/);
    });
  });

  it('permits only the normal Supabase executable and supported migration command for mutation', () => {
    const manifest = loadManifest();
    const runner = readFileSync('scripts/release-control/staging-migration-control.mjs', 'utf8');

    expect(manifest.permitted_mutation_command).toEqual(PERMITTED_MUTATION_COMMAND);
    expect(manifest.permitted_mutation_command.join(' ')).toBe('supabase migration up --linked');
    expect(runner).toContain("spawnSync('supabase', args");
    expect(runner).not.toContain('STAGING_MIGRATION_SUPABASE_BIN');
    expect(runner).not.toMatch(/process\.env\.[A-Z0-9_]*SUPABASE_BIN/);
    expect(runner).not.toMatch(/supabase\s+db\s+query/);
    expect(runner).not.toMatch(/--file\b/);
    expect(runner).not.toMatch(/migration\s+repair/);
    expect(runner).not.toMatch(/db\s+push/);
  });

  it('accepts only the explicit migration-history JSON structure', () => {
    const history = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000'],
      remote_versions: ['20260601000000'],
    }));

    expect([...history.local].sort()).toEqual(['20260601000000', '20260701090000']);
    expect([...history.remote].sort()).toEqual(['20260601000000']);
    expect(pendingVersions(history)).toEqual(['20260701090000']);

    expect(() => parseMigrationList(JSON.stringify({
      local: ['20260701090000_client_membership_substrate_v1.sql'],
      remote: [],
    }))).toThrow(/local_versions and remote_versions/);

    expect(() => parseMigrationList(JSON.stringify({
      migrations: [{ version: '20260701090000', status: 'pending' }],
    }))).toThrow(/local_versions and remote_versions/);

    expect(() => parseMigrationList(JSON.stringify({
      local_versions: ['20260701090000_client_membership_substrate_v1.sql'],
      remote_versions: [],
    }))).toThrow(/invalid version/);

    expect(() => parseMigrationList('not json')).toThrow(/must be JSON/);
  });

  it('fails closed unless exactly the approved migration is pending', () => {
    const manifest = loadManifest();
    const valid = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000'],
      remote_versions: ['20260601000000'],
    }));

    expect(pendingVersions(valid)).toEqual(['20260701090000']);
    expect(() => assertPreflightHistory(manifest, valid)).not.toThrow();

    const nonePending = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000'],
      remote_versions: ['20260601000000', '20260701090000'],
    }));
    expect(() => assertPreflightHistory(manifest, nonePending)).toThrow(/already present remotely/);

    const extraPending = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000', '20260702000000'],
      remote_versions: ['20260601000000'],
    }));
    expect(() => assertPreflightHistory(manifest, extraPending)).toThrow(/expected exactly one pending migration/);
  });

  it('after apply, remote history must contain only the expected newly applied version', () => {
    const manifest = loadManifest();
    const before = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000'],
      remote_versions: ['20260601000000'],
    }));
    const after = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000'],
      remote_versions: ['20260601000000', '20260701090000'],
    }));
    expect(() => assertAfterHistory(manifest, before, after)).not.toThrow();

    const unexpected = parseMigrationList(JSON.stringify({
      local_versions: ['20260601000000', '20260701090000', '20260702000000'],
      remote_versions: ['20260601000000', '20260701090000', '20260702000000'],
    }));
    expect(() => assertAfterHistory(manifest, before, unexpected)).toThrow(/unexpected remote migration versions moved/);
  });

  it('binds apply to a reviewed preflight receipt and documents every apply attempt', () => {
    const runner = readFileSync('scripts/release-control/staging-migration-control.mjs', 'utf8');

    expect(runner).toContain("receipt_type: 'staging_migration_preflight'");
    expect(runner).toContain("result: 'preflight_passed'");
    expect(runner).toContain('apply requires reviewed preflight receipt path');
    expect(runner).toContain("path.startsWith(`${RECEIPT_DIR}/`)");
    expect(runner).toContain('ignored_receipt_directory: RECEIPT_DIR');
    expect(runner).toContain('assertPreflightReceiptMatches');
    expect(runner).toContain('source commit does not match reviewed preflight');
    expect(runner).toContain('clean-worktree proof does not match reviewed preflight');
    expect(runner).toContain('manifest hash does not match reviewed preflight');
    expect(runner).toContain('migration hash does not match reviewed preflight');
    expect(runner).toContain('target ref does not match reviewed preflight');
    expect(runner).toContain('remote preflight history does not match reviewed preflight');
    expect(runner).toContain("receipt_type: 'staging_migration_apply_attempt'");
    expect(runner).toContain('finally');
    expect(runner).toContain('error,');
  });


  it('writes a failed preflight-attempt receipt when migration-history read times out', () => {
    withProjectRef(STAGING_PROJECT_REF, (projectRefPath) => {
      withReceiptCapture(() => {
        const calls: string[][] = [];
        const stdout = 'partial history output that must not be trusted';
        const executor = (args: string[], options: { timeoutMs?: number }) => {
          calls.push(args);
          return {
            status: null,
            signal: 'SIGTERM',
            stdout,
            stderr: '',
            error: { code: 'ETIMEDOUT' },
          };
        };

        expect(() => preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof })).toThrow(/timed out/);
        expect(calls).toEqual([['migration', 'list', '--linked', '--output', 'json']]);
        expect(calls.flat().join(' ')).not.toContain('up --linked');

        const created = receiptFiles().filter((path) => path.includes('preflight-attempt'));
        expect(created.length).toBe(1);
        const receipt = JSON.parse(readFileSync(created[0], 'utf8'));
        expect(receipt.receipt_type).toBe('staging_migration_preflight_attempt');
        expect(receipt.target_ref).toBe(STAGING_PROJECT_REF);
        expect(receipt.phase).toBe('migration_history_read');
        expect(receipt.remote_history).toBeNull();
        expect(receipt.result).toBe('failed');
        expect(receipt.error_metadata.operation).toBe('migration_history_read');
        expect(receipt.error_metadata.timeout_ms).toBe(MIGRATION_HISTORY_TIMEOUT_MS);
        expect(receipt.error_metadata.signal).toBe('SIGTERM');
        expect(receipt.error_metadata.stdout).toEqual({ present: true, length: stdout.length });
      });
    });
  });

  it('valid simulated migration history writes both attempt and reviewed preflight receipts', () => {
    withProjectRef(STAGING_PROJECT_REF, (projectRefPath) => {
      withReceiptCapture(() => {
        const executor = () => ({ status: 0, signal: null, stdout: validHistory(), stderr: '' });
        const result = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });

        expect(result.receipt.result).toBe('preflight_passed');
        expect(result.attemptReceipt.result).toBe('preflight_passed');
        expect(result.receipt.remote_history_before).toEqual({
          local_versions: ['20260601000000', '20260701090000'],
          remote_versions: ['20260601000000'],
        });
        expect(result.receiptPath).toContain('preflight');
        expect(result.attemptReceiptPath).toContain('preflight-attempt');
        expect(existsSync(result.receiptPath!)).toBe(true);
        expect(existsSync(result.attemptReceiptPath!)).toBe(true);
      });
    });
  });

  it('unknown output, non-zero exit, and signal interruption fail closed with failed attempt receipts', () => {
    const cases = [
      {
        name: 'unknown output',
        executor: () => ({ status: 0, signal: null, stdout: JSON.stringify({ migrations: [{ version: '20260701090000' }] }), stderr: '' }),
        message: /local_versions and remote_versions/,
      },
      {
        name: 'non-zero exit',
        executor: () => ({ status: 1, signal: null, stdout: '', stderr: 'remote refused' }),
        message: /migration_history_read failed/,
      },
      {
        name: 'signal interruption',
        executor: () => ({ status: null, signal: 'SIGINT', stdout: '', stderr: 'interrupted' }),
        message: /migration_history_read failed/,
      },
    ];

    for (const testCase of cases) {
      withProjectRef(STAGING_PROJECT_REF, (projectRefPath) => {
        withReceiptCapture(() => {
          expect(() => preflight({
            projectRefPath,
            executor: testCase.executor,
            cleanWorktreeProvider: cleanProof,
          })).toThrow(testCase.message);

          const created = receiptFiles().filter((path) => path.includes('preflight-attempt'));
          expect(created.length, testCase.name).toBe(1);
          const receipt = JSON.parse(readFileSync(created[0], 'utf8'));
          expect(receipt.result).toBe('failed');
          expect(receipt.phase).toBe('migration_history_read');
          expect(receipt.remote_history).toBeNull();
        });
      });
    }
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
