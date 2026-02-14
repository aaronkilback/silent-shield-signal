/**
 * Proactive Intelligence Push Engine
 * 
 * Runs on cron (every 15 minutes). Autonomously analyzes signals, incidents,
 * and threat patterns — then pushes actionable insights to users via
 * agent_pending_messages. This makes AEGIS come to the user instead of waiting.
 * 
 * Detectors:
 *  1. Signal surge — unusual spike in signal volume
 *  2. Unattended high-risk — critical items with no human action
 *  3. Risk posture shift — significant change in overall risk score
 *  4. Cross-client pattern — same threat across multiple clients
 *  5. High-probability escalation queue
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";

const AEGIS_AGENT_ID = '894e87b8-039a-4f6f-9966-85f932ee7a05';
const MIN_PUSH_INTERVAL_MS = 10 * 60 * 1000; // 10 min between pushes per user
const RISK_BASELINE_FALLBACK = 50; // When no previous scan exists, assume moderate baseline

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
      { data: latestRiskScans },
      { data: activeUsers },
    ] = await Promise.all([
      supabase.from('signals').select('id, category, severity, normalized_text, entity_tags, client_id, created_at')
        .gte('created_at', cutoff1h).eq('is_test', false).order('created_at', { ascending: false }),
      supabase.from('signals').select('id, category, severity, client_id, created_at')
        .gte('created_at', cutoff24h).eq('is_test', false),
      supabase.from('incidents').select('id, priority, status, opened_at, signal_id, client_id, owner_user_id')
        .eq('status', 'open'),
      supabase.from('predictive_incident_scores').select('signal_id, escalation_probability, predicted_severity')
        .gte('escalation_probability', 0.65).gte('scored_at', cutoff4h),
      // Get last 2 risk scans for delta comparison
      supabase.from('autonomous_scan_results').select('risk_score, created_at')
        .not('risk_score', 'is', null)
        .order('created_at', { ascending: false }).limit(2),
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
      return (i.priority === 'p1' && age > 30 * 60000 && !i.owner_user_id)
        || (i.priority === 'p2' && age > 2 * 3600000 && !i.owner_user_id);
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
    //  DETECT 3: Risk Posture Shift (with safe baseline)
    // ═══════════════════════════════════════════════════════════════════
    const scans = latestRiskScans || [];
    // Only fire if we have at least 2 data points to compare
    if (scans.length >= 2) {
      const currentRisk = scans[0]?.risk_score ?? RISK_BASELINE_FALLBACK;
      const previousRisk = scans[1]?.risk_score ?? RISK_BASELINE_FALLBACK;
      const riskDelta = currentRisk - previousRisk;

      if (Math.abs(riskDelta) >= 15) {
        insights.push({
          type: 'risk_posture_shift',
          priority: riskDelta >= 25 ? 'urgent' : 'high',
          headline: `Risk posture ${riskDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(riskDelta)} points (now ${currentRisk}/100)`,
          details: { currentRisk, previousRisk, delta: riskDelta },
        });
      }
    } else {
      console.log('[ProactiveIntel] Skipping risk posture check — insufficient historical data (need 2+ scans)');
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
          content: `You are AEGIS, a senior intelligence officer delivering a routine situational update via short push notification. 

TONE RULES (MANDATORY):
- Measured, calm, professional. You are informing, not alarming.
- NEVER use phrases like "critical compromise", "unprecedented", "severe consequences", "mandatory", "failure to act", "shattered", or any language implying imminent disaster.
- NEVER claim systems are "compromised" or "under attack" unless there is explicit evidence of an active intrusion.
- Unassigned incidents are a staffing/workflow gap, NOT a security breach. Frame them as operational items needing attention.
- Risk scores are analytical indicators, not emergency sirens. A score of 80/100 means "elevated monitoring warranted", not "the building is on fire".
- Do NOT invent contingency protocols, threat levels, or emergency procedures.
- Write as if briefing a calm executive over coffee, not sounding a battle alarm.

FORMAT: 60-120 words of plain text. No markdown, no bullet points, no special characters. One short paragraph.
Current date: ${dateContext.currentDateISO}`,
        },
        {
          role: 'user',
          content: `Generate a calm, measured situational update based on these patterns:\n\n${JSON.stringify(topInsights, null, 2)}`,
        },
      ],
    });

    const pushMessage = aiResult.content || topInsights[0].headline;
    const pushPriority = urgentInsights.length > 0 ? 'urgent' : 'high';

    // ═══════════════════════════════════════════════════════════════════
    //  DELIVER: Push to eligible users via agent_pending_messages
    //  Dedup: ONE message per cycle (not per user), skip if identical
    // ═══════════════════════════════════════════════════════════════════
    const eligibleUserIds = [...new Set((activeUsers || []).map(u => u.user_id))];

    // Filter by user preferences (proactive_enabled) and cooldown
    const { data: userPrefs } = await supabase
      .from('user_agent_preferences')
      .select('user_id, proactive_enabled, muted_until')
      .is('agent_id', null);

    const prefMap = new Map((userPrefs || []).map(p => [p.user_id, p]));

    // Check recent pushes to avoid spam — use a wider window (15 min = cron interval)
    const cooldownCutoff = new Date(now.getTime() - MIN_PUSH_INTERVAL_MS).toISOString();
    const { data: recentPushes } = await supabase
      .from('agent_pending_messages')
      .select('recipient_user_id, created_at')
      .eq('trigger_event', 'proactive_intelligence')
      .gte('created_at', cooldownCutoff);

    const recentPushUsers = new Set((recentPushes || []).map(p => p.recipient_user_id));

    // Build batch insert array to avoid per-user round-trips
    const messagesToInsert: Array<{
      agent_id: string;
      recipient_user_id: string;
      message: string;
      priority: string;
      trigger_event: string;
    }> = [];

    for (const userId of eligibleUserIds) {
      // Skip if recently pushed (any proactive message, not just from AEGIS)
      if (recentPushUsers.has(userId)) continue;

      // Skip if user disabled proactive messages
      const pref = prefMap.get(userId);
      if (pref?.proactive_enabled === false) continue;
      if (pref?.muted_until && new Date(pref.muted_until) > now) continue;

      messagesToInsert.push({
        agent_id: AEGIS_AGENT_ID,
        recipient_user_id: userId,
        message: pushMessage,
        priority: pushPriority,
        trigger_event: 'proactive_intelligence',
      });
    }

    let deliveredCount = 0;
    if (messagesToInsert.length > 0) {
      const { error, count } = await supabase
        .from('agent_pending_messages')
        .insert(messagesToInsert);

      if (error) {
        console.error('[ProactiveIntel] Batch insert error:', error.message);
      } else {
        deliveredCount = messagesToInsert.length;
      }
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
        eligible_users: eligibleUserIds.length,
        skipped_cooldown: recentPushUsers.size,
        message_preview: pushMessage.substring(0, 100),
      },
      status: 'completed',
    });

    console.log(`[ProactiveIntel] Pushed to ${deliveredCount} users (${recentPushUsers.size} skipped by cooldown). ${insights.length} insights synthesized.`);

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
