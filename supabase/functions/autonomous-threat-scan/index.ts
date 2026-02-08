/**
 * Autonomous Threat Scan Agent (Tier 3)
 * 
 * Proactively scans for emerging threats, pattern shifts, and anomalies
 * without human prompting. Designed to run on a schedule (cron).
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const dateContext = getCriticalDateContext();
    console.log(`[AutoScan] Starting autonomous threat sweep at ${dateContext.currentDateTimeLocal}`);

    // Fetch signals from last 48h
    const cutoff48h = new Date(Date.now() - 48 * 3600000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const cutoff30d = new Date(Date.now() - 30 * 86400000).toISOString();

    const [
      { data: recentSignals },
      { data: weekSignals },
      { data: monthSignals },
      { data: recentIncidents },
      { data: openIncidents },
    ] = await Promise.all([
      supabase.from('signals').select('id, category, severity, location, entity_tags, normalized_text, created_at, confidence')
        .gte('created_at', cutoff48h).order('created_at', { ascending: false }).limit(200),
      supabase.from('signals').select('id, category, severity, created_at')
        .gte('created_at', cutoff7d).limit(1000),
      supabase.from('signals').select('id, category, severity, created_at')
        .gte('created_at', cutoff30d).limit(2000),
      supabase.from('incidents').select('id, priority, status, opened_at')
        .gte('opened_at', cutoff48h).limit(50),
      supabase.from('incidents').select('id, priority, status, opened_at')
        .eq('status', 'open').limit(100),
    ]);

    // Compute anomaly metrics
    const categoryCountsRecent: Record<string, number> = {};
    const categoryCountsWeek: Record<string, number> = {};
    const severityDistRecent: Record<string, number> = {};

    for (const s of recentSignals || []) {
      const cat = s.category || 'unknown';
      categoryCountsRecent[cat] = (categoryCountsRecent[cat] || 0) + 1;
      const sev = s.severity || 'unknown';
      severityDistRecent[sev] = (severityDistRecent[sev] || 0) + 1;
    }

    for (const s of weekSignals || []) {
      const cat = s.category || 'unknown';
      categoryCountsWeek[cat] = (categoryCountsWeek[cat] || 0) + 1;
    }

    // Detect anomalies: categories spiking vs weekly baseline
    const anomalies: any[] = [];
    for (const [cat, count48h] of Object.entries(categoryCountsRecent)) {
      const weeklyRate = (categoryCountsWeek[cat] || 0) / 7;
      const expected48h = weeklyRate * 2;
      if (expected48h > 0 && count48h > expected48h * 2) {
        anomalies.push({
          type: 'category_spike',
          category: cat,
          count_48h: count48h,
          expected_48h: Math.round(expected48h),
          spike_factor: Math.round((count48h / expected48h) * 100) / 100,
        });
      }
    }

    // Detect entity clustering: same entity appearing in 3+ signals within 48h
    const entityCounts: Record<string, string[]> = {};
    for (const s of recentSignals || []) {
      for (const entity of s.entity_tags || []) {
        if (!entityCounts[entity]) entityCounts[entity] = [];
        entityCounts[entity].push(s.id);
      }
    }
    const entityClusters = Object.entries(entityCounts)
      .filter(([_, ids]) => ids.length >= 3)
      .map(([entity, ids]) => ({ entity, signal_count: ids.length, signal_ids: ids }));

    // Build scan summary for AI synthesis
    const scanData = {
      period: '48 hours',
      total_signals_48h: (recentSignals || []).length,
      total_signals_7d: (weekSignals || []).length,
      total_signals_30d: (monthSignals || []).length,
      new_incidents_48h: (recentIncidents || []).length,
      open_incidents: (openIncidents || []).length,
      category_distribution: categoryCountsRecent,
      severity_distribution: severityDistRecent,
      anomalies,
      entity_clusters: entityClusters.slice(0, 10),
    };

    // AI synthesis
    let aiFindings = '';
    const riskScore = Math.min(100,
      anomalies.length * 15 +
      entityClusters.length * 10 +
      (recentIncidents || []).length * 5 +
      ((severityDistRecent['critical'] || 0) + (severityDistRecent['high'] || 0)) * 8
    );

    try {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content: `You are an autonomous threat monitoring agent. Analyze the scan data and produce a concise threat assessment (200 words max). Focus on: 1) Most concerning anomaly, 2) Entity clustering significance, 3) Overall threat posture, 4) Recommended immediate actions. Use measured, non-alarmist language. Current date: ${dateContext.currentDateISO}.`,
            },
            { role: 'user', content: JSON.stringify(scanData, null, 2) },
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      });

      if (aiResponse.ok) {
        const data = await aiResponse.json();
        aiFindings = data.choices?.[0]?.message?.content || '';
      }
    } catch (err) {
      console.error('[AutoScan] AI synthesis error:', err);
    }

    // Store scan results
    await supabase.from('autonomous_scan_results').insert({
      scan_type: 'threat_sweep',
      agent_call_sign: 'AUTO-SENTINEL',
      findings: {
        scan_data: scanData,
        ai_findings: aiFindings,
        anomalies,
        entity_clusters: entityClusters.slice(0, 10),
      },
      risk_score: riskScore,
      signals_analyzed: (recentSignals || []).length,
      alerts_generated: anomalies.length + entityClusters.length,
    });

    console.log(`[AutoScan] Complete. Risk: ${riskScore}/100, Anomalies: ${anomalies.length}, Clusters: ${entityClusters.length}`);

    return successResponse({
      success: true,
      risk_score: riskScore,
      signals_analyzed: (recentSignals || []).length,
      anomalies_detected: anomalies.length,
      entity_clusters: entityClusters.length,
      ai_findings: aiFindings,
      scan_data: scanData,
      scanned_at: dateContext.currentDateTimeISO,
    });
  } catch (error) {
    console.error('[AutoScan] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
