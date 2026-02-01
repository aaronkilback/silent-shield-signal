import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SentimentMetrics {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
}

interface DriftAnalysis {
  trend: "improving" | "stable" | "declining";
  momentum: number; // -1 to 1
  key_drivers: string[];
}

function calculateSentimentMetrics(content: any[]): SentimentMetrics {
  const total = content.length;
  if (total === 0) {
    return { positive: 0, neutral: 0, negative: 0, total: 0 };
  }

  const positive = content.filter((c) => c.sentiment === "positive").length;
  const negative = content.filter((c) => c.sentiment === "negative").length;
  const neutral = total - positive - negative;

  return {
    positive: Math.round((positive / total) * 100),
    neutral: Math.round((neutral / total) * 100),
    negative: Math.round((negative / total) * 100),
    total,
  };
}

function calculateDrift(
  currentWindow: SentimentMetrics,
  previousWindow: SentimentMetrics,
  keyContent: any[]
): DriftAnalysis {
  if (previousWindow.total === 0 || currentWindow.total === 0) {
    return { trend: "stable", momentum: 0, key_drivers: [] };
  }

  // Calculate momentum: positive change is good, negative is bad
  const currentScore = currentWindow.positive - currentWindow.negative;
  const previousScore = previousWindow.positive - previousWindow.negative;
  const momentum = (currentScore - previousScore) / 100;

  let trend: "improving" | "stable" | "declining" = "stable";
  if (momentum > 0.1) trend = "improving";
  else if (momentum < -0.1) trend = "declining";

  // Identify key drivers from negative content
  const keyDrivers = keyContent
    .filter((c) => c.sentiment === "negative")
    .slice(0, 3)
    .map((c) => c.title || c.source || "Unknown source");

  return { trend, momentum: Math.round(momentum * 100) / 100, key_drivers: keyDrivers };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { entity_id, time_windows } = await req.json();

    if (!entity_id) {
      return new Response(
        JSON.stringify({ error: "entity_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get entity info
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id, name, type, risk_level")
      .eq("id", entity_id)
      .single();

    if (entityError || !entity) {
      return new Response(
        JSON.stringify({ error: "Entity not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const windows = time_windows || [7, 30, 90];
    const now = new Date();

    // Get all content for the longest window
    const maxWindow = Math.max(...windows);
    const cutoffDate = new Date(now.getTime() - maxWindow * 24 * 60 * 60 * 1000);

    const { data: allContent, error: contentError } = await supabase
      .from("entity_content")
      .select("id, title, source, sentiment, published_date, relevance_score")
      .eq("entity_id", entity_id)
      .gte("published_date", cutoffDate.toISOString())
      .order("published_date", { ascending: false });

    if (contentError) {
      console.error("Content fetch error:", contentError);
    }

    const content = allContent || [];

    // Calculate current overall sentiment
    const currentSentiment = calculateSentimentMetrics(content);

    // Analyze each time window
    const driftAnalysis: Record<string, any> = {};
    const alertTriggers: any[] = [];

    for (const days of windows.sort((a: number, b: number) => a - b)) {
      const windowCutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const halfWindowCutoff = new Date(now.getTime() - (days / 2) * 24 * 60 * 60 * 1000);

      // Current half of window
      const currentHalf = content.filter(
        (c: any) => new Date(c.published_date) >= halfWindowCutoff
      );
      // Previous half of window
      const previousHalf = content.filter(
        (c: any) =>
          new Date(c.published_date) >= windowCutoff &&
          new Date(c.published_date) < halfWindowCutoff
      );

      const currentMetrics = calculateSentimentMetrics(currentHalf);
      const previousMetrics = calculateSentimentMetrics(previousHalf);
      const drift = calculateDrift(currentMetrics, previousMetrics, currentHalf);

      driftAnalysis[`${days}_day`] = drift;

      // Check for alert triggers
      if (drift.trend === "declining" && drift.momentum < -0.2) {
        alertTriggers.push({
          type: "negative_momentum",
          window: `${days}_day`,
          threshold_crossed: drift.momentum,
          severity: drift.momentum < -0.4 ? "high" : "medium",
        });
      }
    }

    // Calculate reputation risk score (0-100)
    // Based on: negative content ratio, momentum trends, and volume
    const negativeRatio = currentSentiment.negative / 100;
    const avgMomentum =
      Object.values(driftAnalysis).reduce((sum: number, d: any) => sum + (d.momentum || 0), 0) /
      windows.length;
    const volumeScore = Math.min(content.length / 50, 1); // Normalize to 0-1

    let reputationRiskScore = Math.round(
      negativeRatio * 50 + // Negative ratio contributes 50%
        Math.max(0, -avgMomentum) * 30 + // Negative momentum contributes 30%
        (1 - volumeScore) * 20 // Low volume = higher uncertainty = higher risk
    );
    reputationRiskScore = Math.max(0, Math.min(100, reputationRiskScore));

    // Get key content samples
    const keyContentSamples = content.slice(0, 10).map((c: any) => ({
      title: c.title,
      source: c.source,
      sentiment: c.sentiment,
      date: c.published_date,
      relevance: c.relevance_score,
    }));

    const response = {
      success: true,
      entity_name: entity.name,
      entity_type: entity.type,
      current_sentiment: {
        positive: currentSentiment.positive,
        neutral: currentSentiment.neutral,
        negative: currentSentiment.negative,
      },
      content_volume: currentSentiment.total,
      drift_analysis: driftAnalysis,
      alert_triggers: alertTriggers,
      key_content_samples: keyContentSamples,
      reputation_risk_score: reputationRiskScore,
      analysis_timestamp: now.toISOString(),
      windows_analyzed: windows,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sentiment drift analysis error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
