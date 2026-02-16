/**
 * System Operations — Consolidated Domain Service
 * 
 * Single entry point for all platform health, maintenance, and operations functions.
 * Replaces individual edge functions with action-based routing.
 * 
 * Actions:
 *   health-check                — System health probes (DB, auth, storage, AI gateway)
 *   data-integrity-fix          — Backfill titles, clean orphaned feedback
 *   retry-dead-letters          — Process DLQ items with exponential backoff
 *   cleanup-false-positives     — Purge false positive signals + save hashes
 *   aggregate-implicit-feedback — Process implicit events into learning profiles
 *   detect-contradictions       — AI-powered cross-signal contradiction detection
 *   audit-knowledge-freshness   — Decay stale expert knowledge entries
 *   data-quality                — Delegates to data-quality-monitor
 *   orchestrate                 — Delegates to auto-orchestrator
 *   ooda-loop                   — Delegates to autonomous-operations-loop
 *   pipeline-tests              — Delegates to scheduled-pipeline-tests
 *   watchdog                    — Delegates to system-watchdog
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

      case 'cleanup-false-positives':
        return await handleCleanupFalsePositives();

      // ── Consolidated intelligence operations ──
      case 'aggregate-implicit-feedback':
        return await handleAggregateImplicitFeedback();
      case 'detect-contradictions':
        return await handleDetectContradictions(body);
      case 'audit-knowledge-freshness':
        return await handleAuditKnowledgeFreshness(body);

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

      // ── Deploy-time smoke test ──
      case 'smoke-test':
        return await handleSmokeTest();

      default:
        return errorResponse(`Unknown action: ${action}. Valid actions: health-check, data-integrity-fix, retry-dead-letters, cleanup-false-positives, aggregate-implicit-feedback, detect-contradictions, audit-knowledge-freshness, data-quality, orchestrate, ooda-loop, pipeline-tests, watchdog, smoke-test`, 400);
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
    }
  }

  console.log(`[SystemOps:DLQ] Processed ${items.length} items: ${successCount} success, ${failCount} failed`);
  return successResponse({ processed: items.length, success: successCount, failed: failCount });
}

// ═══════════════════════════════════════════════════════════════
//      HANDLER: cleanup-false-positives (inlined)
// ═══════════════════════════════════════════════════════════════

async function handleCleanupFalsePositives(): Promise<Response> {
  const supabase = createServiceClient();

  // Step 1: Save hashes of false_positive signals to prevent re-ingestion
  const { data: fpSignals, error: fetchErr } = await supabase
    .from('signals')
    .select('id, content_hash, client_id, title')
    .eq('status', 'false_positive');

  if (fetchErr) {
    return errorResponse(`Failed to fetch false positives: ${fetchErr.message}`, 500);
  }

  const signalsToClean = fpSignals || [];
  if (signalsToClean.length === 0) {
    return successResponse({ purged: 0, hashes_saved: 0, message: 'No false positives found' });
  }

  // Save hashes to rejected_content_hashes
  let hashesSaved = 0;
  for (const sig of signalsToClean) {
    if (sig.content_hash) {
      const { error } = await supabase.from('rejected_content_hashes').upsert({
        content_hash: sig.content_hash,
        client_id: sig.client_id,
        reason: 'false_positive_cleanup',
        original_signal_title: (sig.title || '').slice(0, 200),
      }, { onConflict: 'content_hash,client_id', ignoreDuplicates: true });
      if (!error) hashesSaved++;
    }
  }

  // Step 2: Delete false_positive signals
  const { error: deleteErr } = await supabase
    .from('signals')
    .delete()
    .eq('status', 'false_positive');

  if (deleteErr) {
    return errorResponse(`Hashes saved (${hashesSaved}) but delete failed: ${deleteErr.message}`, 500);
  }

  console.log(`[SystemOps:cleanup-false-positives] Purged ${signalsToClean.length} signals, saved ${hashesSaved} hashes`);
  return successResponse({ purged: signalsToClean.length, hashes_saved: hashesSaved });
}

// ═══════════════════════════════════════════════════════════════
//      HANDLER: aggregate-implicit-feedback (inlined)
// ═══════════════════════════════════════════════════════════════

async function handleAggregateImplicitFeedback(): Promise<Response> {
  const supabase = createServiceClient();

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await supabase
    .from('implicit_feedback_events')
    .select('id, signal_id, event_type, event_value, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw error;
  if (!events || events.length === 0) {
    return successResponse({ processed: 0, message: 'No implicit events to process' });
  }

  console.log(`[SystemOps:implicit-feedback] Processing ${events.length} events`);

  // Aggregate by signal_id
  const signalStats = new Map<string, {
    totalViewTime: number; viewCount: number; dismissals: number;
    escalations: number; reportInclusions: number; investigations: number; shares: number;
  }>();

  for (const event of events) {
    if (!signalStats.has(event.signal_id)) {
      signalStats.set(event.signal_id, {
        totalViewTime: 0, viewCount: 0, dismissals: 0,
        escalations: 0, reportInclusions: 0, investigations: 0, shares: 0,
      });
    }
    const stats = signalStats.get(event.signal_id)!;
    switch (event.event_type) {
      case 'view_duration': stats.totalViewTime += event.event_value || 0; stats.viewCount++; break;
      case 'dismissed_quickly': stats.dismissals++; break;
      case 'escalated': stats.escalations++; break;
      case 'included_in_report': stats.reportInclusions++; break;
      case 'investigated': stats.investigations++; break;
      case 'shared': stats.shares++; break;
    }
  }

  // Fetch signal metadata
  const signalIds = [...signalStats.keys()];
  const { data: signals } = await supabase
    .from('signals')
    .select('id, title, normalized_text, category, source_type, rule_category')
    .in('id', signalIds);

  const signalMap = new Map((signals || []).map(s => [s.id, s]));

  const engagedFeatures: Record<string, number> = {};
  const dismissedFeatures: Record<string, number> = {};
  const behavioralMetrics: Record<string, number> = {
    total_implicit_events: events.length,
    signals_analyzed: signalStats.size,
  };

  for (const [signalId, stats] of signalStats) {
    const signal = signalMap.get(signalId);
    if (!signal) continue;

    const text = `${signal.title || ''} ${signal.normalized_text || ''}`.toLowerCase();
    const words = text.split(/\s+/).filter(w => w.length > 3);
    const keywords: Record<string, number> = {};
    [...new Set(words)].slice(0, 20).forEach(kw => { keywords[kw] = 1; });
    const category = signal.rule_category || signal.category;

    const engagementScore =
      stats.escalations * 5 + stats.reportInclusions * 4 +
      stats.investigations * 3 + stats.shares * 3 +
      (stats.totalViewTime > 30 ? 1 : 0) - stats.dismissals * 2;

    const target = engagementScore > 0 ? engagedFeatures : dismissedFeatures;
    const weight = Math.abs(engagementScore);

    for (const kw of Object.keys(keywords)) {
      target[kw] = (target[kw] || 0) + weight;
    }
    if (category) target[`category:${category}`] = (target[`category:${category}`] || 0) + weight;
    if (signal.source_type) target[`source:${signal.source_type}`] = (target[`source:${signal.source_type}`] || 0) + weight;

    if (stats.escalations > 0) behavioralMetrics.total_escalations = (behavioralMetrics.total_escalations || 0) + stats.escalations;
    if (stats.reportInclusions > 0) behavioralMetrics.total_report_inclusions = (behavioralMetrics.total_report_inclusions || 0) + stats.reportInclusions;
    if (stats.dismissals > 0) behavioralMetrics.total_quick_dismissals = (behavioralMetrics.total_quick_dismissals || 0) + stats.dismissals;
    if (stats.investigations > 0) behavioralMetrics.total_investigations = (behavioralMetrics.total_investigations || 0) + stats.investigations;
    behavioralMetrics.avg_view_time = stats.viewCount > 0
      ? Math.round(stats.totalViewTime / stats.viewCount)
      : (behavioralMetrics.avg_view_time || 0);
  }

  // Upsert learning profiles
  const upserts: Promise<void>[] = [];
  if (Object.keys(engagedFeatures).length > 0) upserts.push(upsertLearningProfile(supabase, 'implicit_engaged_patterns', engagedFeatures));
  if (Object.keys(dismissedFeatures).length > 0) upserts.push(upsertLearningProfile(supabase, 'implicit_dismissed_patterns', dismissedFeatures));
  upserts.push(upsertLearningProfile(supabase, 'implicit_behavioral_metrics', behavioralMetrics));
  await Promise.all(upserts);

  console.log(`[SystemOps:implicit-feedback] Aggregated ${events.length} events → ${signalStats.size} signals`);
  return successResponse({
    processed: events.length,
    signals_analyzed: signalStats.size,
    engaged_keywords: Object.keys(engagedFeatures).length,
    dismissed_keywords: Object.keys(dismissedFeatures).length,
  });
}

async function upsertLearningProfile(supabase: ReturnType<typeof createServiceClient>, profileType: string, newFeatures: Record<string, number>) {
  try {
    const { data: existing } = await supabase
      .from('learning_profiles').select('*').eq('profile_type', profileType).single();

    if (existing) {
      const currentFeatures = (existing.features as Record<string, number>) || {};
      Object.entries(newFeatures).forEach(([key, value]) => {
        currentFeatures[key] = (currentFeatures[key] || 0) + value;
      });
      await supabase.from('learning_profiles').update({
        features: currentFeatures,
        sample_count: ((existing.sample_count as number) || 0) + 1,
        last_updated: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_profiles').insert({
        profile_type: profileType, features: newFeatures, sample_count: 1,
      });
    }
  } catch (err) {
    console.error(`[SystemOps] Error upserting profile ${profileType}:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════
//      HANDLER: detect-contradictions (inlined)
// ═══════════════════════════════════════════════════════════════

async function handleDetectContradictions(body: Record<string, unknown>): Promise<Response> {
  const supabase = createServiceClient();
  const lookbackDays = (body.lookback_days as number) || 7;
  const maxPairs = (body.max_pairs as number) || 50;

  console.log(`[SystemOps:contradictions] Scanning signals from last ${lookbackDays} days...`);

  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const { data: signals, error: sigError } = await supabase
    .from('signals')
    .select('id, title, normalized_text, entity_tags, severity, category, confidence, client_id, received_at')
    .not('entity_tags', 'is', null)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: false })
    .limit(300);

  if (sigError) throw sigError;
  if (!signals || signals.length < 2) {
    return successResponse({ success: true, contradictions: 0, message: 'Not enough tagged signals to compare' });
  }

  // Build entity → signals index
  const entityIndex = new Map<string, typeof signals>();
  for (const sig of signals) {
    if (!sig.entity_tags || !Array.isArray(sig.entity_tags)) continue;
    for (const tag of sig.entity_tags) {
      const normalized = tag.toLowerCase().trim();
      if (normalized.length < 3) continue;
      if (!entityIndex.has(normalized)) entityIndex.set(normalized, []);
      entityIndex.get(normalized)!.push(sig);
    }
  }

  // Find candidate pairs with severity/category mismatches
  const candidatePairs: Array<{ entity: string; signalA: typeof signals[0]; signalB: typeof signals[0] }> = [];
  for (const [entity, entitySignals] of entityIndex) {
    if (entitySignals.length < 2) continue;
    for (let i = 0; i < entitySignals.length && candidatePairs.length < maxPairs; i++) {
      for (let j = i + 1; j < entitySignals.length && candidatePairs.length < maxPairs; j++) {
        const a = entitySignals[i], b = entitySignals[j];
        if ((a.severity !== b.severity && a.severity && b.severity) ||
            (a.category !== b.category && a.category && b.category) ||
            (a.client_id !== b.client_id)) {
          candidatePairs.push({ entity, signalA: a, signalB: b });
        }
      }
    }
  }

  if (candidatePairs.length === 0) {
    return successResponse({ success: true, contradictions: 0, message: 'No potential contradictions found' });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const chunks: typeof candidatePairs[] = [];
  for (let i = 0; i < candidatePairs.length; i += 10) {
    chunks.push(candidatePairs.slice(i, i + 10));
  }

  let totalContradictions = 0;

  for (const chunk of chunks) {
    const prompt = `You are an intelligence analyst reviewing signal pairs about the same entity. For each pair, determine if they present CONTRADICTORY assessments.

A contradiction means: opposite threat assessments, conflicting status claims, incompatible severity with contradictory content, or opposing conclusions about the same event.
NOT contradictions: same event from different angles, complementary info, different aspects of the same entity, updates that supersede older info.

Respond with JSON: { "pairs": [{ "index": 0, "is_contradiction": true/false, "contradiction_type": "conflicting_assessment"|"status_conflict"|"severity_mismatch"|"temporal_contradiction", "severity": "high"|"medium"|"low", "confidence": 0.0-1.0, "explanation": "brief reason" }] }

Signal pairs:
${chunk.map((p, idx) => `--- Pair ${idx} (Entity: "${p.entity}") ---
Signal A [${p.signalA.severity}/${p.signalA.category}]: ${(p.signalA.normalized_text || p.signalA.title || '').substring(0, 300)}
Signal B [${p.signalB.severity}/${p.signalB.category}]: ${(p.signalB.normalized_text || p.signalB.title || '').substring(0, 300)}`).join('\n')}`;

    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
      });

      if (!response.ok) { console.error(`[SystemOps:contradictions] AI call failed: ${response.status}`); await response.text(); continue; }

      const data = await response.json();
      let content = (data.choices?.[0]?.message?.content || '').trim();
      if (content.startsWith('```')) content = content.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();

      const result = JSON.parse(content);
      const contradictions = (result.pairs || []).filter((p: any) => p.is_contradiction && p.confidence >= 0.6);

      for (const c of contradictions) {
        const pair = chunk[c.index];
        if (!pair) continue;

        const { data: existing } = await supabase
          .from('signal_contradictions').select('id')
          .eq('signal_a_id', pair.signalA.id).eq('signal_b_id', pair.signalB.id).limit(1);
        if (existing && existing.length > 0) continue;

        const { error: insertErr } = await supabase.from('signal_contradictions').insert({
          entity_name: pair.entity,
          signal_a_id: pair.signalA.id, signal_b_id: pair.signalB.id,
          signal_a_summary: (pair.signalA.normalized_text || pair.signalA.title || '').substring(0, 500),
          signal_b_summary: (pair.signalB.normalized_text || pair.signalB.title || '').substring(0, 500),
          contradiction_type: c.contradiction_type || 'conflicting_assessment',
          severity: c.severity || 'medium', confidence: c.confidence || 0.6,
        });
        if (!insertErr) totalContradictions++;
      }
    } catch (err) {
      console.error('[SystemOps:contradictions] Chunk analysis failed:', err);
    }
  }

  console.log(`[SystemOps:contradictions] Detected ${totalContradictions} new contradictions`);
  return successResponse({
    success: true, contradictions: totalContradictions,
    candidates_analyzed: candidatePairs.length, entities_scanned: entityIndex.size,
  });
}

// ═══════════════════════════════════════════════════════════════
//      HANDLER: audit-knowledge-freshness (inlined)
// ═══════════════════════════════════════════════════════════════

const HALF_LIFE_DAYS = 180;
const DEACTIVATION_THRESHOLD = 0.3;
const STALE_THRESHOLD = 0.5;

async function handleAuditKnowledgeFreshness(body: Record<string, unknown>): Promise<Response> {
  const supabase = createServiceClient();
  const dryRun = body.dry_run === true;

  console.log(`[SystemOps:knowledge-freshness] Starting audit (dry_run=${dryRun})...`);

  const { data: entries, error } = await supabase
    .from('expert_knowledge')
    .select('id, title, domain, subdomain, confidence_score, last_validated_at, created_at, updated_at')
    .eq('is_active', true);

  if (error) throw error;
  if (!entries || entries.length === 0) {
    return successResponse({ success: true, message: 'No active knowledge entries' });
  }

  const now = Date.now();
  const staleEntries: Array<{ id: string; title: string; domain: string; decayedConfidence: number; daysSinceValidation: number }> = [];
  const decayedEntries: Array<{ id: string; title: string; domain: string; decayedConfidence: number }> = [];
  const deactivationCandidates: string[] = [];
  const domainStats = new Map<string, { total: number; stale: number; scores: number[] }>();
  let totalDecayedConfidence = 0, totalOriginalConfidence = 0;

  for (const entry of entries) {
    const refDate = new Date(entry.last_validated_at || entry.created_at).getTime();
    const daysSince = (now - refDate) / 86400000;
    const decayFactor = Math.pow(2, -(daysSince / HALF_LIFE_DAYS));
    const originalConfidence = entry.confidence_score || 0.5;
    const decayedConfidence = Math.max(0.1, originalConfidence * decayFactor);
    totalDecayedConfidence += decayedConfidence;
    totalOriginalConfidence += originalConfidence;

    const domain = entry.domain || 'unknown';
    if (!domainStats.has(domain)) domainStats.set(domain, { total: 0, stale: 0, scores: [] });
    const ds = domainStats.get(domain)!;
    ds.total++; ds.scores.push(decayedConfidence);

    if (decayedConfidence < STALE_THRESHOLD) {
      ds.stale++;
      staleEntries.push({ id: entry.id, title: entry.title, domain, decayedConfidence, daysSinceValidation: Math.round(daysSince) });
    }
    if (decayedConfidence < DEACTIVATION_THRESHOLD) {
      decayedEntries.push({ id: entry.id, title: entry.title, domain, decayedConfidence });
      deactivationCandidates.push(entry.id);
    }
  }

  const staleDomains = [...domainStats.entries()]
    .filter(([_, s]) => s.stale > 0)
    .map(([domain, s]) => ({ domain, total: s.total, stale: s.stale, avgDecayed: Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 100) / 100 }))
    .sort((a, b) => b.stale - a.stale);

  const actionsTaken: string[] = [];
  if (!dryRun && deactivationCandidates.length > 0) {
    const { error: deactivateErr } = await supabase
      .from('expert_knowledge').update({ is_active: false }).in('id', deactivationCandidates);
    if (deactivateErr) {
      actionsTaken.push(`FAILED: Deactivate ${deactivationCandidates.length} entries`);
    } else {
      actionsTaken.push(`Deactivated ${deactivationCandidates.length} entries below ${DEACTIVATION_THRESHOLD} confidence`);
    }
  }

  await supabase.from('knowledge_freshness_audits').insert({
    total_entries: entries.length, stale_entries: staleEntries.length,
    decayed_entries: decayedEntries.length,
    avg_confidence: totalOriginalConfidence / entries.length,
    avg_decayed_confidence: totalDecayedConfidence / entries.length,
    stale_domains: staleDomains, actions_taken: actionsTaken,
  });

  console.log(`[SystemOps:knowledge-freshness] ${staleEntries.length}/${entries.length} stale, ${decayedEntries.length} below threshold`);
  return successResponse({
    success: true, dry_run: dryRun, total_entries: entries.length,
    stale_entries: staleEntries.length, decayed_below_threshold: decayedEntries.length,
    deactivated: dryRun ? 0 : deactivationCandidates.length,
    avg_original_confidence: Math.round((totalOriginalConfidence / entries.length) * 100) / 100,
    avg_decayed_confidence: Math.round((totalDecayedConfidence / entries.length) * 100) / 100,
    stale_domains: staleDomains.slice(0, 10), actions_taken: actionsTaken,
    top_stale: staleEntries.slice(0, 10).map(e => ({ title: e.title, domain: e.domain, decayed: Math.round(e.decayedConfidence * 100) / 100, days_since_validation: e.daysSinceValidation })),
  });
}

// ═══════════════════════════════════════════════════════════════
//           HANDLER: smoke-test (deploy-time validation)
// ═══════════════════════════════════════════════════════════════

/**
 * Lightweight smoke test that pings every domain service with a healthcheck
 * to confirm they boot and respond. Use after deploys to catch immediate crashes.
 */
