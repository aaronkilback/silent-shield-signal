import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * Predictive Threat Forecasting Engine
 * 
 * Analyzes historical signal/incident patterns to forecast emerging threats.
 * Uses frequency acceleration, geographic clustering, category correlations,
 * and AI synthesis to generate actionable predictions.
 */

interface TimeWindow {
  label: string;
  days: number;
}

const TIME_WINDOWS: TimeWindow[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function calculateMomentum(recent: number, older: number): number {
  if (older === 0) return recent > 0 ? 1 : 0;
  return (recent - older) / older;
}

function classifyTrend(momentum: number): string {
  if (momentum > 0.5) return 'surging';
  if (momentum > 0.15) return 'accelerating';
  if (momentum > -0.15) return 'stable';
  if (momentum > -0.5) return 'declining';
  return 'collapsing';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { userId, error: authError } = await getUserFromRequest(req);
    if (!userId) {
      return errorResponse(authError || 'Authentication required', 401);
    }

    const { client_id, categories, locations, days_back } = await req.json();
    const supabase = createServiceClient();
    const lookbackDays = days_back || 90;
    const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();

    // ── 1. Fetch historical signals ──────────────────────────────────
    let signalQuery = supabase
      .from('signals')
      .select('id, category, severity, location, entity_tags, created_at, normalized_text, event_date')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (client_id) signalQuery = signalQuery.eq('client_id', client_id);

    const { data: signals, error: sigErr } = await signalQuery;
    if (sigErr) throw new Error(`Signal query failed: ${sigErr.message}`);

    // ── 2. Fetch historical incidents ────────────────────────────────
    let incidentQuery = supabase
      .from('incidents')
      .select('id, priority, status, opened_at, closed_at, client_id')
      .gte('opened_at', cutoff)
      .order('opened_at', { ascending: false })
      .limit(500);

    if (client_id) incidentQuery = incidentQuery.eq('client_id', client_id);

    const { data: incidents, error: incErr } = await incidentQuery;
    if (incErr) throw new Error(`Incident query failed: ${incErr.message}`);

    // ── 3. Compute category frequency patterns ───────────────────────
    const now = Date.now();
    const categoryPatterns: Record<string, { recent: number; older: number; total: number; highSev: number }> = {};

    for (const sig of signals || []) {
      const cat = sig.category || 'uncategorized';
      if (categories && categories.length > 0 && !categories.includes(cat)) continue;

      if (!categoryPatterns[cat]) categoryPatterns[cat] = { recent: 0, older: 0, total: 0, highSev: 0 };
      categoryPatterns[cat].total++;

      const age = (now - new Date(sig.created_at).getTime()) / 86400000;
      if (age <= 14) {
        categoryPatterns[cat].recent++;
      } else {
        categoryPatterns[cat].older++;
      }

      if (['critical', 'high', 'p1', 'p2'].includes(sig.severity?.toLowerCase() || '')) {
        categoryPatterns[cat].highSev++;
      }
    }

    // ── 4. Compute geographic clustering ─────────────────────────────
    const locationPatterns: Record<string, { count: number; recentCount: number; categories: Set<string> }> = {};

    for (const sig of signals || []) {
      const loc = sig.location || 'unknown';
      if (locations && locations.length > 0 && !locations.some((l: string) => loc.toLowerCase().includes(l.toLowerCase()))) continue;

      if (!locationPatterns[loc]) locationPatterns[loc] = { count: 0, recentCount: 0, categories: new Set() };
      locationPatterns[loc].count++;
      locationPatterns[loc].categories.add(sig.category || 'uncategorized');

      const age = (now - new Date(sig.created_at).getTime()) / 86400000;
      if (age <= 14) locationPatterns[loc].recentCount++;
    }

    // ── 5. Build forecast items ──────────────────────────────────────
    const forecasts: any[] = [];

    // Category-based forecasts
    for (const [cat, data] of Object.entries(categoryPatterns)) {
      const normalizedOlder = data.older > 0 ? (data.older / (lookbackDays - 14)) * 14 : 0;
      const momentum = calculateMomentum(data.recent, normalizedOlder);
      const trend = classifyTrend(momentum);

      if (trend === 'surging' || trend === 'accelerating' || data.highSev > 2) {
        const sevRatio = data.total > 0 ? data.highSev / data.total : 0;
        const riskScore = Math.min(100, Math.round(
          (momentum > 0 ? momentum * 40 : 0) +
          (sevRatio * 35) +
          (data.recent > 5 ? 25 : data.recent * 5)
        ));

        forecasts.push({
          type: 'category_acceleration',
          category: cat,
          trend,
          momentum: Math.round(momentum * 100) / 100,
          risk_score: riskScore,
          signals_14d: data.recent,
          signals_total: data.total,
          high_severity_count: data.highSev,
          escalation_probability: Math.min(95, Math.round(riskScore * 0.85)),
        });
      }
    }

    // Location-based forecasts
    for (const [loc, data] of Object.entries(locationPatterns)) {
      if (loc === 'unknown') continue;
      const categoryCount = data.categories.size;
      if (data.recentCount >= 3 || categoryCount >= 3) {
        forecasts.push({
          type: 'geographic_hotspot',
          location: loc,
          signal_count: data.count,
          recent_count: data.recentCount,
          category_diversity: categoryCount,
          categories: Array.from(data.categories),
          risk_score: Math.min(100, Math.round(data.recentCount * 12 + categoryCount * 8)),
        });
      }
    }

    // Incident escalation pattern
    const recentIncidents = (incidents || []).filter(i => {
      const age = (now - new Date(i.opened_at).getTime()) / 86400000;
      return age <= 14;
    });
    const olderIncidents = (incidents || []).filter(i => {
      const age = (now - new Date(i.opened_at).getTime()) / 86400000;
      return age > 14;
    });

    const incidentMomentum = calculateMomentum(
      recentIncidents.length,
      olderIncidents.length > 0 ? (olderIncidents.length / (lookbackDays - 14)) * 14 : 0
    );

    if (incidentMomentum > 0.15 || recentIncidents.length >= 3) {
      const p1p2 = recentIncidents.filter(i => ['p1', 'p2'].includes(i.priority || '')).length;
      forecasts.push({
        type: 'incident_escalation_trend',
        trend: classifyTrend(incidentMomentum),
        momentum: Math.round(incidentMomentum * 100) / 100,
        incidents_14d: recentIncidents.length,
        incidents_total: (incidents || []).length,
        critical_incidents_14d: p1p2,
        risk_score: Math.min(100, Math.round(
          (incidentMomentum > 0 ? incidentMomentum * 30 : 0) +
          (p1p2 * 20) +
          (recentIncidents.length * 8)
        )),
      });
    }

    // Sort by risk score descending
    forecasts.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));

    // ── 6. AI synthesis of top forecasts ─────────────────────────────
    let ai_summary: string | null = null;

    if (forecasts.length > 0) {
      const topForecasts = forecasts.slice(0, 8);
      const forecastText = topForecasts.map((f, i) => {
        if (f.type === 'category_acceleration') {
          return `${i + 1}. CATEGORY "${f.category}" — ${f.trend} (momentum ${f.momentum}), ${f.signals_14d} signals in 14d, ${f.high_severity_count} high-severity. Risk: ${f.risk_score}/100.`;
        }
        if (f.type === 'geographic_hotspot') {
          return `${i + 1}. LOCATION "${f.location}" — ${f.recent_count} recent signals across ${f.category_diversity} categories (${f.categories.join(', ')}). Risk: ${f.risk_score}/100.`;
        }
        if (f.type === 'incident_escalation_trend') {
          return `${i + 1}. INCIDENT TREND — ${f.trend} (momentum ${f.momentum}), ${f.incidents_14d} incidents in 14d, ${f.critical_incidents_14d} critical. Risk: ${f.risk_score}/100.`;
        }
        return `${i + 1}. ${JSON.stringify(f)}`;
      }).join('\n');

      const aiResult = await callAiGateway({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `You are a senior intelligence analyst producing a predictive threat forecast. Synthesize the data into a concise executive briefing (150 words max). Identify the most likely threat to materialize within 48 hours. Use measured, authoritative language. No speculation beyond what the data supports. Structure: 1) Primary forecast, 2) Secondary concerns, 3) Recommended posture.`,
          },
          {
            role: 'user',
            content: `Forecast data from the last ${lookbackDays} days:\n${forecastText}`,
          },
        ],
        functionName: 'predictive-forecast',
      });

      ai_summary = aiResult.content || (aiResult.error ? `Forecast synthesis unavailable: ${aiResult.error}` : null);
    }

    return successResponse({
      lookback_days: lookbackDays,
      total_signals_analyzed: (signals || []).length,
      total_incidents_analyzed: (incidents || []).length,
      forecasts,
      ai_summary,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in predictive-forecast:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
