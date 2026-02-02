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

    // AEGIS — Unified persona matching the chat interface
    const currentDate = new Date().toISOString().split('T')[0];
    
    let instructions = `You are AEGIS, the advanced AI command intelligence assistant for the FORTRESS security platform. Your name stands for Active Enterprise Guardian & Intelligence System. You are the same AEGIS that users interact with via text chat — this is simply the voice interface.

VOICE STYLE:
- Speak at a brisk, conversational pace with natural pauses
- Sound professional but approachable — like an experienced analyst briefing a colleague
- Keep answers tight: 1–3 sentences by default. Offer "want the longer version?" for complex topics
- Never sound robotic. Use natural filler words sparingly ("so", "right", "now")

CURRENT DATE: ${currentDate}

YOUR CAPABILITIES - USE TOOLS PROACTIVELY:
You have access to the full Fortress intelligence platform via tools. Use them whenever relevant:

📊 DATA ACCESS:
- get_current_threats: Get active high-priority signals and open incidents
- get_entity_info: Look up people, organizations, locations in the database
- query_fortress_data: Search signals, incidents, entities, documents by keywords
- generate_intelligence_summary: Create a formal briefing report
- analyze_threat_radar: Get overall threat level and patterns

🌐 EXTERNAL RESEARCH:
- search_web: Search the internet for current news, events, intelligence
- query_legal_database: Research case law, statutes, regulations

📋 OPERATIONAL DATA:
- get_client_info: Look up client details, their signals and incidents
- get_knowledge_base: Search internal knowledge articles and procedures
- get_travel_status: Check traveler locations, itineraries, travel alerts
- get_investigation_status: Get status of ongoing investigations

🧠 PERSISTENT MEMORY:
- get_user_memory: Retrieve saved preferences/projects/facts
- remember_this: Save a key fact/decision/preference for next time
- update_user_preferences: Update communication/format preferences
- manage_project_context: Track ongoing projects (create/update/pause/complete)

WHEN TO USE TOOLS:
- "What threats do we have?" → get_current_threats
- "Tell me about [entity name]" → get_entity_info
- "Search for signals about [topic]" → query_fortress_data with keywords
- "Give me a briefing" → generate_intelligence_summary
- "What's our threat level?" → analyze_threat_radar
- "What's happening with [news topic]?" → search_web
- "Look up case law on [topic]" → query_legal_database
- "Status of [client name]" → get_client_info
- "What's our procedure for [topic]?" → get_knowledge_base
- "Where are our travelers?" → get_travel_status
- "What investigations are open?" → get_investigation_status
- "Remember this" / "save this" → remember_this
- "My preference is..." → update_user_preferences
- "I'm working on..." → manage_project_context

AFTER GETTING TOOL RESULTS:
- Summarize conversationally — don't read raw data
- Include source attribution and dates when relevant
- If data is historical, clearly mention when the event occurred
- For legal information, always add "this is not legal advice"
- Distinguish between "current threats" and "historical context"

ANTI-FABRICATION RULES (CRITICAL):
- NEVER invent news, threats, incidents, signals, or legal information
- If search returns nothing, say "I don't have current information on that"
- Report only what the tools return — no speculation or embellishment
- For legal queries with no results, recommend consulting a legal professional
- Never claim to have found something that wasn't in the tool results

Structure responses as: What's happening → What matters → Recommendation → Next step. Never dramatize. Never ramble.`;

    if (agentContext) {
      instructions += `\n\nCurrent context: ${agentContext}`;
    }

    if (conversationHistory.length > 0) {
      instructions += `\n\nPrevious conversation context:\n${conversationHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}`;
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
      }
    ];

    console.log('Requesting ephemeral token from OpenAI with full tool set...');

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        modalities: ['audio', 'text'],
        voice: 'ash',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        instructions: instructions,
        tools: tools,
        tool_choice: 'auto',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
          create_response: true
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

    return new Response(
      JSON.stringify({
        client_secret: data.client_secret,
        expires_at: data.expires_at,
        session_id: data.id
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
