import { useState, useCallback, useRef } from 'react';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryCondition?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

interface RetryState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  attempt: number;
  isRetrying: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'retryCondition'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
};

// Jitter to prevent thundering herd
function addJitter(delay: number): number {
  return delay + Math.random() * (delay * 0.2);
}

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffFactor: number
): number {
  const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt - 1);
  const boundedDelay = Math.min(exponentialDelay, maxDelay);
  return addJitter(boundedDelay);
}

// Default retry condition - retry on network errors and 5xx responses
function defaultRetryCondition(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // Network errors
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return true;
  }
  
  // Server errors (5xx)
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }
  
  // Rate limiting
  if (message.includes('429') || message.includes('rate limit')) {
    return true;
  }
  
  return false;
}

/**
 * Hook for executing async operations with exponential backoff retry logic
 */
export function useRetry<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions = {}
): RetryState<T> & {
  execute: () => Promise<T | null>;
  reset: () => void;
  cancel: () => void;
} {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    baseDelay = DEFAULT_OPTIONS.baseDelay,
    maxDelay = DEFAULT_OPTIONS.maxDelay,
    backoffFactor = DEFAULT_OPTIONS.backoffFactor,
    retryCondition = defaultRetryCondition,
    onRetry,
  } = options;

  const [state, setState] = useState<RetryState<T>>({
    data: null,
    error: null,
    isLoading: false,
    attempt: 0,
    isRetrying: false,
  });

  const cancelledRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isLoading: false, isRetrying: false }));
  }, []);

  const reset = useCallback(() => {
    cancel();
    cancelledRef.current = false;
    setState({
      data: null,
      error: null,
      isLoading: false,
      attempt: 0,
      isRetrying: false,
    });
  }, [cancel]);

  const execute = useCallback(async (): Promise<T | null> => {
    cancelledRef.current = false;
    setState(prev => ({ ...prev, isLoading: true, error: null, attempt: 1 }));

    let currentAttempt = 1;

    while (currentAttempt <= maxRetries + 1) {
      if (cancelledRef.current) {
        return null;
      }

      try {
        const result = await asyncFn();
        
        if (cancelledRef.current) {
          return null;
        }

        setState({
          data: result,
          error: null,
          isLoading: false,
          attempt: currentAttempt,
          isRetrying: false,
        });

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (cancelledRef.current) {
          return null;
        }

        // Check if we should retry
        const shouldRetry = currentAttempt <= maxRetries && retryCondition(error);

        if (shouldRetry) {
          const delay = calculateDelay(currentAttempt, baseDelay, maxDelay, backoffFactor);
          
          console.warn(
            `[useRetry] Attempt ${currentAttempt}/${maxRetries + 1} failed. Retrying in ${Math.round(delay)}ms...`,
            error.message
          );

          onRetry?.(currentAttempt, error);

          setState(prev => ({
            ...prev,
            attempt: currentAttempt,
            isRetrying: true,
          }));

          // Wait before retry
          await new Promise<void>((resolve) => {
            timeoutRef.current = setTimeout(() => {
              timeoutRef.current = null;
              resolve();
            }, delay);
          });

          currentAttempt++;
        } else {
          // No more retries or condition not met
          console.error(
            `[useRetry] All ${currentAttempt} attempts failed.`,
            error.message
          );

          setState({
            data: null,
            error,
            isLoading: false,
            attempt: currentAttempt,
            isRetrying: false,
          });

          return null;
        }
      }
    }

    return null;
  }, [asyncFn, maxRetries, baseDelay, maxDelay, backoffFactor, retryCondition, onRetry]);

  return {
    ...state,
    execute,
    reset,
    cancel,
  };
}

/**
 * Utility function for one-off retry operations
 */
export async function retryAsync<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    baseDelay = DEFAULT_OPTIONS.baseDelay,
    maxDelay = DEFAULT_OPTIONS.maxDelay,
    backoffFactor = DEFAULT_OPTIONS.backoffFactor,
    retryCondition = defaultRetryCondition,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await asyncFn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const shouldRetry = attempt <= maxRetries && retryCondition(lastError);

      if (shouldRetry) {
        const delay = calculateDelay(attempt, baseDelay, maxDelay, backoffFactor);
        
        console.warn(
          `[retryAsync] Attempt ${attempt}/${maxRetries + 1} failed. Retrying in ${Math.round(delay)}ms...`
        );

        onRetry?.(attempt, lastError);

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }

  throw lastError;
}

/**
 * Circuit breaker pattern for protecting against cascading failures
 */
interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxCalls?: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime: number | null = null;
  private halfOpenCalls = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenMaxCalls: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 3;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        this.halfOpenCalls = 0;
      } else {
        throw new Error('Circuit breaker is open. Request blocked.');
      }
    }

    if (this.state === 'half-open' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error('Circuit breaker is half-open. Max test calls exceeded.');
    }

    try {
      if (this.state === 'half-open') {
        this.halfOpenCalls++;
      }

      const result = await fn();

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
    this.halfOpenCalls = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      console.warn(`[CircuitBreaker] Circuit opened after ${this.failures} failures`);
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = null;
    this.halfOpenCalls = 0;
  }
}
