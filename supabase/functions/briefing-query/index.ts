import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryRequest {
  mission_id: string;
  question: string;
}

interface EscalationResponse {
  query_id: string;
  human_response: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Create Supabase client with user's auth
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for system operations
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const body = await req.json();
    const { action } = body;

    if (action === "ask") {
      return await handleAskQuestion(body, user.id, supabaseAdmin, LOVABLE_API_KEY);
    } else if (action === "respond_escalation") {
      return await handleEscalationResponse(body, user.id, supabaseAdmin);
    } else {
      throw new Error("Invalid action");
    }
  } catch (error) {
    console.error("Error in briefing-query:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleAskQuestion(
  body: QueryRequest,
  userId: string,
  supabase: any,
  apiKey: string
) {
  const { mission_id, question } = body;

  // Fetch mission data with all related context
  const { data: mission, error: missionError } = await supabase
    .from("task_force_missions")
    .select(`
      *,
      clients(name, industry, locations),
      task_force_agents(
        role,
        agent_id,
        last_report,
        ai_agents(codename, call_sign, specialty)
      )
    `)
    .eq("id", mission_id)
    .single();

  if (missionError || !mission) {
    throw new Error("Mission not found");
  }

  // Fetch related signals through incident if exists
  let signalsContext: any[] = [];
  if (mission.incident_id) {
    const { data: incidentSignals } = await supabase
      .from("incident_signals")
      .select(`
        signals(id, normalized_text, source, detected_at, category, priority)
      `)
      .eq("incident_id", mission.incident_id)
      .limit(10);

    signalsContext = incidentSignals?.map((is: any) => is.signals).filter(Boolean) || [];
  }

  // Fetch entities linked to the mission
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, type, description, risk_level")
    .eq("client_id", mission.client_id)
    .eq("is_active", true)
    .limit(20);

  // Build the context for Aegis
  const agentReports = mission.task_force_agents
    ?.filter((a: any) => a.last_report)
    .map((a: any) => ({
      agent: a.ai_agents?.codename || a.ai_agents?.call_sign,
      specialty: a.ai_agents?.specialty,
      role: a.role,
      report: a.last_report,
    })) || [];

  const systemPrompt = `You are Aegis, the intelligence synthesis AI for the Fortress security platform. You are responding to questions about an intelligence briefing.

Your role is to:
1. Answer questions accurately using the provided briefing context and source intelligence
2. Always cite your sources with specific references (e.g., "According to Locus-Intel's report..." or "Signal #[ID] indicates...")
3. If you cannot definitively answer with high confidence (>0.7), indicate this clearly
4. Provide actionable, security-focused insights

CRITICAL RULES:
- Never fabricate information - only use what's in the provided context
- Always attribute information to the originating agent or source
- If the question requires strategic judgment or new intelligence, recommend escalation
- Be concise but thorough

MISSION CONTEXT:
Name: ${mission.name}
Objective: ${mission.objective || "Not specified"}
Type: ${mission.mission_type}
Priority: ${mission.priority}
Phase: ${mission.phase}
Client: ${mission.clients?.name || "Unknown"} (${mission.clients?.industry || "Unknown industry"})

AGENT REPORTS:
${agentReports.length > 0 
  ? agentReports.map((r: any) => `[${r.agent} - ${r.specialty}]: ${r.report}`).join("\n\n")
  : "No agent reports available yet."}

INTELLIGENCE SIGNALS:
${signalsContext.length > 0
  ? signalsContext.map((s: any) => `[Signal ${s.id.slice(0,8)} - ${s.source}]: ${s.normalized_text}`).join("\n\n")
  : "No linked signals."}

KNOWN ENTITIES:
${entities?.length > 0
  ? entities.map((e: any) => `${e.name} (${e.type}, Risk: ${e.risk_level || "Unknown"}): ${e.description || "No description"}`).join("\n")
  : "No entities tracked."}`;

  // Call Aegis AI
  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "answer_briefing_query",
            description: "Provide a structured answer to the briefing query with source citations",
            parameters: {
              type: "object",
              properties: {
                answer: {
                  type: "string",
                  description: "The detailed answer to the question",
                },
                confidence: {
                  type: "number",
                  description: "Confidence score from 0 to 1. Use < 0.7 if strategic judgment or new intel is needed",
                },
                should_escalate: {
                  type: "boolean",
                  description: "True if the question requires human judgment or cannot be answered with available data",
                },
                escalation_reason: {
                  type: "string",
                  description: "Why escalation is recommended (if applicable)",
                },
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["signal", "agent_report", "entity", "document"] },
                      id: { type: "string" },
                      title: { type: "string" },
                      excerpt: { type: "string" },
                      agent_attribution: { type: "string" },
                      relevance: { type: "number" },
                    },
                  },
                  description: "Sources cited in the answer",
                },
              },
              required: ["answer", "confidence", "should_escalate", "sources"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "answer_briefing_query" } },
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("AI gateway error:", aiResponse.status, errorText);
    
    if (aiResponse.status === 429) {
      throw new Error("Rate limit exceeded. Please try again shortly.");
    }
    if (aiResponse.status === 402) {
      throw new Error("AI service payment required.");
    }
    throw new Error("AI service error");
  }

  const aiData = await aiResponse.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  
  if (!toolCall) {
    throw new Error("Invalid AI response format");
  }

  const parsedResult = JSON.parse(toolCall.function.arguments);
  
  // Determine escalation status
  const shouldEscalate = parsedResult.should_escalate || parsedResult.confidence < 0.7;
  const escalationStatus = shouldEscalate ? "pending" : "none";

  // Create the query record
  const { data: query, error: queryError } = await supabase
    .from("briefing_queries")
    .insert({
      mission_id,
      asked_by: userId,
      question,
      ai_response: parsedResult.answer,
      ai_confidence: parsedResult.confidence,
      ai_responded_at: new Date().toISOString(),
      escalation_status: escalationStatus,
      escalated_at: shouldEscalate ? new Date().toISOString() : null,
      escalated_to: shouldEscalate ? mission.created_by : null,
    })
    .select()
    .single();

  if (queryError) {
    throw new Error(`Failed to save query: ${queryError.message}`);
  }

  // Save source citations
  if (parsedResult.sources?.length > 0) {
    const sourcesToInsert = parsedResult.sources.map((s: any) => ({
      query_id: query.id,
      source_type: s.type || "agent_report",
      source_id: s.id || mission_id, // Use mission ID as fallback
      source_title: s.title,
      source_excerpt: s.excerpt,
      relevance_score: s.relevance,
      agent_attribution: s.agent_attribution,
    }));

    await supabase.from("briefing_query_sources").insert(sourcesToInsert);
  }

  // Fetch the complete query with sources
  const { data: completeQuery } = await supabase
    .from("briefing_queries")
    .select(`
      *,
      briefing_query_sources(*)
    `)
    .eq("id", query.id)
    .single();

  return new Response(
    JSON.stringify({
      query: completeQuery,
      escalation_reason: parsedResult.escalation_reason,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleEscalationResponse(
  body: EscalationResponse,
  userId: string,
  supabase: any
) {
  const { query_id, human_response } = body;

  // Verify user is the escalation target
  const { data: query, error: queryError } = await supabase
    .from("briefing_queries")
    .select("escalated_to, mission_id")
    .eq("id", query_id)
    .single();

  if (queryError || !query) {
    throw new Error("Query not found");
  }

  // Check authorization (escalated_to or admin)
  const { data: userRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .single();

  if (query.escalated_to !== userId && !userRole) {
    throw new Error("Not authorized to respond to this escalation");
  }

  // Update the query with human response
  const { data: updatedQuery, error: updateError } = await supabase
    .from("briefing_queries")
    .update({
      human_response,
      human_responded_at: new Date().toISOString(),
      human_responded_by: userId,
      escalation_status: "responded",
    })
    .eq("id", query_id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to save response: ${updateError.message}`);
  }

  return new Response(
    JSON.stringify({ query: updatedQuery }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
