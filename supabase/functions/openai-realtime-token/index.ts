import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiting (per IP)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 10; // Max requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

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

serve(async (req) => {
  // Handle CORS preflight
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

    // Get client IP for rate limiting
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    
    // Check rate limit
    if (!checkRateLimit(clientIP)) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body for optional context
    let agentContext = '';
    let conversationHistory: Array<{ role: string; content: string }> = [];
    
    try {
      const body = await req.json();
      agentContext = body.agentContext || '';
      conversationHistory = body.conversationHistory || [];
    } catch {
      // No body or invalid JSON, continue with defaults
    }

    // Aegis — Calm Strategist persona with tool capabilities
    let instructions = `You are Aegis — a calm, strategic security advisor for the Fortress intelligence platform. Speak at a brisk, conversational pace (slightly faster than default) with shorter pauses between sentences. Sound human, not robotic. Keep answers tight: 1–3 sentences by default.

CRITICAL CAPABILITIES:
- You have access to tools for searching the web and Fortress database
- When users ask about current events, threats, or need research, USE the search_web tool
- When users ask about threat status, USE the get_current_threats tool
- When users ask about specific people, organizations, or entities, USE the get_entity_info tool

ALWAYS use tools when the user asks about:
- Current news or events ("what's happening with...", "latest on...")
- Threat assessments or security situations
- Information about people, organizations, or locations
- Any topic requiring current/factual information

After getting tool results, summarize them conversationally. Include source attribution when relevant. If data is historical, mention when the event occurred.

Structure responses as: What's happening → What matters → Best recommendation → One clear next step. If more detail is needed, ask: 'Want the longer version?' Never dramatize, never sell, never ramble.`;

    if (agentContext) {
      instructions += `\n\nCurrent context: ${agentContext}`;
    }

    if (conversationHistory.length > 0) {
      instructions += `\n\nPrevious conversation context:\n${conversationHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}`;
    }

    // Define tools for the realtime session
    const tools = [
      {
        type: 'function',
        name: 'search_web',
        description: 'Search the web and Fortress internal database for information about current events, threats, news, or any topic. Use this for any question requiring factual or current information.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query - what to look for'
            },
            geographic_focus: {
              type: 'string',
              description: 'Optional geographic focus (e.g., "British Columbia", "Canada", "North America")'
            }
          },
          required: ['query']
        }
      },
      {
        type: 'function',
        name: 'get_current_threats',
        description: 'Get current high-priority signals and open incidents from the Fortress system. Use when asked about current threat status, active incidents, or security situation.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        type: 'function',
        name: 'get_entity_info',
        description: 'Get information about a specific entity (person, organization, location) from the Fortress database.',
        parameters: {
          type: 'object',
          properties: {
            entity_name: {
              type: 'string',
              description: 'The name of the entity to look up'
            }
          },
          required: ['entity_name']
        }
      }
    ];

    console.log('Requesting ephemeral token from OpenAI with tools...');

    // Request ephemeral client secret from OpenAI
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        modalities: ['audio', 'text'],
        voice: 'verse',
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
    console.log('Ephemeral token created successfully');

    // Return the ephemeral client secret
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
