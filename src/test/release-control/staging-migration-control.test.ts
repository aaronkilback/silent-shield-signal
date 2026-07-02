import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  FIXED_MANIFEST_PATH,
  MIGRATION_HISTORY_GRACE_MS,
  MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES,
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
  superviseSupabaseCommand,
  validateManifest,
} from '../../../scripts/release-control/staging-migration-control.mjs';

type TimerRecord = {
  fn: () => void;
  ms: number;
  cleared: boolean;
  unref: () => void;
};

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { destroy: () => void; unref: () => void };
  stderr = new EventEmitter() as EventEmitter & { destroy: () => void; unref: () => void };
  killedSignals: string[] = [];
  unrefCalled = false;

  constructor() {
    super();
    this.stdout.destroy = () => {};
    this.stdout.unref = () => {};
    this.stderr.destroy = () => {};
    this.stderr.unref = () => {};
  }

  kill(signal: string) {
    this.killedSignals.push(signal);
    return true;
  }

  unref() {
    this.unrefCalled = true;
  }
}

function makeTimerHarness() {
  const timers: TimerRecord[] = [];
  return {
    timers,
    setTimer(fn: () => void, ms: number) {
      const timer: TimerRecord = {
        fn,
        ms,
        cleared: false,
        unref: () => {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer: TimerRecord) {
      timer.cleared = true;
    },
  };
}


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

async function withReceiptCapture(fn: () => void | Promise<void>) {
  const before = new Set(receiptFiles());
  try {
    await fn();
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

async function withProjectRef(value: string | null, fn: (path: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-link-'));
  const path = join(dir, 'project-ref');
  if (value !== null) writeFileSync(path, value);
  try {
    await fn(path);
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

  it('proves linked-project assertion with a real project-ref file', async () => {
    await withProjectRef(STAGING_PROJECT_REF, (path) => {
      expect(assertLinkedToStaging(path)).toBe(STAGING_PROJECT_REF);
    });

    await withProjectRef(PRODUCTION_PROJECT_REF, (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/linked to production/);
    });

    await withProjectRef('abcdefghijklmnopqrst', (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/not linked to approved staging/);
    });

    await withProjectRef(null, (path) => {
      expect(() => assertLinkedToStaging(path)).toThrow(/project ref is missing/);
    });
  });

  it('permits only the normal Supabase executable and supported migration command for mutation', () => {
    const manifest = loadManifest();
    const runner = readFileSync('scripts/release-control/staging-migration-control.mjs', 'utf8');

    expect(manifest.permitted_mutation_command).toEqual(PERMITTED_MUTATION_COMMAND);
    expect(manifest.permitted_mutation_command.join(' ')).toBe('supabase migration up --linked');
    expect(runner).toContain("spawnChild('supabase', args");
    expect(runner).toContain("spawnSync('supabase', args");
    expect(runner).toContain('MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES = 65536');
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


  it('writes a failed preflight-attempt receipt when a timed-out child confirms termination', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const calls: string[][] = [];
        const child = new FakeChild();
        const timers = makeTimerHarness();
        const stdout = 'partial history output that must not be trusted';
        const executor = (args: string[], options: { timeoutMs?: number; operation?: string }) => {
          calls.push(args);
          return superviseSupabaseCommand(args, {
            operation: options.operation,
            timeoutMs: options.timeoutMs,
            graceMs: MIGRATION_HISTORY_GRACE_MS,
            spawnChild: () => child,
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
          });
        };

        const result = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });
        child.stdout.emit('data', stdout);
        expect(timers.timers[0].ms).toBe(MIGRATION_HISTORY_TIMEOUT_MS);
        timers.timers[0].fn();
        child.emit('close', null, 'SIGTERM');

        await expect(result).rejects.toThrow(/termination confirmed/);
        expect(calls).toEqual([['migration', 'list', '--linked', '--output', 'json']]);
        expect(calls.flat().join(' ')).not.toContain('up --linked');
        expect(child.killedSignals).toEqual(['SIGTERM']);

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
        expect(receipt.error_metadata.grace_ms).toBe(MIGRATION_HISTORY_GRACE_MS);
        expect(receipt.error_metadata.timed_out).toBe(true);
        expect(receipt.error_metadata.termination_confirmed).toBe(true);
        expect(receipt.error_metadata.signals_attempted).toEqual(['SIGTERM']);
        expect(receipt.error_metadata.signal).toBe('SIGTERM');
        expect(receipt.error_metadata.stdout).toEqual({ present: true, length: stdout.length, truncated: false });
      });
    });
  });

  it('returns after bounded grace and writes a failed receipt when a timed-out child never closes', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const calls: string[][] = [];
        const child = new FakeChild();
        const timers = makeTimerHarness();
        const executor = (args: string[], options: { timeoutMs?: number; operation?: string }) => {
          calls.push(args);
          return superviseSupabaseCommand(args, {
            operation: options.operation,
            timeoutMs: options.timeoutMs,
            graceMs: MIGRATION_HISTORY_GRACE_MS,
            spawnChild: () => child,
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
          });
        };

        const result = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });
        expect(timers.timers[0].ms).toBe(MIGRATION_HISTORY_TIMEOUT_MS);
        timers.timers[0].fn();
        expect(timers.timers[1].ms).toBe(MIGRATION_HISTORY_GRACE_MS);
        timers.timers[1].fn();

        await expect(result).rejects.toThrow(/termination unconfirmed/);
        expect(calls).toEqual([['migration', 'list', '--linked', '--output', 'json']]);
        expect(calls.flat().join(' ')).not.toContain('up --linked');
        expect(child.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
        expect(child.unrefCalled).toBe(true);

        const created = receiptFiles().filter((path) => path.includes('preflight-attempt'));
        expect(created.length).toBe(1);
        const receipt = JSON.parse(readFileSync(created[0], 'utf8'));
        expect(receipt.result).toBe('failed');
        expect(receipt.error_metadata.timed_out).toBe(true);
        expect(receipt.error_metadata.termination_confirmed).toBe(false);
        expect(receipt.error_metadata.signals_attempted).toEqual(['SIGTERM', 'SIGKILL']);
        expect(receipt.error_metadata.exit_status).toBeNull();
        expect(receipt.error_metadata.signal).toBeNull();
      });
    });
  });

  it('stdout overflow fails closed, caps retained output, and never reaches apply', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const calls: string[][] = [];
        const child = new FakeChild();
        const timers = makeTimerHarness();
        const executor = (args: string[], options: { timeoutMs?: number; operation?: string }) => {
          calls.push(args);
          return superviseSupabaseCommand(args, {
            operation: options.operation,
            timeoutMs: options.timeoutMs,
            graceMs: MIGRATION_HISTORY_GRACE_MS,
            spawnChild: () => child,
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
          });
        };

        const result = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });
        child.stdout.emit('data', Buffer.alloc(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES + 1024, 'x'));
        child.emit('close', null, 'SIGTERM');

        await expect(result).rejects.toThrow(/output limit exceeded on stdout/);
        expect(calls).toEqual([['migration', 'list', '--linked', '--output', 'json']]);
        expect(calls.flat().join(' ')).not.toContain('up --linked');
        expect(child.killedSignals).toEqual(['SIGTERM']);

        const created = receiptFiles().filter((path) => path.includes('preflight-attempt'));
        expect(created.length).toBe(1);
        const receipt = JSON.parse(readFileSync(created[0], 'utf8'));
        expect(receipt.result).toBe('failed');
        expect(receipt.remote_history).toBeNull();
        expect(receipt.error_metadata.output_capture_limit_bytes).toBe(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES);
        expect(receipt.error_metadata.output_limit_exceeded).toBe(true);
        expect(receipt.error_metadata.output_limit_stream).toBe('stdout');
        expect(receipt.error_metadata.termination_confirmed).toBe(true);
        expect(receipt.error_metadata.stdout).toEqual({
          present: true,
          length: MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES,
          truncated: true,
        });
        expect(receipt.error_metadata.stdout.length).not.toBe(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES + 1024);
      });
    });
  });

  it('stderr overflow fails closed, caps retained output, and never reaches apply', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const calls: string[][] = [];
        const child = new FakeChild();
        const timers = makeTimerHarness();
        const executor = (args: string[], options: { timeoutMs?: number; operation?: string }) => {
          calls.push(args);
          return superviseSupabaseCommand(args, {
            operation: options.operation,
            timeoutMs: options.timeoutMs,
            graceMs: MIGRATION_HISTORY_GRACE_MS,
            spawnChild: () => child,
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
          });
        };

        const result = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });
        child.stderr.emit('data', Buffer.alloc(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES + 1, 'e'));
        child.emit('close', null, 'SIGTERM');

        await expect(result).rejects.toThrow(/output limit exceeded on stderr/);
        expect(calls).toEqual([['migration', 'list', '--linked', '--output', 'json']]);
        expect(calls.flat().join(' ')).not.toContain('up --linked');
        expect(child.killedSignals).toEqual(['SIGTERM']);

        const created = receiptFiles().filter((path) => path.includes('preflight-attempt'));
        expect(created.length).toBe(1);
        const receipt = JSON.parse(readFileSync(created[0], 'utf8'));
        expect(receipt.result).toBe('failed');
        expect(receipt.remote_history).toBeNull();
        expect(receipt.error_metadata.output_capture_limit_bytes).toBe(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES);
        expect(receipt.error_metadata.output_limit_exceeded).toBe(true);
        expect(receipt.error_metadata.output_limit_stream).toBe('stderr');
        expect(receipt.error_metadata.stderr).toEqual({
          present: true,
          length: MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES,
          truncated: true,
        });
        expect(receipt.error_metadata.stderr.length).not.toBe(MIGRATION_HISTORY_OUTPUT_CAPTURE_LIMIT_BYTES + 1);
      });
    });
  });

  it('valid migration-history JSON below the output cap passes through the supervisor', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const child = new FakeChild();
        const timers = makeTimerHarness();
        const executor = (args: string[], options: { timeoutMs?: number; operation?: string }) => superviseSupabaseCommand(args, {
          operation: options.operation,
          timeoutMs: options.timeoutMs,
          graceMs: MIGRATION_HISTORY_GRACE_MS,
          spawnChild: () => child,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
        });

        const resultPromise = preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });
        child.stdout.emit('data', validHistory());
        child.emit('close', 0, null);
        const result = await resultPromise;

        expect(result.receipt.result).toBe('preflight_passed');
        expect(result.receipt.remote_history_before).toEqual({
          local_versions: ['20260601000000', '20260701090000'],
          remote_versions: ['20260601000000'],
        });
        expect(result.attemptReceipt.error_metadata).toBeNull();
      });
    });
  });

  it('valid simulated migration history writes both attempt and reviewed preflight receipts', async () => {
    await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
      await withReceiptCapture(async () => {
        const executor = () => Promise.resolve({ stdout: validHistory(), metadata: {} });
        const result = await preflight({ projectRefPath, executor, cleanWorktreeProvider: cleanProof });

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

  it('unknown output, non-zero exit, and signal interruption fail closed with failed attempt receipts', async () => {
    const cases = [
      {
        name: 'unknown output',
        executor: () => Promise.resolve({
          stdout: JSON.stringify({ migrations: [{ version: '20260701090000' }] }),
          metadata: {
            operation: 'migration_history_read',
            timeout_ms: MIGRATION_HISTORY_TIMEOUT_MS,
            exit_status: 0,
            signal: null,
            stdout: { present: true, length: 44 },
            stderr: { present: false, length: 0 },
          },
        }),
        message: /local_versions and remote_versions/,
      },
      {
        name: 'non-zero exit',
        executor: () => Promise.reject(Object.assign(new Error('migration_history_read failed'), {
          name: 'SupabaseCommandError',
          metadata: {
            operation: 'migration_history_read',
            timeout_ms: MIGRATION_HISTORY_TIMEOUT_MS,
            exit_status: 1,
            signal: null,
            stdout: { present: false, length: 0 },
            stderr: { present: true, length: 14 },
          },
        })),
        message: /migration_history_read failed/,
      },
      {
        name: 'signal interruption',
        executor: () => Promise.reject(Object.assign(new Error('migration_history_read failed'), {
          name: 'SupabaseCommandError',
          metadata: {
            operation: 'migration_history_read',
            timeout_ms: MIGRATION_HISTORY_TIMEOUT_MS,
            exit_status: null,
            signal: 'SIGINT',
            stdout: { present: false, length: 0 },
            stderr: { present: true, length: 11 },
          },
        })),
        message: /migration_history_read failed/,
      },
    ];

    for (const testCase of cases) {
      await withProjectRef(STAGING_PROJECT_REF, async (projectRefPath) => {
        await withReceiptCapture(async () => {
          await expect(preflight({
            projectRefPath,
            executor: testCase.executor,
            cleanWorktreeProvider: cleanProof,
          })).rejects.toThrow(testCase.message);

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
