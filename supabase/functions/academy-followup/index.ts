/**
 * academy-followup
 *
 * Cron job: runs daily, finds learners whose 30-day follow-up is due,
 * transitions them to "followup_pending" status, and (optionally)
 * triggers a notification.
 *
 * This function is intentionally lightweight — it only manages the
 * transition and logging. The actual 30-day scenario is served by
 * the same AcademyScenario component using the existing post scenario
 * (variant_index 1) with stage = "30day".
 *
 * Schedule: daily at 08:00 UTC
 * Cron job name: academy-followup-daily
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  const now = new Date().toISOString();
  const jobName = "academy-followup-daily";

  try {
    // Find post_complete records whose followup_due_at has passed
    const { data: dueRecords, error: dueErr } = await supabase
      .from("academy_progress")
      .select("id, user_id, course_id, post_score, followup_due_at, agent_call_sign")
      .eq("status", "post_complete")
      .lte("followup_due_at", now)
      .not("followup_due_at", "is", null)
      .limit(100);

    if (dueErr) throw dueErr;

    const due = dueRecords || [];
    console.log(`[academy-followup] Found ${due.length} overdue follow-up records`);

    let transitioned = 0;

    for (const record of due) {
      const { error: updateErr } = await supabase
        .from("academy_progress")
        .update({
          status:     "followup_pending",
          updated_at: now,
        })
        .eq("id", record.id);

      if (updateErr) {
        console.error(`[academy-followup] Failed to transition ${record.id}:`, updateErr.message);
        continue;
      }

      transitioned++;
      console.log(`[academy-followup] → followup_pending: user=${record.user_id} course=${record.course_id}`);
    }

    // Heartbeat
    await supabase.from("cron_heartbeat").upsert({
      job_name:   jobName,
      last_run:   now,
      last_status: "ok",
      details:    { due: due.length, transitioned },
    }, { onConflict: "job_name" }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, due: due.length, transitioned }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[academy-followup] Handler error:", err);

    await supabase.from("cron_heartbeat").upsert({
      job_name:    jobName,
      last_run:    now,
      last_status: "error",
      details:     { error: err instanceof Error ? err.message : "Unknown" },
    }, { onConflict: "job_name" }).catch(() => {});

    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
