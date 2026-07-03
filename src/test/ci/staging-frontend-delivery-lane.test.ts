import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-frontend-staging.yml'),
  'utf8',
);

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

describe('staging frontend delivery lane', () => {
  it('has no automatic staging deployment trigger', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\n\s+push:\n/);
    expect(workflow).not.toMatch(/\n\s+pull_request:\n/);
  });

  it('requires manual preflight confirmation from staging before the preflight can run', () => {
    const contexts = {
      pushToStaging: {
        github: { event_name: 'push', ref: 'refs/heads/staging', event: { inputs: {} } },
      },
      pullRequest: {
        github: { event_name: 'pull_request', ref: 'refs/heads/staging', event: { inputs: {} } },
      },
      dispatchMissingConfirm: {
        github: { event_name: 'workflow_dispatch', ref: 'refs/heads/staging', event: { inputs: {} } },
      },
      dispatchWrongConfirm: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/staging',
          event: { inputs: { confirm_staging_preflight: 'RUN_FRONTEND_RELEASE_PREFLIGHT' } },
        },
      },
      dispatchWrongBranch: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/main',
          event: { inputs: { confirm_staging_preflight: 'RUN_STAGING_FRONTEND_PREFLIGHT' } },
        },
      },
      dispatchApproved: {
        github: {
          event_name: 'workflow_dispatch',
          ref: 'refs/heads/staging',
          event: { inputs: { confirm_staging_preflight: 'RUN_STAGING_FRONTEND_PREFLIGHT' } },
        },
      },
    };

    expect(evalCondition(preflightCondition, contexts.pushToStaging)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.pullRequest)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchMissingConfirm)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchWrongConfirm)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchWrongBranch)).toBe(false);
    expect(evalCondition(preflightCondition, contexts.dispatchApproved)).toBe(true);
  });

  it('contains no executable Cloudflare deployment path or repository Cloudflare credential reference', () => {
    expect(workflow).not.toContain('cloudflare/wrangler-action');
    expect(workflow).not.toContain('wrangler');
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(workflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).not.toContain('STAGING_CLOUDFLARE_API_TOKEN');
  });

  it('is explicitly non-deploy and writes only a preflight record', () => {
    expect(workflow).toContain('Frontend Staging Preflight (No Deploy)');
    expect(preflightJob).toContain('Staging Frontend Preflight — No Deploy');
    expect(preflightJob).toContain('"deployment_status": "not_run"');
    expect(preflightJob).toContain('"served_version_verification_status": "not_run"');
    expect(preflightJob).toContain('"rollback_status": "not_run"');
    expect(preflightJob).toContain('"release_status": "not_released"');
  });

  it('keeps staging build variables limited to the intended staging Vite variables', () => {
    expect(preflightJob).toContain('VITE_SUPABASE_URL: ${{ secrets.STAGING_VITE_SUPABASE_URL }}');
    expect(preflightJob).toContain('VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_VITE_SUPABASE_PUBLISHABLE_KEY }}');
    expect(preflightJob).not.toContain('VITE_SUPABASE_ANON_KEY');
    expect(preflightJob).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(preflightJob).not.toContain('STAGING_SUPABASE_SERVICE_ROLE_KEY');
  });

  it('verifies checked-out staging exactly matches approved_commit_sha', () => {
    expect(workflow).toContain('approved_commit_sha:');
    expect(workflow).toContain('confirm_staging_preflight:');
    expect(preflightJob).toContain('ref: staging');
    expect(preflightJob).toContain('Verify approved staging commit');
    expect(preflightJob).toContain('git rev-parse HEAD');
    expect(preflightJob).toContain('inputs.approved_commit_sha');
  });
});
