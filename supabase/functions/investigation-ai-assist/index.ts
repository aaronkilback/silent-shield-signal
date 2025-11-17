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
    const { action, context, existingText } = await req.json();
    console.log('AI assist request:', { action, context: context?.substring(0, 100) });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    let systemPrompt = '';
    let userPrompt = '';

    switch (action) {
      case 'expand':
        systemPrompt = 'You are an expert security analyst helping to write detailed investigation entries. Expand brief notes into comprehensive, professional investigation reports.';
        userPrompt = `Expand this investigation note into a detailed professional entry:\n\n${existingText}\n\nContext: ${context || 'Security investigation'}`;
        break;
      
      case 'summarize':
        systemPrompt = 'You are an expert security analyst. Create concise summaries of investigation information.';
        userPrompt = `Summarize this investigation information:\n\n${existingText}`;
        break;
      
      case 'suggest':
        systemPrompt = 'You are an expert security analyst. Suggest next investigative steps based on the information provided.';
        userPrompt = `Based on this investigation information, suggest 3-5 next investigative steps:\n\n${context}`;
        break;
      
      case 'write_synopsis':
        systemPrompt = 'You are an expert security analyst. Write clear, concise synopsis sections for investigation reports.';
        userPrompt = `Write a synopsis for this investigation based on the following information:\n\n${context}`;
        break;
      
      case 'write_recommendations':
        systemPrompt = 'You are an expert security analyst. Provide actionable recommendations based on investigation findings.';
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
