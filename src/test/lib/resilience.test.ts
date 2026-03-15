import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

// We test invokeWithResilience by importing after mocks are established
// The module uses a module-level Map so we use dynamic import + vi.resetModules per describe

describe('invokeWithResilience — happy path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls the edge function and returns data on success', async () => {
    const mockData = { result: 'ok' };
    (supabase.functions.invoke as any).mockResolvedValue({ data: mockData, error: null });

    const { invokeWithResilience } = await import('@/lib/resilience');
    const result = await invokeWithResilience('test-fn', { action: 'ping' });

    expect(result.data).toEqual(mockData);
    expect(result.error).toBeNull();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('test-fn', { body: { action: 'ping' } });
  });

  it('returns fallback value when circuit is open and fallback provided', async () => {
    // Trigger 5 failures to open the circuit
    (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: new Error('service down') });

    const { invokeWithResilience } = await import('@/lib/resilience');
    const fallback = { status: 'degraded' };

    // Exhaust the failure threshold (default 5 retries × 3 attempts = 15 calls but circuit opens at 5 unique calls)
    for (let i = 0; i < 5; i++) {
      await invokeWithResilience('cb-test-fn', {}, { maxRetries: 0, circuitBreakerName: 'cb-open-test' });
    }

    // Now the circuit should be open — next call returns fallback
    const result = await invokeWithResilience('cb-test-fn', {}, {
      maxRetries: 0,
      circuitBreakerName: 'cb-open-test',
      fallback,
    });

    expect(result.data).toEqual(fallback);
  });
});

describe('invokeWithResilience — retry behaviour', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('retries on failure and succeeds on second attempt', async () => {
    let callCount = 0;
    (supabase.functions.invoke as any).mockImplementation(async () => {
      callCount++;
      if (callCount < 2) return { data: null, error: new Error('transient') };
      return { data: { ok: true }, error: null };
    });

    const { invokeWithResilience } = await import('@/lib/resilience');
    const result = await invokeWithResilience('retry-fn', {}, {
      maxRetries: 3,
      baseDelay: 0, // no delay in tests
      circuitBreakerName: 'retry-test-unique',
    });

    expect(result.data).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it('returns error after exhausting all retries', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: new Error('always fails') });

    const { invokeWithResilience } = await import('@/lib/resilience');
    const result = await invokeWithResilience('always-fail-fn', {}, {
      maxRetries: 2,
      baseDelay: 0,
      circuitBreakerName: 'exhausted-retries-unique',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
