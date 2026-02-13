import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { action, context, existingText, investigation_id } = await req.json();
    console.log('AI assist request:', { action, context: context?.substring(0, 100), investigation_id });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createServiceClient();

    // Only fetch reference context if the investigation already has substantive content
    // This prevents the AI from fabricating data from unrelated signals/entities/documents
    const hasSubstantiveContext = context && context.length > 80 && 
      !context.includes('Not yet written') || (existingText && existingText.length > 50);

    let referenceContext = '';

    if (hasSubstantiveContext) {
      // Fetch archival documents for reference context
      let documentContext = '';
      const { data: archivalDocs } = await supabase
        .from('archival_documents')
        .select('filename, summary, content_text, keywords, entity_mentions, date_of_document')
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(15);
      
      if (archivalDocs?.length) {
        documentContext = '\n\n=== REFERENCE DOCUMENTS (use ONLY if directly relevant) ===\n';
        archivalDocs.forEach(doc => {
          documentContext += `\n--- ${doc.filename} ---\n`;
          if (doc.date_of_document) documentContext += `Date: ${doc.date_of_document}\n`;
          if (doc.summary) documentContext += `Summary: ${doc.summary}\n`;
          if (doc.keywords?.length) documentContext += `Keywords: ${doc.keywords.join(', ')}\n`;
          if (doc.entity_mentions?.length) documentContext += `Entities: ${doc.entity_mentions.join(', ')}\n`;
          if (doc.content_text) {
            const preview = doc.content_text.substring(0, 1500);
            documentContext += `Content: ${preview}${doc.content_text.length > 1500 ? '...[truncated]' : ''}\n`;
          }
        });
      }

      // Fetch entities for context
      let entityContext = '';
      const { data: entities } = await supabase
        .from('entities')
        .select('name, type, description, risk_level')
        .eq('is_active', true)
        .limit(30);
      
      if (entities?.length) {
        entityContext = '\n\n=== KNOWN ENTITIES (reference only, do NOT insert into investigation unless directly relevant) ===\n';
        entities.forEach(e => {
          entityContext += `- ${e.name} (${e.type})${e.risk_level ? ` - Risk: ${e.risk_level}` : ''}\n`;
        });
      }

      referenceContext = documentContext + entityContext;
    } else {
      console.log('[investigation-ai-assist] Skipping reference context — investigation has no substantive content yet');
    }

    const antiHallucination = `\n\nCRITICAL RULES:
- ONLY use facts explicitly provided in the investigation context below. Do NOT invent incident details, dates, threat actors, locations, or statistics.
- If the investigation context is sparse or empty, produce a brief template or ask what information to include. Do NOT fill gaps with fabricated data.
- Reference documents and entities are for cross-referencing ONLY — do not insert their content into the investigation unless the analyst's notes explicitly mention them.`;

    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'expand':
        systemPrompt = `You are an expert security analyst helping to write detailed investigation entries. Expand brief notes into comprehensive, professional investigation reports.${antiHallucination}${referenceContext}`;
        userPrompt = `Expand this investigation note into a detailed professional entry. Use ONLY the facts provided:\n\n${existingText}\n\nContext: ${context || 'Security investigation'}`;
        break;
      
      case 'summarize':
        systemPrompt = `You are an expert security analyst. Create concise summaries of investigation information.${antiHallucination}${referenceContext}`;
        userPrompt = `Summarize this investigation information:\n\n${existingText}`;
        break;
      
      case 'suggest':
        systemPrompt = `You are an expert security analyst. Suggest next investigative steps based on the information provided.${antiHallucination}${referenceContext}`;
        userPrompt = `Based on this investigation information, suggest 3-5 next investigative steps:\n\n${context}`;
        break;
      
      case 'write_synopsis':
        systemPrompt = `You are an expert security analyst. Write clear, concise synopsis sections for investigation reports. If the investigation has no entries yet, produce a placeholder synopsis stating the investigation has been opened and is pending initial information gathering.${antiHallucination}${referenceContext}`;
        userPrompt = `Write a synopsis for this investigation based on the following information. If no substantive information is provided, state that the investigation is newly opened:\n\n${context}`;
        break;
      
      case 'write_recommendations':
        systemPrompt = `You are an expert security analyst. Provide actionable recommendations based on investigation findings.${antiHallucination}${referenceContext}`;
        userPrompt = `Provide recommendations based on this investigation:\n\n${context}`;
        break;
      
      default:
        throw new Error('Invalid action');
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
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content;

    if (!generatedText) {
      throw new Error('No response from AI');
    }

    console.log('AI response generated successfully');

    return successResponse({ text: generatedText });
  } catch (error) {
    console.error('Error in investigation-ai-assist:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
