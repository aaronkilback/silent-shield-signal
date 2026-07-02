#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

export const FIXED_MANIFEST_PATH = 'release-control/staging-db/client-membership-substrate-v1.manifest.json';
export const STAGING_PROJECT_REF = 'lkvyrvuakzguszbpwnfz';
export const PRODUCTION_PROJECT_REF = 'kpuqukppbmwebiptqmog';
export const PERMITTED_MUTATION_COMMAND = ['supabase', 'migration', 'up', '--linked'];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(resolve(repoRoot, path))).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
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

export function assertLinkedToStaging() {
  const projectRefPath = resolve(repoRoot, 'supabase/.temp/project-ref');
  assert(existsSync(projectRefPath), 'Supabase CLI linked project ref is missing; link must be established before execution');
  const linkedRef = readFileSync(projectRefPath, 'utf8').trim();
  assert(linkedRef === STAGING_PROJECT_REF, 'Supabase CLI is not linked to approved staging project ref');
  assert(linkedRef !== PRODUCTION_PROJECT_REF, 'Supabase CLI is linked to production; refusing');
}

function supabaseBin() {
  return process.env.STAGING_MIGRATION_SUPABASE_BIN || 'supabase';
}

function runSupabase(args) {
  const result = spawnSync(supabaseBin(), args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`supabase ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function extractVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/(20\d{12})/);
  return match ? match[1] : null;
}

export function parseMigrationList(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('supabase migration list output must be JSON');
  }

  if (Array.isArray(parsed?.local) || Array.isArray(parsed?.remote)) {
    return {
      local: new Set((parsed.local || []).map(extractVersion).filter(Boolean)),
      remote: new Set((parsed.remote || []).map(extractVersion).filter(Boolean)),
    };
  }

  const rows = Array.isArray(parsed) ? parsed : parsed.migrations;
  assert(Array.isArray(rows), 'unrecognized migration list JSON shape');
  const local = new Set();
  const remote = new Set();

  for (const row of rows) {
    const localVersion = extractVersion(row.local || row.local_version || row.version || row.name);
    const remoteVersion = extractVersion(row.remote || row.remote_version || row.version || row.name);
    const status = String(row.status || row.state || '').toLowerCase();

    if (row.local === true || row.is_local === true || localVersion) local.add(localVersion || remoteVersion);
    if (row.remote === true || row.is_remote === true || status === 'applied' || remoteVersion) remote.add(remoteVersion || localVersion);
    if (status === 'pending' && (localVersion || remoteVersion)) local.add(localVersion || remoteVersion);
  }

  local.delete(null);
  remote.delete(null);
  return { local, remote };
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

export function readRemoteHistory() {
  return parseMigrationList(runSupabase(['migration', 'list', '--linked', '--output', 'json']));
}

export function validateOnly() {
  return validateManifest(loadManifest());
}

export function preflight() {
  const manifest = loadManifest();
  const manifestProof = validateManifest(manifest);
  assertLinkedToStaging();
  const beforeHistory = readRemoteHistory();
  assertPreflightHistory(manifest, beforeHistory);
  return { manifest, manifestProof, beforeHistory };
}

export function apply() {
  const startedAt = new Date().toISOString();
  const { manifest, manifestProof, beforeHistory } = preflight();
  const command = PERMITTED_MUTATION_COMMAND.slice(1);
  runSupabase(command);
  const afterHistory = readRemoteHistory();
  assertAfterHistory(manifest, beforeHistory, afterHistory);
  const finishedAt = new Date().toISOString();
  const receipt = {
    release_id: manifest.release_id,
    target: manifest.target,
    source_commit: sourceCommit(),
    manifest_path: FIXED_MANIFEST_PATH,
    manifest_sha256: manifestProof.manifestHash,
    migration: manifest.migration,
    permitted_mutation_command: PERMITTED_MUTATION_COMMAND,
    remote_history_before: {
      local: [...beforeHistory.local].sort(),
      remote: [...beforeHistory.remote].sort(),
    },
    remote_history_after: {
      local: [...afterHistory.local].sort(),
      remote: [...afterHistory.remote].sort(),
    },
    started_at_utc: startedAt,
    finished_at_utc: finishedAt,
    result: 'applied',
    statement: 'Receipt records source-controlled pre-upload evidence and Supabase remote version-state only; it does not prove SQL byte equivalence in remote history.',
  };
  const receiptPath = `release-control/staging-db/receipts/${manifest.release_id}-${finishedAt.replace(/[:.]/g, '-')}.json`;
  mkdirSync(resolve(repoRoot, dirname(receiptPath)), { recursive: true });
  writeFileSync(resolve(repoRoot, receiptPath), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

function main() {
  const command = process.argv[2] || 'validate';
  if (command === 'validate') {
    console.log(JSON.stringify(validateOnly(), null, 2));
    return;
  }
  if (command === 'preflight') {
    const result = preflight();
    console.log(JSON.stringify({
      target: result.manifest.target,
      migration: result.manifest.migration,
      pending_versions: pendingVersions(result.beforeHistory),
      remote_versions_before: [...result.beforeHistory.remote].sort(),
    }, null, 2));
    return;
  }
  if (command === 'apply') {
    console.log(JSON.stringify(apply(), null, 2));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
