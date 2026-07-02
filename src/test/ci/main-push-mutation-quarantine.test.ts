import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Main-Push Mutation Quarantine v1 — regression guard.
 *
 * Boundary being protected:
 *   "Live operational checks are deliberately privileged and potentially
 *    mutating. They are not permitted as an automatic consequence of a source
 *    merge."
 *
 * The privileged jobs `health-gate` (system-ops `health-check`) and
 * `pipeline-smoke` (system-ops `pipeline-tests`) must run ONLY via a deliberate
 * `workflow_dispatch` carrying the exact confirmation
 * `confirm_live_operational_checks: RUN_LIVE_SYSTEM_OPS`. An ordinary push or
 * pull_request to main must never trigger them.
 *
 * This guard reads the real workflow source, extracts each privileged job's
 * actual `if:` condition, and EVALUATES it against simulated GitHub event
 * contexts — so it proves behavior, not just string presence.
 */

const CONFIRM_KEY = 'confirm_live_operational_checks';
const CONFIRM_VALUE = 'RUN_LIVE_SYSTEM_OPS';
const LIVE_READ_CONFIRM_KEY = 'confirm_live_production_reads';
const LIVE_READ_CONFIRM_VALUE = 'RUN_LIVE_PRODUCTION_READS';

const ciYml = readFileSync(
  resolve(process.cwd(), '.github/workflows/ci.yml'),
  'utf8',
);

