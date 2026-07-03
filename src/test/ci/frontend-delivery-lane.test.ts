import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREFLIGHT_RECORD_SCHEMA,
  VERSION_SCHEMA,
  buildArtifactManifest,
  writeReleaseReceipt,
  writePreflightRecord,
  writeVersionArtifact,
} from '../../../scripts/release-control/frontend-release-control.mjs';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-frontend.yml'), 'utf8');

function jobBlock(source: string, jobKey: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobKey}:`);
  if (start === -1) throw new Error(`job "${jobKey}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function extractIf(block: string): string {
  const lines = block.split('\n');
  const idx = lines.findIndex((line) => /^ {4}if:/.test(line));
  if (idx === -1) throw new Error('job has no if condition');
  const first = lines[idx].replace(/^ {4}if:\s*/, '');
  const parts: string[] = [];
  const inlineFold = first.replace(/^[>|][-+]?\s*$/, '').trim();
  if (inlineFold) parts.push(inlineFold);
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^ {4}[A-Za-z0-9_-]+:/.test(lines[i])) break;
    if (/^ {6,}\S/.test(lines[i])) parts.push(lines[i].trim());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function evalCondition(condition: string, ctx: Record<string, any>): boolean {
  return condition.split('&&').every((term) => {
    const match = term.trim().match(/^([A-Za-z0-9_.]+)\s*==\s*'([^']*)'$/);
    if (!match) throw new Error(`unsupported condition term: ${term}`);
    const [, path, expected] = match;
    const actual = path.split('.').reduce<any>((obj, key) => (obj == null ? undefined : obj[key]), ctx);
    return actual === expected;
  });
}

const preflightJob = jobBlock(workflow, 'preflight');
const preflightCondition = extractIf(preflightJob);

