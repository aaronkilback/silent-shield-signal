// WO-SILENT-ZERO-PROBE — Variant A (regression) + Variant B (never_produced), across discrete
// MONITORS and per-SOURCE RSS/url_feed (item D: attributed via signals.source_id → sources).
//
// FINDINGS: one per discrete-monitor producer in state regression | never_produced. Per-SOURCE
// producers are NOT individually alerted (92 active RSS sources → 69 would-be findings = flood);
// they roll into the single census finding as counts + samples. Coverage stays visible, the
// neural page stays readable.
//
// AUDIT gate (same for A and B): first two scheduled runs write findings at severity 'low'
// (no notify); run 3+ escalate to 'high'. Census is always 'info'. Names aligned:
// cron jobname = heartbeat job_name = registry job_name = 'silent-zero-probe-daily'.
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

const sample = (arr: string[], n = 8) =>
  arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} …+${arr.length - n} more`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB);

  try {
    const { count: priorRuns } = await supabase
      .from('cron_heartbeat').select('id', { count: 'exact', head: true })
      .eq('job_name', JOB).in('status', ['completed', 'succeeded']);
    const audit = (priorRuns ?? 0) < 2;
    const sev = audit ? 'low' : 'high';

    const { data: rows, error } = await supabase.rpc('silent_zero_scan');
    if (error) throw error;

    const monitors = (rows ?? []).filter((r: any) => r.producer_kind === 'monitor');
    const sources = (rows ?? []).filter((r: any) => r.producer_kind === 'source');
    const grp = (list: any[], st: string) => list.filter((r: any) => r.state === st);

    // ---- Individual findings: discrete monitors only (regression + never_produced) ----
    for (const r of grp(monitors, 'regression')) {
      await recordFinding(supabase, {
        severity: sev,
        title: `Silent-zero regression: ${r.producer} stopped producing`,
        analysis: `${r.producer} produced ${r.baseline_signals} signals in the 7–90d baseline but 0 in the last 7 days, while running ${r.recent_runs} times (reason: ${r.reason}). Was yielding, went silent — feed reachability, source, or match logic likely regressed.`,
        plainEnglish: `${r.producer} used to bring in intelligence and has produced nothing for a week despite running normally.`,
        action: `Investigate ${r.producer}: source reachable, match logic changed, or upstream genuinely quiet?${audit ? ' [AUDIT — not notifying yet.]' : ''}`,
        job: `${JOB}:${r.producer}`,
      });
    }
    for (const r of grp(monitors, 'never_produced')) {
      await recordFinding(supabase, {
        severity: sev,
        title: `Silent-zero never-produced: ${r.producer} yields nothing`,
        analysis: `${r.producer} has run and produced 0 signals over its entire history (lifetime_signals=0, ran ${r.recent_runs}× in 7d, span ${r.span_days}d, reason: ${r.reason}). Not a regression — it has never yielded. Likely mis-sourced or match-broken, or it should carry an evidence-bound precision declaration.`,
        plainEnglish: `${r.producer} runs regularly but has never once produced intelligence — it is either broken or pointed at the wrong source.`,
        action: `Verify ${r.producer}'s source + match, or file an evidence-bound precision declaration (expected_yield/basis/review_by) if 0 is genuinely correct.${audit ? ' [AUDIT — not notifying yet.]' : ''}`,
        job: `${JOB}:${r.producer}`,
      });
    }

    // ---- Single census finding: every state visible, sources rolled up (no per-source flood) ----
    const mCount = (st: string) => grp(monitors, st).length;
    const sCount = (st: string) => grp(sources, st).length;
    const names = (list: any[], st: string) => grp(list, st).map((r: any) => r.producer);
    const srcName = (st: string) => grp(sources, st).map((r: any) => r.producer.replace(/^rss:/, ''));

    const censusAnalysis =
      `Mode: ${audit ? `AUDIT (run ${(priorRuns ?? 0) + 1} of first 2 — regression/never_produced not notifying)` : 'PROMOTED (notifies)'}. ` +
      `MONITORS(15): healthy ${mCount('healthy')} [${sample(names(monitors, 'healthy'))}]; regression ${mCount('regression')} [${sample(names(monitors, 'regression'))}]; never_produced ${mCount('never_produced')} [${sample(names(monitors, 'never_produced'))}]; insufficient_history ${mCount('insufficient_history')} [${sample(names(monitors, 'insufficient_history'))}]; exempt ${mCount('precision_feed_exempt')}; unverified_exemption ${mCount('unverified_exemption')}. ` +
      `SOURCES(rss/url_feed via source_id — item D): healthy ${sCount('healthy')}; regression ${sCount('regression')} [${sample(srcName('regression'))}]; never_produced ${sCount('never_produced')} [${sample(srcName('never_produced'))}]; insufficient_history ${sCount('insufficient_history')}. ` +
      `Per-source not individually alerted (flood control) — rolled up here.`;

    await recordFinding(supabase, {
      severity: 'info',
      title: 'Silent-zero probe coverage census',
      analysis: censusAnalysis,
      plainEnglish: `Evaluated ${monitors.length} monitors + ${sources.length} RSS sources. Monitor regressions ${mCount('regression')}, never-produced ${mCount('never_produced')}. RSS sources: ${sCount('regression')} regressed, ${sCount('never_produced')} never produced — visible here, not individually alerted.`,
      action: 'Triage the RSS never_produced list (dead feeds → deactivate) and regression list (possible systemic intake issue). Monitor-level items have their own findings.',
      job: JOB,
    });

    const summary = {
      mode: audit ? 'audit' : 'promoted', prior_runs: priorRuns ?? 0,
      monitors: { regression: mCount('regression'), never_produced: mCount('never_produced'), healthy: mCount('healthy'), insufficient: mCount('insufficient_history'), exempt: mCount('precision_feed_exempt') },
      sources: { total: sources.length, healthy: sCount('healthy'), regression: sCount('regression'), never_produced: sCount('never_produced'), insufficient: sCount('insufficient_history') },
      individual_findings: grp(monitors, 'regression').length + grp(monitors, 'never_produced').length,
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
