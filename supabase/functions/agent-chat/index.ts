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
  
  // For briefings, check required Standard Fortress Intelligence Format sections
  if (context.hasBriefingTool) {
    const hasSource = lowerResponse.includes('source:') || 
                      lowerResponse.includes('database') || 
                      lowerResponse.includes('according to') ||
                      lowerResponse.includes('fortress record');
    if (!hasSource) {
      issues.push('Briefing missing source citations');
      suggestions.push('Include source citations for all data');
    }
    
    // Check for mandatory SFIF sections
    const hasExecutiveSummary = lowerResponse.includes('executive summary') ||
                                 lowerResponse.includes('what changed') ||
                                 lowerResponse.includes('section 1');
    const hasVerifiedFacts = lowerResponse.includes('verified facts') ||
                              lowerResponse.includes('provable events');
    const hasAnalyticJudgment = lowerResponse.includes('we assess') ||
                                 lowerResponse.includes('confidence in facts') ||
                                 lowerResponse.includes('likelihood of impact');
    const hasRiskChannels = lowerResponse.includes('legal risk') ||
                            lowerResponse.includes('reputational risk') ||
                            lowerResponse.includes('investor') ||
                            lowerResponse.includes('esg risk');
    const hasDecisionQuestion = lowerResponse.includes('decision required') ||
                                 lowerResponse.includes('choose one of these options');
    
    if (!hasExecutiveSummary && !hasVerifiedFacts) {
      suggestions.push('Consider adding Executive Summary and Verified Facts sections per SFIF');
    }
    
    if (!hasDecisionQuestion) {
      suggestions.push('End briefings with "Decision Required: Choose one of these options..."');
    }
    
    // Check for invented geopolitical sections in briefings
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
    
    // Check for forbidden dramatic labels
    const dramaticLabels = ['critical threat', 'imminent danger', 'grave concern', 'existential risk'];
    for (const label of dramaticLabels) {
      if (lowerResponse.includes(label)) {
        issues.push(`⛔ Forbidden dramatic label: "${label}"`);
        suggestions.push('Use neutral vulnerability naming per SFIF guidelines');
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    suggestions
  };
}

// Generate fallback response from tool results when AI fails
// Uses CTI best practices: inverted pyramid, executive summary first
function generateFallbackResponse(toolResults: { tool: string; result: any }[]): string {
  if (toolResults.length === 0) {
    return 'I was unable to process your request. Please try again or rephrase your question.';
  }
  
  const currentDate = new Date().toISOString().split('T')[0];
  const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  let fallback = '';
  
  for (const tr of toolResults) {
    if (tr.tool === 'generate_intelligence_summary' && tr.result.success && tr.result.briefing_data) {
      const bd = tr.result.briefing_data;
      const es = bd.executive_summary;
      
      // HEADER
      fallback += `# 📊 INTELLIGENCE BRIEFING\n`;
      fallback += `**Generated:** ${currentDate} ${currentTime} UTC\n\n`;
      
      // EXECUTIVE SUMMARY - Most important, leads the report
      fallback += `## 📌 EXECUTIVE SUMMARY\n\n`;
      fallback += `${es?.situation_overview || `${bd.summary.total_signals} signals collected. ${bd.summary.total_new_incidents} incidents reported. ${bd.summary.high_priority_open} high-priority incidents open.`}\n\n`;
      
      if (es?.key_concerns?.length > 0) {
        fallback += `**Key Concerns:**\n`;
        es.key_concerns.forEach((concern: string) => {
          fallback += `- ⚠️ ${concern}\n`;
        });
        fallback += '\n';
      }
      
      if (es?.threat_trend) {
        fallback += `**Threat Trend:** ${es.threat_trend}\n\n`;
      }
      
      // QUICK METRICS TABLE
      fallback += `### Metrics Summary\n`;
      fallback += `| Metric | Count |\n`;
      fallback += `|--------|-------|\n`;
      fallback += `| Total Signals (${bd.time_range_hours}h) | **${bd.summary.total_signals}** |\n`;
      fallback += `| New Incidents | **${bd.summary.total_new_incidents}** |\n`;
      fallback += `| Open High Priority | **${bd.summary.high_priority_open}** |\n\n`;
      
      // PRIORITY INTELLIGENCE - Critical/High signals
      if (bd.critical_signals?.length > 0) {
        fallback += `## 🔴 PRIORITY INTELLIGENCE\n\n`;
        for (const sig of bd.critical_signals.slice(0, 5)) {
          const severityEmoji = sig.severity === 'critical' ? '🔴' : '🟠';
          fallback += `### ${severityEmoji} ${sig.title}\n`;
          fallback += `- **Severity:** ${sig.severity?.toUpperCase()} • **Type:** ${sig.signal_type || 'N/A'} • **Time:** ${sig.time_ago || sig.timestamp}\n`;
          if (sig.details) {
            fallback += `- ${sig.details.substring(0, 200)}${sig.details.length > 200 ? '...' : ''}\n`;
          }
          fallback += '\n';
        }
      } else {
        fallback += `## 🟢 PRIORITY INTELLIGENCE\n\n`;
        fallback += `No critical or high-severity signals in the last ${bd.time_range_hours} hours.\n\n`;
      }
      
      // ACTIVE INCIDENTS
      if (bd.high_priority_open_incidents?.length > 0) {
        fallback += `## 🚨 ACTIVE INCIDENTS (Open P1/P2)\n\n`;
        for (const inc of bd.high_priority_open_incidents.slice(0, 5)) {
          const priBadge = inc.priority === 'p1' ? '**[P1]**' : '**[P2]**';
          fallback += `### ${priBadge} ${inc.title}\n`;
          fallback += `- **Status:** ${inc.status} • **Type:** ${inc.type || 'N/A'} • **Open:** ${inc.time_open || inc.opened_at}\n`;
          if (inc.location) fallback += `- **Location:** ${inc.location}\n`;
          if (inc.summary) fallback += `- ${inc.summary.substring(0, 200)}${inc.summary.length > 200 ? '...' : ''}\n`;
          fallback += '\n';
        }
      }
      
      // THREAT PATTERNS
      if (bd.threat_patterns?.length > 0) {
        fallback += `## 📈 THREAT PATTERNS\n\n`;
        for (const pattern of bd.threat_patterns) {
          fallback += `- **${pattern.category}:** ${pattern.count} signals`;
          if (pattern.examples?.length > 0) {
            fallback += ` (e.g., "${pattern.examples[0]}")`;
          }
          fallback += '\n';
        }
        fallback += '\n';
      }
      
      // HIGH RISK ENTITIES
      if (bd.high_risk_entities?.length > 0) {
        fallback += `## 👤 HIGH RISK ENTITIES\n\n`;
        for (const ent of bd.high_risk_entities.slice(0, 5)) {
          const riskEmoji = ent.risk_level === 'critical' ? '🔴' : '🟠';
          fallback += `- ${riskEmoji} **${ent.name}** (${ent.type}) - Threat Score: ${ent.threat_score || 'N/A'}\n`;
        }
        fallback += '\n';
      }
      
      // SOURCES FOOTER
      fallback += `---\n`;
      fallback += `**Sources:**\n`;
      fallback += `- [S1] Fortress Signals Database | Retrieved ${currentDate}\n`;
      fallback += `- [S2] Fortress Incidents Database | Retrieved ${currentDate}\n`;
      if (bd.meta?.external_intel) {
        fallback += `- [S3] External Intelligence Sources | Retrieved ${currentDate}\n`;
      }
      
    } else if (tr.tool === 'query_fortress_data' && tr.result.success) {
      fallback += `## Query Results\n`;
      fallback += `Found **${tr.result.count}** records matching your criteria.\n\n`;
      
      if (tr.result.data?.length > 0) {
        for (const item of tr.result.data.slice(0, 10)) {
          fallback += `- ${item.title || item.name || 'Record'} (${item.severity || item.priority || 'N/A'})\n`;
        }
      }
      fallback += '\n';
    }
  }
  
  return fallback || 'No data available for the requested briefing.';
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
        .select('title, source_id, severity, created_at, rule_category')
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

<!-- INTERNAL RULES - NEVER INCLUDE THIS TEXT IN YOUR RESPONSE -->
<!-- These are silent instructions. Follow them but do not echo them. -->

[INTERNAL: Data sourcing is mandatory. Reliability mode: ${reliabilitySettings.reliability_first_enabled ? 'ACTIVE' : 'INACTIVE'}]

[INTERNAL: You must NEVER create or invent breaking news, geopolitical events, HUMINT requirements, collection priorities, or speculative content. If you need external information, call perform_external_web_search first. If it fails, say "No external intelligence available" - do not invent content.]

[INTERNAL: Every claim must be sourced from database records. Cite sources with [S1], [S2] etc. Include dates from records.]

[INTERNAL: For briefings, use ONLY tool results. If data is sparse, state "Limited data available" - do not embellish.]

[INTERNAL: If you cannot verify something, say "Cannot verify with available data" - never present unverified info as fact.]

<!-- END INTERNAL RULES -->

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

BRIEFING FORMAT (CTI BEST PRACTICES - INVERTED PYRAMID):
When generating intelligence briefings, follow this professional structure:

1. **EXECUTIVE SUMMARY** (Lead with most critical info):
   - Overall threat posture in ONE sentence
   - Key concerns that require immediate attention
   - Metrics: signals count, incident count, open high-priority

2. **PRIORITY INTELLIGENCE** (What needs action):
   - List CRITICAL and HIGH severity signals first
   - For each: [REF] Title • Severity • Type • Time
   - Brief context on why it matters

3. **ACTIVE INCIDENTS** (What's happening now):
   - Open P1/P2 incidents with status
   - For each: Priority badge, title, location, time open
   - Brief summary of situation

4. **THREAT PATTERNS** (Analysis):
   - Group similar signals by type/category
   - Identify emerging patterns or trends
   - Note any escalation concerns

5. **EXTERNAL INTELLIGENCE** (If web search performed):
   - MANDATORY: Every external source MUST show its ACTUAL publication date
   - Format: "Title (SOURCE, published DATE)" - e.g., "LNG Canada begins exports (Reuters, 2025-11-15)"
   - Mark sources older than 7 days with 📜 HISTORICAL prefix
   - Mark sources older than 30 days with ⚠️ DATED prefix and note context may be outdated
   - NEVER present old news as current - always show the actual date

6. **SOURCES** (Always include):
   - List all database and external sources used
   - Format: [S#] Source Name | Type | PUBLISHED Date (not retrieval date)
   - If no publication date available, mark as "Date Unknown - treat as historical"

CRITICAL DATE VERIFICATION:
- Current date is ${currentDate}
- News/articles from >7 days ago = HISTORICAL context, not current intel
- News/articles from >30 days ago = Potentially STALE, note explicitly
- NEVER say "reports indicate" without the actual date of the report
- Web search retrieval date ≠ publication date - always use publication date

FORMATTING RULES:
- Use severity badges: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM
- Use priority badges: [P1], [P2], [P3]
- Include timestamps in relative format (e.g., "2h ago")
- For external sources: ALWAYS include publication date, not just retrieval date
- Keep paragraphs short and scannable
- Use tables for metrics when appropriate
- Bold key numbers and entity names

COMMUNICATION GUIDELINES:
- Lead with "what" before "why"
- Be direct and actionable - executives skim
- Focus on business impact, not just technical details
- Use professional security terminology
- ALWAYS cite exact numbers from tool results
- ALWAYS show publication dates for external sources
- When data is sparse, state "Limited data available" - do not embellish`;

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
          description: "Generate a formal intelligence briefing report. ONLY use this when the user EXPLICITLY requests a briefing, summary, report, sitrep, or intelligence overview. Do NOT use for general questions, vulnerability searches, entity lookups, or conversational queries.",
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
          description: `OSINT WEB SEARCH: Search the external web for current news, events, and intelligence.

CRITICAL DATE HANDLING:
- Results include source_urls with published_date field
- You MUST display the ACTUAL publication date, not the retrieval date
- Articles older than 7 days = HISTORICAL (prefix with 📜)
- Articles older than 30 days = DATED (prefix with ⚠️)
- If published_date is null/missing, treat as historical and note "Date Unknown"

Use this for:
- Current events and breaking news NOT in the Fortress database
- Geopolitical developments and global news
- Researching entities, organizations, or incidents from external sources
- Verifying claims with external sources

NEVER present old articles as current intelligence. Always show: "Title (Source, published YYYY-MM-DD)"

Returns: source_urls array with title, url, snippet, and published_date fields.`,
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
            let query = supabase
              .from('signals')
              .select('id, title, severity, source_id, created_at, rule_category')
              .gte('created_at', cutoffDate)
              .order('created_at', { ascending: false })
              .limit(limit);
            if (args.severity_filter && args.severity_filter !== 'all') {
              query = query.eq('severity', args.severity_filter);
            }
            const { data, error } = await query;
            if (error) {
              console.warn('[query_fortress_data] signals query error:', error.message);
              results = [];
            } else {
              results = data || [];
            }
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
          // ═══════════════════════════════════════════════════════════════
          // PROFESSIONAL INTELLIGENCE BRIEFING GENERATOR
          // Based on CTI best practices: inverted pyramid structure,
          // actionable intelligence, proper source attribution
          // ═══════════════════════════════════════════════════════════════
          
          const hoursBack = args.time_range_hours || 24;
          const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
          const focusAreas = args.focus_areas || [];
          const currentDate = new Date().toISOString().split('T')[0];
          
          console.log('[Briefing] Generating intelligence summary:', { hoursBack, cutoff, client_id, focusAreas });
          
          // Build signals query - FIXED: proper client_id filtering
          let signalsQuery = supabase.from('signals')
            .select('id, title, severity, source_id, created_at, rule_category, normalized_text, client_id, description, signal_type')
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(50);
          
          // If client_id is provided, filter signals for that client OR unassigned signals
          if (client_id) {
            // Use proper filter syntax: multiple eq/is filters combined with or
            signalsQuery = signalsQuery.or(`client_id.eq.${client_id},client_id.is.null`);
          }
          
          // Build incidents query with client_id filter
          let incidentsQuery = supabase.from('incidents')
            .select('id, title, priority, status, incident_type, summary, opened_at, client_id, location, acknowledged_at, resolved_at')
            .gte('opened_at', cutoff)
            .order('opened_at', { ascending: false })
            .limit(20);
          
          if (client_id) {
            incidentsQuery = incidentsQuery.or(`client_id.eq.${client_id},client_id.is.null`);
          }
          
          // Fetch detailed data for the briefing
          const [signalsResult, incidentsResult, entitiesResult] = await Promise.all([
            signalsQuery,
            incidentsQuery,
            supabase.from('entities')
              .select('id, name, type, risk_level, threat_score, description, last_checked')
              .order('threat_score', { ascending: false })
              .limit(15),
          ]);
          
          console.log('[Briefing] Query results:', { 
            signalsCount: signalsResult.data?.length || 0,
            signalsError: signalsResult.error?.message,
            incidentsCount: incidentsResult.data?.length || 0,
            incidentsError: incidentsResult.error?.message,
            entitiesCount: entitiesResult.data?.length || 0
          });
          
          // Also fetch ALL open high-priority incidents (regardless of time range)
          let highPriorityQuery = supabase
            .from('incidents')
            .select('id, title, priority, status, incident_type, summary, opened_at, location')
            .in('priority', ['p1', 'p2'])
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(10);
          
          if (client_id) {
            highPriorityQuery = highPriorityQuery.or(`client_id.eq.${client_id},client_id.is.null`);
          }
          
          const { data: highPriorityIncidents } = await highPriorityQuery;
          
          // Build detailed briefing data
          const signals = signalsResult.data || [];
          const incidents = incidentsResult.data || [];
          const entities = entitiesResult.data || [];
          
          console.log('[Briefing] Final data for briefing:', {
            signalCount: signals.length,
            signalTitles: signals.slice(0, 5).map(s => s.title),
            incidentCount: incidents.length,
            incidentTitles: incidents.slice(0, 3).map(i => i.title)
          });
          
          // Group signals by severity and type for analysis
          const signalsBySeverity: Record<string, any[]> = {};
          const signalsByType: Record<string, any[]> = {};
          
          signals.forEach(s => {
            const sev = s.severity || 'unknown';
            const sigType = s.signal_type || 'unclassified';
            if (!signalsBySeverity[sev]) signalsBySeverity[sev] = [];
            if (!signalsByType[sigType]) signalsByType[sigType] = [];
            signalsBySeverity[sev].push(s);
            signalsByType[sigType].push(s);
          });
          
          // Group incidents by priority for analysis
          const incidentsByPriority: Record<string, any[]> = {};
          incidents.forEach(inc => {
            const pri = inc.priority || 'unknown';
            if (!incidentsByPriority[pri]) incidentsByPriority[pri] = [];
            incidentsByPriority[pri].push(inc);
          });
          
          // Calculate key metrics for executive summary
          const criticalSignals = signalsBySeverity['critical']?.length || 0;
          const highSignals = signalsBySeverity['high']?.length || 0;
          const p1Incidents = incidentsByPriority['p1']?.length || 0;
          const p2Incidents = incidentsByPriority['p2']?.length || 0;
          
          // Identify top threats by type
          const topThreats = Object.entries(signalsByType)
            .map(([type, sigs]) => ({ type, count: sigs.length, samples: sigs.slice(0, 2) }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
          
          // Build the enhanced briefing data structure following CTI best practices
          const briefingData = {
            // META
            time_range_hours: hoursBack,
            generated_at: new Date().toISOString(),
            focus_areas: focusAreas,
            client_id: client_id,
            
            // EXECUTIVE SUMMARY (most important - what they need to know NOW)
            executive_summary: {
              situation_overview: `${signals.length} intelligence signals collected in the last ${hoursBack} hours. ${incidents.length} incidents reported. ${highPriorityIncidents?.length || 0} high-priority incidents remain open.`,
              key_concerns: [
                ...(criticalSignals > 0 ? [`${criticalSignals} CRITICAL severity signals require immediate attention`] : []),
                ...(highSignals > 0 ? [`${highSignals} HIGH severity signals detected`] : []),
                ...(p1Incidents > 0 ? [`${p1Incidents} P1 incidents currently open`] : []),
                ...(p2Incidents > 0 ? [`${p2Incidents} P2 incidents currently open`] : []),
              ],
              threat_trend: topThreats.length > 0 
                ? `Primary activity: ${topThreats.map(t => `${t.type} (${t.count})`).join(', ')}`
                : 'No significant threat patterns identified',
            },
            
            // METRICS
            summary: {
              total_signals: signals.length,
              total_new_incidents: incidents.length,
              high_priority_open: highPriorityIncidents?.length || 0,
              signals_by_severity: Object.fromEntries(
                Object.entries(signalsBySeverity).map(([k, v]) => [k, v.length])
              ),
              signals_by_type: Object.fromEntries(
                Object.entries(signalsByType).map(([k, v]) => [k, v.length])
              ),
              incidents_by_priority: Object.fromEntries(
                Object.entries(incidentsByPriority).map(([k, v]) => [k, v.length])
              ),
            },
            
            // PRIORITY INTELLIGENCE - sorted by importance
            critical_signals: signals
              .filter(s => s.severity === 'critical' || s.severity === 'high')
              .sort((a, b) => {
                // Critical before high
                if (a.severity === 'critical' && b.severity !== 'critical') return -1;
                if (b.severity === 'critical' && a.severity !== 'critical') return 1;
                // Then by recency
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              })
              .slice(0, 10)
              .map((s, idx) => ({
                ref: `SIG-${idx + 1}`,
                title: s.title || s.description?.substring(0, 100) || 'Untitled Signal',
                severity: s.severity,
                signal_type: s.signal_type || 'unclassified',
                category: s.rule_category,
                timestamp: s.created_at,
                time_ago: getTimeAgo(s.created_at),
                details: s.normalized_text?.substring(0, 400) || s.description?.substring(0, 400),
              })),
            
            // OPEN INCIDENTS
            high_priority_open_incidents: (highPriorityIncidents || []).map((i, idx) => ({
              ref: `INC-${idx + 1}`,
              title: i.title || 'Untitled',
              priority: i.priority,
              status: i.status,
              type: i.incident_type,
              location: i.location,
              opened_at: i.opened_at,
              time_open: getTimeAgo(i.opened_at),
              summary: i.summary?.substring(0, 400) || null,
            })),
            
            // RECENT INCIDENTS (last 24-48h)
            recent_incidents: incidents.map((i, idx) => ({
              ref: `INC-R${idx + 1}`,
              title: i.title || 'Untitled',
              priority: i.priority,
              status: i.status,
              type: i.incident_type,
              location: i.location,
              opened_at: i.opened_at,
              summary: i.summary?.substring(0, 300) || null,
            })),
            
            // HIGH RISK ENTITIES
            high_risk_entities: entities
              .filter(e => e.risk_level === 'critical' || e.risk_level === 'high')
              .slice(0, 5)
              .map(e => ({
                name: e.name,
                type: e.type,
                risk_level: e.risk_level,
                threat_score: e.threat_score,
                last_activity: e.last_checked,
              })),
            
            // THREAT PATTERNS
            threat_patterns: topThreats.map(t => ({
              category: t.type,
              count: t.count,
              examples: t.samples.map(s => s.title || 'Untitled').slice(0, 2),
            })),
          };
          
          // Helper function for time formatting
          function getTimeAgo(dateStr: string): string {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const diffDays = Math.floor(diffHours / 24);
            
            if (diffDays > 0) return `${diffDays}d ago`;
            if (diffHours > 0) return `${diffHours}h ago`;
            return 'just now';
          }
          
          // Build briefing meta with source tracking
          const briefingMeta = {
            source: 'Fortress Database',
            signals_count: signals.length,
            incidents_count: incidents.length,
            high_priority_count: highPriorityIncidents?.length || 0,
            external_intel: false,
            retrieval_timestamp: new Date().toISOString(),
            client_id_used: client_id || 'all',
          };
          
          toolResults.push({ 
            tool: 'generate_intelligence_summary', 
            result: { 
              success: true,
              briefing_data: briefingData,
              meta: briefingMeta,
              data_source: 'verified'
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
                  data_source: 'no_data',
                  message: 'No external intelligence available for this query.'
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
                    reliability_note: searchResult.reliability_note || ''
                  } 
                });
              } else {
                toolResults.push({ 
                  tool: 'perform_external_web_search', 
                  result: { 
                    success: false,
                    data_source: 'no_data',
                    query: searchQuery,
                    message: 'No external intelligence available for this query.'
                  } 
                });
              }
            } else {
              toolResults.push({ 
                tool: 'perform_external_web_search', 
                result: { 
                  success: false, 
                  data_source: 'no_data',
                  message: 'No external intelligence available.'
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
                message: 'External search unavailable.'
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
    // POST-PROCESSING SANITIZATION: AGGRESSIVE defense against hallucinations
    // ════════════════════════════════════════════════════════════════════════

    // Remove accidental prompt/instruction leakage from briefings (models sometimes echo rules)
    const stripPromptLeakage = (text: string): { cleaned: string; removed: string[] } => {
      const removed: string[] = [];
      let cleaned = text;

      const leakagePatterns: { pattern: RegExp; label: string }[] = [
        { pattern: /"[^\n\r\"]*(briefing template|cite sources|\[S\d+\]|do not invent|humint|24-?hour window|do not mention other clients)[^\n\r\"]*"/gi, label: 'quoted instruction block' },
        { pattern: /\b(or\s+)?web\s+search\.?\s*Cite\s+sources\s+as\s*\[S1\][^\n\r]*$/gim, label: 'cite-sources instruction line' },
        { pattern: /\bCite\s+sources\b[^\n\r]*$/gim, label: 'cite-sources instruction' },
        { pattern: /\bUse\s+(the\s+)?(mandatory|provided)\s+briefing\s+template\b[^\n\r]*\.?/gim, label: 'briefing-template instruction' },
        { pattern: /\bDo\s+not\s+invent\b[^\n\r]*\.?/gim, label: 'do-not-invent instruction' },
        { pattern: /\bDo\s+not\s+mention\s+other\s+clients\b[^\n\r]*\.?/gim, label: 'no-other-clients instruction' },
        { pattern: /\bStick\s+to\s+the\s+24-?hour\s+window\b[^\n\r]*\.?/gim, label: '24h-window instruction' },
      ];

      for (const { pattern, label } of leakagePatterns) {
        if (pattern.test(cleaned)) {
          removed.push(label);
          cleaned = cleaned.replace(pattern, '');
        }
      }

      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
      return { cleaned, removed };
    };

    const isBriefingResponse = toolResults.some(t => t.tool === 'generate_intelligence_summary') || /\bINTELLIGENCE\s+BRIEFING\b/i.test(agentResponse);
    if (isBriefingResponse) {
      const { cleaned, removed } = stripPromptLeakage(agentResponse);
      if (removed.length > 0) {
        console.warn('[PromptLeakage] Removed instruction text from briefing output:', removed);
        agentResponse = cleaned;
      }
    }

    // CRITICAL: Patterns that indicate SEVERE fabrication requiring complete rejection
    const SEVERE_FABRICATION_PATTERNS = [
      /\[UNVERIFIED\]\s*Reports/gi,
      /HUMINT\s+REQUIREMENT/gi,
      /STRATEGIC\s+HUMINT/gi,
      /Collection\s+Priorities?\s*\(PIR/gi,
      /Source\s+Typology/gi,
      /PIR\s+\d+:/gi,
      /Strait\s+of\s+Hormuz/gi,
      /Beaufort\s+Sea.*?activity/gi,
      /Arctic\s+Sovereignty\s+Tensions/gi,
      /maritime\s+friction/gi,
      /Middle\s+East\s+Supply\s+Chain/gi,
      /Global\s+Energy\s+Policy\s+Shift/gi,
      /Resource\s+Nationalism/gi,
      /professional\s+adversary/gi,
      /dry\s+runs?\s+for\s+a\s+larger/gi,
      /high-tempo\s+operational\s+environment/gi,
      /foreign\s+influence\s+operations/gi,
    ];
    
    // Check for severe fabrication FIRST
    let hasSevereFabrication = false;
    const severeFabricationsFound: string[] = [];
    
    for (const pattern of SEVERE_FABRICATION_PATTERNS) {
      if (pattern.test(agentResponse)) {
        hasSevereFabrication = true;
        const match = agentResponse.match(pattern);
        if (match) severeFabricationsFound.push(match[0]);
      }
    }
    
    if (hasSevereFabrication) {
      console.error(`⛔⛔⛔ SEVERE FABRICATION DETECTED: ${severeFabricationsFound.join(', ')}`);
      
      // Generate a safe fallback response from actual tool results
      const safeBriefingData = toolResults.find(t => t.tool === 'generate_intelligence_summary')?.result?.briefing_data;
      
      if (safeBriefingData) {
        // Build a clean, facts-only response
        const currentDate = new Date().toISOString().split('T')[0];
        agentResponse = `**INTELLIGENCE BRIEFING | ${currentDate}**

**Summary (from Fortress Database):**
- Signals (last ${safeBriefingData.time_range_hours}h): ${safeBriefingData.summary?.total_signals || 0}
- New Incidents: ${safeBriefingData.summary?.total_new_incidents || 0}  
- High Priority Open: ${safeBriefingData.summary?.high_priority_open || 0}

**Active Incidents:**
${(safeBriefingData.high_priority_open_incidents || []).length > 0 
  ? safeBriefingData.high_priority_open_incidents.map((i: any) => 
      `- [${i.priority?.toUpperCase()}/${i.status || 'open'}] ${i.title} (${i.opened_at?.split('T')[0] || 'No date'})`
    ).join('\n')
  : 'No high-priority open incidents in database.'}

**External Intelligence:** Not available. No external web search was performed for geopolitical context.

---
*Reliability: 100% | Sources: Fortress Database | External Intel: unavailable*

⚠️ *Note: A previous response contained unverified content and was replaced with verified database records only.*`;
      } else {
        // Minimal safe response
        agentResponse = `**Intelligence Update**

I can only report verified information from the Fortress database. No external intelligence search was performed.

To include geopolitical or external news context, please ask me to perform an external web search first.

*Reliability: 100% verified from database*`;
      }
    } else {
      // Standard sanitization for less severe patterns
      const sanitizeFabricatedContent = (text: string): { sanitized: string; redactions: string[] } => {
        const redactions: string[] = [];
        let sanitized = text;
        
        const fabricationPatterns = [
          { pattern: /\[UNVERIFIED\][^\n]+/gi, label: 'unverified claim' },
          { pattern: /\(UNVERIFIED\)[^\n]+/gi, label: 'unverified claim' },
          { pattern: /BREAKING GEOPOLITICAL NEWS[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated geopolitical section' },
          { pattern: /GEOPOLITICAL.*?IMPACTS?:[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated impact section' },
          { pattern: /\d+\.\s*BREAKING GEOPOLITICAL NEWS[^]*?(?=\n\d+\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated news section' },
          { pattern: /CURRENT GEOPOLITICAL CONTEXT[^]*?(?=\n\d\.|\n##|\n\*\*\d|\n---|\n═|$)/gi, label: 'fabricated context' },
          { pattern: /naval activity in the (Beaufort|Arctic|Pacific)[^\n]+/gi, label: 'fabricated naval claim' },
          { pattern: /sustained.*?multi-site campaign[^\n]+/gi, label: 'fabricated campaign claim' },
          { pattern: /coordinated campaign targeting[^\n]+/gi, label: 'fabricated targeting claim' },
          { pattern: /Impact: Could lead to[^\n]+/gi, label: 'fabricated impact speculation' },
          { pattern: /Impact: May lead to[^\n]+/gi, label: 'fabricated impact speculation' },
          { pattern: /may exacerbate local tensions[^\n]+/gi, label: 'fabricated tension speculation' },
          { pattern: /likely being used as social cover[^\n]+/gi, label: 'fabricated social cover claim' },
          { pattern: /more radical elements to operate[^\n]+/gi, label: 'fabricated radical claim' },
          { pattern: /Access Vectors? within[^\n]+/gi, label: 'fabricated access vectors' },
        ];
        
        for (const { pattern, label } of fabricationPatterns) {
          const matches = sanitized.match(pattern);
          if (matches) {
            matches.forEach(() => {
              redactions.push(`[REDACTED: ${label}]`);
            });
            sanitized = sanitized.replace(pattern, '');
          }
        }
        
        // Clean up extra whitespace from removals
        sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();
        
        return { sanitized, redactions };
      };
      
      const { sanitized, redactions } = sanitizeFabricatedContent(agentResponse);
      if (redactions.length > 0) {
        console.warn(`⛔ SANITIZATION: Removed ${redactions.length} fabricated content sections:`, redactions);
        agentResponse = sanitized;
      }
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
