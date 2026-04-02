/**
 * Vision Analysis Pipeline (Tier 4)
 * 
 * Uses Gemini 3 Pro's vision capabilities to analyze images/screenshots/documents
 * during investigations. Extracts text, detects objects, identifies threat indicators.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { image_url, source_type, source_id, analysis_focus } = await req.json();
    if (!image_url) throw new Error('image_url is required');

    const supabase = createServiceClient();
    const focusPrompt = analysis_focus || 'general security analysis';

    console.log(`[Vision] Analyzing image for ${source_type || 'unknown'} (focus: ${focusPrompt})`);

    const systemPrompt = `You are a visual intelligence analyst within the Fortress security platform. Analyze this image with extreme precision.

ANALYSIS FRAMEWORK:
1. **Scene Description**: What is depicted? Environment, lighting, context.
2. **Text Extraction (OCR)**: Extract ALL visible text, labels, signs, documents.
3. **Object Detection**: List significant objects, vehicles, equipment, weapons.
4. **People Analysis**: Count individuals, describe clothing, actions, formations (no facial recognition).
5. **Threat Indicators**: Identify anything security-relevant: perimeter breaches, suspicious items, protest signs, surveillance equipment.
6. **Location Clues**: Any geographic indicators — street signs, landmarks, license plates, vegetation.
7. **Temporal Clues**: Time of day, weather, seasonal indicators.
8. **Metadata Assessment**: Image quality, potential manipulation indicators.

FOCUS AREA: ${focusPrompt}

Output structured JSON with these fields:
- scene_description (string)
- extracted_text (string)
- detected_objects (string[])
- people_count (number)
- threat_indicators (string[])
- location_clues (string[])
- confidence (number 0-1)
- security_relevance ("none" | "low" | "medium" | "high" | "critical")
- summary (string, 1-2 sentences)`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analyze this image. Focus: ${focusPrompt}` },
            { type: 'image_url', image_url: { url: image_url } },
          ],
        },
      ],
      functionName: 'vision-analysis',
      dlqOnFailure: true,
      dlqPayload: { source_type, source_id, analysis_focus },
      extraBody: {
        tools: [{
          type: 'function',
          function: {
            name: 'report_vision_analysis',
            description: 'Report the structured vision analysis results',
            parameters: {
              type: 'object',
              properties: {
                scene_description: { type: 'string' },
                extracted_text: { type: 'string' },
                detected_objects: { type: 'array', items: { type: 'string' } },
                people_count: { type: 'number' },
                threat_indicators: { type: 'array', items: { type: 'string' } },
                location_clues: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' },
                security_relevance: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
                summary: { type: 'string' },
              },
              required: ['scene_description', 'detected_objects', 'threat_indicators', 'confidence', 'security_relevance', 'summary'],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'report_vision_analysis' } },
        max_tokens: 2000,
      },
    });

    // Extract structured output from tool call
    let analysis: any = {};
    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        analysis = JSON.parse(toolCall.function.arguments);
      } catch {
        analysis = { summary: aiResult.content || 'Analysis failed', confidence: 0.3 };
      }
    } else {
      analysis = { summary: aiResult.content || 'No analysis', confidence: 0.3 };
    }

    // Store results
    await supabase.from('vision_analysis_results').insert({
      source_type: source_type || 'manual',
      source_id: source_id || null,
      image_url,
      analysis,
      extracted_text: analysis.extracted_text || null,
      detected_objects: analysis.detected_objects || [],
      threat_indicators: analysis.threat_indicators || [],
      confidence: analysis.confidence || 0,
      model_used: 'google/gpt-4o-mini',
    });

    console.log(`[Vision] Analysis complete. Relevance: ${analysis.security_relevance}, Confidence: ${analysis.confidence}`);

    return successResponse({
      success: true,
      analysis,
      model: 'google/gpt-4o-mini',
      analyzed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Vision] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
