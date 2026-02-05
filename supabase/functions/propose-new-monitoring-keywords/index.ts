import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const { client_id, observed_trends, lookback_days = 30 } = await req.json();

    console.log(`[propose-new-monitoring-keywords] Analyzing keywords for client ${client_id}`);

    // Fetch client details
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, name, monitoring_keywords, competitor_names, high_value_assets, industry")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      throw new Error(`Client not found: ${client_id}`);
    }

    const existingKeywords = [
      ...(client.monitoring_keywords || []),
      ...(client.competitor_names || []),
      ...(client.high_value_assets || []),
    ];

    // Analyze signals from the past lookback period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookback_days);

    const { data: recentSignals, error: signalsError } = await supabase
      .from("signals")
      .select("id, normalized_text, category, severity, created_at, confidence_score")
      .eq("client_id", client_id)
      .gte("created_at", cutoffDate.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (signalsError) {
      console.error("[propose-new-monitoring-keywords] Signals fetch error:", signalsError);
    }

    // Analyze cross-client patterns to identify emerging threats
    const { data: crossClientSignals, error: crossError } = await supabase
      .from("signals")
      .select("id, normalized_text, category, severity, client_id")
      .gte("created_at", cutoffDate.toISOString())
      .in("severity", ["high", "critical"])
      .limit(300);

    if (crossError) {
      console.error("[propose-new-monitoring-keywords] Cross-client fetch error:", crossError);
    }

    // Extract keywords from signal text using simple frequency analysis
    const keywordFrequency = new Map<string, { count: number; signals: string[]; severity: string[] }>();
    
    const extractKeywords = (text: string) => {
      // Simple keyword extraction: look for capitalized words/phrases and common entities
      const words = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
      const filtered = words.filter(w => 
        w.length > 3 && 
        !["The", "This", "That", "These", "Those", "When", "Where", "Breaking"].includes(w)
      );
      return filtered;
    };

    if (recentSignals) {
      for (const signal of recentSignals) {
        const keywords = extractKeywords(signal.normalized_text || '');
        for (const kw of keywords) {
          if (!existingKeywords.some(ek => ek.toLowerCase() === kw.toLowerCase())) {
            if (!keywordFrequency.has(kw)) {
              keywordFrequency.set(kw, { count: 0, signals: [], severity: [] });
            }
            const entry = keywordFrequency.get(kw)!;
            entry.count++;
            entry.signals.push(signal.id);
            entry.severity.push(signal.severity);
          }
        }
      }
    }

    // Identify cross-client emerging keywords
    const emergingKeywords = new Map<string, { count: number; clients: Set<string>; signals: string[] }>();
    
    if (crossClientSignals) {
      for (const signal of crossClientSignals) {
        const keywords = extractKeywords(signal.normalized_text || '');
        for (const kw of keywords) {
          if (!emergingKeywords.has(kw)) {
            emergingKeywords.set(kw, { count: 0, clients: new Set(), signals: [] });
          }
          const entry = emergingKeywords.get(kw)!;
          entry.count++;
          entry.clients.add(signal.client_id);
          entry.signals.push(signal.id);
        }
      }
    }

    // Generate keyword proposals
    const proposals = [];

    // Sort by frequency and relevance
    const sortedKeywords = Array.from(keywordFrequency.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    for (const [keyword, data] of sortedKeywords) {
      const highSeverityCount = data.severity.filter(s => s === "high" || s === "critical").length;
      const relevanceScore = (data.count * 0.5) + (highSeverityCount * 0.5);

      if (data.count >= 3 || highSeverityCount >= 2) {
        proposals.push({
          keyword,
          type: "client_specific",
          frequency: data.count,
          high_severity_count: highSeverityCount,
          relevance_score: relevanceScore,
          example_signals: data.signals.slice(0, 3),
          reason: `Appeared in ${data.count} signals (${highSeverityCount} high/critical) in past ${lookback_days} days`,
          confidence: relevanceScore > 5 ? "high" : relevanceScore > 3 ? "medium" : "low",
        });
      }
    }

    // Add emerging cross-client keywords
    const sortedEmerging = Array.from(emergingKeywords.entries())
      .filter(([_kw, data]) => data.clients.size >= 2 && data.count >= 5)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    for (const [keyword, data] of sortedEmerging) {
      proposals.push({
        keyword,
        type: "emerging_threat",
        frequency: data.count,
        clients_affected: data.clients.size,
        example_signals: data.signals.slice(0, 3),
        reason: `Emerging pattern: ${data.count} signals across ${data.clients.size} clients`,
        confidence: data.clients.size >= 3 ? "high" : "medium",
      });
    }

    // If observed_trends provided, add AI-suggested keywords
    if (observed_trends) {
      proposals.push({
        keyword: observed_trends,
        type: "ai_suggested",
        reason: "Based on observed threat patterns and analyst input",
        confidence: "medium",
      });
    }

    return successResponse({
      success: true,
      client_id,
      client_name: client.name,
      existing_keywords: existingKeywords,
      proposals,
      analysis_period_days: lookback_days,
      signals_analyzed: recentSignals?.length || 0,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[propose-new-monitoring-keywords] Error:", error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
