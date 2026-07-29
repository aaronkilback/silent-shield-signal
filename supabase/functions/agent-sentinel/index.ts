// agent-sentinel — WO-SENTINEL-1. The first real security agent: a scheduled defensive
// posture probe. It does NOT pentest and does NOT touch the other agents — it verifies the
// platform's own attack surface stays closed and writes honest findings into the (now
// honestly-counting) watchdog findings store.
//
// Probes (v1):
//   1. RLS posture — public base tables with RLS disabled (excl. spatial_ref_sys). Any such
//      table is a defect; one that is ALSO anon-readable is a CRITICAL exposure.
//   2. Anon-key exposure control — actually authenticate as anon and try to read a curated
//      set of sensitive tables. Rows returned = live exposure (belt to the RLS suspenders).
//   3. Advisor-style summary — the RLS/anon checks mirror Supabase advisory
//      `rls_disabled_in_public`. Full Management-API advisor ingestion needs a PAT secret
//      and is honestly reported as NOT wired (reality-check, no fake capability).
//
// Findings flow through record_platform_finding() so they dedup + escalate like any watchdog
// finding. Clean posture writes NO finding (silence = healthy; attention is protected).

import { createClient } from "npm:@supabase/supabase-js@2";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Curated sensitive tables the anon key must NEVER be able to read. Positive controls even
// when RLS posture is clean — proves anon is actually denied, not just that RLS is "on".
const ANON_MUST_NOT_READ = [
  'signals', 'incidents', 'clients', 'entities', 'tenants',
  'agent_beliefs', 'expert_knowledge', 'incident_gate_decisions',
  'hazard_pathway_scores', 'platform_findings',
];

async function recordFinding(supabase: any, f: {
  category: string; severity: string; title: string; analysis: string;
  plainEnglish: string; action: string; job?: string;
}) {
  await supabase.rpc('record_platform_finding', {
    p_category: f.category, p_severity: f.severity, p_title: f.title,
    p_analysis: f.analysis, p_plain_english: f.plainEnglish, p_action: f.action,
    p_affected_agent: 'SENTINEL', p_affected_job: f.job ?? 'agent-sentinel-daily',
  }).then(() => null, (e: any) => console.warn('[sentinel] record_platform_finding failed:', e?.message));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? null;
  const supabase = createClient(url, serviceKey);
  const hb = await startHeartbeat(supabase, 'agent-sentinel-daily');

  const report = {
    rls_disabled_tables: [] as string[],
    rls_exposed_tables: [] as string[],      // RLS-disabled AND anon-readable
    anon_exposed_tables: [] as string[],     // empirically read by anon key
    anon_probe_ran: false,
    advisor_management_api: 'not_wired (needs Management-API PAT secret)',
    findings_written: 0,
  };

  try {
    // ── Probe 1: RLS posture ──
    const { data: posture, error: postErr } = await supabase.rpc('sentinel_rls_posture');
    if (postErr) throw new Error(`sentinel_rls_posture failed: ${postErr.message}`);
    for (const row of posture || []) {
      report.rls_disabled_tables.push(row.table_name);
      if (row.anon_readable) report.rls_exposed_tables.push(row.table_name);
    }
    if (report.rls_exposed_tables.length > 0) {
      await recordFinding(supabase, {
        category: 'security_posture', severity: 'critical',
        title: `RLS-disabled public tables are anon-readable: ${report.rls_exposed_tables.length}`,
        analysis: `Public tables with RLS disabled AND an anon SELECT grant (exposed to the unauthenticated anon key): ${report.rls_exposed_tables.join(', ')}. Violates the RLS-at-Creation standing rule + Supabase advisory rls_disabled_in_public.`,
        plainEnglish: `${report.rls_exposed_tables.length} database table(s) can be read by anyone with the public key. Seal them (enable RLS) immediately.`,
        action: 'Enable RLS on the listed tables (add a scoped policy first if the frontend reads them). See INC-RLS-EXPOSURE runbook.',
      });
      report.findings_written++;
    } else if (report.rls_disabled_tables.length > 0) {
      await recordFinding(supabase, {
        category: 'security_posture', severity: 'high',
        title: `RLS-disabled public tables (not anon-readable): ${report.rls_disabled_tables.length}`,
        analysis: `Public tables with RLS disabled but no anon SELECT grant: ${report.rls_disabled_tables.join(', ')}. Not currently exposed, but violates deny-by-default and is one grant away from exposure.`,
        plainEnglish: `${report.rls_disabled_tables.length} table(s) have row security turned off. Not leaking today, but should be sealed.`,
        action: 'Enable RLS on the listed tables per the RLS-at-Creation standing rule.',
      });
      report.findings_written++;
    }

    // ── Probe 2: anon-key exposure control ──
    if (anonKey) {
      report.anon_probe_ran = true;
      const anon = createClient(url, anonKey);
      for (const t of ANON_MUST_NOT_READ) {
        const { data, error } = await anon.from(t).select('*').limit(1);
        // A permission/RLS denial returns error OR empty data — both are HEALTHY.
        // Rows returned = the anon role actually read sensitive data = live exposure.
        if (!error && Array.isArray(data) && data.length > 0) {
          report.anon_exposed_tables.push(t);
        }
      }
      if (report.anon_exposed_tables.length > 0) {
        await recordFinding(supabase, {
          category: 'security_posture', severity: 'critical',
          title: `Anon key read sensitive tables: ${report.anon_exposed_tables.join(', ')}`,
          analysis: `The unauthenticated anon key returned rows from sensitive table(s): ${report.anon_exposed_tables.join(', ')}. This is a confirmed live data exposure (empirical, not just schema inspection).`,
          plainEnglish: `Anyone with the public key can read data from: ${report.anon_exposed_tables.join(', ')}. This is a live leak — seal immediately.`,
          action: 'Enable/repair RLS on the listed tables and re-run the anon probe to confirm closure.',
        });
        report.findings_written++;
      }
    } else {
      console.warn('[sentinel] SUPABASE_ANON_KEY not available — anon exposure probe skipped');
    }

    await completeHeartbeat(supabase, hb, {
      rls_disabled: report.rls_disabled_tables.length,
      rls_exposed: report.rls_exposed_tables.length,
      anon_exposed: report.anon_exposed_tables.length,
      anon_probe_ran: report.anon_probe_ran,
      findings_written: report.findings_written,
      posture: report.findings_written === 0 ? 'clean' : 'defects_found',
    });

    return new Response(JSON.stringify({ success: true, ...report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await failHeartbeat(supabase, hb, err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
