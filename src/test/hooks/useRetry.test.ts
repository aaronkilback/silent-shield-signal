import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRetry } from '@/hooks/useRetry';

describe('useRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes the operation and returns result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('signal-data');
    const { result } = renderHook(() => useRetry());

    let returnValue: string | undefined;
    await act(async () => {
      returnValue = await result.current.execute(operation);
    });

    expect(returnValue).toBe('signal-data');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('starts with isLoading false and no error', () => {
    const { result } = renderHook(() => useRetry());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.attemptCount).toBe(0);
  });

  it('sets isLoading true while executing', async () => {
    let resolveOp: (v: string) => void;
    const operation = vi.fn().mockReturnValue(new Promise(r => { resolveOp = r; }));
    const { result } = renderHook(() => useRetry());

    act(() => {
      result.current.execute(operation);
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveOp!('done');
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('retries on failure and succeeds on retry', async () => {
    let calls = 0;
    const operation = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('transient error');
      return 'recovered';
    });

    const { result } = renderHook(() => useRetry({ maxRetries: 3, baseDelay: 10 }));

    let returnValue: string | undefined;
    await act(async () => {
      returnValue = await result.current.execute(operation);
      await vi.runAllTimersAsync();
    });

    expect(returnValue).toBe('recovered');
    expect(calls).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it('sets error after all retries exhausted', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('persistent failure'));
    const { result } = renderHook(() => useRetry({ maxRetries: 2, baseDelay: 10 }));

    await act(async () => {
      try {
        await result.current.execute(operation);
      } catch {}
      await vi.runAllTimersAsync();
    });

    expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(result.current.error).toBeTruthy();
    expect(result.current.isLoading).toBe(false);
  });

  it('reset clears error and attempt count', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useRetry({ maxRetries: 0 }));

    await act(async () => {
      try { await result.current.execute(operation); } catch {}
    });

    expect(result.current.error).toBeTruthy();

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.attemptCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('tracks attempt count during retries', async () => {
    let calls = 0;
    const operation = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return 'ok';
    });

    const { result } = renderHook(() => useRetry({ maxRetries: 3, baseDelay: 10 }));

    await act(async () => {
      await result.current.execute(operation);
      await vi.runAllTimersAsync();
    });

    expect(calls).toBe(3);
  });
});
