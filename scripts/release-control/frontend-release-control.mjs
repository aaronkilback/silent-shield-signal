#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const VERSION_FILE_NAME = 'version.json';
export const VERSION_SCHEMA = 'fortress.frontend.version.v1';
export const PREFLIGHT_RECORD_SCHEMA = 'fortress.frontend.release-preflight-record.v1';
export const RELEASE_RECEIPT_SCHEMA = 'fortress.frontend.production-release-receipt.v1';

function usage() {
  return [
    'Usage:',
    '  frontend-release-control.mjs write-version --dist <dir> --source-sha <sha> --run-id <id> --target-route <route> --target-environment <env>',
    '  frontend-release-control.mjs write-preflight-record --version <file> --out <file> --source-sha <sha> --run-id <id> --actor <actor> --target-route <route> --target-environment <env> --deployment-status <status> --served-verification-status <status> --rollback-status <status>',
    '  frontend-release-control.mjs write-release-receipt --version <file> --out <file> --source-sha <sha> --run-id <id> --actor <actor> --target-route <route> --target-environment <env> --deployment-version-id <id> --rollback-version-id <id> --served-verification-result <result>',
  ].join('\n');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid arguments.\n${usage()}`);
    }
    args[key.slice(2)] = value;
  }
  return { command, args };
}

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required argument --${key}`);
  }
  return value.trim();
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, fullPath);
    if (!entry.isFile()) return [];
    return [relative(root, fullPath).split(sep).join('/')];
  });
}

