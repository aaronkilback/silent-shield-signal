/**
 * Proactive Intelligence Push Engine
 * 
 * Runs on cron (every 15 minutes). Autonomously analyzes signals, incidents,
 * and threat patterns — then pushes actionable insights to users via
 * agent_pending_messages. This makes AEGIS come to the user instead of waiting.
 * 
 * Detectors:
 *  1. Signal surge — unusual spike in signal volume
 *  2. Emerging threat cluster — related signals converging rapidly
 *  3. Unattended high-risk — critical items with no human action
 *  4. Cross-client pattern — same threat across multiple clients
 *  5. Risk posture shift — significant change in overall risk score
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";

const AEGIS_AGENT_ID = '894e87b8-039a-4f6f-9966-85f932ee7a05';
const COOLDOWN_KEY = 'proactive_intelligence_last_push';
const MIN_PUSH_INTERVAL_MS = 10 * 60 * 1000; // 10 min between pushes per user

interface Insight {
  type: string;
  priority: 'normal' | 'high' | 'urgent';
  headline: string;
  details: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const dateContext = getCriticalDateContext();
    console.log(`[ProactiveIntel] Starting push cycle at ${dateContext.currentDateTimeLocal}`);

    const now = new Date();
    const cutoff1h = new Date(now.getTime() - 3600000).toISOString();
    const cutoff4h = new Date(now.getTime() - 4 * 3600000).toISOString();
    const cutoff24h = new Date(now.getTime() - 24 * 3600000).toISOString();

    // ═══════════════════════════════════════════════════════════════════
    //  GATHER: Pull recent platform data in parallel
    // ═══════════════════════════════════════════════════════════════════
    const [
      { data: signals1h },
      { data: signals24h },
      { data: openIncidents },
      { data: highRiskScores },
      { data: recentClusters },
      { data: latestRiskScan },
      { data: previousRiskScan },
      { data: activeUsers },
    ] = await Promise.all([
      supabase.from('signals').select('id, category, severity, normalized_text, entity_tags, client_id, created_at')
        .gte('created_at', cutoff1h).eq('is_test', false).order('created_at', { ascending: false }),
      supabase.from('signals').select('id, category, severity, client_id, created_at')
        .gte('created_at', cutoff24h).eq('is_test', false),
      supabase.from('incidents').select('id, priority, status, opened_at, signal_id, client_id, assigned_to')
        .eq('status', 'open'),
      supabase.from('predictive_incident_scores').select('signal_id, escalation_probability, predicted_severity')
        .gte('escalation_probability', 0.65).gte('scored_at', cutoff4h),
      supabase.from('autonomous_scan_results').select('findings, risk_score, created_at, scan_type')
        .eq('scan_type', 'threat_cluster').gte('created_at', cutoff4h)
        .order('created_at', { ascending: false }).limit(5),
      supabase.from('autonomous_scan_results').select('risk_score, created_at')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('autonomous_scan_results').select('risk_score, created_at')
        .order('created_at', { ascending: false }).range(1, 1),
      // Get all users with analyst/admin roles who have proactive enabled
      supabase.from('user_roles').select('user_id, role')
        .in('role', ['admin', 'super_admin', 'analyst']),
    ]);

    const insights: Insight[] = [];

    // ═══════════════════════════════════════════════════════════════════
    //  DETECT 1: Signal Surge
    // ═══════════════════════════════════════════════════════════════════
    const signalCount1h = (signals1h || []).length;
    const avgHourlyRate = Math.max(1, ((signals24h || []).length) / 24);
    const surgeMultiplier = signalCount1h / avgHourlyRate;

    if (surgeMultiplier >= 3 && signalCount1h >= 5) {
      const topCategories = Object.entries(
        (signals1h || []).reduce((acc: Record<string, number>, s) => {
          acc[s.category || 'uncategorized'] = (acc[s.category || 'uncategorized'] || 0) + 1;
          return acc;
        }, {})
      ).sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 3);

      insights.push({
        type: 'signal_surge',
        priority: surgeMultiplier >= 5 ? 'urgent' : 'high',
        headline: `Signal surge detected: ${signalCount1h} signals in the last hour (${surgeMultiplier.toFixed(1)}x normal rate)`,
        details: {
          count: signalCount1h,
          multiplier: surgeMultiplier,
          topCategories,
          criticalCount: (signals1h || []).filter(s => s.severity === 'critical').length,
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DETECT 2: Unattended High-Risk
    // ═══════════════════════════════════════════════════════════════════
    const unattendedCritical = (openIncidents || []).filter(i => {
      const age = now.getTime() - new Date(i.opened_at).getTime();
      return (i.priority === 'p1' && age > 30 * 60000 && !i.assigned_to)
        || (i.priority === 'p2' && age > 2 * 3600000 && !i.assigned_to);
    });

    if (unattendedCritical.length > 0) {
      insights.push({
        type: 'unattended_high_risk',
        priority: unattendedCritical.some(i => i.priority === 'p1') ? 'urgent' : 'high',
        headline: `${unattendedCritical.length} critical incident${unattendedCritical.length > 1 ? 's' : ''} unassigned and aging`,
        details: {
          incidents: unattendedCritical.map(i => ({
            id: i.id,
            priority: i.priority,
            ageMinutes: Math.round((now.getTime() - new Date(i.opened_at).getTime()) / 60000),
          })),
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DETECT 3: Risk Posture Shift
    // ═══════════════════════════════════════════════════════════════════
    const currentRisk = latestRiskScan?.[0]?.risk_score ?? 0;
    const previousRisk = previousRiskScan?.[0]?.risk_score ?? 0;
    const riskDelta = currentRisk - previousRisk;

    if (Math.abs(riskDelta) >= 15) {
      insights.push({
        type: 'risk_posture_shift',
        priority: riskDelta >= 25 ? 'urgent' : 'high',
        headline: `Risk posture ${riskDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(riskDelta)} points (now ${currentRisk}/100)`,
        details: { currentRisk, previousRisk, delta: riskDelta },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DETECT 4: Cross-Client Pattern
    // ═══════════════════════════════════════════════════════════════════
    const clientSignalMap: Record<string, Set<string>> = {};
    for (const sig of (signals24h || [])) {
      if (!sig.client_id || !sig.category) continue;
      if (!clientSignalMap[sig.category]) clientSignalMap[sig.category] = new Set();
      clientSignalMap[sig.category].add(sig.client_id);
    }
    const crossClientPatterns = Object.entries(clientSignalMap)
      .filter(([, clients]) => clients.size >= 3)
      .map(([category, clients]) => ({ category, clientCount: clients.size }));

    if (crossClientPatterns.length > 0) {
      insights.push({
        type: 'cross_client_pattern',
        priority: 'high',
        headline: `Cross-client threat pattern: "${crossClientPatterns[0].category}" affecting ${crossClientPatterns[0].clientCount} clients simultaneously`,
        details: { patterns: crossClientPatterns },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DETECT 5: High-Probability Escalation Queue
    // ═══════════════════════════════════════════════════════════════════
    const highProbSignals = (highRiskScores || []).filter(s => s.escalation_probability >= 0.8);
    if (highProbSignals.length >= 2) {
      insights.push({
        type: 'escalation_queue',
        priority: 'high',
        headline: `${highProbSignals.length} signals have 80%+ escalation probability and may require preemptive action`,
        details: {
          count: highProbSignals.length,
          topProbability: Math.max(...highProbSignals.map(s => s.escalation_probability)),
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    //  SYNTHESIZE: Use AI to generate conversational push message
    // ═══════════════════════════════════════════════════════════════════
    if (insights.length === 0) {
      console.log('[ProactiveIntel] No actionable insights detected. Cycle complete.');
      return successResponse({ status: 'no_insights', cycle_time: dateContext.currentDateTimeLocal });
    }

    console.log(`[ProactiveIntel] ${insights.length} insight(s) detected, synthesizing push message`);

    const urgentInsights = insights.filter(i => i.priority === 'urgent');
    const highInsights = insights.filter(i => i.priority === 'high');
    const topInsights = [...urgentInsights, ...highInsights].slice(0, 3);

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      functionName: 'proactive-intelligence-push',
      messages: [
        {
          role: 'system',
          content: `You are AEGIS, a senior intelligence officer delivering a proactive situational update. Write a concise push notification message (80-150 words) that:
1. Opens with the single most critical finding
2. Provides context on what it means operationally
3. Ends with a specific recommended action
4. Uses measured, professional tone — no alarmism
5. Current date: ${dateContext.currentDateISO}
Never use markdown. Write plain text suitable for a notification. Do not use bullet points.`,
        },
        {
          role: 'user',
          content: `Generate a proactive intelligence push based on these detected patterns:\n\n${JSON.stringify(topInsights, null, 2)}`,
        },
      ],
    });

    const pushMessage = aiResult.content || topInsights[0].headline;
    const pushPriority = urgentInsights.length > 0 ? 'urgent' : 'high';

    // ═══════════════════════════════════════════════════════════════════
    //  DELIVER: Push to eligible users via agent_pending_messages
    // ═══════════════════════════════════════════════════════════════════
    const eligibleUserIds = [...new Set((activeUsers || []).map(u => u.user_id))];

    // Filter by user preferences (proactive_enabled) and cooldown
    const { data: userPrefs } = await supabase
      .from('user_agent_preferences')
      .select('user_id, proactive_enabled, muted_until')
      .is('agent_id', null);

    const prefMap = new Map((userPrefs || []).map(p => [p.user_id, p]));

    // Check recent pushes to avoid spam
    const { data: recentPushes } = await supabase
      .from('agent_pending_messages')
      .select('recipient_user_id, created_at')
      .eq('agent_id', AEGIS_AGENT_ID)
      .eq('trigger_event', 'proactive_intelligence')
      .gte('created_at', new Date(now.getTime() - MIN_PUSH_INTERVAL_MS).toISOString());

    const recentPushUsers = new Set((recentPushes || []).map(p => p.recipient_user_id));

    let deliveredCount = 0;
    for (const userId of eligibleUserIds) {
      // Skip if recently pushed
      if (recentPushUsers.has(userId)) continue;

      // Skip if user disabled proactive messages
      const pref = prefMap.get(userId);
      if (pref?.proactive_enabled === false) continue;
      if (pref?.muted_until && new Date(pref.muted_until) > now) continue;

      const { error } = await supabase.from('agent_pending_messages').insert({
        agent_id: AEGIS_AGENT_ID,
        recipient_user_id: userId,
        message: pushMessage,
        priority: pushPriority,
        trigger_event: 'proactive_intelligence',
      });

      if (!error) deliveredCount++;
    }

    // Log the autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'proactive_intelligence_push',
      trigger_source: 'cron:proactive-intelligence-push',
      action_details: {
        insights_detected: insights.length,
        insight_types: insights.map(i => i.type),
        push_priority: pushPriority,
        delivered_to: deliveredCount,
        message_preview: pushMessage.substring(0, 100),
      },
      status: 'completed',
    });

    console.log(`[ProactiveIntel] Pushed to ${deliveredCount} users. ${insights.length} insights synthesized.`);

    return successResponse({
      status: 'pushed',
      insights_detected: insights.length,
      insight_types: insights.map(i => i.type),
      delivered_to: deliveredCount,
      push_priority: pushPriority,
    });

  } catch (error) {
    console.error('[ProactiveIntel] Engine error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
