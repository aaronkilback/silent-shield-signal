// WO-SILENT-ZERO-PROBE — Variant A (regression) as a registered watchdog probe.
// One finding per regressing producer (was producing, now 0 despite running). Coverage is
// visible: every non-healthy state (insufficient_history, unevaluable, exempt, unverified)
// is reported in a census finding — never omitted, never collapsed into healthy.
//
// AUDIT-ONLY for the first two scheduled runs: regression findings are written at severity
// 'low' (visible on the neural page, does NOT notify). From the third run on they escalate to
// 'high' (notifies via the daily email). The census finding is always 'info' (coverage, not an alert).
//
// Names aligned (Registry-is-a-Promise): cron jobname = heartbeat job_name = registry job_name
// = 'silent-zero-probe-daily'.
import { createServiceClient } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const JOB = 'silent-zero-probe-daily';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

async function recordFinding(supabase: any, f: {
  severity: string; title: string; analysis: string; plainEnglish: string; action: string; job: string;
}) {
  await supabase.rpc('record_platform_finding', {
    p_category: 'coverage_health', p_severity: f.severity, p_title: f.title,
    p_analysis: f.analysis, p_plain_english: f.plainEnglish, p_action: f.action,
    p_affected_agent: 'SILENT-ZERO', p_affected_job: f.job,
  }).then(() => null, (e: any) => console.warn('[silent-zero] record_platform_finding failed:', e?.message));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB);

  try {
    // Audit gate: count prior COMPLETED runs (this run's heartbeat is 'running', not counted).
    // <2 prior scheduled successes → audit (regressions at 'low', no notify). >=2 → promoted ('high').
    const { count: priorRuns } = await supabase
      .from('cron_heartbeat').select('id', { count: 'exact', head: true })
      .eq('job_name', JOB).in('status', ['completed', 'succeeded']);
    const audit = (priorRuns ?? 0) < 2;
    const regressionSeverity = audit ? 'low' : 'high';

    const { data: rows, error } = await supabase.rpc('silent_zero_variant_a');
    if (error) throw error;

    const byState: Record<string, any[]> = {};
    for (const r of rows ?? []) (byState[r.state] ??= []).push(r);
    const regressions = byState['regression'] ?? [];

    // One finding per regressing producer (distinct fingerprint via p_affected_job = monitor).
    for (const r of regressions) {
      await recordFinding(supabase, {
        severity: regressionSeverity,
        title: `Silent-zero regression: ${r.monitor} stopped producing`,
        analysis: `${r.monitor} produced ${r.baseline_signals} signals in the 7–90d baseline but 0 in the last 7 days, while running ${r.recent_runs} times in that window (reason: ${r.reason}). A producer that was yielding and went silent — the feed, source reachability, or match logic likely regressed.`,
        plainEnglish: `${r.monitor} used to bring in intelligence and has produced nothing for a week despite running normally.`,
        action: `Investigate ${r.monitor}: is the source reachable, did the match logic change, or did upstream genuinely go quiet? Confirm before it silently stays dead.${audit ? ' [AUDIT run — not notifying yet.]' : ''}`,
        job: `${JOB}:${r.monitor}`,
      });
    }

    // Coverage census — makes every non-healthy state visible (requirement: report their own
    // states, not omitted, not passed as healthy). Always 'info' (coverage, not an alert).
    const census = Object.entries(byState)
      .map(([st, list]) => `${st}: ${list.length} [${list.map((x: any) => `${x.monitor}(${x.reason})`).join(', ')}]`)
      .join('  |  ');
    await recordFinding(supabase, {
      severity: 'info',
      title: 'Silent-zero probe coverage census',
      analysis: `Mode: ${audit ? 'AUDIT (first two scheduled runs — regressions not notifying)' : 'PROMOTED (regressions notify)'}. Prior runs: ${priorRuns ?? 0}. States: ${census}`,
      plainEnglish: `Silent-zero probe evaluated ${rows?.length ?? 0} monitors. Regressions: ${regressions.length}. Unevaluable/insufficient states are listed so coverage gaps are visible, not hidden.`,
      action: 'Review the census; unevaluable = attribution gap (P2), insufficient_history = not yet judgeable (Variant B target for never-produced).',
      job: JOB,
    });

    const summary = {
      mode: audit ? 'audit' : 'promoted', prior_runs: priorRuns ?? 0, evaluated: rows?.length ?? 0,
      regressions: regressions.map((r: any) => r.monitor),
      state_counts: Object.fromEntries(Object.entries(byState).map(([s, l]) => [s, l.length])),
    };
    await completeHeartbeat(supabase, hb, summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await failHeartbeat(supabase, hb, err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
