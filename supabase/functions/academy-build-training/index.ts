/**
 * academy-build-training
 *
 * Generates the structured opening debrief for the Academy training phase.
 * Pulls the agent's actual expert_knowledge + agent_beliefs for the domain,
 * then uses GPT-4o to compose a masterclass-style opening that:
 *   1. Debriefs the learner's pre-test choice
 *   2. Grounds the lesson in the agent's real accumulated knowledge base
 *   3. Explains what the training will cover
 *
 * POST body:
 *   {
 *     userId:        string (UUID)
 *     courseId:      string (UUID)
 *     agentCallSign: string (e.g. "VECTOR-TRVL")
 *     courseDomain:  string (e.g. "travel_security")
 *     courseTitle:   string
 *     preScore:      number (0–1)
 *     preChoice:     string ("a"|"b"|"c"|"d")
 *     preIsOptimal:  boolean
 *     optimalChoice: string
 *     optimalRationale: string
 *     mostDangerousChoice: string
 *     mostDangerousRationale: string
 *     teachingPoints: string[]
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     agentId: string (UUID — for calling agent-chat),
 *     sessionId: string,
 *     openingMessage: string
 *   }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const DOMAIN_LABELS: Record<string, string> = {
  travel_security:         "Executive Protection & Travel Security",
  physical_security:       "Physical Security Operations",
  cyber_threat_intel:      "Cyber Threat Intelligence",
  osint_privacy:           "OSINT & Digital Intelligence",
  financial_security:      "Financial Security & Fraud Investigation",
  business_continuity:     "Business Continuity & Crisis Management",
  reputational_risk:       "Reputational Risk & Information Operations",
  intelligence_tradecraft: "Intelligence Tradecraft & Investigations",
  protective_intelligence: "Protective Intelligence",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey   = Deno.env.get("OPENAI_API_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const {
      userId,
      courseId,
      agentCallSign,
      courseDomain,
      courseTitle,
      preScore      = 0,
      preChoice     = "",
      preIsOptimal  = false,
      optimalChoice = "",
      optimalRationale = "",
      mostDangerousChoice = "",
      mostDangerousRationale = "",
      teachingPoints = [],
    } = await req.json();

    if (!userId || !courseId || !agentCallSign) {
      return new Response(JSON.stringify({ error: "userId, courseId, agentCallSign required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Look up agent UUID
    const { data: agent, error: agentErr } = await supabase
      .from("ai_agents")
      .select("id, name, call_sign, specialty, system_prompt")
      .eq("call_sign", agentCallSign)
      .maybeSingle();

    if (agentErr || !agent) {
      console.warn(`[academy-build-training] Agent not found for call_sign=${agentCallSign}`);
    }

    // 2. Fetch expert_knowledge for the domain (top 15 by confidence)
    const { data: knowledge } = await supabase
      .from("expert_knowledge")
      .select("title, content, knowledge_type, confidence_score, subdomain")
      .eq("domain", courseDomain)
      .eq("is_active", true)
      .order("confidence_score", { ascending: false })
      .limit(15);

    // 3. Fetch agent beliefs for this domain
    const { data: beliefs } = await supabase
      .from("agent_beliefs")
      .select("hypothesis, belief_type, confidence, related_domains")
      .eq("agent_call_sign", agentCallSign)
      .eq("is_active", true)
      .order("confidence", { ascending: false })
      .limit(10);

    // 4. Build knowledge context for GPT-4o
    const knowledgeBlock = (knowledge || []).map((k, i) =>
      `[K${i + 1}] ${k.title} (${k.knowledge_type}, confidence ${k.confidence_score})\n${k.content.slice(0, 600)}`
    ).join("\n\n");

    const beliefsBlock = (beliefs || []).map((b, i) =>
      `[BELIEF ${i + 1}] ${b.belief_type.toUpperCase()}: ${b.hypothesis} (confidence: ${(b.confidence * 100).toFixed(0)}%)`
    ).join("\n");

    const domainLabel  = DOMAIN_LABELS[courseDomain] || courseDomain;
    const preScorePct  = Math.round(preScore * 100);
    const choiceResult = preIsOptimal ? "optimal" : preChoice === mostDangerousChoice ? "most dangerous" : "defensible but not optimal";

    // 5. Generate opening masterclass message via GPT-4o
    const systemPrompt = agent
      ? `You are ${agent.name} (call sign: ${agent.call_sign}). You are a highly specialized intelligence agent with deep expertise in ${domainLabel}. You have accumulated a significant knowledge base and hold strong analytical beliefs formed from field intelligence and doctrine.`
      : `You are a senior security instructor with deep expertise in ${domainLabel}.`;

    const userPrompt = `A security professional just completed the pre-test for your Academy course: "${courseTitle}".

THEIR RESULT:
- Score: ${preScorePct}%
- Choice: Option ${preChoice.toUpperCase()} — ${choiceResult}
- Optimal choice was: Option ${optimalChoice.toUpperCase()}
- Optimal rationale: ${optimalRationale}
- Most dangerous was: Option ${mostDangerousChoice.toUpperCase()} — ${mostDangerousRationale}
- Teaching points from their scenario: ${teachingPoints.join("; ")}

YOUR ACCUMULATED KNOWLEDGE BASE (use this to teach — do not use generic knowledge):
${knowledgeBlock || "No domain knowledge loaded — draw from your general expertise."}

YOUR ANALYTICAL BELIEFS:
${beliefsBlock || "No beliefs on record."}

TASK:
Write a structured masterclass opening message (400–550 words) that:

1. **Acknowledge their result** directly and honestly — tell them what their score means at the professional level. If they scored well, tell them where elite practitioners outperform even good scores. If they scored poorly, be direct about the gap without being harsh.

2. **Debrief the scenario decision** in one concise paragraph — explain the doctrine behind the optimal choice using the knowledge base above, not generic theory. Reference specific principles, failure modes, or threat patterns from your knowledge.

3. **Set the curriculum** — tell them what this training will cover across 5 areas: foundation doctrine, current threat picture, case application, pressure testing their judgment, and what separates elite from average in this domain. Be specific to THIS domain and YOUR knowledge base.

4. **Establish your teaching philosophy** — one paragraph on how you teach judgment (not just facts). Make clear that you will challenge their assumptions, test their reasoning, and hold them to professional standards.

5. **First question to engage them** — end with a single, pointed question that probes a key concept from your knowledge base. Something that reveals gaps in their current mental model.

Write in first person as the agent. Be authoritative, direct, and intellectually demanding. This is a masterclass, not a Q&A. Format with clear sections but conversational prose — no bullet point lists in the opening.`;

    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 900,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI failed: ${err.slice(0, 200)}`);
    }

    const gptData      = await resp.json();
    const openingMessage = gptData.choices?.[0]?.message?.content || "Welcome to your training session. Let's begin.";

    // 6. Upsert training session
    const { data: session, error: sessionErr } = await supabase
      .from("academy_training_sessions")
      .upsert({
        user_id:         userId,
        course_id:       courseId,
        agent_call_sign: agentCallSign,
        domain:          courseDomain,
        pre_score:       preScore,
        pre_choice:      preChoice || null,
        pre_is_optimal:  preIsOptimal,
        status:          "active",
        opening_message: openingMessage,
      }, { onConflict: "user_id,course_id" })
      .select("id")
      .single();

    if (sessionErr) {
      console.warn("[academy-build-training] Session upsert failed:", sessionErr);
    }

    // 7. Mark progress as in_training
    await supabase
      .from("academy_judgment_progress")
      .update({ status: "in_training", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "pre_complete");

    return new Response(JSON.stringify({
      ok:             true,
      agentId:        agent?.id || null,
      sessionId:      session?.id || null,
      openingMessage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[academy-build-training] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
