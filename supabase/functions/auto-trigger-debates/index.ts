/**
 * Auto-trigger multi-agent debates — May 2026 (Day 2 of plan).
 *
 * Periodically scans for incidents that have accumulated ≥3 distinct
 * specialist analyses but haven't been adjudicated by AEGIS-CMD yet,
 * and fires a command_synthesis debate for each. Without this, the
 * platform's specialist work compounds in `signal_agent_analyses`
 * without ever being integrated — operators only see multi-agent
 * synthesis when they explicitly type into AEGIS chat.
 *
 * The auto-trigger makes specialist collaboration the DEFAULT pattern
 * for incident analysis, not a manual ritual. Reports (daily briefing,
 * executive report) now pull from `agent_debate_records`, so making
 * debates fire passively means reports get substantial multi-agent
 * content even on days when no operator initiates.
 *
 * Eligibility (current rules):
 *   1. Incident is not closed/resolved/contained
 *   2. Incident has signal_id pointing to a real signal
 *   3. ≥3 distinct agents have written `signal_agent_analyses` rows
 *      tied to that signal in the last 7 days
 *   4. No `agent_debate_records` row exists for this incident in the
 *      last 24h (don't spam — one synthesis per incident per day max)
 *
 * Idempotent — runs hourly and only fires for newly-eligible incidents.
 *
 * Caps:
 *   - Max 5 debates per run (prevent OpenAI cost spike if a backlog
 *     accumulates)
 *   - Per-incident: 1 debate per 24h regardless of new analyses
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const MAX_DEBATES_PER_RUN = 5;
const DEBATE_COOLDOWN_HOURS = 24;
const ANALYSIS_LOOKBACK_DAYS = 7;
// Lowered from 3 → 2 on May 6 2026 after diagnostic showed 14 of 16
// open incidents had exactly 2 distinct specialists analyzing them
// (only 1 had ≥3). With ≥3, the trigger never fired in practice.
// MAX_DEBATES_PER_RUN=5 still prevents a burst when the gate widens.
// Long-term, the upstream fix is broader specialist invocation in
// review-signal-agent and signal-routing — only 8 distinct agents
// are writing across 166 analyzed signals over 7 days, which is
// narrower than the 30+ persona roster suggests should be active.
const MIN_DISTINCT_AGENTS = 2;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, 'auto-trigger-debates-hourly');

  try {
    const cooldownIso = new Date(Date.now() - DEBATE_COOLDOWN_HOURS * 3600_000).toISOString();
    const lookbackIso = new Date(Date.now() - ANALYSIS_LOOKBACK_DAYS * 86400_000).toISOString();

    // 1. Open / investigating incidents (closed/resolved/contained
    //    are out of scope — they're already adjudicated). Also skip
    //    null-client orphans: those exist because the NAAD monitor
    //    allows CAP-severity-Extreme alerts through without a client
    //    match (life-safety override). Debating them produces a real
    //    record but no client report queries it (every report filters
    //    by client_id), so it's compute-only waste. Leave them
    //    archived in `incidents` for audit but don't auto-debate.
    const { data: openIncidents, error: incErr } = await supabase
      .from('incidents')
      .select('id, signal_id, title, client_id, status, opened_at')
      .in('status', ['open', 'acknowledged'])
      .not('signal_id', 'is', null)
      .not('client_id', 'is', null)
      .is('deleted_at', null)
      .order('opened_at', { ascending: false })
      .limit(200);
    if (incErr) throw new Error(`incidents fetch: ${incErr.message}`);
    if (!openIncidents || openIncidents.length === 0) {
      console.log('[auto-trigger-debates] No open incidents');
      await completeHeartbeat(supabase, hb, { eligible: 0, debates_fired: 0 });
      return successResponse({ success: true, eligible: 0, debates_fired: 0 });
    }

    // 2. For each, count distinct agent analyses in the lookback
    //    window AND check whether a recent debate already exists.
    const eligible: Array<{ incident_id: string; signal_id: string; agent_count: number; title: string }> = [];

    for (const inc of openIncidents) {
      // Count distinct agents that have analyzed this incident's signal.
      const { data: analyses } = await supabase
        .from('signal_agent_analyses')
        .select('agent_call_sign')
        .eq('signal_id', inc.signal_id)
        .gte('created_at', lookbackIso);
      const distinctAgents = new Set((analyses || []).map((a: any) => a.agent_call_sign).filter(Boolean));
      if (distinctAgents.size < MIN_DISTINCT_AGENTS) continue;

      // Skip if a recent debate already exists for this incident
      // (cooldown — don't double-fire).
      const { data: recentDebate } = await supabase
        .from('agent_debate_records')
        .select('id')
        .eq('incident_id', inc.id)
        .gte('created_at', cooldownIso)
        .limit(1)
        .maybeSingle();
      if (recentDebate) continue;

      eligible.push({
        incident_id: inc.id,
        signal_id: inc.signal_id,
        agent_count: distinctAgents.size,
        title: inc.title || `Incident ${String(inc.id).slice(0, 8)}`,
      });
      if (eligible.length >= MAX_DEBATES_PER_RUN) break;
    }

    console.log(`[auto-trigger-debates] ${eligible.length} eligible incident(s) (${openIncidents.length} open total)`);

    // 3. Fire command_synthesis debate for each eligible incident.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    let firedCount = 0;
    const results: Array<{ incident_id: string; success: boolean; debate_id?: string; error?: string }> = [];

    for (const candidate of eligible) {
      try {
        const debateRes = await fetch(`${supabaseUrl}/functions/v1/multi-agent-debate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            incident_id: candidate.incident_id,
            debate_type: 'command_synthesis',
            custom_prompt: `Auto-triggered command synthesis: ${candidate.agent_count} specialists have analyzed this incident over the last ${ANALYSIS_LOOKBACK_DAYS} days. Adjudicate their findings.`,
          }),
        });
        if (!debateRes.ok) {
          const errText = await debateRes.text();
          results.push({ incident_id: candidate.incident_id, success: false, error: errText.substring(0, 200) });
          console.error(`[auto-trigger-debates] Debate failed for incident ${candidate.incident_id}: ${errText.substring(0, 200)}`);
          continue;
        }
        const debateJson = await debateRes.json();
        if (!debateJson?.debate_record_id) {
          results.push({ incident_id: candidate.incident_id, success: false, error: 'no debate_record_id returned' });
          continue;
        }
        firedCount++;
        results.push({ incident_id: candidate.incident_id, success: true, debate_id: debateJson.debate_record_id });
        console.log(`[auto-trigger-debates] Fired debate ${debateJson.debate_record_id} for "${candidate.title}"`);
      } catch (e: any) {
        results.push({ incident_id: candidate.incident_id, success: false, error: e?.message || String(e) });
      }
    }

    await completeHeartbeat(supabase, hb, {
      eligible: eligible.length,
      debates_fired: firedCount,
      open_incidents_scanned: openIncidents.length,
    });

    return successResponse({
      success: true,
      eligible: eligible.length,
      debates_fired: firedCount,
      open_incidents_scanned: openIncidents.length,
      results,
    });
  } catch (e: any) {
    console.error('[auto-trigger-debates] Fatal:', e);
    await failHeartbeat(supabase, hb, e instanceof Error ? e : new Error(String(e)));
    return errorResponse(e?.message || 'auto-trigger failed', 500);
  }
});
