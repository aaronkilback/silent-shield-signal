/**
 * Send Daily Briefing Email
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { applyAnalystSignalFilter } from "../_shared/signal-query-filters.ts";
import { excludeDeletedSignals, excludeDeletedIncidents } from "../_shared/soft-delete-filters.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const hb = await startHeartbeat(supabase, 'send-daily-briefing-13utc');
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@silentshieldsecurity.com>';

    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const resend = new Resend(RESEND_API_KEY);
    const dateContext = getCriticalDateContext();

    console.log(`[DailyBriefing] Generating for ${dateContext.currentDateISO}`);

    const { data: briefingConfigs } = await supabase
      .from('scheduled_briefings')
      .select('*')
      .eq('is_active', true)
      .eq('briefing_type', 'daily_email');

    if (!briefingConfigs || briefingConfigs.length === 0) {
      return successResponse({ success: true, message: 'No active daily email briefings configured', sent: 0 });
    }

    const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();

    // 2026-05-09 quality fixes: signals now scope to active clients
    // (drops platform-level NAAD alerts from outside operational
    // regions); autonomous actions exclude operator-irrelevant types
    // (document ingestion, push-with-zero-recipients); active
    // sequences from Tier 1B added for the EMERGING PATTERNS section.
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, name, locations')
      .eq('status', 'active');
    const activeClientIds = (activeClients ?? []).map((c: any) => c.id);

    const [
      { data: recentSignals },
      { data: openIncidents },
      { data: recentActions },
      { data: activeSequences },
    ] = await Promise.all([
      // Quality filter (WO-CLIENT-THREAT-RELEVANCE 2026-08-12): quarantine filter so the briefing
      // never surfaces quarantined signals; attribution_type='none' exclusion applied post-fetch below.
      excludeDeletedSignals(applyAnalystSignalFilter(supabase.from('signals').select('id, category, severity, title, normalized_text, created_at, quality_score, relevance_score, triage_override, event_date, confidence, client_id, raw_json')
        .gte('created_at', cutoff24h)
        .neq('status', 'false_positive')
        .neq('is_test', true)
        .in('client_id', activeClientIds)
        .order('created_at', { ascending: false }).limit(50))),
      excludeDeletedIncidents(supabase.from('incidents').select('id, priority, status, opened_at, title, signal_id, client_id')
        .eq('status', 'open').neq('is_test', true)
        .in('client_id', activeClientIds)
        .order('opened_at', { ascending: false }).limit(50)),
      // Filter operator-irrelevant action types out of the briefing.
      // proactive_intelligence_push fires every 15 min; >95% of records
      // are "delivered to 0 recipients" platform plumbing. document_*
      // are content-ingest events from the operator UI, not autonomous
      // actions. Keep daily_email_briefing, monitoring_proposal_*,
      // and any incident-acting types.
      supabase.from('autonomous_actions_log').select('action_type, action_details, created_at, status')
        .gte('created_at', cutoff24h)
        .not('action_type', 'in', '(proactive_intelligence_push,document_dissemination,document_ingested,document_processed,daily_email_briefing)')
        .order('created_at', { ascending: false }).limit(20),
      // Tier 1B (May 9 2026): active escalation sequences for the
      // EMERGING PATTERNS section. signal_sequences groups otherwise-
      // independent signals into named multi-stage patterns. The
      // briefing renders these so operators see the joined view, not
      // the per-signal fragments.
      supabase.from('signal_sequences')
        .select('anchor_label, matched_stages, sequence_score, signal_ids, last_event_at, sequence_patterns(name, description), clients(name)')
        .in('status', ['open', 'escalated'])
        .order('last_event_at', { ascending: false })
        .limit(10),
    ]);

    // attribution_type='none' exclusion (WO-CLIENT-THREAT-RELEVANCE 2026-08-12): drop signals whose
    // attribution to the client was authoritatively superseded to 'none' (Option C), so corrected
    // fabrications never reach the briefing (the false Petronas "Summerland escalation").
    const { data: noneAttrs } = await supabase.from('signal_client_attributions')
      .select('signal_id').in('client_id', activeClientIds).eq('attribution_type', 'none').eq('is_authoritative', true);
    const noneSet = new Set((noneAttrs || []).map((a: any) => a.signal_id));

    // DOCTRINE: severity and proximity are not tie-breakers (2026-08-10). The delivery
    // layer was ranking/filtering by relevance_score — a keyword-relevance PROXY — so a
    // critical, proximity-verified BCWS evacuation Order 4.3 km from the operator's
    // children's school (relevance 0.4) was buried under higher-relevance provincewide
    // news during fire season. Same cheap-proxy substitution as the ingest-signal severity
    // downgrade and region-as-proxy-for-proximity, now in the delivery layer.
    // Rule: severity is the PRIMARY sort key; a critical / proximity-verified /
    // authoritative-source signal BYPASSES the quality & relevance floors entirely;
    // relevance breaks ties ONLY.
    const AUTH_SOURCE_RE = /^(bcws|cwfis|naad|cap|cisa|court)/i;  // WO-AUTHORITATIVE-SOURCE-PRECEDENCE feeds
    const isProximityVerified = (s: any): boolean => {
      const rj = s.raw_json || {};
      return !!(rj.proximity && (rj.proximity.nearest_km != null || rj.proximity.radius_km != null))
        || rj.signal_origin === 'monitor-geo-wildfire' || rj.signal_origin === 'monitor-wildfires';
    };
    const isAuthoritative = (s: any): boolean => {
      const rj = s.raw_json || {};
      return rj.authoritative_source === true
        || (typeof rj.source === 'string' && AUTH_SOURCE_RE.test(rj.source));
    };
    const bypassesFloor = (s: any): boolean =>
      s.severity === 'critical' || isProximityVerified(s) || isAuthoritative(s);
    const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

    // Filter signals for briefing quality: exclude historical + stale; floors bypassed for critical/proximity/authoritative.
    const briefingSignals = (recentSignals || []).filter((s: any) => {
      if (noneSet.has(s.id)) return false;             // attribution superseded to 'none' — not this client's
      if (s.triage_override === 'historical') return false;
      if (s.event_date) {
        const eventDate = new Date(s.event_date);
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
        if (eventDate < ninetyDaysAgo) return false;   // historical is a correctness filter — applies to all
      }
      if (bypassesFloor(s)) return true;               // critical / proximity / authoritative: never dropped by a relevance proxy
      if (s.quality_score !== null && s.quality_score < 0.4) return false;
      if (s.relevance_score !== null && s.relevance_score < 0.4) return false;
      return true;
    });

    // Severity-first ordering; proximity/authoritative next; relevance is the TIE-BREAK only.
    briefingSignals.sort((a: any, b: any) => {
      const ra = SEV_RANK[a.severity] ?? 4, rb = SEV_RANK[b.severity] ?? 4;
      if (ra !== rb) return ra - rb;
      const pa = (isProximityVerified(a) || isAuthoritative(a)) ? 0 : 1;
      const pb = (isProximityVerified(b) || isAuthoritative(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const rela = a.relevance_score ?? 0, relb = b.relevance_score ?? 0;
      if (relb !== rela) return relb - rela;           // relevance breaks ties ONLY
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // FUZZY CROSS-OUTLET DEDUP (ported from generate-executive-report 2026-08-21). Two outlets writing the
    // same story never share an exact title (the Kitimat "Eco Depot" grant appeared twice). Merge same-client
    // same-day signals whose titles are trigram-similar >= 0.50 (pg_trgm-equivalent), keeping the highest-
    // ranked (briefingSignals is already severity-sorted, so the first-seen representative is the strongest).
    {
      const _pgTri = (str: string): Set<string> => {
        const set = new Set<string>();
        for (const w of (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)) {
          const p = '  ' + w + ' ';
          for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
        }
        return set;
      };
      const _sim = (a: string, b: string): number => {
        const A = _pgTri(a), B = _pgTri(b);
        if (A.size === 0 || B.size === 0) return 0;
        let inter = 0; for (const t of A) if (B.has(t)) inter++;
        return inter / (A.size + B.size - inter);
      };
      const _day = (iso: string) => String(iso || '').slice(0, 10);
      const kept: any[] = [];
      for (const s of briefingSignals) {
        if (!kept.some((r: any) => r.client_id === s.client_id && _day(r.created_at) === _day(s.created_at) && _sim(r.title || '', s.title || '') >= 0.50)) {
          kept.push(s);
        }
      }
      briefingSignals.length = 0;
      briefingSignals.push(...kept);
    }

    // Risk score formula — was previously just `recentScans?.[0]?.risk_score`,
    // which gave 100/100 with 0 critical signals because the autonomous
    // scan tracked something orthogonal. Compute directly from today's
    // signal + incident reality so the score matches the rest of the
    // briefing:
    //   - critical signals: +30 each, capped at 60 (a couple of true P1s
    //     should already register as ELEVATED, but a hundred shouldn't
    //     dwarf incident evidence)
    //   - high signals: +5 each, capped at 30 (a flood of high alone
    //     can't max the score — needs incidents or critical to confirm)
    //   - open P1 incidents: +10 each, capped at 20 (named P1 evidence
    //     is the strongest individual signal of an elevated posture)
    // 70+ = ELEVATED, 40+ = MODERATE — both threshold cuts unchanged.
    const criticalSignalsCount = briefingSignals.filter((s: any) => s.severity === 'critical').length;
    const highSignalsCount = briefingSignals.filter((s: any) => s.severity === 'high').length;
    const openIncidentsList = openIncidents || [];
    const openP1Count = openIncidentsList.filter((i: any) => (i.priority || '').toLowerCase() === 'p1').length;
    const openP2Count = openIncidentsList.filter((i: any) => (i.priority || '').toLowerCase() === 'p2').length;

    const computedRiskScore = Math.min(
      100,
      Math.min(criticalSignalsCount * 30, 60)
        + Math.min(highSignalsCount * 5, 30)
        + Math.min(openP1Count * 10, 20)
    );

    const metrics = {
      signals_24h: briefingSignals.length,
      total_ingested_24h: (recentSignals || []).length,
      filtered_out: (recentSignals || []).length - briefingSignals.length,
      critical_signals: criticalSignalsCount,
      high_signals: highSignalsCount,
      open_incidents: openIncidentsList.length,
      open_p1_incidents: openP1Count,
      open_p2_incidents: openP2Count,
      risk_score: computedRiskScore,
      autonomous_actions: (recentActions || []).length,
    };

    // DEDUP GUARD — use 20-hour lookback (timezone-safe)
    const dedupCutoff = new Date(Date.now() - 20 * 3600000).toISOString();
    const { data: alreadySent } = await supabase
      .from('autonomous_actions_log')
      .select('id')
      .eq('action_type', 'daily_email_briefing')
      .in('status', ['completed', 'partial'])
      .gte('created_at', dedupCutoff)
      .limit(1);

    if (alreadySent && alreadySent.length > 0) {
      console.log('[DailyBriefing] Already sent within 20h — dedup blocked');
      return successResponse({ success: true, message: 'Briefing already sent within 20 hours', sent: 0, deduplicated: true });
    }

    // QUIET-DAY (2026-08-21 ruling): send when there is something to SAY. "Something" = an ACTIONABLE item
    // (a priority-worthy signal or an open incident), not merely "any activity" — a low-value Eco-Depot grant
    // should not force a full briefing. On a quiet day, send a one-line PROOF-OF-LIFE note that states the
    // denominator the way the exposure report's Section 1 does — collected / covered / ran / failed — so a
    // client can tell "nothing happened" from "nothing was looked at". Silence could be a broken cron; a
    // stated denominator is proof of coverage, and the strongest thing the briefing can say on a slow day.
    const priorityWorthy = briefingSignals.filter((s: any) =>
      s.severity === 'critical' || s.severity === 'high' || isProximityVerified(s) || isAuthoritative(s));
    const hasActionable = priorityWorthy.length > 0 || openIncidentsList.length > 0;

    if (!hasActionable) {
      const { data: hb24 } = await supabase.from('cron_heartbeat')
        .select('job_name, status').gte('started_at', cutoff24h).limit(500);
      const ranJobs = new Set((hb24 ?? []).filter((r: any) => ['succeeded', 'completed'].includes(r.status)).map((r: any) => r.job_name));
      const failedJobs = [...new Set((hb24 ?? []).filter((r: any) => r.status === 'failed').map((r: any) => r.job_name))];
      const collected = (recentSignals ?? []).length;
      const categories = new Set((recentSignals ?? []).map((s: any) => s.category).filter(Boolean));
      const denomLine = `Quiet period. ${collected} signal${collected === 1 ? '' : 's'} collected across ${categories.size} categor${categories.size === 1 ? 'y' : 'ies'}, ${ranJobs.size} monitor${ranJobs.size === 1 ? '' : 's'} ran, no priority items`
        + (failedJobs.length ? `. Coverage note: ${failedJobs.length} monitor(s) failed (${failedJobs.slice(0, 4).join(', ')})${failedJobs.length > 4 ? '…' : ''}.` : '.');
      const quietHtml = buildQuietNote(denomLine, dateContext);
      let qsent = 0;
      for (const config of briefingConfigs) {
        for (const email of (config.recipient_emails || [])) {
          try { await resend.emails.send({ from: fromEmail, to: [email], subject: `🛡️ Fortress Daily Briefing — ${dateContext.currentDateFormatted} (quiet period)`, html: quietHtml }); qsent++; }
          catch (err) { console.error('[DailyBriefing] quiet-note send failed:', err); }
        }
        await supabase.from('scheduled_briefings').update({ last_run_at: new Date().toISOString() }).eq('id', config.id);
      }
      await supabase.from('autonomous_actions_log').insert({
        action_type: 'daily_email_briefing', trigger_source: 'cron',
        action_details: { quiet_day: true, sent_count: qsent, denominator: denomLine, date: dateContext.currentDateISO }, status: 'completed',
      });
      await completeHeartbeat(supabase, hb, { sent: qsent, quiet_day: true, signals_collected: collected, monitors_ran: ranJobs.size, monitors_failed: failedJobs.length });
      return successResponse({ success: true, quiet_day: true, sent: qsent, denominator: denomLine });
    }

    // Calculate trajectory vs previous 7-day period
    const previousPeriodStart = new Date(Date.now() - 8 * 24 * 3600000).toISOString();
    const { data: previousSignals } = await excludeDeletedSignals(supabase
      .from('signals')
      .select('id, severity'))
      .gte('created_at', previousPeriodStart)
      .lt('created_at', cutoff24h)
      .neq('status', 'false_positive')
      .neq('is_test', true);

    const previousCriticalCount = (previousSignals || []).filter((s: any) => s.severity === 'critical').length;
    const previousHighCount = (previousSignals || []).filter((s: any) => s.severity === 'high').length;
    const previousTotalPriority = previousCriticalCount + previousHighCount;
    const currentTotalPriority = metrics.critical_signals + metrics.high_signals;

    // COVERAGE-INTEGRITY GATE (2026-08-21 ruling): a trajectory is a claim about the world, and it can only
    // be made if coverage was intact. If monitors failed or a feed was dark during the comparison window,
    // the direction is UNKNOWN — NOT a direction with a footnote (a direction with a disclaimer is worse
    // than no direction: the reader takes the direction and ignores the footnote). Check coverage FIRST;
    // only compute a delta-based direction when coverage held.
    let coverageDegraded = false;
    const coverageCauses: string[] = [];
    {
      const { data: monitorIssues } = await supabase.from('cron_heartbeat')
        .select('job_name').gte('started_at', previousPeriodStart).lt('started_at', cutoff24h)
        .eq('status', 'failed').limit(50);
      const failedMonitorNames = new Set((monitorIssues ?? []).map((r: any) => r.job_name));
      const { data: twitterCron } = await supabase.from('cron_heartbeat')
        .select('job_name').eq('job_name', 'monitor-twitter-30min').gte('started_at', previousPeriodStart).limit(1).maybeSingle();
      if (!twitterCron) { coverageDegraded = true; coverageCauses.push('monitor-twitter dark for the comparison period'); }
      if (failedMonitorNames.size > 0) { coverageDegraded = true; coverageCauses.push(`${failedMonitorNames.size} monitor(s) failed during the comparison window`); }
    }
    const trajectoryDelta = currentTotalPriority - previousTotalPriority;
    const trajectoryDirection = coverageDegraded ? 'UNKNOWN'
      : currentTotalPriority > previousTotalPriority * 1.2 ? 'ESCALATING'
      : currentTotalPriority < previousTotalPriority * 0.8 ? 'DE-ESCALATING' : 'STABLE';
    const trajectoryReason = coverageDegraded
      ? `coverage was degraded (${coverageCauses.join(' + ')}) — the trend cannot be measured, so it is reported as UNKNOWN rather than inferred from an incomplete signal count`
      : `${Math.abs(trajectoryDelta)} ${trajectoryDelta >= 0 ? 'more' : 'fewer'} priority signals vs previous 7-day period (${previousTotalPriority} → ${currentTotalPriority})`;

    // Footer line — replaces the old "doctrine quote" boilerplate
    // (operators tuned the inspirational quote out anyway). Now a
    // domain-specific one-liner derived from already-computed metrics:
    // trajectory direction + delta vs the prior 7-day baseline.
    const arrow =
      trajectoryDirection === 'ESCALATING' ? '↑' :
      trajectoryDirection === 'DE-ESCALATING' ? '↓' :
      trajectoryDirection === 'UNKNOWN' ? '?' : '→';
    const footerLine =
      `Trajectory ${arrow} ${trajectoryDirection.replace(/-/g, ' ').toLowerCase()} — ` +
      `${trajectoryReason}.`;

    // Generate briefing content
    const briefingResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Fortress AI, the senior intelligence officer for a corporate security operations center. Generate a daily security briefing email that reads like a classified intelligence product — not a dashboard summary.

CRITICAL RULES:
- Do NOT mention historical events (>90 days old) as current threats. They have already been filtered out.
- Do NOT pad the briefing with generic security advice. Every sentence must be grounded in TODAY's data.
- If there are few signals, say so honestly. A quiet day is valuable intelligence.
- Prioritize: What changed? What's new? What requires action?
- Name specific entities, locations, and categories. Vague language like "various threats were detected" is unacceptable.
- FORMAT — PLAIN TEXT ONLY. Do NOT use markdown: no **, __, #, backticks, or the › character — they render literally in the email. Section headings are UPPERCASE lines (e.g. SITUATION OVERVIEW). Bullets start with "- ". The email template styles UPPERCASE headings and "- " bullets; any other markup appears as raw characters to the client.

MANDATORY INTELLIGENCE TRADECRAFT RULES:
- Write ALL surnames of named individuals in CAPITALS throughout (e.g., activist BROOKS, journalist NUNES, organizer MEYER). This is non-negotiable.
- Open the SITUATION OVERVIEW section with a BLUF (Bottom Line Up Front) — one sentence stating the single most important thing the reader needs to know before anything else.
- For each section, state the trajectory: ESCALATING / STABLE / DE-ESCALATING / UNKNOWN with one sentence of evidence. Use UNKNOWN when coverage was degraded (a monitor failed or a feed was dark) — never assert a direction the data cannot support. The overall trajectory is provided to you; do not contradict it.
- Label all analytical conclusions with DEDUCTIONS: in the EMERGING PATTERNS section.
- In RECOMMENDED POSTURE, every recommendation must include a specific timeframe (Immediate / 24 hours / 48 hours / This week) and an owner. The owner MUST be either a specific named individual explicitly provided in the input, or the literal word "Unassigned" — NEVER a role or team category. Do NOT write "Security Operations", "Intelligence Analyst", "Physical Security Lead", "Cyber Security Lead", or any role title as an owner; a role is not an owner (finding #4 — no static role strings). If no named individual is provided, the owner is "Unassigned".
- If a section has no relevant activity, state clearly: "No significant activity in this category during the reporting period." Do not pad with generic filler content.
- Never use vague language like "may pose risks" or "could potentially" — state the specific risk and the specific implication for the client directly.

Current date: ${dateContext.currentDateFormatted}, ${dateContext.currentTime24h} ${dateContext.currentTimezone}.

Structure:
1. SITUATION OVERVIEW (2-3 sentences — open with BLUF, then overall posture and trajectory)
2. KEY METRICS (bullet-style numbers with context, not just raw counts)
3. PRIORITY SIGNALS (ONLY the genuinely actionable signals — anywhere from 0 to 5, NEVER padded to a count. For each: what, where, severity, why it matters. The ACTIONABLE SIGNALS below are pre-sorted by severity then proximity — any critical-severity, proximity-verified, or authoritative-source (BCWS/CAP/CISA/court) signal MUST lead this section and MUST NOT be omitted in favour of a lower-severity but broader item; a specific evacuation Order near an asset outranks a provincewide advisory. If NONE of the signals rise to genuine priority, write exactly: "No priority signals this period." — do NOT manufacture items to fill the section. An honestly empty priority list is a true and better statement than a promoted non-event.)
4. EMERGING PATTERNS (any trends or clusters with DEDUCTIONS: label — if none, say "No significant activity in this category during the reporting period.")
5. RECOMMENDED POSTURE (specific actions with a timeframe and an owner that is a real named individual or "Unassigned" — never a role title — not generic advice)

Tone: Calm, authoritative, measured. Like a senior intelligence officer delivering a classified briefing. Zero filler words.`,
        },
        {
          role: 'user',
          content: `Generate today's daily briefing.

METRICS:
${JSON.stringify({ ...metrics, trajectory: trajectoryDirection, trajectoryReason }, null, 2)}

ACTIONABLE SIGNALS (filtered for quality and recency — ${briefingSignals.length} of ${(recentSignals || []).length} total):
${JSON.stringify(briefingSignals.slice(0, 10).map((s: any) => ({ severity: s.severity, category: s.category, title: s.title, normalized_text: (s.normalized_text || '').substring(0, 200), confidence: s.confidence, quality_score: s.quality_score })), null, 2)}

OPEN INCIDENTS (${openIncidentsList.length}):
${JSON.stringify(openIncidentsList.slice(0, 10).map((i: any) => ({
  id_short: String(i.id || '').slice(0, 8),
  priority: i.priority,
  title: i.title || '(untitled)',
  opened_at: i.opened_at,
})), null, 2)}

AUTONOMOUS ACTIONS taken in the last 24h (${(recentActions || []).length}):
${JSON.stringify((recentActions || []).slice(0, 12).map((a: any) => ({
  action: a.action_type,
  detail: typeof a.action_details === 'object'
    ? Object.entries(a.action_details || {}).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v.substring(0, 60) : v}`).join(' · ')
    : String(a.action_details || '').substring(0, 100),
  at: a.created_at,
})), null, 2)}

ACTIVE SIGNAL SEQUENCES (Tier 1B multi-stage patterns, ${(activeSequences || []).length}):
${JSON.stringify((activeSequences || []).map((s: any) => ({
  pattern: (s.sequence_patterns as any)?.name,
  client: (s.clients as any)?.name,
  anchor: s.anchor_label,
  matched_stages: s.matched_stages,
  score: typeof s.sequence_score === 'number' ? Number(s.sequence_score.toFixed(2)) : null,
  signal_count: Array.isArray(s.signal_ids) ? s.signal_ids.length : 0,
  last_event: s.last_event_at,
})), null, 2)}

When you write the KEY METRICS section, NAME the open incidents (priority + title) and the autonomous actions (action + brief detail), don't summarize them as raw counts. If there are zero of either, say so explicitly.

When you write the EMERGING PATTERNS section, USE the ACTIVE SIGNAL SEQUENCES list above as the primary content. For each sequence, write one DEDUCTION line that names: pattern, client, anchor, which stages have matched, and the sequence score. If the list is empty, say "No active multi-stage patterns detected in this period." — do not pad. Sequences are the platform's joined-view output; the briefing must surface them where they exist.`,
        },
      ],
      functionName: 'send-daily-briefing',
      extraBody: { max_tokens: 1500, temperature: 0.2 },
      dlqOnFailure: true,
      dlqPayload: { date: dateContext.currentDateISO, metrics },
    });

    if (briefingResult.error) {
      throw new Error(`AI generation failed: ${briefingResult.error}`);
    }

    const briefingText = briefingResult.content || 'Unable to generate briefing content.';

    const appUrl = Deno.env.get('APP_URL') || Deno.env.get('SITE_URL') || 'https://fortress.silentshieldsecurity.com';
    const feedbackBaseUrl = `${appUrl}/briefing-feedback`;

    const emailHtml = buildBriefingEmail(briefingText, metrics, dateContext, footerLine, feedbackBaseUrl);

    let sentCount = 0;
    const errors: string[] = [];

    for (const config of briefingConfigs) {
      const recipients = config.recipient_emails || [];
      
      for (const email of recipients) {
        try {
          await resend.emails.send({
            from: fromEmail, to: [email],
            subject: `🛡️ Fortress Daily Briefing — ${dateContext.currentDateFormatted}`,
            html: emailHtml,
          });
          sentCount++;
        } catch (err) {
          console.error(`[DailyBriefing] Failed to send to ${email}:`, err);
          errors.push(`${email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      await supabase.from('scheduled_briefings').update({ last_run_at: new Date().toISOString() }).eq('id', config.id);
    }

    await supabase.from('autonomous_actions_log').insert({
      action_type: 'daily_email_briefing', trigger_source: 'cron',
      action_details: { sent_count: sentCount, errors, date: dateContext.currentDateISO },
      status: errors.length === 0 ? 'completed' : 'partial',
    });

    // Generate audio version of the daily briefing
    let audioUrl: string | null = null;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const audioResponse = await fetch(`${supabaseUrl}/functions/v1/generate-briefing-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          content: briefingText,
          title: `Daily Briefing ${dateContext.currentDateFormatted}`,
          user_id: 'system',
        }),
      });

      if (audioResponse.ok) {
        const audioResult = await audioResponse.json();
        audioUrl = audioResult.audio_url;

        // Record in audio_briefings table
        await supabase.from('audio_briefings').insert({
          title: `Daily Intelligence Briefing — ${dateContext.currentDateFormatted}`,
          content_text: briefingText,
          audio_url: audioUrl,
          source_type: 'daily_briefing',
          source_id: dateContext.currentDateISO,
          status: 'completed',
          chunks_processed: audioResult.chunks_processed || 1,
          duration_seconds: audioResult.duration_estimate || null,
          user_id: briefingConfigs[0]?.created_by || '00000000-0000-0000-0000-000000000000',
        });

        console.log(`[DailyBriefing] Audio briefing generated: ${audioUrl}`);
      } else {
        const errText = await audioResponse.text();
        console.error(`[DailyBriefing] Audio generation failed: ${errText}`);
      }
    } catch (audioErr) {
      console.error('[DailyBriefing] Audio generation error (non-blocking):', audioErr);
    }

    await completeHeartbeat(supabase, hb, {
      sent: sentCount,
      errors: errors.length,
      signals_24h: metrics.signals_24h,
      open_incidents: metrics.open_incidents,
      sequences_active: (activeSequences ?? []).length,
    });

    return successResponse({ success: true, sent: sentCount, audio_url: audioUrl, errors: errors.length > 0 ? errors : undefined, date: dateContext.currentDateISO });
  } catch (error) {
    console.error('[DailyBriefing] Error:', error);
    try {
      const supabase = createServiceClient();
      await failHeartbeat(supabase, { id: '', job_name: 'send-daily-briefing-13utc' } as any, error);
    } catch { /* best-effort */ }
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

