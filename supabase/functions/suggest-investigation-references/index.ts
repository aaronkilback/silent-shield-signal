import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { investigationId } = await req.json();
    console.log('Suggesting cross-references for investigation:', investigationId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!supabaseUrl || !supabaseKey || !LOVABLE_API_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current investigation details
    const { data: currentInvestigation, error: currentError } = await supabase
      .from('investigations')
      .select('file_number, synopsis, information, client_id')
      .eq('id', investigationId)
      .single();

    if (currentError) throw currentError;

    // Get all other investigations
    const { data: allInvestigations, error: allError } = await supabase
      .from('investigations')
      .select('id, file_number, synopsis, information, client_id')
      .neq('id', investigationId);

    if (allError) throw allError;

    if (!allInvestigations || allInvestigations.length === 0) {
      return new Response(
        JSON.stringify({ suggestions: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare context for AI
    const currentContext = `
File: ${currentInvestigation.file_number}
Synopsis: ${currentInvestigation.synopsis || 'N/A'}
Information: ${currentInvestigation.information || 'N/A'}
    `.trim();

    const otherInvestigations = allInvestigations.map(inv => `
ID: ${inv.id}
File: ${inv.file_number}
Synopsis: ${inv.synopsis || 'N/A'}
Information: ${inv.information?.substring(0, 500) || 'N/A'}
    `).join('\n---\n');

    const prompt = `You are analyzing investigation files to find potential cross-references. 

Current Investigation:
${currentContext}

Other Investigations:
${otherInvestigations}

Based on the content, identify which investigations should be cross-referenced with the current one. Look for:
- Similar incidents, persons, or locations
- Related timeframes or patterns
- Connected entities or organizations
- Similar methods or tactics

Return ONLY a JSON array of investigation IDs that should be cross-referenced, ordered by relevance (most relevant first).
Format: ["id1", "id2", "id3"]
Maximum 5 suggestions.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert investigation analyst. Return ONLY valid JSON arrays.' },
          { role: 'user', content: prompt }
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
    const aiResponse = data.choices?.[0]?.message?.content;

    if (!aiResponse) {
      throw new Error('No response from AI');
    }

    // Parse AI response - handle potential markdown code blocks
    let suggestedIds: string[] = [];
    try {
      const jsonMatch = aiResponse.match(/\[.*\]/s);
      if (jsonMatch) {
        suggestedIds = JSON.parse(jsonMatch[0]);
      } else {
        suggestedIds = JSON.parse(aiResponse);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      suggestedIds = [];
    }

    // Validate and get investigation details for suggestions
    const validatedSuggestions = [];
    for (const id of suggestedIds.slice(0, 5)) {
      const investigation = allInvestigations.find(inv => inv.id === id);
      if (investigation) {
        validatedSuggestions.push({
          id: investigation.id,
          file_number: investigation.file_number,
          synopsis: investigation.synopsis
        });
      }
    }

    console.log('AI suggested cross-references:', validatedSuggestions.length);

    return new Response(
      JSON.stringify({ suggestions: validatedSuggestions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in suggest-investigation-references:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
