import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const SignalInputSchema = z.object({
  source_key: z.string().optional(),
  event: z.any().optional(),
  text: z.string().min(1).max(10000).optional(),
  location: z.string().max(500).optional(),
  raw_json: z.any().optional()
}).refine(data => data.text || data.event, {
  message: "Either 'text' or 'event' must be provided"
});

// Rules-based classification (rules.yaml equivalent)
const RULES = {
  p1: {
    keywords: ['credible threat', 'weapon', 'kidnap', 'active shooter', 'bomb'],
    severity: 'critical',
    priority: 'p1',
    shouldOpenIncident: true
  },
  p2: {
    keywords: ['suspicious', 'prowler', 'tamper', 'breach attempt', 'intrusion'],
    severity: 'high',
    priority: 'p2',
    shouldOpenIncident: true
  }
};

function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  
  // Check P1 rules first
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p1.severity,
        priority: RULES.p1.priority,
        shouldOpenIncident: RULES.p1.shouldOpenIncident,
        matchedRule: 'p1',
        matchedKeyword: keyword
      };
    }
  }
  
  // Check P2 rules
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p2.severity,
        priority: RULES.p2.priority,
        shouldOpenIncident: RULES.p2.shouldOpenIncident,
        matchedRule: 'p2',
        matchedKeyword: keyword
      };
    }
  }
  
  return {
    severity: null,
    priority: null,
    shouldOpenIncident: false,
    matchedRule: null,
    matchedKeyword: null
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate input
    const rawBody = await req.json();
    const validationResult = SignalInputSchema.safeParse(rawBody);
    
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { source_key, event, text, location, raw_json } = validationResult.data;
    
    // Support both webhook format (source_key + event) and direct format (text + location)
    const signalText = text || JSON.stringify(event);
    const signalLocation = location || null;
    const signalRaw = raw_json || event || { text: signalText };
    
    console.log('Ingesting signal:', signalText.substring(0, 100));

    let sourceId = null;
    
    // If source_key provided, validate source
    if (source_key) {
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
      
      sourceId = source.id;
    }

    // Step 1: Apply rules-based classification
    const rulesResult = applyRules(signalText);
    console.log('Rules matched:', rulesResult);
    
    // Step 2: Enhance with AI classification
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
            content: signalText
          }
        ],
      }),
    });

    let classification = {
      normalized_text: signalText,
      entity_tags: [],
      location: signalLocation,
      category: 'unknown',
      severity: rulesResult.severity || 'medium',
      confidence: 50
    };

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      if (aiContent) {
        try {
          const parsed = JSON.parse(aiContent);
          classification = { ...classification, ...parsed };
          // Keep rules-based severity if matched
          if (rulesResult.severity) {
            classification.severity = rulesResult.severity;
          }
        } catch (e) {
          console.error('Failed to parse AI response:', e);
        }
      }
    }

    // Insert signal
    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        source_id: sourceId,
        raw_json: signalRaw,
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
    
    // Auto-open incident based on rules
    if (rulesResult.shouldOpenIncident) {
      const { error: incidentError } = await supabase
        .from('incidents')
        .insert({
          signal_id: signal.id,
          priority: rulesResult.priority,
          status: 'open',
          sla_targets_json: { 
            mttd: 10, 
            mttr: rulesResult.priority === 'p1' ? 60 : 120 
          },
          timeline_json: [{
            timestamp: new Date().toISOString(),
            action: 'incident_opened',
            details: `Auto-opened by rule: ${rulesResult.matchedRule} (${rulesResult.matchedKeyword})`
          }]
        });
      
      if (incidentError) {
        console.error('Error creating incident:', incidentError);
      } else {
        console.log('Incident auto-opened for signal:', signal.id);
      }
    }

    // Automatically trigger AI decision engine for autonomous processing
    try {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-decision-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ signal_id: signal.id })
      }).catch(err => {
        console.error('Error triggering AI decision engine:', err);
      });
    } catch (error) {
      console.error('Failed to trigger AI decision engine:', error);
      // Don't fail the main request if AI processing fails
    }

    return new Response(
      JSON.stringify({ 
        signal_id: signal.id,
        ai_processing: 'triggered'
      }),
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
