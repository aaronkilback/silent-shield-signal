import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { rule_id, feedback_data, auto_apply = false } = await req.json();

    console.log(`[optimize-rule-thresholds] Analyzing rule ${rule_id}`);

    // Fetch the rule
    const { data: rule, error: ruleError } = await supabase
      .from("escalation_rules")
      .select("*")
      .eq("id", rule_id)
      .single();

    if (ruleError || !rule) {
      throw new Error(`Rule not found: ${rule_id}`);
    }

    // Analyze feedback for signals that matched this rule
    const { data: feedbackEvents, error: feedbackError } = await supabase
      .from("feedback_events")
      .select("object_id, object_type, feedback, notes, created_at")
      .eq("object_type", "signal")
      .order("created_at", { ascending: false })
      .limit(200);

    if (feedbackError) {
      console.error("[optimize-rule-thresholds] Feedback fetch error:", feedbackError);
    }

    // Get signals that triggered this rule
    const { data: signals, error: signalsError } = await supabase
      .from("signals")
      .select("id, normalized_text, severity, confidence_score, category")
      .order("created_at", { ascending: false })
      .limit(500);

    if (signalsError) {
      console.error("[optimize-rule-thresholds] Signals fetch error:", signalsError);
    }

    // Analyze incident outcomes related to this rule
    const { data: incidents, error: incidentsError } = await supabase
      .from("incidents")
      .select(`
        id,
        priority,
        severity_level,
        incident_outcomes (
          false_positive,
          was_accurate,
          outcome_type
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (incidentsError) {
      console.error("[optimize-rule-thresholds] Incidents fetch error:", incidentsError);
    }

    // Analysis: Calculate false positive rate and accuracy
    let totalFeedback = 0;
    let negativeFeedback = 0;
    let positiveFeedback = 0;
    const feedbackBySignal = new Map();

    if (feedbackEvents) {
      for (const fb of feedbackEvents) {
        if (fb.object_type === "signal") {
          feedbackBySignal.set(fb.object_id, fb.feedback);
          totalFeedback++;
          if (fb.feedback === "irrelevant" || fb.feedback === "false_positive") {
            negativeFeedback++;
          } else if (fb.feedback === "relevant" || fb.feedback === "accurate") {
            positiveFeedback++;
          }
        }
      }
    }

    // Calculate false positive rate from incidents
    let totalIncidents = incidents?.length || 0;
    let falsePositives = 0;
    let accurateIncidents = 0;

    if (incidents) {
      for (const inc of incidents) {
        if (inc.incident_outcomes && inc.incident_outcomes.length > 0) {
          const outcome = inc.incident_outcomes[0];
          if (outcome.false_positive) falsePositives++;
          if (outcome.was_accurate) accurateIncidents++;
        }
      }
    }

    const falsePositiveRate = totalFeedback > 0 ? (negativeFeedback / totalFeedback) : 0;
    const accuracyRate = totalIncidents > 0 ? (accurateIncidents / totalIncidents) : 0;
    const incidentFPRate = totalIncidents > 0 ? (falsePositives / totalIncidents) : 0;

    // Determine optimal threshold adjustments
    let recommendedAdjustments = {
      current_conditions: rule.conditions,
      current_actions: rule.actions,
      analysis: {
        total_feedback: totalFeedback,
        negative_feedback: negativeFeedback,
        positive_feedback: positiveFeedback,
        false_positive_rate: falsePositiveRate,
        incident_accuracy_rate: accuracyRate,
        incident_fp_rate: incidentFPRate,
      },
      recommendations: [] as any[],
    };

    // Generate recommendations based on analysis
    if (falsePositiveRate > 0.3) {
      recommendedAdjustments.recommendations.push({
        type: "increase_threshold",
        reason: `High false positive rate (${(falsePositiveRate * 100).toFixed(1)}%) suggests threshold is too permissive`,
        suggested_change: "Increase confidence threshold or add more restrictive conditions",
        priority: "high",
      });
    }

    if (falsePositiveRate < 0.1 && accuracyRate > 0.8) {
      recommendedAdjustments.recommendations.push({
        type: "maintain_or_expand",
        reason: `Low false positive rate (${(falsePositiveRate * 100).toFixed(1)}%) and high accuracy (${(accuracyRate * 100).toFixed(1)}%)`,
        suggested_change: "Current thresholds are optimal, consider expanding rule coverage",
        priority: "medium",
      });
    }

    if (incidentFPRate > 0.25) {
      recommendedAdjustments.recommendations.push({
        type: "refine_escalation",
        reason: `High incident false positive rate (${(incidentFPRate * 100).toFixed(1)}%)`,
        suggested_change: "Refine escalation criteria or add human review step before incident creation",
        priority: "high",
      });
    }

    if (totalFeedback < 10 && totalIncidents < 5) {
      recommendedAdjustments.recommendations.push({
        type: "insufficient_data",
        reason: "Insufficient feedback and incident data for reliable optimization",
        suggested_change: "Monitor for at least 20 signals or 10 incidents before optimizing",
        priority: "info",
      });
    }

    // Auto-apply adjustments if requested and recommendations exist
    let appliedChanges = null;
    if (auto_apply && recommendedAdjustments.recommendations.some(r => r.priority === "high")) {
      console.log(`[optimize-rule-thresholds] Auto-applying high priority recommendations for rule ${rule_id}`);
      
      // For now, we log the intent - actual rule modification would require more sophisticated logic
      appliedChanges = {
        status: "pending_approval",
        message: "High-priority optimizations identified. Auto-apply requires manual approval for safety.",
        recommendations: recommendedAdjustments.recommendations.filter(r => r.priority === "high"),
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        rule_id,
        rule_name: rule.name,
        analysis: recommendedAdjustments,
        applied_changes: appliedChanges,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[optimize-rule-thresholds] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
