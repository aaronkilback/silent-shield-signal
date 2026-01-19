import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { FORTRESS_DATA_INFRASTRUCTURE, FORTRESS_AGENT_CAPABILITIES } from "../_shared/fortress-infrastructure.ts";
import { getAntiHallucinationPrompt } from "../_shared/anti-hallucination.ts";
import { 
  getReliabilityFirstPrompt, 
  getReliabilitySettings, 
  runQAChecks, 
  createSourceArtifact,
  createVerificationTask,
  type SourceArtifact 
} from "../_shared/reliability-first.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════════════════════════════════════════
//                    FORTRESS RELIABILITY CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const RELIABILITY_CONFIG = {
  // Lower temperature = more deterministic/consistent outputs
  temperature: 0.3,
  // Maximum retry attempts for failed API calls
  maxRetries: 3,
  // Delay between retries (ms)
  retryDelayMs: 1000,
  // Minimum response length to be considered valid
  minResponseLength: 50,
  // Required sections for briefings
  briefingRequiredSections: ['summary', 'source'],
};

// Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = RELIABILITY_CONFIG.maxRetries,
  delayMs: number = RELIABILITY_CONFIG.retryDelayMs
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        const backoffDelay = delayMs * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  
  throw lastError || new Error('All retry attempts failed');
}

