import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // GEMINI_API_KEY is handled by callAiGateway
    
    const supabase = createServiceClient();

    const { incident_id, current_state, user_response } = await req.json();

    console.log(`[guide-decision-tree] Guiding decision for incident ${incident_id}, state: ${current_state}`);

    // Fetch incident data
    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .select(`
        *,
        clients(name, industry, locations),
        signals(normalized_text, severity, category)
      `)
      .eq("id", incident_id)
      .single();

    if (incidentError || !incident) {
      throw new Error(`Incident not found: ${incident_id}`);
    }

    // Fetch available playbooks
    const { data: playbooks, error: playbooksError } = await supabase
      .from("playbooks")
      .select("key, title, markdown")
      .limit(10);

    if (playbooksError) {
      console.error("[guide-decision-tree] Playbooks fetch error:", playbooksError);
    }

    // Fetch escalation rules
    const { data: escalationRules, error: rulesError } = await supabase
      .from("escalation_rules")
      .select("name, priority, conditions, actions")
      .eq("is_active", true);

    if (rulesError) {
      console.error("[guide-decision-tree] Rules fetch error:", rulesError);
    }

    // Construct decision tree guidance prompt
    const guidancePrompt = `You are an intelligent decision support system guiding a security analyst through incident response. Provide clear, actionable next steps based on the current state.

INCIDENT CONTEXT:
- Incident ID: ${incident.id.substring(0, 8)}
- Title: ${incident.title || 'Untitled'}
- Priority: ${incident.priority}
- Status: ${incident.status}
- Client: ${incident.clients?.name || 'Unknown'}
- Industry: ${incident.clients?.industry || 'Unknown'}
- Signal: ${incident.signals?.normalized_text || 'No signal'}
- Severity: ${incident.signals?.severity || 'Unknown'}
- Category: ${incident.signals?.category || 'Unknown'}

CURRENT STATE: ${current_state || 'incident_opened'}
${user_response ? `ANALYST'S PREVIOUS RESPONSE: ${user_response}` : ''}

AVAILABLE PLAYBOOKS:
${playbooks && playbooks.length > 0 ? playbooks.map(p => `- ${p.title} (${p.key})`).join('\n') : 'No playbooks available'}

ACTIVE ESCALATION RULES:
${escalationRules && escalationRules.length > 0 ? escalationRules.slice(0, 3).map(r => `- ${r.name} (${r.priority} priority)`).join('\n') : 'No rules configured'}

DECISION TREE STATES (your current position in workflow):
1. incident_opened → Initial triage required
2. triage_complete → Determine if escalation needed
3. containment_required → Immediate containment actions
4. investigation_phase → Deep dive analysis
5. remediation_phase → Fix and restore
6. resolution_pending → Final verification
7. post_incident_review → Documentation and lessons learned

GUIDANCE REQUIREMENTS:
Based on the current state, provide:

1. **SITUATION ASSESSMENT** (2-3 sentences): 
   - What has been accomplished so far?
   - What is the current urgency level?

2. **DECISION POINT** (1-2 questions):
   - What is the KEY decision that needs to be made now?
   - Present 2-4 clear options with trade-offs
   - Example: "Should we escalate to P1? (Yes: immediate executive notification, resource reallocation | No: continue standard P2 response)"

3. **RECOMMENDED NEXT STEPS** (3-5 specific actions, prioritized):
   - Action 1: [Specific task with who/what/when]
   - Action 2: [...]
   - Include estimated time for each action

4. **INPUT NEEDED FROM ANALYST**:
   - What information do you need from them to proceed?
   - Specific questions they must answer
   - Data they need to gather

5. **RISK CONSIDERATIONS**:
   - What happens if we delay?
   - What are the consequences of wrong choices?

6. **NEXT STATE TRANSITION**:
   - Based on likely analyst response, what state should we move to next?
   - What triggers the state change?

CONVERSATIONAL STYLE:
- Use clear, directive language
- Present options as a guided conversation
- Anticipate analyst questions
- Provide context for WHY decisions matter
- Be supportive but authoritative

Generate a dynamic decision tree node that guides the analyst through optimal response workflow.`;

    // Call AI for decision guidance
    const aiResult = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert incident response guide. Provide clear, step-by-step decision support to security analysts navigating complex incident response workflows. Focus on reducing cognitive load and ensuring consistent, optimal decisions."
        },
        {
          role: "user",
          content: guidancePrompt
        }
      ],
      functionName: "guide-decision-tree",
      dlqOnFailure: true,
      dlqPayload: { incident_id, current_state },
    });

    if (aiResult.error) {
      throw new Error(`AI Gateway error: ${aiResult.error}`);
    }

    const guidance = aiResult.content;

    // Extract recommended next state from guidance
    const nextStateMatch = guidance.match(/next state[:\s]+(\w+)/i);
    const recommendedNextState = nextStateMatch ? nextStateMatch[1] : 'investigation_phase';

    return successResponse({
      success: true,
      incident_id,
      current_state,
      guidance: {
        content: guidance,
        recommended_next_state: recommendedNextState,
        available_playbooks: playbooks?.map(p => ({ key: p.key, title: p.title })) || [],
        escalation_options: escalationRules?.slice(0, 3) || [],
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[guide-decision-tree] Error:", error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
