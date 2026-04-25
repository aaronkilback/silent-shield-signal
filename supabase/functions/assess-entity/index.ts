import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { THREAT_ASSESSMENT_TOOL } from "../_shared/structured-assessment-schemas.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const { entityId, suggestionId, assessment_mode } = body;
    // 'threat_actor' (default): is this entity dangerous?
    // 'threat_target': what threats face this entity?
    const isTargetMode = assessment_mode === 'threat_target';

    if (!entityId && !suggestionId) {
      return errorResponse('entityId or suggestionId is required', 400);
    }

    const supabase = createServiceClient();

    let entityData: any = null;
    let suggestionData: any = null;
    let contextText = '';

    if (suggestionId) {
      const { data, error } = await supabase
        .from('entity_suggestions')
        .select('*')
        .eq('id', suggestionId)
        .single();

      if (error || !data) return errorResponse('Suggestion not found', 404);
      suggestionData = data;

      // Build context from suggestion fields
      contextText = `
Entity Name: ${data.suggested_name}
Type: ${data.suggested_type}
Context: ${data.context || 'No context provided'}
Source Type: ${data.source_type || 'Unknown'}
Confidence: ${((data.confidence || 0) * 100).toFixed(0)}%
${data.suggested_aliases?.length ? `Aliases: ${data.suggested_aliases.join(', ')}` : ''}
${data.suggested_attributes ? `Attributes: ${JSON.stringify(data.suggested_attributes)}` : ''}
`.trim();
    }

    if (entityId) {
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .eq('id', entityId)
        .single();

      if (error || !data) return errorResponse('Entity not found', 404);
      entityData = data;

      // Pull related content for richer context
      const [contentResult, relationshipsResult, reportsResult] = await Promise.all([
        supabase
          .from('entity_content')
          .select('title, summary, published_date, relevance_score, content_type')
          .eq('entity_id', entityId)
          .order('relevance_score', { ascending: false, nullsFirst: false })
          .limit(10),
        supabase
          .from('entity_relationships')
          .select(`
            relationship_type, strength,
            entity_a:entities!entity_relationships_entity_a_id_fkey(name, type),
            entity_b:entities!entity_relationships_entity_b_id_fkey(name, type)
          `)
          .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
          .limit(10),
        supabase
          .from('poi_reports')
          .select('threat_level, confidence_score, report_markdown')
          .eq('entity_id', entityId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      contextText = `
Entity Name: ${entityData.name}
Type: ${entityData.type}
Description: ${entityData.description || 'None'}
Risk Level: ${entityData.risk_level || 'Not assessed'}
Is Active: ${entityData.is_active}
${entityData.aliases?.length ? `Aliases: ${entityData.aliases.join(', ')}` : ''}
${entityData.attributes ? `Attributes: ${JSON.stringify(entityData.attributes)}` : ''}
`.trim();

      if (contentResult.data?.length) {
        contextText += '\n\nRelated Intelligence:\n';
        for (const c of contentResult.data) {
          contextText += `- [${c.content_type}] ${c.title || 'Untitled'}: ${c.summary || '(no summary)'} (relevance: ${c.relevance_score ?? 'n/a'})\n`;
        }
      }

      if (relationshipsResult.data?.length) {
        contextText += '\nKnown Relationships:\n';
        for (const r of relationshipsResult.data) {
          const aName = (r.entity_a as any)?.name;
          const bName = (r.entity_b as any)?.name;
          contextText += `- ${aName} → ${r.relationship_type} → ${bName} (strength: ${r.strength ?? 'n/a'})\n`;
        }
      }

      if (reportsResult.data?.[0]) {
        const report = reportsResult.data[0];
        contextText += `\nExisting POI Report: Threat level ${report.threat_level}, confidence ${report.confidence_score}\n`;
        if (report.report_markdown) {
          contextText += report.report_markdown.substring(0, 1000) + (report.report_markdown.length > 1000 ? '...' : '');
        }
      }
    }

    console.log(`Assessing entity: ${entityData?.name || suggestionData?.suggested_name} [mode=${assessment_mode || 'threat_actor'}]`);

    const systemPrompt = isTargetMode
      ? `You are AEGIS, a protective intelligence analyst for the Fortress AI platform.
Your role is to assess threats FACING an entity — not whether the entity itself is dangerous.
The entity under assessment is a POTENTIAL TARGET of external threats (harassment, doxxing, activism, protests, organized campaigns, violence).
Use the deliver_threat_assessment tool to provide a structured, evidence-based threat landscape assessment.
Frame threat_level as the severity of threats directed AT this entity.
In key_findings, identify: who may be targeting them, what types of threats exist (protest, harassment, doxxing, online campaigns, physical safety risks), and any escalation indicators.
In recommended_actions, focus on PROTECTIVE and DEFENSIVE measures (security protocols, online safety, physical security, legal options).
Base your assessment ONLY on the provided context. Acknowledge data gaps clearly.`
      : `You are AEGIS, a security intelligence analyst for the Fortress AI platform.
Your role is to assess entities — people, organizations, infrastructure — for threat potential based on available intelligence.
Use the deliver_threat_assessment tool to provide a structured, evidence-based assessment.
Base your assessment ONLY on the provided context. Acknowledge data gaps clearly.`;

    const userPrompt = isTargetMode
      ? `Assess the threat landscape FACING the following entity — who is targeting them, what threats exist, how serious are they:\n\n${contextText}`
      : `Assess the following entity for threat and risk level:\n\n${contextText}`;

    const result = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      functionName: 'assess-entity',
      extraBody: {
        tools: [THREAT_ASSESSMENT_TOOL],
        tool_choice: { type: 'function', function: { name: 'deliver_threat_assessment' } },
        max_tokens: 1000,
      },
    });

    if (result.error) {
      console.error('AI assessment failed:', result.error);
      return errorResponse(`AI assessment failed: ${result.error}`, 500);
    }

    // Parse tool call result
    let assessment: any = null;
    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        assessment = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error('Failed to parse assessment:', e);
        return errorResponse('Failed to parse AI assessment result', 500);
      }
    } else if (result.content) {
      // Fallback: try to parse content as JSON
      try {
        assessment = JSON.parse(result.content);
      } catch {
        return errorResponse('AI did not return a structured assessment', 500);
      }
    }

    if (!assessment) {
      return errorResponse('No assessment returned from AI', 500);
    }

    // Tag the assessment with its mode so the UI can frame it correctly
    assessment.assessment_mode = assessment_mode || 'threat_actor';

    const now = new Date().toISOString();

    // Map threat_level to numeric score
    const threatScoreMap: Record<string, number> = {
      critical: 90,
      high: 70,
      medium: 50,
      low: 25,
      informational: 10,
    };
    const threatScore = threatScoreMap[assessment.threat_level] ?? 50;

    // Persist to entity_suggestions if we have a suggestionId
    if (suggestionId) {
      await supabase
        .from('entity_suggestions')
        .update({
          ai_assessment: assessment,
          ai_assessed_at: now,
          ai_risk_level: assessment.threat_level,
          ai_threat_score: threatScore,
        })
        .eq('id', suggestionId);
    }

    // Persist to entities if we have an entityId
    if (entityId) {
      await supabase
        .from('entities')
        .update({
          ai_assessment: assessment,
          ai_assessed_at: now,
        })
        .eq('id', entityId);
    }

    return successResponse({
      assessment,
      threat_level: assessment.threat_level,
      threat_score: threatScore,
      confidence: assessment.confidence,
    });

  } catch (error) {
    console.error('assess-entity error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
