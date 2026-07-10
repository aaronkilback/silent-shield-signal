import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { getCallerIdentity, getAccessibleClientIds } from "../_shared/supabase-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Health check endpoint for pipeline tests
    if (body.health_check) {
      return new Response(
        JSON.stringify({ 
          status: 'healthy', 
          function: 'generate-report',
          timestamp: new Date().toISOString() 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const supabaseClient = supabase;

    const { report_type, period_hours, client_id: requestedClientId } = body;

    console.log(`Generating ${report_type} report for last ${period_hours} hours${requestedClientId ? ` (client=${requestedClientId})` : ' (cross-client)'}`);

    const periodStart = new Date();
    periodStart.setHours(periodStart.getHours() - (period_hours || 72));
    const periodEnd = new Date();

    // ── GENERIC TOOL PATH CLEARANCE — Wave 2 caller→scope gate ──────────────────
    // generate-report reads operational data (signals/incidents/…) via a SERVICE-ROLE
    // client (bypasses RLS) under verify_jwt=false. Establish the caller and bind scope:
    //   unauthorized → reject; user → may only target a client in getAccessibleClientIds
    //   (super_admin = unrestricted admin mode); service_role → trusted (scheduled/admin).
    // callerAccessibleClientIds === null means UNRESTRICTED (service_role or super_admin) —
    // the ONLY path allowed to produce a cross-client (all-clients) report.
    const _caller = await getCallerIdentity(req);
    if (_caller.kind === 'unauthorized') {
      return new Response(JSON.stringify({ error: _caller.error }), { status: _caller.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    let callerAccessibleClientIds: string[] | null = null;
    if (_caller.kind === 'user') {
      callerAccessibleClientIds = await getAccessibleClientIds(supabase, _caller.userId);
      const { data: _sa } = await supabase.from('user_roles').select('role').eq('user_id', _caller.userId).eq('role', 'super_admin').maybeSingle();
      if (_sa) callerAccessibleClientIds = null; // super_admin → unrestricted (explicit admin mode)
    }

    // Resolve the allowed client_id set up-front. The snapshot MUST
    // never include:
    //   • sandbox / QA fixture clients (name starts with `_` —
    //     `_qa_test_client`, `_benchmark_petronas`, etc.)
    //   • inactive clients (status != 'active')
    //   • signals with is_test = true (QA agent fabrications that
    //     legitimately land on _qa_test_client but must never be
    //     treated as real intelligence)
    //
    // Earlier QA contamination incident (May 7): fortress-qa-agent was
    // injecting fabricated CGL sabotage / Wet'suwet'en blockade signals
    // into Petronas via cron. The boundary was added in ingest-signal,
    // but generate-report still pulled them via the cross-client query.
    // This block enforces the same boundary at the report side: a
    // request without client_id falls back to "all real, active
    // clients", a request with client_id is verified to be a real
    // client. Either way, sandbox + is_test rows never reach the
    // narrative pipeline.
    const { data: realClients } = await supabaseClient
      .from('clients')
      .select('id, name, status, tenant_id, locations, high_value_assets, monitoring_keywords')
      .eq('status', 'active')
      .not('name', 'like', '\\_%');
    const realClientIds = (realClients ?? []).map((c: any) => c.id);
    if (realClientIds.length === 0) {
      throw new Error('No real active clients configured — cannot generate snapshot');
    }
    let allowedClientIds: string[];
    let scopedClientName: string | null = null;
    if (requestedClientId) {
      if (!realClientIds.includes(requestedClientId)) {
        throw new Error('Requested client is not an active real client');
      }
      // Wave 2: a user caller may only target a client it can access (super_admin/service
      // bypass via callerAccessibleClientIds === null). Reject a body-supplied mismatch.
      if (callerAccessibleClientIds !== null && !callerAccessibleClientIds.includes(requestedClientId)) {
        return new Response(JSON.stringify({ error: 'CLIENT_NOT_AUTHORIZED: caller cannot access the requested client_id' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      allowedClientIds = [requestedClientId];
      scopedClientName = (realClients ?? []).find((c: any) => c.id === requestedClientId)?.name ?? null;
    } else {
      // Wave 2: NO all-clients fallback for normal (user) callers — fail closed. Only an
      // UNRESTRICTED caller (service_role / super_admin) may produce a cross-client report
      // (explicit, labelled admin/scheduled mode).
      if (callerAccessibleClientIds !== null) {
        return new Response(JSON.stringify({ error: 'CLIENT_CONTEXT_MISSING: client_id is required for report generation' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      allowedClientIds = realClientIds;
    }

    // Fetch signals in time window — actionable, relevant, real-client only.
    // Exclude: false_positive, archived, irrelevant (relevance_score < 0.45),
    // is_test=true, sandbox clients.
    const { data: signals, error: signalsError } = await supabaseClient
      .from('signals')
      .select('*')
      .in('client_id', allowedClientIds)
      .or('is_test.is.null,is_test.eq.false')
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .neq('status', 'archived')
      .neq('status', 'false_positive')
      .not('category', 'eq', 'industrial_flaring')
      .not('normalized_text', 'ilike', '%industrial flaring%')
      .not('normalized_text', 'ilike', '%thermal anomaly%flaring%')
      // 2026-05-10: drop [PATTERN] synthetic signals from the snapshot.
      // The pattern-detector emits self-referential meta-signals like
      // "[PATTERN] Frequency spike: 3 signals this week (1 prior week)"
      // — these are inventory-management markers (we counted more
      // signals than last week), not external threats. Operator-facing
      // reports were treating them as threat content and the synthesis
      // AI was framing trivial 1→3 weekly deltas as "notable active-
      // threat spikes." Internal metabolism doesn't belong in a
      // protective-intelligence narrative. The pattern detector still
      // fires; its output is just not eligible for snapshot prose.
      .not('title', 'ilike', '\\[PATTERN\\]%')
      .gte('relevance_score', 0.45)
      .order('received_at', { ascending: false })
      .limit(200);

    if (signalsError) throw signalsError;

    // Notable Incidents — opened in window AND still actionable (open /
    // acknowledged / investigating). Don't render closed, resolved,
    // contained, or mitigated incidents — they've been adjudicated and
    // should not show up under "Notable Incidents" as if they need
    // attention. The BCCH false-positive incident closed earlier today
    // was leaking through here because the query ignored status.
    const { data: incidents, error: incidentsError } = await supabaseClient
      .from('incidents')
      .select('*')
      .in('client_id', allowedClientIds)
      .in('status', ['open', 'acknowledged', 'investigating'])
      .gte('opened_at', periodStart.toISOString())
      .lte('opened_at', periodEnd.toISOString())
      .order('opened_at', { ascending: false });

    if (incidentsError) throw incidentsError;

    // Active Investigations — query by file_status, not creation date.
    // The previous query only showed investigations OPENED in the last
    // 72 hours, which silently hid every long-running open file.
    // Operators expect "Active Investigations" to show whatever is
    // currently active regardless of when it was started; if it's been
    // open for 6 weeks it should still appear here.
    const { data: investigations, error: investigationsError } = await supabaseClient
      .from('investigations')
      .select('*')
      .in('client_id', allowedClientIds)
      .in('file_status', ['open', 'in_progress', 'pending', 'active'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (investigationsError) throw investigationsError;

    // Calculate metrics
    const criticalSignals = signals?.filter(s => s.severity === 'critical').length || 0;
    const highSignals = signals?.filter(s => s.severity === 'high').length || 0;
    const openIncidents = incidents?.filter(i => i.status === 'open').length || 0;
    const resolvedIncidents = incidents?.filter(i => i.status === 'resolved').length || 0;

    // Top 25 signals for the report table — already sorted by severity desc, received desc
    const signalsWithRecommendations = (signals || []).slice(0, 25).map(s => ({ ...s, recommendations: null }));

    // ─── Cluster signals by (category, primary entity) before AI synthesis ───
    // The old snapshot rendered every signal as a row, which produced
    // the "Wet'suwet'en blockade ×8 / CGL sabotage ×8" dump pattern. The
    // EB-format snapshot groups near-duplicates so a single underlying
    // event becomes ONE narrative paragraph with a count + citations.
    const normalizeKey = (s: string) => String(s ?? '').toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const clusters = new Map<string, { category: string; entity: string; signals: any[] }>();
    for (const s of (signals || [])) {
      const cat = s.category || 'other';
      const tags: string[] = Array.isArray(s.entity_tags) ? s.entity_tags : [];
      // Pick the longest non-trivial entity tag as the cluster anchor;
      // fallback to the first 60 chars of normalized_text so signals
      // without entity tags still group by topic.
      const anchor = tags
        .filter((t) => typeof t === 'string' && t.trim().length >= 3)
        .sort((a, b) => b.length - a.length)[0]
        ?? normalizeKey(String(s.normalized_text ?? '').slice(0, 60));
      const key = `${cat}::${normalizeKey(anchor)}`;
      const cur = clusters.get(key);
      if (cur) cur.signals.push(s);
      else clusters.set(key, { category: cat, entity: anchor, signals: [s] });
    }
    // Sort clusters by max severity within cluster, then size, descending.
    const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const themedClusters = Array.from(clusters.values())
      .map((c) => ({
        ...c,
        max_sev: c.signals.reduce((m, s) => Math.max(m, sevRank[String(s.severity || 'low').toLowerCase()] ?? 0), 0),
      }))
      .sort((a, b) => b.max_sev - a.max_sev || b.signals.length - a.signals.length)
      .slice(0, 8);  // top 8 themes — keeps the snapshot scannable

    // Pull agent_debate_records syntheses for incidents in window so the
    // AI prompt can cite actual specialist conclusions instead of
    // inventing them. May 10 architecture: every P1/P2 incident gets a
    // command_synthesis debate; surfacing those in the snapshot lets the
    // operator see WHY the platform escalated.
    const incidentIds = (incidents ?? []).map((i: any) => i.id).filter(Boolean);
    const { data: debateRecords } = incidentIds.length > 0
      ? await supabaseClient
          .from('agent_debate_records')
          .select('incident_id, final_assessment, consensus_score, judge_agent, created_at')
          .in('incident_id', incidentIds)
          .order('created_at', { ascending: false })
      : { data: [] as any[] };
    const debateByIncident = new Map<string, any>();
    for (const d of (debateRecords || [])) {
      if (!debateByIncident.has(d.incident_id)) debateByIncident.set(d.incident_id, d);
    }

    // ─── Per-cluster geographic locus ──────────────────────────────
    // Field staff scan the snapshot for THEIR site. Surface a "WHERE"
    // line on every theme card by aggregating the cluster's signals'
    // entity_tags + location field. Heuristic: keep tags that look
    // like places (contain BC / Alberta / Canada keyword OR known
    // place suffix OR client high_value_assets / locations match).
    const allowedClient = (realClients ?? []).find((c: any) => c.id === allowedClientIds[0]) ?? null;
    const clientLocationCorpus: string[] = [
      ...((allowedClient as any)?.locations ?? []),
      ...((allowedClient as any)?.high_value_assets ?? []),
    ].filter((s: any) => typeof s === 'string').map((s: string) => s.toLowerCase());
    const PLACE_HINT_RE = /\b(BC|British Columbia|Alberta|Canada|Yukon|NWT|Saskatchewan|Manitoba|Ontario|Quebec|Maritimes|Atlantic|territory|county|district|region|valley|peninsula|island|bay|river|lake|mountain|plateau|basin|watershed|corridor)\b/i;
    const clusterLocus = (cluster: { signals: any[] }): string => {
      const tagBag = new Set<string>();
      for (const s of cluster.signals) {
        const tags: string[] = Array.isArray(s.entity_tags) ? s.entity_tags : [];
        for (const t of tags) if (typeof t === 'string' && t.trim().length >= 3) tagBag.add(t.trim());
        if (typeof s.location === 'string' && s.location.trim().length >= 3) tagBag.add(s.location.trim());
      }
      const ranked = Array.from(tagBag)
        .map((t) => {
          const lower = t.toLowerCase();
          let score = 0;
          if (clientLocationCorpus.some((cl) => lower.includes(cl) || cl.includes(lower))) score += 3;
          if (PLACE_HINT_RE.test(t)) score += 2;
          // Capitalized multi-word phrases that don't look like names
          if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(t)) score += 1;
          return { t, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.t);
      return ranked.length > 0 ? ranked.join(' · ') : 'no specific location';
    };
    const themedClustersWithLocus = themedClusters.map((c) => ({ ...c, where: clusterLocus(c) }));

    // ─── AI synthesis: field-tuned structured JSON ─────────────────
    // Output schema reshaped May 10 2026 for operational field staff:
    //   • bottom_line — single-sentence read-it-and-move-on summary
    //   • themes[] — narrative (1 sentence factual) + action (1 sentence
    //     imperative directed at field staff) + where (location)
    //   • watch_list[] — replaces strategic_deductions; imperative
    //     directives for the next 24h with location and role tags
    const themesForPrompt = themedClustersWithLocus.map((c, i) => {
      const sample = c.signals[0];
      return `${i + 1}. [${c.category} · ${c.entity} · ${c.signals.length} signal${c.signals.length === 1 ? '' : 's'} · WHERE: ${c.where}] ${String(sample?.normalized_text ?? '').slice(0, 220)}`;
    }).join('\n');
    const incidentsForPrompt = (incidents || []).slice(0, 8).map((i: any, idx: number) => {
      const synth = debateByIncident.get(i.id)?.final_assessment;
      const synthSnippet = synth ? ` | SYNTHESIS: ${String(synth).slice(0, 240)}` : '';
      return `${idx + 1}. [${i.priority?.toUpperCase() || 'P3'} · ${i.status}] ${(i.title || i.summary || 'Untitled incident').slice(0, 110)}${synthSnippet}`;
    }).join('\n');
    const investigationsForPrompt = (investigations || []).slice(0, 6).map((iv: any, idx: number) =>
      `${idx + 1}. [${iv.file_status || 'open'}] ${(iv.file_number || 'Untitled')} — ${(iv.synopsis || '').toString().slice(0, 110)}`
    ).join('\n') || 'None active.';

    // Operating-area context for the header tile + AI grounding
    const primaryOperatingAreas: string[] = scopedClientName
      ? Array.from(new Set([
          ...(((allowedClient as any)?.locations ?? []) as string[]).slice(0, 4),
          ...(((allowedClient as any)?.high_value_assets ?? []) as string[]).slice(0, 3),
        ])).filter(Boolean).slice(0, 5)
      : [];

    const synthesisPrompt = `Produce a 72-hour OPERATIONAL FIELD snapshot. Audience: site-based security and operations staff who read this between shifts. They need direct guidance, not analyst hedging.

VERIFIED DATA
- Period: last ${period_hours} hours
- Actionable signals: ${signals?.length || 0} (critical=${criticalSignals}, high=${highSignals})
- Open incidents: ${openIncidents} | Resolved: ${resolvedIncidents}
- Client: ${scopedClientName || 'cross-client (all real clients)'}
${primaryOperatingAreas.length > 0 ? `- Primary operating areas: ${primaryOperatingAreas.join(', ')}` : ''}

CLUSTERED THEMES (${themedClustersWithLocus.length}):
${themesForPrompt || 'No themes — period was quiet.'}

NOTABLE INCIDENTS (most recent ${(incidents || []).slice(0, 8).length}):
${incidentsForPrompt || 'No incidents in period.'}

ACTIVE INVESTIGATIONS:
${investigationsForPrompt}

OUTPUT FORMAT — return JSON only, no markdown:
{
  "bottom_line": "<ONE sentence — the read-it-and-move-on takeaway. Lead with the operational state ('Quiet 72h.' / 'Elevated activity at X.'), then the single most important field-action focus. Max 200 chars.>",
  "executive_summary": "<2 short paragraphs of plain prose. Sentence 1 = what happened. Sentence 2 = what's still open / unresolved. Sentence 3+ = what to monitor at sites.>",
  "themes": [
    {
      "title": "<short theme name in Title Case, plain English (e.g. 'CGL Court Ruling', 'Wildfire G70139', 'Community Outreach') — NOT raw category enums like 'active_threat'>",
      "where": "<location verbatim from the WHERE field above; if 'no specific location', say 'No specific site'>",
      "narrative": "<ONE sentence. State the fact plainly. No 'may indicate' / 'could suggest' / 'warrants attention'. Cite location, signal count, and what happened.>",
      "action": "<ONE sentence directive for field staff. Use action verbs: WATCH FOR, EXPECT, VERIFY, REPORT, COORDINATE WITH, BRIEF, LOG. Tag the role and timeframe. Example: 'Site security: monitor CGL access roads near Houston for protest staging this week; report any congregation of 5+ vehicles.'>"
    }
  ],
  "watch_list": [
    "<Imperative bullet for the next 24h. Format: '[LOCATION/ROLE]: action verb + concrete observable + timeframe.' Example: 'CGL Houston-Kitimat corridor: monitor access roads for protest staging this week; brief shift leads at handover.'>",
    "..."
  ]
}

RULES — enforced (a violation auto-flags the report for review):
1. Themes must come from the CLUSTERED THEMES list above. Do not invent themes that aren't in the data.
2. NUMBERS MUST BE VERBATIM. Every number you write (signal counts, week-over-week deltas, percentages, dollar amounts, distances, dates) must appear character-for-character in the VERIFIED DATA / CLUSTERED THEMES / NOTABLE INCIDENTS / ACTIVE INVESTIGATIONS blocks above. Do NOT compute new ratios or extrapolate. If you can't find a number to cite, omit the sentence.
3. WATCH LIST tone is IMPERATIVE — directives, not observations. "Monitor X." not "X may warrant monitoring." "Brief shift leads." not "Shift leads should be briefed." Field staff need to know what to DO, not what an analyst thinks about it.
4. WATCH LIST items: 3-5 items, each must include either a location or a role (or both). Cite specific themes/incidents that appear in the input.
5. Theme titles must be plain English. NEVER write 'active_threat' or 'community_outreach' as a title — use 'Active Threat Activity' or 'Community Outreach' or, better, the actual subject ('CGL Court Ruling', 'Wildfire G70139').
6. THEME ACTION tone is IMPERATIVE. Same rule as watch list — direct verbs, no hedging modal verbs ('may', 'could', 'might', 'warrants').
7. If a cluster has 0 client nexus, say so directly in the narrative ('no direct site exposure').
8. If a synthesis snippet is provided for an incident, you MAY paraphrase it — that's the actual specialist conclusion.
9. ZERO markdown — no asterisks, hashes, bullets, dashes-as-dividers in any field.
10. If the CLUSTERED THEMES list is non-empty, you MUST produce a theme card for each one (up to the cluster count). "Quiet" is only valid when CLUSTERED THEMES = 0. Do not skip themes just because the period feels low-tempo — operators still need to see what is in the system.
11. The bottom_line should reflect the strongest theme + state. Examples: 'Quiet 72h — single high-priority court ruling under monitoring.' / '12 protest signals at CGL access roads; brief site security on access checks.' / 'Quiet 72h. No actionable items.' Pick the framing that matches the data.`;

    let bottomLine = '';
    let executiveSummary = 'Report generation in progress...';
    let themes: Array<{ title: string; where: string; narrative: string; action: string }> = [];
    let watchList: string[] = [];
    try {
      const synthResult = await callAiGateway({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a senior intelligence analyst producing a calm, evidence-grounded 72-hour snapshot. You return strict JSON. You never invent themes, incidents, numbers, or implications that the input data does not contain. When in doubt, leave it out — incomplete output is always preferable to invented detail.' },
          { role: 'user', content: synthesisPrompt }
        ],
        functionName: 'generate-report',
        // Lower temperature = less creative embellishment. The May 10
        // BCCH/CGL audit caught the model inventing a "spike with 8
        // signals this week against 0 last week" that didn't exist in
        // the input data; default temp encouraged that kind of
        // confident extrapolation.
        extraBody: { temperature: 0.1 },
      });
      // Parse JSON, tolerating a leading ```json fence if the model
      // ignores the no-markdown instruction.
      const raw = String(synthResult.content ?? '').trim();
      const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(jsonText);
      if (typeof parsed.bottom_line === 'string') bottomLine = parsed.bottom_line.slice(0, 240);
      if (typeof parsed.executive_summary === 'string') executiveSummary = parsed.executive_summary;
      if (Array.isArray(parsed.themes)) {
        themes = parsed.themes.slice(0, 8).map((t: any) => ({
          title: typeof t.title === 'string' ? t.title : '',
          where: typeof t.where === 'string' ? t.where : '',
          narrative: typeof t.narrative === 'string' ? t.narrative : '',
          action: typeof t.action === 'string' ? t.action : '',
        }));
      }
      if (Array.isArray(parsed.watch_list)) watchList = parsed.watch_list.slice(0, 6);

      // ── Numeric verification gate ──────────────────────────────────
      // Pull every multi-digit number the AI emitted and check it
      // against the input data we actually sent to the prompt. Drop
      // sentences whose numbers aren't grounded. Catches the May 10
      // class where the model wrote "8 signals this week against 0
      // last week" when no such pair appears in the input.
      const inputCorpus = `${themesForPrompt}\n${incidentsForPrompt}\n${investigationsForPrompt}\n${signals?.length ?? 0} ${criticalSignals} ${highSignals} ${openIncidents} ${resolvedIncidents} ${period_hours ?? 72} ${themedClusters.length}`;
      const inputNumberSet = new Set(
        (inputCorpus.match(/\d+/g) || []).filter((n) => n.length >= 1)
      );
      // Decimals in the input (e.g. cluster signal counts as "5", "8")
      // also count. Allow standalone-year matches (4-digit) and any
      // small numbers (0–10) since common-sense numerics in narrative
      // ("two", "first") get rendered numerically and would over-flag.
      const VERBATIM_THRESHOLD = 10;
      const claimIsGrounded = (text: string): boolean => {
        const claimed = (text.match(/\d+/g) || []).map((s) => s.trim());
        for (const n of claimed) {
          const v = Number(n);
          if (!Number.isFinite(v)) continue;
          if (v <= VERBATIM_THRESHOLD) continue; // small ints from natural prose
          if (inputNumberSet.has(n)) continue;   // verbatim match
          return false;
        }
        return true;
      };
      const filterSentences = (text: string): string =>
        text
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => claimIsGrounded(sentence))
          .join(' ')
          .trim();

      let strippedSentences = 0;
      const beforeBottom = bottomLine;
      bottomLine = filterSentences(bottomLine);
      if (bottomLine !== beforeBottom) strippedSentences += 1;
      const beforeSummary = executiveSummary;
      executiveSummary = filterSentences(executiveSummary);
      if (executiveSummary !== beforeSummary) strippedSentences += 1;
      themes = themes.map((t) => {
        const cleaned = {
          ...t,
          narrative: filterSentences(t.narrative ?? ''),
          action: filterSentences(t.action ?? ''),
        };
        if (cleaned.narrative !== (t.narrative ?? '') || cleaned.action !== (t.action ?? '')) strippedSentences += 1;
        return cleaned;
      });
      watchList = watchList
        .map((d) => filterSentences(d))
        .filter((d) => d.length > 0);
      if (strippedSentences > 0) {
        console.warn(`[generate-report] Numeric verification stripped ${strippedSentences} sentence(s) with ungrounded numbers`);
      }
    } catch (synthErr) {
      console.warn('[generate-report] Structured synthesis failed, falling back to summary-only prose:', synthErr instanceof Error ? synthErr.message : String(synthErr));
    }

    // Create report record.
    // WO-DATA-INTEGRITY (2026-07-10): reports must be tenant-owned — AEGIS reads reports by
    // tenant_id, so a tenant-less report is an invisible orphan. Derive the owning tenant from
    // the scoped clients: a single-tenant scope (single-client, or same-tenant cross-client) is
    // tenant-owned and persisted with client_id + tenant_id. A GENUINELY multi-tenant cross-all-
    // client admin report has no single owner — it is NOT persisted here (it was previously an
    // invisible orphan). Its ownership model (own by Silent Shield Operations / asset_class=system)
    // is a pending platform decision (see PR); the report content is still returned to the caller.
    const scopedTenantIds = [...new Set(
      (realClients ?? [])
        .filter((c: any) => allowedClientIds.includes(c.id))
        .map((c: any) => c.tenant_id)
        .filter(Boolean)
    )];
    const reportTenantId = scopedTenantIds.length === 1 ? scopedTenantIds[0] : null;

    // Owning tenant: single-tenant scope → that tenant. Genuinely multi-tenant cross-all-client
    // admin report → the Silent Shield Operations platform tenant (operator decision 2026-07-10:
    // platform reports are SS artifacts, tenant-owned with client_id=null; consistent with the
    // disposition of the 33 historical cross-all snapshots). Every persisted report has a tenant.
    let owningTenantId = reportTenantId;
    let owningClientId: string | null = requestedClientId ?? null;
    if (!owningTenantId) {
      const { data: ssOps } = await supabase
        .from('tenants').select('id').eq('name', 'Silent Shield Operations').eq('is_test', false).maybeSingle();
      owningTenantId = ssOps?.id ?? null;
      owningClientId = null; // cross-all platform report is tenant-owned, not client-scoped
    }

    let report: Record<string, unknown> | null = null;
    if (owningTenantId) {
      const { data: inserted, error: reportError } = await supabase
        .from('reports')
        .insert({
          type: report_type,
          // Wave 2: record the authoritative client scope of this report's source set.
          client_id: owningClientId,
          tenant_id: owningTenantId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          meta_json: {
            total_signals: signals?.length || 0,
            critical_signals: criticalSignals,
            high_signals: highSignals,
            open_incidents: openIncidents,
            resolved_incidents: resolvedIncidents,
            executive_summary: executiveSummary,
            scoped_client_ids: allowedClientIds,
            scope_mode: requestedClientId ? 'single_client' : 'all_clients_admin'
          }
        })
        .select()
        .single();
      if (reportError) console.error('Report record insert failed (non-fatal):', reportError.message);
      else report = inserted as Record<string, unknown>;
    } else {
      // Provenance fail-closed: no owning tenant derivable AND the platform tenant is missing.
      console.warn('[generate-report] WO-DATA-INTEGRITY: no owning tenant (and Silent Shield Operations tenant not found) — report NOT persisted; returned to caller only.');
    }

    // Calculate additional analytics
    const signalsByCategory = signals?.reduce((acc: any, s) => {
      acc[s.category || 'uncategorized'] = (acc[s.category || 'uncategorized'] || 0) + 1;
      return acc;
    }, {}) || {};

    const signalsBySeverity = {
      critical: criticalSignals,
      high: highSignals,
      medium: signals?.filter(s => s.severity === 'medium').length || 0,
      low: signals?.filter(s => s.severity === 'low').length || 0,
    };

    const avgResponseTime = incidents?.length > 0
      ? incidents.reduce((sum, i) => {
          if (i.resolved_at && i.opened_at) {
            return sum + (new Date(i.resolved_at).getTime() - new Date(i.opened_at).getTime());
          }
          return sum;
        }, 0) / incidents.filter(i => i.resolved_at).length / 1000 / 60 / 60
      : 0;

    // Format dates for header
    const coverageStart = new Date(periodStart);
    const coverageEnd = new Date(periodEnd);
    const generatedDate = new Date();
    
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    
    const formatDateTime = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
        ' – ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    // ─── 72-Hour Snapshot HTML (May 10 2026 rebuild to match EB) ───
    // Print-ready professional document. Same Georgia serif body +
    // Arial sans-serif headers as generate-executive-report. White
    // background, black text, gray rules. The previous version used a
    // dark "tactical dashboard" theme that printed as huge black
    // rectangles in the PDF — operators couldn't take it to a board
    // meeting. This styling matches the EB so a 72-hour snapshot reads
    // as a sibling document to the per-client Executive Brief.
    const reportDateLabel = formatDateTime(generatedDate);
    const periodLabel = `${formatDate(coverageStart)} – ${formatDate(coverageEnd)}`;
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>72-Hour Operational Snapshot</title>
  <style>
    @page { margin: 1.2cm 1.8cm; size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #111;
      background: #ffffff;
      max-width: 860px;
      margin: 0 auto;
      padding: 18pt 0;
    }

    /* HEADER */
    .header {
      border-bottom: 1px solid #111;
      padding-bottom: 10pt;
      margin-bottom: 18pt;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8pt;
    }
    .classification {
      font-family: 'Arial', sans-serif;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 1.5pt;
      text-transform: uppercase;
      color: #111;
      border: 1px solid #111;
      padding: 2pt 8pt;
    }
    .report-date {
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
      color: #555;
    }
    .logo-area { text-align: center; margin-bottom: 4pt; }
    .company-name {
      font-family: 'Arial', sans-serif;
      font-size: 16pt;
      font-weight: 700;
      color: #111;
      letter-spacing: 2pt;
      text-transform: uppercase;
      margin-bottom: 3pt;
    }
    .report-title {
      font-family: 'Arial', sans-serif;
      font-size: 11pt;
      color: #333;
    }

    /* META GRID */
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      margin-bottom: 22pt;
      border: 1px solid #ccc;
    }
    .meta-item {
      font-family: 'Arial', sans-serif;
      font-size: 8.5pt;
      padding: 8pt 10pt;
      border-right: 1px solid #ccc;
    }
    .meta-item:last-child { border-right: none; }
    .meta-label {
      text-transform: uppercase;
      font-weight: 700;
      color: #666;
      font-size: 7.5pt;
      letter-spacing: 0.5pt;
      margin-bottom: 2pt;
    }
    .meta-value { color: #111; font-weight: 600; }

    /* METRICS STRIP */
    .metrics-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      border: 1px solid #ccc;
      margin-bottom: 22pt;
    }
    .metric-cell {
      padding: 10pt 12pt;
      border-right: 1px solid #ccc;
      font-family: 'Arial', sans-serif;
    }
    .metric-cell:last-child { border-right: none; }
    .metric-label {
      text-transform: uppercase;
      font-weight: 700;
      color: #666;
      font-size: 7.5pt;
      letter-spacing: 0.5pt;
      margin-bottom: 4pt;
    }
    .metric-value {
      font-family: 'Georgia', serif;
      font-size: 18pt;
      font-weight: 700;
      color: #111;
      line-height: 1;
    }
    .metric-sub {
      font-size: 7.5pt;
      color: #555;
      margin-top: 2pt;
    }

    /* SECTIONS */
    .section { margin-bottom: 24pt; page-break-inside: avoid; }
    .section-title {
      font-family: 'Arial', sans-serif;
      font-size: 10pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1pt;
      color: #111;
      margin-bottom: 10pt;
      padding-bottom: 4pt;
      border-bottom: 1px solid #111;
    }

    /* EXECUTIVE SUMMARY */
    .executive-summary {
      border-left: 3pt solid #111;
      padding-left: 14pt;
      margin: 12pt 0;
      font-size: 10.5pt;
      line-height: 1.7;
      white-space: pre-wrap;
    }

    /* INCIDENT TABLE */
    .incident-table {
      width: 100%;
      border-collapse: collapse;
      margin: 12pt 0;
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
    }
    .incident-table th {
      border-bottom: 2px solid #111;
      border-top: 1px solid #111;
      padding: 6pt 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 7.5pt;
      letter-spacing: 0.5pt;
      color: #111;
      background: white;
    }
    .incident-table td {
      padding: 7pt 8pt;
      border-bottom: 1px solid #ddd;
      vertical-align: top;
    }
    .incident-table tbody tr:nth-child(even) { background: #f9f9f9; }
    .priority-cell {
      font-weight: 700;
      font-size: 9pt;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .status-cell {
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.3pt;
      color: #555;
    }
    .synthesis-cell {
      font-family: 'Georgia', serif;
      font-size: 9pt;
      line-height: 1.5;
      color: #222;
    }
    .synthesis-meta {
      font-family: 'Arial', sans-serif;
      font-size: 7.5pt;
      color: #777;
      margin-top: 4pt;
      letter-spacing: 0.3pt;
    }

    /* INVESTIGATION CARD */
    .investigation-item {
      border-left: 2pt solid #555;
      padding: 4pt 0 6pt 12pt;
      margin-bottom: 10pt;
    }
    .investigation-title {
      font-weight: 700;
      font-size: 10.5pt;
      color: #111;
      margin-bottom: 3pt;
    }
    .investigation-meta {
      font-family: 'Arial', sans-serif;
      font-size: 8.5pt;
      color: #555;
    }

    /* THEME BLOCK */
    .theme-item {
      border-top: 1px solid #ddd;
      padding-top: 12pt;
      margin-bottom: 14pt;
    }
    .theme-item:first-child { border-top: none; padding-top: 0; }
    .theme-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6pt;
    }
    .theme-title {
      font-weight: 700;
      font-size: 11pt;
      color: #111;
    }
    .theme-meta {
      font-family: 'Arial', sans-serif;
      font-size: 8pt;
      color: #666;
      letter-spacing: 0.3pt;
      text-transform: uppercase;
    }
    .theme-narrative {
      font-size: 10.5pt;
      line-height: 1.7;
      color: #111;
      margin-bottom: 6pt;
    }
    .theme-implication {
      border-left: 2pt solid #555;
      padding: 4pt 0 4pt 10pt;
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
      color: #333;
      margin-top: 4pt;
    }
    .theme-implication-label {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
      font-size: 7.5pt;
      color: #555;
    }

    /* DEDUCTIONS */
    .deduction-list {
      margin: 12pt 0;
      padding-left: 0;
      list-style: none;
      counter-reset: deduction;
    }
    .deduction-list li {
      counter-increment: deduction;
      border-left: 3pt solid #111;
      padding: 4pt 0 4pt 14pt;
      margin-bottom: 10pt;
      font-size: 10.5pt;
      line-height: 1.65;
      position: relative;
    }
    .deduction-list li::before {
      content: counter(deduction) ".";
      font-family: 'Arial', sans-serif;
      font-weight: 700;
      font-size: 9pt;
      color: #555;
      position: absolute;
      left: -22pt;
      top: 4pt;
      width: 18pt;
      text-align: right;
    }

    .empty-note {
      font-style: italic;
      color: #777;
      font-size: 9.5pt;
      padding: 8pt 0;
    }

    .footer {
      text-align: center;
      font-family: 'Arial', sans-serif;
      font-size: 7.5pt;
      color: #888;
      padding: 10pt 0;
      border-top: 1px solid #ccc;
      margin-top: 24pt;
    }

    /* PRINT / PDF — force light, ensure colors render */
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body { background: #ffffff !important; color: #111111 !important; }
      body * { background-color: transparent !important; color: #111111 !important; border-color: #cccccc !important; }
      .incident-table tbody tr:nth-child(even) { background: #f9f9f9 !important; }
      h1, h2, h3, h4 { color: #111111 !important; }
      .section-title { border-bottom-color: #111111 !important; }
      .executive-summary, .deduction-list li { border-left-color: #111111 !important; }
      .investigation-item, .theme-implication { border-left-color: #555555 !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="classification">SENSITIVE SECURITY INFORMATION</div>
      <div class="report-date">${reportDateLabel}</div>
    </div>
    <div class="logo-area">
      <div class="company-name">Fortress AI</div>
      <div class="report-title">${scopedClientName ? `${scopedClientName} – ` : ''}72-Hour Operational Snapshot</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">Reporting Period</div>
      <div class="meta-value">${periodLabel}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Coverage</div>
      <div class="meta-value">Last ${period_hours || 72} hours · ${scopedClientName ? scopedClientName : 'All real clients'}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Primary Operating Areas</div>
      <div class="meta-value">${primaryOperatingAreas.length > 0 ? primaryOperatingAreas.join(' · ') : '—'}</div>
    </div>
  </div>

  ${bottomLine ? `
  <div style="border: 2pt solid #111; padding: 14pt 18pt; margin-bottom: 22pt; background: #f8f8f8;">
    <div style="font-family: 'Arial', sans-serif; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; color: #555; margin-bottom: 6pt;">Bottom Line</div>
    <div style="font-size: 12pt; font-weight: 700; line-height: 1.5; color: #111;">${bottomLine}</div>
  </div>
  ` : ''}

  <div class="metrics-strip">
    <div class="metric-cell">
      <div class="metric-label">Total Signals</div>
      <div class="metric-value">${signals?.length || 0}</div>
      <div class="metric-sub">${criticalSignals} critical · ${highSignals} high</div>
    </div>
    <div class="metric-cell">
      <div class="metric-label">Incidents Open</div>
      <div class="metric-value">${openIncidents}</div>
      <div class="metric-sub">${incidents?.filter(i => i.priority === 'p1').length || 0} P1 · ${incidents?.filter(i => i.priority === 'p2').length || 0} P2</div>
    </div>
    <div class="metric-cell">
      <div class="metric-label">Investigations</div>
      <div class="metric-value">${investigations?.length || 0}</div>
      <div class="metric-sub">active in window</div>
    </div>
    <div class="metric-cell">
      <div class="metric-label">Resolved</div>
      <div class="metric-value">${resolvedIncidents}</div>
      <div class="metric-sub">in last ${period_hours || 72}h</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <div class="executive-summary">${executiveSummary}</div>
  </div>

  <div class="section">
    <h2 class="section-title">Notable Incidents</h2>
    ${incidents?.length ? `
    <table class="incident-table">
      <thead>
        <tr>
          <th style="width: 8%;">Priority</th>
          <th style="width: 10%;">Status</th>
          <th style="width: 28%;">Incident</th>
          <th style="width: 14%;">Opened</th>
          <th style="width: 40%;">Specialist Synthesis</th>
        </tr>
      </thead>
      <tbody>
        ${incidents.slice(0, 12).map(inc => {
          const label = (inc.title || inc.description || inc.normalized_text || inc.summary || 'Untitled incident').toString().substring(0, 100);
          const synth = debateByIncident.get(inc.id);
          // Strip the [FACTS — Source: ...] / [ASSESSMENT — ...] /
          // [DEDUCTION — ...] machine preambles that some specialists
          // emit as their first line. Operators want the analyst prose,
          // not the bracketed metadata.
          const rawSynth = synth?.final_assessment ? String(synth.final_assessment) : '';
          const cleanSynth = rawSynth
            .replace(/^\s*\[(FACTS|ASSESSMENT|DEDUCTION|INFERENCE|SUMMARY|CONFIDENCE)[^\]]*\]\s*/i, '')
            .replace(/^\s*\[[^\]]{0,160}\]\s*/, '');
          const synthCell = cleanSynth
            ? `<div class="synthesis-cell">${cleanSynth.substring(0, 280)}${cleanSynth.length > 280 ? '…' : ''}</div>
               <div class="synthesis-meta">JUDGE: ${synth?.judge_agent || 'AEGIS-CMD'} · CONSENSUS: ${synth?.consensus_score != null ? Math.round(synth.consensus_score * 100) + '%' : '—'}</div>`
            : '<span class="empty-note">No specialist synthesis yet</span>';
          return `
          <tr>
            <td class="priority-cell">${inc.priority?.toUpperCase() || 'P3'}</td>
            <td class="status-cell">${inc.status}</td>
            <td>${label}</td>
            <td style="font-family: 'Arial', sans-serif; font-size: 8.5pt; color: #555;">${new Date(inc.opened_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
            <td>${synthCell}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : '<p class="empty-note">No incidents opened in this period.</p>'}
  </div>

  <div class="section">
    <h2 class="section-title">Active Investigations</h2>
    ${(investigations && investigations.length > 0)
      ? `<table class="incident-table" style="margin-top: 8pt;">
          <thead>
            <tr>
              <th style="width: 14%;">File</th>
              <th style="width: 60%;">Subject</th>
              <th style="width: 12%;">Status</th>
              <th style="width: 14%;">Owner / Opened</th>
            </tr>
          </thead>
          <tbody>
            ${investigations.slice(0, 8).map((iv: any) => {
              const synopsis = String(iv.synopsis ?? '').trim();
              const recs = String(iv.recommendations ?? '').trim();
              const summarySource = synopsis || recs;
              const firstSentence = summarySource
                ? (summarySource.split(/(?<=[.!?])\s/)[0] || summarySource).slice(0, 100)
                : '—';
              const opened = new Date(iv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const owner = iv.created_by_name ? String(iv.created_by_name).split(' ')[0] : '—';
              return `
              <tr>
                <td style="font-family: 'Arial', sans-serif; font-weight: 700;">${iv.file_number || '—'}</td>
                <td>${firstSentence}</td>
                <td class="status-cell">${(iv.file_status || 'open').toUpperCase()}</td>
                <td style="font-family: 'Arial', sans-serif; font-size: 8pt; color: #555;">${owner} · ${opened}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`
      : '<p class="empty-note">No active investigations.</p>'}
  </div>

  <div class="section">
    <h2 class="section-title">Issues of Concern by Theme</h2>
    ${themes.length > 0
      ? themes.map((t, idx) => {
          const cluster = themedClustersWithLocus[idx];
          const signalCount = cluster?.signals?.length ?? 0;
          const where = t.where || cluster?.where || 'No specific site';
          return `
            <div class="theme-item">
              <div class="theme-header">
                <div class="theme-title">${String(t.title || cluster?.entity || 'Untitled theme').substring(0, 110)}</div>
                <div class="theme-meta">${signalCount} signal${signalCount === 1 ? '' : 's'}</div>
              </div>
              <div style="font-family: 'Arial', sans-serif; font-size: 8.5pt; color: #555; margin-bottom: 6pt; letter-spacing: 0.3pt;">
                <strong style="text-transform: uppercase; font-weight: 700; color: #333;">Where:</strong> ${where}
              </div>
              <p class="theme-narrative">${t.narrative || ''}</p>
              ${t.action
                ? `<div class="theme-implication">
                    <div class="theme-implication-label">Field Action</div>
                    ${t.action}
                  </div>`
                : ''}
            </div>`;
        }).join('')
      : '<p class="empty-note">No clustered themes — the period had insufficient signal density for narrative grouping.</p>'}
  </div>

  <div class="section">
    <h2 class="section-title">Watch List — Next 24 Hours</h2>
    ${watchList.length > 0
      ? `<ol class="deduction-list">
          ${watchList.map((d) => `<li>${String(d).trim()}</li>`).join('')}
        </ol>`
      : '<p class="empty-note">No watch-list items for this period.</p>'}
  </div>

  <div class="footer">
    Fortress AI · 72-Hour Operational Snapshot · This document contains sensitive security information. Distribution is restricted.
  </div>
</body>
</html>
    `.trim();

    return new Response(
      JSON.stringify({ report: report || null, html }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-report:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Wave 2.1 redeploy trigger (CI concurrency cancelled the first run).
