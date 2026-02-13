import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * Investigation AI Assist — Neural-net-enhanced investigation support.
 * 
 * Actions: expand, summarize, suggest, write_synopsis, write_recommendations,
 *          suggest_template, check_duplicates, smart_autofill
 * 
 * Integrates with the adaptive intelligence system (learning_profiles, investigation_templates)
 * to reduce data input and streamline workflows based on learned patterns.
 */

interface RequestBody {
  action: string;
  context?: string;
  existingText?: string;
  investigation_id?: string;
  client_id?: string;
  synopsis?: string;
  information?: string;
}

async function fetchLearnedPatterns(supabase: any) {
  const [
    { data: templates },
    { data: workflowProfile },
  ] = await Promise.all([
    supabase
      .from('investigation_templates')
      .select('template_name, category, description, typical_synopsis_structure, typical_recommendations, common_entry_patterns, avg_entry_count')
      .order('times_accepted', { ascending: false })
      .limit(5),
    supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'investigation_workflow_patterns')
      .maybeSingle(),
  ]);

  let patternsContext = '';

  if (templates?.length) {
    patternsContext += '\n\n═══ LEARNED INVESTIGATION PATTERNS (from past completed cases) ═══\n';
    patternsContext += 'Use these patterns to structure output consistently with analyst preferences:\n';
    for (const t of templates) {
      patternsContext += `\n📋 Template: "${t.template_name}" (${t.category})\n`;
      if (t.typical_synopsis_structure) patternsContext += `   Synopsis structure: ${t.typical_synopsis_structure}\n`;
      if (t.typical_recommendations?.length) patternsContext += `   Common recommendations: ${t.typical_recommendations.join('; ')}\n`;
      if (t.common_entry_patterns?.length) patternsContext += `   Entry patterns: ${t.common_entry_patterns.slice(0, 3).join(' | ')}\n`;
    }
  }

  const wf = workflowProfile?.features;
  if (wf) {
    if (wf.entry_patterns?.length) {
      patternsContext += '\n\n═══ COMMON ENTRY WRITING PATTERNS ═══\n';
      for (const ep of wf.entry_patterns.slice(0, 5)) {
        patternsContext += `• ${ep.pattern_name}: ${ep.pattern_template}\n`;
      }
    }
    if (wf.ai_acceptance_rate !== undefined) {
      patternsContext += `\nAI suggestion acceptance rate: ${Math.round(wf.ai_acceptance_rate * 100)}% — ${wf.ai_acceptance_rate < 0.5 ? 'keep suggestions brief and factual' : 'analysts find detailed suggestions helpful'}.\n`;
    }
  }

  return { patternsContext, templates: templates || [], workflowFeatures: wf };
}

