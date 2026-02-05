/**
 * Critical Function Health Check
 * 
 * Verifies that essential edge functions are deployed and responding.
 * Runs automatically on app startup to catch deployment issues early.
 */

// Uses native fetch for OPTIONS check - no supabase client needed

// Critical functions that MUST be deployed for core functionality
const CRITICAL_FUNCTIONS = [
  'get-user-tenants',      // Tenant selection (required for multi-tenancy)
  'agent-chat',            // Aegis AI chat
  'dashboard-ai-assistant', // Dashboard AI assistant
  'system-health-check',   // System health monitoring
  'ingest-signal',         // Signal processing
] as const;

export type CriticalFunction = typeof CRITICAL_FUNCTIONS[number];

export interface FunctionStatus {
  name: string;
  status: 'ok' | 'error' | 'timeout';
  responseTime?: number;
  error?: string;
}

export interface CriticalCheckResult {
  allHealthy: boolean;
  functions: FunctionStatus[];
  failedCount: number;
  timestamp: string;
}

/**
 * Check if a single edge function is responding
 */
async function checkFunction(functionName: string): Promise<FunctionStatus> {
  const start = Date.now();
  
  try {
    // Use OPTIONS request - CORS preflight confirms function exists
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'OPTIONS',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );
    
    const responseTime = Date.now() - start;
    
    // 404 means not deployed
    if (response.status === 404) {
      return {
        name: functionName,
        status: 'error',
        error: 'Function not deployed',
        responseTime,
      };
    }
    
    // Any other response (including CORS success) means deployed
    return {
      name: functionName,
      status: 'ok',
      responseTime,
    };
  } catch (err) {
    const responseTime = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    // Timeout detection
    if (responseTime > 9000 || errorMessage.includes('timeout')) {
      return {
        name: functionName,
        status: 'timeout',
        error: 'Function timed out',
        responseTime,
      };
    }
    
    // Network errors might still mean function is deployed but CORS blocked
    // Check if it's a CORS error (which means function exists)
    if (errorMessage.includes('CORS') || errorMessage.includes('NetworkError')) {
      return {
        name: functionName,
        status: 'ok',
        responseTime,
      };
    }
    
    return {
      name: functionName,
      status: 'error',
      error: errorMessage,
      responseTime,
    };
  }
}

/**
 * Check all critical functions
 * Returns health status for each function
 */
export async function checkCriticalFunctions(): Promise<CriticalCheckResult> {
  console.log('[CriticalFunctionCheck] Checking critical edge functions...');
  
  const results = await Promise.all(
    CRITICAL_FUNCTIONS.map(fn => checkFunction(fn))
  );
  
  const failedFunctions = results.filter(r => r.status !== 'ok');
  
  if (failedFunctions.length > 0) {
    console.warn('[CriticalFunctionCheck] ⚠️ Some critical functions are unhealthy:', 
      failedFunctions.map(f => `${f.name}: ${f.error}`).join(', ')
    );
  } else {
    console.log('[CriticalFunctionCheck] ✅ All critical functions healthy');
  }
  
  return {
    allHealthy: failedFunctions.length === 0,
    functions: results,
    failedCount: failedFunctions.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Quick health check - just verifies functions respond
 * Use this for lightweight periodic checks
 */
export async function quickHealthCheck(): Promise<boolean> {
  try {
    // Just check one critical function as a smoke test
    const result = await checkFunction('system-health-check');
    return result.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get list of critical functions for monitoring UI
 */
export function getCriticalFunctionList(): readonly string[] {
  return CRITICAL_FUNCTIONS;
}
