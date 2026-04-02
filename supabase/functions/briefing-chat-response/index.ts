import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { validateString, validateUUID, validateAll } from "../_shared/input-validation.ts";
import {
  getAntiHallucinationPrompt,
  getCriticalDateContext,
  generateVerifiedDataContext,
  categorizeIncidentsByAge,
  validateAIOutput,
} from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { briefing_id, agent_id, user_message, parent_message_id, is_group_question, scope } = await req.json();

    // Input validation
    const inputValidation = validateAll(
      validateUUID(briefing_id, 'briefing_id', true),
      validateUUID(agent_id, 'agent_id', true),
      validateString(user_message, 'user_message', { required: true, maxLength: 20000 }),
      validateUUID(parent_message_id, 'parent_message_id'),
    );
    if (!inputValidation.valid) {
      return new Response(
        JSON.stringify({ error: inputValidation.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('Briefing chat response request:', { briefing_id, agent_id, is_group_question, scope });

    // AI calls route through callAiGateway → OpenAI (GEMINI_API_KEY guard removed)

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
    if (isSimpleAcknowledgment(user_message)) {
      console.log("Detected simple acknowledgment in briefing chat, using fast response path");
      
      const ackResult = await callAiGateway({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a security briefing AI agent. The user just sent a simple acknowledgment message (like "ok great", "thanks", "got it").

CRITICAL RULES:
1. Respond BRIEFLY - just 1-2 short sentences
2. DO NOT provide briefing summaries, incident reports, or data overviews
3. Simply acknowledge their acknowledgment professionally
4. Offer to continue with the briefing if needed

Examples: "Understood. Ready when you are." / "Perfect, let me know what else you'd like to cover." / "👍 Standing by."

Respond naturally and briefly.`
          },
          { role: 'user', content: user_message }
        ],
        functionName: 'briefing-chat-response',
      });

      if (ackResult.content) {
        return new Response(
          JSON.stringify({ response: ackResult.content, agent_id }),
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

    // Fetch briefing session
    const { data: briefing } = await supabase
      .from('briefing_sessions')
      .select('*')
      .eq('id', briefing_id)
      .single();

    // Fetch workspace to infer scope when the UI doesn't pass incident/investigation IDs
    const { data: workspace } = briefing?.workspace_id
      ? await supabase
          .from('investigation_workspaces')
          .select('id, title, incident_id, investigation_id')
          .eq('id', briefing.workspace_id)
          .maybeSingle()
      : { data: null as any };

    const effectiveScope = {
      incident_id: scope?.incident_id || briefing?.incident_id || workspace?.incident_id || null,
      investigation_id: scope?.investigation_id || briefing?.investigation_id || workspace?.investigation_id || null,
      scope_title: scope?.scope_title || workspace?.title || null,
    };

    // Build scope context data
    let scopeContextData = '';
    let scopeDescription = '';

    // Verified context used to hard-anchor dates/counts and prevent persistent hallucinations
    let verifiedP1P2Incidents: any[] = [];
    let verifiedContextBlock = '';
    let knownOpenedDates: string[] = [];
    let jan14_2026_p1p2_count = 0;

    const normalizeOpenedAt = (row: any): string | null => {
      const v = row?.opened_at || row?.created_at;
      return typeof v === 'string' ? v : null;
    };

    const buildVerifiedBlock = () => {
      const normalized = (verifiedP1P2Incidents || [])
        .map((i) => ({ ...i, opened_at: normalizeOpenedAt(i) }))
        .filter((i) => !!i.opened_at);

      knownOpenedDates = normalized.map((i) => (i.opened_at as string).slice(0, 10));
      jan14_2026_p1p2_count = knownOpenedDates.filter((d) => d === '2026-01-14').length;

      const categorized = categorizeIncidentsByAge(normalized);

      verifiedContextBlock = [
        generateVerifiedDataContext({ incidents: normalized, label: 'P1/P2 incidents (scope)' }),
        `\n=== VERIFIED CONSTRAINTS (P1/P2 incidents for this scope) ===`,
        `Count: ${normalized.length}`,
        `Opened on 2026-01-14: ${jan14_2026_p1p2_count}`,
        `Age summary: ${categorized.summary}`,
        `RULE: You MUST NOT mention incidents opened on 2026-01-14 unless "Opened on 2026-01-14" is > 0.`,
        `RULE: You MUST NOT claim "seven" (or any other number) of P1/P2 incidents unless it matches Count exactly.`,
        `=== END VERIFIED CONSTRAINTS ===`,
      ].join('\n');
    };

    const loadClientP1P2Incidents = async (clientId: string) => {
      const { data, error } = await supabase
        .from('incidents')
        .select('id, title, summary, priority, status, opened_at, created_at, client_id')
        .eq('client_id', clientId)
        .in('priority', ['P1', 'P2'])
        .limit(50);

      if (error) {
        console.warn('Failed to load client P1/P2 incidents:', error);
        verifiedP1P2Incidents = [];
        return;
      }

      verifiedP1P2Incidents = data || [];
    };

    // Fetch incident-specific context if scoped to an incident
    if (effectiveScope.incident_id) {
      const { data: incident } = await supabase
        .from('incidents')
        .select('*, clients(name), signals(normalized_text, category, severity, location, source_url, raw_json)')
        .eq('id', effectiveScope.incident_id)
        .single();

      if (incident) {
        scopeDescription = `Incident: ${incident.title || incident.summary || effectiveScope.incident_id}`;
        scopeContextData += `\n\n=== INCIDENT SCOPE ===`;
        scopeContextData += `\nIncident ID: ${incident.id}`;
        scopeContextData += `\nTitle: ${incident.title || 'N/A'}`;
        scopeContextData += `\nSummary: ${incident.summary || 'N/A'}`;
        scopeContextData += `\nPriority: ${incident.priority}`;
        scopeContextData += `\nStatus: ${incident.status}`;
        scopeContextData += `\nOpened At: ${normalizeOpenedAt(incident) || 'N/A'}`;
        scopeContextData += `\nClient: ${incident.clients?.name || 'Unknown'}`;
        if (incident.signals) {
          const sig = incident.signals;
          const sourceUrl = sig.source_url || sig.raw_json?.url || sig.raw_json?.source_url || sig.raw_json?.link || null;
          scopeContextData += `\nOriginating Signal: ${sig.normalized_text?.substring(0, 300) || 'N/A'}`;
          scopeContextData += `\nSignal Category: ${sig.category || 'N/A'}`;
          scopeContextData += `\nSignal Severity: ${sig.severity || 'N/A'}`;
          scopeContextData += `\nLocation: ${sig.location || 'N/A'}`;
          scopeContextData += `\nSource URL: ${sourceUrl || 'Internal record (no public URL)'}`;
        }
        if (incident.timeline_json?.length) {
          scopeContextData += `\n\nTimeline Events:`;
          incident.timeline_json.slice(-5).forEach((event: any) => {
            scopeContextData += `\n- [${event.timestamp}] ${event.event || event.action}: ${event.details?.substring(0, 150) || ''}`;
          });
        }

        // Fetch related entities for this incident
        const { data: entityMentions } = await supabase
          .from('entity_mentions')
          .select('entities(name, type, description)')
          .eq('incident_id', effectiveScope.incident_id)
          .limit(10);

        if (entityMentions?.length) {
          scopeContextData += `\n\nRelated Entities:`;
          entityMentions.forEach((em: any) => {
            if (em.entities) {
              scopeContextData += `\n- ${em.entities.name} (${em.entities.type})`;
            }
          });
        }

        // Load verified P1/P2 incident set for this incident's client (prevents "phantom clusters")
        if (incident.client_id) {
          await loadClientP1P2Incidents(incident.client_id);
          buildVerifiedBlock();
        }
      }
    }

    // Fetch investigation-specific context if scoped to an investigation
    if (effectiveScope.investigation_id) {
      const { data: investigation } = await supabase
        .from('investigations')
        .select('*, clients(name)')
        .eq('id', effectiveScope.investigation_id)
        .single();

      if (investigation) {
        scopeDescription = `Investigation: ${investigation.file_number}`;
        scopeContextData += `\n\n=== INVESTIGATION SCOPE ===`;
        scopeContextData += `\nFile Number: ${investigation.file_number}`;
        scopeContextData += `\nStatus: ${investigation.file_status}`;
        scopeContextData += `\nClient: ${investigation.clients?.name || 'Unknown'}`;
        scopeContextData += `\nSynopsis: ${investigation.synopsis?.substring(0, 500) || 'N/A'}`;
        if (investigation.information) {
          scopeContextData += `\n\nInformation:\n${investigation.information.substring(0, 1000)}`;
        }

        // Fetch investigation entries
        const { data: entries } = await supabase
          .from('investigation_entries')
          .select('entry_text, entry_timestamp, created_by_name')
          .eq('investigation_id', effectiveScope.investigation_id)
          .order('entry_timestamp', { ascending: false })
          .limit(5);

        if (entries?.length) {
          scopeContextData += `\n\nRecent Investigation Entries:`;
          entries.forEach((e: any) => {
            scopeContextData += `\n- [${e.entry_timestamp}] ${e.entry_text?.substring(0, 200)}`;
          });
        }

        // Fetch related investigation persons
        const { data: persons } = await supabase
          .from('investigation_persons')
          .select('name, status, position, company')
          .eq('investigation_id', effectiveScope.investigation_id);

        if (persons?.length) {
          scopeContextData += `\n\nPersons of Interest:`;
          persons.forEach((p: any) => {
            scopeContextData += `\n- ${p.name} (${p.status}) - ${p.position || ''} ${p.company ? 'at ' + p.company : ''}`;
          });
        }

        // Load verified P1/P2 incident set for this investigation's client (prevents "phantom clusters")
        if (investigation.client_id) {
          await loadClientP1P2Incidents(investigation.client_id);
          buildVerifiedBlock();
        }
      }
    }

    // Fetch recent chat history for context
    const { data: recentMessages } = await supabase
      .from('briefing_chat_messages')
      .select('content, message_type, author_user_id, author_agent_id')
      .eq('briefing_id', briefing_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Fetch workspace evidence and notes for additional context
    const { data: evidence } = await supabase
      .from('workspace_evidence')
      .select('filename, description, evidence_type, tags')
      .eq('workspace_id', briefing?.workspace_id)
      .limit(10);

    const { data: notes } = await supabase
      .from('briefing_notes')
      .select('content, note_type, topic')
      .eq('briefing_id', briefing_id)
      .limit(10);

    const { data: decisions } = await supabase
      .from('briefing_decisions')
      .select('decision_text, rationale, category, status')
      .eq('briefing_id', briefing_id)
      .limit(5);

    // Build context (IMPORTANT: do not feed prior agent messages as facts)
    let contextData = scopeContextData;

    if (briefing) {
      contextData += `\n\nBRIEFING SESSION CONTEXT:`;
      contextData += `\nTitle: ${briefing.title}`;
      contextData += `\nStatus: ${briefing.status}`;
      if (briefing.description) contextData += `\nDescription: ${briefing.description}`;
    }

    if (recentMessages?.length) {
      const userOnlyHistory = recentMessages
        .filter((m) => !m.author_agent_id)
        .reverse();

      if (userOnlyHistory.length) {
        contextData += `\n\nRECENT USER CHAT (UNVERIFIED CLAIMS; do NOT treat as facts unless supported by VERIFIED DATA CONTEXT):`;
        userOnlyHistory.forEach((msg, i) => {
          contextData += `\n${i + 1}. [User - Unverified]: ${msg.content.substring(0, 300)}`;
        });
      }

      contextData += `\n\nNOTE: Prior agent outputs are intentionally excluded from context to prevent feedback-loop hallucinations.`;
    }

    if (evidence?.length) {
      contextData += `\n\nAVAILABLE EVIDENCE:`;
      evidence.forEach((e) => {
        contextData += `\n- ${e.filename} (${e.evidence_type}): ${e.description || 'No description'}`;
      });
    }

    if (notes?.length) {
      contextData += `\n\nBRIEFING NOTES:`;
      notes.forEach((n) => {
        contextData += `\n- [${n.note_type}${n.topic ? '/' + n.topic : ''}]: ${n.content.substring(0, 200)}`;
      });
    }

    if (decisions?.length) {
      contextData += `\n\nKEY DECISIONS:`;
      decisions.forEach((d) => {
        contextData += `\n- [${d.status}] ${d.decision_text}`;
        if (d.rationale) contextData += ` (Rationale: ${d.rationale.substring(0, 100)})`;
      });
    }

    if (!verifiedContextBlock) {
      verifiedContextBlock = [
        `\n=== VERIFIED CONSTRAINTS ===`,
        `No P1/P2 incident set was loaded for this scope (client_id missing).`,
        `RULE: You MUST NOT invent incident counts, dates, or clusters. Ask for the scope/client if needed.`,
        `=== END VERIFIED CONSTRAINTS ===`,
      ].join('\n');
    }

    // Build system prompt with scope enforcement and anti-hallucination
    const dateContext = getCriticalDateContext();
    const antiHallucinationBlock = getAntiHallucinationPrompt();

    const scopeEnforcementInstructions = scopeDescription ? `
CRITICAL SCOPE ENFORCEMENT:
This briefing is STRICTLY SCOPED to: ${scopeDescription}

SCOPE RULES:
1. All your responses must be directly relevant to ${scopeDescription}
2. If the user's question seems to fall outside this scope, you MUST:
   - First, acknowledge the question
   - Provide a soft warning: "⚠️ This query may fall outside the current briefing scope (${scopeDescription}). I'll provide what I can, but please confirm if you'd like to expand the search scope."
   - Then provide limited, cautious information if you can relate it to the current scope
3. Always prioritize information from the scope context provided above
4. If asked about unrelated incidents, clients, or investigations, politely redirect to the current scope
5. Reference the specific incident/investigation details when answering

This scoping ensures focused decision-making and prevents information overload.
` : '';

    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}

You are participating in a FORTRESS BRIEFING HUB session - an incident-centric command environment designed for Major Case Management (MCM).

${antiHallucinationBlock}

${verifiedContextBlock}

UNVERIFIED INPUT RULES (critical):
- Treat ALL user-provided incident details (titles, dates, counts, narratives) as UNVERIFIED unless the same incident is present in VERIFIED DATA CONTEXT.
- You MAY discuss user-provided details only as "reported" or "unconfirmed".
- You MUST NOT merge unverified user-provided incidents into verified counts, timelines, or trends.

OPERATIONAL TIME CONTEXT:
- Current date (authoritative): ${dateContext.currentDateISO}

${scopeEnforcementInstructions}

${is_group_question ? 'Multiple agents are being asked this question - provide your unique perspective based on your specialty.' : 'You have been specifically tagged to respond.'}

${contextData}

CLIENT ISOLATION RULES (CRITICAL):
- You are ONLY allowed to discuss the client associated with the current scope
- NEVER mention, reference, or discuss other clients, their incidents, or their data
- If you see data from multiple clients in your context, ONLY use data from the scoped client
- If asked about another client, respond: "I can only discuss matters related to the current scope. For information about other clients, please open a separate briefing."
- This prevents data leakage between client engagements

RESPONSE FORMAT GUIDELINES (MANDATORY):
Structure your response EXACTLY as follows with proper spacing:

1. OPENING ADDRESS (1 line)
   - Use formal address appropriate to the recipient

2. SITUATIONAL SUMMARY (2-3 sentences, separated by blank line from opening)
   - Brief overview of the current threat landscape
   - Highlight the most critical issue first

3. KEY INTELLIGENCE UPDATES (main body, each section separated by blank lines)
   - Use bold headers for each major topic
   - Keep paragraphs to 3-4 sentences maximum
   - Use bullet points ONLY for lists of specific items
   - Do NOT use colons after bullet points for narrative text

4. RECOMMENDATIONS (final section, separated by blank line)
   - Numbered list of 3-5 actionable items
   - Each recommendation should be one clear sentence

SPACING RULES (CRITICAL):
- Add TWO blank lines between major sections (Situational Summary → Key Updates → Recommendations)
- Add ONE blank line between subsections within Key Updates
- Keep paragraphs concise - no walls of text
- Use line breaks to improve readability

RESPONSE GUIDELINES:
- Be concise but insightful (aim for 2-4 paragraphs maximum)
- Focus on your area of expertise: ${agent.specialty}
- Provide actionable intelligence or recommendations when possible
- Reference evidence, notes, or scope-specific data when relevant
- ALWAYS cite specific data points when making claims (e.g., "The 3 open incidents..." not "several incidents")
- ALWAYS use actual dates from the data, never approximate or guess
- If this is a group question, acknowledge other perspectives but focus on your specialty
- Maintain your persona as ${agent.codename}
- Be collaborative and supportive of the investigation team
- ALWAYS stay within the defined scope - warn if queries drift outside
- When uncertain, explicitly state uncertainty rather than guessing`;

    const userMessageForModel = `USER MESSAGE (UNVERIFIED; may include hypothetical/simulation details):\n${user_message}`;


    // Call AI Gateway (resilient)
    const mainResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageForModel }
      ],
      functionName: 'briefing-chat-response',
      dlqOnFailure: true,
      dlqPayload: { briefing_id, agent_id, user_message: user_message.substring(0, 500) },
    });

    if (!mainResult.content) {
      if (mainResult.circuitOpen) {
        return new Response(
          JSON.stringify({ error: 'AI service temporarily unavailable. Please try again shortly.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(mainResult.error || 'No response from AI');
    }

    let agentResponse = mainResult.content;

    // Post-validate to catch persistent hallucinations (e.g., phantom Jan 14 clusters)
    const normalizedCount = (verifiedP1P2Incidents || [])
      .map((i) => ({ ...i, opened_at: normalizeOpenedAt(i) }))
      .filter((i) => !!i.opened_at).length;

    const validation = validateAIOutput(agentResponse, {
      incidentCount: verifiedP1P2Incidents.length ? normalizedCount : undefined,
      knownDates: knownOpenedDates.length ? knownOpenedDates : undefined,
    });

    const mentionsJan14 = /(?:\b2026-01-14\b|January\s+14,?\s*2026)/i.test(agentResponse);
    const violatesJan14 = mentionsJan14 && jan14_2026_p1p2_count === 0;

    if (violatesJan14 || validation.warnings.length > 0) {
      const correctionUserMessage = [
        'CORRECTION REQUIRED.',
        'Rewrite the response to strictly comply with VERIFIED DATA CONTEXT and VERIFIED CONSTRAINTS.',
        'Remove any incident counts/dates/clusters that are not explicitly supported by the verified context.',
        '',
        `Verified P1/P2 incident count for this scope: ${normalizedCount}`,
        `Verified P1/P2 incidents opened on 2026-01-14: ${jan14_2026_p1p2_count}`,
        '',
        'Issues detected:',
        ...(validation.warnings.length ? validation.warnings : [
          'Detected mention of incidents on 2026-01-14 even though verified count is 0.',
        ]),
        '',
        'Draft to rewrite:',
        agentResponse,
        '',
        'Return ONLY the corrected answer (no preface).',
      ].join('\n');

      const correctionResult = await callAiGateway({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: correctionUserMessage },
        ],
        functionName: 'briefing-chat-response',
      });

      if (correctionResult.content) {
        agentResponse = correctionResult.content;
      }
    }

    // Store the agent's response in the chat
    const { error: insertError } = await supabase
      .from('briefing_chat_messages')
      .insert({
        briefing_id,
        author_agent_id: agent_id,
        content: agentResponse,
        message_type: 'agent_response',
        parent_message_id,
        is_group_question,
        metadata: { scope: effectiveScope }
      });

    if (insertError) {
      console.error('Failed to store agent response:', insertError);
    }

    console.log('Agent response stored successfully');

    return new Response(
      JSON.stringify({ success: true, response: agentResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in briefing-chat-response:', error);
    await logError(error, { functionName: 'briefing-chat-response', severity: 'error' });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});