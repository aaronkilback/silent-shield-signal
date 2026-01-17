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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkAuth(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.auth.getSession();
    const latency = Date.now() - start;
    
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkStorageBuckets(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const requiredBuckets = ['archival-documents', 'entity-photos', 'ai-chat-attachments'];
  const missingBuckets: string[] = [];
  
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      return {
        name: 'storage_buckets',
        status: 'degraded',
        latency_ms: Date.now() - start,
        message: error.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bucketIds = (buckets || []).map((b: any) => b.id);
    
    for (const required of requiredBuckets) {
      if (!bucketIds.includes(required)) {
        missingBuckets.push(required);
      }
    }
    
    const latency = Date.now() - start;
    
    if (missingBuckets.length > 0) {
      return {
        name: 'storage_buckets',
        status: 'unhealthy',
        latency_ms: latency,
        message: `Missing buckets: ${missingBuckets.join(', ')}`,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'storage_buckets',
      status: 'healthy',
      latency_ms: latency,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'storage_buckets',
      status: 'degraded',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Check failed',
      last_checked: new Date().toISOString(),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkDocumentProcessing(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // Check for documents stuck in processing (uploaded in last hour but no content_text)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: stuckDocs, error: stuckError } = await supabase
      .from('archival_documents')
      .select('id')
      .is('content_text', null)
      .gte('created_at', oneHourAgo)
      .limit(100);
    
    if (stuckError) {
      return {
        name: 'document_processing',
        status: 'degraded',
        latency_ms: Date.now() - start,
        message: stuckError.message,
        last_checked: new Date().toISOString(),
      };
    }
    
    const stuckCount = stuckDocs?.length || 0;
    const latency = Date.now() - start;
    
    // More than 10 unprocessed docs in the last hour indicates a problem
    if (stuckCount > 10) {
      return {
        name: 'document_processing',
        status: 'degraded',
        latency_ms: latency,
        message: `${stuckCount} unprocessed documents in last hour`,
        last_checked: new Date().toISOString(),
      };
    }
    
    return {
      name: 'document_processing',
      status: 'healthy',
      latency_ms: latency,
      message: stuckCount > 0 ? `${stuckCount} documents pending` : undefined,
      last_checked: new Date().toISOString(),
    };
  } catch (err) {
    return {
      name: 'document_processing',
      status: 'degraded',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Check failed',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkRecentErrors(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
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
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const criticalCount = (recentErrors || []).filter((e: any) => e.severity === 'critical').length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      message: highCount > 0 ? `${highCount} high-severity errors in last hour` : undefined,
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
      checkStorageBuckets(supabase),
      checkDocumentProcessing(supabase),
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
    const hasUnhealthy = results.some((r: HealthCheckResult) => r.status === 'unhealthy');
    const hasDegraded = results.some((r: HealthCheckResult) => r.status === 'degraded');
    
    const overall_status: 'healthy' | 'degraded' | 'unhealthy' = 
      hasUnhealthy ? 'unhealthy' : 
      hasDegraded ? 'degraded' : 
      'healthy';

    const response: SystemHealthResponse = {
      overall_status,
      checks: results,
      timestamp: new Date().toISOString(),
      version: '1.1.0',
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
          unhealthy_count: results.filter((r: HealthCheckResult) => r.status === 'unhealthy').length,
          degraded_count: results.filter((r: HealthCheckResult) => r.status === 'degraded').length,
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
        version: '1.1.0',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
