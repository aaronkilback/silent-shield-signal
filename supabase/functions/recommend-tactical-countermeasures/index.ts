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
    const { signal_id, client_context } = await req.json();
    console.log('Recommending tactical countermeasures for signal:', signal_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch signal details
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('*')
      .eq('id', signal_id)
      .single();

    if (signalError || !signal) {
      throw new Error('Signal not found');
    }

    // Fetch client data if available
    let clientData = null;
    if (signal.client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', signal.client_id)
        .single();
      clientData = client;
    }

    // Fetch recent incidents related to this threat type
    const { data: relatedIncidents } = await supabase
      .from('incidents')
      .select('*')
      .eq('client_id', signal.client_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Build comprehensive prompt for AI
    const analysisPrompt = `
You are a tactical security advisor analyzing a threat signal and recommending specific, actionable countermeasures.

SIGNAL DETAILS:
- Type: ${signal.rule_category || 'Unknown'}
- Severity: ${signal.severity || 'Unknown'}
- Priority: ${signal.rule_priority || 'Unknown'}
- Description: ${signal.normalized_text}
- Location: ${signal.location || 'Unknown'}
- Confidence: ${signal.confidence}

CLIENT CONTEXT:
${clientData ? `
- Name: ${clientData.name}
- Industry: ${clientData.industry || 'Unknown'}
- Locations: ${clientData.locations?.join(', ') || 'Unknown'}
- High-value Assets: ${clientData.high_value_assets?.join(', ') || 'None specified'}
- Employee Count: ${clientData.employee_count || 'Unknown'}
` : 'No client context available'}

ADDITIONAL CONTEXT:
${client_context || 'None provided'}

RECENT RELATED INCIDENTS:
${relatedIncidents?.length ? relatedIncidents.map(inc => 
  `- ${inc.title || 'Untitled'} (${inc.priority}, ${inc.status})`
).join('\n') : 'No recent incidents'}

TASK:
Generate a prioritized list of 3-7 tactical countermeasures that should be deployed immediately to mitigate this threat. For each countermeasure:

1. Provide a clear, specific action (e.g., "Deploy mobile surveillance unit to Site X perimeter")
2. Estimate effectiveness (High/Medium/Low) based on threat type
3. Note resource requirements (personnel, equipment, time)
4. Identify implementation timeline (Immediate/Within 24h/Within 72h)
5. Highlight any dependencies or prerequisites

Focus on practical, implementable measures across:
- Physical security enhancements
- Cyber security controls
- Operational procedure adjustments
- Personnel deployment/training
- Technology deployment

Format your response as a structured JSON array of countermeasures.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert tactical security advisor specializing in threat mitigation and defense optimization.' },
          { role: 'user', content: analysisPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const recommendations = data.choices?.[0]?.message?.content;

    if (!recommendations) {
      throw new Error('No recommendations generated');
    }

    console.log('Tactical countermeasures generated successfully');

    return new Response(
      JSON.stringify({ 
        signal_id,
        countermeasures: recommendations,
        analyzed_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in recommend-tactical-countermeasures:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
