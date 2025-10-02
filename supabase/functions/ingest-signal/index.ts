import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { source_key, event } = await req.json();
    
    console.log('Ingesting signal from source:', source_key);

    // Find source by key (simplified - assume source name = source_key for now)
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('id, is_active')
      .eq('name', source_key)
      .single();

    if (sourceError || !source) {
      console.error('Source not found:', source_key);
      return new Response(
        JSON.stringify({ error: 'Source not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!source.is_active) {
      return new Response(
        JSON.stringify({ error: 'Source is not active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use AI to classify and normalize the signal
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a security intelligence classifier. Analyze security events and extract:
- normalized_text: clean summary
- entity_tags: array of entities (IPs, domains, usernames)
- location: geographic location if mentioned
- category: type (malware, phishing, intrusion, data_exfil, etc)
- severity: critical, high, medium, or low
- confidence: 0-100 score
Respond ONLY with valid JSON.`
          },
          {
            role: 'user',
            content: JSON.stringify(event)
          }
        ],
      }),
    });

    let classification = {
      normalized_text: JSON.stringify(event),
      entity_tags: [],
      location: null,
      category: 'unknown',
      severity: 'medium',
      confidence: 50
    };

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      if (aiContent) {
        try {
          const parsed = JSON.parse(aiContent);
          classification = { ...classification, ...parsed };
        } catch (e) {
          console.error('Failed to parse AI response:', e);
        }
      }
    }

    // Insert signal
    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        source_id: source.id,
        raw_json: event,
        normalized_text: classification.normalized_text,
        entity_tags: classification.entity_tags,
        location: classification.location,
        category: classification.category,
        severity: classification.severity,
        confidence: classification.confidence,
        status: 'new'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    console.log('Signal ingested:', signal.id);

    return new Response(
      JSON.stringify({ signal_id: signal.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ingest-signal:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
