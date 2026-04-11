/**
 * generate-academy-course
 *
 * Generates two scenario variants (pre-test + post-test) for an academy course.
 * Scenarios are grounded in the assigned agent's expert_knowledge and agent_beliefs —
 * never generic web content.
 *
 * Quality standard: masterclass level. An experienced security professional
 * must find the scenario genuinely difficult and operationally credible.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const SCENARIO_SYSTEM_PROMPT = `You are the scenario architect for Fortress Academy — a judgment training and decision validation system for security professionals.

QUALITY STANDARD:
Your scenarios must be masterclass level. An experienced security professional with 20+ years in hostile environments, protective intelligence, or corporate security operations must find the scenario genuinely difficult and worth their time. Generic scenarios, obvious right answers, or scenarios without operational texture will fail the quality bar.

SCENARIO DESIGN RULES (non-negotiable):
1. SITUATION BRIEF: 300–500 words. Operationally specific. Include real details — locations (can be generic like "a mid-tier hotel in Baku" or "a highway stretch north of Fort St. John"), timeframes, roles, observable indicators, constraints. The scenario must feel like an actual operational file, not a textbook exercise.
2. UNCERTAINTY REQUIREMENT: Critical information must be ambiguous or missing. The learner cannot determine with certainty what the threat is, whether it is real, or what the right answer is. Clarity destroys training value.
3. FOUR DEFENSIBLE OPTIONS: Every option must be something a reasonable, experienced professional could choose. No option is obviously wrong. Each carries a distinct risk profile — some optimize for safety, some for operational continuity, some for information gathering, some for relationship preservation.
4. OPTIMAL CHOICE: There is a better answer based on doctrine and risk-adjusted reasoning — but the learner must work to find it.
5. MOST DANGEROUS CHOICE: One option, while seemingly reasonable, carries the highest probability of catastrophic failure if the worst-case scenario is true.
6. TEACHING POINTS: 3–5 specific doctrine principles the instructor will draw from after the cold scenario. These should be principles a learner would remember and apply 30 days later.

GROUNDING REQUIREMENT:
The scenario MUST draw from the intelligence patterns and domain knowledge provided. Use specific indicators, threat patterns, tactics, and contexts from the agent's knowledge base — not from generic security content. If the knowledge base mentions copper theft at unmanned sites in NE BC, a scenario about that is more valuable than a generic "theft prevention" scenario.

You will be given:
- COURSE TOPIC and DOMAIN
- VARIANT: 0 (pre-test) or 1 (post-test) — generate different specific contexts for each, same topic
- AGENT KNOWLEDGE: beliefs and expert knowledge entries the agent has processed
- DIFFICULTY LEVEL

Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.`;

async function generateScenario(
  openAiKey: string,
  course: any,
  beliefs: any[],
  knowledge: any[],
  variantIndex: number,
): Promise<any> {
  const knowledgeContext = knowledge
    .slice(0, 12)
    .map(k => `[${k.domain}/${k.subdomain}] ${k.title}: ${(k.content || "").slice(0, 300)}`)
    .join("\n");

  const beliefContext = beliefs
    .slice(0, 8)
    .map(b => `[${b.belief_type}, confidence ${b.confidence}] ${b.hypothesis}`)
    .join("\n");

  const userPrompt = `COURSE TOPIC: ${course.title}
DOMAIN: ${course.scenario_domain}
DIFFICULTY: ${course.difficulty_level}
VARIANT: ${variantIndex === 0 ? "0 (pre-test — first exposure, cold)" : "1 (post-test — different context, same domain principles)"}

AGENT KNOWLEDGE BASE (${course.agent_call_sign}):
--- BELIEFS ---
${beliefContext || "No beliefs available — draw from domain principles."}

--- EXPERT KNOWLEDGE ---
${knowledgeContext || "No knowledge entries available — draw from domain principles."}

Generate a scenario JSON object with these exact fields:
{
  "title": "short evocative title (max 10 words)",
  "situation_brief": "300-500 word operational situation with incomplete information",
  "option_a": { "text": "1-2 sentence action description", "risk_profile": "what risks this option carries" },
  "option_b": { "text": "...", "risk_profile": "..." },
  "option_c": { "text": "...", "risk_profile": "..." },
  "option_d": { "text": "...", "risk_profile": "..." },
  "optimal_choice": "a",
  "optimal_rationale": "2-3 sentences explaining why this is the strongest choice based on doctrine",
  "most_dangerous_choice": "c",
  "most_dangerous_rationale": "2-3 sentences explaining the catastrophic failure mode",
  "teaching_points": ["principle 1", "principle 2", "principle 3"]
}`;

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SCENARIO_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in OpenAI response");

  return JSON.parse(content);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey   = Deno.env.get("OPENAI_API_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const { courseId, generateAll = false } = await req.json();

    let coursesToProcess: any[] = [];

    if (generateAll) {
      const { data, error } = await supabase
        .from("academy_courses")
        .select("*")
        .in("generation_status", ["pending", "failed"]);
      if (error) throw error;
      coursesToProcess = data || [];
    } else if (courseId) {
      const { data, error } = await supabase
        .from("academy_courses")
        .select("*")
        .eq("id", courseId)
        .single();
      if (error) throw error;
      coursesToProcess = [data];
    } else {
      return new Response(JSON.stringify({ error: "courseId or generateAll required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const course of coursesToProcess) {
      console.log(`[generate-academy-course] Processing: ${course.title}`);

      // Mark as generating
      await supabase.from("academy_courses").update({ generation_status: "generating" }).eq("id", course.id);

      try {
        // Fetch agent beliefs
        const { data: beliefs } = await supabase
          .from("agent_beliefs")
          .select("hypothesis, belief_type, confidence, related_domains")
          .eq("agent_call_sign", course.agent_call_sign)
          .eq("is_active", true)
          .order("confidence", { ascending: false })
          .limit(10);

        // Fetch relevant expert knowledge for this domain
        const domainKeywords = (course.scenario_domain || "").replace(/_/g, " ");
        const { data: knowledge } = await supabase
          .from("expert_knowledge")
          .select("id, domain, subdomain, title, content, confidence_score")
          .or(`domain.ilike.%${domainKeywords}%,subdomain.ilike.%${domainKeywords}%,title.ilike.%${course.topic_cluster?.replace(/_/g, "%")}%`)
          .eq("is_active", true)
          .order("confidence_score", { ascending: false })
          .limit(15);

        // Generate pre-test and post-test scenarios
        const [preScenario, postScenario] = await Promise.all([
          generateScenario(openAiKey, course, beliefs || [], knowledge || [], 0),
          generateScenario(openAiKey, course, beliefs || [], knowledge || [], 1),
        ]);

        // Extract source IDs
        const sourceBeliefIds = (beliefs || []).map((b: any) => b.id).filter(Boolean);
        const sourceKnowledgeIds = (knowledge || []).map((k: any) => k.id).filter(Boolean);

        // Delete old scenarios for this course (regeneration)
        await supabase.from("academy_scenarios").delete().eq("course_id", course.id);

        // Insert pre-test scenario
        const { data: preRecord, error: preErr } = await supabase
          .from("academy_scenarios")
          .insert({
            course_id: course.id,
            title: preScenario.title,
            situation_brief: preScenario.situation_brief,
            option_a: preScenario.option_a,
            option_b: preScenario.option_b,
            option_c: preScenario.option_c,
            option_d: preScenario.option_d,
            optimal_choice: preScenario.optimal_choice,
            optimal_rationale: preScenario.optimal_rationale,
            most_dangerous_choice: preScenario.most_dangerous_choice,
            most_dangerous_rationale: preScenario.most_dangerous_rationale,
            teaching_points: preScenario.teaching_points || [],
            agent_call_sign: course.agent_call_sign,
            domain: course.scenario_domain,
            difficulty_level: course.difficulty_level,
            variant_index: 0,
            source_belief_ids: sourceBeliefIds,
            source_knowledge_ids: sourceKnowledgeIds,
          })
          .select("id")
          .single();

        if (preErr) throw preErr;

        // Insert post-test scenario
        const { data: postRecord, error: postErr } = await supabase
          .from("academy_scenarios")
          .insert({
            course_id: course.id,
            title: postScenario.title,
            situation_brief: postScenario.situation_brief,
            option_a: postScenario.option_a,
            option_b: postScenario.option_b,
            option_c: postScenario.option_c,
            option_d: postScenario.option_d,
            optimal_choice: postScenario.optimal_choice,
            optimal_rationale: postScenario.optimal_rationale,
            most_dangerous_choice: postScenario.most_dangerous_choice,
            most_dangerous_rationale: postScenario.most_dangerous_rationale,
            teaching_points: postScenario.teaching_points || [],
            agent_call_sign: course.agent_call_sign,
            domain: course.scenario_domain,
            difficulty_level: course.difficulty_level,
            variant_index: 1,
            source_belief_ids: sourceBeliefIds,
            source_knowledge_ids: sourceKnowledgeIds,
          })
          .select("id")
          .single();

        if (postErr) throw postErr;

        // Mark course as complete
        await supabase.from("academy_courses").update({
          generation_status: "complete",
          published: true,
          content_generated_at: new Date().toISOString(),
        }).eq("id", course.id);

        console.log(`[generate-academy-course] ✓ ${course.title} — pre: ${preRecord.id} post: ${postRecord.id}`);
        results.push({ courseId: course.id, title: course.title, preScenarioId: preRecord.id, postScenarioId: postRecord.id });

      } catch (courseErr) {
        console.error(`[generate-academy-course] Failed ${course.title}:`, courseErr);
        await supabase.from("academy_courses").update({
          generation_status: "failed",
          generation_error: courseErr instanceof Error ? courseErr.message : "Unknown error",
        }).eq("id", course.id);
        results.push({ courseId: course.id, title: course.title, error: courseErr instanceof Error ? courseErr.message : "Unknown" });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[generate-academy-course] Handler error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
