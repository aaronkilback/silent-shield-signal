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
};

const PRIVILEGED_JOBS = [
  { key: 'health-gate', action: 'health-check' },
  { key: 'pipeline-smoke', action: 'pipeline-tests' },
];

describe('main-push mutation quarantine', () => {
  it('workflow exposes the confirmation-gated manual dispatch input', () => {
    expect(ciYml).toContain('workflow_dispatch:');
    expect(ciYml).toContain(`${CONFIRM_KEY}:`);
    // still runs ordinary CI on push + PR to main
    expect(ciYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(ciYml).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

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

  it('does not disable unrelated CI jobs', () => {
    for (const job of ['build', 'lint', 'cron-alignment', 'db-types-drift', 'unit-tests']) {
      expect(ciYml).toContain(`  ${job}:`);
    }
  });

  it('leaves the read-oriented loop-health check on its original push-to-main trigger', () => {
    const loop = jobBlock(ciYml, 'loop-health');
    expect(extractIf(loop)).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
  });
});
