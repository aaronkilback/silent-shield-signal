/**
 * Multi-Model Consensus Engine
 * 
 * Runs high-severity signal assessments through 2 AI models simultaneously.
 * Flags disagreements for analyst review. Used for critical decisions
 * where single-model hallucination risk is unacceptable.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface ConsensusResult {
  model: string;
  assessment: string;
  confidence: number;
  recommended_priority: string;
  key_factors: string[];
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { signal_id, signal_text, signal_category, signal_severity, context } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');
    
    const supabase = createServiceClient();

    const systemPrompt = `You are a senior intelligence analyst assessing a security signal for operational relevance. Respond ONLY with valid JSON matching this schema:
{
  "assessment": "relevant|irrelevant|requires_investigation",
  "confidence": 0.0-1.0,
  "recommended_priority": "p1|p2|p3|p4",
  "key_factors": ["factor1", "factor2", "factor3"],
  "reasoning": "Brief explanation (max 50 words)"
}`;

    const userPrompt = `Assess this signal:
Category: ${signal_category || 'unknown'}
Current Severity: ${signal_severity || 'unknown'}
Content: ${(signal_text || '').substring(0, 1500)}
${context ? `Additional Context: ${JSON.stringify(context).substring(0, 500)}` : ''}`;

    // Run two models in parallel
    const [model1Response, model2Response] = await Promise.all([
      fetchModelAssessment(LOVABLE_API_KEY, 'google/gemini-3-pro-preview', systemPrompt, userPrompt),
      fetchModelAssessment(LOVABLE_API_KEY, 'google/gemini-2.5-flash', systemPrompt, userPrompt),
    ]);

    // Parse results
    const result1 = parseAssessment(model1Response, 'google/gemini-3-pro-preview');
    const result2 = parseAssessment(model2Response, 'google/gemini-2.5-flash');

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

    // Determine final assessment (weighted toward higher-capability model)
    const finalAssessment = disagreement
      ? 'requires_review' 
      : result1.assessment; // Gemini 3 Pro takes precedence

    const finalPriority = disagreement
      ? higherPriority(result1.recommended_priority, result2.recommended_priority)
      : result1.recommended_priority;

    const finalConfidence = disagreement
      ? Math.min(result1.confidence, result2.confidence) * 0.8
      : (result1.confidence * 0.6 + result2.confidence * 0.4);

    // Log the consensus debate
    if (signal_id) {
      await supabase.from('agent_debate_records').insert({
        debate_type: 'multi_model_consensus',
        participating_agents: ['gemini-3-pro', 'gemini-2.5-flash'],
        individual_analyses: { model_1: result1, model_2: result2 },
        synthesis: {
          consensus_score: consensusScore,
          disagreement,
          final_assessment: finalAssessment,
          final_priority: finalPriority,
          final_confidence: finalConfidence,
          confidence_delta: confidenceDelta,
        },
        consensus_score: consensusScore,
        final_assessment: `${finalAssessment} (${finalPriority}) — confidence: ${finalConfidence.toFixed(2)}`,
        incident_id: null,
      });
    }

    // If disagreement on a critical signal, flag for analyst review
    if (disagreement && signal_id) {
      await supabase.from('agent_pending_messages').insert({
        recipient_user_id: '00000000-0000-0000-0000-000000000000', // Will be routed by system
        message: `⚠️ Multi-model disagreement on signal assessment.\n\nModel 1 (Gemini 3 Pro): ${result1.assessment} (confidence: ${result1.confidence.toFixed(2)})\nModel 2 (Gemini 2.5 Flash): ${result2.assessment} (confidence: ${result2.confidence.toFixed(2)})\n\nSignal: ${(signal_text || '').substring(0, 200)}...\n\nPlease review and provide definitive assessment.`,
        priority: 'high',
        trigger_event: 'multi_model_disagreement',
      }).then(() => {}).catch(err => console.error('Failed to create pending message:', err));
    }

    console.log(`[Consensus] Signal ${signal_id}: ${finalAssessment} (consensus: ${consensusScore.toFixed(2)}, disagreement: ${disagreement})`);

    return successResponse({
      signal_id,
      final_assessment: finalAssessment,
      final_priority: finalPriority,
      final_confidence: Math.round(finalConfidence * 100) / 100,
      consensus_score: Math.round(consensusScore * 100) / 100,
      disagreement,
      model_results: [result1, result2],
    });

  } catch (error) {
    console.error('[Consensus] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function fetchModelAssessment(
  _apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  try {
    const aiResult = await callAiGateway({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      functionName: 'multi-model-consensus',
      extraBody: {
        max_tokens: 300,
        temperature: 0.1,
      },
    });

    if (aiResult.error) {
      console.error(`[Consensus] ${model} error: ${aiResult.error}`);
      return '{}';
    }

    return aiResult.content || '{}';
  } catch (e) {
    console.error(`[Consensus] ${model} error:`, e);
    return '{}';
  }
}

function parseAssessment(raw: string, model: string): ConsensusResult {
  try {
    // Extract JSON from potential markdown wrapper
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    return {
      model,
      assessment: parsed.assessment || 'unknown',
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      recommended_priority: parsed.recommended_priority || 'p3',
      key_factors: Array.isArray(parsed.key_factors) ? parsed.key_factors : [],
    };
  } catch {
    return {
      model,
      assessment: 'unknown',
      confidence: 0.5,
      recommended_priority: 'p3',
      key_factors: ['parse_error'],
    };
  }
}

function higherPriority(a: string, b: string): string {
  const rank: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}
