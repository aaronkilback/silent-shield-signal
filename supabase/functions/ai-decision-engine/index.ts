import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const { signal_id } = await req.json();

    // Get signal details
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('*, clients(*)')
      .eq('id', signal_id)
      .single();

    if (signalError) throw signalError;

    // Use Lovable AI to make autonomous decisions
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
            content: `You are an autonomous SOC decision engine. Analyze security signals and make decisions without human intervention.
            
Your responsibilities:
1. Assess threat severity and impact
2. Recommend immediate containment actions
3. Determine escalation priority
4. Suggest remediation steps
5. Identify patterns and correlations

Respond with structured JSON containing:
{
  "threat_level": "critical|high|medium|low",
  "confidence": 0.0-1.0,
  "should_create_incident": boolean,
  "incident_priority": "p1|p2|p3|p4",
  "containment_actions": ["action1", "action2"],
  "remediation_steps": ["step1", "step2"],
  "alert_recipients": ["email1@example.com"],
  "estimated_impact": string,
  "reasoning": string
}`
          },
          {
            role: 'user',
            content: `Analyze this security signal and provide autonomous decision:

Signal: ${signal.normalized_text}
Category: ${signal.category}
Severity: ${signal.severity}
Location: ${signal.location}
Entity Tags: ${signal.entity_tags?.join(', ')}
Confidence: ${signal.confidence}

Client Context:
Name: ${signal.clients?.name}
Industry: ${signal.clients?.industry}
Risk Assessment: ${JSON.stringify(signal.clients?.risk_assessment)}

Make an autonomous decision about how to handle this signal.`
          }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'make_decision',
            description: 'Make autonomous security decision',
            parameters: {
              type: 'object',
              properties: {
                threat_level: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                confidence: { type: 'number' },
                should_create_incident: { type: 'boolean' },
                incident_priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] },
                containment_actions: { type: 'array', items: { type: 'string' } },
                remediation_steps: { type: 'array', items: { type: 'string' } },
                alert_recipients: { type: 'array', items: { type: 'string' } },
                estimated_impact: { type: 'string' },
                reasoning: { type: 'string' }
              },
              required: ['threat_level', 'confidence', 'should_create_incident', 'reasoning']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'make_decision' } }
      })
    });

    const aiData = await aiResponse.json();
    const decision = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);

    console.log('AI Decision:', decision);

    // Execute autonomous actions based on AI decision
    let incident_id = null;

    if (decision.should_create_incident) {
      // Automatically create incident
      const { data: incident, error: incidentError } = await supabase
        .from('incidents')
        .insert({
          signal_id: signal.id,
          client_id: signal.client_id,
          priority: decision.incident_priority || 'p3',
          status: 'open',
          timeline_json: [{
            timestamp: new Date().toISOString(),
            event: 'Incident automatically created by AI',
            details: decision.reasoning,
            actor: 'AI Decision Engine'
          }]
        })
        .select()
        .single();

      if (!incidentError) {
        incident_id = incident.id;
        
        // Auto-assign based on priority
        if (decision.incident_priority === 'p1' || decision.incident_priority === 'p2') {
          // Update incident timeline with containment actions
          const { error: updateError } = await supabase
            .from('incidents')
            .update({
              timeline_json: [
                ...incident.timeline_json,
                {
                  timestamp: new Date().toISOString(),
                  event: 'Automated containment initiated',
                  details: decision.containment_actions?.join(', '),
                  actor: 'AI Decision Engine'
                }
              ],
              acknowledged_at: new Date().toISOString()
            })
            .eq('id', incident.id);
        }
      }
    }

    // Automatically send alerts
    if (decision.alert_recipients && decision.alert_recipients.length > 0) {
      for (const recipient of decision.alert_recipients) {
        await supabase.from('alerts').insert({
          incident_id: incident_id,
          recipient: recipient,
          channel: 'email',
          status: 'pending',
          response_json: {
            subject: `[${decision.threat_level.toUpperCase()}] ${signal.category} Alert`,
            body: `
Threat Level: ${decision.threat_level}
Signal: ${signal.normalized_text}
Location: ${signal.location}

AI Analysis:
${decision.reasoning}

Recommended Actions:
${decision.containment_actions?.map((a, i) => `${i + 1}. ${a}`).join('\n')}

This alert was generated and sent automatically by the AI Decision Engine.
            `
          }
        });
      }
    }

    // Update signal status
    await supabase
      .from('signals')
      .update({ status: 'processed' })
      .eq('id', signal.id);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        incident_id,
        actions_taken: {
          incident_created: decision.should_create_incident,
          alerts_sent: decision.alert_recipients?.length || 0,
          containment_initiated: decision.containment_actions?.length > 0
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in AI decision engine:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
