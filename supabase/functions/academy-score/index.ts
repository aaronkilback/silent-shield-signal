/**
 * academy-score
 *
 * Scores a learner's scenario response:
 *   base_score:      1.0 optimal | 0.5 defensible | 0.0 dangerous
 *   rationale_score: 0–1, AI-evaluated quality of written rationale
 *   total_score:     0.65 × base + 0.35 × rationale
 *
 * After scoring, updates academy_judgment_progress:
 *   - pre_score / post_score / followup_score
 *   - judgment_delta (post − pre)
 *   - status advancement
 *   - followup_due_at (30 days after post_completed_at)
 *
 * Also upserts academy_agent_scores so the agent domain teaching
 * score reflects the latest learner improvement.
 *
 * POST body:
 *   {
 *     userId, scenarioId, courseId,
 *     stage:           "pre" | "post" | "30day",
 *     selectedOption:  "a" | "b" | "c" | "d",
 *     rationaleOptimal:   string (why they chose this option),
 *     rationaleDangerous: string (which option is most dangerous and why),
 *     difficultyRating:   1–5,
 *     timeSpentSeconds:   number
 *   }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const ADMIN_EMAIL = "ak@silentshieldsecurity.com";
const FROM_EMAIL  = "fortress@silentshieldsecurity.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// ─── Rationale scoring ────────────────────────────────────────────────────────

async function scoreRationale(
  openAiKey: string,
  scenario: any,
  selectedOption: string,
  rationaleOptimal: string,
  rationaleDangerous: string,
): Promise<number> {
  const optimalKey   = `option_${selectedOption}` as keyof typeof scenario;
  const chosenOption = scenario[optimalKey] as { text: string; risk_profile: string } | undefined;

  const prompt = `You are a senior security instructor evaluating a learner's reasoning quality.

SCENARIO: ${scenario.title}
SITUATION (excerpt): ${(scenario.situation_brief || "").slice(0, 400)}

OPTIMAL CHOICE: Option ${scenario.optimal_choice.toUpperCase()}
MOST DANGEROUS: Option ${scenario.most_dangerous_choice.toUpperCase()}

LEARNER SELECTED: Option ${selectedOption.toUpperCase()}
${chosenOption ? `Chosen option: ${chosenOption.text}` : ""}

LEARNER'S RATIONALE FOR THEIR CHOICE:
"${rationaleOptimal || "(not provided)"}"

LEARNER'S MOST DANGEROUS OPTION IDENTIFICATION:
"${rationaleDangerous || "(not provided)"}"

Score the learner's combined reasoning from 0.0 to 1.0:
- 1.0: Demonstrates clear doctrine understanding, identifies specific risk factors, shows professional judgment
- 0.7: Reasonable reasoning with some doctrine awareness but missing key factors
- 0.4: Basic reasoning, largely correct instinct but lacks systematic analysis
- 0.1: Superficial or incorrect reasoning even if the answer choice was correct
- 0.0: No rationale provided or completely off-base

Respond with ONLY a JSON object: {"rationale_score": 0.0}`;

  const resp = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 50,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    console.warn(`[academy-score] OpenAI rationale scoring failed: ${resp.status}`);
    return 0.5; // fallback — don't penalize on API error
  }

  const data    = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return 0.5;

  try {
    const parsed = JSON.parse(content);
    const score  = Number(parsed.rationale_score);
    return isNaN(score) ? 0.5 : Math.min(1, Math.max(0, score));
  } catch {
    return 0.5;
  }
}

// ─── Base score ───────────────────────────────────────────────────────────────

function calcBaseScore(selectedOption: string, scenario: any): number {
  if (selectedOption === scenario.optimal_choice)        return 1.0;
  if (selectedOption === scenario.most_dangerous_choice) return 0.0;
  return 0.5; // defensible but not optimal
}

// ─── Status advancement ───────────────────────────────────────────────────────

function nextStatus(currentStatus: string, stage: string): string {
  if (stage === "pre"    && currentStatus === "enrolled")      return "pre_complete";
  if (stage === "pre"    && currentStatus === "pre_complete")  return "pre_complete"; // idempotent
  if (stage === "post"   && currentStatus === "in_training")   return "post_complete";
  if (stage === "post"   && currentStatus === "pre_complete")  return "post_complete"; // if training skipped
  if (stage === "30day"  && currentStatus === "followup_pending") return "complete";
  return currentStatus;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey   = Deno.env.get("OPENAI_API_KEY")!;
  const resendKey   = Deno.env.get("RESEND_API_KEY");
  const supabase    = createClient(supabaseUrl, serviceKey);
  const resend      = resendKey ? new Resend(resendKey) : null;

  try {
    const {
      userId,
      scenarioId,
      courseId,
      stage,
      selectedOption,
      rationaleOptimal   = "",
      rationaleDangerous = "",
      difficultyRating,
      timeSpentSeconds,
    } = await req.json();

    if (!userId || !scenarioId || !courseId || !stage || !selectedOption) {
      return new Response(JSON.stringify({ error: "userId, scenarioId, courseId, stage, selectedOption required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch scenario for scoring
    const { data: scenario, error: scenarioErr } = await supabase
      .from("academy_scenarios")
      .select("*")
      .eq("id", scenarioId)
      .single();

    if (scenarioErr || !scenario) throw scenarioErr || new Error("Scenario not found");

    // Calculate scores
    const baseScore      = calcBaseScore(selectedOption, scenario);
    const rationaleScore = await scoreRationale(openAiKey, scenario, selectedOption, rationaleOptimal, rationaleDangerous);
    const totalScore     = Math.round((0.65 * baseScore + 0.35 * rationaleScore) * 1000) / 1000;

    console.log(`[academy-score] userId=${userId} stage=${stage} base=${baseScore} rationale=${rationaleScore} total=${totalScore}`);

    // Write response record
    const { error: responseErr } = await supabase
      .from("academy_responses")
      .insert({
        user_id:             userId,
        scenario_id:         scenarioId,
        course_id:           courseId,
        stage,
        selected_option:     selectedOption,
        rationale_optimal:   rationaleOptimal   || null,
        rationale_dangerous: rationaleDangerous || null,
        difficulty_rating:   difficultyRating   || null,
        base_score:          baseScore,
        rationale_score:     rationaleScore,
        total_score:         totalScore,
        time_spent_seconds:  timeSpentSeconds   || null,
      });

    if (responseErr) throw responseErr;

    // Fetch current progress
    const { data: progress, error: progressErr } = await supabase
      .from("academy_judgment_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .single();

    if (progressErr || !progress) throw progressErr || new Error("Progress record not found");

    // Build progress update
    const now         = new Date().toISOString();
    const progressUpdate: Record<string, any> = {
      status:     nextStatus(progress.status, stage),
      updated_at: now,
    };

    if (stage === "pre") {
      progressUpdate.pre_score          = totalScore;
      progressUpdate.pre_scenario_id    = scenarioId;
      progressUpdate.pre_completed_at   = now;
    } else if (stage === "post") {
      progressUpdate.post_score         = totalScore;
      progressUpdate.post_scenario_id   = scenarioId;
      progressUpdate.post_completed_at  = now;
      // Calculate judgment delta
      const preScore = progress.pre_score;
      if (preScore !== null && preScore !== undefined) {
        progressUpdate.judgment_delta = Math.round((totalScore - preScore) * 1000) / 1000;
      }
      // Set 30-day follow-up
      const followupDate = new Date();
      followupDate.setDate(followupDate.getDate() + 30);
      progressUpdate.followup_due_at = followupDate.toISOString();
      progressUpdate.status = "followup_pending";
    } else if (stage === "30day") {
      progressUpdate.followup_score         = totalScore;
      progressUpdate.followup_completed_at  = now;
      // Retention delta: followup vs post
      const postScore = progress.post_score;
      if (postScore !== null && postScore !== undefined) {
        progressUpdate.retention_delta = Math.round((totalScore - postScore) * 1000) / 1000;
      }
    }

    const { error: updateErr } = await supabase
      .from("academy_judgment_progress")
      .update(progressUpdate)
      .eq("user_id", userId)
      .eq("course_id", courseId);

    if (updateErr) throw updateErr;

    // After pre-test: calculate confidence gap and store it
    if (stage === "pre") {
      const { data: learner } = await supabase
        .from("academy_learner_profiles")
        .select("confidence_rating")
        .eq("user_id", userId)
        .maybeSingle();

      if (learner?.confidence_rating) {
        const selfConfidencePct = learner.confidence_rating * 10;
        const actualPct        = Math.round(totalScore * 100);
        const gap              = selfConfidencePct - actualPct;
        await supabase
          .from("academy_learner_profiles")
          .update({ confidence_gap: gap })
          .eq("user_id", userId);
        console.log(`[academy-score] confidence_gap=${gap} (self=${selfConfidencePct}% actual=${actualPct}%)`);
      }
    }

    // Update agent teaching score (only after post or 30day — we have a delta)
    if ((stage === "post" || stage === "30day") && scenario.agent_call_sign) {
      // Aggregate judgment_delta for this agent+domain across all learners
      const { data: allProgress } = await supabase
        .from("academy_judgment_progress")
        .select("judgment_delta, retention_delta")
        .eq("agent_call_sign", scenario.agent_call_sign)
        .not("judgment_delta", "is", null);

      if (allProgress && allProgress.length > 0) {
        const deltas    = allProgress.map(p => p.judgment_delta as number);
        const retDeltas = allProgress.map(p => p.retention_delta as number).filter(v => v !== null);

        const avgJudgmentDelta  = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const avgRetentionDelta = retDeltas.length > 0
          ? retDeltas.reduce((a, b) => a + b, 0) / retDeltas.length
          : null;

        // Teaching score: blend judgment improvement + retention (if available)
        const teachingScore = retDeltas.length > 0
          ? Math.round((0.6 * avgJudgmentDelta + 0.4 * avgRetentionDelta!) * 1000) / 1000
          : Math.round(avgJudgmentDelta * 1000) / 1000;

        await supabase
          .from("academy_agent_scores")
          .upsert({
            agent_call_sign:     scenario.agent_call_sign,
            domain:              scenario.domain,
            course_id:           courseId,
            learner_count:       allProgress.length,
            avg_judgment_delta:  Math.round(avgJudgmentDelta  * 1000) / 1000,
            avg_retention_delta: avgRetentionDelta !== null ? Math.round(avgRetentionDelta * 1000) / 1000 : null,
            teaching_score:      teachingScore,
            last_updated_at:     now,
          }, { onConflict: "agent_call_sign,domain" });
      }
    }

    // Notify admin on post-test completion
    if (resend && (stage === "post" || stage === "30day")) {
      const { data: learner } = await supabase
        .from("academy_learner_profiles")
        .select("full_name, email, phone, city, country")
        .eq("user_id", userId)
        .maybeSingle();

      const stageName = stage === "post" ? "Post-Test" : "30-Day Retention Check";
      const deltaLine = progressUpdate.judgment_delta !== undefined
        ? `<p><strong>Judgment Delta:</strong> ${progressUpdate.judgment_delta >= 0 ? "+" : ""}${(progressUpdate.judgment_delta * 100).toFixed(0)}%</p>`
        : "";

      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      ADMIN_EMAIL,
        subject: `Academy ${stageName} Complete: ${learner?.full_name || userId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e293b;">Fortress Academy — ${stageName} Complete</h2>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Student:</strong> ${learner?.full_name || "Unknown"}</p>
              <p><strong>Email:</strong> ${learner?.email || "—"}</p>
              <p><strong>Phone:</strong> ${learner?.phone || "—"}</p>
              <p><strong>Location:</strong> ${[learner?.city, learner?.country].filter(Boolean).join(", ") || "—"}</p>
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 16px 0;">
              <p><strong>Stage:</strong> ${stageName}</p>
              <p><strong>Score:</strong> ${(totalScore * 100).toFixed(0)}%</p>
              <p><strong>Choice:</strong> ${selectedOption.toUpperCase()} — ${progressUpdate.isOptimal ? "Optimal" : progressUpdate.isMostDangerous ? "Most Dangerous" : "Defensible"}</p>
              ${deltaLine}
              <p><strong>Status:</strong> ${progressUpdate.status}</p>
            </div>
            <p style="color: #64748b; font-size: 12px;">Fortress Academy — ${new Date().toLocaleString()}</p>
          </div>
        `,
      }).catch(e => console.warn("[academy-score] Email notify failed:", e));
    }

    return new Response(JSON.stringify({
      ok:             true,
      baseScore,
      rationaleScore,
      totalScore,
      isOptimal:      selectedOption === scenario.optimal_choice,
      isMostDangerous: selectedOption === scenario.most_dangerous_choice,
      optimalChoice:  scenario.optimal_choice,
      optimalRationale: scenario.optimal_rationale,
      mostDangerousChoice: scenario.most_dangerous_choice,
      mostDangerousRationale: scenario.most_dangerous_rationale,
      teachingPoints: scenario.teaching_points || [],
      judgmentDelta:  progressUpdate.judgment_delta ?? null,
      newStatus:      progressUpdate.status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[academy-score] Handler error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
