import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import {
  getAntiHallucinationPrompt,
  getCriticalDateContext,
  generateVerifiedDataContext,
  categorizeIncidentsByAge,
  validateAIOutput,
} from "../_shared/anti-hallucination.ts";

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
    console.log('Briefing chat response request:', { briefing_id, agent_id, is_group_question, scope });

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

    // Fetch briefing context with scope
    const { data: briefing } = await supabase
      .from('briefing_sessions')
      .select('*, investigation_workspaces(name, case_number)')
      .eq('id', briefing_id)
      .single();

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
    if (scope?.incident_id) {
      const { data: incident } = await supabase
        .from('incidents')
        .select('*, clients(name), signals(normalized_text, category, severity, location)')
        .eq('id', scope.incident_id)
        .single();

      if (incident) {
        scopeDescription = `Incident: ${incident.title || incident.summary || scope.incident_id}`;
        scopeContextData += `\n\n=== INCIDENT SCOPE ===`;
        scopeContextData += `\nIncident ID: ${incident.id}`;
        scopeContextData += `\nTitle: ${incident.title || 'N/A'}`;
        scopeContextData += `\nSummary: ${incident.summary || 'N/A'}`;
        scopeContextData += `\nPriority: ${incident.priority}`;
        scopeContextData += `\nStatus: ${incident.status}`;
        scopeContextData += `\nOpened At: ${normalizeOpenedAt(incident) || 'N/A'}`;
        scopeContextData += `\nClient: ${incident.clients?.name || 'Unknown'}`;
        if (incident.signals) {
          scopeContextData += `\nOriginating Signal: ${incident.signals.normalized_text?.substring(0, 300) || 'N/A'}`;
          scopeContextData += `\nSignal Category: ${incident.signals.category || 'N/A'}`;
          scopeContextData += `\nSignal Severity: ${incident.signals.severity || 'N/A'}`;
          scopeContextData += `\nLocation: ${incident.signals.location || 'N/A'}`;
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
          .eq('incident_id', scope.incident_id)
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
    if (scope?.investigation_id) {
      const { data: investigation } = await supabase
        .from('investigations')
        .select('*, clients(name)')
        .eq('id', scope.investigation_id)
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
          .eq('investigation_id', scope.investigation_id)
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
          .eq('investigation_id', scope.investigation_id);

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
        contextData += `\n\nRECENT USER CHAT (verbatim; factual only if supported by VERIFIED DATA CONTEXT):`;
        userOnlyHistory.forEach((msg, i) => {
          contextData += `\n${i + 1}. [User]: ${msg.content.substring(0, 300)}`;
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

OPERATIONAL TIME CONTEXT:
- Current date (authoritative): ${dateContext.currentDateISO}

${scopeEnforcementInstructions}

${is_group_question ? 'Multiple agents are being asked this question - provide your unique perspective based on your specialty.' : 'You have been specifically tagged to respond.'}

${contextData}

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


    // Call AI Gateway
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: user_message }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error('Rate limit exceeded');
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        console.error('Payment required');
        return new Response(
          JSON.stringify({ error: 'Payment required' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    let agentResponse = data.choices?.[0]?.message?.content;

    if (!agentResponse) {
      throw new Error('No response from AI');
    }

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

      const correctionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: correctionUserMessage },
          ],
        }),
      });

      if (correctionResponse.ok) {
        const correctionData = await correctionResponse.json();
        const corrected = correctionData.choices?.[0]?.message?.content;
        if (corrected) agentResponse = corrected;
      } else {
        const errorText = await correctionResponse.text();
        console.error('AI Gateway correction error:', correctionResponse.status, errorText);
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
        metadata: { scope: scope || null }
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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});