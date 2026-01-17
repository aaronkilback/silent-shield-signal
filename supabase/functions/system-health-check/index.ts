import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms: number;
  message?: string;
  last_checked: string;
}

interface SystemHealthResponse {
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  timestamp: string;
  version: string;
}

async function checkDatabase(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.from('clients').select('id').limit(1);
    const latency = Date.now() - start;
    
    if (error) {
      return {
        name: 'database',
        status: latency > 5000 ? 'unhealthy' : 'degraded',
        latency_ms: latency,
        message: error.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'database',
      status: latency > 2000 ? 'degraded' : 'healthy',
      latency_ms: latency,
      message: latency > 2000 ? 'High latency detected' : undefined,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'database',
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Unknown error',
      last_checked: new Date().toISOString(),
    };
  }
}

async function checkAuth(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // Just check that auth service responds
    const { error } = await supabase.auth.getSession();
    const latency = Date.now() - start;
    
    // getSession returns null session when not authenticated, which is expected
    if (error && !error.message.includes('session')) {
      return {
        name: 'auth',
        status: 'degraded',
        latency_ms: latency,
        message: error.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'auth',
      status: latency > 2000 ? 'degraded' : 'healthy',
      latency_ms: latency,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'auth',
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Unknown error',
      last_checked: new Date().toISOString(),
    };
  }
}

async function checkStorage(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.storage.listBuckets();
    const latency = Date.now() - start;
    
    if (error) {
      return {
        name: 'storage',
        status: 'degraded',
        latency_ms: latency,
        message: error.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'storage',
      status: latency > 3000 ? 'degraded' : 'healthy',
      latency_ms: latency,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'storage',
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Unknown error',
      last_checked: new Date().toISOString(),
    };
  }
}

async function checkExternalAPI(
  name: string,
  url: string,
  timeout: number = 10000
): Promise<HealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    const latency = Date.now() - start;
    
    if (!response.ok) {
      return {
        name,
        status: 'degraded',
        latency_ms: latency,
        message: `HTTP ${response.status}`,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name,
      status: latency > 5000 ? 'degraded' : 'healthy',
      latency_ms: latency,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    return {
      name,
      status: 'unhealthy',
      latency_ms: latency,
      message: err instanceof Error ? err.message : 'Connection failed',
      last_checked: new Date().toISOString(),
    };
  }
}

async function checkAIGateway(): Promise<HealthCheckResult> {
  const start = Date.now();
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  if (!LOVABLE_API_KEY) {
    return {
      name: 'ai_gateway',
      status: 'unhealthy',
      latency_ms: 0,
      message: 'LOVABLE_API_KEY not configured',
      last_checked: new Date().toISOString(),
    };
  }
  
  try {
    // Use a minimal chat completion request to test the gateway
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const latency = Date.now() - start;
    
    if (!response.ok) {
      return {
        name: 'ai_gateway',
        status: 'degraded',
        latency_ms: latency,
        message: `HTTP ${response.status}`,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'ai_gateway',
      status: latency > 3000 ? 'degraded' : 'healthy',
      latency_ms: latency,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'ai_gateway',
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
      last_checked: new Date().toISOString(),
    };
  }
}

async function checkRecentErrors(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // Check for recent critical errors in bug_reports
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: recentErrors, error } = await supabase
      .from('bug_reports')
      .select('id, severity')
      .gte('created_at', oneHourAgo)
      .in('severity', ['critical', 'high']);
    
    const latency = Date.now() - start;
    
    if (error) {
      return {
        name: 'error_rate',
        status: 'degraded',
        latency_ms: latency,
        message: error.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    const criticalCount = (recentErrors || []).filter((e: any) => e.severity === 'critical').length;
    const highCount = (recentErrors || []).filter((e: any) => e.severity === 'high').length;
    
    if (criticalCount > 0) {
      return {
        name: 'error_rate',
        status: 'unhealthy',
        latency_ms: latency,
        message: `${criticalCount} critical errors in last hour`,
        last_checked: new Date().toISOString(),
      };
    }
    
    if (highCount > 5) {
      return {
        name: 'error_rate',
        status: 'degraded',
        latency_ms: latency,
        message: `${highCount} high-severity errors in last hour`,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'error_rate',
      status: 'healthy',
      latency_ms: latency,
      message: `${highCount} high-severity errors in last hour`,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'error_rate',
      status: 'degraded',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Check failed',
      last_checked: new Date().toISOString(),
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse options
    const url = new URL(req.url);
    const includeExternal = url.searchParams.get('external') !== 'false';
    const quick = url.searchParams.get('quick') === 'true';

    console.log('[HealthCheck] Starting system health check...');
    const startTime = Date.now();

    // Core checks (always run)
    const coreChecks = [
      checkDatabase(supabase),
      checkAuth(supabase),
      checkStorage(supabase),
      checkRecentErrors(supabase),
    ];

    // Extended checks (optional)
    const extendedChecks = includeExternal && !quick ? [
      checkAIGateway(),
      checkExternalAPI('weather_gov', 'https://api.weather.gov/'),
      checkExternalAPI('nasa_firms', 'https://firms.modaps.eosdis.nasa.gov/'),
    ] : [];

    // Run all checks in parallel
    const results = await Promise.all([...coreChecks, ...extendedChecks]);

    // Determine overall status
    const hasUnhealthy = results.some(r => r.status === 'unhealthy');
    const hasDegraded = results.some(r => r.status === 'degraded');
    
    const overall_status: 'healthy' | 'degraded' | 'unhealthy' = 
      hasUnhealthy ? 'unhealthy' : 
      hasDegraded ? 'degraded' : 
      'healthy';

    const response: SystemHealthResponse = {
      overall_status,
      checks: results,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };

    const totalTime = Date.now() - startTime;
    console.log(`[HealthCheck] Completed in ${totalTime}ms. Status: ${overall_status}`);

    // Log health check to database for historical tracking
    try {
      await supabase.from('audit_events').insert({
        action: 'system_health_check',
        resource: 'system',
        metadata: {
          overall_status,
          checks_count: results.length,
          unhealthy_count: results.filter(r => r.status === 'unhealthy').length,
          degraded_count: results.filter(r => r.status === 'degraded').length,
          total_latency_ms: totalTime,
        },
      });
    } catch (logError) {
      console.error('[HealthCheck] Failed to log health check:', logError);
    }

    return new Response(
      JSON.stringify(response),
      {
        status: overall_status === 'unhealthy' ? 503 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[HealthCheck] Critical error:', error);
    
    return new Response(
      JSON.stringify({
        overall_status: 'unhealthy',
        checks: [],
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
