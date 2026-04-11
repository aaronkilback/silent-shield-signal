/**
 * academy-intake
 *
 * Processes the 5-question learner intake assessment.
 * Determines experience tier (foundation / advanced / elite),
 * matches learner to the best course and agent, and creates
 * academy_learner_profiles + academy_judgment_progress records.
 *
 * POST body:
 *   { userId, answers: { q1, q2, q3, q4, q5 } }
 *
 * Returns:
 *   { profileId, matchedAgent, matchedTier, recommendedCourses: [...] }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Intake questions ─────────────────────────────────────────────────────────
// These are the 5 questions presented to learners on intake.
// Stored in intake_answers for reference; scoring is done server-side.
export const INTAKE_QUESTIONS = [
  {
    id: "q1",
    question: "How many years of professional experience do you have in security, intelligence, or risk management?",
    options: [
      { value: "novice",       label: "0–2 years (student / entry level)" },
      { value: "practitioner", label: "3–9 years (working professional)" },
      { value: "expert",       label: "10+ years (senior / executive)" },
    ],
  },
  {
    id: "q2",
    question: "Which domain best describes your primary area of work?",
    options: [
      { value: "physical_security",        label: "Physical security / protective operations" },
      { value: "cyber_threat_intel",       label: "Cyber / digital threat intelligence" },
      { value: "travel_security",          label: "Executive protection / travel security" },
      { value: "osint_privacy",            label: "OSINT / digital privacy" },
      { value: "financial_security",       label: "Financial crime / fraud / compliance" },
      { value: "business_continuity",      label: "Business continuity / crisis management" },
      { value: "reputational_risk",        label: "Reputational risk / communications" },
      { value: "intelligence_tradecraft",  label: "Intelligence tradecraft / investigations" },
    ],
  },
  {
    id: "q3",
    question: "Have you received formal training in threat assessment or protective intelligence?",
    options: [
      { value: "none",     label: "No formal training" },
      { value: "basic",    label: "Basic / introductory courses only" },
      { value: "formal",   label: "Formal certification (ASIS, ATAP, CPP, etc.)" },
      { value: "advanced", label: "Advanced / operational training (government, military, intelligence community)" },
    ],
  },
  {
    id: "q4",
    question: "How do you typically make decisions when information is incomplete or ambiguous?",
    options: [
      { value: "wait",      label: "I wait for more information before acting" },
      { value: "escalate",  label: "I escalate to someone more senior" },
      { value: "framework", label: "I apply a structured framework or doctrine" },
      { value: "instinct",  label: "I rely primarily on experience and instinct" },
    ],
  },
  {
    id: "q5",
    question: "What is your primary goal in using Fortress Academy?",
    options: [
      { value: "calibrate",  label: "Calibrate my judgment against a standard" },
      { value: "learn",      label: "Learn new domain knowledge" },
      { value: "credential", label: "Build credentials / demonstrate competence" },
      { value: "team",       label: "Train or benchmark my team" },
    ],
  },
];

// ─── Tier scoring ─────────────────────────────────────────────────────────────

function scoreTier(answers: Record<string, string>): "foundation" | "advanced" | "elite" {
  let score = 0;

  // q1: experience
  if (answers.q1 === "expert")       score += 3;
  else if (answers.q1 === "practitioner") score += 1;

  // q3: formal training
  if (answers.q3 === "advanced")     score += 3;
  else if (answers.q3 === "formal")  score += 2;
  else if (answers.q3 === "basic")   score += 1;

  // q4: decision making (framework = higher competency signal)
  if (answers.q4 === "framework" || answers.q4 === "instinct") score += 1;

  if (score >= 5) return "elite";
  if (score >= 2) return "advanced";
  return "foundation";
}

// ─── Domain → agent mapping ───────────────────────────────────────────────────

const DOMAIN_AGENT_MAP: Record<string, string> = {
  physical_security:       "WARDEN",
  cyber_threat_intel:      "SENT-2",
  travel_security:         "VECTOR-TRVL",
  osint_privacy:           "VERIDIAN-TANGO",
  financial_security:      "PEARSON",
  business_continuity:     "FORTRESS-GUARD",
  reputational_risk:       "WRAITH",
  intelligence_tradecraft: "SHERLOCK",
  protective_intelligence: "WARDEN",
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const { userId, answers, contact } = await req.json();

    if (!userId || !answers) {
      return new Response(JSON.stringify({ error: "userId and answers required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Score tier and resolve domain/agent
    const tier          = scoreTier(answers);
    const primaryDomain = answers.q2 || "physical_security";
    const matchedAgent  = DOMAIN_AGENT_MAP[primaryDomain] || "WARDEN";

    console.log(`[academy-intake] userId=${userId} tier=${tier} domain=${primaryDomain} agent=${matchedAgent}`);

    // Upsert learner profile
    const { data: profile, error: profileErr } = await supabase
      .from("academy_learner_profiles")
      .upsert({
        user_id:          userId,
        intake_answers:   { ...answers, contact: contact || {} },
        experience_level: answers.q1 || "practitioner",
        primary_domain:   primaryDomain,
        matched_agent:    matchedAgent,
        matched_tier:     tier,
        updated_at:       new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("id")
      .single();

    if (profileErr) throw profileErr;

    // Find courses matching this domain + tier
    const { data: courses, error: coursesErr } = await supabase
      .from("academy_courses")
      .select("id, title, topic_cluster, scenario_domain, difficulty_level, agent_call_sign, description")
      .eq("published", true)
      .eq("generation_status", "complete")
      .or(`scenario_domain.eq.${primaryDomain},agent_call_sign.eq.${matchedAgent}`)
      .order("difficulty_level", { ascending: true })
      .limit(6);

    if (coursesErr) throw coursesErr;

    // Filter to tier-appropriate courses
    const tierOrder: Record<string, number> = { foundation: 0, advanced: 1, elite: 2 };
    const targetTierNum = tierOrder[tier] ?? 0;

    const recommended = (courses || []).filter(c => {
      const cTierNum = tierOrder[c.difficulty_level] ?? 0;
      // Show courses at or one level above the learner's tier
      return cTierNum <= targetTierNum + 1;
    });

    // If no domain match, fall back to all published courses
    let finalRecommended = recommended;
    if (finalRecommended.length === 0) {
      const { data: fallback } = await supabase
        .from("academy_courses")
        .select("id, title, topic_cluster, scenario_domain, difficulty_level, agent_call_sign, description")
        .eq("published", true)
        .eq("generation_status", "complete")
        .limit(6);
      finalRecommended = fallback || [];
    }

    // Create academy_judgment_progress records for recommended courses (if not already enrolled)
    const progressInserts = finalRecommended.map(course => ({
      user_id:        userId,
      course_id:      course.id,
      status:         "enrolled",
      agent_call_sign: course.agent_call_sign || matchedAgent,
    }));

    if (progressInserts.length > 0) {
      await supabase
        .from("academy_judgment_progress")
        .upsert(progressInserts, { onConflict: "user_id,course_id", ignoreDuplicates: true });
    }

    return new Response(JSON.stringify({
      ok:                 true,
      profileId:          profile.id,
      matchedAgent,
      matchedTier:        tier,
      primaryDomain,
      recommendedCourses: finalRecommended,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[academy-intake] Handler error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
