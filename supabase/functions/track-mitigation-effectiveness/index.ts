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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { playbook_id, incident_id } = await req.json();

    console.log(`[track-mitigation-effectiveness] Tracking playbook ${playbook_id} for incident ${incident_id}`);

    // Fetch playbook
    const { data: playbook, error: playbookError } = await supabase
      .from("playbooks")
      .select("*")
      .eq("id", playbook_id)
      .single();

    if (playbookError || !playbook) {
      throw new Error(`Playbook not found: ${playbook_id}`);
    }

    // Fetch incident with outcome
    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .select(`
        *,
        incident_outcomes(
          outcome_type,
          false_positive,
          was_accurate,
          response_time_seconds,
          lessons_learned,
          improvement_suggestions
        )
      `)
      .eq("id", incident_id)
      .single();

    if (incidentError || !incident) {
      throw new Error(`Incident not found: ${incident_id}`);
    }

    // Fetch all incidents where this playbook was used
    const { data: historicalIncidents, error: historyError } = await supabase
      .from("incidents")
      .select(`
        id,
        priority,
        status,
        opened_at,
        resolved_at,
        incident_outcomes(false_positive, was_accurate, outcome_type, response_time_seconds)
      `)
      .or(`summary.ilike.%${playbook.key}%,timeline_json->>playbook_used.eq.${playbook.key}`)
      .limit(50);

    if (historyError) {
      console.error("[track-mitigation-effectiveness] History fetch error:", historyError);
    }

    // Calculate effectiveness metrics
    let totalUses = historicalIncidents?.length || 1;
    let successfulResolutions = 0;
    let falsePositives = 0;
    let accurateDetections = 0;
    let averageResponseTime = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    if (historicalIncidents) {
      for (const hist of historicalIncidents) {
        if (hist.status === "resolved" || hist.status === "closed") {
          successfulResolutions++;
        }
        if (hist.incident_outcomes && hist.incident_outcomes.length > 0) {
          const outcome = hist.incident_outcomes[0];
          if (outcome.false_positive) falsePositives++;
          if (outcome.was_accurate) accurateDetections++;
          if (outcome.response_time_seconds) {
            totalResponseTime += outcome.response_time_seconds;
            responseTimeCount++;
          }
        }
      }
    }

    averageResponseTime = responseTimeCount > 0 ? Math.round(totalResponseTime / responseTimeCount) : 0;
    const successRate = totalUses > 0 ? (successfulResolutions / totalUses) : 0;
    const falsePositiveRate = totalUses > 0 ? (falsePositives / totalUses) : 0;
    const accuracyRate = totalUses > 0 ? (accurateDetections / totalUses) : 0;

    // Current incident metrics
    const currentResponseTime = incident.resolved_at && incident.opened_at
      ? Math.round((new Date(incident.resolved_at).getTime() - new Date(incident.opened_at).getTime()) / 1000)
      : null;

    const currentOutcome = incident.incident_outcomes && incident.incident_outcomes.length > 0
      ? incident.incident_outcomes[0]
      : null;

    // Construct effectiveness tracking prompt
    const trackingPrompt = `You are a security operations effectiveness analyst. Evaluate the effectiveness of the playbook used for this incident and provide recommendations for optimization.

PLAYBOOK INFORMATION:
- Name: ${playbook.title}
- Key: ${playbook.key}
- Total Historical Uses: ${totalUses}

CURRENT INCIDENT:
- Incident ID: ${incident.id.substring(0, 8)}
- Status: ${incident.status}
- Priority: ${incident.priority}
- Response Time: ${currentResponseTime ? `${Math.round(currentResponseTime / 60)} minutes` : 'Not resolved'}
${currentOutcome ? `
- Outcome Type: ${currentOutcome.outcome_type}
- False Positive: ${currentOutcome.false_positive ? 'Yes' : 'No'}
- Accurate Detection: ${currentOutcome.was_accurate ? 'Yes' : 'No'}
- Lessons Learned: ${currentOutcome.lessons_learned || 'None documented'}
- Improvement Suggestions: ${currentOutcome.improvement_suggestions?.join('; ') || 'None'}
` : '- Outcome: Not yet recorded'}

HISTORICAL EFFECTIVENESS METRICS:
- Total Uses: ${totalUses}
- Successful Resolutions: ${successfulResolutions} (${(successRate * 100).toFixed(1)}% success rate)
- False Positives: ${falsePositives} (${(falsePositiveRate * 100).toFixed(1)}% FP rate)
- Accurate Detections: ${accurateDetections} (${(accuracyRate * 100).toFixed(1)}% accuracy)
- Average Response Time: ${averageResponseTime > 0 ? `${Math.round(averageResponseTime / 60)} minutes` : 'Not available'}

ANALYSIS REQUIREMENTS:

1. **EFFECTIVENESS RATING** (1-5 scale):
   - Rate the playbook's effectiveness: 5=Excellent, 4=Good, 3=Adequate, 2=Needs Improvement, 1=Ineffective
   - Justify the rating based on metrics

2. **WHAT WORKED**:
   - Which aspects of the playbook contributed to success?
   - What steps were most valuable?

3. **WHAT DIDN'T WORK**:
   - Where did the playbook fall short?
   - What steps were confusing or ineffective?
   - Gaps in guidance?

4. **COMPARISON TO BASELINE**:
   - How does this playbook compare to average incident response?
   - Is it faster/slower than manual response?
   - Does it improve consistency?

5. **SPECIFIC IMPROVEMENTS** (3-5 recommendations):
   - Add missing steps?
   - Remove unnecessary steps?
   - Clarify confusing sections?
   - Add automation opportunities?

6. **INTEGRATION WITH OTHER TOOLS**:
   - Should this playbook invoke other edge functions?
   - Should it recommend other playbooks for certain scenarios?

7. **TRAINING RECOMMENDATIONS**:
   - Does the team need training on specific aspects?
   - Are there common mistakes to address?

8. **DECISION POINT**:
   - Should this playbook continue to be used? (Continue / Modify / Deprecate)
   - If modify, what's the priority? (High / Medium / Low)

Provide actionable, specific recommendations that can be implemented to improve playbook effectiveness and incident response outcomes.`;

    // Call AI for effectiveness analysis
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a security operations effectiveness expert. Analyze playbook effectiveness using quantitative metrics and qualitative insights to provide actionable recommendations for continuous improvement."
          },
          {
            role: "user",
            content: trackingPrompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const effectivenessAnalysis = aiResult.choices[0].message.content;

    // Extract effectiveness rating
    const ratingMatch = effectivenessAnalysis.match(/Rating[:\s]+(\d)/i);
    const effectivenessRating = ratingMatch ? parseInt(ratingMatch[1]) : 3;

    return new Response(
      JSON.stringify({
        success: true,
        playbook_id,
        playbook_name: playbook.title,
        incident_id,
        effectiveness_tracking: {
          analysis: effectivenessAnalysis,
          rating: effectivenessRating,
          metrics: {
            total_uses: totalUses,
            success_rate: (successRate * 100).toFixed(1) + "%",
            false_positive_rate: (falsePositiveRate * 100).toFixed(1) + "%",
            accuracy_rate: (accuracyRate * 100).toFixed(1) + "%",
            average_response_time_minutes: Math.round(averageResponseTime / 60),
            current_response_time_minutes: currentResponseTime ? Math.round(currentResponseTime / 60) : null,
          },
          current_incident_outcome: currentOutcome,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[track-mitigation-effectiveness] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
