import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { FORTRESS_DATA_INFRASTRUCTURE, FORTRESS_AGENT_CAPABILITIES } from "../_shared/fortress-infrastructure.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agent_id, message, conversation_history = [] } = await req.json();
    console.log('Agent chat request:', { agent_id, message_length: message?.length });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the agent configuration
    const { data: agent, error: agentError } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    // Build context based on agent's input sources
    let contextData = '';
    
    if (agent.input_sources.includes('signals')) {
      const { data: signals } = await supabase
        .from('signals')
        .select('title, source, severity, created_at, rule_category')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (signals?.length) {
        contextData += `\n\nRecent Signals (${signals.length}):\n`;
        signals.forEach(s => {
          contextData += `- [${s.severity}] ${s.title} (${s.rule_category}) - ${new Date(s.created_at).toLocaleDateString()}\n`;
        });
      }
    }

    if (agent.input_sources.includes('incidents')) {
      const { data: incidents } = await supabase
        .from('incidents')
        .select('title, priority, status, opened_at, incident_type')
        .order('opened_at', { ascending: false })
        .limit(10);
      
      if (incidents?.length) {
        contextData += `\n\nRecent Incidents (${incidents.length}):\n`;
        incidents.forEach(i => {
          contextData += `- [${i.priority}/${i.status}] ${i.title || 'Untitled'} (${i.incident_type || 'Unknown'}) - ${new Date(i.opened_at).toLocaleDateString()}\n`;
        });
      }
    }

    if (agent.input_sources.includes('entities')) {
      const { data: entities } = await supabase
        .from('entities')
        .select('name, type, risk_level, threat_score')
        .order('threat_score', { ascending: false })
        .limit(15);
      
      if (entities?.length) {
        contextData += `\n\nKey Entities (${entities.length}):\n`;
        entities.forEach(e => {
          contextData += `- [${e.type}] ${e.name} - Risk: ${e.risk_level || 'Unknown'}, Threat Score: ${e.threat_score || 'N/A'}\n`;
        });
      }
    }

    if (agent.input_sources.includes('clients')) {
      const { data: clients } = await supabase
        .from('clients')
        .select('name, industry, status, locations')
        .limit(10);
      
      if (clients?.length) {
        contextData += `\n\nActive Clients (${clients.length}):\n`;
        clients.forEach(c => {
          contextData += `- ${c.name} (${c.industry || 'Unknown'}) - ${c.status}\n`;
        });
      }
    }

    if (agent.input_sources.includes('escalation_rules')) {
      const { data: rules } = await supabase
        .from('escalation_rules')
        .select('name, priority, escalate_after_minutes, is_active')
        .eq('is_active', true)
        .limit(10);
      
      if (rules?.length) {
        contextData += `\n\nActive Escalation Rules (${rules.length}):\n`;
        rules.forEach(r => {
          contextData += `- ${r.name} (${r.priority}) - Escalate after ${r.escalate_after_minutes} minutes\n`;
        });
      }
    }

    // Always include documents for reference (archival documents with extracted content)
    const { data: archivalDocs } = await supabase
      .from('archival_documents')
      .select('id, filename, summary, content_text, keywords, tags, entity_mentions, date_of_document, created_at')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (archivalDocs?.length) {
      contextData += `\n\n=== ARCHIVAL DOCUMENTS (${archivalDocs.length}) ===\n`;
      archivalDocs.forEach(doc => {
        contextData += `\n--- Document: ${doc.filename} ---\n`;
        if (doc.date_of_document) contextData += `Date: ${doc.date_of_document}\n`;
        if (doc.summary) contextData += `Summary: ${doc.summary}\n`;
        if (doc.keywords?.length) contextData += `Keywords: ${doc.keywords.join(', ')}\n`;
        if (doc.entity_mentions?.length) contextData += `Entities Mentioned: ${doc.entity_mentions.join(', ')}\n`;
        if (doc.content_text) {
          // Include up to 2000 chars of content per document
          const contentPreview = doc.content_text.substring(0, 2000);
          contextData += `Content:\n${contentPreview}${doc.content_text.length > 2000 ? '...[truncated]' : ''}\n`;
        }
      });
    }

    // Include ingested intelligence documents
    const { data: ingestedDocs } = await supabase
      .from('ingested_documents')
      .select('id, title, source, summary, content, processed_entities, processed_relationships, created_at')
      .eq('processing_status', 'completed')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (ingestedDocs?.length) {
      contextData += `\n\n=== INTELLIGENCE DOCUMENTS (${ingestedDocs.length}) ===\n`;
      ingestedDocs.forEach(doc => {
        contextData += `\n--- ${doc.title || 'Untitled'} ---\n`;
        if (doc.source) contextData += `Source: ${doc.source}\n`;
        if (doc.summary) contextData += `Summary: ${doc.summary}\n`;
        if (doc.processed_entities?.length) {
          contextData += `Extracted Entities: ${JSON.stringify(doc.processed_entities).substring(0, 500)}\n`;
        }
        if (doc.content) {
          const contentPreview = doc.content.substring(0, 1500);
          contextData += `Content:\n${contentPreview}${doc.content.length > 1500 ? '...[truncated]' : ''}\n`;
        }
      });
    }

    // Include entity suggestions for context
    const { data: entitySuggestions } = await supabase
      .from('entity_suggestions')
      .select('suggested_name, suggested_type, context, confidence, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(15);
    
    if (entitySuggestions?.length) {
      contextData += `\n\n=== PENDING ENTITY SUGGESTIONS (${entitySuggestions.length}) ===\n`;
      entitySuggestions.forEach(s => {
        contextData += `- ${s.suggested_name} (${s.suggested_type}) - Confidence: ${Math.round((s.confidence || 0) * 100)}%\n`;
        if (s.context) contextData += `  Context: ${s.context.substring(0, 200)}\n`;
      });
    }

    // Build system prompt with Fortress infrastructure documentation
    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}

Output Types You Generate: ${agent.output_types.join(', ')}

${FORTRESS_DATA_INFRASTRUCTURE}

${FORTRESS_AGENT_CAPABILITIES}

CURRENT INTELLIGENCE CONTEXT:
${contextData || 'No context data available.'}

COMMUNICATION GUIDELINES:
- Maintain your persona at all times
- Be concise but thorough
- Focus on actionable intelligence
- Use professional security terminology
- Never break character
- If asked about something outside your specialty, acknowledge it and suggest the appropriate resource
- You understand the full Fortress data infrastructure and can explain how data flows through the system`;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation_history.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    // Call AI Gateway
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
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
    const agentResponse = data.choices?.[0]?.message?.content;

    if (!agentResponse) {
      throw new Error('No response from AI');
    }

    console.log('Agent response generated successfully');

    return new Response(
      JSON.stringify({ response: agentResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in agent-chat:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
