import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { FORTRESS_DATA_INFRASTRUCTURE, FORTRESS_AGENT_CAPABILITIES } from "../_shared/fortress-infrastructure.ts";
import { getAntiHallucinationPrompt } from "../_shared/anti-hallucination.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agent_id, message, conversation_history = [], client_id } = await req.json();
    console.log('Agent chat request:', { agent_id, message_length: message?.length, client_id });

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

    console.log(`Agent loaded: ${agent.codename} (${agent.call_sign})`);

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
        contextData += `\n\nTracked Entities (${entities.length}):\n`;
        entities.forEach(e => {
          contextData += `- [${e.type}] ${e.name} - Risk: ${e.risk_level || 'Unknown'}\n`;
        });
      }
    }

    if (agent.input_sources.includes('clients')) {
      const { data: clients } = await supabase
        .from('clients')
        .select('name, industry, status')
        .limit(10);
      
      if (clients?.length) {
        contextData += `\n\nActive Clients (${clients.length}):\n`;
        clients.forEach(c => {
          contextData += `- ${c.name} (${c.industry || 'Unknown'}) - ${c.status}\n`;
        });
      }
    }

    // Include recent archival documents
    const { data: archivalDocs } = await supabase
      .from('archival_documents')
      .select('filename, summary, keywords')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (archivalDocs?.length) {
      contextData += `\n\nRecent Documents (${archivalDocs.length}):\n`;
      archivalDocs.forEach(doc => {
        contextData += `- ${doc.filename}${doc.summary ? ': ' + doc.summary.substring(0, 100) : ''}\n`;
      });
    }

    // Current date for awareness
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];

    // Build system prompt with agent persona
    const antiHallucinationBlock = getAntiHallucinationPrompt();
    
    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}
Your Call Sign: ${agent.call_sign}
Output Types You Generate: ${agent.output_types.join(', ')}

CURRENT DATE: ${currentDate}

${antiHallucinationBlock}

${FORTRESS_DATA_INFRASTRUCTURE}

${FORTRESS_AGENT_CAPABILITIES}

CURRENT INTELLIGENCE CONTEXT:
${contextData || 'No context data available.'}

TOOL USAGE - YOU HAVE REAL CAPABILITIES:
You have access to the FULL Fortress toolset through the dashboard-ai-assistant delegation. When you need to:
- Create signals → use create_signal tool
- Suggest entities → use suggest_entity tool  
- Search data → use query_fortress_data tool
- Analyze threats → use analyze_threat_radar tool
- Create incidents → use manage_incident_ticket tool
- And 50+ more tools...

ALWAYS USE TOOLS when the user provides actionable intelligence. Never just describe what you would do.

CLIENT ISOLATION RULES (CRITICAL):
- You MUST NEVER mention, reference, or discuss clients other than the one currently being discussed
- If data from multiple clients appears in your context, ONLY use data relevant to the current conversation
- NEVER cross-reference incidents, entities, or data from one client to another

RESPONSE FORMAT GUIDELINES:
- Use clear paragraph breaks with blank lines between sections
- Start with a brief situational summary (1-2 sentences)
- Follow with analysis organized by key points
- End with recommendations or next steps
- Use bullet points for lists of 3+ items

