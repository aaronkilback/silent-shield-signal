#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

export const FIXED_MANIFEST_PATH = 'release-control/staging-db/client-membership-substrate-v1.manifest.json';
export const STAGING_PROJECT_REF = 'lkvyrvuakzguszbpwnfz';
export const PRODUCTION_PROJECT_REF = 'kpuqukppbmwebiptqmog';
export const PERMITTED_MUTATION_COMMAND = ['supabase', 'migration', 'up', '--linked'];
export const DEFAULT_LINKED_PROJECT_REF_PATH = 'supabase/.temp/project-ref';
export const RECEIPT_DIR = 'release-control/staging-db/receipts';
export const MIGRATION_HISTORY_TIMEOUT_MS = 60000;
export const MIGRATION_HISTORY_GRACE_MS = 5000;

function readText(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(resolve(repoRoot, path)));
}

function sha256Text(text) {
  return sha256Bytes(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function loadManifest(path = FIXED_MANIFEST_PATH) {
  assert(path === FIXED_MANIFEST_PATH, `manifest path is fixed; got ${path}`);
  assert(existsSync(resolve(repoRoot, path)), `manifest missing: ${path}`);
  return JSON.parse(readText(path));
}

export function validateManifest(manifest = loadManifest()) {
  assert(manifest.target?.project_ref === STAGING_PROJECT_REF, 'manifest target is not approved staging project ref');
  assert(manifest.target?.environment === 'staging', 'manifest target environment must be staging');
  assert(
    manifest.target?.source_of_truth === 'docs/PROD_BASELINE.md' &&
      readText('docs/PROD_BASELINE.md').includes(`**Staging project ref:** \`${STAGING_PROJECT_REF}\``),
    'source-controlled staging project ref is not proven by docs/PROD_BASELINE.md',
  );
  assert(
    !JSON.stringify(manifest.target).includes(PRODUCTION_PROJECT_REF),
    'production project ref is not allowed in target identity',
  );
  assert(
    manifest.disallowed_targets?.some((target) => target.project_ref === PRODUCTION_PROJECT_REF),
    'manifest must explicitly disallow production project ref',
  );
  assert(
    manifest.migration?.path === 'supabase/migrations/20260701090000_client_membership_substrate_v1.sql',
    'manifest migration path is not the approved migration',
  );
  assert(manifest.migration?.version === '20260701090000', 'manifest migration version is incorrect');
  assert(existsSync(resolve(repoRoot, manifest.migration.path)), 'manifest migration file does not exist');
  assert(sha256File(manifest.migration.path) === manifest.migration.sha256, 'migration sha256 does not match manifest');
  assert(
    JSON.stringify(manifest.permitted_mutation_command) === JSON.stringify(PERMITTED_MUTATION_COMMAND),
    'permitted mutation command must be exactly supabase migration up --linked',
  );
  assert(manifest.expected_preflight_state?.maximum_pending_migrations === 1, 'manifest must require exactly one pending migration');
  assert(
    manifest.expected_preflight_state?.required_pending_versions?.length === 1 &&
      manifest.expected_preflight_state.required_pending_versions[0] === manifest.migration.version,
    'manifest must require only the approved migration version as pending',
  );
  return {
    manifestHash: sha256Text(JSON.stringify(manifest, null, 2) + '\n'),
    migrationHash: manifest.migration.sha256,
  };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function sourceCommit() {
  return git(['rev-parse', 'HEAD']);
}

export function cleanWorktreeProof(allowedPaths = []) {
  const allowed = new Set(allowedPaths.filter(Boolean).map((path) => path.replace(/^\.\//, '')));
  const lines = git(['status', '--porcelain']).split('\n').filter(Boolean);
  const unexpected = lines.filter((line) => {
    const path = line.slice(3).trim().replace(/^\.\//, '');
    if (path.startsWith(`${RECEIPT_DIR}/`)) return false;
    return !allowed.has(path);
  });
  assert(unexpected.length === 0, `working tree is not clean: ${unexpected.join('; ')}`);
  return {
    clean: true,
    allowed_receipt_paths: [...allowed].sort(),
    ignored_receipt_directory: RECEIPT_DIR,
  };
}

export function assertLinkedToStaging(projectRefPath = DEFAULT_LINKED_PROJECT_REF_PATH) {
  const absolutePath = resolve(repoRoot, projectRefPath);
  assert(existsSync(absolutePath), 'Supabase CLI linked project ref is missing; link must be established before execution');
  const linkedRef = readFileSync(absolutePath, 'utf8').trim();
  assert(linkedRef !== PRODUCTION_PROJECT_REF, 'Supabase CLI is linked to production; refusing');
  assert(linkedRef === STAGING_PROJECT_REF, 'Supabase CLI is not linked to approved staging project ref');
  return linkedRef;
}

function safeTextMetadata(value) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return {
    present: text.length > 0,
    length: text.length,
  };
}

export class SupabaseCommandError extends Error {
  constructor(message, metadata) {
    super(message);
    this.name = 'SupabaseCommandError';
    this.metadata = metadata;
  }
}

function defaultSupabaseExecutor(args) {
  return spawnSync('supabase', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

export function runSupabase(args, { operation = 'supabase_command', executor = defaultSupabaseExecutor } = {}) {
  const result = executor(args, { operation });
  const metadata = {
    operation,
    timeout_ms: null,
    exit_status: typeof result?.status === 'number' ? result.status : null,
    signal: result?.signal ?? null,
    stdout: safeTextMetadata(result?.stdout),
    stderr: safeTextMetadata(result?.stderr),
  };

  if (result?.error) {
    throw new SupabaseCommandError(`${operation} failed`, metadata);
  }
  if (result?.status !== 0) {
    throw new SupabaseCommandError(`${operation} failed`, metadata);
  }

  return { stdout: result.stdout || '', metadata };
}

export function superviseSupabaseCommand(
  args,
  {
    operation = 'migration_history_read',
    timeoutMs = MIGRATION_HISTORY_TIMEOUT_MS,
    graceMs = MIGRATION_HISTORY_GRACE_MS,
    spawnChild = spawn,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    let exitStatus = null;
    let signal = null;
    let timedOut = false;
    let terminationConfirmed = false;
    let settled = false;
    const signalsAttempted = [];
    let deadlineTimer = null;
    let graceTimer = null;

    const child = spawnChild('supabase', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    function metadata() {
      return {
        operation,
        timeout_ms: timeoutMs,
        grace_ms: graceMs,
        timed_out: timedOut,
        signals_attempted: [...signalsAttempted],
        termination_confirmed: terminationConfirmed,
        exit_status: exitStatus,
        signal,
        stdout: safeTextMetadata(stdout),
        stderr: safeTextMetadata(stderr),
      };
    }

    function cleanupChildHandles() {
      child.stdout?.removeAllListeners?.('data');
      child.stderr?.removeAllListeners?.('data');
      child.removeAllListeners?.('close');
      child.removeAllListeners?.('error');
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      child.unref?.();
      child.stdout?.unref?.();
      child.stderr?.unref?.();
    }

    function settle(kind, value) {
      if (settled) return;
      settled = true;
      if (deadlineTimer) clearTimer(deadlineTimer);
      if (graceTimer) clearTimer(graceTimer);
      cleanupChildHandles();
      if (kind === 'resolve') resolvePromise(value);
      else rejectPromise(value);
    }

    function timeoutError(confirmed) {
      terminationConfirmed = confirmed;
      return new SupabaseCommandError(
        `${operation} timed out after ${timeoutMs} ms; termination ${confirmed ? 'confirmed' : 'unconfirmed'}`,
        metadata(),
      );
    }

    child.stdout?.on?.('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on?.('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on?.('error', (error) => {
      if (settled) return;
      settle('reject', new SupabaseCommandError(`${operation} failed`, { ...metadata(), error_name: error?.name ?? null }));
    });
    child.on?.('close', (code, closeSignal) => {
      if (settled) return;
      exitStatus = typeof code === 'number' ? code : null;
      signal = closeSignal ?? null;
      if (timedOut) {
        settle('reject', timeoutError(true));
        return;
      }
      if (exitStatus !== 0) {
        settle('reject', new SupabaseCommandError(`${operation} failed`, metadata()));
        return;
      }
      settle('resolve', { stdout, metadata: metadata() });
    });

    deadlineTimer = setTimer(() => {
      if (settled) return;
      timedOut = true;
      signalsAttempted.push('SIGTERM');
      child.kill?.('SIGTERM');
      graceTimer = setTimer(() => {
        if (settled) return;
        signalsAttempted.push('SIGKILL');
        child.kill?.('SIGKILL');
        settle('reject', timeoutError(false));
      }, graceMs);
      graceTimer?.unref?.();
    }, timeoutMs);
    deadlineTimer?.unref?.();
  });
}

function assertVersionArray(value, field) {
  assert(Array.isArray(value), `migration history field ${field} must be an array`);
  for (const version of value) {
    assert(typeof version === 'string' && /^20\d{12}$/.test(version), `migration history field ${field} contains invalid version`);
  }
  return new Set(value);
}

export function parseMigrationList(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('supabase migration list output must be JSON');
  }

  const keys = Object.keys(parsed || {}).sort();
  assert(
    keys.length === 2 && keys[0] === 'local_versions' && keys[1] === 'remote_versions',
    'migration history JSON must contain only local_versions and remote_versions arrays',
  );

  return {
    local: assertVersionArray(parsed.local_versions, 'local_versions'),
    remote: assertVersionArray(parsed.remote_versions, 'remote_versions'),
  };
}

export function pendingVersions(history) {
  return [...history.local].filter((version) => !history.remote.has(version)).sort();
}

export function assertPreflightHistory(manifest, beforeHistory) {
  const expected = manifest.migration.version;
  const pending = pendingVersions(beforeHistory);
  assert(!beforeHistory.remote.has(expected), 'approved migration is already present remotely before apply');
  assert(pending.length === 1 && pending[0] === expected, `expected exactly one pending migration (${expected}); got ${pending.join(', ') || 'none'}`);
}

export function assertAfterHistory(manifest, beforeHistory, afterHistory) {
  const expected = manifest.migration.version;
  assert(afterHistory.remote.has(expected), 'approved migration is not present remotely after apply');
  const beforePlusExpected = new Set(beforeHistory.remote);
  beforePlusExpected.add(expected);
  const unexpected = [...afterHistory.remote].filter((version) => !beforePlusExpected.has(version));
  assert(unexpected.length === 0, `unexpected remote migration versions moved: ${unexpected.join(', ')}`);
  assert(pendingVersions(afterHistory).length === 0, 'local pending migrations remain after apply');
}

export async function readRemoteHistory({ executor = superviseSupabaseCommand } = {}) {
  const result = await executor(['migration', 'list', '--linked', '--output', 'json'], {
    operation: 'migration_history_read',
    timeoutMs: MIGRATION_HISTORY_TIMEOUT_MS,
  });
  try {
    return parseMigrationList(result.stdout);
  } catch (caught) {
    throw new SupabaseCommandError(
      caught instanceof Error ? caught.message : 'migration_history_read output could not be parsed',
      result.metadata,
    );
  }
}

function historyForReceipt(history) {
  return {
    local_versions: [...history.local].sort(),
    remote_versions: [...history.remote].sort(),
  };
}

function receiptPath(kind, releaseId, timestamp) {
  return `${RECEIPT_DIR}/${releaseId}-${kind}-${timestamp.replace(/[:.]/g, '-')}.json`;
}

function writeReceipt(kind, releaseId, timestamp, body) {
  const path = receiptPath(kind, releaseId, timestamp);
  mkdirSync(resolve(repoRoot, RECEIPT_DIR), { recursive: true });
  writeFileSync(resolve(repoRoot, path), JSON.stringify(body, null, 2) + '\n');
  return path;
}

export function validateOnly() {
  return validateManifest(loadManifest());
}

function preflightAttemptBase({ manifest, manifestProof, source_commit, clean_worktree, linkedProjectRef, startedAt }) {
  return {
    receipt_type: 'staging_migration_preflight_attempt',
    release_id: manifest.release_id,
    target_ref: linkedProjectRef,
    target: manifest.target,
    source_commit,
    clean_worktree,
    manifest_path: FIXED_MANIFEST_PATH,
    manifest_sha256: manifestProof.manifestHash,
    migration_path: manifest.migration.path,
    migration_version: manifest.migration.version,
    migration_sha256: manifestProof.migrationHash,
    phase: 'migration_history_read',
    remote_history: null,
    started_at_utc: startedAt,
  };
}

export async function preflight({
  writeReceiptFile = true,
  projectRefPath = DEFAULT_LINKED_PROJECT_REF_PATH,
  executor = superviseSupabaseCommand,
  cleanWorktreeProvider = cleanWorktreeProof,
} = {}) {
  const checkedAt = new Date().toISOString();
  const manifest = loadManifest();
  const manifestProof = validateManifest(manifest);
  const source_commit = sourceCommit();
  const clean_worktree = cleanWorktreeProvider();
  const linkedProjectRef = assertLinkedToStaging(projectRefPath);
  const attemptBase = preflightAttemptBase({ manifest, manifestProof, source_commit, clean_worktree, linkedProjectRef, startedAt: checkedAt });

  let beforeHistory = null;
  try {
    beforeHistory = await readRemoteHistory({ executor });
    assertPreflightHistory(manifest, beforeHistory);
  } catch (caught) {
    const failedAt = new Date().toISOString();
    const errorMetadata = caught instanceof SupabaseCommandError
      ? caught.metadata
      : {
          operation: 'migration_history_read',
          timeout_ms: MIGRATION_HISTORY_TIMEOUT_MS,
          exit_status: null,
          signal: null,
          stdout: { present: false, length: 0 },
          stderr: { present: false, length: 0 },
        };
    const attemptReceipt = {
      ...attemptBase,
      remote_history: beforeHistory ? historyForReceipt(beforeHistory) : null,
      finished_at_utc: failedAt,
      result: 'failed',
      error: caught instanceof Error ? caught.message : String(caught),
      error_metadata: errorMetadata,
    };
    if (writeReceiptFile) writeReceipt('preflight-attempt', manifest.release_id, failedAt, attemptReceipt);
    throw caught;
  }

  const passedAt = new Date().toISOString();
  const attemptReceipt = {
    ...attemptBase,
    remote_history: historyForReceipt(beforeHistory),
    finished_at_utc: passedAt,
    result: 'preflight_passed',
    error: null,
    error_metadata: null,
  };
  const attemptPath = writeReceiptFile ? writeReceipt('preflight-attempt', manifest.release_id, passedAt, attemptReceipt) : null;

  const receipt = {
    receipt_type: 'staging_migration_preflight',
    release_id: manifest.release_id,
    target_ref: linkedProjectRef,
    target: manifest.target,
    source_commit,
    clean_worktree,
    manifest_path: FIXED_MANIFEST_PATH,
    manifest_sha256: manifestProof.manifestHash,
    migration_path: manifest.migration.path,
    migration_version: manifest.migration.version,
    migration_sha256: manifestProof.migrationHash,
    remote_history_before: historyForReceipt(beforeHistory),
    checked_at_utc: passedAt,
    result: 'preflight_passed',
    preflight_attempt_receipt_path: attemptPath,
  };
  const path = writeReceiptFile ? writeReceipt('preflight', manifest.release_id, passedAt, receipt) : null;
  return { manifest, manifestProof, beforeHistory, receipt, receiptPath: path, attemptReceipt, attemptReceiptPath: attemptPath };
}

function readReceipt(path) {
  assert(path, 'apply requires reviewed preflight receipt path');
  assert(!path.includes('..') && path.startsWith(`${RECEIPT_DIR}/`) && path.endsWith('.json'), 'invalid receipt path');
  assert(existsSync(resolve(repoRoot, path)), `preflight receipt not found: ${path}`);
  return JSON.parse(readText(path));
}

function assertPreflightReceiptMatches(current, reviewedReceipt) {
  assert(reviewedReceipt.receipt_type === 'staging_migration_preflight', 'reviewed receipt is not a preflight receipt');
  assert(reviewedReceipt.result === 'preflight_passed', 'reviewed preflight did not pass');
  assert(reviewedReceipt.source_commit === current.receipt.source_commit, 'source commit does not match reviewed preflight');
  assert(JSON.stringify(reviewedReceipt.clean_worktree) === JSON.stringify(current.receipt.clean_worktree), 'clean-worktree proof does not match reviewed preflight');
  assert(reviewedReceipt.manifest_sha256 === current.receipt.manifest_sha256, 'manifest hash does not match reviewed preflight');
  assert(reviewedReceipt.migration_sha256 === current.receipt.migration_sha256, 'migration hash does not match reviewed preflight');
  assert(reviewedReceipt.target_ref === current.receipt.target_ref, 'target ref does not match reviewed preflight');
  assert(JSON.stringify(reviewedReceipt.remote_history_before) === JSON.stringify(current.receipt.remote_history_before), 'remote preflight history does not match reviewed preflight');
}

export async function apply(reviewedPreflightReceiptPath) {
  const startedAt = new Date().toISOString();
  let manifest;
  let currentPreflight;
  let beforeHistory = null;
  let afterHistory = null;
  let result = 'failed';
  let error = null;

  try {
    const reviewedReceipt = readReceipt(reviewedPreflightReceiptPath);
    currentPreflight = await preflight({ writeReceiptFile: false, projectRefPath: DEFAULT_LINKED_PROJECT_REF_PATH });
    manifest = currentPreflight.manifest;
    beforeHistory = currentPreflight.beforeHistory;
    assertPreflightReceiptMatches(currentPreflight, reviewedReceipt);
    runSupabase(PERMITTED_MUTATION_COMMAND.slice(1));
    afterHistory = await readRemoteHistory();
    assertAfterHistory(manifest, beforeHistory, afterHistory);
    result = 'applied';
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    throw caught;
  } finally {
    const finishedAt = new Date().toISOString();
    const fallbackManifest = manifest || loadManifest();
    const manifestProof = validateManifest(fallbackManifest);
    const receipt = {
      receipt_type: 'staging_migration_apply_attempt',
      release_id: fallbackManifest.release_id,
      target: fallbackManifest.target,
      source_commit: sourceCommit(),
      manifest_path: FIXED_MANIFEST_PATH,
      manifest_sha256: manifestProof.manifestHash,
      migration: fallbackManifest.migration,
      reviewed_preflight_receipt_path: reviewedPreflightReceiptPath || null,
      permitted_mutation_command: PERMITTED_MUTATION_COMMAND,
      remote_history_before: beforeHistory ? historyForReceipt(beforeHistory) : null,
      remote_history_after: afterHistory ? historyForReceipt(afterHistory) : null,
      started_at_utc: startedAt,
      finished_at_utc: finishedAt,
      result,
      error,
      statement: 'Receipt records Supabase remote version-state only; it does not prove SQL byte equivalence in remote history.',
    };
    writeReceipt('apply-attempt', fallbackManifest.release_id, finishedAt, receipt);
  }
}

async function main() {
  const command = process.argv[2] || 'validate';
  if (command === 'validate') {
    console.log(JSON.stringify(validateOnly(), null, 2));
    return;
  }
  if (command === 'preflight') {
    const result = await preflight();
    console.log(JSON.stringify({ receipt_path: result.receiptPath, ...result.receipt }, null, 2));
    return;
  }
  if (command === 'apply') {
    const reviewedPreflightReceiptPath = process.argv[3];
    await apply(reviewedPreflightReceiptPath);
    console.log(JSON.stringify({ result: 'applied' }, null, 2));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
