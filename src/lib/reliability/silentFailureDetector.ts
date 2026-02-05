/**
 * Silent Failure Detection System
 * Catches and reports failures that would otherwise go unnoticed
 */

import { supabase } from "@/integrations/supabase/client";
import { trackError, ErrorCategory, ErrorSeverity } from '@/lib/errorTracking';

export interface SilentFailure {
  id: string;
  operation: string;
  timestamp: string;
  context: Record<string, unknown>;
  error?: string;
  detected_by: 'timeout' | 'expectation_mismatch' | 'state_inconsistency' | 'missing_response';
}

// Track operations that should complete within a timeframe
const pendingOperations = new Map<string, {
  operation: string;
  startTime: number;
  timeout: number;
  context: Record<string, unknown>;
  onTimeout: () => void;
}>();

// Track expected state changes that didn't happen
const expectedChanges = new Map<string, {
  table: string;
  expectedBy: number;
  condition: () => Promise<boolean>;
  onMissing: () => void;
}>();

/**
 * Start tracking an operation that should complete within a timeout
 */
export function trackOperation(
  operationId: string,
  operation: string,
  timeoutMs: number,
  context: Record<string, unknown> = {}
): () => void {
  const startTime = Date.now();
  
  const timeoutHandle = setTimeout(async () => {
    // Operation timed out - it's a silent failure
    const failure: SilentFailure = {
      id: operationId,
      operation,
      timestamp: new Date().toISOString(),
      context,
      detected_by: 'timeout',
    };
    
    await reportSilentFailure(failure);
    pendingOperations.delete(operationId);
  }, timeoutMs);
  
  pendingOperations.set(operationId, {
    operation,
    startTime,
    timeout: timeoutMs,
    context,
    onTimeout: () => clearTimeout(timeoutHandle),
  });
  
  // Return a function to mark the operation as complete
  return () => {
    const pending = pendingOperations.get(operationId);
    if (pending) {
      pending.onTimeout(); // Clear the timeout
      pendingOperations.delete(operationId);
    }
  };
}

/**
 * Expect a database change to occur within a timeframe
 */
export function expectChange(
  changeId: string,
  table: string,
  checkCondition: () => Promise<boolean>,
  timeoutMs: number = 30000
): void {
  const expectedBy = Date.now() + timeoutMs;
  
  const checkInterval = setInterval(async () => {
    try {
      const conditionMet = await checkCondition();
      if (conditionMet) {
        clearInterval(checkInterval);
        expectedChanges.delete(changeId);
        return;
      }
      
      if (Date.now() > expectedBy) {
        clearInterval(checkInterval);
        expectedChanges.delete(changeId);
        
        const failure: SilentFailure = {
          id: changeId,
          operation: `Expected change in ${table}`,
          timestamp: new Date().toISOString(),
          context: { table },
          detected_by: 'expectation_mismatch',
        };
        
        await reportSilentFailure(failure);
      }
    } catch (err) {
      console.error('[SilentFailureDetector] Error checking condition:', err);
    }
  }, 5000); // Check every 5 seconds
  
  expectedChanges.set(changeId, {
    table,
    expectedBy,
    condition: checkCondition,
    onMissing: () => clearInterval(checkInterval),
  });
}

/**
 * Report a silent failure
 */
