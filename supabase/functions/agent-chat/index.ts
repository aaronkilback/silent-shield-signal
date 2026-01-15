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
        .select('name, type, risk_level, threat_score, current_location, description')
        .order('threat_score', { ascending: false })
        .limit(20);
      
      if (entities?.length) {
        // Group entities by type for better context
        const personEntities = entities.filter(e => e.type === 'person');
        const orgEntities = entities.filter(e => e.type === 'organization');
        const locationEntities = entities.filter(e => e.type === 'location');
        const infraEntities = entities.filter(e => ['infrastructure', 'facility', 'pipeline', 'well', 'equipment'].includes(e.type));
        const otherEntities = entities.filter(e => !['person', 'organization', 'location', 'infrastructure', 'facility', 'pipeline', 'well', 'equipment'].includes(e.type));
        
        contextData += `\n\n=== TRACKED ENTITIES (${entities.length}) ===\n`;
        
        if (personEntities.length) {
          contextData += `\n📋 PERSONS OF INTEREST (${personEntities.length}):\n`;
          personEntities.forEach(e => {
            contextData += `- ${e.name} - Risk: ${e.risk_level || 'Unknown'}, Threat Score: ${e.threat_score || 'N/A'}\n`;
            if (e.description) contextData += `  Description: ${e.description.substring(0, 150)}\n`;
          });
        }
        
        if (orgEntities.length) {
          contextData += `\n🏢 ORGANIZATIONS (${orgEntities.length}):\n`;
          orgEntities.forEach(e => {
            contextData += `- ${e.name} - Risk: ${e.risk_level || 'Unknown'}, Threat Score: ${e.threat_score || 'N/A'}\n`;
          });
        }
        
        if (locationEntities.length) {
          contextData += `\n📍 LOCATIONS (${locationEntities.length}):\n`;
          locationEntities.forEach(e => {
            contextData += `- ${e.name} - Risk: ${e.risk_level || 'Unknown'}${e.current_location ? `, Coords: ${e.current_location}` : ''}\n`;
          });
        }
        
        if (infraEntities.length) {
          contextData += `\n🏭 INFRASTRUCTURE & FACILITIES (${infraEntities.length}):\n`;
          infraEntities.forEach(e => {
            contextData += `- [${e.type.toUpperCase()}] ${e.name} - Risk: ${e.risk_level || 'Unknown'}${e.current_location ? `, Location: ${e.current_location}` : ''}\n`;
            if (e.description) contextData += `  Details: ${e.description.substring(0, 100)}\n`;
          });
        }
        
        if (otherEntities.length) {
          contextData += `\n📎 OTHER ENTITIES (${otherEntities.length}):\n`;
          otherEntities.forEach(e => {
            contextData += `- [${e.type}] ${e.name} - Risk: ${e.risk_level || 'Unknown'}\n`;
          });
        }
      }
      
      // Fetch entity relationships for infrastructure connectivity understanding
      const { data: relationships } = await supabase
        .from('entity_relationships')
        .select('entity_a_id, entity_b_id, relationship_type, description, strength')
        .order('strength', { ascending: false })
        .limit(30);
      
      if (relationships?.length) {
        // Get entity names for the relationships
        const entityIds = new Set<string>();
        relationships.forEach(r => {
          entityIds.add(r.entity_a_id);
          entityIds.add(r.entity_b_id);
        });
        
        const { data: relatedEntities } = await supabase
          .from('entities')
          .select('id, name, type')
          .in('id', Array.from(entityIds));
        
        const entityMap = new Map((relatedEntities || []).map(e => [e.id, e]));
        
        contextData += `\n\n=== ENTITY RELATIONSHIPS & CONNECTIONS (${relationships.length}) ===\n`;
        relationships.forEach(r => {
          const entityA = entityMap.get(r.entity_a_id);
          const entityB = entityMap.get(r.entity_b_id);
          if (entityA && entityB) {
            contextData += `- ${entityA.name} [${entityA.type}] --${r.relationship_type}--> ${entityB.name} [${entityB.type}]`;
            if (r.description) contextData += ` (${r.description.substring(0, 80)})`;
            contextData += `\n`;
          }
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
      .select('id, filename, summary, content_text, keywords, tags, entity_mentions, date_of_document, created_at, metadata')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(25);
    
    if (archivalDocs?.length) {
      // Separate map/infrastructure documents from others for special treatment
      const mapDocs = archivalDocs.filter(doc => 
        doc.filename?.toLowerCase().includes('map') ||
        doc.filename?.toLowerCase().includes('pod') ||
        doc.filename?.toLowerCase().includes('layout') ||
        doc.filename?.toLowerCase().includes('site plan') ||
        doc.tags?.some((t: string) => ['map', 'infrastructure', 'facility', 'layout'].includes(t.toLowerCase()))
      );
      
      const otherDocs = archivalDocs.filter(doc => !mapDocs.includes(doc));
      
      if (mapDocs.length) {
        contextData += `\n\n=== 🗺️ MAP & INFRASTRUCTURE DOCUMENTS (${mapDocs.length}) ===\n`;
        contextData += `These documents contain geographic/infrastructure intelligence for spatial analysis:\n`;
        mapDocs.forEach(doc => {
          contextData += `\n--- ${doc.filename} ---\n`;
          if (doc.date_of_document) contextData += `Date: ${doc.date_of_document}\n`;
          if (doc.summary) contextData += `Summary: ${doc.summary}\n`;
          if (doc.entity_mentions?.length) {
            // Highlight infrastructure entities
            contextData += `Infrastructure/Entities Found: ${doc.entity_mentions.join(', ')}\n`;
          }
          if (doc.keywords?.length) contextData += `Keywords: ${doc.keywords.join(', ')}\n`;
          if (doc.content_text) {
            const contentPreview = doc.content_text.substring(0, 2500);
            contextData += `Extracted Content:\n${contentPreview}${doc.content_text.length > 2500 ? '...[truncated]' : ''}\n`;
          }
          // Include detected relationships from metadata if present
          const metadata = doc.metadata as any;
          if (metadata?.detected_relationships?.length) {
            contextData += `Detected Relationships: ${JSON.stringify(metadata.detected_relationships.slice(0, 10))}\n`;
          }
        });
      }
      
      if (otherDocs.length) {
        contextData += `\n\n=== ARCHIVAL DOCUMENTS (${otherDocs.length}) ===\n`;
        otherDocs.forEach(doc => {
          contextData += `\n--- Document: ${doc.filename} ---\n`;
          if (doc.date_of_document) contextData += `Date: ${doc.date_of_document}\n`;
          if (doc.summary) contextData += `Summary: ${doc.summary}\n`;
          if (doc.keywords?.length) contextData += `Keywords: ${doc.keywords.join(', ')}\n`;
          if (doc.entity_mentions?.length) contextData += `Entities Mentioned: ${doc.entity_mentions.join(', ')}\n`;
          if (doc.content_text) {
            const contentPreview = doc.content_text.substring(0, 2000);
            contextData += `Content:\n${contentPreview}${doc.content_text.length > 2000 ? '...[truncated]' : ''}\n`;
          }
        });
      }
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
