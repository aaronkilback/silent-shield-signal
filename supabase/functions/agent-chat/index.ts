import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { FORTRESS_DATA_INFRASTRUCTURE, FORTRESS_AGENT_CAPABILITIES } from "../_shared/fortress-infrastructure.ts";
import { getAntiHallucinationPrompt, getCriticalDateContext, generateVerifiedDataContext } from "../_shared/anti-hallucination.ts";

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

    // Build system prompt with Fortress infrastructure documentation and anti-hallucination
    const antiHallucinationBlock = getAntiHallucinationPrompt();
    
    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}

Output Types You Generate: ${agent.output_types.join(', ')}

${antiHallucinationBlock}

${FORTRESS_DATA_INFRASTRUCTURE}

${FORTRESS_AGENT_CAPABILITIES}

CURRENT INTELLIGENCE CONTEXT:
${contextData || 'No context data available.'}

CLIENT ISOLATION RULES (CRITICAL):
- You MUST NEVER mention, reference, or discuss clients other than the one currently being discussed
- If data from multiple clients appears in your context, ONLY use data relevant to the current conversation
- NEVER cross-reference incidents, entities, or data from one client to another
- If asked about another client, respond: "I can only discuss matters related to the current scope. For information about other engagements, please initiate a separate session."
- This is a critical security and confidentiality requirement

RESPONSE FORMAT GUIDELINES:
- Use clear paragraph breaks with blank lines between sections
- Start with a brief situational summary (1-2 sentences)
- Follow with analysis organized by key points
- End with recommendations or next steps
- Use bullet points for lists of 3+ items
- Use proper spacing:
  * Double line break between major sections
  * Single line break between related points
  * Indent sub-points appropriately

COMMUNICATION GUIDELINES:
- Maintain your persona at all times
- Be concise but thorough
- Focus on actionable intelligence
- Use professional security terminology
- Never break character
- ALWAYS cite exact numbers and dates from the provided data
- NEVER fabricate or approximate counts - use exact values
- NEVER claim events occurred on dates not in the data
- If asked about something outside your specialty, acknowledge it and suggest the appropriate resource
- You understand the full Fortress data infrastructure and can explain how data flows through the system
- When uncertain, explicitly acknowledge it rather than guessing

TOOL USAGE:
- When user provides intelligence (emails, reports, articles), ALWAYS use tools to:
  1. Create signals from actionable intelligence using create_signal tool
  2. Suggest entities (persons, organizations, locations) using suggest_entity tool
- Be proactive about extracting and storing intelligence
- After using tools, summarize what was created for the user`;

    // Define tools for signal creation and entity suggestion
    const tools = [
      {
        type: "function",
        function: {
          name: "create_signal",
          description: "Create a new intelligence signal from provided information. Use this when user shares intel that should be tracked.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Brief title for the signal (max 100 chars)" },
              normalized_text: { type: "string", description: "Full text content of the intelligence" },
              source: { type: "string", description: "Source of the intelligence (e.g., 'Email', 'HUMINT', 'OSINT')" },
              severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"], description: "Severity level" },
              rule_category: { type: "string", description: "Category (e.g., 'Threat Intel', 'Activist Activity', 'Cyber Threat')" },
            },
            required: ["title", "normalized_text", "source", "severity"],
            additionalProperties: false
          }
        }
      },
      {
        type: "function",
        function: {
          name: "suggest_entity",
          description: "Suggest a new entity to be added to the database. Use for persons, organizations, or locations mentioned in intel.",
          parameters: {
            type: "object",
            properties: {
              suggested_name: { type: "string", description: "Name of the entity" },
              suggested_type: { type: "string", enum: ["person", "organization", "location", "vehicle", "infrastructure", "group"], description: "Type of entity" },
              context: { type: "string", description: "Context explaining why this entity is relevant" },
              suggested_aliases: { type: "array", items: { type: "string" }, description: "Alternative names or aliases" },
            },
            required: ["suggested_name", "suggested_type", "context"],
            additionalProperties: false
          }
        }
      }
    ];

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation_history.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    // Call AI Gateway with tools
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        tools,
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
    const choice = data.choices?.[0];
    
    // Process tool calls if present
    const toolCalls = choice?.message?.tool_calls || [];
    const toolResults: { tool: string; result: any }[] = [];
    
    for (const toolCall of toolCalls) {
      const funcName = toolCall.function?.name;
      let args: any;
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        args = {};
      }
      
      console.log(`Executing tool: ${funcName}`, args);
      
      if (funcName === 'create_signal') {
        const { data: signal, error } = await supabase
          .from('signals')
          .insert({
            title: args.title?.substring(0, 100) || 'Untitled Signal',
            normalized_text: args.normalized_text || '',
            source: args.source || 'Agent Chat',
            severity: args.severity || 'medium',
            rule_category: args.rule_category || 'Uncategorized',
            status: 'new',
          })
          .select('id, title')
          .single();
        
        if (error) {
          console.error('Error creating signal:', error);
          toolResults.push({ tool: 'create_signal', result: { success: false, error: error.message } });
        } else {
          toolResults.push({ tool: 'create_signal', result: { success: true, signal_id: signal?.id, title: signal?.title } });
        }
      } else if (funcName === 'suggest_entity') {
        const { data: suggestion, error } = await supabase
          .from('entity_suggestions')
          .insert({
            suggested_name: args.suggested_name || 'Unknown Entity',
            suggested_type: args.suggested_type || 'person',
            context: args.context || '',
            suggested_aliases: args.suggested_aliases || [],
            source_type: 'agent_chat',
            source_id: agent_id,
            confidence: 0.75,
            status: 'pending',
          })
          .select('id, suggested_name')
          .single();
        
        if (error) {
          console.error('Error suggesting entity:', error);
          toolResults.push({ tool: 'suggest_entity', result: { success: false, error: error.message } });
        } else {
          toolResults.push({ tool: 'suggest_entity', result: { success: true, suggestion_id: suggestion?.id, name: suggestion?.suggested_name } });
        }
      }
    }
    
    // Get text response
    let agentResponse = choice?.message?.content || '';
    
    // If tools were called, append summary
    if (toolResults.length > 0) {
      const signalsCreated = toolResults.filter(t => t.tool === 'create_signal' && t.result.success);
      const entitiesSuggested = toolResults.filter(t => t.tool === 'suggest_entity' && t.result.success);
      
      let actionSummary = '\n\n---\n**Actions Taken:**\n';
      if (signalsCreated.length > 0) {
        actionSummary += `✅ Created ${signalsCreated.length} signal(s): ${signalsCreated.map(s => s.result.title).join(', ')}\n`;
      }
      if (entitiesSuggested.length > 0) {
        actionSummary += `✅ Suggested ${entitiesSuggested.length} entity/entities: ${entitiesSuggested.map(e => e.result.name).join(', ')}\n`;
      }
      
      agentResponse += actionSummary;
    }

    if (!agentResponse && toolResults.length === 0) {
      throw new Error('No response from AI');
    }

    console.log('Agent response generated successfully', { toolsExecuted: toolResults.length });

    return new Response(
      JSON.stringify({ 
        response: agentResponse || 'I processed the intelligence and took the actions listed above.',
        tools_executed: toolResults 
      }),
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