async function reportSilentFailure(failure: SilentFailure): Promise<void> {
  console.error('[SilentFailure]', failure);
  
  // Track in our error tracking system
  await trackError(
    `Silent failure: ${failure.operation}`,
    {
      component: 'SilentFailureDetector',
      action: failure.operation,
      metadata: {
        ...failure.context,
        detected_by: failure.detected_by,
        failure_id: failure.id,
      },
    }
  );
  
  // Also store in bug_reports for visibility
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('bug_reports').insert({
      user_id: user?.id,
      title: `[Silent Failure] ${failure.operation}`,
      description: `**Detected by:** ${failure.detected_by}\n\n**Context:**\n\`\`\`json\n${JSON.stringify(failure.context, null, 2)}\n\`\`\``,
      severity: 'high',
      page_url: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  } catch (err) {
    console.error('[SilentFailureDetector] Failed to report:', err);
  }
}

/**
 * Wrap an async function to detect silent failures
 */
export function wrapWithDetection<T>(
  operation: string,
  fn: () => Promise<T>,
  options: {
    timeoutMs?: number;
    expectedResult?: (result: T) => boolean;
    context?: Record<string, unknown>;
  } = {}
): () => Promise<T> {
  const { timeoutMs = 30000, expectedResult, context = {} } = options;
  
  return async () => {
    const operationId = `${operation}-${Date.now()}`;
    const complete = trackOperation(operationId, operation, timeoutMs, context);
    
    try {
      const result = await fn();
      complete(); // Mark as complete before checking result
      
      // Check if result matches expectations
      if (expectedResult && !expectedResult(result)) {
        const failure: SilentFailure = {
          id: operationId,
          operation,
          timestamp: new Date().toISOString(),
          context: { ...context, result },
          detected_by: 'expectation_mismatch',
        };
        
        await reportSilentFailure(failure);
      }
      
      return result;
    } catch (err) {
      complete(); // Still mark as complete (it failed, but not silently)
      throw err; // Re-throw - this is a loud failure, not silent
    }
  };
}

/**
 * Monitor edge function invocations for silent failures
 */
export async function invokeWithDetection<T>(
  functionName: string,
  body: Record<string, unknown>,
  options: {
    timeoutMs?: number;
    expectedFields?: string[];
  } = {}
): Promise<{ data: T | null; error: Error | null; silent_failure: boolean }> {
  const { timeoutMs = 60000, expectedFields = [] } = options;
  const operationId = `edge-${functionName}-${Date.now()}`;
  
  const complete = trackOperation(operationId, `Edge function: ${functionName}`, timeoutMs, { body });
  
  try {
    const { data, error } = await supabase.functions.invoke<T>(functionName, { body });
    complete();
    
    if (error) {
      return { data: null, error, silent_failure: false };
    }
    
    // Check if expected fields are present
    if (data && expectedFields.length > 0) {
      const missingFields = expectedFields.filter(field => !(data as Record<string, unknown>)[field]);
      
      if (missingFields.length > 0) {
        const failure: SilentFailure = {
          id: operationId,
          operation: `Edge function: ${functionName}`,
          timestamp: new Date().toISOString(),
          context: { body, missingFields, response: data },
          detected_by: 'missing_response',
        };
        
        await reportSilentFailure(failure);
        return { data, error: null, silent_failure: true };
      }
    }
    
    return { data, error: null, silent_failure: false };
  } catch (err) {
    complete();
    return {
      data: null,
      error: err instanceof Error ? err : new Error(String(err)),
      silent_failure: false,
    };
  }
}

/**
 * Check for state inconsistencies between related tables
 */
export async function checkStateConsistency(): Promise<SilentFailure[]> {
  const failures: SilentFailure[] = [];
  
  // Check: All approved entity_suggestions should have matched_entity_id
  const { data: orphanedSuggestions } = await supabase
    .from('entity_suggestions')
    .select('id, suggested_name')
    .eq('status', 'approved')
    .is('matched_entity_id', null)
    .limit(10);
  
  if (orphanedSuggestions && orphanedSuggestions.length > 0) {
    failures.push({
      id: `consistency-entity-suggestions-${Date.now()}`,
      operation: 'Entity suggestion approval',
      timestamp: new Date().toISOString(),
      context: {
        orphanedCount: orphanedSuggestions.length,
        examples: orphanedSuggestions.slice(0, 3).map(s => s.suggested_name),
      },
      detected_by: 'state_inconsistency',
    });
  }
  
  // Check: All active incidents should have at least one signal OR created_by
  const { data: orphanedIncidents } = await supabase
    .from('incidents')
    .select('id, title')
    .not('status', 'eq', 'resolved')
    .is('signal_ids', null)
    .is('created_by', null)
    .limit(10);
  
  if (orphanedIncidents && orphanedIncidents.length > 0) {
    failures.push({
      id: `consistency-incidents-${Date.now()}`,
      operation: 'Incident creation',
      timestamp: new Date().toISOString(),
      context: {
        orphanedCount: orphanedIncidents.length,
        examples: orphanedIncidents.slice(0, 3).map(i => i.title),
      },
      detected_by: 'state_inconsistency',
    });
  }
  
  // Report all found inconsistencies
  for (const failure of failures) {
    await reportSilentFailure(failure);
  }
  
  return failures;
}

/**
 * Cleanup pending operations on page unload
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Clear all pending timeouts
    for (const [, pending] of pendingOperations) {
      pending.onTimeout();
    }
    pendingOperations.clear();
    
    // Clear all expected change intervals
    for (const [, expected] of expectedChanges) {
      expected.onMissing();
    }
    expectedChanges.clear();
  });
}
