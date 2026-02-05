import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, context, existingText, investigation_id } = await req.json();
    console.log('AI assist request:', { action, context: context?.substring(0, 100), investigation_id });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch archival documents for reference context
    let documentContext = '';
    const { data: archivalDocs } = await supabase
      .from('archival_documents')
      .select('filename, summary, content_text, keywords, entity_mentions, date_of_document')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(15);
    
    if (archivalDocs?.length) {
      documentContext = '\n\n=== REFERENCE DOCUMENTS ===\n';
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
      entityContext = '\n\n=== KNOWN ENTITIES ===\n';
      entities.forEach(e => {
        entityContext += `- ${e.name} (${e.type})${e.risk_level ? ` - Risk: ${e.risk_level}` : ''}\n`;
      });
    }

    const referenceContext = documentContext + entityContext;

    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'expand':
        systemPrompt = `You are an expert security analyst helping to write detailed investigation entries. Expand brief notes into comprehensive, professional investigation reports. You have access to uploaded intelligence documents and entity data for reference.${referenceContext}`;
        userPrompt = `Expand this investigation note into a detailed professional entry:\n\n${existingText}\n\nContext: ${context || 'Security investigation'}`;
        break;
      
      case 'summarize':
        systemPrompt = `You are an expert security analyst. Create concise summaries of investigation information. You have access to uploaded intelligence documents for cross-reference.${referenceContext}`;
        userPrompt = `Summarize this investigation information:\n\n${existingText}`;
        break;
      
      case 'suggest':
        systemPrompt = `You are an expert security analyst. Suggest next investigative steps based on the information provided. Reference uploaded documents and known entities when relevant.${referenceContext}`;
        userPrompt = `Based on this investigation information, suggest 3-5 next investigative steps:\n\n${context}`;
        break;
      
      case 'write_synopsis':
        systemPrompt = `You are an expert security analyst. Write clear, concise synopsis sections for investigation reports. Cross-reference with uploaded intelligence documents when relevant.${referenceContext}`;
        userPrompt = `Write a synopsis for this investigation based on the following information:\n\n${context}`;
        break;
      
      case 'write_recommendations':
        systemPrompt = `You are an expert security analyst. Provide actionable recommendations based on investigation findings. Reference uploaded intelligence documents and known entities when making recommendations.${referenceContext}`;
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

    return new Response(
      JSON.stringify({ text: generatedText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in investigation-ai-assist:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
