import { describe, expect, it } from 'vitest';
import {
  applyAnalystSignalFilter,
  applySignalFilterForRole,
  isQuarantineHiddenForRole,
} from '@/lib/signal-query-filters';

class QueryRecorder {
  filters: Array<{ column: string; value: unknown }> = [];

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }
}

describe('signal query filters', () => {
  it('applies the analyst quality-status filter', () => {
    const query = new QueryRecorder();

    const result = applyAnalystSignalFilter(query);

    expect(result).toBe(query);
    expect(query.filters).toEqual([{ column: 'quality_status', value: 'active' }]);
  });

  it('applies the quality-status filter for analyst role', () => {
    const query = new QueryRecorder();

    const result = applySignalFilterForRole(query, 'analyst');

    expect(result).toBe(query);
    expect(query.filters).toEqual([{ column: 'quality_status', value: 'active' }]);
  });

  it('leaves the query unchanged for operator role', () => {
    const query = new QueryRecorder();

    const result = applySignalFilterForRole(query, 'operator');

    expect(result).toBe(query);
    expect(query.filters).toEqual([]);
  });

  it('hides quarantined rows from analyst role only', () => {
    expect(isQuarantineHiddenForRole({ quality_status: 'quarantined' }, 'analyst')).toBe(true);
    expect(isQuarantineHiddenForRole({ quality_status: 'active' }, 'analyst')).toBe(false);
    expect(isQuarantineHiddenForRole(null, 'analyst')).toBe(false);
  });

  it('does not hide quarantined rows from operator role', () => {
    expect(isQuarantineHiddenForRole({ quality_status: 'quarantined' }, 'operator')).toBe(false);
  });
});
