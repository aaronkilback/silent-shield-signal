import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  applySignalFilterForRole,
  isQuarantineHiddenForRole,
  type SignalAccessRole,
} from '@/lib/signal-query-filters';
import { resolveRealtimeSignalAccessRole } from '@/hooks/useRealtimeNotifications';

const repoRoot = process.cwd();
const guardedFrontendPaths = ['src/hooks', 'src/contexts', 'src/lib'];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

function makeQuery() {
  const calls: Array<{ column: string; value: unknown }> = [];
  const query = {
    calls,
    eq(column: string, value: unknown) {
      calls.push({ column, value });
      return query;
    },
  };
  return query;
}

describe('browser signal query filters', () => {
  it('keeps the guarded frontend paths free of privileged server role literals', () => {
    const forbidden = 'service' + '_role';
    const offenders = guardedFrontendPaths.flatMap((relativeDir) => {
      const absoluteDir = join(repoRoot, relativeDir);
      return listFiles(absoluteDir)
        .filter((file) => /\.(ts|tsx)$/.test(file))
        .filter((file) => readFileSync(file, 'utf8').includes(forbidden))
        .map((file) => file.replace(`${repoRoot}/`, ''));
    });

    expect(offenders).toEqual([]);
  });

  it('restricts realtime notification role selection to analyst or operator', () => {
    expect(resolveRealtimeSignalAccessRole(false)).toBe('analyst');
    expect(resolveRealtimeSignalAccessRole(true)).toBe('operator');

    const roles = [
      resolveRealtimeSignalAccessRole(false),
      resolveRealtimeSignalAccessRole(true),
    ] satisfies SignalAccessRole[];

    expect(new Set(roles)).toEqual(new Set(['analyst', 'operator']));
  });

  it('filters analyst queries and leaves operator queries unfiltered', () => {
    const analystQuery = makeQuery();
    applySignalFilterForRole(analystQuery, 'analyst');
    expect(analystQuery.calls).toEqual([{ column: 'quality_status', value: 'active' }]);

    const operatorQuery = makeQuery();
    applySignalFilterForRole(operatorQuery, 'operator');
    expect(operatorQuery.calls).toEqual([]);
  });

  it('suppresses quarantined realtime rows only for analyst visibility', () => {
    const row = { quality_status: 'quarantined' };

    expect(isQuarantineHiddenForRole(row, 'analyst')).toBe(true);
    expect(isQuarantineHiddenForRole(row, 'operator')).toBe(false);
  });
});
