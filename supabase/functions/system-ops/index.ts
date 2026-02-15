/**
 * System Operations — Consolidated Domain Service
 * 
 * Single entry point for all platform health, maintenance, and operations functions.
 * Replaces 8 individual edge functions with action-based routing.
 * 
 * Actions:
 *   health-check         — System health probes (DB, auth, storage, AI gateway)
 *   data-integrity-fix   — Backfill titles, clean orphaned feedback
 *   retry-dead-letters   — Process DLQ items with exponential backoff
 *   data-quality         — Delegates to data-quality-monitor
 *   orchestrate          — Delegates to auto-orchestrator
 *   ooda-loop            — Delegates to autonomous-operations-loop
 *   pipeline-tests       — Delegates to scheduled-pipeline-tests
 *   watchdog             — Delegates to system-watchdog
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import type { SystemOpsAction, HealthCheckResult as SharedHealthCheckResult, HealthStatus, DomainRequest } from "../_shared/types.ts";

// ═══════════════════════════════════════════════════════════════
//                      ACTION ROUTER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'health-check';

    console.log(`[SystemOps] Dispatching action: ${action}`);

    switch (action) {
      // ── Inlined handlers (small functions) ──
      case 'health-check':
        return await handleHealthCheck(req, body);
      case 'data-integrity-fix':
        return await handleDataIntegrityFix(req);
      case 'retry-dead-letters':
        return await handleRetryDeadLetters();

      // ── Delegated handlers (large functions, will be inlined in future) ──
      case 'data-quality':
        return await delegateToFunction('data-quality-monitor', body);
      case 'orchestrate':
        return await delegateToFunction('auto-orchestrator', body);
      case 'ooda-loop':
        return await delegateToFunction('autonomous-operations-loop', body);
      case 'pipeline-tests':
        return await delegateToFunction('scheduled-pipeline-tests', body);
      case 'watchdog':
        return await delegateToFunction('system-watchdog', body);

      default:
        return errorResponse(`Unknown action: ${action}. Valid actions: health-check, data-integrity-fix, retry-dead-letters, data-quality, orchestrate, ooda-loop, pipeline-tests, watchdog`, 400);
    }
  } catch (error) {
    console.error('[SystemOps] Router error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════════
//                    DELEGATION HELPER
// ═══════════════════════════════════════════════════════════════

async function delegateToFunction(functionName: string, body: Record<string, unknown>): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s to stay under edge function limit

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text();
    
    return new Response(responseBody, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return errorResponse(`${functionName} timed out after 55s`, 504);
    }
    return errorResponse(`Failed to delegate to ${functionName}: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

// ═══════════════════════════════════════════════════════════════
//             HANDLER: health-check (inlined)
// ═══════════════════════════════════════════════════════════════

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms: number;
  message?: string;
  last_checked: string;
}

async function handleHealthCheck(_req: Request, body: Record<string, unknown>): Promise<Response> {
  const supabase = createServiceClient();
  const includeExternal = body.external !== false;
  const quick = body.quick === true;
  const startTime = Date.now();

  const coreChecks = [
    checkDatabase(supabase),
    checkAuth(supabase),
    checkStorage(supabase),
    checkStorageBuckets(supabase),
    checkDocumentProcessing(supabase),
    checkRecentErrors(supabase),
  ];

  const extendedChecks = includeExternal && !quick ? [
    checkAIGateway(),
    checkExternalAPI('weather_gov', 'https://api.weather.gov/'),
    checkExternalAPI('nasa_firms', 'https://firms.modaps.eosdis.nasa.gov/'),
  ] : [];

  const results = await Promise.all([...coreChecks, ...extendedChecks]);

  const hasUnhealthy = results.some(r => r.status === 'unhealthy');
  const hasDegraded = results.some(r => r.status === 'degraded');
  const overall_status = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

  const totalTime = Date.now() - startTime;
  console.log(`[SystemOps:health-check] Completed in ${totalTime}ms. Status: ${overall_status}`);

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
    console.error('[SystemOps:health-check] Failed to log:', logError);
  }

  return new Response(
    JSON.stringify({ overall_status, checks: results, timestamp: new Date().toISOString(), version: '2.0.0' }),
    {
      status: overall_status === 'unhealthy' ? 503 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

async function checkDatabase(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.from('clients').select('id').limit(1);
    const latency = Date.now() - start;
    if (error) return { name: 'database', status: latency > 5000 ? 'unhealthy' : 'degraded', latency_ms: latency, message: error.message, last_checked: new Date().toISOString() };
    return { name: 'database', status: latency > 2000 ? 'degraded' : 'healthy', latency_ms: latency, message: latency > 2000 ? 'High latency detected' : undefined, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'database', status: 'unhealthy', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Unknown error', last_checked: new Date().toISOString() };
  }
}

async function checkAuth(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.auth.getSession();
    const latency = Date.now() - start;
    if (error && !error.message.includes('session')) return { name: 'auth', status: 'degraded', latency_ms: latency, message: error.message, last_checked: new Date().toISOString() };
    return { name: 'auth', status: latency > 2000 ? 'degraded' : 'healthy', latency_ms: latency, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'auth', status: 'unhealthy', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Unknown error', last_checked: new Date().toISOString() };
  }
}

async function checkStorage(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { error } = await supabase.storage.listBuckets();
    const latency = Date.now() - start;
    if (error) return { name: 'storage', status: 'degraded', latency_ms: latency, message: error.message, last_checked: new Date().toISOString() };
    return { name: 'storage', status: latency > 3000 ? 'degraded' : 'healthy', latency_ms: latency, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'storage', status: 'unhealthy', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Unknown error', last_checked: new Date().toISOString() };
  }
}

async function checkStorageBuckets(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const requiredBuckets = ['archival-documents', 'entity-photos', 'ai-chat-attachments'];
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) return { name: 'storage_buckets', status: 'degraded', latency_ms: Date.now() - start, message: error.message, last_checked: new Date().toISOString() };
    const bucketIds = (buckets || []).map((b: any) => b.id);
    const missing = requiredBuckets.filter(r => !bucketIds.includes(r));
    const latency = Date.now() - start;
    if (missing.length > 0) return { name: 'storage_buckets', status: 'unhealthy', latency_ms: latency, message: `Missing buckets: ${missing.join(', ')}`, last_checked: new Date().toISOString() };
    return { name: 'storage_buckets', status: 'healthy', latency_ms: latency, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'storage_buckets', status: 'degraded', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Check failed', last_checked: new Date().toISOString() };
  }
}

async function checkDocumentProcessing(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: stuckDocs, error } = await supabase.from('archival_documents').select('id').is('content_text', null).gte('created_at', oneHourAgo).limit(100);
    if (error) return { name: 'document_processing', status: 'degraded', latency_ms: Date.now() - start, message: error.message, last_checked: new Date().toISOString() };
    const stuckCount = stuckDocs?.length || 0;
    const latency = Date.now() - start;
    if (stuckCount > 10) return { name: 'document_processing', status: 'degraded', latency_ms: latency, message: `${stuckCount} unprocessed documents in last hour`, last_checked: new Date().toISOString() };
    return { name: 'document_processing', status: 'healthy', latency_ms: latency, message: stuckCount > 0 ? `${stuckCount} documents pending` : undefined, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'document_processing', status: 'degraded', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Check failed', last_checked: new Date().toISOString() };
  }
}

async function checkRecentErrors(supabase: any): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: recentErrors, error } = await supabase.from('bug_reports').select('id, severity').gte('created_at', oneHourAgo).in('severity', ['critical', 'high']);
    const latency = Date.now() - start;
    if (error) return { name: 'error_rate', status: 'degraded', latency_ms: latency, message: error.message, last_checked: new Date().toISOString() };
    const criticalCount = (recentErrors || []).filter((e: any) => e.severity === 'critical').length;
    const highCount = (recentErrors || []).filter((e: any) => e.severity === 'high').length;
    if (criticalCount > 0) return { name: 'error_rate', status: 'unhealthy', latency_ms: latency, message: `${criticalCount} critical errors in last hour`, last_checked: new Date().toISOString() };
    if (highCount > 5) return { name: 'error_rate', status: 'degraded', latency_ms: latency, message: `${highCount} high-severity errors in last hour`, last_checked: new Date().toISOString() };
    return { name: 'error_rate', status: 'healthy', latency_ms: latency, message: highCount > 0 ? `${highCount} high-severity errors in last hour` : undefined, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'error_rate', status: 'degraded', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Check failed', last_checked: new Date().toISOString() };
  }
}

async function checkExternalAPI(name: string, url: string, timeout: number = 10000): Promise<HealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    if (!response.ok) return { name, status: 'degraded', latency_ms: latency, message: `HTTP ${response.status}`, last_checked: new Date().toISOString() };
    return { name, status: latency > 5000 ? 'degraded' : 'healthy', latency_ms: latency, last_checked: new Date().toISOString() };
  } catch (err) {
    clearTimeout(timeoutId);
    return { name, status: 'unhealthy', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Connection failed', last_checked: new Date().toISOString() };
  }
}

async function checkAIGateway(): Promise<HealthCheckResult> {
  const start = Date.now();
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return { name: 'ai_gateway', status: 'unhealthy', latency_ms: 0, message: 'LOVABLE_API_KEY not configured', last_checked: new Date().toISOString() };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash-lite', messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    if (!response.ok) return { name: 'ai_gateway', status: 'degraded', latency_ms: latency, message: `HTTP ${response.status}`, last_checked: new Date().toISOString() };
    return { name: 'ai_gateway', status: latency > 3000 ? 'degraded' : 'healthy', latency_ms: latency, last_checked: new Date().toISOString() };
  } catch (err) {
    return { name: 'ai_gateway', status: 'unhealthy', latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Connection failed', last_checked: new Date().toISOString() };
  }
}

// ═══════════════════════════════════════════════════════════════
//          HANDLER: data-integrity-fix (inlined)
// ═══════════════════════════════════════════════════════════════

async function handleDataIntegrityFix(req: Request): Promise<Response> {
  const supabase = createServiceClient();

  // Verify caller is admin/super_admin
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return errorResponse('Invalid token', 401);
  
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
  const userRoles = roles?.map((r: any) => r.role) || [];
  if (!userRoles.includes('super_admin') && !userRoles.includes('admin')) return errorResponse('Admin access required', 403);

  const results: Record<string, unknown> = {};

  // Fix 1: Backfill missing signal titles
  const { data: missingTitles, error: e1 } = await supabase
    .from('signals').select('id, normalized_text').is('title', null).not('normalized_text', 'is', null).limit(500);

  if (!e1 && missingTitles && missingTitles.length > 0) {
    let fixed = 0;
    for (const s of missingTitles) {
      const { error } = await supabase.from('signals').update({ title: (s.normalized_text || '').slice(0, 100) }).eq('id', s.id);
      if (!error) fixed++;
    }
    results.backfilled_titles = { found: missingTitles.length, fixed };
  } else {
    results.backfilled_titles = { found: 0, fixed: 0 };
  }

  // Fix 2: Clean orphaned feedback events
  const { data: feedback } = await supabase.from('feedback_events').select('id, object_id').eq('object_type', 'signal');
  if (feedback && feedback.length > 0) {
    const { data: signals } = await supabase.from('signals').select('id');
    const validIds = new Set(signals?.map((s: any) => s.id) || []);
    const orphaned = feedback.filter((f: any) => f.object_id && !validIds.has(f.object_id));
    let deleted = 0;
    for (const f of orphaned) {
      const { error } = await supabase.from('feedback_events').delete().eq('id', f.id);
      if (!error) deleted++;
    }
    results.orphaned_feedback = { found: orphaned.length, deleted };
  } else {
    results.orphaned_feedback = { found: 0, deleted: 0 };
  }

  return successResponse({ success: true, results });
}

// ═══════════════════════════════════════════════════════════════
//          HANDLER: retry-dead-letters (inlined)
// ═══════════════════════════════════════════════════════════════

async function handleRetryDeadLetters(): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createServiceClient();

  const { data: items, error } = await supabase
    .from('dead_letter_queue').select('*')
    .in('status', ['pending', 'retrying'])
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true }).limit(10);

  if (error) throw error;
  if (!items || items.length === 0) return successResponse({ processed: 0 });

  let successCount = 0;
  let failCount = 0;

  for (const item of items) {
    try {
      await supabase.from('dead_letter_queue').update({ status: 'retrying', updated_at: new Date().toISOString() }).eq('id', item.id);

      const response = await fetch(`${supabaseUrl}/functions/v1/${item.function_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify(item.payload),
      });

      if (response.ok) {
        await supabase.from('dead_letter_queue').update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id);
        if (item.error_id) {
          await supabase.from('edge_function_errors').update({ resolved_at: new Date().toISOString() }).eq('id', item.error_id);
        }
        successCount++;
      } else {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
      }
    } catch (retryErr) {
      const newRetryCount = (item.retry_count || 0) + 1;
      if (newRetryCount >= item.max_retries) {
        await supabase.from('dead_letter_queue').update({ status: 'exhausted', retry_count: newRetryCount, error_message: String(retryErr), updated_at: new Date().toISOString() }).eq('id', item.id);
      } else {
        const backoffMs = 60_000 * Math.pow(5, newRetryCount);
        await supabase.from('dead_letter_queue').update({ status: 'pending', retry_count: newRetryCount, next_retry_at: new Date(Date.now() + backoffMs).toISOString(), error_message: String(retryErr), updated_at: new Date().toISOString() }).eq('id', item.id);
      }
      failCount++;
    }
  }

  console.log(`[SystemOps:DLQ] Processed ${items.length} items: ${successCount} success, ${failCount} failed`);
  return successResponse({ processed: items.length, success: successCount, failed: failCount });
}