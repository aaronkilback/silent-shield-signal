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
// 2026-05-10: 24h → 72h. Persona audit showed individual incidents
// (esp. TC Energy capex coverage) re-firing across consecutive days,
// generating dozens of redundant claims from CHAIN-WATCH/FININT for
// the same underlying analysis. 72h gives operators time to action
// the first synthesis before another fires.
const DEBATE_COOLDOWN_HOURS = 72;
const ANALYSIS_LOOKBACK_DAYS = 7;
// Lowered from 3 → 2 on May 6 2026 after diagnostic showed 14 of 16
// open incidents had exactly 2 distinct specialists analyzing them
// (only 1 had ≥3). With ≥3, the trigger never fired in practice.
// MAX_DEBATES_PER_RUN=5 still prevents a burst when the gate widens.
const MIN_DISTINCT_AGENTS = 2;

// 2026-05-10: skip auto-debating these signal categories unless the
// incident has a named entity tag pointing at a client asset. NAAD
// weather warnings and generic civil-emergency alerts pass the
// client_id filter (the NAAD monitor assigns a client_id per
// life-safety override), but they aren't protective-intelligence-
// actionable for executives unless a client asset is in the affected
// area. Without this filter, a tornado warning in London ON gets a
// full multi-specialist debate even though Petronas has no London
// presence — wasting agent cycles and burying real signals in the
// audit timeline.
const NON_ACTIONABLE_CATEGORIES = new Set([
  'natural_disaster',
  'flood',
  'hazmat',
  'civil_emergency',
  'weather',
]);

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
    // Pull incidents joined to their signals so we can read category
    // + entity_tags + client high_value_assets in one go for the
    // category filter.
    // PostgREST FK disambiguation: incidents has TWO paths to signals:
    //   1. incidents.signal_id → signals.id (direct 1:1 FK, added Nov 2025)
    //   2. incident_signals junction table (m2m, added Nov 2025)
    // Without specifying which FK to traverse, PostgREST errors with
    // "Could not embed because more than one relationship was found".
    // Pin to the direct FK via the column name (!signal_id).
    const { data: openIncidents, error: incErr } = await supabase
      .from('incidents')
      .select(`
        id, signal_id, title, client_id, status, opened_at,
        signals!signal_id!inner ( category, entity_tags, severity ),
        clients!inner ( high_value_assets, monitoring_keywords )
      `)
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

    // 2. For each, run the eligibility pipeline:
    //    a. Category filter — non-actionable categories skip unless an
    //       entity_tag overlaps a client asset (named asset in flood
    //       zone IS actionable; generic tornado warning is not).
    //    b. Min-agent threshold (≥2 distinct specialists analyzed it).
    //    c. Cooldown (72h between debates per incident).
    //    d. New-evidence gate — only fire if at least 1 specialist has
    //       analyzed the signal SINCE the last debate. Otherwise we'd
    //       re-debate the same evidence base after the cooldown lapses.
    const eligible: Array<{ incident_id: string; signal_id: string; agent_count: number; title: string }> = [];
    let skippedNonActionable = 0;

    for (const inc of openIncidents as any[]) {
      // (a) Category filter
      const sigCategory = String(inc.signals?.category ?? '').toLowerCase();
      const sevHighOrCritical = ['high', 'critical'].includes(String(inc.signals?.severity ?? '').toLowerCase());
      if (NON_ACTIONABLE_CATEGORIES.has(sigCategory) && !sevHighOrCritical) {
        const tags: string[] = Array.isArray(inc.signals?.entity_tags) ? inc.signals.entity_tags : [];
        const clientAssets: string[] = [
          ...(Array.isArray(inc.clients?.high_value_assets) ? inc.clients.high_value_assets : []),
          ...(Array.isArray(inc.clients?.monitoring_keywords) ? inc.clients.monitoring_keywords : []),
        ].filter((s: any) => typeof s === 'string' && s.length >= 4).map((s: string) => s.toLowerCase());
        const tagText = tags.map((t) => String(t).toLowerCase()).join(' | ');
        const assetHit = clientAssets.some((a) => a && tagText.includes(a));
        if (!assetHit) {
          skippedNonActionable++;
          continue;
        }
      }

      // (b) Count distinct agents that have analyzed this incident's signal.
      const { data: analyses } = await supabase
        .from('signal_agent_analyses')
        .select('agent_call_sign, created_at')
        .eq('signal_id', inc.signal_id)
        .gte('created_at', lookbackIso)
        .order('created_at', { ascending: false });
      const distinctAgents = new Set((analyses || []).map((a: any) => a.agent_call_sign).filter(Boolean));
      if (distinctAgents.size < MIN_DISTINCT_AGENTS) continue;

      // (c) Cooldown + (d) new-evidence gate combined: if a recent
      // debate exists, skip unless an analysis has landed since it.
      const { data: recentDebate } = await supabase
        .from('agent_debate_records')
        .select('id, created_at')
        .eq('incident_id', inc.id)
        .gte('created_at', cooldownIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentDebate) continue;

      // Even outside the cooldown window, if the *most recent* debate
      // is post the most-recent analysis, there's no new evidence to
      // re-adjudicate — skip.
      const { data: anyPriorDebate } = await supabase
        .from('agent_debate_records')
        .select('created_at')
        .eq('incident_id', inc.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (anyPriorDebate?.created_at && analyses && analyses.length > 0) {
        const lastAnalysis = analyses[0].created_at as string;
        if (new Date(lastAnalysis).getTime() <= new Date(anyPriorDebate.created_at).getTime()) {
          continue;
        }
      }

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
      skipped_non_actionable: skippedNonActionable,
    });

    return successResponse({
      success: true,
      eligible: eligible.length,
      debates_fired: firedCount,
      open_incidents_scanned: openIncidents.length,
      skipped_non_actionable: skippedNonActionable,
      results,
    });
  } catch (e: any) {
    console.error('[auto-trigger-debates] Fatal:', e);
    await failHeartbeat(supabase, hb, e instanceof Error ? e : new Error(String(e)));
    return errorResponse(e?.message || 'auto-trigger failed', 500);
  }
});
