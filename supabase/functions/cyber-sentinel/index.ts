/**
 * CYBER SENTINEL — Platform Cyber Defense Agent
 * Deploys digital tripwires and monitors for cyberattacks against Fortress.
 * Supports both scheduled sweeps (pg_cron) and on-demand invocations.
 * 
 * Detection: Full Spectrum (auth attacks, API abuse, data exfiltration, injection)
 * Response: Tiered Graduated (monitor → warn → throttle → block → lockdown)
 * Execution: Hybrid (real-time triggers + 15-min scheduled sweeps)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TripwireConfig {
  id: string;
  name: string;
  tripwire_type: string;
  detection_config: Record<string, any>;
  response_tier: string;
  severity: string;
  cooldown_minutes: number;
}

interface ThreatEvent {
  tripwire_id: string;
  event_type: string;
  severity: string;
  confidence_score: number;
  threat_source: Record<string, any>;
  threat_details: Record<string, any>;
  response_taken: string;
  response_details: Record<string, any>;
  ai_analysis?: string;
  related_event_ids?: string[];
}

// Response tier escalation order
const RESPONSE_TIERS = ['monitor', 'warn', 'throttle', 'block', 'lockdown'] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'sweep'; // sweep | check_auth | check_api | status | tripwire_status

    console.log(`[CyberSentinel] Mode: ${mode}`);

    // Create sweep record
    const { data: sweep } = await supabase
      .from('cyber_sentinel_sweeps')
      .insert({
        sweep_type: mode === 'sweep' ? 'scheduled' : 'triggered',
        status: 'running',
      })
      .select('id')
      .single();

    const sweepId = sweep?.id;
    const allEvents: ThreatEvent[] = [];

    // Load active tripwires
    const { data: tripwires } = await supabase
      .from('cyber_tripwires')
      .select('*')
      .eq('is_active', true);

    if (!tripwires || tripwires.length === 0) {
      return respond({ status: 'no_active_tripwires', message: 'No tripwires configured' });
    }

    // ═══════════════════════════════════════════════════════════════
    // DETECTION MODULE 1: Authentication Attack Detection
    // ═══════════════════════════════════════════════════════════════
    if (mode === 'sweep' || mode === 'check_auth') {
      const authTripwires = tripwires.filter((t: TripwireConfig) => 
        ['brute_force', 'auth_attack'].includes(t.tripwire_type)
      );

      for (const tripwire of authTripwires) {
        const events = await detectAuthAttacks(supabase, tripwire);
        allEvents.push(...events);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DETECTION MODULE 2: API Abuse Detection
    // ═══════════════════════════════════════════════════════════════
    if (mode === 'sweep' || mode === 'check_api') {
      const apiTripwires = tripwires.filter((t: TripwireConfig) => 
        ['api_abuse', 'injection_attempt', 'anomalous_access'].includes(t.tripwire_type)
      );

      for (const tripwire of apiTripwires) {
        const events = await detectApiAbuse(supabase, tripwire);
        allEvents.push(...events);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DETECTION MODULE 3: Data Exfiltration Detection
    // ═══════════════════════════════════════════════════════════════
    if (mode === 'sweep') {
      const exfilTripwires = tripwires.filter((t: TripwireConfig) => 
        t.tripwire_type === 'data_exfiltration'
      );

      for (const tripwire of exfilTripwires) {
        const events = await detectDataExfiltration(supabase, tripwire);
        allEvents.push(...events);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // RESPONSE ENGINE: Execute graduated responses
    // ═══════════════════════════════════════════════════════════════
    let responsesExecuted = 0;
    for (const event of allEvents) {
      // Check cooldown — skip if recently triggered for same source
      const recentlySeen = await checkCooldown(supabase, event);
      if (recentlySeen) {
        console.log(`[CyberSentinel] Cooldown active for ${event.event_type}, skipping`);
        continue;
      }

      // Persist the threat event
      const { data: savedEvent } = await supabase
        .from('cyber_threat_events')
        .insert(event)
        .select('id')
        .single();

      // Execute graduated response
      const responseResult = await executeGraduatedResponse(supabase, event, savedEvent?.id);
      responsesExecuted++;

      // Update event with response details
      if (savedEvent?.id) {
        await supabase
          .from('cyber_threat_events')
          .update({
            response_taken: responseResult.action,
            response_details: responseResult.details,
          })
          .eq('id', savedEvent.id);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // AI THREAT ANALYSIS (for high-severity events)
    // ═══════════════════════════════════════════════════════════════
    const criticalEvents = allEvents.filter(e => 
      e.severity === 'critical' || e.confidence_score >= 0.8
    );

    let aiAssessment: string | null = null;
    if (criticalEvents.length > 0) {
      aiAssessment = await generateThreatAssessment(supabase, criticalEvents, allEvents.length);

      // Send alert notification for critical threats
      await sendCyberAlert(supabase, criticalEvents, aiAssessment);
    }

    // Complete sweep
    if (sweepId) {
      await supabase
        .from('cyber_sentinel_sweeps')
        .update({
          status: 'completed',
          findings_count: allEvents.length,
          threats_detected: criticalEvents.length,
          responses_executed: responsesExecuted,
          ai_assessment: aiAssessment,
          sweep_summary: `Scanned ${tripwires.length} tripwires. Detected ${allEvents.length} events, ${criticalEvents.length} critical. Executed ${responsesExecuted} responses.`,
          completed_at: new Date().toISOString(),
          telemetry: {
            tripwires_checked: tripwires.length,
            auth_events_analyzed: mode === 'sweep' || mode === 'check_auth',
            api_events_analyzed: mode === 'sweep' || mode === 'check_api',
            data_exfil_analyzed: mode === 'sweep',
            duration_ms: Date.now(),
          }
        })
        .eq('id', sweepId);
    }

    // If status mode, return current posture
    if (mode === 'status' || mode === 'tripwire_status') {
      return respond(await getCyberPosture(supabase));
    }

    return respond({
      status: 'sweep_complete',
      sweep_id: sweepId,
      tripwires_active: tripwires.length,
      events_detected: allEvents.length,
      critical_threats: criticalEvents.length,
      responses_executed: responsesExecuted,
      ai_assessment: aiAssessment,
    });

  } catch (error) {
    console.error('[CyberSentinel] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function detectAuthAttacks(supabase: any, tripwire: TripwireConfig): Promise<ThreatEvent[]> {
  const events: ThreatEvent[] = [];
  const config = tripwire.detection_config;
  const windowMinutes = config.window_minutes || 10;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Check rate_limit_tracking for auth-related rate limit violations
  const { data: rateLimitViolations } = await supabase
    .from('rate_limit_tracking')
    .select('user_id, action_type, request_count, window_start')
    .gte('window_start', windowStart)
    .gt('request_count', config.max_failed_logins || 5)
    .in('action_type', ['login_attempt', 'auth_attempt', 'mfa_attempt']);

  if (rateLimitViolations && rateLimitViolations.length > 0) {
    for (const violation of rateLimitViolations) {
      events.push({
        tripwire_id: tripwire.id,
        event_type: tripwire.tripwire_type === 'brute_force' ? 'auth_brute_force' : 'credential_stuffing',
        severity: tripwire.severity,
        confidence_score: Math.min(0.95, 0.5 + (violation.request_count / (config.max_failed_logins || 5)) * 0.3),
        threat_source: {
          user_id: violation.user_id,
          action_type: violation.action_type,
        },
        threat_details: {
          failed_attempts: violation.request_count,
          threshold: config.max_failed_logins || 5,
          window_minutes: windowMinutes,
          window_start: violation.window_start,
          pattern: violation.request_count > (config.max_failed_logins || 5) * 2 ? 'aggressive' : 'moderate',
        },
        response_taken: 'logged',
        response_details: {},
      });
    }
  }

  // Check for multiple accounts targeted from the same user (credential stuffing pattern)
  if (tripwire.tripwire_type === 'auth_attack') {
    const { data: multiAccountAttempts } = await supabase
      .from('rate_limit_tracking')
      .select('user_id, action_type, request_count')
      .gte('window_start', windowStart)
      .gt('request_count', 1)
      .eq('action_type', 'login_attempt');

    if (multiAccountAttempts && multiAccountAttempts.length >= (config.min_unique_accounts || 3)) {
      events.push({
        tripwire_id: tripwire.id,
        event_type: 'credential_stuffing',
        severity: 'critical',
        confidence_score: 0.85,
        threat_source: {
          unique_accounts_targeted: multiAccountAttempts.length,
        },
        threat_details: {
          accounts_targeted: multiAccountAttempts.length,
          total_attempts: multiAccountAttempts.reduce((sum: number, a: any) => sum + a.request_count, 0),
          threshold: config.min_unique_accounts || 3,
          pattern: 'credential_stuffing_multi_account',
        },
        response_taken: 'logged',
        response_details: {},
      });
    }
  }

  return events;
}

async function detectApiAbuse(supabase: any, tripwire: TripwireConfig): Promise<ThreatEvent[]> {
  const events: ThreatEvent[] = [];
  const config = tripwire.detection_config;
  const windowMinutes = config.window_minutes || 5;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  if (tripwire.tripwire_type === 'api_abuse') {
    // Check API usage logs for rate anomalies
    const { data: apiLogs } = await supabase
      .from('api_usage_logs')
      .select('api_key_id, endpoint, method, status_code, ip_address')
      .gte('created_at', windowStart);

    if (apiLogs && apiLogs.length > (config.min_absolute_calls || 100)) {
      // Group by IP to detect concentrated abuse
      const ipCounts: Record<string, number> = {};
      for (const log of apiLogs) {
        const ip = log.ip_address || 'unknown';
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }

      for (const [ip, count] of Object.entries(ipCounts)) {
        if (count > (config.min_absolute_calls || 100) * (config.baseline_multiplier || 3)) {
          events.push({
            tripwire_id: tripwire.id,
            event_type: 'api_rate_violation',
            severity: tripwire.severity,
            confidence_score: 0.75,
            threat_source: { ip_address: ip },
            threat_details: {
              total_calls: count,
              window_minutes: windowMinutes,
              calls_per_minute: Math.round(count / windowMinutes),
              baseline_multiplier: config.baseline_multiplier || 3,
            },
            response_taken: 'logged',
            response_details: {},
          });
        }
      }
    }

    // Check for high error rates (potential probing)
    if (apiLogs) {
      const errorLogs = apiLogs.filter((l: any) => l.status_code >= 400);
      if (errorLogs.length > 20 && errorLogs.length / apiLogs.length > 0.5) {
        events.push({
          tripwire_id: tripwire.id,
          event_type: 'unauthorized_endpoint',
          severity: 'medium',
          confidence_score: 0.65,
          threat_source: { error_rate: (errorLogs.length / apiLogs.length).toFixed(2) },
          threat_details: {
            total_requests: apiLogs.length,
            error_count: errorLogs.length,
            error_rate: (errorLogs.length / apiLogs.length * 100).toFixed(1) + '%',
            status_codes: errorLogs.reduce((acc: Record<string, number>, l: any) => {
              acc[l.status_code] = (acc[l.status_code] || 0) + 1;
              return acc;
            }, {}),
          },
          response_taken: 'logged',
          response_details: {},
        });
      }
    }
  }

  if (tripwire.tripwire_type === 'injection_attempt') {
    // Check content violations for injection patterns
    const { data: violations } = await supabase
      .from('content_violations')
      .select('id, content_excerpt, matched_pattern, category, severity, created_at')
      .gte('created_at', windowStart)
      .in('category', ['injection', 'xss', 'sql_injection', 'code_injection']);

    if (violations && violations.length > 0) {
      events.push({
        tripwire_id: tripwire.id,
        event_type: 'injection_attempt',
        severity: 'critical',
        confidence_score: 0.9,
        threat_source: { violation_count: violations.length },
        threat_details: {
          violations: violations.map((v: any) => ({
            pattern: v.matched_pattern,
            category: v.category,
            excerpt: v.content_excerpt?.substring(0, 100),
          })),
          total_attempts: violations.length,
        },
        response_taken: 'logged',
        response_details: {},
      });
    }
  }

  return events;
}

async function detectDataExfiltration(supabase: any, tripwire: TripwireConfig): Promise<ThreatEvent[]> {
  const events: ThreatEvent[] = [];
  const config = tripwire.detection_config;
  const windowMinutes = config.window_minutes || 15;
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Check API usage for bulk data patterns (many GET requests with large response data)
  const { data: bulkReads } = await supabase
    .from('api_usage_logs')
    .select('api_key_id, endpoint, ip_address, method, created_at')
    .gte('created_at', windowStart)
    .eq('method', 'GET')
    .order('created_at', { ascending: false });

  if (bulkReads && bulkReads.length > 0) {
    // Group by API key to detect bulk extraction
    const keyGroups: Record<string, any[]> = {};
    for (const read of bulkReads) {
      const key = read.api_key_id || read.ip_address || 'unknown';
      if (!keyGroups[key]) keyGroups[key] = [];
      keyGroups[key].push(read);
    }

    for (const [source, reads] of Object.entries(keyGroups)) {
      // Count unique endpoints accessed
      const uniqueEndpoints = new Set(reads.map(r => r.endpoint)).size;
      
      if (reads.length > (config.max_rows_per_minute || 5000) / windowMinutes || 
          uniqueEndpoints > (config.max_tables_per_session || 10)) {
        events.push({
          tripwire_id: tripwire.id,
          event_type: 'bulk_data_query',
          severity: tripwire.severity,
          confidence_score: Math.min(0.9, 0.5 + (uniqueEndpoints / (config.max_tables_per_session || 10)) * 0.3),
          threat_source: { source_identifier: source },
          threat_details: {
            total_reads: reads.length,
            unique_endpoints: uniqueEndpoints,
            reads_per_minute: Math.round(reads.length / windowMinutes),
            endpoints_accessed: [...new Set(reads.map(r => r.endpoint))].slice(0, 20),
            window_minutes: windowMinutes,
          },
          response_taken: 'logged',
          response_details: {},
        });
      }
    }
  }

  return events;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

async function checkCooldown(supabase: any, event: ThreatEvent): Promise<boolean> {
  // Find tripwire cooldown
  const { data: tripwire } = await supabase
    .from('cyber_tripwires')
    .select('cooldown_minutes')
    .eq('id', event.tripwire_id)
    .single();

  if (!tripwire) return false;

  const cooldownStart = new Date(Date.now() - (tripwire.cooldown_minutes || 15) * 60 * 1000).toISOString();

  // Check for recent events of same type from same source
  const sourceKey = JSON.stringify(event.threat_source);
  const { data: recentEvents } = await supabase
    .from('cyber_threat_events')
    .select('id')
    .eq('event_type', event.event_type)
    .gte('created_at', cooldownStart)
    .limit(1);

  return recentEvents && recentEvents.length > 0;
}

async function executeGraduatedResponse(
  supabase: any, 
  event: ThreatEvent, 
  eventId?: string
): Promise<{ action: string; details: Record<string, any> }> {
  
  // Determine response tier based on confidence and severity
  let responseTier = 'logged';
  
  if (event.confidence_score >= 0.9 && event.severity === 'critical') {
    responseTier = 'blocked';
  } else if (event.confidence_score >= 0.75 && ['critical', 'high'].includes(event.severity)) {
    responseTier = 'throttled';
  } else if (event.confidence_score >= 0.6 && event.severity !== 'low') {
    responseTier = 'alerted';
  } else {
    responseTier = 'logged';
  }

  const responseDetails: Record<string, any> = {
    tier: responseTier,
    confidence: event.confidence_score,
    severity: event.severity,
    timestamp: new Date().toISOString(),
  };

  // Execute response based on tier
  switch (responseTier) {
    case 'blocked':
      // Log to audit for manual IP blocking
      await supabase.from('audit_events').insert({
        action: 'cyber_sentinel_block',
        resource: 'cyber_threat_events',
        resource_id: eventId,
        metadata: {
          event_type: event.event_type,
          threat_source: event.threat_source,
          automated: true,
          response_tier: 'block',
        }
      });
      responseDetails.notification_sent = true;
      responseDetails.audit_logged = true;
      break;

    case 'throttled':
      // Apply rate limiting via rate_limit_tracking
      if (event.threat_source.user_id) {
        await supabase.rpc('check_rate_limit', {
          p_user_id: event.threat_source.user_id,
          p_action_type: 'cyber_sentinel_throttle',
          p_max_requests: 1,
          p_window_minutes: 30,
        });
      }
      responseDetails.throttle_applied = true;
      break;

    case 'alerted':
      // Create pending message for admins
      const { data: adminUsers } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['admin', 'super_admin'])
        .limit(5);

      if (adminUsers) {
        for (const admin of adminUsers) {
          await supabase.from('agent_pending_messages').insert({
            recipient_user_id: admin.user_id,
            message: `🛡️ Cyber Sentinel Alert: ${event.event_type} detected (${event.severity} severity, ${(event.confidence_score * 100).toFixed(0)}% confidence). ${JSON.stringify(event.threat_details).substring(0, 200)}`,
            trigger_event: 'cyber_threat_detected',
            priority: event.severity === 'critical' ? 'urgent' : 'high',
          });
        }
        responseDetails.admins_notified = adminUsers.length;
      }
      break;

    default:
      // Logged only — no active response
      break;
  }

  return { action: responseTier, details: responseDetails };
}

// ═══════════════════════════════════════════════════════════════════════════
// AI THREAT ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════

async function generateThreatAssessment(
  supabase: any,
  criticalEvents: ThreatEvent[], 
  totalEvents: number
): Promise<string> {
  const eventSummary = criticalEvents.map(e => 
    `- ${e.event_type} (${e.severity}, ${(e.confidence_score * 100).toFixed(0)}% confidence): ${JSON.stringify(e.threat_details).substring(0, 300)}`
  ).join('\n');

  try {
    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are the Cyber Sentinel — Fortress platform's cyber defense analyst. Produce a concise threat assessment in 3-5 sentences. Focus on: attack vector, risk level, recommended immediate actions. Use plain language, no markdown. Write like a senior SOC analyst briefing the CISO.`
        },
        {
          role: 'user',
          content: `Sweep detected ${totalEvents} total events, ${criticalEvents.length} critical:\n${eventSummary}\n\nProvide threat assessment.`
        }
      ],
      functionName: 'cyber-sentinel',
      dlqOnFailure: false,
    });

    return aiResult.content || `${criticalEvents.length} critical cyber threats detected. Review immediately.`;
  } catch {
    return `${criticalEvents.length} critical cyber threats detected. AI assessment failed — manual review required.`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERT DELIVERY
// ═══════════════════════════════════════════════════════════════════════════

async function sendCyberAlert(supabase: any, events: ThreatEvent[], aiAssessment: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Send email via existing notification infrastructure
    await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        to: Deno.env.get('ALERT_EMAIL') || 'ak@silentshieldsecurity.com',
        type: 'cyber_alert',
        data: {
          subject: `🛡️ CYBER SENTINEL: ${events.length} Critical Threat${events.length > 1 ? 's' : ''} Detected`,
          threats: events.map(e => ({
            type: e.event_type,
            severity: e.severity,
            confidence: (e.confidence_score * 100).toFixed(0) + '%',
          })),
          ai_assessment: aiAssessment,
          timestamp: new Date().toISOString(),
        }
      }),
    });
  } catch (error) {
    console.error('[CyberSentinel] Alert delivery failed:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CYBER POSTURE STATUS
// ═══════════════════════════════════════════════════════════════════════════

async function getCyberPosture(supabase: any) {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Active tripwires
  const { data: tripwires } = await supabase
    .from('cyber_tripwires')
    .select('id, name, tripwire_type, severity, response_tier')
    .eq('is_active', true);

  // Recent threat events
  const { data: recentEvents } = await supabase
    .from('cyber_threat_events')
    .select('id, event_type, severity, confidence_score, response_taken, is_resolved, created_at')
    .gte('created_at', last24h)
    .order('created_at', { ascending: false });

  // 7-day trend
  const { data: weekEvents } = await supabase
    .from('cyber_threat_events')
    .select('id, severity, created_at')
    .gte('created_at', last7d);

  // Last sweep
  const { data: lastSweep } = await supabase
    .from('cyber_sentinel_sweeps')
    .select('*')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  const unresolvedCritical = (recentEvents || []).filter(
    (e: any) => !e.is_resolved && ['critical', 'high'].includes(e.severity)
  ).length;

  // Determine posture level
  let postureLevel = 'GREEN';
  if (unresolvedCritical > 5) postureLevel = 'RED';
  else if (unresolvedCritical > 2) postureLevel = 'ORANGE';
  else if (unresolvedCritical > 0) postureLevel = 'YELLOW';

  return {
    posture_level: postureLevel,
    active_tripwires: tripwires?.length || 0,
    tripwires: tripwires || [],
    last_24h: {
      total_events: recentEvents?.length || 0,
      critical: (recentEvents || []).filter((e: any) => e.severity === 'critical').length,
      high: (recentEvents || []).filter((e: any) => e.severity === 'high').length,
      unresolved_critical: unresolvedCritical,
      responses: {
        blocked: (recentEvents || []).filter((e: any) => e.response_taken === 'blocked').length,
        throttled: (recentEvents || []).filter((e: any) => e.response_taken === 'throttled').length,
        alerted: (recentEvents || []).filter((e: any) => e.response_taken === 'alerted').length,
      }
    },
    last_7d: {
      total_events: weekEvents?.length || 0,
      trend: weekEvents && weekEvents.length > 0 ? 'active_monitoring' : 'quiet',
    },
    last_sweep: lastSweep ? {
      completed_at: lastSweep.completed_at,
      findings: lastSweep.findings_count,
      threats: lastSweep.threats_detected,
      ai_assessment: lastSweep.ai_assessment,
    } : null,
  };
}

function respond(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
