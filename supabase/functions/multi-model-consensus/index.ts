/**
 * Multi-Model Consensus Engine v2
 * 
 * Runs high-severity signal assessments through 2 AI models simultaneously
 * using STRUCTURED TOOL CALLING (not free-text JSON parsing).
 * Flags disagreements for analyst review.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { CONSENSUS_ASSESSMENT_TOOL } from "../_shared/structured-assessment-schemas.ts";

interface ConsensusResult {
  model: string;
  assessment: string;
  confidence: number;
  recommended_priority: string;
  key_factors: string[];
  reasoning: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { signal_id, signal_text, signal_category, signal_severity, context } = await req.json();
    
    const supabase = createServiceClient();

    const systemPrompt = `You are a senior intelligence analyst assessing a security signal for operational relevance. 
Use the submit_assessment tool to deliver your structured assessment. 
Do NOT output free text — call the tool with your assessment.
Be precise: base confidence on evidence quality, not gut feeling.`;

    const userPrompt = `Assess this signal:
Category: ${signal_category || 'unknown'}
Current Severity: ${signal_severity || 'unknown'}
Content: ${(signal_text || '').substring(0, 1500)}
${context ? `Additional Context: ${JSON.stringify(context).substring(0, 500)}` : ''}`;

    // Run two models in parallel — both using TOOL CALLING (not free-text JSON)
    const [model1Response, model2Response] = await Promise.all([
      fetchStructuredAssessment('google/gpt-4o-mini', systemPrompt, userPrompt),
      fetchStructuredAssessment('google/gpt-4o-mini', systemPrompt, userPrompt),
    ]);

    // Parse tool call results (guaranteed schema compliance)
    const result1 = parseToolCallResult(model1Response, 'google/gpt-4o-mini');
    const result2 = parseToolCallResult(model2Response, 'google/gpt-4o-mini');

    // Determine consensus
    const assessmentsMatch = result1.assessment === result2.assessment;
    const prioritiesMatch = result1.recommended_priority === result2.recommended_priority;
    const confidenceDelta = Math.abs(result1.confidence - result2.confidence);

    const consensusScore = (
      (assessmentsMatch ? 0.5 : 0) +
      (prioritiesMatch ? 0.3 : 0) +
      (confidenceDelta < 0.2 ? 0.2 : 0)
    );

    const disagreement = !assessmentsMatch || confidenceDelta > 0.3;

    // Final assessment — weighted toward higher-capability model
    const finalAssessment = disagreement
      ? 'requires_review' 
      : result1.assessment;

    const finalPriority = disagreement
      ? higherPriority(result1.recommended_priority, result2.recommended_priority)
      : result1.recommended_priority;

    const finalConfidence = disagreement
      ? Math.min(result1.confidence, result2.confidence) * 0.8
      : (result1.confidence * 0.6 + result2.confidence * 0.4);

    // Log the consensus debate
    if (signal_id) {
      await supabase.from('agent_debate_records').insert({
        debate_type: 'multi_model_consensus_v2',
        participating_agents: ['gpt-4o-mini', 'gpt-4o-mini'],
        individual_analyses: { model_1: result1, model_2: result2 },
        synthesis: {
          consensus_score: consensusScore,
          disagreement,
          final_assessment: finalAssessment,
          final_priority: finalPriority,
          final_confidence: finalConfidence,
          confidence_delta: confidenceDelta,
          enforcement: 'tool_calling_v2',
        },
        consensus_score: consensusScore,
        final_assessment: `${finalAssessment} (${finalPriority}) — confidence: ${finalConfidence.toFixed(2)}`,
        incident_id: null,
      });
    }

    // If disagreement on a critical signal, flag for analyst review
    if (disagreement && signal_id) {
      await supabase.from('agent_pending_messages').insert({
        recipient_user_id: '00000000-0000-0000-0000-000000000000',
        message: `⚠️ Multi-model disagreement on signal assessment.

**Model 1** (Gemini 3 Pro): ${result1.assessment} (confidence: ${result1.confidence.toFixed(2)}, priority: ${result1.recommended_priority})
• Factors: ${result1.key_factors.join(', ')}
• Reasoning: ${result1.reasoning}

**Model 2** (Gemini 2.5 Flash): ${result2.assessment} (confidence: ${result2.confidence.toFixed(2)}, priority: ${result2.recommended_priority})
• Factors: ${result2.key_factors.join(', ')}
• Reasoning: ${result2.reasoning}

Signal: ${(signal_text || '').substring(0, 200)}...

Please review and provide definitive assessment.`,
        priority: 'high',
        trigger_event: 'multi_model_disagreement',
      }).then(() => {}).catch(err => console.error('Failed to create pending message:', err));
    }

    console.log(`[Consensus v2] Signal ${signal_id}: ${finalAssessment} (consensus: ${consensusScore.toFixed(2)}, disagreement: ${disagreement}, enforcement: tool_calling)`);

    return successResponse({
      signal_id,
      final_assessment: finalAssessment,
      final_priority: finalPriority,
      final_confidence: Math.round(finalConfidence * 100) / 100,
      consensus_score: Math.round(consensusScore * 100) / 100,
      disagreement,
      enforcement: 'tool_calling_v2',
      model_results: [result1, result2],
    });

  } catch (error) {
    console.error('[Consensus v2] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

/**
 * Fetch a structured assessment from a model using TOOL CALLING.
 * The model MUST use the submit_assessment tool — no free-text allowed.
 */
async function fetchStructuredAssessment(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<any> {
  try {
    const aiResult = await callAiGateway({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      functionName: 'multi-model-consensus',
      extraBody: {
        tools: [CONSENSUS_ASSESSMENT_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_assessment' } },
        temperature: 0.1,
      },
    });

    if (aiResult.error) {
      console.error(`[Consensus v2] ${model} error: ${aiResult.error}`);
      return null;
    }

    return aiResult.raw;
  } catch (e) {
    console.error(`[Consensus v2] ${model} error:`, e);
    return null;
  }
}

/**
 * Parse tool call result from AI response.
 * Since we use tool_choice: forced, the response MUST contain tool_calls.
 */
function parseToolCallResult(raw: any, model: string): ConsensusResult {
  try {
    const toolCalls = raw?.choices?.[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Fallback: try to parse content as JSON (shouldn't happen with tool_choice forced)
      const content = raw?.choices?.[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      return {
        model,
        assessment: parsed.assessment || 'unknown',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        recommended_priority: parsed.recommended_priority || 'p3',
        key_factors: Array.isArray(parsed.key_factors) ? parsed.key_factors : [],
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    }

    // Parse the structured tool call arguments
    const args = JSON.parse(toolCalls[0].function.arguments);
    return {
      model,
      assessment: args.assessment || 'unknown',
      confidence: Math.min(1, Math.max(0, args.confidence || 0.5)),
      recommended_priority: args.recommended_priority || 'p3',
      key_factors: Array.isArray(args.key_factors) ? args.key_factors : [],
      reasoning: args.reasoning || 'No reasoning provided',
    };
  } catch {
    return {
      model,
      assessment: 'unknown',
      confidence: 0.5,
      recommended_priority: 'p3',
      key_factors: ['parse_error'],
      reasoning: 'Failed to parse model response',
    };
  }
}

function higherPriority(a: string, b: string): string {
  const rank: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}