export function buildArtifactManifest(distDir) {
  const root = resolve(distDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Dist directory not found: ${distDir}`);
  }

  const files = listFiles(root)
    .filter((filePath) => filePath !== VERSION_FILE_NAME)
    .sort()
    .map((filePath) => {
      const buffer = readFileSync(join(root, filePath));
      return {
        path: filePath,
        bytes: buffer.length,
        sha256: sha256Buffer(buffer),
      };
    });

  return {
    schema: 'fortress.frontend.artifact-manifest.v1',
    excludes: [VERSION_FILE_NAME],
    files,
  };
}

export function writeVersionArtifact(options) {
  const manifest = buildArtifactManifest(options.distDir);
  const artifactManifestHash = sha256Json(manifest);
  const version = {
    schema: VERSION_SCHEMA,
    source_commit_sha: options.sourceSha,
    workflow_run_id: options.runId,
    build_timestamp_utc: new Date().toISOString(),
    target_route: options.targetRoute,
    target_environment: options.targetEnvironment,
    artifact_manifest_hash: artifactManifestHash,
  };

  const versionPath = join(resolve(options.distDir), VERSION_FILE_NAME);
  writeFileSync(versionPath, `${JSON.stringify(version, null, 2)}\n`);
  return { versionPath, version, manifest };
}

function requireOptionSet(options, fields, label) {
  for (const field of fields) {
    if (!options[field]) throw new Error(`${label} missing ${field}`);
  }
}

function readAndValidateVersionArtifact(options) {
  requireOptionSet(options, ['sourceSha', 'runId', 'targetRoute', 'targetEnvironment'], 'Version validation');
  const version = JSON.parse(readFileSync(resolve(options.versionPath), 'utf8'));
  const requiredVersionFields = [
    'source_commit_sha',
    'workflow_run_id',
    'artifact_manifest_hash',
    'target_route',
    'target_environment',
  ];
  for (const field of requiredVersionFields) {
    if (!version[field]) throw new Error(`Version artifact missing ${field}`);
  }

  if (version.source_commit_sha !== options.sourceSha) {
    throw new Error('Version artifact source SHA does not match approved source SHA');
  }
  if (version.workflow_run_id !== options.runId) {
    throw new Error('Version artifact run ID does not match release run ID');
  }
  if (version.target_route !== options.targetRoute || version.target_environment !== options.targetEnvironment) {
    throw new Error('Version artifact target does not match release target');
  }
  return version;
}

export function writePreflightRecord(options) {
  const version = readAndValidateVersionArtifact(options);
  requireOptionSet(options, [
    'sourceSha',
    'runId',
    'actor',
    'targetRoute',
    'targetEnvironment',
    'deploymentStatus',
    'servedVerificationStatus',
    'rollbackStatus',
  ], 'Release preflight record');

  const record = {
    schema: PREFLIGHT_RECORD_SCHEMA,
    source_commit_sha: options.sourceSha,
    workflow_run_id: options.runId,
    actor: options.actor,
    target_route: options.targetRoute,
    target_environment: options.targetEnvironment,
    artifact_manifest_hash: version.artifact_manifest_hash,
    preflight_timestamp_utc: new Date().toISOString(),
    deployment_status: options.deploymentStatus,
    served_version_verification_status: options.servedVerificationStatus,
    rollback_status: options.rollbackStatus,
    release_status: 'not_released',
  };

  const outPath = resolve(options.outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  return { recordPath: outPath, record };
}

export function writeReleaseReceipt(options) {
  const version = readAndValidateVersionArtifact(options);
  requireOptionSet(options, [
    'sourceSha',
    'runId',
    'actor',
    'targetRoute',
    'targetEnvironment',
    'deploymentVersionId',
    'rollbackVersionId',
    'servedVerificationResult',
  ], 'Release receipt');

  if (options.servedVerificationResult === 'not_run') {
    throw new Error('Production release receipt cannot use not_run served verification');
  }

  const receipt = {
    schema: RELEASE_RECEIPT_SCHEMA,
    source_commit_sha: options.sourceSha,
    workflow_run_id: options.runId,
    actor: options.actor,
    target_route: options.targetRoute,
    target_environment: options.targetEnvironment,
    artifact_manifest_hash: version.artifact_manifest_hash,
    deployment_version_id: options.deploymentVersionId,
    deployed_at_utc: new Date().toISOString(),
    served_version_verification_result: options.servedVerificationResult,
    rollback_pointer: {
      provider: 'cloudflare-workers',
      version_id: options.rollbackVersionId,
    },
  };

  const outPath = resolve(options.outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath: outPath, receipt };
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'write-version') {
    const result = writeVersionArtifact({
      distDir: requireArg(args, 'dist'),
      sourceSha: requireArg(args, 'source-sha'),
      runId: requireArg(args, 'run-id'),
      targetRoute: requireArg(args, 'target-route'),
      targetEnvironment: requireArg(args, 'target-environment'),
    });
    process.stdout.write(`${JSON.stringify({ version_path: result.versionPath, artifact_manifest_hash: result.version.artifact_manifest_hash })}\n`);
    return;
  }

  if (command === 'write-preflight-record') {
    const result = writePreflightRecord({
      versionPath: requireArg(args, 'version'),
      outPath: requireArg(args, 'out'),
      sourceSha: requireArg(args, 'source-sha'),
      runId: requireArg(args, 'run-id'),
      actor: requireArg(args, 'actor'),
      targetRoute: requireArg(args, 'target-route'),
      targetEnvironment: requireArg(args, 'target-environment'),
      deploymentStatus: requireArg(args, 'deployment-status'),
      servedVerificationStatus: requireArg(args, 'served-verification-status'),
      rollbackStatus: requireArg(args, 'rollback-status'),
    });
    process.stdout.write(`${JSON.stringify({ preflight_record_path: result.recordPath })}\n`);
    return;
  }

  if (command === 'write-release-receipt') {
    const result = writeReleaseReceipt({
      versionPath: requireArg(args, 'version'),
      outPath: requireArg(args, 'out'),
      sourceSha: requireArg(args, 'source-sha'),
      runId: requireArg(args, 'run-id'),
      actor: requireArg(args, 'actor'),
      targetRoute: requireArg(args, 'target-route'),
      targetEnvironment: requireArg(args, 'target-environment'),
      deploymentVersionId: requireArg(args, 'deployment-version-id'),
      rollbackVersionId: requireArg(args, 'rollback-version-id'),
      servedVerificationResult: requireArg(args, 'served-verification-result'),
    });
    process.stdout.write(`${JSON.stringify({ receipt_path: result.receiptPath })}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command ?? '(none)'}\n${usage()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
