import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RECEIPT_SCHEMA,
  VERSION_SCHEMA,
  buildArtifactManifest,
  writeReleaseReceipt,
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

const deployJob = jobBlock(workflow, 'deploy');
const deployCondition = extractIf(deployJob);

describe('frontend production delivery lane', () => {
  it('has no automatic production deployment trigger', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\n\s+push:\n/);
    expect(workflow).not.toMatch(/\n\s+pull_request:\n/);
  });

  it('requires manual release confirmation from main before Wrangler is reachable', () => {
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
          event: { inputs: { confirm_frontend_release: 'RUN_LIVE_SYSTEM_OPS' } },
        },
      },
      dispatchWrongBranch: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/release/example',
          event: { inputs: { confirm_frontend_release: 'RELEASE_FRONTEND_PRODUCTION' } },
        },
      },
      dispatchApproved: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/main',
          event: { inputs: { confirm_frontend_release: 'RELEASE_FRONTEND_PRODUCTION' } },
        },
      },
    };

    expect(evalCondition(deployCondition, contexts.pushToMain)).toBe(false);
    expect(evalCondition(deployCondition, contexts.pullRequest)).toBe(false);
    expect(evalCondition(deployCondition, contexts.dispatchMissingConfirm)).toBe(false);
    expect(evalCondition(deployCondition, contexts.dispatchWrongConfirm)).toBe(false);
    expect(evalCondition(deployCondition, contexts.dispatchWrongBranch)).toBe(false);
    expect(evalCondition(deployCondition, contexts.dispatchApproved)).toBe(true);
    expect(deployJob).toContain('cloudflare/wrangler-action@v3');
  });

  it('requires exact approved SHA, production environment, and explicit CI evidence', () => {
    expect(workflow).toContain('approved_commit_sha:');
    expect(workflow).toContain('rollback_version_id:');
    expect(deployJob).toContain('environment: production');
    expect(deployJob).toContain('Verify approved main commit');
    expect(deployJob).toContain('Require exact CI success');

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
      expect(deployJob).toContain(checkName);
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
      expect(deployJob).toContain(checkName);
    }
  });

  it('writes a non-circular served version artifact and release receipt schema', () => {
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

    const receiptPath = join(root, 'release', 'receipt.json');
    const receiptResult = writeReleaseReceipt({
      versionPath: join(dist, 'version.json'),
      outPath: receiptPath,
      sourceSha: 'abc123',
      runId: '456',
      actor: 'aaron',
      targetRoute: 'fortress.silentshieldsecurity.com/*',
      targetEnvironment: 'production',
      deploymentVersionId: 'deployment-version-1',
      rollbackVersionId: '751f2626',
      servedVerificationResult: 'not_run',
    });

    expect(receiptResult.receipt.schema).toBe(RECEIPT_SCHEMA);
    expect(receiptResult.receipt.artifact_manifest_hash).toBe(versionResult.version.artifact_manifest_hash);
    expect(receiptResult.receipt.deployment_version_id).toBe('deployment-version-1');
    expect(receiptResult.receipt.rollback_pointer.version_id).toBe('751f2626');
  });

  it('fails closed when deployment metadata or rollback pointer is missing', () => {
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
        servedVerificationResult: 'not_run',
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
        servedVerificationResult: 'not_run',
      }),
    ).toThrow(/rollbackVersionId/);
  });
});
