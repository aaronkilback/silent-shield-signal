import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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
  // Fetch open investigations to compare
  const query = supabase
    .from('investigations')
    .select('id, file_number, synopsis, information, file_status, created_at')
    .in('file_status', ['open', 'under_review'])
    .not('synopsis', 'is', null);

  if (investigationId) {
    query.neq('id', investigationId);
  }

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
      matches.push({
        id: inv.id,
        file_number: inv.file_number,
        similarity: Math.round(similarity * 100),
        overlap_keywords: overlap.slice(0, 10),
      });
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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Determine if investigation has substantive content
    const hasSubstantiveContext = (context && context.length > 80 && !context.includes('Not yet written')) 
      || (existingText && existingText.length > 50);

    // Fetch learned patterns (always — these are lightweight and derived from analyst behavior)
    const { patternsContext } = await fetchLearnedPatterns(supabase);

    // Only fetch reference docs/entities if investigation has content
    let referenceContext = '';
    if (hasSubstantiveContext) {
      const [{ data: archivalDocs }, { data: entities }] = await Promise.all([
        supabase
          .from('archival_documents')
          .select('filename, summary, keywords, entity_mentions, date_of_document')
          .not('summary', 'is', null)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('entities')
          .select('name, type, risk_level')
          .eq('is_active', true)
          .limit(20),
      ]);

      if (archivalDocs?.length) {
        referenceContext += '\n\n=== REFERENCE DOCUMENTS (use ONLY if directly relevant) ===\n';
        archivalDocs.forEach((doc: any) => {
          referenceContext += `- ${doc.filename}${doc.summary ? `: ${doc.summary.substring(0, 200)}` : ''}\n`;
        });
      }
      if (entities?.length) {
        referenceContext += '\n\n=== KNOWN ENTITIES (do NOT insert unless directly relevant) ===\n';
        entities.forEach((e: any) => {
          referenceContext += `- ${e.name} (${e.type})${e.risk_level ? ` [${e.risk_level}]` : ''}\n`;
        });
      }
    } else {
      console.log('[investigation-ai-assist] Skipping reference context — no substantive content yet');
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
        systemPrompt = `You are an expert security analyst. Expand brief notes into professional investigation entries. Use learned patterns for structure but ONLY the analyst's facts for content.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Expand this note using ONLY the facts provided:\n\n${existingText}\n\nContext: ${context || 'Security investigation'}`;
        break;

      case 'summarize':
        systemPrompt = `You are an expert security analyst. Create concise summaries.${antiHallucination}${referenceContext}`;
        userPrompt = `Summarize this investigation information:\n\n${existingText}`;
        break;

      case 'suggest':
        systemPrompt = `You are an expert security analyst. Suggest next investigative steps. Use learned patterns to inform suggestions but keep them specific to this case.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Suggest 3-5 next investigative steps based on:\n\n${context}`;
        break;

      case 'write_synopsis':
        systemPrompt = `You are an expert security analyst writing investigation synopses. Use learned synopsis structures as templates but fill with ACTUAL case facts only. If no substantive information exists, state the investigation is newly opened.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Write a synopsis for this investigation. If no substantive information is provided, state that it is newly opened:\n\n${context}`;
        break;

      case 'write_recommendations':
        systemPrompt = `You are an expert security analyst. Provide actionable recommendations. Reference learned recommendation patterns but tailor to THIS investigation's specific findings.${antiHallucination}${patternsContext}${referenceContext}`;
        userPrompt = `Provide recommendations based on this investigation:\n\n${context}`;
        break;

      case 'smart_autofill': {
        // Use learned patterns to pre-populate investigation fields
        systemPrompt = `You are an expert security analyst. Based on learned patterns from past investigations and the brief context provided, generate suggested pre-fill content for an investigation. Keep it skeletal — provide STRUCTURE, not fabricated details. Use [PLACEHOLDER] markers for facts the analyst needs to fill in.${antiHallucination}${patternsContext}`;
        userPrompt = `The analyst is starting a new investigation with this context: "${context || 'New investigation'}".

Generate a JSON object with these fields (use [PLACEHOLDER] for unknown facts):
- "synopsis": a structured synopsis skeleton
- "recommended_steps": array of 3-5 suggested first steps
- "suggested_entry": a template for the first investigation entry
- "suggested_entities_to_check": relevant entity types to investigate

Return ONLY valid JSON.`;
        break;
      }

      default:
        throw new Error(`Invalid action: ${action}`);
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('[investigation-ai-assist] AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content;

    if (!generatedText) throw new Error('No response from AI');

    console.log('[investigation-ai-assist] Response generated successfully');

    // For smart_autofill, try to parse as JSON
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