/** Extract a single job block (from its 2-space key to the next sibling job key). */
function jobBlock(source: string, jobKey: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l === `  ${jobKey}:`);
  if (start === -1) throw new Error(`job "${jobKey}" not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // next top-level job: exactly two-space indent, a key, not a comment
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Extract every job block from the workflow. */
function jobBlocks(source: string): Array<{ key: string; block: string }> {
  const lines = source.split('\n');
  const jobsStart = lines.findIndex((l) => l === 'jobs:');
  if (jobsStart === -1) throw new Error('workflow has no jobs block');

  const starts: Array<{ key: string; index: number }> = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const match = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (match) starts.push({ key: match[1], index: i });
  }

  return starts.map(({ key, index }, idx) => ({
    key,
    block: lines.slice(index, starts[idx + 1]?.index ?? lines.length).join('\n'),
  }));
}

/** Pull the (possibly folded `>-`) `if:` condition out of a job block, normalized. */
function extractIf(block: string): string {
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => /^ {4}if:/.test(l));
  if (idx === -1) throw new Error('no `if:` in job block');
  const first = lines[idx].replace(/^ {4}if:\s*/, '');
  const parts: string[] = [];
  const inlineFold = first.replace(/^[>|][-+]?\s*$/, '').trim();
  if (inlineFold) parts.push(inlineFold);
  // gather folded continuation lines (indented deeper than the `if:` key,
  // until the next 4-space job property such as `steps:`/`runs-on:`)
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^ {4}[A-Za-z0-9_-]+:/.test(lines[i])) break;
    if (/^ {6,}\S/.test(lines[i])) parts.push(lines[i].trim());
    else if (lines[i].trim() === '') continue;
    else break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function hasIf(block: string): boolean {
  return /^ {4}if:/m.test(block);
}

function postsToSystemOps(block: string): boolean {
  return /-X\s+POST/.test(block) && block.includes('/functions/v1/system-ops');
}

function systemOpsAction(block: string): string | null {
  return block.match(/"action"\s*:\s*"([^"]+)"/)?.[1] ?? null;
}

/**
 * Minimal evaluator for the specific guard shape:
 *   A == 'x' && B == 'y' [&& ...]
 * Resolves each context path (e.g. github.event_name,
 * github.event.inputs.<key>) against a simulated context and ANDs the terms.
 */
function evalCondition(condition: string, ctx: Record<string, any>): boolean {
  const terms = condition.split('&&').map((t) => t.trim());
  return terms.every((term) => {
    const m = term.match(/^([A-Za-z0-9_.]+)\s*==\s*'([^']*)'$/);
    if (!m) throw new Error(`unsupported term (guard shape changed?): "${term}"`);
    const [, path, expected] = m;
    const actual = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), ctx);
    return actual === expected;
  });
}

const CONTEXTS = {
  pushToMain: {
    github: { event_name: 'push', ref: 'refs/heads/main', event: { inputs: {} } },
  },
  pullRequest: {
    github: { event_name: 'pull_request', ref: 'refs/heads/main', event: { inputs: {} } },
  },
  dispatchNoConfirm: {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', event: { inputs: {} } },
  },
  dispatchWrongValue: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/main',
      event: { inputs: { [CONFIRM_KEY]: 'run_live_system_ops' } },
    },
  },
  dispatchConfirmedWrongBranch: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/reliability/example',
      event: { inputs: { [CONFIRM_KEY]: CONFIRM_VALUE } },
    },
  },
  dispatchConfirmed: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/main',
      event: { inputs: { [CONFIRM_KEY]: CONFIRM_VALUE } },
    },
  },
  dispatchLiveReadsNoConfirm: {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main', event: { inputs: {} } },
  },
  dispatchLiveReadsWrongValue: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/main',
      event: { inputs: { [LIVE_READ_CONFIRM_KEY]: 'RUN_LIVE_SYSTEM_OPS' } },
    },
  },
  dispatchLiveReadsConfirmedWrongBranch: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/reliability/example',
      event: { inputs: { [LIVE_READ_CONFIRM_KEY]: LIVE_READ_CONFIRM_VALUE } },
    },
  },
  dispatchLiveReadsConfirmed: {
    github: {
      event_name: 'workflow_dispatch',
      ref: 'refs/heads/main',
      event: { inputs: { [LIVE_READ_CONFIRM_KEY]: LIVE_READ_CONFIRM_VALUE } },
    },
  },
};

const PRIVILEGED_JOBS = [
  { key: 'health-gate', action: 'health-check' },
  { key: 'pipeline-smoke', action: 'pipeline-tests' },
];

const SYSTEM_OPS_POST_JOBS = jobBlocks(ciYml)
  .filter(({ block }) => postsToSystemOps(block))
  .map(({ key, block }) => ({
    key,
    block,
    action: systemOpsAction(block),
    condition: hasIf(block) ? extractIf(block) : 'true',
  }));

function hasDirectLiveSupabaseAccess(block: string): boolean {
  return [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_PAT',
    'SUPABASE_PROJECT_REF: kpuqukppbmwebiptqmog',
    '/rest/v1/',
    '/functions/v1/system-ops',
  ].some((marker) => block.includes(marker));
}

const LIVE_SUPABASE_ACCESS_JOBS = jobBlocks(ciYml)
  .filter(({ block }) => hasDirectLiveSupabaseAccess(block))
  .map(({ key, block }) => ({
    key,
    block,
    condition: hasIf(block) ? extractIf(block) : 'true',
  }));

const LIVE_READ_JOBS = [
  { key: 'loop-health', displayName: 'Live Production Reads — Manual Only / Loop Activity' },
  { key: 'cron-alignment', displayName: 'Live Production Reads — Manual Only / Cron Alignment' },
  { key: 'db-types-drift', displayName: 'Live Production Reads — Manual Only / DB Types Drift' },
];

const REQUIRED_MANUAL_CONDITION_TERMS = [
  "github.event_name == 'workflow_dispatch'",
  "github.ref == 'refs/heads/main'",
  `github.event.inputs.${CONFIRM_KEY} == '${CONFIRM_VALUE}'`,
];

const REQUIRED_LIVE_READ_CONDITION_TERMS = [
  "github.event_name == 'workflow_dispatch'",
  "github.ref == 'refs/heads/main'",
  `github.event.inputs.${LIVE_READ_CONFIRM_KEY} == '${LIVE_READ_CONFIRM_VALUE}'`,
];

describe('main-push mutation quarantine', () => {
  it('workflow exposes the confirmation-gated manual dispatch input', () => {
    expect(ciYml).toContain('workflow_dispatch:');
    expect(ciYml).toContain(`${CONFIRM_KEY}:`);
    expect(ciYml).toContain(`${LIVE_READ_CONFIRM_KEY}:`);
    // still runs ordinary CI on push + PR to main
    expect(ciYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(ciYml).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  it('inventories every CI job that POSTs to system-ops', () => {
    expect(SYSTEM_OPS_POST_JOBS.map((job) => job.key).sort()).toEqual([
      'health-gate',
      'pipeline-smoke',
    ]);
  });

  it('inventories every CI job with direct live Supabase access markers', () => {
    expect(LIVE_SUPABASE_ACCESS_JOBS.map((job) => job.key).sort()).toEqual([
      'cron-alignment',
      'db-types-drift',
      'health-gate',
      'loop-health',
      'pipeline-smoke',
    ]);
  });

  it('no push- or pull_request-reachable CI job can POST to system-ops', () => {
    expect(SYSTEM_OPS_POST_JOBS.length).toBeGreaterThan(0);

    for (const job of SYSTEM_OPS_POST_JOBS) {
      expect(job.condition, `${job.key} must have an explicit guard`).not.toBe('true');
      expect(evalCondition(job.condition, CONTEXTS.pushToMain), job.key).toBe(false);
      expect(evalCondition(job.condition, CONTEXTS.pullRequest), job.key).toBe(false);
    }
  });

  it('no push- or pull_request-reachable CI job can perform direct live Supabase access', () => {
    expect(LIVE_SUPABASE_ACCESS_JOBS.length).toBeGreaterThan(0);

    for (const job of LIVE_SUPABASE_ACCESS_JOBS) {
      expect(job.condition, `${job.key} must have an explicit guard`).not.toBe('true');
      expect(evalCondition(job.condition, CONTEXTS.pushToMain), job.key).toBe(false);
      expect(evalCondition(job.condition, CONTEXTS.pullRequest), job.key).toBe(false);
    }
  });

  it('every system-ops POST job requires the exact manual main-branch confirmation gate', () => {
    for (const job of SYSTEM_OPS_POST_JOBS) {
      for (const term of REQUIRED_MANUAL_CONDITION_TERMS) {
        expect(job.condition, `${job.key} condition must include ${term}`).toContain(term);
      }
      expect(evalCondition(job.condition, CONTEXTS.dispatchNoConfirm), job.key).toBe(false);
      expect(evalCondition(job.condition, CONTEXTS.dispatchWrongValue), job.key).toBe(false);
      expect(evalCondition(job.condition, CONTEXTS.dispatchConfirmedWrongBranch), job.key).toBe(false);
      expect(evalCondition(job.condition, CONTEXTS.dispatchConfirmed), job.key).toBe(true);
    }
  });

  it('every direct live Supabase job uses an approved manual-only gate', () => {
    for (const job of LIVE_SUPABASE_ACCESS_JOBS) {
      const allowedTerms = job.key === 'health-gate' || job.key === 'pipeline-smoke'
        ? REQUIRED_MANUAL_CONDITION_TERMS
        : REQUIRED_LIVE_READ_CONDITION_TERMS;

      for (const term of allowedTerms) {
        expect(job.condition, `${job.key} condition must include ${term}`).toContain(term);
      }
    }
  });

  for (const { key, displayName } of LIVE_READ_JOBS) {
    describe(`${key} live production read quarantine`, () => {
      const block = jobBlock(ciYml, key);
      const condition = extractIf(block);

      it('has the explicit manual-only live-read display name', () => {
        expect(block).toContain(`name: '${displayName}'`);
      });

      it('a push to main CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.pushToMain)).toBe(false);
      });

      it('a pull_request CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.pullRequest)).toBe(false);
      });

      it('manual dispatch WITHOUT the exact live-read confirmation CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchLiveReadsNoConfirm)).toBe(false);
        expect(evalCondition(condition, CONTEXTS.dispatchLiveReadsWrongValue)).toBe(false);
      });

      it('manual dispatch from any branch other than main CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchLiveReadsConfirmedWrongBranch)).toBe(false);
      });

      it('ONLY manual dispatch from main with the exact live-read confirmation invokes it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchLiveReadsConfirmed)).toBe(true);
      });

      it('does not reuse the mutating system-ops confirmation value', () => {
        expect(condition).toContain(`github.event.inputs.${LIVE_READ_CONFIRM_KEY} == '${LIVE_READ_CONFIRM_VALUE}'`);
        expect(condition).not.toContain(`github.event.inputs.${CONFIRM_KEY}`);
        expect(condition).not.toContain(CONFIRM_VALUE);
      });
    });
  }

  for (const { key, action } of PRIVILEGED_JOBS) {
    describe(`${key} (system-ops ${action})`, () => {
      const block = jobBlock(ciYml, key);
      const condition = extractIf(block);

      it(`still targets system-ops with the "${action}" action (handler behavior unchanged)`, () => {
        expect(block).toContain('/functions/v1/system-ops');
        expect(block).toContain(`"action":"${action}"`);
      });

      it('a push to main CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.pushToMain)).toBe(false);
      });

      it('a pull_request CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.pullRequest)).toBe(false);
      });

      it('manual dispatch WITHOUT the exact confirmation CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchNoConfirm)).toBe(false);
        expect(evalCondition(condition, CONTEXTS.dispatchWrongValue)).toBe(false);
      });

      it('manual dispatch from any branch other than main CANNOT invoke it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchConfirmedWrongBranch)).toBe(false);
      });

      it('ONLY manual dispatch with the exact confirmation invokes it', () => {
        expect(evalCondition(condition, CONTEXTS.dispatchConfirmed)).toBe(true);
      });

      it('condition no longer contains the old push-to-main auto-trigger', () => {
        expect(condition).not.toContain("event_name == 'push'");
        expect(condition).toContain("event_name == 'workflow_dispatch'");
        expect(condition).toContain("github.ref == 'refs/heads/main'");
        expect(condition).toContain(`github.event.inputs.${CONFIRM_KEY} == '${CONFIRM_VALUE}'`);
      });
    });
  }

  it('does not disable unrelated non-live CI jobs', () => {
    for (const job of ['build', 'lint', 'unit-tests']) {
      expect(ciYml).toContain(`  ${job}:`);
    }
  });

  it('keeps the existing mutating system-ops gates unchanged', () => {
    for (const { key } of PRIVILEGED_JOBS) {
      const condition = extractIf(jobBlock(ciYml, key));
      for (const term of REQUIRED_MANUAL_CONDITION_TERMS) {
        expect(condition).toContain(term);
      }
      expect(condition).not.toContain(LIVE_READ_CONFIRM_KEY);
      expect(condition).not.toContain(LIVE_READ_CONFIRM_VALUE);
    }
  });
});