async function handleSmokeTest(): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const startTime = Date.now();

  const domainServices = [
    { name: 'system-ops', action: 'health-check', body: { quick: true } },
    { name: 'signal-processor', action: 'healthcheck', body: {} },
    { name: 'entity-manager', action: 'healthcheck', body: {} },
    { name: 'incident-manager', action: 'healthcheck', body: {} },
    { name: 'intelligence-engine', action: 'healthcheck', body: {} },
    { name: 'osint-collector', action: 'healthcheck', body: {} },
  ];

  const results = await Promise.allSettled(
    domainServices.map(async (svc) => {
      const svcStart = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s per service

        const response = await fetch(`${supabaseUrl}/functions/v1/${svc.name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ action: svc.action, ...svc.body }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const body = await response.text();
        return {
          name: svc.name,
          status: response.status < 500 ? 'ok' : 'error',
          httpStatus: response.status,
          latencyMs: Date.now() - svcStart,
          error: response.status >= 500 ? body.substring(0, 200) : undefined,
        };
      } catch (err) {
        return {
          name: svc.name,
          status: 'error',
          httpStatus: 0,
          latencyMs: Date.now() - svcStart,
          error: err instanceof Error ? err.message : 'Unknown',
        };
      }
    })
  );

  const serviceResults = results.map((r) => 
    r.status === 'fulfilled' ? r.value : { name: 'unknown', status: 'error', httpStatus: 0, latencyMs: 0, error: 'Promise rejected' }
  );

  const allHealthy = serviceResults.every(r => r.status === 'ok');
  const failedServices = serviceResults.filter(r => r.status !== 'ok');

  console.log(`[SystemOps:smoke-test] ${allHealthy ? 'ALL PASS' : `${failedServices.length} FAILED`} in ${Date.now() - startTime}ms`);

  return successResponse({
    allHealthy,
    totalServices: domainServices.length,
    failedCount: failedServices.length,
    services: serviceResults,
    totalLatencyMs: Date.now() - startTime,
  });
}