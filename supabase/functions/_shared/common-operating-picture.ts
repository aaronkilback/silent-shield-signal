/**
 * Common Operating Picture (COP) — Shared Intelligence Snapshot
 * 
 * Fetches the same real-time threat picture for ALL agents and Aegis.
 * Every call to buildCOP() returns an identical, timestamped snapshot
 * so the entire network operates from one ground truth.
 * 
 * Injected into:
 *   1. agent-chat/index.ts — prepended to every agent's contextData
 *   2. dashboard-ai-assistant/index.ts — injected as agentContext in buildAegisPrompt()
 *   3. get_common_operating_picture tool — callable by Aegis on demand
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface COPSnapshot {
  generated_at: string;
  risk_score: number | null;
  risk_trend: 'rising' | 'falling' | 'stable' | 'unknown';
  open_incidents: { id: string; title: string; priority: string; opened_at: string }[];
  critical_signals: { id: string; title: string; severity: string; category: string; created_at: string }[];
  high_probability_escalations: { signal_id: string; probability: number; predicted_severity: string }[];
  top_entities: { name: string; type: string; risk_level: string; threat_score: number }[];
  watched_entities: { name: string; type: string; watch_level: string; reason: string }[];
  active_agents: { call_sign: string; codename: string; specialty: string }[];
  broadcast_messages: { message: string; priority: string; created_at: string }[];
  summary: string;
}

/**
 * Build the Common Operating Picture snapshot.
 * Pass a Supabase service-role client.
 * Result is the same regardless of which agent or Aegis calls it.
 */