function formatBriefingLines(text: string): string {
  // Safety net (NOT a converter): the LLM is prompted for plain text the template styles. If a stray
  // markdown marker slips through, strip it so it never renders literally (the ** / › defect) — we remove
  // markers, we do not translate them to a second formatting system.
  const strip = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^\s*#+\s*/, '');
  return text.split('\n').map(raw => {
    const line = strip(raw);
    if (!line.trim()) return '<br>';
    if (line.trim().match(/^[A-Z\s]{4,}:?$/)) {
      return '<h3 style="color:#f1f5f9; font-size:13px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 8px; border-bottom:1px solid #334155; padding-bottom:6px;">' + line.trim() + '</h3>';
    }
    if (line.trim().startsWith('- ') || line.trim().startsWith('• ') || line.trim().startsWith('› ')) {
      return '<p style="margin:4px 0; padding-left:16px; color:#94a3b8;">› ' + line.trim().replace(/^[-•›]\s*/, '') + '</p>';
    }
    return '<p style="margin:6px 0;">' + line + '</p>';
  }).join('\n');
}

// Quiet-day proof-of-life note (2026-08-21 ruling): sent instead of a full briefing when nothing is
// actionable. States the denominator (collected / covered / ran / failed) so silence is informative.
function buildQuietNote(denomLine: string, dateContext: { currentDateFormatted: string }): string {
  const safe = denomLine.replace(/[<>]/g, '');
  return `<!DOCTYPE html><html><body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#64748b;">Fortress Daily Briefing — ${dateContext.currentDateFormatted}</div>
    <h2 style="font-size:16px;color:#f1f5f9;margin:14px 0 8px;">Quiet period</h2>
    <p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0 0 14px;">${safe}</p>
    <p style="font-size:12px;color:#64748b;margin:0;">No item rose to priority today, so there is no full briefing. This note states what the pipeline collected and which monitors ran — proof of coverage, not an empty send.</p>
  </div></body></html>`;
}

