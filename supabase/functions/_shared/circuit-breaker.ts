/**
 * Circuit Breaker for External API Calls
 * 
 * Prevents cascading failures when external services (OpenAI, Perplexity,
 * Google Search) are down. Implements the standard circuit breaker pattern:
 * 
 *   CLOSED → (failures exceed threshold) → OPEN → (timeout expires) → HALF_OPEN → (success) → CLOSED
 *                                                                     → (failure) → OPEN
 * 
 * Usage:
 *   import { CircuitBreaker } from "../_shared/circuit-breaker.ts";
 *   
 *   const cb = new CircuitBreaker('openai');
 *   const result = await cb.execute(async () => {
 *     return await fetch('https://api.openai.com/...');
 *   });
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logError } from "./error-logger.ts";

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerOptions {
  failureThreshold?: number;    // How many failures before opening (default: 5)
  recoveryTimeoutMs?: number;   // How long to stay open before half-open (default: 60s)
  successThreshold?: number;    // Successes needed to close from half-open (default: 2)
}

export class CircuitBreaker {
  private serviceName: string;
  private failureThreshold: number;
  private recoveryTimeoutMs: number;
  private successThreshold: number;

  // In-memory cache to avoid DB reads on every call
  private static stateCache: Map<string, { state: CircuitState; fetchedAt: number; failureCount: number }> = new Map();
  private static CACHE_TTL = 10_000; // 10s

  constructor(serviceName: string, options: CircuitBreakerOptions = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 60_000;
    this.successThreshold = options.successThreshold ?? 2;
  }

  private getSupabase() {
    return createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }

  /**
   * Get the current circuit state, using cache when available.
   */
  private async getState(): Promise<{ state: CircuitState; failureCount: number; openedAt: string | null }> {
    const cached = CircuitBreaker.stateCache.get(this.serviceName);
    if (cached && Date.now() - cached.fetchedAt < CircuitBreaker.CACHE_TTL) {
      return { state: cached.state, failureCount: cached.failureCount, openedAt: null };
    }

    const supabase = this.getSupabase();
    const { data } = await supabase
      .from('circuit_breaker_state')
      .select('state, failure_count, opened_at')
      .eq('service_name', this.serviceName)
      .single();

    if (!data) {
      // First time — initialize as closed
      await supabase.from('circuit_breaker_state').insert({
        service_name: this.serviceName,
        state: 'closed',
        failure_count: 0,
        failure_threshold: this.failureThreshold,
        recovery_timeout_ms: this.recoveryTimeoutMs,
      });
      CircuitBreaker.stateCache.set(this.serviceName, { state: 'closed', fetchedAt: Date.now(), failureCount: 0 });
      return { state: 'closed', failureCount: 0, openedAt: null };
    }

    CircuitBreaker.stateCache.set(this.serviceName, {
      state: data.state as CircuitState,
      fetchedAt: Date.now(),
      failureCount: data.failure_count,
    });

    return { state: data.state as CircuitState, failureCount: data.failure_count, openedAt: data.opened_at };
  }

  /**
   * Record a failure and potentially trip the circuit.
   */
  private async recordFailure(error: unknown): Promise<void> {
    const supabase = this.getSupabase();
    const { state, failureCount } = await this.getState();
    const newCount = failureCount + 1;

    if (state === 'closed' && newCount >= this.failureThreshold) {
      // TRIP THE CIRCUIT
      await supabase
        .from('circuit_breaker_state')
        .update({
          state: 'open',
          failure_count: newCount,
          last_failure_at: new Date().toISOString(),
          opened_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('service_name', this.serviceName);

      CircuitBreaker.stateCache.set(this.serviceName, { state: 'open', fetchedAt: Date.now(), failureCount: newCount });
      
      // Log critical error
      await logError(error, {
        functionName: `circuit-breaker:${this.serviceName}`,
        severity: 'critical',
        requestContext: { event: 'circuit_opened', failureCount: newCount },
      });

      console.warn(`[CircuitBreaker] ⚡ CIRCUIT OPENED for ${this.serviceName} after ${newCount} failures`);
    } else if (state === 'half_open') {
      // Failed during recovery — reopen
      await supabase
        .from('circuit_breaker_state')
        .update({
          state: 'open',
          failure_count: newCount,
          last_failure_at: new Date().toISOString(),
          opened_at: new Date().toISOString(),
          success_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('service_name', this.serviceName);

      CircuitBreaker.stateCache.set(this.serviceName, { state: 'open', fetchedAt: Date.now(), failureCount: newCount });
    } else {
      // Just increment failure count
      await supabase
        .from('circuit_breaker_state')
        .update({
          failure_count: newCount,
          last_failure_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('service_name', this.serviceName);

      CircuitBreaker.stateCache.set(this.serviceName, { state, fetchedAt: Date.now(), failureCount: newCount });
    }
  }

  /**
   * Record a success and potentially close the circuit.
   */
  private async recordSuccess(): Promise<void> {
    const supabase = this.getSupabase();
    const { state } = await this.getState();

    if (state === 'half_open') {
      // Get current success count
      const { data } = await supabase
        .from('circuit_breaker_state')
        .select('success_count')
        .eq('service_name', this.serviceName)
        .single();

      const newSuccessCount = (data?.success_count || 0) + 1;

      if (newSuccessCount >= this.successThreshold) {
        // CLOSE THE CIRCUIT — recovered!
        await supabase
          .from('circuit_breaker_state')
          .update({
            state: 'closed',
            failure_count: 0,
            success_count: 0,
            last_success_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('service_name', this.serviceName);

        CircuitBreaker.stateCache.set(this.serviceName, { state: 'closed', fetchedAt: Date.now(), failureCount: 0 });
        console.log(`[CircuitBreaker] ✅ CIRCUIT CLOSED for ${this.serviceName} — recovered`);
      } else {
        await supabase
          .from('circuit_breaker_state')
          .update({
            success_count: newSuccessCount,
            last_success_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('service_name', this.serviceName);
      }
    } else if (state === 'closed') {
      // Reset failure count on success while closed
      await supabase
        .from('circuit_breaker_state')
        .update({
          failure_count: 0,
          last_success_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('service_name', this.serviceName);

      CircuitBreaker.stateCache.set(this.serviceName, { state: 'closed', fetchedAt: Date.now(), failureCount: 0 });
    }
  }

  /**
   * Execute a function with circuit breaker protection.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const { state, openedAt } = await this.getState();

    if (state === 'open') {
      // Check if recovery timeout has passed
      const openedTime = openedAt ? new Date(openedAt).getTime() : 0;
      if (Date.now() - openedTime > this.recoveryTimeoutMs) {
        // Transition to half-open — allow one probe request
        const supabase = this.getSupabase();
        await supabase
          .from('circuit_breaker_state')
          .update({
            state: 'half_open',
            half_open_at: new Date().toISOString(),
            success_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('service_name', this.serviceName);

        CircuitBreaker.stateCache.set(this.serviceName, { state: 'half_open', fetchedAt: Date.now(), failureCount: 0 });
        console.log(`[CircuitBreaker] 🔄 HALF-OPEN for ${this.serviceName} — probing`);
      } else {
        throw new CircuitOpenError(this.serviceName);
      }
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure(error);
      throw error;
    }
  }
}

/**
 * Error thrown when attempting to call a service whose circuit is open.
 */
export class CircuitOpenError extends Error {
  public serviceName: string;
  
  constructor(serviceName: string) {
    super(`Circuit breaker OPEN for ${serviceName} — service is currently unavailable. Will retry automatically.`);
    this.name = 'CircuitOpenError';
    this.serviceName = serviceName;
  }
}

/**
 * Convenience function: execute with circuit breaker + retry + dead letter queue.
 * This is the recommended way to call external APIs.
 */
export async function protectedApiCall<T>(
  serviceName: string,
  functionName: string,
  fn: () => Promise<T>,
  options?: {
    retries?: number;
    retryDelayMs?: number;
    dlqPayload?: Record<string, unknown>;
  }
): Promise<T> {
  const cb = new CircuitBreaker(serviceName);
  const maxRetries = options?.retries ?? 2;
  const baseDelay = options?.retryDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await cb.execute(fn);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        // Don't retry if circuit is open — fast fail
        throw error;
      }
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[${functionName}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        // All retries exhausted — enqueue to DLQ if payload provided
        if (options?.dlqPayload) {
          const { enqueueForRetry } = await import("./error-logger.ts");
          const errorId = await logError(error, {
            functionName,
            severity: 'critical',
            requestContext: { retriesExhausted: true, attempts: maxRetries + 1 },
          });
          await enqueueForRetry(functionName, options.dlqPayload, String(error), errorId);
        }
        throw error;
      }
    }
  }

  throw new Error('Unreachable');
}