async function checkDuplicates(supabase: any, synopsis: string, information: string, investigationId?: string) {
  const query = supabase
    .from('investigations')
    .select('id, file_number, synopsis, information, file_status, created_at')
    .in('file_status', ['open', 'under_review'])
    .not('synopsis', 'is', null);

  if (investigationId) query.neq('id', investigationId);

  const { data: openInvestigations } = await query.limit(50);
  if (!openInvestigations?.length) return [];

  const searchText = `${synopsis || ''} ${information || ''}`.toLowerCase();
  if (searchText.trim().length < 20) return [];

  const searchWords = new Set(searchText.split(/\s+/).filter(w => w.length > 4));
  const matches: Array<{ id: string; file_number: string; similarity: number; overlap_keywords: string[] }> = [];

  for (const inv of openInvestigations) {
    const invText = `${inv.synopsis || ''} ${inv.information || ''}`.toLowerCase();
    const invWords = new Set(invText.split(/\s+/).filter((w: string) => w.length > 4));
    const overlap = [...searchWords].filter(w => invWords.has(w));
    const similarity = overlap.length / Math.max(searchWords.size, 1);

    if (similarity > 0.25 && overlap.length >= 3) {
      matches.push({ id: inv.id, file_number: inv.file_number, similarity: Math.round(similarity * 100), overlap_keywords: overlap.slice(0, 10) });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { action, context, existingText, investigation_id, client_id, synopsis, information } = await req.json() as RequestBody;
    console.log('[investigation-ai-assist] Request:', { action, context: context?.substring(0, 100), investigation_id });

    const supabase = createServiceClient();

    // Handle non-AI actions first
    if (action === 'check_duplicates') {
      const duplicates = await checkDuplicates(supabase, synopsis || '', information || '', investigation_id);
      return successResponse({ duplicates });
    }

    if (action === 'suggest_template') {
      const { data: templates } = await supabase
        .from('investigation_templates')
        .select('id, template_name, category, description, typical_synopsis_structure, typical_recommendations, common_entry_patterns, avg_entry_count, avg_days_to_close, confidence_score')
        .order('confidence_score', { ascending: false })
        .limit(10);
      return successResponse({ templates: templates || [] });
    }

    const hasSubstantiveContext = (context && context.length > 80 && !context.includes('Not yet written')) 
      || (existingText && existingText.length > 50);

    const { patternsContext } = await fetchLearnedPatterns(supabase);

    let referenceContext = '';
    if (hasSubstantiveContext) {
      const [{ data: archivalDocs }, { data: entities }] = await Promise.all([
        supabase.from('archival_documents').select('filename, summary, keywords, entity_mentions, date_of_document')
          .not('summary', 'is', null).order('created_at', { ascending: false }).limit(10),
        supabase.from('entities').select('name, type, risk_level').eq('is_active', true).limit(20),
      ]);

      if (archivalDocs?.length) {
        referenceContext += '\n\n=== REFERENCE DOCUMENTS (use ONLY if directly relevant) ===\n';
        archivalDocs.forEach((doc: any) => { referenceContext += `- ${doc.filename}${doc.summary ? `: ${doc.summary.substring(0, 200)}` : ''}\n`; });
      }
      if (entities?.length) {
        referenceContext += '\n\n=== KNOWN ENTITIES (do NOT insert unless directly relevant) ===\n';
        entities.forEach((e: any) => { referenceContext += `- ${e.name} (${e.type})${e.risk_level ? ` [${e.risk_level}]` : ''}\n`; });
      }
    }

    const antiHallucination = `\n\nCRITICAL RULES:
- ONLY use facts explicitly provided in the investigation context. Do NOT invent details.
- If investigation is sparse or empty, produce a brief template/placeholder. Do NOT fill gaps with fabricated data.
- Reference documents and entities are for cross-referencing ONLY.
- When using learned patterns, adapt the STRUCTURE but fill with ACTUAL investigation facts only.`;

    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'expand':
        systemPrompt = `You are an expert security analyst. Expand brief notes into professional investigation entries.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Expand this note using ONLY the facts provided:\n\n${existingText}\n\nContext: ${context || 'Security investigation'}`;
        break;
      case 'summarize':
        systemPrompt = `You are an expert security analyst. Create concise summaries.${antiHallucination}${referenceContext}`;
        userPrompt = `Summarize this investigation information:\n\n${existingText}`;
        break;
      case 'suggest':
        systemPrompt = `You are an expert security analyst. Suggest next investigative steps.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Suggest 3-5 next investigative steps based on:\n\n${context}`;
        break;
      case 'write_synopsis':
        systemPrompt = `You are an expert security analyst writing investigation synopses.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Write a synopsis for this investigation. If no substantive information is provided, state that it is newly opened:\n\n${context}`;
        break;
      case 'write_recommendations':
        systemPrompt = `You are an expert security analyst. Provide actionable recommendations.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Provide recommendations based on this investigation:\n\n${context}`;
        break;
      case 'smart_autofill':
        systemPrompt = `You are an expert security analyst. Based on learned patterns, generate suggested pre-fill content.${antiHallucination}${patternsContext}`;
        userPrompt = `The analyst is starting a new investigation with this context: "${context || 'New investigation'}".\n\nGenerate a JSON object with: "synopsis", "recommended_steps", "suggested_entry", "suggested_entities_to_check".\n\nReturn ONLY valid JSON.`;
        break;
      default:
        throw new Error(`Invalid action: ${action}`);
    }

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      functionName: 'investigation-ai-assist',
    });

    if (aiResult.error) {
      if (aiResult.error.includes('429')) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResult.error.includes('402')) {
        return new Response(JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(aiResult.error);
    }

    const generatedText = aiResult.content;
    if (!generatedText) throw new Error('No response from AI');

    console.log('[investigation-ai-assist] Response generated successfully');

    if (action === 'smart_autofill') {
      try {
        const cleaned = generatedText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return successResponse({ autofill: parsed, text: generatedText });
      } catch {
        return successResponse({ text: generatedText });
      }
    }

    return successResponse({ text: generatedText });
  } catch (error) {
    console.error('[investigation-ai-assist] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