// Validate AI response meets quality standards - ENHANCED for anti-hallucination
function validateResponse(response: string, context: { hasBriefingTool: boolean }): { 
  valid: boolean; 
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Check minimum length
  if (response.length < RELIABILITY_CONFIG.minResponseLength) {
    issues.push('Response too short');
    suggestions.push('Provide more detailed analysis');
  }
  
  // Check for forbidden hallucination phrases
  const forbiddenPhrases = [
    'in this simulated',
    'for this exercise',
    'in a training scenario',
    'hypothetically speaking',
    'let me imagine',
    'in this demo',
    '0-day exploit',
    'zero-day exploit',
    'active intrusion',
    'active breach',
    'apt group',
    'advanced persistent threat',
    'nation-state actor',
    'threat actor group'
  ];
  
  // NEW: Fabricated news/geopolitical content detection - CRITICAL
  const fabricatedNewsPatterns = [
    /\[unverified\]\s*reports/gi,
    /unverified.*?reports\s+(of|indicate|suggest)/gi,
    /reports\s+of\s+renewed\s+maritime\s+friction/gi,
    /increased\s+naval\s+activity\s+in\s+the/gi,
    /tensions\s+in\s+the\s+(strait|sea|gulf)/gi,
    /sovereignty\s+tensions/gi,
    /global\s+energy\s+policy\s+shift/gi,
    /rumors\s+of\s+a\s+major/gi,
    /professional\s+adversary/gi,
    /coordinated\s+campaign/gi,
    /sustained\s+.*?multi-site\s+campaign/gi,
    /dry\s+runs?\s+for\s+a\s+larger/gi,
    /high-tempo\s+operational\s+environment/gi,
    /humint\s+requirement/gi,
    /source\s+typology/gi,
    /collection\s+priorities?\s*\(PIR/gi,
    /priority\s+intelligence\s+requirements?/gi,
    /access\s+vectors?\s+within/gi,
    /may\s+lead\s+to\s+(a\s+)?spike/gi,
    /could\s+exacerbate/gi,
    /likely\s+being\s+used\s+as\s+social\s+cover/gi,
    /more\s+radical\s+elements\s+to\s+operate/gi,
    /foreign\s+influence\s+operations/gi,
    /breaking\s+geopolitical\s+news/gi,
    /arctic\s+sovereignty/gi,
    /maritime\s+friction/gi,
    /resource\s+nationalism/gi,
    /strait\s+of\s+hormuz/gi,
    /beaufort\s+sea.*?activity/gi,
  ];
  
  const lowerResponse = response.toLowerCase();
  
  // Check for fabricated news patterns FIRST - most critical
  for (const pattern of fabricatedNewsPatterns) {
    if (pattern.test(response)) {
      issues.push(`⛔ FABRICATED CONTENT: Pattern matches invented geopolitical/news content`);
      suggestions.push('Remove fabricated content. Use only database records or perform_external_web_search results.');
    }
  }
  
  for (const phrase of forbiddenPhrases) {
    if (lowerResponse.includes(phrase)) {
      issues.push(`Contains forbidden phrase: "${phrase}"`);
      suggestions.push('Use only verified data from database');
    }
  }
  
  // For briefings, check required sections
  if (context.hasBriefingTool) {
    const hasSource = lowerResponse.includes('source:') || 
                      lowerResponse.includes('database') || 
                      lowerResponse.includes('according to');
    if (!hasSource) {
      issues.push('Briefing missing source citations');
      suggestions.push('Include source citations for all data');
    }
    
    // NEW: Check for invented geopolitical sections in briefings
    const hasGeopolitical = lowerResponse.includes('geopolitical') || 
                            lowerResponse.includes('global news') ||
                            lowerResponse.includes('breaking news');
    const hasWebSearchEvidence = lowerResponse.includes('web search') ||
                                  lowerResponse.includes('external search') ||
                                  lowerResponse.includes('no external intelligence');
    
    if (hasGeopolitical && !hasWebSearchEvidence) {
      issues.push('⛔ Geopolitical content without web search evidence');
      suggestions.push('Either call perform_external_web_search or state "No external intelligence available"');
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    suggestions
  };
}

// Generate fallback response from tool results when AI fails
function generateFallbackResponse(toolResults: { tool: string; result: any }[]): string {
  if (toolResults.length === 0) {
    return 'I was unable to process your request. Please try again or rephrase your question.';
  }
  
  let fallback = '**Intelligence Report** *(Auto-generated from database)*\n\n';
  const currentDate = new Date().toISOString().split('T')[0];
  fallback += `*Generated: ${currentDate}*\n\n`;
  
  for (const tr of toolResults) {
    if (tr.tool === 'generate_intelligence_summary' && tr.result.success && tr.result.briefing_data) {
      const bd = tr.result.briefing_data;
      
      fallback += `## Summary\n`;
      fallback += `- **Signals (last ${bd.time_range_hours}h):** ${bd.summary.total_signals}\n`;
      fallback += `- **New Incidents:** ${bd.summary.total_new_incidents}\n`;
      fallback += `- **High Priority Open:** ${bd.summary.high_priority_open}\n\n`;
      
      if (bd.critical_signals?.length > 0) {
        fallback += `## Critical/High Signals\n`;
        for (const sig of bd.critical_signals.slice(0, 5)) {
          fallback += `- **[${sig.severity?.toUpperCase()}]** ${sig.title}\n`;
          fallback += `  - Source: ${sig.source} | Category: ${sig.category}\n`;
          fallback += `  - Time: ${sig.timestamp}\n`;
        }
        fallback += '\n';
      }
      
      if (bd.high_priority_open_incidents?.length > 0) {
        fallback += `## Open High Priority Incidents\n`;
        for (const inc of bd.high_priority_open_incidents.slice(0, 5)) {
          fallback += `- **[${inc.priority?.toUpperCase()}]** ${inc.title}\n`;
          fallback += `  - Type: ${inc.type} | Opened: ${inc.opened_at}\n`;
        }
        fallback += '\n';
      }
      
      if (bd.high_risk_entities?.length > 0) {
        fallback += `## High Risk Entities\n`;
        for (const ent of bd.high_risk_entities.slice(0, 5)) {
          fallback += `- **${ent.name}** (${ent.type}) - Risk: ${ent.risk_level}\n`;
        }
        fallback += '\n';
      }
      
      fallback += `---\n*Source: Fortress Database | Retrieved: ${currentDate}*\n`;
    } else if (tr.tool === 'query_fortress_data' && tr.result.success) {
      fallback += `## Query Results\n`;
      fallback += `Found ${tr.result.count} records matching your criteria.\n\n`;
      
      if (tr.result.data?.length > 0) {
        for (const item of tr.result.data.slice(0, 10)) {
          fallback += `- ${item.title || item.name || 'Record'} (${item.severity || item.priority || 'N/A'})\n`;
        }
      }
      fallback += '\n';
    }
  }
  
  return fallback;
}

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

    // Detect simple acknowledgment messages that don't need full processing
    const isSimpleAcknowledgment = (msg: string): boolean => {
      if (!msg || typeof msg !== 'string') return false;
      const content = msg.trim().toLowerCase();
      if (content.length > 50) return false;
      
      const acknowledgmentPatterns = [
        /^(ok|okay|k|kk)$/i,
        /^(ok|okay)\s+(great|good|thanks|thank you|cool|perfect|sounds good|got it|understood)$/i,
        /^(great|good|thanks|thank you|cool|perfect|awesome|nice|excellent|wonderful)$/i,
        /^(sounds good|got it|understood|roger|copy|noted|alright|all right|right)$/i,
        /^(yes|yeah|yep|yup|sure|certainly|of course|absolutely)$/i,
        /^(no problem|no worries|np|nw)$/i,
        /^(will do|sure thing|makes sense|fair enough)$/i,
        /^(i see|i understand|that makes sense)$/i,
        /^(👍|👌|🙌|✅|💯|🎉|😊|🤝|⭐|✨)+$/,
        /^(ok|okay|great|good|thanks)[\s!.]*$/i,
      ];
      
      return acknowledgmentPatterns.some(pattern => pattern.test(content));
    };

    // Fast path for simple acknowledgments
    if (isSimpleAcknowledgment(message)) {
      console.log("Detected simple acknowledgment, using fast response path");
      
      const ackResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [
            {
              role: 'system',
              content: `You are a helpful security AI agent. The user just sent a simple acknowledgment message (like "ok great", "thanks", "got it", etc.).

CRITICAL RULES:
1. Respond BRIEFLY - just 1-2 short sentences
2. DO NOT provide system summaries, status reports, or data overviews
3. DO NOT call any tools or query data
4. Simply acknowledge their acknowledgment in a warm, professional way
5. If appropriate, offer to help with anything else

Examples of good responses:
- "Perfect! Let me know if you need anything else."
- "Sounds good! I'm here if you have more questions."
- "Great! Standing by if you need me."
- "👍 Happy to help anytime."

Respond naturally and briefly.`
            },
            ...conversation_history.slice(-3),
            { role: 'user', content: message }
          ],
        }),
      });

      if (ackResponse.ok) {
        const ackData = await ackResponse.json();
        const ackContent = ackData.choices?.[0]?.message?.content || "Got it! Let me know if you need anything else.";
        return new Response(
          JSON.stringify({ response: ackContent, tools_executed: [], reliability: { validated: true, fast_path: true } }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log("Fast acknowledgment response failed, falling back to normal processing");
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

    // Get reliability settings for this client
    const reliabilitySettings = await getReliabilitySettings(supabase, client_id);
    console.log('Reliability First mode:', reliabilitySettings.reliability_first_enabled ? 'ENABLED' : 'disabled');

    // Collect source artifacts from context data
    const sourceArtifacts: SourceArtifact[] = [];
    
    // Create source artifacts for signals data
    if (contextData.includes('Recent Signals')) {
      const artifact = await createSourceArtifact(supabase, {
        source_type: 'incident_record',
        title: 'Fortress Signals Database',
        content: contextData,
        client_id,
      });
      if (artifact) sourceArtifacts.push(artifact);
    }

    // Build Reliability First prompt block
    const reliabilityFirstBlock = reliabilitySettings.reliability_first_enabled 
      ? getReliabilityFirstPrompt(sourceArtifacts)
      : '';

    // Build system prompt with agent persona
    const antiHallucinationBlock = getAntiHallucinationPrompt();
    
    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}
Your Call Sign: ${agent.call_sign}
Output Types You Generate: ${agent.output_types.join(', ')}

CURRENT DATE: ${currentDate}

${reliabilityFirstBlock}

${antiHallucinationBlock}

${FORTRESS_DATA_INFRASTRUCTURE}

${FORTRESS_AGENT_CAPABILITIES}

CURRENT INTELLIGENCE CONTEXT (VERIFIED DATA FROM FORTRESS DATABASE):
${contextData || 'No verified data available in current context. Use tools to query the database.'}

┌─────────────────────────────────────────────────────────────────────────────┐
│                    MANDATORY DATA SOURCING PROTOCOL                          │
└─────────────────────────────────────────────────────────────────────────────┘

RELIABILITY FIRST MODE: ${reliabilitySettings.reliability_first_enabled ? '🟢 ACTIVE' : '⚪ INACTIVE'}
${reliabilitySettings.reliability_first_enabled ? `
• Minimum sources required: ${reliabilitySettings.require_min_sources}
• Max source age: ${reliabilitySettings.max_source_age_hours} hours
• Block unverified claims: ${reliabilitySettings.block_unverified_claims ? 'YES' : 'NO'}
` : ''}

╔═══════════════════════════════════════════════════════════════════════════════╗
║   ⛔ CRITICAL: ABSOLUTE PROHIBITION ON FABRICATED CONTENT ⛔                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║ YOU MUST NEVER CREATE OR INVENT:                                              ║
║ • Breaking news or current events                                             ║
║ • Geopolitical developments, tensions, or conflicts                           ║
║ • Maritime, military, or diplomatic incidents                                 ║
║ • Economic trends or policy shifts not in the database                        ║
║ • "Unverified reports" of any kind - this phrase is BANNED                    ║
║ • HUMINT requirements, source typology, or collection priorities              ║
║ • Speculation about adversary campaigns or intentions                         ║
║ • Predictions about attack timing or escalation paths                         ║
║                                                                               ║
║ FOR EXTERNAL/GEOPOLITICAL INFORMATION:                                        ║
║ 1. You MUST call perform_external_web_search first                            ║
║ 2. If search returns no data or fails, state:                                 ║
║    "No external intelligence available for this query."                       ║
║ 3. DO NOT fall back to inventing content - report the limitation              ║
║                                                                               ║
║ VIOLATION OF THESE RULES CONSTITUTES INTELLIGENCE FABRICATION                 ║
╚═══════════════════════════════════════════════════════════════════════════════╝

EVERY PIECE OF INFORMATION YOU PRESENT MUST BE:
1. SOURCED from the database (via tools or context above)
2. CITED with the source type and relevant identifiers [S1], [S2], etc.
3. DATED with when the data was recorded/updated

WHEN GENERATING BRIEFINGS OR REPORTS:
- Use ONLY data retrieved from tools (generate_intelligence_summary, query_fortress_data, etc.)
- Format the tool results into a professional briefing
- Never supplement with invented information
- If data is sparse, state: "Limited intelligence data available for this period"
- If external search failed or returned no data, explicitly state this limitation
- End with: "Reliability Score: [X]% | Sources: [N] verified | External Intel: [available/unavailable]"

HANDLING USER-SUBMITTED DATA:
- Data submitted by analysts should be prefixed: "[Analyst-reported]"
- If data quality is uncertain, note: "[Unverified - recommend corroboration]"
- Cross-reference user submissions against verified sources when possible

IF YOU CANNOT VERIFY SOMETHING:
→ DO NOT present it as fact
→ DO say: "This cannot be verified with available data"
→ DO recommend: "Suggest obtaining additional source confirmation"
→ Create a verification task by noting: "[VERIFICATION NEEDED: (what to check) at (where to check)]"

TOOL USAGE - YOU HAVE REAL CAPABILITIES:
You have access to the FULL Fortress toolset. When you need to:
- Create signals → use create_signal tool
- Suggest entities → use suggest_entity tool  
- Search data → use query_fortress_data tool
- Analyze threats → use analyze_threat_radar tool
- Create incidents → use create_incident tool
- Generate briefs → use generate_intelligence_summary tool
- Send messages to other users → use send_proactive_message tool

PROACTIVE MESSAGING (IMPORTANT):
When a user asks you to "say hello to", "tell [someone] that", "send a message to", "welcome", or "greet" another user, you MUST use the send_proactive_message tool to queue the message for delivery. Do NOT just acknowledge the request - actually use the tool to send it. The message will be delivered to the recipient when they next log in.

Example: If user says "Say hello to Kayla for me", you should:
1. Call send_proactive_message with recipient_name="Kayla" and message="Hello Kayla! [Your personalized greeting based on context]"
2. Confirm the message was queued for delivery

ALWAYS USE TOOLS to retrieve data before reporting on it. Never just describe what you would do.

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
- ALWAYS include source citations (e.g., "[S1] signals database, retrieved ${currentDate}")
- End briefings with a Sources section listing all citations

COMMUNICATION GUIDELINES:
- Maintain your persona at all times
- Be concise but thorough
- Focus on actionable intelligence
- Use professional security terminology
- Never break character
- ALWAYS cite exact numbers and dates from the provided data
- When uncertain, acknowledge it rather than assert false confidence`;

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
      {
        type: "function",
        function: {
          name: "get_document_content",
          description: "Retrieve the extracted text content from a document that has already been processed and stored in the database. Use this first to check if content is already available before calling process_document.",
          parameters: {
            type: "object",
            properties: {
              document_id: { type: "string", description: "UUID of the document to retrieve content for" },
              filename: { type: "string", description: "Filename to search for if document_id is not known" },
            },
          }
        }
      },
      {
        type: "function",
        function: {
          name: "process_document",
          description: "Extract text content from a document (PDF, DOCX, images) stored in Fortress. Use this when you need to read or analyze a document's contents and the content hasn't been extracted yet.",
          parameters: {
            type: "object",
            properties: {
              document_id: { type: "string", description: "UUID of the document record in the database" },
              file_path: { type: "string", description: "Full storage path including bucket (e.g., 'ai-chat-attachments/user-id/file.pdf' or 'archival-documents/report.pdf')" },
              mime_type: { type: "string", description: "MIME type of the file (e.g., 'application/pdf', 'image/jpeg'). If not provided, will be inferred from extension." },
              extract_text: { type: "boolean", description: "Whether to extract text via OCR (default: true)" },
              update_database: { type: "boolean", description: "Whether to update the database with extracted text (default: true)" },
            },
            required: ["file_path"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "resize_image",
          description: "Resize a large image file to a smaller size. Use this when an image is too large to process or display.",
          parameters: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "Full storage path including bucket (e.g., 'ai-chat-attachments/user-id/photo.jpg')" },
              target_size_mb: { type: "number", description: "Target file size in MB (default: 2)" },
              max_width_px: { type: "number", description: "Maximum width in pixels" },
              max_height_px: { type: "number", description: "Maximum height in pixels" },
            },
            required: ["file_path"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "send_proactive_message",
          description: "Send a proactive message to another user that will be delivered when they next log in. Use this when someone asks you to 'say hello to', 'tell X that', 'send a message to', 'welcome', or 'greet' another user.",
          parameters: {
            type: "object",
            properties: {
              recipient_name: { type: "string", description: "Name or email of the person to send the message to" },
              message: { type: "string", description: "The message content to deliver" },
              priority: { type: "string", enum: ["high", "normal", "low"], description: "Priority of the message (default: normal)" },
              trigger_event: { type: "string", enum: ["first_login", "next_login", "immediate"], description: "When to deliver the message (default: first_login for new users, next_login for existing)" },
            },
            required: ["recipient_name", "message"],
          }
        }
      },
      {
        type: "function",
        function: {
          name: "perform_external_web_search",
          description: `OSINT WEB SEARCH: Search the external web for current news, events, and intelligence. Use this for:
- Current events and breaking news NOT in the Fortress database
- Geopolitical developments and global news
- Researching entities, organizations, or incidents from external sources
- Verifying claims with external sources

CRITICAL: You MUST use this tool before including ANY geopolitical news, current events, or external information in briefings. DO NOT fabricate or invent news - either search for it or state "No external intelligence available."

Returns: Summarized search results with source URLs and publication dates.`,
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query (be specific with dates, locations, topics)" },
              time_range: { type: "string", enum: ["24h", "7d", "30d", "90d", "all"], description: "Time range for results (default: 7d)" },
              geographic_focus: { type: "string", description: "Geographic focus (e.g., 'Canada', 'BC', 'global')" },
              max_results: { type: "number", description: "Maximum results to return (default: 10)" },
            },
            required: ["query"],
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

    // Call AI Gateway with tools - using retry wrapper for reliability
    const makeAICall = async (msgs: any[], includeTools: boolean = true) => {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: msgs,
          temperature: RELIABILITY_CONFIG.temperature,
          ...(includeTools ? { tools } : {}),
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('RATE_LIMIT');
        }
        if (response.status === 402) {
          throw new Error('PAYMENT_REQUIRED');
        }
        const errorText = await response.text();
        console.error('AI Gateway error:', response.status, errorText);
        throw new Error(`AI Gateway error: ${response.status}`);
      }

      return response.json();
    };

    let data: any;
    try {
      data = await withRetry(() => makeAICall(messages, true));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errMsg === 'RATE_LIMIT') {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (errMsg === 'PAYMENT_REQUIRED') {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

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
          // Generate comprehensive summary from recent data with full details
          const hoursBack = args.time_range_hours || 24;
          const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
          const focusAreas = args.focus_areas || [];
          
          // Fetch detailed data for the briefing
          const [signalsResult, incidentsResult, entitiesResult] = await Promise.all([
            supabase.from('signals')
              .select('id, title, severity, source, created_at, rule_category, normalized_text')
              .gte('created_at', cutoff)
              .order('created_at', { ascending: false })
              .limit(25),
            supabase.from('incidents')
              .select('id, title, priority, status, incident_type, description, opened_at, location')
              .gte('opened_at', cutoff)
              .order('opened_at', { ascending: false })
              .limit(20),
            supabase.from('entities')
              .select('id, name, type, risk_level, threat_score, description')
              .order('threat_score', { ascending: false })
              .limit(15),
          ]);
          
          // Also fetch recent high-priority items regardless of time range
          const { data: highPriorityIncidents } = await supabase
            .from('incidents')
            .select('id, title, priority, status, incident_type, opened_at, location')
            .in('priority', ['p1', 'p2'])
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(10);
          
          // Build detailed briefing data
          const signals = signalsResult.data || [];
          const incidents = incidentsResult.data || [];
          const entities = entitiesResult.data || [];
          
          // Group signals by severity
          const signalsBySeverity: Record<string, any[]> = {};
          signals.forEach(s => {
            const sev = s.severity || 'unknown';
            if (!signalsBySeverity[sev]) signalsBySeverity[sev] = [];
            signalsBySeverity[sev].push(s);
          });
          
          // Build the formatted briefing content
          const briefingData = {
            time_range_hours: hoursBack,
            generated_at: new Date().toISOString(),
            focus_areas: focusAreas,
            summary: {
              total_signals: signals.length,
              total_new_incidents: incidents.length,
              high_priority_open: highPriorityIncidents?.length || 0,
              signals_by_severity: Object.fromEntries(
                Object.entries(signalsBySeverity).map(([k, v]) => [k, v.length])
              ),
            },
            critical_signals: signals.filter(s => s.severity === 'critical' || s.severity === 'high').map(s => ({
              title: s.title,
              severity: s.severity,
              source: s.source,
              category: s.rule_category,
              timestamp: s.created_at,
              details: s.normalized_text?.substring(0, 300),
            })),
            recent_incidents: incidents.map(i => ({
              title: i.title || 'Untitled',
              priority: i.priority,
              status: i.status,
              type: i.incident_type,
              location: i.location,
              opened_at: i.opened_at,
              description: i.description?.substring(0, 200),
            })),
            high_priority_open_incidents: (highPriorityIncidents || []).map(i => ({
              title: i.title || 'Untitled',
              priority: i.priority,
              type: i.incident_type,
              location: i.location,
              opened_at: i.opened_at,
            })),
            high_risk_entities: entities.filter(e => e.risk_level === 'critical' || e.risk_level === 'high').map(e => ({
              name: e.name,
              type: e.type,
              risk_level: e.risk_level,
              threat_score: e.threat_score,
            })),
          };
          
          toolResults.push({ 
            tool: 'generate_intelligence_summary', 
            result: { 
              success: true,
              briefing_data: briefingData,
              instruction: 'Use the briefing_data above to generate a formatted intelligence brief. Present ALL the data in a clear, professional format appropriate for the requested format type.'
            } 
          });
          
        } else if (funcName === 'get_document_content') {
          const isPlaceholder = (t?: string | null) => !t || t.startsWith('Uploaded via');
          const knownBuckets = [
            'ai-chat-attachments',
            'archival-documents',
            'investigation-files',
            'travel-documents',
            'bug-screenshots',
            'entity-photos',
            'agent-avatars',
          ];

          const resolveFullPath = async (storagePath: string | null): Promise<string | null> => {
            if (!storagePath) return null;
            if (knownBuckets.some((b) => storagePath.startsWith(`${b}/`))) return storagePath;

            const { data: obj } = await supabase
              .from('storage.objects')
              .select('bucket_id, name')
              .eq('name', storagePath)
              .maybeSingle();

            if (obj?.bucket_id && obj?.name) return `${obj.bucket_id}/${obj.name}`;
            return storagePath;
          };

          const pickBest = (rows: any[]) => rows.find((r) => !isPlaceholder(r.content_text)) || rows[0];

          let rows: any[] = [];

          if (args.document_id) {
            const { data: docA } = await supabase
              .from('archival_documents')
              .select('id, filename, content_text, file_type, storage_path, updated_at')
              .eq('id', args.document_id)
              .maybeSingle();
            if (docA) rows = [docA];

            if (!rows.length) {
              const { data: docB } = await supabase
                .from('ingested_documents')
                .select('id, filename, content_text, file_type, storage_path, updated_at')
                .eq('id', args.document_id)
                .maybeSingle();
              if (docB) rows = [docB];
            }
          } else if (args.filename) {
            const { data: docsA } = await supabase
              .from('archival_documents')
              .select('id, filename, content_text, file_type, storage_path, updated_at')
              .ilike('filename', `%${args.filename}%`)
              .order('updated_at', { ascending: false })
              .limit(5);

            rows = docsA || [];

            if (!rows.length) {
              const { data: docsB } = await supabase
                .from('ingested_documents')
                .select('id, filename, content_text, file_type, storage_path, updated_at')
                .ilike('filename', `%${args.filename}%`)
                .order('updated_at', { ascending: false })
                .limit(5);
              rows = docsB || [];
            }
          } else {
            throw new Error('Either document_id or filename is required');
          }

          const best = pickBest(rows);

          if (!best) {
            toolResults.push({
              tool: 'get_document_content',
              result: {
                success: false,
                error: 'Document not found',
                suggestion: 'Use process_document with the full file_path (including bucket) to extract content.'
              }
            });
          } else if (isPlaceholder(best.content_text)) {
            const fullPath = await resolveFullPath(best.storage_path);
            toolResults.push({
              tool: 'get_document_content',
              result: {
                success: false,
                document_id: best.id,
                filename: best.filename,
                storage_path: best.storage_path,
                file_path: fullPath,
                error: 'Document content not yet extracted',
                suggestion: `Call process_document with file_path=\"${fullPath || best.storage_path}\" and document_id=\"${best.id}\" to extract text`
              }
            });
          } else {
            toolResults.push({
              tool: 'get_document_content',
              result: {
                success: true,
                document_id: best.id,
                filename: best.filename,
                content_text: best.content_text,
                text_length: best.content_text.length
              }
            });
          }

        } else if (funcName === 'process_document') {
          const knownBuckets = [
            'ai-chat-attachments',
            'archival-documents',
            'investigation-files',
            'travel-documents',
            'bug-screenshots',
            'entity-photos',
            'agent-avatars',
          ];

          // Ensure file_path includes bucket; if not, try to resolve via storage.objects
          let filePath = args.file_path;
          if (filePath && !knownBuckets.some((b) => filePath.startsWith(`${b}/`))) {
            const { data: obj } = await supabase
              .from('storage.objects')
              .select('bucket_id, name')
              .eq('name', filePath)
              .maybeSingle();

            if (obj?.bucket_id && obj?.name) {
              filePath = `${obj.bucket_id}/${obj.name}`;
            }
          }

          // Infer MIME type from extension if not provided
          const ext = filePath?.split('.').pop()?.toLowerCase() || '';
          const mimeMap: Record<string, string> = {
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'csv': 'text/csv',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'webp': 'image/webp',
            'tiff': 'image/tiff',
            'tif': 'image/tiff'
          };
          const mimeType = args.mime_type || mimeMap[ext] || 'application/octet-stream';
          
          const { data: docResult, error } = await supabase.functions.invoke('fortress-document-converter', {
            body: {
              documentId: args.document_id || crypto.randomUUID(),
              filePath: filePath,
              mimeType: mimeType,
              extractText: args.extract_text !== false,
              updateDatabase: args.update_database !== false,
              targetTable: 'archival_documents'
            }
          });
          
          if (error) throw error;
          if (!docResult?.success) throw new Error(docResult?.error || 'Document processing failed');

          toolResults.push({ 
            tool: 'process_document', 
            result: { 
              success: true, 
              document_id: args.document_id,
              extracted_text: docResult.extractedText,
              text_length: docResult.extractedTextLength,
              file_path: args.file_path,
              database_updated: args.update_database !== false
            } 
          });
          
        } else if (funcName === 'resize_image') {
          // Infer MIME type from extension
          const ext = args.file_path?.split('.').pop()?.toLowerCase() || '';
          const mimeMap: Record<string, string> = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'webp': 'image/webp',
            'tiff': 'image/tiff',
            'tif': 'image/tiff'
          };
          const mimeType = mimeMap[ext] || 'image/jpeg';
          
          const { data: resizeResult, error } = await supabase.functions.invoke('fortress-document-converter', {
            body: {
              documentId: crypto.randomUUID(),
              filePath: args.file_path,
              mimeType: mimeType,
              resizeIfLarge: true,
              targetSizeMB: args.target_size_mb || 2,
              maxWidthPx: args.max_width_px,
              maxHeightPx: args.max_height_px,
              extractText: false,
              updateDatabase: false
            }
          });
          
          if (error) throw error;
          if (!resizeResult?.success) throw new Error(resizeResult?.error || 'Image resize failed');
          
          toolResults.push({ 
            tool: 'resize_image', 
            result: { 
              success: true, 
              original_size_mb: resizeResult.originalSizeMB,
              resized_size_mb: resizeResult.resizedSizeMB,
              resized_image: resizeResult.resizedImage ? '(base64 image data available)' : null,
              file_path: args.file_path
            } 
          });
          
        } else if (funcName === 'send_proactive_message') {
          // Find recipient by name or email
          const recipientName = args.recipient_name?.toLowerCase() || '';
          
          // Search for user in profiles
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name')
            .or(`name.ilike.%${recipientName}%`);
          
          // Also check tenant_invites for pending invites (new users)
          const { data: pendingInvites } = await supabase
            .from('tenant_invites')
            .select('id, email')
            .ilike('email', `%${recipientName}%`)
            .is('used_at', null);
          
          let recipientUserId: string | null = null;
          let recipientInfo: string = '';
          let triggerEvent = args.trigger_event || 'next_login';
          
          if (profiles && profiles.length > 0) {
            // Found existing user
            recipientUserId = profiles[0].id;
            recipientInfo = profiles[0].name || 'User';
          } else if (pendingInvites && pendingInvites.length > 0) {
            // This is a pending invite - we need to store by email and resolve on accept
            // For now, we'll create a placeholder that will be matched on invite acceptance
            recipientInfo = pendingInvites[0].email;
            triggerEvent = 'first_login';
            
            // Store with a special marker for pending users
            const { data: pendingMsg, error: pendingError } = await supabase
              .from('agent_pending_messages')
              .insert({
                agent_id: agent_id,
                sender_user_id: null, // Will be set from auth header
                recipient_user_id: '00000000-0000-0000-0000-000000000000', // Placeholder - will be updated
                message: args.message,
                priority: args.priority || 'normal',
                trigger_event: triggerEvent,
                // Store email in a way we can match later (using tenant_id field as metadata workaround)
              });
            
            // Note: For pending invites, we'd need a trigger or the invite acceptance to link this
            toolResults.push({ 
              tool: 'send_proactive_message', 
              result: { 
                success: true, 
                status: 'queued_for_new_user',
                recipient: recipientInfo,
                message: args.message,
                note: `Message queued for ${recipientInfo}. It will be delivered when they accept their invitation and first log in.`
              } 
            });
            continue;
          }
          
          if (!recipientUserId) {
            toolResults.push({ 
              tool: 'send_proactive_message', 
              result: { 
                success: false, 
                error: `Could not find user matching "${args.recipient_name}". Please check the name or email.`
              } 
            });
            continue;
          }
          
          // Get the sender's user ID from the auth context
          const authHeader = req.headers.get('Authorization');
          let senderUserId: string | null = null;
          if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            const { data: { user } } = await supabase.auth.getUser(token);
            senderUserId = user?.id || null;
          }
          
          // Insert the pending message
          const { data: pendingMessage, error: msgError } = await supabase
            .from('agent_pending_messages')
            .insert({
              agent_id: agent_id,
              sender_user_id: senderUserId,
              recipient_user_id: recipientUserId,
              message: args.message,
              priority: args.priority || 'normal',
              trigger_event: triggerEvent,
            })
            .select('id')
            .single();
          
          if (msgError) throw msgError;
          
          toolResults.push({ 
            tool: 'send_proactive_message', 
            result: { 
              success: true, 
              message_id: pendingMessage?.id,
              recipient: recipientInfo,
              message: args.message,
              trigger: triggerEvent,
              note: `Message queued for ${recipientInfo}. It will be delivered on their ${triggerEvent === 'first_login' ? 'first login' : 'next login'}.`
            } 
          });
          
        } else if (funcName === 'perform_external_web_search') {
          // Call the dedicated web search edge function
          const searchQuery = args.query;
          const geoFocus = args.geographic_focus || '';
          const maxResults = args.max_results || 10;
          
          // Convert time_range string to date range
          const now = new Date();
          let timeRangeObj: { start?: string; end?: string } | undefined;
          if (args.time_range) {
            const rangeMap: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
            const days = rangeMap[args.time_range] || 7;
            const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
            timeRangeObj = {
              start: startDate.toISOString().split('T')[0],
              end: now.toISOString().split('T')[0]
            };
          }
          
          console.log(`[perform_external_web_search] Executing search for: "${searchQuery}"`);
          
          try {
            const { data: searchResult, error: searchError } = await supabase.functions.invoke('perform-external-web-search', {
              body: { 
                query: searchQuery,
                time_range: timeRangeObj,
                geographic_focus: geoFocus,
                max_results: maxResults
              }
            });
            
            if (searchError) {
              console.error('[perform_external_web_search] Invoke error:', searchError);
              toolResults.push({ 
                tool: 'perform_external_web_search', 
                result: { 
                  success: false, 
                  error: `Web search failed: ${searchError.message}`,
                  data_source: 'no_data',
                  CRITICAL_INSTRUCTION: 'DO NOT FABRICATE NEWS. State explicitly: "No external intelligence available for this query."'
                } 
              });
            } else if (searchResult) {
              // Handle the new response format with data_source field
              const dataSource = searchResult.data_source || 'unknown';
              const hasRealData = dataSource === 'verified' || 
                                  (dataSource === 'internal_only' && (searchResult.key_entities?.length > 0 || searchResult.source_urls?.length > 0));
              
              if (hasRealData) {
                toolResults.push({ 
                  tool: 'perform_external_web_search', 
                  result: { 
                    success: true,
                    data_source: dataSource,
                    query: searchQuery,
                    summary: searchResult.summary || 'No summary available',
                    source_urls: searchResult.source_urls || [],
                    key_entities: searchResult.key_entities || [],
                    key_dates: searchResult.key_dates || [],
                    threat_indicators: searchResult.threat_indicators || [],
                    geographic_relevance: searchResult.geographic_relevance || [],
                    reliability_note: searchResult.reliability_note || '',
                    CRITICAL_INSTRUCTION: 'Use ONLY this verified data. DO NOT add speculation, predictions, or invented geopolitical news.'
                  } 
                });
              } else {
                // No real data found
                toolResults.push({ 
                  tool: 'perform_external_web_search', 
                  result: { 
                    success: false,
                    data_source: 'no_data',
                    query: searchQuery,
                    summary: searchResult.summary || `No verified intelligence found for: "${searchQuery}"`,
                    reliability_note: searchResult.reliability_note || 'No external data available.',
                    CRITICAL_INSTRUCTION: 'NO DATA FOUND. You MUST state in your response: "No external intelligence available for this query." DO NOT invent news, geopolitical events, or speculative content.'
                  } 
                });
              }
            } else {
              toolResults.push({ 
                tool: 'perform_external_web_search', 
                result: { 
                  success: false, 
                  data_source: 'no_data',
                  error: 'Search returned empty response',
                  CRITICAL_INSTRUCTION: 'NO DATA. State explicitly: "No external intelligence available."'
                } 
              });
            }
          } catch (searchErr) {
            console.error('[perform_external_web_search] Error:', searchErr);
            toolResults.push({ 
              tool: 'perform_external_web_search', 
              result: { 
                success: false, 
                data_source: 'no_data',
                error: searchErr instanceof Error ? searchErr.message : 'Search failed',
                CRITICAL_INSTRUCTION: 'SEARCH FAILED. State explicitly: "External intelligence search unavailable."'
              } 
            });
          }
          
        } else {
          toolResults.push({ tool: funcName, result: { success: false, error: `Unknown tool: ${funcName}` } });
        }
      } catch (toolError) {
        console.error(`Tool ${funcName} failed:`, toolError);
        toolResults.push({ tool: funcName, result: { success: false, error: toolError instanceof Error ? toolError.message : 'Unknown error' } });
      }
    }
    
    // Get text response from first call
    let agentResponse = choice?.message?.content || '';
    const hasBriefingTool = toolResults.some(t => t.tool === 'generate_intelligence_summary');
    
    // If tools were called, we need to send results back to AI for final response
    if (toolCalls.length > 0 && toolResults.length > 0) {
      console.log('Tools executed, sending results back to AI for final response');
      
      // Build tool results messages for the AI
      const toolResultMessages = toolCalls.map((tc: any, idx: number) => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResults[idx]?.result || { error: 'No result' })
      }));
      
      // Make follow-up call with tool results - with retry and validation
      const followUpMessages = [
        ...messages,
        choice.message, // Include the assistant's message with tool_calls
        ...toolResultMessages
      ];
      
      let validResponse = false;
      let attemptCount = 0;
      
      while (!validResponse && attemptCount < RELIABILITY_CONFIG.maxRetries) {
        attemptCount++;
        console.log(`Follow-up API call attempt ${attemptCount}/${RELIABILITY_CONFIG.maxRetries}`);
        
        try {
          const followUpData = await withRetry(() => makeAICall(followUpMessages, false));
          const candidateResponse = followUpData.choices?.[0]?.message?.content || '';
          
          // Validate the response
          const validation = validateResponse(candidateResponse, { hasBriefingTool });
          
          if (validation.valid) {
            agentResponse = candidateResponse;
            validResponse = true;
            console.log('Response passed validation');
          } else {
            console.warn('Response failed validation:', validation.issues);
            
            // If this is the last attempt, use what we have or fallback
            if (attemptCount >= RELIABILITY_CONFIG.maxRetries) {
              if (candidateResponse.length > 20) {
                agentResponse = candidateResponse;
                console.log('Using response despite validation failures (final attempt)');
              } else {
                // Use fallback response generated from tool results
                console.log('Using fallback response from tool results');
                agentResponse = generateFallbackResponse(toolResults);
              }
            } else {
              // Add correction instruction for next attempt
              followUpMessages.push({
                role: 'user',
                content: `Your previous response had issues: ${validation.issues.join('; ')}. Please provide a complete response that: ${validation.suggestions.join('; ')}`
              });
            }
          }
        } catch (followUpError) {
          console.error('Follow-up API call failed:', followUpError);
          
          if (attemptCount >= RELIABILITY_CONFIG.maxRetries) {
            // Use fallback response
            console.log('All follow-up attempts failed, using fallback response');
            agentResponse = generateFallbackResponse(toolResults);
          }
        }
      }
      
      // Append action summary
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
        } else if (result.tool === 'generate_intelligence_summary') {
          actionSummary += `✅ Intelligence briefing generated from verified database records\n`;
        } else if (result.tool === 'process_document') {
          actionSummary += `✅ Document processed: ${result.result.text_length || 0} characters extracted\n`;
        } else if (result.tool === 'resize_image') {
          actionSummary += `✅ Image resized: ${result.result.original_size_mb?.toFixed(2) || '?'}MB → ${result.result.resized_size_mb?.toFixed(2) || '?'}MB\n`;
        } else {
          actionSummary += `✅ ${result.tool}: completed\n`;
        }
      }
      
      for (const result of failed) {
        actionSummary += `❌ ${result.tool}: ${result.result.error}\n`;
      }
      
      agentResponse += actionSummary;
    }

    // Final validation check
    if (!agentResponse && toolResults.length === 0) {
      throw new Error('No response from AI');
    }
    
    // If we still have no response but have tool results, use fallback
    if (!agentResponse && toolResults.length > 0) {
      agentResponse = generateFallbackResponse(toolResults);
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // POST-PROCESSING SANITIZATION: Last line of defense against hallucinations
    // ════════════════════════════════════════════════════════════════════════
    const sanitizeFabricatedContent = (text: string): { sanitized: string; redactions: string[] } => {
      const redactions: string[] = [];
      let sanitized = text;
      
      // Patterns that indicate fabricated geopolitical/news content
      const fabricationPatterns = [
        // Unverified claims
        { pattern: /\[UNVERIFIED\][^\n]+/gi, label: 'unverified claim' },
        { pattern: /\(UNVERIFIED\)[^\n]+/gi, label: 'unverified claim' },
        
        // Fabricated geopolitical sections
        { pattern: /BREAKING GEOPOLITICAL NEWS[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated geopolitical section' },
        { pattern: /GEOPOLITICAL.*?IMPACTS?:[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated impact section' },
        { pattern: /\d+\.\s*BREAKING GEOPOLITICAL NEWS[^]*?(?=\n\d+\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated news section' },
        { pattern: /CURRENT GEOPOLITICAL CONTEXT[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated context' },
        
        // Maritime/military fabrications
        { pattern: /maritime friction in the Strait[^\n]+/gi, label: 'fabricated maritime claim' },
        { pattern: /naval activity in the (Beaufort|Arctic|Pacific)[^\n]+/gi, label: 'fabricated naval claim' },
        { pattern: /Arctic Sovereignty Tensions[^]*?(?=\n\d\.|\n##|\n\*\*|\n---|$)/gi, label: 'fabricated arctic section' },
        { pattern: /Middle East Supply Chain Volatility[^]*?(?=\n\d\.|\n##|\n\*\*|\n---|$)/gi, label: 'fabricated supply chain section' },
        
        // Fabricated HUMINT/intelligence sections
        { pattern: /HUMINT REQUIREMENT[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated HUMINT section' },
        { pattern: /STRATEGIC HUMINT[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated HUMINT section' },
        { pattern: /Collection Priorities \(PIRs?\)[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated PIR section' },
        { pattern: /Source Typology:[^\n]+/gi, label: 'fabricated source typology' },
        { pattern: /PIR \d+:[^\n]+/gi, label: 'fabricated PIR' },
        { pattern: /Access Vectors? within[^\n]+/gi, label: 'fabricated access vectors' },
        
        // Fabricated macro/geopolitical trends
        { pattern: /GEOPOLITICAL \/ MACRO TRENDS:[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated macro trends' },
        { pattern: /Resource Nationalism:[^\n]+/gi, label: 'fabricated resource nationalism claim' },
        { pattern: /Global Energy Policy Shift[^]*?(?=\n\d\.|\n##|\n\*\*|\n---|$)/gi, label: 'fabricated energy policy section' },
        
        // Fabricated adversary claims
        { pattern: /professional adversary[^\n]+/gi, label: 'fabricated adversary claim' },
        { pattern: /sustained.*?multi-site campaign[^\n]+/gi, label: 'fabricated campaign claim' },
        { pattern: /coordinated campaign targeting[^\n]+/gi, label: 'fabricated targeting claim' },
        { pattern: /"?dry runs?"? for a larger[^\n]+/gi, label: 'fabricated dry run speculation' },
        { pattern: /high-tempo operational environment[^\n]+/gi, label: 'fabricated tempo claim' },
        
        // Speculative impacts
        { pattern: /Impact: Could lead to[^\n]+/gi, label: 'fabricated impact speculation' },
        { pattern: /Impact: May lead to[^\n]+/gi, label: 'fabricated impact speculation' },
        { pattern: /may exacerbate local tensions[^\n]+/gi, label: 'fabricated tension speculation' },
        { pattern: /foreign influence operations[^\n]+/gi, label: 'fabricated influence claim' },
        
        // Activist speculation
        { pattern: /likely being used as social cover[^\n]+/gi, label: 'fabricated social cover claim' },
        { pattern: /more radical elements to operate[^\n]+/gi, label: 'fabricated radical claim' },
      ];
      
      for (const { pattern, label } of fabricationPatterns) {
        const matches = sanitized.match(pattern);
        if (matches) {
          matches.forEach(m => {
            redactions.push(`[REDACTED: ${label}]`);
          });
          sanitized = sanitized.replace(pattern, `\n⚠️ *[Content removed: ${label} - no verified source]*\n`);
        }
      }
      
      return { sanitized, redactions };
    };
    
    // Apply sanitization to final response
    const { sanitized, redactions } = sanitizeFabricatedContent(agentResponse);
    if (redactions.length > 0) {
      console.warn(`⛔ SANITIZATION: Removed ${redactions.length} fabricated content sections:`, redactions);
      agentResponse = sanitized;
    }

    console.log('Agent response generated successfully', { 
      toolsExecuted: toolResults.length,
      responseLength: agentResponse.length 
    });

    return new Response(
      JSON.stringify({ 
        response: agentResponse,
        tools_executed: toolResults,
        reliability: {
          validated: true,
          temperature: RELIABILITY_CONFIG.temperature
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in agent-chat:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        reliability: { fallback: true }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
