/**
 * Agent Activity Scanner
 *
 * Runs on cron every 15 minutes. Each invocation picks ONE agent
 * (the one that scanned least recently) and writes a scan result row.
 * This keeps execution well under the Edge Function timeout while
 * ensuring all agents get scanned regularly across invocations.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const dateContext = getCriticalDateContext();
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    // ── 1. Pick the agent to scan ───────────────────────────────────────────
    // If caller specifies one, use it; otherwise pick the stalest active agent
    // (excluding AUTO-SENTINEL which has its own dedicated scanner)
    let targetCallSign: string | null = body.agent_call_sign || null;

    if (!targetCallSign) {
      // Get all active agents except AUTO-SENTINEL
      const { data: agents } = await supabase
        .from('ai_agents')
        .select('id, call_sign')
        .eq('is_active', true)
        .neq('call_sign', 'AUTO-SENTINEL');

      if (!agents || agents.length === 0) {
        return successResponse({ message: 'No active agents to scan' });
      }

      // Find which one scanned least recently
      const callSigns = agents.map(a => a.call_sign);
      const { data: recentScans } = await supabase
        .from('autonomous_scan_results')
        .select('agent_call_sign, created_at')
        .in('agent_call_sign', callSigns)
        .order('created_at', { ascending: false })
        .limit(callSigns.length * 2);

      // Build map of last scan time per agent
      const lastScanMap = new Map<string, Date>();
      for (const scan of recentScans || []) {
        if (!lastScanMap.has(scan.agent_call_sign)) {
          lastScanMap.set(scan.agent_call_sign, new Date(scan.created_at));
        }
      }

      // Pick agent with oldest (or no) last scan
      let stalestAgent = agents[0].call_sign;
      let stalestTime = lastScanMap.get(stalestAgent) || new Date(0);
      for (const agent of agents) {
        const t = lastScanMap.get(agent.call_sign) || new Date(0);
        if (t < stalestTime) {
          stalestTime = t;
          stalestAgent = agent.call_sign;
        }
      }
      targetCallSign = stalestAgent;
    }

    console.log(`[AgentScanner] Scanning agent: ${targetCallSign}`);

    // ── 2. Gather data for this agent ───────────────────────────────────────
    const cutoff48h = new Date(Date.now() - 48 * 3600000).toISOString();
    const cutoff7d  = new Date(Date.now() - 7 * 86400000).toISOString();

    // Fetch agent config
    const { data: agentRow } = await supabase
      .from('ai_agents')
      .select('id, call_sign, name, description, capabilities, focus_areas, updated_at')
      .eq('call_sign', targetCallSign)
      .single();

    // Signals relevant to this agent's focus areas (keyword match)
    const focusAreas: string[] = agentRow?.focus_areas || agentRow?.capabilities || [];
    const focusKeywords = focusAreas.slice(0, 5).join(' ');

    // Get recent signals (general + try to match agent focus)
    const { data: recentSignals } = await supabase
      .from('signals')
      .select('id, category, severity, normalized_text, entity_tags, confidence, created_at')
      .gte('created_at', cutoff48h)
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: weekSignals } = await supabase
      .from('signals')
      .select('id, category, severity, created_at')
      .gte('created_at', cutoff7d)
      .limit(500);

    // Agent's own scan history
    const { data: priorScans } = await supabase
      .from('autonomous_scan_results')
      .select('risk_score, signals_analyzed, alerts_generated, created_at')
      .eq('agent_call_sign', targetCallSign)
      .order('created_at', { ascending: false })
      .limit(5);

    // Open incidents
    const { data: openIncidents } = await supabase
      .from('incidents')
      .select('id, priority, status, opened_at')
      .eq('status', 'open')
      .limit(20);

    // ── 3. Compute metrics ──────────────────────────────────────────────────
    const total48h   = (recentSignals || []).length;
    const total7d    = (weekSignals || []).length;
    const critCount  = (recentSignals || []).filter(s => s.severity === 'critical').length;
    const highCount  = (recentSignals || []).filter(s => s.severity === 'high').length;

    // Category distribution
    const catCounts: Record<string, number> = {};
    for (const s of recentSignals || []) {
      const c = s.category || 'unknown';
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    // Prior scan trend
    const priorAvgRisk = priorScans && priorScans.length > 0
      ? Math.round(priorScans.reduce((sum, s) => sum + (s.risk_score || 0), 0) / priorScans.length)
      : null;

    const riskScore = Math.min(100,
      critCount * 12 +
      highCount * 6 +
      (openIncidents || []).filter(i => i.priority === 'critical').length * 10 +
      (openIncidents || []).filter(i => i.priority === 'high').length * 5 +
      Math.min(total48h / 5, 20)
    );

    // ── 4. AI synthesis ─────────────────────────────────────────────────────
    let aiFindings = '';
    try {
      const scanContext = {
        agent: { call_sign: targetCallSign, name: agentRow?.name, focus_areas: focusAreas },
        period: '48 hours',
        total_signals_48h: total48h,
        total_signals_7d: total7d,
        open_incidents: (openIncidents || []).length,
        severity_breakdown: { critical: critCount, high: highCount },
        category_distribution: catCounts,
        prior_avg_risk_score: priorAvgRisk,
        current_risk_score: riskScore,
        top_signals: (recentSignals || []).slice(0, 5).map(s => ({
          category: s.category,
          severity: s.severity,
          entity_tags: s.entity_tags?.slice(0, 3),
          age_hours: Math.round((Date.now() - new Date(s.created_at).getTime()) / 3600000),
        })),
      };

      const aiResp = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GEMINI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          messages: [
            {
              role: 'system',
              content: `You are ${targetCallSign}, an autonomous AI security agent. Produce a brief operational status report (150 words max) covering: 1) Current threat environment relevant to your focus areas, 2) Notable signals or patterns in the last 48h, 3) Risk assessment, 4) Recommended actions. Be specific and actionable. Current date: ${dateContext.currentDateISO}.`,
            },
            { role: 'user', content: JSON.stringify(scanContext, null, 2) },
          ],
          max_tokens: 400,
          temperature: 0.3,
        }),
      });

      if (aiResp.ok) {
        const aiData = await aiResp.json();
        aiFindings = aiData.choices?.[0]?.message?.content || '';
      }
    } catch (err) {
      console.error(`[AgentScanner] AI error for ${targetCallSign}:`, err);
    }

    // ── 5. Write scan result ─────────────────────────────────────────────────
    const { error: insertError } = await supabase.from('autonomous_scan_results').insert({
      scan_type: 'agent_activity_scan',
      agent_call_sign: targetCallSign,
      findings: {
        ai_findings: aiFindings,
        focus_areas: focusAreas,
        category_distribution: catCounts,
        top_signals: (recentSignals || []).slice(0, 5).map(s => ({
          category: s.category,
          severity: s.severity,
          entity_tags: s.entity_tags?.slice(0, 3),
        })),
        open_incidents: (openIncidents || []).length,
        prior_avg_risk: priorAvgRisk,
      },
      risk_score: riskScore,
      signals_analyzed: total48h,
      alerts_generated: critCount + highCount,
    });

    if (insertError) throw insertError;

    console.log(`[AgentScanner] Done: ${targetCallSign} | risk=${riskScore} | signals=${total48h}`);

    return successResponse({
      success: true,
      agent_scanned: targetCallSign,
      risk_score: riskScore,
      signals_analyzed: total48h,
      scanned_at: dateContext.currentDateTimeISO,
    });

  } catch (error) {
    console.error('[AgentScanner] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
