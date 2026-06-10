import { AEGIS_CORE_IDENTITY, AEGIS_VOICE_MODIFIERS, ANTI_FABRICATION_RULES, TOOL_USAGE_GUIDANCE, AEGIS_CAPABILITY_MANIFEST, getTimeContext } from "../_shared/aegis-persona.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiting (per IP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    
    if (!checkRateLimit(clientIP)) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let agentContext = '';
    let conversationHistory: Array<{ role: string; content: string }> = [];
    
    try {
      const body = await req.json();
      agentContext = body.agentContext || '';
      conversationHistory = body.conversationHistory || [];
    } catch {
      // No body or invalid JSON, continue with defaults
    }

    // Build unified AEGIS persona for voice
    const timeContext = getTimeContext();
    
    let instructions = `${AEGIS_CORE_IDENTITY}

${AEGIS_VOICE_MODIFIERS}

═══ CURRENT TIME ═══
${timeContext.full}

${AEGIS_CAPABILITY_MANIFEST}

${ANTI_FABRICATION_RULES}

${TOOL_USAGE_GUIDANCE}

═══ AVAILABLE TOOLS ═══
You have full access to Fortress intelligence via tools. Use them proactively:

📊 DATA: get_current_threats, get_entity_info, query_fortress_data, generate_intelligence_summary, analyze_threat_radar
🌐 RESEARCH: search_web, query_legal_database  
📋 OPERATIONS: get_client_info, get_knowledge_base, get_travel_status, get_investigation_status
🧠 MEMORY: get_user_memory, remember_this, update_user_preferences, manage_project_context
🌍 EXPERTISE: query_expert_knowledge (world-class frameworks: MITRE ATT&CK, NIST, ISO 31030, ASIS, CISA KEV)
📡 TECH RADAR: query_fortress_data on tech_radar_recommendations (emerging security tech, adoption playbooks)

WHEN TO USE:
• "What threats?" → get_current_threats
• "Tell me about [name]" → get_entity_info
• "Search for [topic]" → query_fortress_data
• "Give me a briefing" → generate_intelligence_summary
• "What's our threat level?" → analyze_threat_radar
• "News about [topic]?" → search_web
• "Remember this" → remember_this
• "Best practices for X" / "What framework" → query_expert_knowledge
• "What new tech should we look at?" → query_fortress_data on tech_radar_recommendations
• "Summarize / brief me on [report]" / "What's in the [report]?" / "What were the risks in [report]?" → get_document_content, then brief it BLUF

📄 REPORTS: get_document_content — fetch the FULL TEXT of a specific stored report so you can actually read and summarize it. Always call it before summarizing a named report; never summarize from memory.

═══ REPORT BRIEFING FORMAT — BLUF ═══
When you brief or summarize a report you retrieved with get_document_content, deliver it like an intelligence officer — Bottom Line Up Front, calm and concise:
• BLUF — one or two sentences: the single most important judgment first.
• KEY POINTS — 3 to 5 crisp findings drawn from the document.
• RISK / IMPLICATIONS — what it means for the client.
• GAPS / CONFIDENCE — what the document does not cover, and your confidence.
Ground every point strictly in the retrieved text. If get_document_content returns content_available=false, say plainly that the report isn't fully processed yet and do NOT summarize its contents — never invent findings.`;

    if (agentContext) {
      instructions += `\n\n═══ SESSION CONTEXT ═══\n${agentContext}`;
    }

    if (conversationHistory.length > 0) {
      instructions += `\n\n═══ RECENT CONVERSATION ═══\n${conversationHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}`; 
    }

    // Define all tools matching chat agent capabilities
    const tools = [
      {
        type: 'function',
        name: 'search_web',
        description: 'Search the web for current events, news, threats, or any topic. Use for questions requiring external/current information.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            geographic_focus: { type: 'string', description: 'Geographic focus (e.g., "British Columbia", "Canada")' }
          },
          required: ['query']
        }
      },
      {
        type: 'function',
        name: 'get_current_threats',
        description: 'Get current high-priority signals and open incidents. Use when asked about current threat status, active incidents, or security situation.',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      {
        type: 'function',
        name: 'get_entity_info',
        description: 'Get information about a specific entity (person, organization, location) from the Fortress database.',
        parameters: {
          type: 'object',
          properties: {
            entity_name: { type: 'string', description: 'The name of the entity to look up' }
          },
          required: ['entity_name']
        }
      },
      {
        type: 'function',
        name: 'query_legal_database',
        description: 'Query for legal information including case law, statutes, regulations, and compliance requirements.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The legal topic to research' },
            jurisdiction: { type: 'string', description: 'The legal jurisdiction (e.g., "British Columbia", "Canada federal")' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Additional keywords' }
          },
          required: ['topic']
        }
      },
      {
        type: 'function',
        name: 'query_fortress_data',
        description: 'Search Fortress database for signals, incidents, entities, or documents matching criteria.',
        parameters: {
          type: 'object',
          properties: {
            query_type: { type: 'string', enum: ['signals', 'incidents', 'entities', 'documents', 'comprehensive'], description: 'Type of data to query' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search for' },
            time_range_days: { type: 'number', description: 'Days to look back (default 30)' },
            severity_filter: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'], description: 'Filter by severity' },
            limit: { type: 'number', description: 'Max results (default 20)' }
          },
          required: ['query_type']
        }
      },
      {
        type: 'function',
        name: 'get_document_content',
        description: 'Fetch the full text of a specific stored report or document so you can read and summarize it. Use whenever the user asks to summarize, brief, or explain the contents of a named report. Then brief it BLUF (bottom line up front). Pass the report name or distinctive keywords as `query`.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Report name or distinctive keywords, e.g. "May 29 2020 special security report" or "Petronas special security report"' }
          },
          required: ['query']
        }
      },
      {
        type: 'function',
        name: 'generate_intelligence_summary',
        description: 'Generate a formal intelligence briefing. Use when user asks for a briefing, summary, sitrep, or intelligence overview.',
        parameters: {
          type: 'object',
          properties: {
            time_range_hours: { type: 'number', description: 'Hours to include (default 24)' },
            focus_areas: { type: 'array', items: { type: 'string' }, description: 'Areas to focus on' },
            format: { type: 'string', enum: ['executive', 'operational', 'technical'], description: 'Report format' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'analyze_threat_radar',
        description: 'Get threat radar analysis with overall threat level, patterns, and risk assessments.',
        parameters: {
          type: 'object',
          properties: {
            client_id: { type: 'string', description: 'Client UUID for focused analysis' },
            include_predictions: { type: 'boolean', description: 'Include predictive insights' },
            time_horizon_days: { type: 'number', description: 'Prediction horizon in days' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'create_entity',
        description: 'Propose a new entity to track (person, vehicle, organization, location). Goes to the analyst approval queue. Use when the operator says to add or start tracking someone/something. Confirm the name back before calling.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Entity name, e.g. a person, "black Ford F-150 plate ABC123", or an org' },
            type: { type: 'string', description: 'person | vehicle | organization | location' },
            description: { type: 'string', description: 'Why it matters / context' }
          },
          required: ['name']
        }
      },
      {
        type: 'function',
        name: 'update_entity',
        description: 'Update an existing tracked entity: set risk level, enable/disable monitoring, adjust threat score, or update description. Use when the operator asks to flag or change an existing person/vehicle/org.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the existing entity (partial match ok)' },
            risk_level: { type: 'string', description: 'low | medium | high | critical' },
            active_monitoring_enabled: { type: 'boolean', description: 'Turn monitoring on or off' },
            threat_score: { type: 'number', description: 'Threat score 0-10' },
            description: { type: 'string', description: 'Updated description' }
          },
          required: ['name']
        }
      },
      {
        type: 'function',
        name: 'get_client_info',
        description: 'Get information about a specific client including their signals, incidents, and monitoring status.',
        parameters: {
          type: 'object',
          properties: {
            client_name: { type: 'string', description: 'The client name to look up' }
          },
          required: ['client_name']
        }
      },
      {
        type: 'function',
        name: 'get_knowledge_base',
        description: 'Search the internal knowledge base for articles, procedures, and documentation.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic to search for' },
            category: { type: 'string', description: 'Category filter' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'get_travel_status',
        description: 'Get current travel status including active travelers, itineraries, and travel alerts.',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      {
        type: 'function',
        name: 'get_investigation_status',
        description: 'Get status of ongoing investigations.',
        parameters: {
          type: 'object',
          properties: {
            investigation_name: { type: 'string', description: 'Investigation name to search for (optional)' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'get_user_memory',
        description: 'Retrieve the user\'s persistent memory context (preferences, active projects, remembered facts).',
        parameters: {
          type: 'object',
          properties: {
            current_client_id: { type: 'string', description: 'Optional current client context to prioritize client-scoped memory' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'remember_this',
        description: 'Save important information to persistent memory (key facts, decisions, preferences).',
        parameters: {
          type: 'object',
          properties: {
            memory_type: { type: 'string', enum: ['summary', 'key_fact', 'preference', 'decision'] },
            content: { type: 'string', description: 'The information to remember (concise but complete)' },
            context_tags: { type: 'array', items: { type: 'string' } },
            importance_score: { type: 'number', description: '1-10 (default 5)' },
            client_id: { type: 'string', description: 'Optional: associate memory with a client' },
            expires_in_days: { type: 'number', description: 'Optional: expire after N days' }
          },
          required: ['memory_type', 'content']
        }
      },
      {
        type: 'function',
        name: 'update_user_preferences',
        description: 'Update user preferences for communication style/format/timezone and custom settings.',
        parameters: {
          type: 'object',
          properties: {
            communication_style: { type: 'string' },
            preferred_format: { type: 'string' },
            role_context: { type: 'string' },
            timezone: { type: 'string' },
            language_preference: { type: 'string' },
            custom_preferences: { type: 'object' }
          },
          required: []
        }
      },
      {
        type: 'function',
        name: 'manage_project_context',
        description: 'Create/update/pause/complete a project in the user\'s persistent context.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'complete', 'pause'] },
            project_id: { type: 'string' },
            project_name: { type: 'string' },
            project_description: { type: 'string' },
            key_details: { type: 'object' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            client_id: { type: 'string' }
          },
          required: ['action']
        }
      },
      {
        type: 'function',
        name: 'query_expert_knowledge',
        description: 'Query the World Knowledge Engine for authoritative security expertise (MITRE ATT&CK, NIST, ISO, ASIS, CISA). Use when asked about best practices, frameworks, standards, methodology, or "how should we..."',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The expertise question' },
            domain: { type: 'string', enum: ['cyber_security', 'physical_security', 'executive_protection', 'crisis_management', 'threat_intelligence', 'travel_security', 'compliance_governance', 'geopolitical_analysis'] },
            include_live_search: { type: 'boolean', description: 'Include live web research (default: true)' }
          },
          required: ['question']
        }
      },
      {
        type: 'function',
        name: 'get_tech_radar',
        description: 'Get Technology Radar recommendations — emerging security technologies with relevance scores and adoption playbooks. Use when asked about new tech, modernization, or what to adopt.',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Technology category filter' },
            min_relevance: { type: 'number', description: 'Minimum relevance score 0-1 (default: 0.5)' }
          },
          required: []
        }
      }
    ];

    console.log('Requesting ephemeral token from OpenAI with full tool set...');

    // GA Realtime API: ephemeral keys are minted at /v1/realtime/client_secrets
    // (the old beta /v1/realtime/sessions path now 404s). Session config is nested
    // under `session`, audio config moved under session.audio.{input,output},
    // and `modalities` became `output_modalities`.
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime-2025-08-28',
          output_modalities: ['audio'],
          instructions: instructions,
          audio: {
            input: {
              transcription: { model: 'whisper-1' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.8,
                prefix_padding_ms: 300,
                silence_duration_ms: 1100,
                create_response: true
              }
            },
            output: { voice: 'ash' }
          },
          tools: tools,
          tool_choice: 'auto'
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'Invalid OpenAI API key' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to create realtime session', details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Ephemeral token created successfully with', tools.length, 'tools');

    // GA response is flat: { value: 'ek_...', expires_at, session: {...} }.
    // Preserve the prior response contract so the client keeps reading client_secret.value.
    const ephemeralValue = data?.value ?? data?.client_secret?.value ?? data?.client_secret ?? null;
    const ephemeralExpiry = data?.expires_at ?? data?.client_secret?.expires_at ?? null;
    return new Response(
      JSON.stringify({
        client_secret: { value: ephemeralValue, expires_at: ephemeralExpiry },
        expires_at: ephemeralExpiry,
        session_id: data?.session?.id ?? data?.id ?? null
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in openai-realtime-token:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
