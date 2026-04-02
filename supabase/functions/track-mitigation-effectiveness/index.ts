import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { playbook_id, incident_id } = await req.json();

    console.log(`[track-mitigation-effectiveness] Tracking playbook ${playbook_id} for incident ${incident_id}`);

    const supabase = createServiceClient();

    // Fetch playbook
    const { data: playbook, error: playbookError } = await supabase
      .from('playbooks')
      .select('*')
      .eq('id', playbook_id)
      .single();

    if (playbookError || !playbook) {
      return errorResponse(`Playbook not found: ${playbook_id}`, 404);
    }

    // Fetch incident with outcome
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .select(`
        *,
        incident_outcomes(
          outcome_type, false_positive, was_accurate, response_time_seconds,
          lessons_learned, improvement_suggestions
        )
      `)
      .eq('id', incident_id)
      .single();

    if (incidentError || !incident) {
      return errorResponse(`Incident not found: ${incident_id}`, 404);
    }

    // Fetch historical incidents
    const { data: historicalIncidents, error: historyError } = await supabase
      .from('incidents')
      .select(`
        id, priority, status, opened_at, resolved_at,
        incident_outcomes(false_positive, was_accurate, outcome_type, response_time_seconds)
      `)
      .or(`summary.ilike.%${playbook.key}%,timeline_json->>playbook_used.eq.${playbook.key}`)
      .limit(50);

    if (historyError) {
      console.error('[track-mitigation-effectiveness] History fetch error:', historyError);
    }

    // Calculate effectiveness metrics
    let totalUses = historicalIncidents?.length || 1;
    let successfulResolutions = 0;
    let falsePositives = 0;
    let accurateDetections = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    if (historicalIncidents) {
      for (const hist of historicalIncidents) {
        if (hist.status === 'resolved' || hist.status === 'closed') successfulResolutions++;
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

    const averageResponseTime = responseTimeCount > 0 ? Math.round(totalResponseTime / responseTimeCount) : 0;
    const successRate = totalUses > 0 ? (successfulResolutions / totalUses) : 0;
    const falsePositiveRate = totalUses > 0 ? (falsePositives / totalUses) : 0;
    const accuracyRate = totalUses > 0 ? (accurateDetections / totalUses) : 0;

    const currentResponseTime = incident.resolved_at && incident.opened_at
      ? Math.round((new Date(incident.resolved_at).getTime() - new Date(incident.opened_at).getTime()) / 1000)
      : null;

    const currentOutcome = incident.incident_outcomes?.length > 0 ? incident.incident_outcomes[0] : null;

    const trackingPrompt = `You are a security operations effectiveness analyst. Evaluate the effectiveness of the playbook used for this incident and provide recommendations for optimization.

PLAYBOOK: ${playbook.title} (Key: ${playbook.key}), Total Uses: ${totalUses}

CURRENT INCIDENT: ${incident.id.substring(0, 8)}, Status: ${incident.status}, Priority: ${incident.priority}
Response Time: ${currentResponseTime ? `${Math.round(currentResponseTime / 60)} minutes` : 'Not resolved'}
${currentOutcome ? `Outcome: ${currentOutcome.outcome_type}, FP: ${currentOutcome.false_positive}, Accurate: ${currentOutcome.was_accurate}` : 'Outcome: Not yet recorded'}

HISTORICAL METRICS:
- Success Rate: ${(successRate * 100).toFixed(1)}%, FP Rate: ${(falsePositiveRate * 100).toFixed(1)}%, Accuracy: ${(accuracyRate * 100).toFixed(1)}%
- Avg Response Time: ${averageResponseTime > 0 ? `${Math.round(averageResponseTime / 60)} minutes` : 'N/A'}

Provide: Effectiveness Rating (1-5), What Worked, What Didn't, Comparison to Baseline, Specific Improvements, Integration Recommendations, Training Recommendations, Decision Point (Continue/Modify/Deprecate).`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a security operations effectiveness expert. Analyze playbook effectiveness using quantitative metrics and qualitative insights.' },
        { role: 'user', content: trackingPrompt }
      ],
      functionName: 'track-mitigation-effectiveness',
      dlqOnFailure: true,
      dlqPayload: { playbook_id, incident_id },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    const effectivenessAnalysis = aiResult.content || '';
    const ratingMatch = effectivenessAnalysis.match(/Rating[:\s]+(\d)/i);
    const effectivenessRating = ratingMatch ? parseInt(ratingMatch[1]) : 3;

    return successResponse({
      playbook_id,
      playbook_name: playbook.title,
      incident_id,
      effectiveness_tracking: {
        analysis: effectivenessAnalysis,
        rating: effectivenessRating,
        metrics: {
          total_uses: totalUses,
          success_rate: (successRate * 100).toFixed(1) + '%',
          false_positive_rate: (falsePositiveRate * 100).toFixed(1) + '%',
          accuracy_rate: (accuracyRate * 100).toFixed(1) + '%',
          average_response_time_minutes: Math.round(averageResponseTime / 60),
          current_response_time_minutes: currentResponseTime ? Math.round(currentResponseTime / 60) : null,
        },
        current_incident_outcome: currentOutcome,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[track-mitigation-effectiveness] Error:', error);
    await logError(error, { functionName: 'track-mitigation-effectiveness', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});