function buildBriefingEmail(
  briefingText: string, metrics: Record<string, number>,
  dateContext: { currentDateFormatted: string; currentTime24h: string; currentTimezone: string; currentDateISO: string },
  footerLine: string, feedbackBaseUrl: string
): string {
  const riskColor = metrics.risk_score >= 70 ? '#dc2626' : metrics.risk_score >= 40 ? '#f59e0b' : '#059669';
  const riskLabel = metrics.risk_score >= 70 ? 'ELEVATED' : metrics.risk_score >= 40 ? 'MODERATE' : 'NORMAL';

  const thumbsUpUrl = `${feedbackBaseUrl}?f=positive&d=${dateContext.currentDateISO}`;
  const thumbsDownUrl = `${feedbackBaseUrl}?f=negative&d=${dateContext.currentDateISO}`;

  // Footer is a domain-specific trajectory line (replaces the old
  // inspirational doctrine quote — operators reported it was filler).
  const doctrineSection = footerLine ? `
    <div style="padding:16px 30px; border-top:1px solid #334155; text-align:center;">
      <p style="color:#94a3b8; font-size:12px; margin:0; line-height:1.6;">${footerLine}</p>
    </div>` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#0f172a; font-family: 'Segoe UI', Arial, sans-serif;">
  <div style="max-width:600px; margin:0 auto; background:#1e293b; border-radius:12px; overflow:hidden; margin-top:20px; margin-bottom:20px;">
    <div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding:30px 30px 20px; border-bottom:1px solid #334155;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:40px; height:40px; background:linear-gradient(135deg, #3b82f6, #06b6d4); border-radius:8px; display:flex; align-items:center; justify-content:center;">
          <span style="font-size:20px;">🛡️</span>
        </div>
        <div>
          <h1 style="color:#f1f5f9; margin:0; font-size:20px; font-weight:600;">Fortress Daily Briefing</h1>
          <p style="color:#94a3b8; margin:4px 0 0; font-size:13px;">${dateContext.currentDateFormatted} · ${dateContext.currentTime24h} ${dateContext.currentTimezone}</p>
        </div>
      </div>
    </div>
    <div style="padding:16px 30px; background:${riskColor}15; border-bottom:1px solid #334155;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:10px; height:10px; background:${riskColor}; border-radius:50%;"></div>
        <span style="color:${riskColor}; font-weight:600; font-size:14px;">THREAT POSTURE: ${riskLabel}</span>
        <span style="color:#64748b; font-size:13px; margin-left:auto;">Score: ${metrics.risk_score}/100</span>
      </div>
    </div>
    <div style="padding:20px 30px; display:flex; gap:12px; border-bottom:1px solid #334155;">
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Signals</div>
        <div style="color:#f1f5f9; font-size:24px; font-weight:700; margin-top:4px;">${metrics.signals_24h}</div>
      </div>
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Incidents</div>
        <div style="color:#f1f5f9; font-size:24px; font-weight:700; margin-top:4px;">${metrics.open_incidents}</div>
      </div>
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#dc2626; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Critical</div>
        <div style="color:#dc2626; font-size:24px; font-weight:700; margin-top:4px;">${metrics.critical_signals}</div>
      </div>
    </div>
    <div style="padding:24px 30px; color:#cbd5e1; font-size:14px; line-height:1.7;">
      ${formatBriefingLines(briefingText)}
    </div>
    ${doctrineSection}
    <div style="padding:20px 30px; border-top:1px solid #334155; text-align:center;">
      <p style="color:#64748b; font-size:12px; margin:0 0 12px; text-transform:uppercase; letter-spacing:0.5px;">Was this briefing useful?</p>
      <div style="display:inline-flex; gap:16px;">
        <a href="${thumbsUpUrl}" style="display:inline-block; padding:10px 24px; background:#059669; color:#fff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">👍 Useful</a>
        <a href="${thumbsDownUrl}" style="display:inline-block; padding:10px 24px; background:#334155; color:#94a3b8; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">👎 Not Useful</a>
      </div>
      <p style="color:#475569; font-size:11px; margin:10px 0 0;">Your feedback trains Fortress to deliver better intelligence.</p>
    </div>
    <div style="padding:20px 30px; background:#0f172a; border-top:1px solid #334155; text-align:center;">
      <p style="color:#475569; font-size:11px; margin:0;">Automated intelligence briefing from Fortress AI · Delivered ${dateContext.currentDateFormatted}</p>
      <p style="color:#334155; font-size:10px; margin:8px 0 0;">To adjust delivery preferences, update your scheduled briefings in Fortress.</p>
    </div>
  </div>
</body>
</html>`;
}