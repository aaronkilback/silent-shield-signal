/**
 * Tier 5: Autonomous Operations Loop
 * 
 * The closed-loop OODA engine that runs on cron. It:
 * 1. Detects: Runs threat scan + predictive scoring
 * 2. Decides: Evaluates auto-escalation rules
 * 3. Acts: Creates incidents, sends briefings, escalates
 * 4. Learns: Logs all autonomous actions for feedback
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface EscalationRule {
  id: string;
  name: string;
  trigger_type: string;
  conditions: {
    risk_score_threshold?: number;
    severity_filter?: string[];
    category_filter?: string[];
    signal_count_threshold?: number;
    entity_cluster_threshold?: number;
    escalation_probability_threshold?: number;
  };
  actions: {
    create_incident?: boolean;
    incident_priority?: string;
    send_briefing?: boolean;
    notify_emails?: string[];
    notify_user_ids?: string[];
    escalate_to_role?: string;
  };
  cooldown_minutes: number;
  last_triggered_at: string | null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const dateContext = getCriticalDateContext();
    console.log(`[AutonomousLoop] Starting OODA cycle at ${dateContext.currentDateTimeLocal}`);

    const actionsLog: any[] = [];

    // ========== PHASE 1: OBSERVE ==========
    const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();
    const cutoff1h = new Date(Date.now() - 3600000).toISOString();

    const [
      { data: recentSignals },
      { data: highRiskScores },
      { data: openIncidents },
      { data: escalationRules },
      { data: recentScans },
      { data: scheduledBriefings },
    ] = await Promise.all([
      supabase.from('signals').select('id, category, severity, normalized_text, entity_tags, confidence, created_at, client_id')
        .gte('created_at', cutoff24h).order('created_at', { ascending: false }).limit(200),
      supabase.from('predictive_incident_scores').select('signal_id, escalation_probability, predicted_severity, predicted_priority, scored_at')
        .gte('escalation_probability', 0.5).order('escalation_probability', { ascending: false }).limit(50),
      supabase.from('incidents').select('id, priority, status, opened_at, signal_id')
        .eq('status', 'open').limit(100),
      supabase.from('auto_escalation_rules').select('*')
        .eq('is_active', true),
      supabase.from('autonomous_scan_results').select('risk_score, findings, created_at')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('scheduled_briefings').select('*')
        .eq('is_active', true),
    ]);

    const latestScan = recentScans?.[0];
    const currentRiskScore = latestScan?.risk_score || 0;

    // Compute current threat metrics
    const metrics = {
      total_signals_24h: (recentSignals || []).length,
      high_risk_signals: (highRiskScores || []).length,
      open_incidents: (openIncidents || []).length,
      current_risk_score: currentRiskScore,
      critical_signals: (recentSignals || []).filter(s => s.severity === 'critical').length,
      high_signals: (recentSignals || []).filter(s => s.severity === 'high').length,
    };

    console.log(`[AutonomousLoop] Metrics:`, JSON.stringify(metrics));

    // ========== PHASE 2: ORIENT + DECIDE ==========
    // Evaluate each escalation rule
    const existingSignalIds = new Set((openIncidents || []).map(i => i.signal_id).filter(Boolean));

    for (const rule of (escalationRules || []) as EscalationRule[]) {
      // Check cooldown
      if (rule.last_triggered_at) {
        const cooldownEnd = new Date(new Date(rule.last_triggered_at).getTime() + rule.cooldown_minutes * 60000);
        if (new Date() < cooldownEnd) {
          console.log(`[AutonomousLoop] Rule "${rule.name}" in cooldown until ${cooldownEnd.toISOString()}`);
          continue;
        }
      }

      const conditions = rule.conditions;
      let triggered = false;
      const triggerReasons: string[] = [];

      // Check risk score threshold
      if (conditions.risk_score_threshold && currentRiskScore >= conditions.risk_score_threshold) {
        triggered = true;
        triggerReasons.push(`Risk score ${currentRiskScore} >= threshold ${conditions.risk_score_threshold}`);
      }

      // Check signal count threshold
      if (conditions.signal_count_threshold && metrics.total_signals_24h >= conditions.signal_count_threshold) {
        triggered = true;
        triggerReasons.push(`Signal count ${metrics.total_signals_24h} >= threshold ${conditions.signal_count_threshold}`);
      }

      // Check escalation probability threshold
      if (conditions.escalation_probability_threshold) {
        const highProbSignals = (highRiskScores || []).filter(
          s => s.escalation_probability >= (conditions.escalation_probability_threshold || 0)
        );
        if (highProbSignals.length > 0) {
          triggered = true;
          triggerReasons.push(`${highProbSignals.length} signals above escalation probability ${conditions.escalation_probability_threshold}`);
        }
      }

      if (!triggered) continue;

      console.log(`[AutonomousLoop] Rule "${rule.name}" TRIGGERED: ${triggerReasons.join(', ')}`);

      // ========== PHASE 3: ACT ==========
      const actions = rule.actions;

      // Action: Auto-create incidents from high-risk signals
      if (actions.create_incident) {
        const unescalatedHighRisk = (highRiskScores || []).filter(
          s => s.escalation_probability >= 0.7 && !existingSignalIds.has(s.signal_id)
        );

        for (const score of unescalatedHighRisk.slice(0, 3)) {
          // Get signal details
          const signal = (recentSignals || []).find(s => s.id === score.signal_id);
          if (!signal) continue;

          const { data: newIncident, error } = await supabase.from('incidents').insert({
            signal_id: score.signal_id,
            client_id: signal.client_id,
            priority: actions.incident_priority || score.predicted_priority || 'p2',
            status: 'open',
            opened_at: new Date().toISOString(),
            auto_created: true,
          }).select('id').single();

          if (!error && newIncident) {
            existingSignalIds.add(score.signal_id);
            actionsLog.push({
              action_type: 'auto_create_incident',
              trigger_source: `rule:${rule.name}`,
              trigger_id: rule.id,
              action_details: {
                incident_id: newIncident.id,
                signal_id: score.signal_id,
                escalation_probability: score.escalation_probability,
                priority: actions.incident_priority || score.predicted_priority,
              },
              status: 'completed',
            });
            console.log(`[AutonomousLoop] Auto-created incident ${newIncident.id} from signal ${score.signal_id} (prob: ${score.escalation_probability})`);
          }
        }
      }

      // Action: Send notification/briefing
      if (actions.send_briefing && actions.notify_emails?.length) {
        // Generate a quick situational briefing
        try {
          const briefingResult = await callAiGateway({
            model: 'google/gemini-3-flash-preview',
            messages: [
              {
                role: 'system',
                content: `You are AEGIS, the autonomous security operations system. Generate a concise escalation alert briefing (150 words max). Use measured, professional language. Current date: ${dateContext.currentDateISO}. Include: 1) Trigger reason, 2) Key metrics, 3) Recommended immediate action.`,
              },
              {
                role: 'user',
                content: `ESCALATION TRIGGERED by rule "${rule.name}"\nReasons: ${triggerReasons.join('; ')}\nMetrics: ${JSON.stringify(metrics)}\nTop risk signals: ${JSON.stringify((highRiskScores || []).slice(0, 5))}`,
              },
            ],
            functionName: 'autonomous-operations-loop',
            extraBody: { max_tokens: 500, temperature: 0.2 },
          });

          if (briefingResult.content) {
            const briefingText = briefingResult.content;

            // Send via notification email function
            for (const email of actions.notify_emails) {
              await supabase.functions.invoke('send-notification-email', {
                body: {
                  to: email,
                  type: 'autonomous_escalation',
                  data: {
                    rule_name: rule.name,
                    briefing: briefingText,
                    metrics,
                    trigger_reasons: triggerReasons,
                  },
                },
              });
            }

            actionsLog.push({
              action_type: 'auto_send_escalation_briefing',
              trigger_source: `rule:${rule.name}`,
              trigger_id: rule.id,
              action_details: {
                recipients: actions.notify_emails,
                briefing_preview: briefingText.substring(0, 200),
              },
              status: 'completed',
            });
          }
        } catch (err) {
          console.error('[AutonomousLoop] Briefing generation error:', err);
        }
      }

      // Update rule trigger timestamp
      await supabase.from('auto_escalation_rules').update({
        last_triggered_at: new Date().toISOString(),
        trigger_count: (rule.trigger_count || 0) + 1,
      }).eq('id', rule.id);
    }

    // ========== SCHEDULED BRIEFINGS ==========
    // Briefings are handled exclusively by the dedicated `send-daily-briefing` cron job
    // to prevent duplicate delivery. See cron: daily-email-briefing (0 13 * * *).

    // ========== PHASE 4: LOG ALL ACTIONS ==========
    if (actionsLog.length > 0) {
      await supabase.from('autonomous_actions_log').insert(actionsLog);
    }

    console.log(`[AutonomousLoop] OODA cycle complete. Actions taken: ${actionsLog.length}`);

    return successResponse({
      success: true,
      cycle_time: dateContext.currentDateTimeISO,
      metrics,
      actions_taken: actionsLog.length,
      actions: actionsLog,
    });
  } catch (error) {
    console.error('[AutonomousLoop] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