export async function buildCOP(supabase: SupabaseClient): Promise<COPSnapshot> {
  const now = new Date();
  const cutoff4h = new Date(now.getTime() - 4 * 3600000).toISOString();
  const cutoff24h = new Date(now.getTime() - 24 * 3600000).toISOString();

  const [
    { data: openIncidents },
    { data: criticalSignals },
    { data: escalations },
    { data: topEntities },
    { data: watchedEntities },
    { data: activeAgents },
    { data: riskScans },
    { data: broadcasts },
  ] = await Promise.all([
    supabase
      .from('incidents')
      .select('id, title, priority, status, opened_at')
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('opened_at', { ascending: false })
      .limit(8),
    supabase
      .from('signals')
      .select('id, title, severity, rule_category, created_at')
      .in('severity', ['critical', 'high'])
      .eq('is_test', false)
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('predictive_incident_scores')
      .select('signal_id, escalation_probability, predicted_severity')
      .gte('escalation_probability', 0.70)
      .gte('scored_at', cutoff4h)
      .order('escalation_probability', { ascending: false })
      .limit(5),
    supabase
      .from('entities')
      .select('name, type, risk_level, threat_score')
      .not('threat_score', 'is', null)
      .order('threat_score', { ascending: false })
      .limit(5),
    supabase
      .from('entity_watch_list')
      .select('entity_name, watch_level, reason, entity:entities(name, type, risk_level)')
      .eq('is_active', true)
      .in('watch_level', ['alert', 'critical'])
      .order('watch_level', { ascending: false })
      .limit(10),
    supabase
      .from('ai_agents')
      .select('call_sign, codename, specialty')
      .eq('is_active', true),
    supabase
      .from('autonomous_scan_results')
      .select('risk_score, created_at')
      .not('risk_score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2),
    supabase
      .from('agent_pending_messages')
      .select('message, priority, created_at')
      .eq('trigger_event', 'principal_broadcast')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  // Derive risk trend
  let risk_score: number | null = null;
  let risk_trend: COPSnapshot['risk_trend'] = 'unknown';
  if (riskScans?.length) {
    risk_score = riskScans[0]?.risk_score ?? null;
    if (riskScans.length >= 2 && riskScans[0]?.risk_score != null && riskScans[1]?.risk_score != null) {
      const delta = riskScans[0].risk_score - riskScans[1].risk_score;
      risk_trend = delta > 5 ? 'rising' : delta < -5 ? 'falling' : 'stable';
    }
  }

  // Build plain-text summary
  const incidentCount = openIncidents?.length || 0;
  const critCount = criticalSignals?.filter(s => s.severity === 'critical').length || 0;
  const highCount = criticalSignals?.filter(s => s.severity === 'high').length || 0;
  const escCount = escalations?.length || 0;

  const summary = [
    risk_score != null ? `Risk posture: ${risk_score}/100 (${risk_trend})` : 'Risk posture: unknown',
    incidentCount > 0 ? `${incidentCount} open incident${incidentCount !== 1 ? 's' : ''}` : 'No open incidents',
    critCount > 0 ? `${critCount} CRITICAL signal${critCount !== 1 ? 's' : ''} (24h)` : null,
    highCount > 0 ? `${highCount} HIGH signal${highCount !== 1 ? 's' : ''} (24h)` : null,
    escCount > 0 ? `${escCount} high-probability escalation${escCount !== 1 ? 's' : ''} flagged` : null,
  ].filter(Boolean).join(' | ');

  return {
    generated_at: now.toISOString(),
    risk_score,
    risk_trend,
    open_incidents: (openIncidents || []).map(i => ({
      id: i.id,
      title: i.title || 'Untitled',
      priority: i.priority,
      opened_at: i.opened_at,
    })),
    critical_signals: (criticalSignals || []).map(s => ({
      id: s.id,
      title: s.title,
      severity: s.severity,
      category: s.rule_category,
      created_at: s.created_at,
    })),
    high_probability_escalations: (escalations || []).map(e => ({
      signal_id: e.signal_id,
      probability: e.escalation_probability,
      predicted_severity: e.predicted_severity,
    })),
    top_entities: (topEntities || []).map(e => ({
      name: e.name,
      type: e.type,
      risk_level: e.risk_level || 'unknown',
      threat_score: e.threat_score,
    })),
    watched_entities: (watchedEntities || []).map((w: any) => ({
      name: w.entity_name,
      type: w.entity?.type || 'unknown',
      watch_level: w.watch_level,
      reason: w.reason || '',
    })),
    active_agents: (activeAgents || []).map(a => ({
      call_sign: a.call_sign,
      codename: a.codename,
      specialty: a.specialty,
    })),
    broadcast_messages: (broadcasts || []).map(b => ({
      message: b.message,
      priority: b.priority,
      created_at: b.created_at,
    })),
    summary,
  };
}

/**
 * Format a COPSnapshot as a plain-text block
 * suitable for injection into any agent or Aegis system prompt.
 */
export function formatCOPForPrompt(cop: COPSnapshot): string {
  const lines: string[] = [
    '═══ COMMON OPERATING PICTURE (COP) — SHARED NETWORK INTELLIGENCE ═══',
    `Generated: ${new Date(cop.generated_at).toUTCString()}`,
    `Situation: ${cop.summary}`,
    '',
  ];

  if (cop.open_incidents.length > 0) {
    lines.push('OPEN INCIDENTS:');
    cop.open_incidents.forEach(i =>
      lines.push(`  [${i.priority.toUpperCase()}] ${i.title} [incident:${i.id}] — opened ${new Date(i.opened_at).toLocaleDateString()}`)
    );
    lines.push('');
  }

  if (cop.critical_signals.length > 0) {
    lines.push('CRITICAL/HIGH SIGNALS (24h):');
    cop.critical_signals.forEach(s =>
      lines.push(`  [${s.severity.toUpperCase()}] ${s.title} (${s.category}) [signal:${s.id}]`)
    );
    lines.push('');
  }

  if (cop.high_probability_escalations.length > 0) {
    lines.push('HIGH-PROBABILITY ESCALATIONS:');
    cop.high_probability_escalations.forEach(e =>
      lines.push(`  Signal ${e.signal_id} — ${Math.round(e.probability * 100)}% chance of ${e.predicted_severity} escalation`)
    );
    lines.push('');
  }

  if (cop.top_entities.length > 0) {
    lines.push('TOP THREAT ENTITIES:');
    cop.top_entities.forEach(e =>
      lines.push(`  [${e.type}] ${e.name} — Risk: ${e.risk_level} (score: ${e.threat_score})`)
    );
    lines.push('');
  }

  if (cop.watched_entities.length > 0) {
    lines.push('## WATCHED ENTITIES (Active Monitoring)');
    cop.watched_entities.forEach(w =>
      lines.push(`  [${w.watch_level.toUpperCase()}] ${w.name} (${w.type})${w.reason ? ` — ${w.reason}` : ''}`)
    );
    lines.push('');
  }

  if (cop.active_agents.length > 0) {
    lines.push('ACTIVE AGENTS ON NETWORK:');
    cop.active_agents.forEach(a =>
      lines.push(`  ${a.call_sign} (${a.codename}) — ${a.specialty}`)
    );
    lines.push('');
  }

  if (cop.broadcast_messages.length > 0) {
    lines.push('RECENT PRINCIPAL BROADCASTS:');
    cop.broadcast_messages.forEach(b =>
      lines.push(`  [${b.priority.toUpperCase()}] ${new Date(b.created_at).toLocaleDateString()}: ${b.message.slice(0, 200)}`)
    );
    lines.push('');
  }

  lines.push('NOTE: All agents and Aegis operate from this same COP. Your analysis should be consistent with and build upon this shared picture.');
  lines.push('═══════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}
