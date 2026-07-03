import { createHash } from 'node:crypto';
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = 'dist';
const VERSION_PATH = path.join(DIST_DIR, 'version.json');
const RECORD_PATH = path.join('release', 'staging-frontend-preflight-record.json');
const TARGET_ENVIRONMENT = 'staging';
const HASH_ALGORITHM = 'sha256';
const HASH_SCOPE = 'dist/**/* excluding dist/version.json';
const HASH_METHOD =
  'Sort relative file paths lexicographically; hash each file with SHA-256; hash newline-joined manifest lines of path, byte size, and file hash.';

async function listDistFiles(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listDistFiles(absolute, root));
      continue;
    }

    if (!entry.isFile()) continue;
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative === 'version.json') continue;
    files.push({ absolute, relative });
  }

  return files;
}

async function buildArtifactManifest() {
  const files = (await listDistFiles(DIST_DIR)).sort((a, b) => a.relative.localeCompare(b.relative));
  const lines = [];

  for (const file of files) {
    const bytes = await readFile(file.absolute);
    const fileStat = await stat(file.absolute);
    const fileHash = createHash(HASH_ALGORITHM).update(bytes).digest('hex');
    lines.push(`${file.relative}\t${fileStat.size}\t${fileHash}`);
  }

  const manifest = `${lines.join('\n')}\n`;
  const hash = createHash(HASH_ALGORITHM).update(manifest).digest('hex');
  return { file_count: files.length, hash, manifest };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const sourceCommitSha = requiredEnv('PREFLIGHT_SOURCE_COMMIT_SHA');
const githubRunId = requiredEnv('PREFLIGHT_GITHUB_RUN_ID');
const actor = requiredEnv('PREFLIGHT_ACTOR');
const generatedAt = new Date().toISOString();
const artifact = await buildArtifactManifest();

const nonReleaseStatuses = {
  deployment: 'not_run',
  cloudflare_version: 'not_observed',
  traffic_allocation: 'not_observed',
  served_artifact_verification: 'not_run',
  rollback: 'not_run',
  release: 'not_released',
};

const version = {
  schema: 'fortress.frontend.staging-version.v1',
  source_commit_sha: sourceCommitSha,
  github_run_id: githubRunId,
  build_timestamp_utc: generatedAt,
  target_environment: TARGET_ENVIRONMENT,
  artifact_manifest_hash: artifact.hash,
  artifact_hash_algorithm: HASH_ALGORITHM,
  artifact_hash_scope: HASH_SCOPE,
  artifact_hash_method: HASH_METHOD,
  non_circular_hash_note: 'dist/version.json is generated after artifact hashing and is excluded from the artifact manifest hash.',
};

const record = {
  schema: 'fortress.frontend.staging-preflight-record.v1',
  source_commit_sha: sourceCommitSha,
  github_run_id: githubRunId,
  actor,
  target_environment: TARGET_ENVIRONMENT,
  generated_at_utc: generatedAt,
  artifact_manifest_hash: artifact.hash,
  artifact_manifest_file_count: artifact.file_count,
  artifact_hash_algorithm: HASH_ALGORITHM,
  artifact_hash_scope: HASH_SCOPE,
  artifact_hash_method: HASH_METHOD,
  non_circular_hash_note: 'dist/version.json is generated after artifact hashing and is excluded from the artifact manifest hash.',
  statuses: nonReleaseStatuses,
};

await mkdir(DIST_DIR, { recursive: true });
await mkdir(path.dirname(RECORD_PATH), { recursive: true });
await writeFile(VERSION_PATH, `${JSON.stringify(version, null, 2)}\n`);
await writeFile(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);

console.log(`Wrote ${VERSION_PATH}`);
console.log(`Wrote ${RECORD_PATH}`);