describe('frontend production delivery lane', () => {
  it('has no automatic production deployment trigger', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\n\s+push:\n/);
    expect(workflow).not.toMatch(/\n\s+pull_request:\n/);
  });

  it('requires manual preflight confirmation from main before the preflight can run', () => {
    const contexts = {
      pushToMain: {
        github: { event_name: 'push', ref: 'refs/heads/main', event: { inputs: {} } },
      },
      pullRequest: {
        github: { event_name: 'pull_request', ref: 'refs/heads/main', event: { inputs: {} } },
      },
      dispatchMissingConfirm: {
        github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', event: { inputs: {} } },
      },
      dispatchWrongConfirm: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/main',
          event: { inputs: { confirm_frontend_preflight: 'RELEASE_FRONTEND_PRODUCTION' } },
        },
      },
      dispatchWrongBranch: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/release/example',
          event: { inputs: { confirm_frontend_preflight: 'RUN_FRONTEND_RELEASE_PREFLIGHT' } },
        },
      },
      dispatchApproved: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/main',
          event: { inputs: { confirm_frontend_preflight: 'RUN_FRONTEND_RELEASE_PREFLIGHT' } },
        },
      },
    };

    expect(evalCondition(preflightCondition, contexts.pushToMain)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.pullRequest)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchMissingConfirm)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchWrongConfirm)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchWrongBranch)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchApproved)).toBe(true);
  });

  it('contains no executable Cloudflare deployment path', () => {
    expect(workflow).not.toContain('cloudflare/wrangler-action');
    expect(workflow).not.toContain('wrangler');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).not.toContain('environment: production');
  });

  it('requires exact approved SHA, Checks API permission, and explicit CI evidence', () => {
    expect(workflow).toContain('approved_commit_sha:');
    expect(workflow).toContain('confirm_frontend_preflight:');
    expect(workflow).toContain('checks: read');
    expect(preflightJob).toContain('Verify approved main commit');
    expect(preflightJob).toContain('Require exact CI success');

    for (const checkName of [
      'TypeScript & Build',
      'ESLint',
      'Critical File Guard',
      'Shared Imports Consistency (_shared/*)',
      'Workstream D — confidence + provenance suite',
      'Workstream D — no autonomous execution on score',
      'Playwright E2E',
      'Unit Tests (Vitest)',
      'a1-guard',
    ]) {
      expect(preflightJob).toContain(checkName);
    }
  });

  it('preserves the live operational and production-read jobs as expected-skipped checks', () => {
    for (const checkName of [
      'Live Production Reads — Manual Only / Loop Activity',
      'Live Production Reads — Manual Only / Cron Alignment',
      'Live Production Reads — Manual Only / DB Types Drift',
      'Live Operational Checks — Manual Only / Health Gate',
      'Live Operational Checks — Manual Only / Pipeline Smoke',
    ]) {
      expect(preflightJob).toContain(checkName);
    }
  });

  it('writes a non-circular served version artifact and preflight record schema', () => {
    const root = mkdtempSync(join(tmpdir(), 'frontend-release-'));
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    writeFileSync(join(dist, 'assets', 'main.js'), 'console.log("ok");');

    const firstManifest = buildArtifactManifest(dist);
    const versionResult = writeVersionArtifact({
      distDir: dist,
      sourceSha: 'abc123',
      runId: '456',
      targetRoute: 'fortress.silentshieldsecurity.com/*',
      targetEnvironment: 'production',
    });
    const secondManifest = buildArtifactManifest(dist);

    expect(versionResult.version.schema).toBe(VERSION_SCHEMA);
    expect(versionResult.version.source_commit_sha).toBe('abc123');
    expect(versionResult.version.workflow_run_id).toBe('456');
    expect(secondManifest).toEqual(firstManifest);
    expect(secondManifest.files.map((file) => file.path)).not.toContain('version.json');

    const recordPath = join(root, 'release', 'preflight.json');
    const recordResult = writePreflightRecord({
      versionPath: join(dist, 'version.json'),
      outPath: recordPath,
      sourceSha: 'abc123',
      runId: '456',
      actor: 'aaron',
      targetRoute: 'fortress.silentshieldsecurity.com/*',
      targetEnvironment: 'production',
      deploymentStatus: 'not_run',
      servedVerificationStatus: 'not_run',
      rollbackStatus: 'not_run',
    });

    expect(recordResult.record.schema).toBe(PREFLIGHT_RECORD_SCHEMA);
    expect(recordResult.record.artifact_manifest_hash).toBe(versionResult.version.artifact_manifest_hash);
    expect(recordResult.record.deployment_status).toBe('not_run');
    expect(recordResult.record.served_version_verification_status).toBe('not_run');
    expect(recordResult.record.rollback_status).toBe('not_run');
    expect(recordResult.record.release_status).toBe('not_released');
  });

  it('does not allow a production release receipt with not_run served verification', () => {
    const root = mkdtempSync(join(tmpdir(), 'frontend-release-missing-'));
    const dist = join(root, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    writeVersionArtifact({
      distDir: dist,
      sourceSha: 'abc123',
      runId: '456',
      targetRoute: 'fortress.silentshieldsecurity.com/*',
      targetEnvironment: 'production',
    });

    expect(() =>
      writeReleaseReceipt({
        versionPath: join(dist, 'version.json'),
        outPath: join(root, 'receipt.json'),
        sourceSha: 'abc123',
        runId: '456',
        actor: 'aaron',
        targetRoute: 'fortress.silentshieldsecurity.com/*',
        targetEnvironment: 'production',
        deploymentVersionId: '',
        rollbackVersionId: '751f2626',
        servedVerificationResult: 'verified',
      }),
    ).toThrow(/deploymentVersionId/);

    expect(() =>
      writeReleaseReceipt({
        versionPath: join(dist, 'version.json'),
        outPath: join(root, 'receipt.json'),
        sourceSha: 'abc123',
        runId: '456',
        actor: 'aaron',
        targetRoute: 'fortress.silentshieldsecurity.com/*',
        targetEnvironment: 'production',
        deploymentVersionId: 'deployment-version-1',
        rollbackVersionId: '',
        servedVerificationResult: 'verified',
      }),
    ).toThrow(/rollbackVersionId/);

    expect(() =>
      writeReleaseReceipt({
        versionPath: join(dist, 'version.json'),
        outPath: join(root, 'receipt.json'),
        sourceSha: 'abc123',
        runId: '456',
        actor: 'aaron',
        targetRoute: 'fortress.silentshieldsecurity.com/*',
        targetEnvironment: 'production',
        deploymentVersionId: 'deployment-version-1',
        rollbackVersionId: '751f2626',
        servedVerificationResult: 'not_run',
      }),
    ).toThrow(/not_run served verification/);
  });
});
