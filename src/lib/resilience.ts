/**
 * Centralized resilience utilities for Fortress
 * Provides retry logic, circuit breakers, and fallback mechanisms
 */

import { supabase } from "@/integrations/supabase/client";

// Circuit breaker instances for external APIs
const circuitBreakers = new Map<string, CircuitBreakerState>();

interface CircuitBreakerState {
  failures: number;
  lastFailure: number | null;
  state: 'closed' | 'open' | 'half-open';
  successCount: number;
}

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  halfOpenSuccessThreshold: 2,
};

function getCircuitBreaker(name: string): CircuitBreakerState {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      successCount: 0,
    });
  }
  return circuitBreakers.get(name)!;
}

function updateCircuitBreaker(name: string, success: boolean): void {
  const cb = getCircuitBreaker(name);
  
  if (success) {
    if (cb.state === 'half-open') {
      cb.successCount++;
      if (cb.successCount >= CIRCUIT_BREAKER_CONFIG.halfOpenSuccessThreshold) {
        cb.state = 'closed';
        cb.failures = 0;
        cb.successCount = 0;
        console.log(`[CircuitBreaker] ${name} circuit closed after successful recovery`);
      }
    } else {
      cb.failures = 0;
    }
  } else {
    cb.failures++;
    cb.lastFailure = Date.now();
    cb.successCount = 0;
    
    if (cb.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      cb.state = 'open';
      console.warn(`[CircuitBreaker] ${name} circuit opened after ${cb.failures} failures`);
    }
  }
}

function isCircuitOpen(name: string): boolean {
  const cb = getCircuitBreaker(name);
  
  if (cb.state === 'open') {
    // Check if we should attempt reset
    if (cb.lastFailure && Date.now() - cb.lastFailure >= CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      cb.state = 'half-open';
      console.log(`[CircuitBreaker] ${name} circuit moved to half-open for testing`);
      return false;
    }
    return true;
  }
  
  return false;
}

/**
 * Invoke edge function with resilience (retry + circuit breaker)
 */
export async function invokeWithResilience<T>(
  functionName: string,
  body: Record<string, unknown>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    fallback?: T;
    circuitBreakerName?: string;
  } = {}
): Promise<{ data: T | null; error: Error | null }> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    fallback,
    circuitBreakerName = functionName,
  } = options;

  // Check circuit breaker
  if (isCircuitOpen(circuitBreakerName)) {
    console.warn(`[Resilience] Circuit open for ${circuitBreakerName}, using fallback`);
    return {
      data: fallback ?? null,
      error: new Error(`Circuit breaker open for ${circuitBreakerName}`),
    };
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke<T>(functionName, {
        body,
      });

      if (error) {
        throw error;
      }

      updateCircuitBreaker(circuitBreakerName, true);
      return { data, error: null };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      console.warn(
        `[Resilience] ${functionName} attempt ${attempt}/${maxRetries} failed:`,
        lastError.message
      );

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  updateCircuitBreaker(circuitBreakerName, false);

  // Use fallback if available
  if (fallback !== undefined) {
    console.log(`[Resilience] Using fallback for ${functionName}`);
    return { data: fallback, error: lastError };
  }

  return { data: null, error: lastError };
}

/**
 * Safe async operation wrapper with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Batch operations with concurrency limit
 */
export async function batchWithConcurrency<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  concurrency: number = 3
): Promise<{ results: R[]; errors: Error[] }> {
  const results: R[] = [];
  const errors: Error[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(operation));
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push(result.reason);
      }
    }
  }

  return { results, errors };
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
  const status: Record<string, CircuitBreakerState> = {};
  circuitBreakers.forEach((state, name) => {
    status[name] = { ...state };
  });
  return status;
}

/**
 * Reset a specific circuit breaker
 */
export function resetCircuitBreaker(name: string): void {
  circuitBreakers.delete(name);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  circuitBreakers.clear();
}
