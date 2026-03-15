import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRetry } from '@/hooks/useRetry';

// useRetry(asyncFn, options) — asyncFn is passed at hook creation, not to execute()
// execute() calls the registered asyncFn with retry logic
// State: { data, error, isLoading, attempt, isRetrying }
// defaultRetryCondition: only retries on 'network'|'fetch'|'timeout'|'5xx'|'429'|'rate limit'

describe('useRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts with idle state — not loading, no error, attempt 0', () => {
    const fn = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useRetry(fn));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.attempt).toBe(0);
    expect(result.current.data).toBeNull();
  });

  it('executes asyncFn and returns data on success', async () => {
    const fn = vi.fn().mockResolvedValue('signal-data');
    const { result } = renderHook(() => useRetry(fn));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('signal-data');
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sets isLoading true while executing', async () => {
    let resolve: (v: string) => void;
    const fn = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useRetry(fn));

    act(() => { result.current.execute(); });
    expect(result.current.isLoading).toBe(true);

    await act(async () => { resolve!('done'); });
    expect(result.current.isLoading).toBe(false);
  });

  it('retries on network errors (matches retryCondition) and succeeds on second attempt', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('network error');
      return 'recovered';
    });

    const { result } = renderHook(() => useRetry(fn, { maxRetries: 3, baseDelay: 10 }));

    await act(async () => {
      result.current.execute();
      await vi.runAllTimersAsync();
    });

    expect(result.current.data).toBe('recovered');
    expect(result.current.error).toBeNull();
    expect(calls).toBe(2);
  });

  it('does NOT retry errors that fail retryCondition', async () => {
    // Generic errors without network/5xx keywords are not retried
    const fn = vi.fn().mockRejectedValue(new Error('permission denied'));
    const { result } = renderHook(() => useRetry(fn, { maxRetries: 3, baseDelay: 10 }));

    await act(async () => {
      await result.current.execute();
      await vi.runAllTimersAsync();
    });

    // Should only be called once — condition failed so no retries
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toBeNull();
  });

  it('exhausts retries on persistent network errors and sets error state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed: service unavailable'));
    const { result } = renderHook(() => useRetry(fn, { maxRetries: 2, baseDelay: 10 }));

    await act(async () => {
      result.current.execute();
      await vi.runAllTimersAsync();
    });

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(result.current.error?.message).toContain('fetch failed');
    expect(result.current.isLoading).toBe(false);
  });

  it('reset clears error, data, and resets attempt to 0', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fetch error'));
    const { result } = renderHook(() => useRetry(fn, { maxRetries: 0 }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.attempt).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('cancel stops an in-flight request and clears loading', async () => {
    let resolve: (v: string) => void;
    const fn = vi.fn().mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useRetry(fn));

    act(() => { result.current.execute(); });
    expect(result.current.isLoading).toBe(true);

    act(() => { result.current.cancel(); });
    expect(result.current.isLoading).toBe(false);
  });
});