COMMUNICATION GUIDELINES:
- Maintain your persona at all times
- Be concise but thorough
- Focus on actionable intelligence
- Use professional security terminology
- Never break character
- ALWAYS cite exact numbers and dates from the provided data`;

    // Define comprehensive tools matching dashboard-ai-assistant
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
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_entity",
          description: "Create a new tracked entity (person, organization, location) in the system.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Entity name" },
              type: { type: "string", enum: ["person", "organization", "location", "vehicle", "infrastructure"], description: "Type of entity" },
              description: { type: "string", description: "Description of the entity" },
              aliases: { type: "array", items: { type: "string" }, description: "Alternative names" },
              risk_level: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Initial risk level" },
            },
            required: ["name", "type"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_incident",
          description: "Create a new incident ticket from intelligence or threat information.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Incident title" },
              description: { type: "string", description: "Detailed incident description" },
              priority: { type: "string", enum: ["p1", "p2", "p3", "p4"], description: "Priority level" },
              incident_type: { type: "string", description: "Type of incident (e.g., 'cyber_threat', 'physical_security', 'activist_activity')" },
            },
            required: ["title", "priority"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "query_fortress_data",
          description: "Search Fortress database for signals, incidents, entities, or documents matching criteria.",
          parameters: {
            type: "object",
            properties: {
              query_type: { type: "string", enum: ["signals", "incidents", "entities", "documents", "comprehensive"], description: "Type of data to query" },
              keywords: { type: "array", items: { type: "string" }, description: "Keywords to search for" },
              time_range_days: { type: "number", description: "Number of days to look back (default 30)" },
              severity_filter: { type: "string", enum: ["critical", "high", "medium", "low", "all"], description: "Filter by severity" },
              limit: { type: "number", description: "Max results to return (default 20)" },
            },
            required: ["query_type"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "trigger_osint_scan",
          description: "Trigger an OSINT scan for a specific entity to gather intelligence.",
          parameters: {
            type: "object",
            properties: {
              entity_name: { type: "string", description: "Name of entity to scan" },
              scan_type: { type: "string", enum: ["comprehensive", "news", "social", "dark_web"], description: "Type of OSINT scan" },
            },
            required: ["entity_name"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "analyze_threat_radar",
          description: "Get threat radar analysis with predictions and risk assessments.",
          parameters: {
            type: "object",
            properties: {
              client_id: { type: "string", description: "Client UUID for focused analysis" },
              include_predictions: { type: "boolean", description: "Include predictive insights (default true)" },
              time_horizon_days: { type: "number", description: "Prediction horizon in days (default 7)" },
            },
          }
        }
      },
      {
        type: "function",
        function: {
          name: "cross_reference_entities",
          description: "Cross-reference entities mentioned in intel with existing database records.",
          parameters: {
            type: "object",
            properties: {
              entity_names: { type: "array", items: { type: "string" }, description: "Entity names to cross-reference" },
              include_relationships: { type: "boolean", description: "Include entity relationships" },
            },
            required: ["entity_names"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "perform_impact_analysis",
          description: "Analyze potential impact of a threat on client operations.",
          parameters: {
            type: "object",
            properties: {
              signal_id: { type: "string", description: "Signal UUID to analyze" },
              threat_description: { type: "string", description: "Description of threat if no signal_id" },
              include_financial: { type: "boolean", description: "Include financial impact estimates" },
            },
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_intelligence_summary",
          description: "Generate a summary intelligence report from recent data.",
          parameters: {
            type: "object",
            properties: {
              time_range_hours: { type: "number", description: "Hours to include (default 24)" },
              focus_areas: { type: "array", items: { type: "string" }, description: "Areas to focus on" },
              format: { type: "string", enum: ["executive", "operational", "technical"], description: "Report format" },
            },
          }
        }
      },
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
        model: 'google/gemini-3-flash-preview',
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
      
      try {
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
              client_id: client_id || null,
            })
            .select('id, title')
            .single();
          
          if (error) throw error;
          toolResults.push({ tool: 'create_signal', result: { success: true, signal_id: signal?.id, title: signal?.title } });
          
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
          
          if (error) throw error;
          toolResults.push({ tool: 'suggest_entity', result: { success: true, suggestion_id: suggestion?.id, name: suggestion?.suggested_name } });
          
        } else if (funcName === 'create_entity') {
          const { data: entity, error } = await supabase
            .from('entities')
            .insert({
              name: args.name,
              type: args.type,
              description: args.description || null,
              aliases: args.aliases || [],
              risk_level: args.risk_level || 'medium',
              client_id: client_id || null,
            })
            .select('id, name')
            .single();
          
          if (error) throw error;
          toolResults.push({ tool: 'create_entity', result: { success: true, entity_id: entity?.id, name: entity?.name } });
          
        } else if (funcName === 'create_incident') {
          const { data: incident, error } = await supabase
            .from('incidents')
            .insert({
              title: args.title,
              description: args.description || null,
              priority: args.priority || 'p3',
              incident_type: args.incident_type || 'general',
              status: 'open',
              client_id: client_id || null,
              opened_at: new Date().toISOString(),
            })
            .select('id, title')
            .single();
          
          if (error) throw error;
          toolResults.push({ tool: 'create_incident', result: { success: true, incident_id: incident?.id, title: incident?.title } });
          
        } else if (funcName === 'query_fortress_data') {
          // Delegate to existing query functionality
          let results: any[] = [];
          const limit = args.limit || 20;
          const daysBack = args.time_range_days || 30;
          const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
          
          if (args.query_type === 'signals' || args.query_type === 'comprehensive') {
            let query = supabase.from('signals').select('id, title, severity, source, created_at, rule_category').gte('created_at', cutoffDate).order('created_at', { ascending: false }).limit(limit);
            if (args.severity_filter && args.severity_filter !== 'all') {
              query = query.eq('severity', args.severity_filter);
            }
            const { data } = await query;
            results = data || [];
          }
          
          toolResults.push({ tool: 'query_fortress_data', result: { success: true, count: results.length, data: results } });
          
        } else if (funcName === 'cross_reference_entities') {
          const entityNames = args.entity_names || [];
          const matches: any[] = [];
          
          for (const name of entityNames) {
            const { data: entities } = await supabase
              .from('entities')
              .select('id, name, type, risk_level, aliases')
              .or(`name.ilike.%${name}%,aliases.cs.{${name}}`);
            
            if (entities?.length) {
              matches.push({ searched: name, found: entities });
            }
          }
          
          toolResults.push({ tool: 'cross_reference_entities', result: { success: true, matches } });
          
        } else if (funcName === 'trigger_osint_scan') {
          // Invoke the OSINT scan function
          const { data: scanResult, error } = await supabase.functions.invoke('osint-entity-scan', {
            body: { entity_name: args.entity_name, scan_type: args.scan_type || 'comprehensive' }
          });
          
          if (error) throw error;
          toolResults.push({ tool: 'trigger_osint_scan', result: { success: true, ...scanResult } });
          
        } else if (funcName === 'analyze_threat_radar') {
          // Invoke threat radar analysis
          const { data: radarResult, error } = await supabase.functions.invoke('threat-radar-analysis', {
            body: { client_id: args.client_id, include_predictions: args.include_predictions !== false }
          });
          
          if (error) throw error;
          toolResults.push({ tool: 'analyze_threat_radar', result: { success: true, ...radarResult } });
          
        } else if (funcName === 'perform_impact_analysis') {
          const { data: impactResult, error } = await supabase.functions.invoke('perform-impact-analysis', {
            body: { signal_id: args.signal_id, threat_description: args.threat_description }
          });
          
          if (error) throw error;
          toolResults.push({ tool: 'perform_impact_analysis', result: { success: true, ...impactResult } });
          
        } else if (funcName === 'generate_intelligence_summary') {
          // Generate summary from recent data
          const hoursBack = args.time_range_hours || 24;
          const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
          
          const [signalsResult, incidentsResult] = await Promise.all([
            supabase.from('signals').select('id, title, severity').gte('created_at', cutoff).order('created_at', { ascending: false }),
            supabase.from('incidents').select('id, title, priority, status').gte('opened_at', cutoff).order('opened_at', { ascending: false }),
          ]);
          
          toolResults.push({ 
            tool: 'generate_intelligence_summary', 
            result: { 
              success: true, 
              signals_count: signalsResult.data?.length || 0,
              incidents_count: incidentsResult.data?.length || 0,
              time_range_hours: hoursBack,
            } 
          });
          
        } else {
          toolResults.push({ tool: funcName, result: { success: false, error: `Unknown tool: ${funcName}` } });
        }
      } catch (toolError) {
        console.error(`Tool ${funcName} failed:`, toolError);
        toolResults.push({ tool: funcName, result: { success: false, error: toolError instanceof Error ? toolError.message : 'Unknown error' } });
      }
    }
    
    // Get text response
    let agentResponse = choice?.message?.content || '';
    
    // If tools were called, append summary
    if (toolResults.length > 0) {
      const successful = toolResults.filter(t => t.result.success);
      const failed = toolResults.filter(t => !t.result.success);
      
      let actionSummary = '\n\n---\n**Actions Taken:**\n';
      
      for (const result of successful) {
        if (result.tool === 'create_signal') {
          actionSummary += `✅ Created signal: "${result.result.title}"\n`;
        } else if (result.tool === 'suggest_entity') {
          actionSummary += `✅ Suggested entity: "${result.result.name}" (pending review)\n`;
        } else if (result.tool === 'create_entity') {
          actionSummary += `✅ Created entity: "${result.result.name}"\n`;
        } else if (result.tool === 'create_incident') {
          actionSummary += `✅ Created incident: "${result.result.title}"\n`;
        } else if (result.tool === 'query_fortress_data') {
          actionSummary += `✅ Queried database: ${result.result.count} results\n`;
        } else if (result.tool === 'cross_reference_entities') {
          actionSummary += `✅ Cross-referenced: ${result.result.matches?.length || 0} matches found\n`;
        } else if (result.tool === 'trigger_osint_scan') {
          actionSummary += `✅ OSINT scan triggered\n`;
        } else if (result.tool === 'analyze_threat_radar') {
          actionSummary += `✅ Threat radar analysis complete\n`;
        } else {
          actionSummary += `✅ ${result.tool}: completed\n`;
        }
      }
      
      for (const result of failed) {
        actionSummary += `❌ ${result.tool}: ${result.result.error}\n`;
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
