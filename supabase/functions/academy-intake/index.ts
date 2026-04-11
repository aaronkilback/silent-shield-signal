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
import { Resend } from "npm:resend@2.0.0";

const ADMIN_EMAIL = "ak@silentshieldsecurity.com";
const FROM_EMAIL  = "fortress@silentshieldsecurity.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Tier scoring (new richer profile) ───────────────────────────────────────

function scoreTier(answers: Record<string, string>): "foundation" | "advanced" | "elite" {
  let score = 0;

  // Sector
  if (answers.sector === "military_intel")  score += 3;
  if (answers.sector === "law_enforcement") score += 2;
  if (answers.sector === "private")         score += 2;
  if (answers.sector === "corporate")       score += 1;

  // Decision authority — have they actually been responsible
  if (answers.decision_authority === "yes_many")  score += 3;
  if (answers.decision_authority === "yes_once")  score += 2;
  if (answers.decision_authority === "no_close")  score += 1;

  // High-risk exposure
  if (answers.high_risk_exposure === "yes_sustained") score += 2;
  if (answers.high_risk_exposure === "yes_incident")  score += 1;

  // Current status
  if (answers.current_status === "operational")  score += 1;
  if (answers.current_status === "management")   score += 1;

  // Doctrine answer (non-empty = at least practitioner)
  if ((answers.doctrine || "").trim().length > 30) score += 1;

  if (score >= 7) return "elite";
  if (score >= 3) return "advanced";
  return "foundation";
}

// ─── Domain → agent mapping ───────────────────────────────────────────────────

const OPERATIONAL_DOMAIN_MAP: Record<string, string> = {
  close_protection:  "travel_security",
  threat_assessment: "intelligence_tradecraft",
  physical_security: "physical_security",
  investigations:    "intelligence_tradecraft",
  crisis_management: "business_continuity",
  cyber:             "cyber_threat_intel",
};

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
  const resendKey   = Deno.env.get("RESEND_API_KEY");
  const supabase    = createClient(supabaseUrl, serviceKey);
  const resend      = resendKey ? new Resend(resendKey) : null;

  try {
    const { userId, answers, contact } = await req.json();

    if (!userId || !answers) {
      return new Response(JSON.stringify({ error: "userId and answers required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Score tier and resolve domain/agent from new profile questions
    const tier          = scoreTier(answers);
    const primaryDomain = OPERATIONAL_DOMAIN_MAP[answers.operational_experience || ""] || "physical_security";
    const matchedAgent  = DOMAIN_AGENT_MAP[primaryDomain] || "WARDEN";
    const confidenceRating = answers.confidence ? parseInt(answers.confidence) : null;

    console.log(`[academy-intake] userId=${userId} tier=${tier} domain=${primaryDomain} agent=${matchedAgent} confidence=${confidenceRating}`);

    // Upsert learner profile
    const { data: profile, error: profileErr } = await supabase
      .from("academy_learner_profiles")
      .upsert({
        user_id:            userId,
        intake_answers:     { ...answers, contact: contact || {} },
        experience_level:   tier,
        primary_domain:     primaryDomain,
        matched_agent:      matchedAgent,
        matched_tier:       tier,
        self_reported_role: answers.role        || null,
        sector:             answers.sector      || null,
        current_status:     answers.current_status || null,
        confidence_rating:  confidenceRating,
        full_name:          contact?.full_name  || null,
        email:              contact?.email      || null,
        phone:              contact?.phone      || null,
        address:            contact?.address    || null,
        city:               contact?.city       || null,
        country:            contact?.country    || null,
        updated_at:         new Date().toISOString(),
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

    // Notify admin of new enrollment
    if (resend && contact?.full_name) {
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      ADMIN_EMAIL,
        subject: `New Academy Enrollment: ${contact.full_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e293b;">New Fortress Academy Enrollment</h2>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Name:</strong> ${contact.full_name}</p>
              <p><strong>Email:</strong> ${contact.email || "—"}</p>
              <p><strong>Phone:</strong> ${contact.phone || "—"}</p>
              <p><strong>Location:</strong> ${[contact.address, contact.city, contact.country].filter(Boolean).join(", ") || "—"}</p>
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Role:</strong> ${answers.role || "—"}</p>
              <p><strong>Sector:</strong> ${(answers.sector || "—").replace(/_/g, " ")}</p>
              <p><strong>Operational experience:</strong> ${(answers.operational_experience || "—").replace(/_/g, " ")}</p>
              <p><strong>Decision authority:</strong> ${(answers.decision_authority || "—").replace(/_/g, " ")}</p>
              <p><strong>High-risk exposure:</strong> ${(answers.high_risk_exposure || "—").replace(/_/g, " ")}</p>
              <p><strong>Current status:</strong> ${(answers.current_status || "—").replace(/_/g, " ")}</p>
              <p><strong>Team size:</strong> ${(answers.team_size || "—").replace(/_/g, " ")}</p>
              <p><strong>Self-confidence rating:</strong> ${confidenceRating || "—"}/10</p>
            </div>
            <div style="background: #fff8ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Highest-threat environment described:</strong></p>
              <p style="font-style: italic; color: #374151;">"${(answers.highest_threat || "Not provided").slice(0, 400)}"</p>
              <p style="margin-top: 12px;"><strong>Doctrine / framework:</strong></p>
              <p style="font-style: italic; color: #374151;">"${(answers.doctrine || "Not provided").slice(0, 300)}"</p>
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Tier matched:</strong> ${tier}</p>
              <p><strong>Agent matched:</strong> ${matchedAgent}</p>
              <p><strong>Domain:</strong> ${primaryDomain.replace(/_/g, " ")}</p>
              <p><strong>Courses enrolled:</strong> ${finalRecommended.length}</p>
            </div>
            <p style="color: #64748b; font-size: 12px;">Fortress Academy — ${new Date().toLocaleString()}</p>
          </div>
        `,
      }).catch(e => console.warn("[academy-intake] Email notify failed:", e));
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
