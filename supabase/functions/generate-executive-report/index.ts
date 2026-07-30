import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway, callAiGatewayJson } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";
import { runEvidenceGate, getReliabilityFirstPrompt, DEFAULT_RELIABILITY_SETTINGS } from "../_shared/reliability-first.ts";
import { getCallerIdentity, getAccessibleClientIds } from "../_shared/supabase-client.ts";
import { ACTIVE_INCIDENT_STATUSES, isIncidentActive } from "../_shared/incident-status.ts";
import { HAZARD_CLASSES } from "../_shared/incident-creation-gate.ts";
import { classifySubject, renderMandateGuidance } from "../_shared/client-mandate.ts";
import { resolveCitation } from "../_shared/citation.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Clean Google CSE / RSS snippet artifacts before showing a signal excerpt
 * to AI or to a human reader. Google's customsearch API returns snippets
 * full of "1 day ago ... ... protest in Ottawa. DND said the U.S.-registered
 * aircraft was doing ... LNG Canada Phase 2..." style artifacts — the
 * truncation ellipses, the relative timestamps, and trailing source
 * attributions ("- Facebook") leak through to executive briefs and make
 * the prose read like raw search results instead of curated intel.
 *
 * 2026-05-12 hardening pass — surfaced during BC Place / FIFA demo prep.
 */
function cleanSignalExcerpt(text: string | null | undefined): string {
  if (!text) return '';
  let t = text;
  // Strip leading "N day(s)/hour(s)/minute(s) ago ..." preludes
  t = t.replace(/^\s*\d+\s*(day|hour|minute|month|week)s?\s+ago\s*\.{2,}\s*/i, '');
  // Strip trailing source attributions like " - Facebook", " - Reddit", " - Twitter"
  t = t.replace(/\s*[-–—]\s*(Facebook|Reddit|Twitter|X|LinkedIn|Instagram|YouTube|TikTok|Telegram)\s*$/i, '');
  // Collapse "... ..." style multi-ellipsis chains to a single unicode ellipsis
  t = t.replace(/(?:\.{2,}\s*){2,}/g, '… ');
  // Collapse remaining 3-or-more-dot sequences to a single unicode ellipsis
  t = t.replace(/\.{3,}/g, '…');
  // Normalize internal whitespace
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

/**
 * Private-individual name scrub — render-time enforcement of the flash's
 * "never name a private individual" rule for ANY text that reaches the client
 * PDF (incident titles/rationale, awareness titles, and the generated summary
 * as a backstop). Added 2026-07-28 (second red-pen): the name "Steve Larabie"
 * (a wildfire-affected private citizen) reached a client PDF via the incident
 * table, which is raw DB text no prompt rule ever touched.
 *
 * Design — precision over recall (the brief template is frozen for the week):
 *  - Only Title-Case "Firstname Lastname" personal names are candidates, and
 *    only when the first token is a known common given name (or an honorific
 *    prefixes it). This is deliberately aligned with the brief's tradecraft
 *    convention that PUBLIC figures are written SURNAME-in-CAPITALS (e.g.
 *    "Richard BROOKS") — an ALL-CAPS surname never matches the Title-Case
 *    Lastname pattern, so public figures the analysts intentionally named are
 *    preserved automatically.
 *  - A name is KEPT (acting in a public capacity) when a public-role keyword
 *    sits adjacent (before or after) — "activist Richard Brooks", "Brooks, the
 *    union organizer".
 *  - Otherwise it is replaced with a neutral role reference.
 *  - Place/org false positives are avoided by the given-name gate plus a
 *    geographic-prefix guard ("Fort St. John", "Lake Louise").
 */
const COMMON_GIVEN_NAMES = new Set([
  'james','john','robert','michael','william','david','richard','joseph','thomas','charles',
  'christopher','daniel','matthew','anthony','mark','donald','steven','steve','paul','andrew',
  'joshua','kenneth','kevin','brian','george','timothy','ronald','edward','jason','jeffrey',
  'ryan','jacob','gary','nicholas','eric','jonathan','stephen','larry','justin','scott',
  'brandon','benjamin','samuel','gregory','frank','alexander','raymond','patrick','jack','dennis',
  'jerry','tyler','aaron','jose','adam','nathan','henry','zachary','douglas','peter',
  'kyle','noah','ethan','jeremy','walter','christian','keith','roger','terry','austin',
  'sean','gerald','carl','harold','dylan','arthur','lawrence','jordan','jesse','bryan',
  'billy','bruce','gabriel','joe','logan','alan','juan','albert','willie','elijah',
  'wayne','randy','vincent','mason','roy','ralph','bobby','russell','bradley','philip',
  'mary','patricia','jennifer','linda','elizabeth','barbara','susan','jessica','sarah','karen',
  'nancy','lisa','margaret','betty','sandra','ashley','dorothy','kimberly','emily','donna',
  'michelle','carol','amanda','melissa','deborah','stephanie','rebecca','laura','sharon','cynthia',
  'kathleen','amy','angela','shirley','anna','brenda','pamela','emma','nicole','helen',
  'samantha','katherine','christine','debra','rachel','carolyn','janet','catherine','maria','heather',
  'diane','ruth','julie','olivia','joyce','virginia','victoria','kelly','lauren','christina',
  'joan','evelyn','judith','megan','andrea','cheryl','hannah','jacqueline','martha','gloria',
  'teresa','ann','sara','madison','frances','kathryn','janice','jean','abigail','alice',
  'julia','judy','sophia','grace','denise','amber','doris','marilyn','danielle','beverly',
  'isabella','theresa','diana','natalie','brittany','charlotte','marie','kayla','alexis','lori',
  // common French-Canadian / other given names seen in NE BC / Canadian coverage
  'pierre','jean','luc','marc','andre','francois','guy','yves','denis','claude',
  'sylvie','nathalie','isabelle','manon','chantal','josee','veronique','genevieve','melanie','caroline',
  'liam','mateo','sofia','mohammed','ahmed','ali','omar','wei','ming','raj',
  'amir','fatima','aisha','chen','singh','kaur','dave','mike','chris','rob',
  'tom','tony','bill','jim','ken','ron','don','ed','sam','ben',
]);

const PUBLIC_ROLE_RE = /(activist|organi[sz]er|protest\s+leader|journalist|reporter|columnist|editor|blogger|politician|premier|minister|mayor|councill?or|councilm[ae]n|councilwoman|senator|governor|member\s+of\s+parliament|\bmp\b|\bmla\b|\bmpp\b|chief|professor|doctor|president|vice[-\s]president|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chair(?:man|woman|person)?|director|executive|founder|spokes(?:person|man|woman)|officer|constable|sergeant|inspector|superintendent|commissioner|judge|justice|lawyer|attorney|counsel|celebrity|musician|singer|actor|actress|athlete|author|candidate|leader|coordinator|advocate)/i;

const GEO_PREFIX = new Set(['st','st.','saint','fort','lake','mount','mt','mt.','port','cape','new','prince','fond','sault','baie','grand','fonddu']);

function scrubPrivateIndividualNames(input: string | null | undefined): string {
  if (!input) return '';
  let text = String(input);

  // [PATTERN] title exemption (ruling 3): a meta-signal title like
  //   [PATTERN] Entity escalation: "Jane Doe" (3 signals in 7d)
  // must NOT be run through the generic name passes below — that mangles the
  // structured title ("Entity escalation: a private individual (3 signals..."). Instead,
  // resolve the ENTITY REFERENCE cleanly: if the quoted entity is a private individual
  // (the bare name would be scrubbed), render it descriptively as "private-individual
  // entity"; a public figure or organization keeps its name. Structure is preserved.
  const PATTERN_ESCALATION_RE = /^(\[PATTERN\]\s*Entity escalation:\s*)"([^"]+)"\s*\(\s*(\d+)\s*signals?\s*(?:in\s*)?(\d+)\s*d\s*\)\s*$/i;
  const pm = text.match(PATTERN_ESCALATION_RE);
  if (pm) {
    const [, prefix, name, count, days] = pm;
    // Recurse on the bare name (no [PATTERN] prefix → normal passes). If it changes,
    // the entity is a private personal name; keep it otherwise (org / public figure).
    const nameScrubbed = scrubPrivateIndividualNames(name);
    const ref = nameScrubbed !== name ? 'private-individual entity' : name;
    return `${prefix}${ref} (${count} signals/${days}d)`;
  }

  const scrubbedSurnames = new Set<string>();
  const COMMUNITY_CTX = /wildfire|evacuat|flood|resident|community|neighbou?r|family|homeowner|rancher|farmer|victim|missing/i;

  // Shared keep/scrub decision for a candidate personal name at `offset`.
  // Returns the replacement string, or null to KEEP the original match.
  const decide = (match: string, surname: string, offset: number): string | null => {
    // Geographic guard: "Fort St. John", "Lake Louise", etc.
    const before = text.slice(Math.max(0, offset - 14), offset);
    const prevTok = (before.match(/([A-Za-z.'-]+)\s*$/) || [, ''])[1].toLowerCase();
    if (GEO_PREFIX.has(prevTok)) return null;
    // Public-capacity guard: a public-role keyword within ~45 chars either side,
    // or the name token itself IS a public-role word ("Mr. President").
    const ctxBefore = text.slice(Math.max(0, offset - 45), offset);
    const ctxAfter = text.slice(offset + match.length, offset + match.length + 45);
    if (PUBLIC_ROLE_RE.test(match) || PUBLIC_ROLE_RE.test(ctxBefore) || PUBLIC_ROLE_RE.test(ctxAfter)) return null;
    if (surname.length >= 6) scrubbedSurnames.add(surname);
    return COMMUNITY_CTX.test(ctxBefore + ' ' + ctxAfter) ? 'a local resident' : 'a private individual';
  };

  // Pass 1 — honorific + one-or-two Title-Case tokens (whole match, incl. the
  // honorific, is replaced). Dr/Prof deliberately excluded — they are public-role
  // indicators. Catches "Mr. Thompson" and "Ms. Jane Doe".
  const HON_RE = /\b(Mr|Mrs|Ms|Miss|Mx|Rev|Sgt|Cst|Capt|Lt|Sir|Dame)\.?\s+([A-Z][a-z]+)(?:\s+[A-Z]\.)?(?:\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?))?\b/g;
  text = text.replace(HON_RE, (match: string, _honor: string, n1: string, n2: string | undefined, offset: number) => {
    const surname = n2 || n1;
    return decide(match, String(surname), offset) ?? match;
  });

  // Pass 2 — Firstname (known given name) + Title-Case Lastname, no honorific.
  const GIVEN_RE = /\b([A-Z][a-z]+)(?:\s+[A-Z]\.)?\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/g;
  text = text.replace(GIVEN_RE, (match: string, first: string, last: string, offset: number) => {
    if (!COMMON_GIVEN_NAMES.has(String(first).toLowerCase())) return match;
    return decide(match, String(last), offset) ?? match;
  });

  // Replace later bare-surname mentions of an already-scrubbed private name
  // (length-gated to ≥6 to avoid clobbering common English words / place names).
  for (const last of scrubbedSurnames) {
    const esc = last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${esc}('s)?\\b`, 'g'), (_m, poss) => poss ? "the individual's" : 'the individual');
  }
  return text;
}

// Interface for evidence source tracking
interface EvidenceSource {
  claim: string;
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl?: string;
  internalUrl: string;
  timestamp: string;
  confidence?: number;
}

// Interface for action items with ownership
interface ActionItem {
  description: string;
  ownerId?: string;
  ownerName?: string;
  ownerRole: string;
  deadline: string;
  firstUpdateDue: string;
  priority: string;
  relatedIncidentId?: string;
  relatedSignalId?: string;
}

// Interface for impact ladder
interface ImpactLadder {
  issue: string;
  worstConsequence: string;
  earliestIndicator: string;
  mitigation: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use service role client for all data operations.
    // Authentication at the Supabase gateway layer (verify_jwt = false in config.toml)
    // means callers must have a valid Supabase key (anon, service role, or user JWT).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const client_id = body.clientId || body.client_id || null;
    const period_days = body.period_days || body.periodDays || 7;

    // ── GENERIC TOOL PATH CLEARANCE — Wave 2 caller→scope gate ──────────────────
    // Reads operational data (signals/incidents/…) via a SERVICE-ROLE client (bypasses RLS)
    // under verify_jwt=false. Require a valid caller and an authoritative client the caller
    // can access; reject missing/mismatched client. service_role → trusted internal caller.
    {
      const _caller = await getCallerIdentity(req);
      if (_caller.kind === 'unauthorized') {
        return new Response(JSON.stringify({ error: _caller.error }), { status: _caller.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!client_id) {
        return new Response(JSON.stringify({ error: 'CLIENT_CONTEXT_MISSING: client_id is required for executive report generation' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (_caller.kind === 'user') {
        const _accessible = await getAccessibleClientIds(supabase, _caller.userId);
        let _allowed = _accessible.includes(client_id);
        if (!_allowed) {
          const { data: _sa } = await supabase.from('user_roles').select('role').eq('user_id', _caller.userId).eq('role', 'super_admin').maybeSingle();
          _allowed = !!_sa;
        }
        if (!_allowed) {
          return new Response(JSON.stringify({ error: 'CLIENT_NOT_AUTHORIZED: caller cannot access the requested client_id' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    console.log(`[generate-executive-report] body keys: ${Object.keys(body).join(',')}, client_id resolved: ${client_id}`);
    
    console.log(`Generating enhanced executive report for client ${client_id}, ${period_days} days`);

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL DATE CONTEXT - Used throughout report generation
    // ═══════════════════════════════════════════════════════════════════════════
    const reportGeneratedAt = new Date();
    const currentDateISO = reportGeneratedAt.toISOString().split('T')[0];
    const currentDateTimeISO = reportGeneratedAt.toISOString();
    
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - period_days);
    const periodEnd = new Date();
    
    // Define stale threshold: incidents older than 7 days are considered stale
    const staleThresholdMs = 7 * 24 * 60 * 60 * 1000;
    const last24hThreshold = new Date(reportGeneratedAt.getTime() - 24 * 60 * 60 * 1000);
    
    console.log(`CRITICAL DATE CONTEXT: Report generated at ${currentDateTimeISO}, period ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    // Fetch client details
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError) throw clientError;

    // Fetch signals with full details for traceability.
    // Exclude: test signals, archived signals, soft-deleted signals
    // (deleted_at IS NOT NULL means the operator dismissed it — must NOT appear
    // in executive output), and historical-tagged signals (signal_type='historical'
    // or triage_override='historical' — these are old context, not current intel).
    const { data: signals, error: signalsError } = await supabase
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .neq('status', 'archived')
      .neq('is_test', true)
      .is('deleted_at', null)
      // PROD-S Track H1 (2026-05-23) — exclude quarantined signals from
      // executive reports. See src/lib/signal-query-filters.ts.
      .eq('quality_status', 'active')
      .or('signal_type.is.null,signal_type.neq.historical')
      .or('triage_override.is.null,triage_override.neq.historical')
      .order('received_at', { ascending: false });

    if (signalsError) throw signalsError;

    // ── WO-PROVENANCE-01 step 2 — per-signal CITABILITY from source provenance (resolveCitation) ──
    // A signal that cannot be cited cannot contribute to any main-body assertion (Blocker 1). We
    // compute citability ONCE here, upstream of tiering AND of the incident/debate reads (Blocker B).
    const _srcIds = [...new Set((signals ?? []).map((s: any) => s.source_id).filter(Boolean))];
    const provById = new Map<string, any>();
    const domainToPub = new Map<string, { publisher_name: string; publisher_kind: string }>();
    if (_srcIds.length) {
      const { data: srcRows } = await supabase.from('sources')
        .select('id, publisher_kind, publisher_name, provenance_path').in('id', _srcIds);
      for (const r of (srcRows ?? [])) provById.set(r.id, r);
    }
    {
      // Aggregator resolution map (registrable domain -> publisher/kind) from configured citable sources.
      const { data: allSrc } = await supabase.from('sources')
        .select('publisher_kind, publisher_name, provenance_path, config')
        .in('publisher_kind', ['official', 'wire', 'outlet', 'advocacy', 'sensor', 'subject'])
        .in('provenance_path', ['url', 'api_endpoint']);
      for (const r of (allSrc ?? [])) {
        const u = ((r as any).config?.url || (r as any).config?.feed_url || '') as string;
        let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* */ }
        if (host && !host.includes('google.com') && !host.includes('reddit.com') && !domainToPub.has(host))
          domainToPub.set(host, { publisher_name: r.publisher_name, publisher_kind: r.publisher_kind });
      }
    }
    const domainLookup = (d: string) => domainToPub.get(d) ?? null;
    const citeFor = (s: any) => {
      const p = provById.get(s.source_id);
      return resolveCitation({
        provenance: p ? { source_id: s.source_id, publisher_kind: p.publisher_kind, publisher_name: p.publisher_name, provenance_path: p.provenance_path }
                      : (s.source_id ? { source_id: s.source_id, publisher_kind: null, publisher_name: null, provenance_path: null } : null),
        source_url: s.source_url, raw_json: s.raw_json, published_at: s.received_at || s.event_date,
      }, domainLookup);
    };
    const citableSet = new Set<string>();
    const citeLineById = new Map<string, string>();
    for (const s of (signals ?? [])) { const c = citeFor(s); if (c.citable) { citableSet.add(s.id); if (c.sourceLine) citeLineById.set(s.id, c.sourceLine); } }

    // Apply staleness filter: signals older than 14 days only if critical AND directly client-relevant.
    //
    // 2026-05-10: previously hardcoded `text.includes('petronas')` etc.
    // — only worked for one client. Now derives the relevance dictionary
    // from the client's own monitoring_keywords + high_value_assets,
    // so every client's exemption set is correct without code changes.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const relevanceTokens: string[] = [
      ...(Array.isArray((client as any).monitoring_keywords) ? (client as any).monitoring_keywords : []),
      ...(Array.isArray((client as any).high_value_assets) ? (client as any).high_value_assets : []),
    ]
      .filter((t: any) => typeof t === 'string')
      .map((t: string) => t.toLowerCase().trim())
      // Keep proper-noun-y tokens; drop short/generic words that would
      // over-match (e.g. "BC", "energy" alone would let unrelated stale
      // signals through).
      .filter((t: string) => t.length >= 5);

    let freshSignals = signals?.filter(s => {
      const signalDate = new Date(s.created_at || s.event_date || 0);
      const isRecent = signalDate >= new Date(fourteenDaysAgo);
      if (isRecent) return true;
      const text = (s.normalized_text || '').toLowerCase();
      const isClientRelevant = relevanceTokens.some((tok: string) => text.includes(tok));
      return s.severity === 'critical' && isClientRelevant;
    }) ?? [];

    // 2026-05-09 quality fixes from Petronas executive brief audit:
    // (1) Drop cancelled/resolved alerts — "Alert for X cancelled"
    //     shouldn't drive an EXECUTIVE FLASH. (2) Dedup multi-update
    //     NAAD events on cap.identifier or event+area so three updates
    //     of the same machete incident aren't counted as three critical
    //     signals (which today inflated trajectory to ESCALATING).
    const cancelledRe = /\b(cancel(?:led|ed)?|lifted|all\s*clear|stand\s*down|rescinded)\b/i;
    freshSignals = freshSignals.filter((s: any) => !cancelledRe.test(s.title ?? ''));

    // F. INTERIM GENERATOR-LEVEL DEDUP (consolidated ruling — temporary until
    // upstream dedup): merge claims sharing entity+event+date instead of
    // double-counting. Beyond CAP identifiers, fall back to a normalized
    // title + received-day key so near-duplicate signals (e.g. "Massive Wildfires
    // Near Clinton" / "Massive wildfires near Clinton" same day) collapse to one.
    const seenEvents = new Map<string, any>();
    for (const s of freshSignals) {
      const cap = (s.raw_json && typeof s.raw_json === 'object') ? s.raw_json.cap : null;
      const normTitle = (s.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const day = String(s.received_at || s.created_at || '').slice(0, 10);
      const dedupKey = cap?.identifier
        ? `cap:${cap.identifier}`
        : cap
          ? `evt:${cap.event}|${cap.area_desc ?? cap.areaDesc ?? ''}`
          : normTitle
            ? `evt:${normTitle}|${day}`
            : `id:${s.id}`;
      const existing = seenEvents.get(dedupKey);
      if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
        seenEvents.set(dedupKey, s);
      }
    }
    freshSignals = Array.from(seenEvents.values());

    // ── A. TIERED RELEVANCE GATE (consolidated brief-quality ruling 2026-07-28) ──
    // relevance_score is 0–1. ≥0.60 = MAIN tier (exec flash, client issues,
    // incidents, risk table, action items — only this tier drives actions/ratings).
    // 0.30–0.59 = AWARENESS tier → "Industry & Community Awareness" narrative
    // context only (no action items, no incident refs, no risk-table effect).
    // <0.30 (incl. unscored/null) = excluded entirely.
    const REL_MAIN = 0.60;
    const REL_AWARENESS_MIN = 0.30;
    const HAZARD_CAP = 0.40;

    // ── Pathway fallback cap (fourth-read ruling 1) — FAIL-CLOSED doctrine enforcement ──
    // A hazard-class signal reaches MAIN tier ONLY with an affirmatively-established pathway
    // to a client asset (a PostGIS coordinate/asset/corridor hit recorded in
    // hazard_pathway_scores with has_pathway=true). Text-derived geography, or NO score row at
    // all, never exempts — the brief does NOT trust that upstream ingest scoring ran (e.g.
    // monitor-rss-sources hazard signals bypass score_signal_hazard_pathway). Absent an
    // established pathway, effective relevance is capped at 0.40 → awareness, never main/flash.
    const pathwayEstablished = new Set<string>();
    {
      const hazardIds = freshSignals
        .filter((s: any) => HAZARD_CLASSES.has(String(s?.category || '')))
        .map((s: any) => s.id).filter(Boolean);
      if (hazardIds.length > 0) {
        const { data: pathRows } = await supabase
          .from('hazard_pathway_scores')
          .select('signal_id, has_pathway')
          .in('signal_id', hazardIds)
          .eq('has_pathway', true);
        for (const p of pathRows ?? []) pathwayEstablished.add(p.signal_id);
      }
      const capped = freshSignals.filter((s: any) =>
        HAZARD_CLASSES.has(String(s?.category || '')) && !pathwayEstablished.has(s?.id)).length;
      console.log(`[generate-executive-report] pathway-cap: ${pathwayEstablished.size} hazard w/ established pathway; ${capped} no-pathway hazard capped to <=${HAZARD_CAP}`);
    }

    const relScore = (s: any): number => {
      const v = typeof s?.relevance_score === 'number' ? s.relevance_score : parseFloat(s?.relevance_score);
      const raw = Number.isFinite(v) ? v : 0;
      // Fail-closed hazard pathway cap: hazard-class with no established pathway → <= 0.40.
      if (HAZARD_CLASSES.has(String(s?.category || '')) && !pathwayEstablished.has(s?.id)) {
        return Math.min(raw, HAZARD_CAP);
      }
      return raw;
    };
    const awarenessSignals = freshSignals.filter((s: any) => {
      const r = relScore(s);
      return r >= REL_AWARENESS_MIN && r < REL_MAIN;
    });
    // ── Amendment A — no silent demotion above the main threshold ──
    // Non-citable signals with relScore >= 0.60 do NOT route to awareness (that would launder their
    // content into regional context). They route to a REVIEW QUEUE: excluded from all body prose,
    // Flash, actions, and incident refs, surfaced to the operator with id/relevance/source/reason.
    const reviewQueueSignals = freshSignals.filter((s: any) => relScore(s) >= REL_MAIN && !citableSet.has(s.id));
    // WO-PROVENANCE-01 Correction 1 — deterministic denominator chain, single unit = SIGNAL counts.
    // The generator fetches client-scoped signals only, so "in-window" here is the client-gated fetch
    // (the cross-client platform total is an analyst-external figure, not embedded in a client report).
    const chainClientGated = signals?.length ?? 0;                                        // fetched: client + window + quality_status=active
    const chainQuality = freshSignals.length;                                             // after stale/cancelled/dedup collapse
    const chainRelevanceMain = freshSignals.filter((s: any) => relScore(s) >= REL_MAIN).length;  // rel>=0.60 (citable + review-queue)
    // Main tier = relevant AND citable. A non-citable signal can never feed a main-body assertion.
    freshSignals = freshSignals.filter((s: any) => relScore(s) >= REL_MAIN && citableSet.has(s.id));
    const chainCitable = freshSignals.length;                                             // rel>=0.60 AND citable
    console.log(`[generate-executive-report] citability tiering: ${freshSignals.length} main-citable · ${reviewQueueSignals.length} review-queue (rel>=${REL_MAIN}, non-citable) · ${awarenessSignals.length} awareness · review-queue ids: ${reviewQueueSignals.map((s: any) => s.signal_number || s.id?.slice(0, 8)).join(', ')}`);

    // Fetch incidents with classification rationale (excluding deleted + test)
    const { data: incidents, error: incidentsError } = await supabase
      .from('incidents')
      .select(`
        *,
        incident_classification_rationale (
          classification,
          system_of_origin,
          rationale,
          classified_at
        )
      `)
      .eq('client_id', client_id)
      .gte('opened_at', periodStart.toISOString())
      .lte('opened_at', periodEnd.toISOString())
      .neq('is_test', true)
      .is('deleted_at', null)
      // G(b): exclude superseded (merged-away duplicate) incidents.
      .is('superseded_by', null)
      // CANONICAL active-incident filter (zombie-incident fix). Only genuinely-open
      // incidents reach the brief — a soft-closed incident (status='closed' +
      // outcome_type, e.g. WO-INCIDENT-QA news_reclassified/invalid) must NOT render
      // as an open P2. Terminal statuses live in ONE place: the active_incidents view
      // / ACTIVE_INCIDENT_STATUSES mirror (_shared/incident-status.ts). Kept as a
      // status .in() rather than reading the view because this query embeds
      // incident_classification_rationale (PostgREST can't embed FKs through a view).
      .in('status', ACTIVE_INCIDENT_STATUSES)
      .order('opened_at', { ascending: false });

    if (incidentsError) throw incidentsError;

    // ── Amendment B — close the second entrance ──
    // Incidents and multi-agent debates are the other two reads that can carry non-citable content
    // into the body. Enforce citability UPSTREAM of both: an incident is BODY-ELIGIBLE only if it
    // has >=1 CITABLE supporting signal; debates are gated to body-eligible incidents. The primary
    // signal (incidents.signal_id) may be outside the report's signal window, so we resolve its
    // citability directly.
    const bodyEligibleIncidentIds = new Set<string>();
    {
      const incSigIds = [...new Set((incidents ?? []).map((i: any) => i.signal_id).filter(Boolean))];
      const incSigCitable = new Set<string>();
      if (incSigIds.length) {
        const { data: incSigs } = await supabase.from('signals')
          .select('id, source_id, source_url, raw_json, received_at, event_date')
          .eq('client_id', client_id)  // defense-in-depth: an incident's supporting signal must be same-client
          .in('id', incSigIds);
        const extraSrc = [...new Set((incSigs ?? []).map((r: any) => r.source_id).filter(Boolean).filter((id: string) => !provById.has(id)))];
        if (extraSrc.length) { const { data: more } = await supabase.from('sources').select('id, publisher_kind, publisher_name, provenance_path').in('id', extraSrc); for (const r of (more ?? [])) provById.set(r.id, r); }
        for (const r of (incSigs ?? [])) if (citeFor(r).citable) incSigCitable.add(r.id);
      }
      for (const i of (incidents ?? [])) if (i.signal_id && (citableSet.has(i.signal_id) || incSigCitable.has(i.signal_id))) bodyEligibleIncidentIds.add(i.id);
    }
    // Reassign the incident set used for the body to body-eligible only (drives p1p2Incidents,
    // counts, render, debates downstream). Non-eligible incidents are excluded from the report body.
    const _incidentsRaw = incidents ?? [];
    const incidentsBody = _incidentsRaw.filter((i: any) => bodyEligibleIncidentIds.has(i.id));
    console.log(`[generate-executive-report] incident citability gate: ${incidentsBody.length}/${_incidentsRaw.length} body-eligible (>=1 citable supporting signal)`);

    // ── Multi-agent debate syntheses for this period (Day 2 of plan) ──
    // The executive report's analytical content must reflect the
    // platform's actual specialist work: AEGIS-CMD-adjudicated
    // syntheses with named participants, consensus scores, and
    // authored final_assessments. Without this, the report
    // regenerates analysis from raw signals via single-LLM —
    // destroying the auditable reasoning trail the platform's
    // value proposition rests on.
    const incidentIds = incidentsBody.map((i: any) => i.id).filter(Boolean);  // debates gated to body-eligible incidents (Amendment B)
    const { data: rawDebates } = incidentIds.length > 0
      ? await supabase
          .from('agent_debate_records')
          .select('id, debate_type, judge_agent, participating_agents, consensus_score, final_assessment, created_at, incident_id')
          .in('incident_id', incidentIds)
          .order('created_at', { ascending: false })
          .limit(60)
      : { data: [] as any[] };
    // Dedup per incident — keep only the most recent debate per
    // incident_id. Without this, the report can include multiple
    // debates of the same incident (e.g., 6 TC Energy syntheses in
    // 4 hours from repeated chat-triggered runs) which clutters the
    // synthesis section with near-duplicate content. The newest
    // debate also tends to have the best specialty-routed
    // participants since the routing logic improves over time.
    const seenIncidents = new Set<string>();
    const periodDebates = (rawDebates || []).filter((d: any) => {
      if (!d?.incident_id) return false;
      if (seenIncidents.has(d.incident_id)) return false;
      seenIncidents.add(d.incident_id);
      return true;
    }).slice(0, 15);

    // Fetch tone transformation rules
    const { data: toneRules } = await supabase
      .from('executive_tone_rules')
      .select('original_phrase, replacement_phrase')
      .eq('is_active', true);

    // Fetch team members for ownership suggestions
    const { data: teamMembers } = await supabase
      .from('profiles')
      .select('id, name')
      .limit(50);

    // Fetch user roles for ownership matching
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('user_id, role');

    // Build team map with roles
    const teamMap = new Map<string, { id: string; name: string; roles: string[] }>();
    teamMembers?.forEach(member => {
      const roles = userRoles?.filter(ur => ur.user_id === member.id).map(ur => ur.role) || [];
      teamMap.set(member.id, { id: member.id, name: member.name, roles });
    });

    // Apply tone transformation function
    function applyToneTransformation(text: string): string {
      if (!text || !toneRules?.length) return text;
      let result = text;
      for (const rule of toneRules) {
        const regex = new RegExp(rule.original_phrase, 'gi');
        result = result.replace(regex, rule.replacement_phrase);
      }
      return result;
    }

    // Filter out junk signals before any analysis — use freshSignals (not raw signals) to exclude stale/historical data
    const EXCLUDE_CATEGORIES = new Set(['weather', 'wildfire', 'natural_disaster', 'test', 'work_interruption', 'advisory', 'health_concern', 'system_alert']);
    const HIGH_VALUE_CATEGORIES = new Set(['active_threat', 'cybersecurity', 'insider_threat', 'protest', 'regulatory', 'operational']);

    const reportableSignals = (freshSignals || []).filter((s: any) => {
      if (EXCLUDE_CATEGORIES.has(s.category)) return false;
      if (HIGH_VALUE_CATEGORIES.has(s.category) && s.severity === 'low') return false;
      return true;
    });

    // Log signal count but don't block — AI will note low activity if signals are sparse
    console.log(`[generate-executive-report] reportable signals: ${reportableSignals.length}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE-INPUT SIGNAL SET (operator directive 2026-05-29)
    // Pattern-detector signals (signal_type='pattern') are META-OBSERVATIONS about
    // signal volume — e.g. "[PATTERN] Frequency spike: 4 this week vs 0 prior week".
    // They are NOT direct threat observations. Today they are tagged
    // category='active_threat' at ingest, which lets them feed the narrative LLM and
    // get promoted into "ESCALATING threat activity" prose for quiet-period clients.
    // Per the signal-vs-threat-separation proposal, exclude pattern signals from the
    // narrative input. They remain in:
    //   • Flash counts (criticalSignals/highSignals built from reportableSignals)
    //   • Signal History + evidenceSources (per-signal evidence loop)
    //   • Operator drill-down via report_evidence_sources
    // They no longer feed:
    //   • signalsByCategory used for narrative selection
    //   • weightedCategories
    //   • the narrative LLM prompt
    // ═══════════════════════════════════════════════════════════════════════════
    const narrativeSignals = reportableSignals.filter((s: any) => s.signal_type !== 'pattern');
    const patternSignalCount = reportableSignals.length - narrativeSignals.length;
    console.log(`[generate-executive-report] narrative signals: ${narrativeSignals.length} (excluded ${patternSignalCount} pattern signals)`);

    function getHostname(url: string | null | undefined): string {
      // WO-PROVENANCE-01 step 3: no "Fortress Intelligence" fallback. A signal with no URL is
      // non-citable (never fabricate the platform as the publisher). Citation is governed by
      // resolveCitation upstream; this helper returns '' for the no-URL case.
      if (!url) return '';
      try { return new URL(url).hostname; } catch { return url; }
    }

    // Group signals by category (existing Flash + downstream paths — uses reportableSignals).
    const signalsByCategory = reportableSignals.reduce((acc: any, s: any) => {
      const cat = s.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    }, {});

    // SEPARATE grouping for the narrative path — pattern signals excluded.
    // The narrative section consumes this; Flash + Signal History do not.
    const narrativeSignalsByCategory = narrativeSignals.reduce((acc: any, s: any) => {
      const cat = s.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    }, {});

    const criticalSignals = reportableSignals.filter((s: any) => s.severity === 'critical');
    const highSignals = reportableSignals.filter((s: any) => s.severity === 'high');

    // ── B. FLASH / ACTION LIABILITY GUARD (consolidated brief-quality ruling 2026-07-28) ──
    // The executive flash + action items derive ONLY from main-tier signals in
    // these categories. civil_emergency (wildfires, evacuations, air quality)
    // informs the summary/issues + risk CONTEXT but must NEVER generate the flash
    // or a CRITICAL action item for an energy client — that framing is a liability.
    const FLASH_ELIGIBLE_CATEGORIES = new Set(['operational', 'regulatory', 'active_threat', 'security']);
    const flashEligibleSignals = reportableSignals.filter((s: any) => FLASH_ELIGIBLE_CATEGORIES.has(s.category));
    const flashCritical = flashEligibleSignals.filter((s: any) => s.severity === 'critical');
    const flashHigh = flashEligibleSignals.filter((s: any) => s.severity === 'high');
    console.log(`[generate-executive-report] B/flash-guard: ${flashEligibleSignals.length} flash-eligible (crit ${flashCritical.length}/high ${flashHigh.length}); ${reportableSignals.length - flashEligibleSignals.length} main-tier signals routed to issues/context only`);

    const p1p2Incidents = incidentsBody.filter((i: any) => i.priority === 'p1' || i.priority === 'p2') || [];  // body-eligible only (Amendment B)
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX: Unknown incident classification using REAL fields (not non-existent category column)
    // An incident is "unknown/unclassified" if:
    // 1. incident_type is null/empty/unknown, OR
    // 2. No linked signal (signal_id is null), OR
    // 3. Title contains generic "unknown"/"unidentified" patterns
    // ═══════════════════════════════════════════════════════════════════════════
    const unknownTitlePatterns = /unknown|unidentified|unclassified|anomal|unusual activity/i;
    const unknownIncidents = p1p2Incidents.filter(i => {
      const hasUnknownType = !i.incident_type || i.incident_type.toLowerCase() === 'unknown';
      const hasNoSignal = !i.signal_id;
      const hasUnknownTitle = unknownTitlePatterns.test(i.title || '');
      return hasUnknownType || hasNoSignal || hasUnknownTitle;
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX: Separate NEW vs STALE incidents to prevent misleading "cluster" claims
    // ═══════════════════════════════════════════════════════════════════════════
    const newIncidentsLast24h = p1p2Incidents.filter(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      return openedAt >= last24hThreshold;
    });
    
    const staleOpenIncidents = p1p2Incidents.filter(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      const ageMs = reportGeneratedAt.getTime() - openedAt.getTime();
      return ageMs > staleThresholdMs;
    });
    
    // Calculate age metadata for each incident
    const incidentsWithAge = p1p2Incidents.map(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      const ageMs = reportGeneratedAt.getTime() - openedAt.getTime();
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const isStale = ageMs > staleThresholdMs;
      const isNew = openedAt >= last24hThreshold;
      return { ...i, ageDays, isStale, isNew, openedAtFormatted: openedAt.toISOString().split('T')[0] };
    });
    
    console.log(`Incident breakdown: ${p1p2Incidents.length} total P1/P2, ${newIncidentsLast24h.length} new (last 24h), ${staleOpenIncidents.length} stale (>7 days), ${unknownIncidents.length} unknown/unclassified`);

    // Calculate risk ratings
    // ── D. RISK-TABLE EVIDENCE RULE (consolidated brief-quality ruling 2026-07-28) ──
    // A threat factor rates above LOW only if there is ≥1 genuine signal IN THAT
    // CATEGORY at ≥60 relevance (freshSignals is already the ≥0.60 main tier).
    // Previously `sabotageThreat` counted `|| severity === 'critical'`, so every
    // critical WILDFIRE (civil_emergency) was counted as "Sabotage/Vandalism"
    // (INC audit: 10/10 of the "Sabotage 10" were critical wildfires, 0 actual
    // sabotage). Category-only counting removes that mislabel. "Critical Threats"
    // now counts flash-eligible criticals only, so civil_emergency does not
    // inflate the risk table.
    const surveillanceRisk = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('surveillance') ||
      s.category?.toLowerCase().includes('reconnaissance')
    ).length;

    const protestRisk = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('protest') ||
      s.category?.toLowerCase().includes('activism')
    ).length;

    const sabotageThreat = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('sabotage') ||
      s.category?.toLowerCase().includes('vandalism')
    ).length;

    const criticalThreatCount = flashCritical.length;

    // Work Interruption: genuine in-category signals only — NOT "all open
    // incidents" (that counted the wildfire/civil_emergency incidents as work
    // interruption for an energy client).
    const workInterruptionRisk = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('work_interruption') ||
      s.category?.toLowerCase().includes('operational_disruption') ||
      s.category?.toLowerCase().includes('blockade')
    ).length;

    function getRiskLevel(count: number): string {
      if (count >= 5) return 'HIGH';
      if (count >= 3) return 'ELEVATED';
      if (count >= 1) return 'MODERATE';
      return 'LOW';
    }

    const overallRiskLevel = getRiskLevel(
      Math.max(surveillanceRisk, protestRisk, sabotageThreat, criticalThreatCount)
    );

    // Build evidence sources array for traceability
    const evidenceSources: EvidenceSource[] = [];
    const appBaseUrl = Deno.env.get('APP_URL') || 'https://fortress.silentshieldsecurity.com';

    // Add signal evidence
    freshSignals.slice(0, 20).forEach(signal => {
      evidenceSources.push({
        claim: signal.normalized_text?.substring(0, 100) || 'Signal detected',
        sourceType: 'signal',
        sourceId: signal.id,
        sourceTitle: `${signal.category || 'Signal'} - ${signal.severity}`,
        sourceUrl: signal.source_url || undefined,
        internalUrl: `/signals?id=${signal.id}`,
        timestamp: signal.received_at,
        confidence: signal.confidence_score
      });
    });

    // Add incident evidence
    incidents?.forEach(incident => {
      const rationale = incident.incident_classification_rationale?.[0];
      evidenceSources.push({
        claim: `${incident.priority?.toUpperCase()} Incident: ${incident.category || 'Unknown'}`,
        sourceType: rationale?.system_of_origin || 'incident',
        sourceId: incident.id,
        sourceTitle: `Incident ${incident.id.substring(0, 8)}`,
        internalUrl: `/incidents?id=${incident.id}`,
        timestamp: incident.opened_at,
        confidence: undefined
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // KNOWLEDGE BASE + AGENT BELIEF INJECTION — REMOVED 2026-05-29
    // Forensic audit on the Trent Reznor exec-intel report (5edad4b5) proved
    // these three context injections caused methodology-applied-as-evidence
    // narrative drift: expert_knowledge rows describing workplace-violence
    // pathway / fixation / advance surveys / close protection were lifted
    // verbatim into the narrative for a quiet-period client with 0 high
    // signals and only 3 pattern-detector mentions.
    //
    // Operator directive: executive reports must be evidence-first.
    // Methodology must never be allowed to masquerade as observed intelligence.
    // The prompts already carry their own tradecraft rules (CAPITALS for
    // surnames, DEDUCTIONS label, no markdown, grounding-verification steps).
    // External context is structurally unnecessary for coherent output.
    //
    // To restore (only after INC-LEARN-CONTAM is closed AND a per-client
    // relevance gate is added): bring back ONLY rows whose content is
    // demonstrably grounded in the client's own signals/incidents.
    // ═══════════════════════════════════════════════════════════════════════════
    const knowledgeContext = '';
    const agentContext = '';
    const briefingStandardsContext = '';
    console.log('[generate-executive-report] knowledge/agent_beliefs/briefingStandards injections DISABLED (operator directive 2026-05-29 — see methodology-applied-as-evidence forensic).');

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL DATE CONTEXT injected into AI prompts to prevent hallucination
    // ═══════════════════════════════════════════════════════════════════════════
    const criticalDateContext = `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL DATE CONTEXT (MANDATORY - DO NOT DEVIATE):
- Report Generated: ${currentDateTimeISO}
- Today's Date: ${currentDateISO}
- Reporting Period: ${periodStart.toDateString()} to ${periodEnd.toDateString()}

ABSOLUTE DATE ACCURACY RULES:
1. NEVER claim incidents "appeared" or "emerged" on dates other than their actual opened_at dates
2. NEVER fabricate clusters or groups that don't exist in the data
3. Report EXACT counts from data - do not round, estimate, or hallucinate numbers
4. Distinguish clearly between NEW incidents (opened in last 24h) and STALE incidents (>7 days old)
5. If an incident opened in November 2025, report it as from November 2025, NOT as a new threat
═══════════════════════════════════════════════════════════════════════════════`;

    const flashPrompt = `You are a senior security advisor providing a flash briefing for C-level executives at ${client.name}.
${criticalDateContext}

VERIFIED INTELLIGENCE DATA (use ONLY these numbers):
- ${flashCritical.length} critical severity signals (flash-eligible: operational/regulatory/active_threat/security only)
- ${flashHigh.length} high severity signals (flash-eligible)
- ${p1p2Incidents.length} TOTAL P1/P2 priority incidents
- ${newIncidentsLast24h.length} NEW incidents (opened in last 24 hours)
- ${staleOpenIncidents.length} STALE open incidents (opened >7 days ago, still open)
- ${unknownIncidents.length} unknown/unclassified incidents (need triage)
- Overall risk level: ${overallRiskLevel}
- Key categories: ${Object.keys(signalsByCategory).slice(0, 5).join(', ')}

${newIncidentsLast24h.length > 0 ? `NEW INCIDENTS (last 24h):\n${newIncidentsLast24h.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : 'NO new incidents in the last 24 hours.'}

${staleOpenIncidents.length > 0 ? `STALE OPEN INCIDENTS (>7 days old, require review):\n${staleOpenIncidents.slice(0, 3).map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : ''}

Top 3 flash-eligible signals:
${(flashCritical.length ? flashCritical : flashHigh).slice(0, 3).map((s, i) => `${i + 1}. [${s.category}] ${cleanSignalExcerpt(s.normalized_text).substring(0, 150)}`).join('\n') || '(none — no operational/regulatory/threat/security signals this period)'}

FLASH GUARD (liability rules — not style):
- The flash and its recommended action MUST derive only from the flash-eligible signals above (operational, regulatory, active_threat, security). Wildfires, evacuations, air-quality, and other civil_emergency events are handled in the Issues/Operations sections and MUST NOT be the flash or a CRITICAL action.
- NEVER name a private individual in the flash or recommended action. Reference people by role or community (e.g. "an affected resident", "the HSE Manager") unless they are a public figure acting in a public capacity.
- Partnership / equity / consultation / divestment developments are "developments requiring engagement" — never threat-framed.
- Do not use "escalating" or similar unless a flash-eligible signal explicitly says so. Report procedural reviews as reviews, not approvals; never let a claim exceed its source.
- If there are no flash-eligible critical/high signals, state plainly that no immediate action is required this period.

Provide a JSON response with exactly this structure:
{
  "mostPressingIssue": "One sentence describing the single most critical issue requiring attention — name specific individuals in CAPITALS if relevant. Do not use database field names or underscores — write in plain English.",
  "confidence": "High|Medium|Low",
  "recommendedAction": "One specific, actionable recommendation with a named owner role and timeframe",
  "ownerSuggestion": "Security Operations|Physical Security|Cyber Security|Intelligence|Executive Team",
  "deadlineUrgency": "Immediate|24 hours|48 hours|This week",
  "trajectory": "ESCALATING|STABLE|DE-ESCALATING",
  "trajectoryReason": "One sentence explaining the direction of risk vs the previous reporting period"
}

Be specific, cite EXACT data from above, and use executive-appropriate language. DO NOT claim clusters or groups that don't exist in the data.`;

    console.log('Generating executive flash banner...');

    // 2026-05-09 quality fix: posture-aware flash. Previously the LLM
    // was asked to generate a "most pressing issue" + "recommended
    // action" regardless of actual posture. With 0 critical and 0 high
    // signals + LOW risk, it would still fabricate urgency ("Immediate
    // attention is required for high severity signals...") which
    // contradicts the body's "Risk Level: LOW" — the kind of inversion
    // that breaks executive trust.
    //
    // When the period is quiet on every measurable axis, short-circuit
    // with a deterministic flash that matches the body. The LLM only
    // gets called when there's something to actually say.
    // B: the flash is "quiet" when there are no FLASH-ELIGIBLE critical/high
    // signals and no new incidents — regardless of civil_emergency volume or an
    // overall risk elevated by wildfire context. A wildfire-only period yields a
    // deterministic "no immediate action" flash, never a civil-emergency lead.
    const isQuietPeriod =
      flashCritical.length === 0
      && flashHigh.length === 0
      && newIncidentsLast24h.length === 0;

    let executiveFlash: any = {
      mostPressingIssue: 'Intelligence analysis in progress',
      confidence: 'Medium',
      recommendedAction: 'Review detailed findings below',
      ownerSuggestion: 'Security Operations',
      deadlineUrgency: '48 hours'
    };

    if (isQuietPeriod) {
      console.log('[ExecBrief] Quiet period — using deterministic flash (no LLM)');
      const periodSignalCount = freshSignals.length;
      executiveFlash = {
        mostPressingIssue: periodSignalCount === 0
          ? `No actionable signals collected against ${client.name} during this reporting period.`
          : `No critical or high-severity signals against ${client.name} this period. ${periodSignalCount} lower-severity signals collected, no escalation indicators.`,
        confidence: 'High',
        recommendedAction: 'No immediate action required. Continue routine monitoring; reassess at next scheduled report.',
        ownerSuggestion: 'Intelligence',
        deadlineUrgency: 'This week',
        trajectory: 'STABLE',
        trajectoryReason: 'No new critical or high-severity signals in the last 24 hours; no escalation indicators present.'
      };
    } else {
      const flashResult = await callAiGatewayJson({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a security intelligence advisor. Always respond with valid JSON only, no markdown. CRITICAL: if the verified data shows 0 critical signals AND 0 high signals AND 0 new incidents, the recommendedAction must explicitly state "no immediate action required" — do not fabricate urgency the data does not support. Inverting body posture in the flash breaks executive trust.'
          },
          { role: 'user', content: flashPrompt }
        ],
        functionName: 'generate-executive-report',
      });
      if (flashResult.data) executiveFlash = flashResult.data;

      // ── Flash precision check (fourth-read ruling 2) — strictest check on the most-read
      // sentence. mostPressingIssue is the single line executives read; verify its SUBJECT,
      // COUNTERPARTY, and ACTION against the flash-eligible source signals it must derive from.
      // On mismatch (e.g. "Germany finalized a LNG deal" for an "Uniper buys from Ksi Lisims"
      // source), fall back to the top source signal's own summary VERBATIM — never print a
      // garbled claim as the headline.
      const flashSources = (flashCritical.length ? flashCritical : flashHigh).slice(0, 3);
      if (flashSources.length > 0 && executiveFlash?.mostPressingIssue) {
        try {
          const verify = await callAiGatewayJson<{ match: boolean; reason?: string }>({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You verify factual fidelity. Respond with valid JSON only: {"match": boolean, "reason": string}. match=true ONLY if the CLAIM\'s subject (who), counterparty (with whom), and action (what happened) are ALL faithfully supported by at least one SOURCE. Naming a country instead of the company, the wrong party, or an action the source does not state = match=false.' },
              { role: 'user', content: `CLAIM (flash sentence):\n"${executiveFlash.mostPressingIssue}"\n\nSOURCES (the flash must derive from these):\n${flashSources.map((s: any, i: number) => `${i + 1}. ${cleanSignalExcerpt(s.normalized_text).substring(0, 220)}`).join('\n')}` }
            ],
            functionName: 'generate-executive-report',
          });
          if (verify.data && verify.data.match === false) {
            const fallback = cleanSignalExcerpt(flashSources[0].normalized_text).substring(0, 240);
            console.warn(`[ExecBrief] flash precision FAIL (${verify.data.reason ?? 'subject/counterparty/action mismatch'}) — falling back to source verbatim`);
            executiveFlash.mostPressingIssue = fallback;
            executiveFlash.flash_precision_fallback = true;
          }
        } catch (e) {
          console.warn('[ExecBrief] flash precision check errored (non-fatal):', (e as Error).message);
        }
      }
    }

    // Item 1 (second red-pen): the flash's assessed trajectory + the body risk
    // level are now handed to the summary prompt as CONSTRAINTS so the summary
    // can elaborate but never silently contradict the banner printed above it.
    const flashTrajectory = String(executiveFlash?.trajectory || 'STABLE').toUpperCase();

    // Generate Impact Ladders for top issues
    const impactPrompt = `As a security strategist, create impact ladders for the top 3 threats facing ${client.name}.

Current threat landscape (flash-eligible: operational/regulatory/active_threat/security only — civil_emergency is covered in Operations, not here):
${(flashCritical.length ? flashCritical : flashHigh).slice(0, 5).map((s, i) => `${i + 1}. ${s.category}: ${cleanSignalExcerpt(s.normalized_text).substring(0, 200)}`).join('\n') || '(no operational/regulatory/threat/security signals this period)'}

For each major threat, provide a JSON array with this structure:
[
  {
    "issue": "Brief description of the threat",
    "worstConsequence": "If true, worst credible consequence is...",
    "earliestIndicator": "The earliest indicator would be...",
    "mitigation": "Primary mitigation is..."
  }
]

Provide exactly 3 impact ladders. Be specific and actionable. Use executive language.`;

    console.log('Generating impact ladders...');
    let impactLadders: ImpactLadder[] = [];
    const impactResult = await callAiGatewayJson<ImpactLadder[]>({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strategic security advisor. Always respond with valid JSON only.' },
        { role: 'user', content: impactPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (impactResult.data) impactLadders = impactResult.data;

    // Build reliability context once — injected into both AI prompts
    const reliabilityContext = getReliabilityFirstPrompt([]);

    // Generate executive summary with tone transformation
    const summaryPrompt = `You are a senior security intelligence analyst synthesizing live threat data with your team's ongoing analytical work. Your specialist analysts have reached conclusions through continuous research — the executive summary should reflect their assessments where relevant, not just enumerate signals. Think of the analyst assessments as the interpretive backbone and the signals/incidents as the current evidence.
${reliabilityContext}
${criticalDateContext}

Client Context:
- Organization: ${client.organization || client.name}
- Industry: ${client.industry || 'N/A'}
- Locations: ${client.locations?.join(', ') || 'N/A'}
- High-Value Assets: ${client.high_value_assets?.join(', ') || 'N/A'}
${briefingStandardsContext}
${knowledgeContext}
${agentContext}

VERIFIED INTELLIGENCE DATA (use ONLY these numbers):
- Total signals collected: ${freshSignals.length}
- Provenance note: ${reviewQueueSignals.length} signals met the relevance threshold but were excluded for unresolvable provenance (review queue — not analyzed, not cited).
- Critical severity signals: ${criticalSignals.length}
- High severity signals: ${highSignals.length}
- TOTAL P1/P2 Incidents: ${p1p2Incidents.length}
- NEW incidents (last 24h): ${newIncidentsLast24h.length}
- STALE open incidents (>7 days old): ${staleOpenIncidents.length}
- Unknown/unclassified incidents: ${unknownIncidents.length}
- Open incidents total: ${incidentsBody.filter(isIncidentActive).length || 0}

${newIncidentsLast24h.length > 0 ? `NEW INCIDENTS (last 24h) - THESE ARE THE CURRENT THREATS:\n${newIncidentsLast24h.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : 'NO new P1/P2 incidents in the last 24 hours. Focus on signal intelligence and stale incident review.'}

${staleOpenIncidents.length > 0 ? `STALE OPEN INCIDENTS (opened >7 days ago, still unresolved):\n${staleOpenIncidents.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]} (${Math.floor((reportGeneratedAt.getTime() - new Date(i.opened_at).getTime()) / (24*60*60*1000))} days old)`).join('\n')}` : ''}

Top 5 Signals:
${freshSignals.slice(0, 5).map((s, i) => `${i + 1}. [${s.severity}] ${s.category}: ${cleanSignalExcerpt(s.normalized_text).substring(0, 200)}`).join('\n')}

FLASH-ELIGIBLE LEAD SET (operational / regulatory / active_threat / security, main-tier, pathway-passing — your BLUF and opening paragraph MUST lead from THIS set, the same material the flash banner derives from):
${(flashCritical.length ? flashCritical : flashHigh).slice(0, 5).map((s, i) => `${i + 1}. [${s.category}] ${cleanSignalExcerpt(s.normalized_text).substring(0, 180)}`).join('\n') || '(none this period — if empty, the lead is that no flash-eligible threat requires action; hazard/wildfire items are monitoring context only, never the lead)'}

MULTI-AGENT DEBATE SYNTHESES (last ${period_days}d, ${(periodDebates ?? []).length}):
These are AEGIS-CMD-judged syntheses authored by specialist agents under structured debate. Use them as INTERPRETIVE FRAMING ONLY — they may shape emphasis and structure of the summary.
PROVENANCE CONSTRAINT (WO-PROVENANCE-01, Correction 3 ruling b): debate syntheses have NO signal-derivation link, so you must NOT restate any debate claim as a fact in the body. Every factual assertion in the summary must independently trace to a CITED signal listed above; a debate contributes no standalone assertion or citation. Do NOT regenerate analysis the agents already produced.
${(periodDebates ?? []).slice(0, 8).map((d: any, idx: number) => {
  const linkedIncident = (incidents ?? []).find((i: any) => i.id === d.incident_id);
  const incTitle = linkedIncident?.title || `Incident ${String(d.incident_id).slice(0, 8)}`;
  const participants = Array.isArray(d.participating_agents) ? d.participating_agents.join(', ') : 'unknown';
  const consensus = typeof d.consensus_score === 'number' ? `${Math.round(d.consensus_score * 100)}%` : 'n/a';
  return `--- DEBATE ${idx + 1} on "${incTitle}" (judge: ${d.judge_agent || 'AEGIS-CMD'} · ${participants} · consensus ${consensus}) ---
${String(d.final_assessment || '').substring(0, 700)}`;
}).join('\n\n') || 'No multi-agent debates ran in this period.'}

Write a professional 2-3 paragraph executive summary that:
1. Opens with a BLUF (Bottom Line Up Front) — one sentence stating the single most important thing the executive needs to know right now
2. Names all key individuals using SURNAME in CAPITALS following intelligence tradecraft convention (e.g., activist organizer Richard BROOKS, journalist Danny NUNES, Dr. Ulrike MEYER)
3. Clearly distinguishes between new threats (last 24h) and stale open incidents — never present stale incidents as current threats
4. States the threat trajectory explicitly, CONSISTENT with the flash-assessed trajectory (${flashTrajectory}) — ESCALATING, STABLE, or DE-ESCALATING vs the previous reporting period, and why. If your read of the evidence genuinely differs, do NOT silently print the opposite word — reconcile it explicitly per the FLASH CONSISTENCY rule below
5. Reports EXACT counts from verified data only — never round or estimate
6. Closes with one specific sentence on what ${client.name} leadership should prioritize in the next 24 hours

RELEVANCE FILTER: if any signal in the data above is NOT actually relevant to ${client.name} on closer reading — wrong sector, wrong geography, different company, tangential industry news — exclude it from the summary entirely. Do NOT mention it just to dismiss it ("noted but not directly impacting" / "while this reflects broader trends it does not concern us" / "not directly relevant to operations at this time") — that filler is exactly what a sophisticated FIFA-tier executive reader will spot as LLM padding. Silent exclusion only. If a signal is worth mentioning, state why it matters. If it isn't, drop it.

CRITICAL: Do NOT claim incidents "appeared" or "emerged" on dates other than their actual opened_at dates. Do NOT fabricate clusters or groups.

NUMBER RECONCILIATION RULE: A separate Risk Assessment table appears below the summary, showing threat-factor categories (Surveillance / Protest / Work Interruption / Sabotage / Critical Threats) with risk ratings and counts. Those counts are factor-grouped — not severity-tier counts. To prevent reader confusion when reading the summary alongside the table:
- If you cite a severity-tier count (e.g. "X high severity signals"), append the threat-factor breakdown that explains it: "X high-severity signals (mostly regulatory and cyber-vulnerability), distributed across..."
- If a severity-tier count cannot be cleanly broken down by factor, omit the count from the summary and rely on the table to convey volume.
- Never present a number that contradicts what an executive will see two paragraphs later.

LANGUAGE CALIBRATION (consolidated brief-quality ruling — enforce strictly):
- Partnership, equity, consultation, and divestment developments (e.g. a partner selling a stake) are "developments requiring engagement," never threat-framed.
- Report activist/community events neutrally by name and date. Do NOT use "escalating", "intensifying", or similar unless a signal explicitly states it.
- A claim must never exceed its source: reviews are reviews (not approvals), proposals are proposals (not decisions), concerns are concerns (not findings).
- Do NOT name private individuals; reference people by role or community unless they are a public figure acting in a public capacity.

SUMMARY LEAD CONSTRAINT (fourth-read ruling 3 — enforce strictly):
- The BLUF and the opening paragraph MUST derive from the FLASH-ELIGIBLE LEAD SET above (categories operational, regulatory, active_threat, security). This is the same set the flash banner derives from — the summary's lead may not diverge from the flash's basis.
- Regional hazard material (wildfire, evacuation, air-quality, flooding — categories civil_emergency, environmental, health_concern) is MONITORING CONTEXT ONLY. It may appear only AFTER the lead, framed as situational awareness (e.g. "regional wildfire activity continues near Clinton with no established pathway to PECL assets"), NEVER as "immediate attention", "key immediate concern", or an action item, and NEVER as the lead when the flash trajectory is STABLE.
- If the flash-eligible lead set is empty, lead with that fact ("no flash-eligible threat requires action this period"); do not promote hazard context into the lead to fill the space.

FLASH CONSISTENCY (internal-consistency constraint — an executive flash banner has ALREADY been assessed and will be printed directly ABOVE your summary):
- Flash-assessed trajectory: ${flashTrajectory}
- Body / flash risk level: ${overallRiskLevel}
You may elaborate, add nuance, or explain the drivers, but the headline trajectory and risk posture you state must NOT contradict the flash. If your read of the evidence genuinely differs, do not simply assert the opposite — reconcile it explicitly in one clause that names BOTH the flash's posture and your qualification (e.g. "wildfire context remains active in the region though the flash-eligible threat posture is stable"). Never print a trajectory word that disagrees with the flash without that explicit reconciliation. Silent disagreement is the specific failure this rule closes.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

    console.log('Generating executive summary...');
    let executiveSummary = 'Analysis in progress...';
    const summaryResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a senior security intelligence analyst writing for C-level executives. You apply BLUF, Minto Pyramid, and structured analytical tradecraft. Use formal, precise, business-appropriate language.' },
        { role: 'user', content: summaryPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (summaryResult.content) executiveSummary = applyToneTransformation(summaryResult.content);
    // E: cut the "Reliability Score: X% | Sources: N verified | External Intel: …"
    // line — the metric is not real yet (brief-quality ruling 2026-07-28).
    executiveSummary = executiveSummary
      .replace(/^\s*Reliability Score:.*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Item 3 (second red-pen): render-time private-name backstop over the
    // generated prose. Title-Case-only matching leaves intentional CAPITALS
    // public-figure surnames untouched; catches any private name that slipped
    // through the prompt rule.
    executiveSummary = scrubPrivateIndividualNames(executiveSummary);

    // WO-PROVENANCE-01 Amendment A — the review-queue note is a DETERMINISTIC provenance
    // disclosure, not LLM-discretionary. Appended verbatim so a reader always sees it when
    // signals met the relevance threshold but were excluded for unresolvable provenance.
    if (reviewQueueSignals.length > 0) {
      executiveSummary = executiveSummary +
        `\n\nProvenance note: ${reviewQueueSignals.length} signal${reviewQueueSignals.length === 1 ? '' : 's'} met the relevance threshold but ` +
        `${reviewQueueSignals.length === 1 ? 'was' : 'were'} excluded from analysis for unresolvable provenance ` +
        `(review queue — not analyzed, not cited).`;
    }

    // Generate action items grounded in actual signal evidence.
    //
    // 2026-05-12 hardening: the previous prompt fed only signal counts +
    // overall risk level, so the model produced templated boilerplate
    // ("schedule cybersecurity training", "develop cross-departmental
    // incident response plan") that any Fortune 500 already has. A
    // FIFA-tier reader spots LLM filler in 5 seconds. Now feeds the
    // actual top signals so each recommendation must trace to a
    // specific observed event/entity.
    const actionSignalContext = (() => {
      // B: action items derive ONLY from flash-eligible signals
      // (operational/regulatory/active_threat/security) — never civil_emergency.
      const tier1 = [...flashCritical, ...flashHigh];
      const widened = tier1.length >= 3
        ? tier1.slice(0, 8)
        : [...tier1, ...flashEligibleSignals.filter((s: any) => !['critical', 'high'].includes(s.severity))].slice(0, 8);
      if (widened.length === 0) return '(No reportable signals in this period.)';
      return widened.map((s: any, i: number) => {
        const sigId = s.signal_number || `SIG-${(s.id || '').substring(0, 8).toUpperCase()}`;
        const ents = Array.isArray(s.entity_tags) && s.entity_tags.length ? ` [entities: ${s.entity_tags.slice(0, 3).join(', ')}]` : '';
        // Mandate classification of the signal's subject (ruling 4) — tells the generator
        // which authority vocabulary it may draw from for any action about this signal.
        const mc = classifySubject((client as any).mandate_profile, `${s.title || ''} ${s.normalized_text || ''}`);
        return `${i + 1}. ${sigId} [${(s.severity || 'medium').toUpperCase()}] [${mc.authorityClass}] ${s.category}: ${cleanSignalExcerpt(s.normalized_text)}${ents}`;
      }).join('\n');
    })();

    const actionsPrompt = `As a security operations advisor for ${client.name}, write 3-5 actionable recommendations that are DIRECTLY tied to the signals below. This is a FIFA-tier executive brief — generic boilerplate that any Fortune 500 already has (e.g. "schedule cybersecurity training", "develop incident response plan", "implement regular security audits") will be rejected.

Current period summary:
- ${criticalSignals.length} critical signals
- ${(highSignals ?? []).length} high signals
- ${p1p2Incidents.length} P1/P2 incidents
- Overall risk: ${overallRiskLevel}

Signals to ground recommendations in (each tagged with its mandate authority class):
${actionSignalContext}

${renderMandateGuidance((client as any).mandate_profile, client.name)}

MANDATORY RULES:
0. MANDATE FIRST: each signal above is tagged [OPERATE] / [AFFILIATED-INFORM] / [EXTERNAL-MONITOR]. Every recommendation MUST draw ONLY from that class's permitted verbs and carry its class prefix. Do NOT task security, harden, or "update protocols" for an AFFILIATED-INFORM or EXTERNAL-MONITOR subject. For LNG developments (Ksi Lisims / Uniper / LNG Canada) the correct output is a briefing/indirect-impact assessment for PECL stakeholders — never tasking another company's security.
1. Every recommendation MUST begin by citing at least one signal ID from the list above (format: "[SIG-XXX]") and reference the specific observed event/entity. A reader must be able to point to the signal that triggered each action.
2. NO generic, evergreen recommendations. If the action would apply to any company on any day with no signals at all, drop it.
3. NO recommendations along the lines of "develop a plan", "conduct training", "implement audits", "enhance sharing" unless the signal evidence specifically warrants it.
4. Be operationally specific — name the asset, location, entity, or incident the action addresses.
5. If signals don't support 5 recommendations, return fewer. 2 specific recommendations beat 5 templated ones.
6. If there are zero reportable signals, return an empty array [].

Available team roles: Security Operations, Physical Security Lead, Cyber Security Lead, Intelligence Analyst, Executive Team, Legal/Compliance

Output JSON only (no markdown, no commentary):
[
  {
    "description": "[SIG-XXX] <specific action that references the signal's observed event/entity>",
    "ownerRole": "Most appropriate team role",
    "priority": "critical|high|medium",
    "deadlineDays": 1|3|7|14,
    "firstUpdateDays": 1|2|3
  }
]

Max 5 items.`;

    console.log('Generating action items...');
    let actionItems: ActionItem[] = [];
    const actionsResult = await callAiGatewayJson({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a security operations advisor. Always respond with valid JSON only.' },
        { role: 'user', content: actionsPrompt }
      ],
      functionName: 'generate-executive-report',
    });

    if (actionsResult.data) {
      try {
        const rawActions = actionsResult.data;
        const now = new Date();
        actionItems = rawActions.map((a: any) => {
          const deadline = new Date(now);
          deadline.setDate(deadline.getDate() + (a.deadlineDays || 7));
          const firstUpdate = new Date(now);
          firstUpdate.setDate(firstUpdate.getDate() + (a.firstUpdateDays || 2));
          
          // Try to find a matching team member
          let ownerName = a.ownerRole;
          let ownerId: string | undefined;
          for (const [id, member] of teamMap) {
            if (member.roles.some(r => a.ownerRole.toLowerCase().includes(r))) {
              ownerId = id;
              // Sanitize: don't expose email addresses as display names in reports
              const isEmail = member.name?.includes('@');
              ownerName = isEmail ? a.ownerRole : (member.name || a.ownerRole);
              break;
            }
          }

          return {
            description: a.description,
            ownerId,
            ownerName,
            ownerRole: a.ownerRole,
            deadline: deadline.toISOString(),
            firstUpdateDue: firstUpdate.toISOString(),
            priority: a.priority || 'medium'
          };
        });
      } catch (e) {
        console.error('Error parsing actions response:', e);
      }
    }

    // Generate deductions with tone transformation
    const deductionsPrompt = `You are a senior intelligence analyst writing strategic deductions for ${client.name} leadership. You write in the style of a professional government intelligence analyst — precise, direct, and specific. Apply the specialist knowledge and agent assessments below.
${reliabilityContext}
${knowledgeContext}
${agentContext}

MANDATORY TRADECRAFT RULES:
- Write ALL surnames of named individuals in CAPITALS (e.g., activist BROOKS, journalist NUNES, professor ANTWEILER)
- Label every analytical conclusion with DEDUCTIONS: as a plain text label — no bold, no asterisks, no hash symbols
- Do not use markdown formatting — no **bold**, no ### headers, no asterisks anywhere in the output
- Every deduction must end with a specific implication for ${client.name} — not generic industry risk
- State trajectory for each threat thread: ESCALATING / STABLE / DE-ESCALATING with one sentence of evidence
- Maximum 3 deduction paragraphs — quality and specificity over volume
- Never use vague language like "may pose risks" — state the specific risk clearly
- ONLY reference events, names, and facts that appear in the signals provided above — never introduce information from your training data or general knowledge
- Named individuals: only use names that appear verbatim in the signal text — do not infer, reconstruct, or introduce names from context

${renderMandateGuidance((client as any).mandate_profile, client.name)}
- Any RECOMMENDED ACTION or implication line must respect the mandate class of its subject: never prescribe operational action (task/secure/harden/update protocols) for an AFFILIATED-INFORM or EXTERNAL-MONITOR subject. LNG-sector developments (Ksi Lisims / Uniper / LNG Canada) yield strategic assessment or a stakeholder briefing — never tasking another company's security.

GROUNDING VERIFICATION — before writing each deduction:
1. Identify the specific signal number above that supports this claim
2. If you cannot cite a specific signal number — DO NOT include the claim
3. Never reference APT groups, threat actors, activist organizations, or events unless their exact name appears in the signals list above
4. If signals are insufficient to support 3 deductions — write fewer deductions rather than inventing claims
5. Zero signals = zero deductions. Write "Insufficient signal data for strategic deductions this period." instead.

Threat signals to analyze:
${(() => {
  // Prefer critical+high. If those are sparse (<3), broaden to all
  // reportable signals so the deduction prompt has substance to work
  // with. Earlier behavior — only feeding critical+high — produced
  // "Insufficient signal data" reports even when 63 medium/low
  // signals had genuine strategic relevance (regulatory pressure,
  // industry capex announcements, civil emergencies in operational
  // areas). The "high severity" label is set during ingest by an AI
  // classifier that often under-classifies regulatory/financial
  // intelligence as medium — operational relevance is broader than
  // severity tier.
  const tier1 = [...criticalSignals, ...highSignals];
  const widened = tier1.length >= 3
    ? tier1.slice(0, 10)
    : [...tier1, ...reportableSignals.filter((s: any) => !['critical', 'high'].includes(s.severity))].slice(0, 10);
  return widened.length > 0
    ? widened.map((s: any, i: number) => `${i + 1}. [${(s.severity || 'medium').toUpperCase()}] ${s.category}: ${cleanSignalExcerpt(s.normalized_text)}`).join('\n')
    : '(No reportable signals in this period.)';
})()}
${(() => {
  const deductionSignals = [...criticalSignals, ...highSignals].slice(0, 10);
  const hasStale = deductionSignals.some((s: any) => {
    const eventDate = s.event_date ? new Date(s.event_date) : null;
    return eventDate && (Date.now() - eventDate.getTime()) > 365 * 24 * 60 * 60 * 1000;
  });
  return hasStale ? '\nWARNING: Some signals above have event dates older than 1 year. Treat these as historical context only — never as current active threats.' : '';
})()}

For each major threat thread write one deduction paragraph in this format:
DEDUCTIONS: [2-3 sentences connecting the signals to a specific implication for ${client.name}. Name threat actors in CAPITALS. State whether this thread is ESCALATING, STABLE, or DE-ESCALATING with one piece of evidence. End with one specific recommended action for ${client.name} with an owner role and timeframe.]

Use professional executive language. Be direct. Avoid hedging.

LANGUAGE CALIBRATION (consolidated brief-quality ruling — enforce strictly):
- Partnership, equity, consultation, and divestment developments (e.g. a partner selling a stake) are "developments requiring engagement," never threat-framed.
- Report activist/community events neutrally by name and date. Do NOT use "escalating", "intensifying", or similar unless a signal explicitly states it.
- A claim must never exceed its source: reviews are reviews (not approvals), proposals are proposals (not decisions), concerns are concerns (not findings).
- Do NOT name private individuals; reference people by role or community unless they are a public figure acting in a public capacity.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

    console.log('Generating strategic deductions...');
    let deductions = 'Analysis in progress...';
    const deductionsResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strategic security analyst providing executive-level threat assessment.' },
        { role: 'user', content: deductionsPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (deductionsResult.content) deductions = applyToneTransformation(deductionsResult.content);

    // ── AWARENESS SECTION SYNTHESIS (fourth-read ruling 5) — product surface, not exhaust log ──
    // Filter first (asset-gate), then synthesize themed paragraphs. Never a raw title list.
    const awarenessForSynthesis = (awarenessSignals as any[]).filter((s) => {
      const title = String(s.title || '').trim();
      const text = String(s.normalized_text || '').trim();
      const hay = `${title} ${text}`.toLowerCase();
      // Drop bare / contentless items.
      if (text.length < 40 && title.length < 25) return false;
      const clientRelevant = relevanceTokens.some((t: string) => hay.includes(t));
      // Asset-gate: an unscoped CVE / vulnerability with no client asset or tech reference is
      // noise at ANY tier.
      const isCve = /\bcve-\d{4}-\d+/i.test(hay) ||
        (String(s.category || '').includes('cyber') && /vulnerab|exploit|zero.day|patch/i.test(hay));
      if (isCve && !clientRelevant) return false;
      // [PATTERN] meta-observations render only if the entity is client-relevant (e.g. a WCNG
      // pipeline escalation earns a sentence; "geographic cluster near Clinton" is the system
      // talking to itself — internal only).
      if (/^\[pattern\]/i.test(title) && !clientRelevant) return false;
      return true;
    });
    const awarenessTotal = (awarenessSignals as any[]).length;
    let awarenessSynthesis = '';
    if (awarenessForSynthesis.length > 0) {
      const awItems = awarenessForSynthesis.slice(0, 25).map((s: any) => {
        const sigId = s.signal_number || `SIG-${(s.id || '').substring(0, 8).toUpperCase()}`;
        return `${sigId} [${s.category}] ${cleanSignalExcerpt(s.normalized_text).substring(0, 200)}`;
      }).join('\n');
      const awarenessPrompt = `You are writing the "Industry & Community Awareness" section of an executive brief for ${client.name}. This is situational-awareness context ONLY — no client-specific threats, no action items.
${criticalDateContext}

AWARENESS ITEMS (lower-relevance context, each with a signal ID):
${awItems}

Write 2-4 SHORT themed paragraphs (NOT a list, NOT bullet points), each grounded with 1-2 signal IDs in brackets, e.g. [SIG-2026-027101]. Suggested themes (use only those the data supports):
1. Regional hazard context — wildfire/weather/air-quality activity near the operating region. You MUST include an explicit sentence stating there is NO established pathway to ${client.name}'s operated assets (that verification IS the value; e.g. "regional wildfire activity continues near Clinton, ~325 km from the nearest PECL corridor, with no established pathway to operated assets").
2. Industry & sector moves — LNG/energy developments, competitor and third-party activity, regulatory context.
3. Patterns worth watching — recurring themes or escalations that do not yet warrant action.
Rules: plain prose, no markdown, no asterisks, no headers. Total length UNDER 250 words. Prioritize the most relevant items; it is fine to omit minor ones. Never name a private individual. Do not frame anything as requiring immediate attention.`;
      const awRes = await callAiGateway({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a security intelligence analyst writing concise situational-awareness context. Plain prose only, no markdown.' },
          { role: 'user', content: awarenessPrompt }
        ],
        functionName: 'generate-executive-report',
      });
      if (awRes.content) awarenessSynthesis = scrubPrivateIndividualNames(applyToneTransformation(awRes.content)).slice(0, 1900); // length governor (~1/3 page)
    }
    console.log(`[generate-executive-report] awareness: ${awarenessTotal} tier items → ${awarenessForSynthesis.length} passed asset-gate → ${awarenessSynthesis ? 'synthesized' : 'empty'}`);

    const categoryDisplayNames: Record<string, string> = {
      'active_threat': 'Active Threat',
      'social_sentiment': 'Social Sentiment',
      'work_interruption': 'Work Interruption',
      'cyber': 'Cyber Security',
      'cybersecurity': 'Cyber Security',
      'civil_emergency': 'Civil Emergency',
      'insider_threat': 'Insider Threat',
      'active_shooter': 'Active Shooter',
      'protest': 'Protest Activity',
      'surveillance': 'Surveillance',
      'sabotage': 'Sabotage',
      'vandalism': 'Vandalism',
      'uncategorized': 'General Intelligence',
    };
    const getCategoryDisplay = (cat: string) =>
      categoryDisplayNames[cat] || cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Generate detailed narratives — top 3 categories by weighted score (critical×4, high×2, medium×1), min score 3
    // Uses narrativeSignalsByCategory (pattern signals excluded) per operator directive 2026-05-29.
    const weightedCategories = Object.entries(narrativeSignalsByCategory)
      .map(([category, categorySignals]: [string, any]) => {
        const score = (categorySignals as any[]).filter((s: any) => s.severity !== 'low').reduce((sum: number, s: any) => {
          if (s.severity === 'critical') return sum + 4;
          if (s.severity === 'high') return sum + 2;
          return sum + 1;
        }, 0);
        return { category, categorySignals, score };
      })
      .filter(({ score }) => score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE QUIET-PERIOD SHORT-CIRCUIT (operator directive 2026-05-29)
    // Mirror the Flash's isQuietPeriod gate so Flash and Narrative cannot
    // contradict each other. When the deterministic-Flash conditions are met
    // (0 critical, 0 high, 0 new incidents, LOW risk) — using the
    // narrative-eligible signal set (pattern signals excluded) — the narrative
    // LLM is bypassed entirely. Emit deterministic per-category text consistent
    // with the Flash.
    // ═══════════════════════════════════════════════════════════════════════════
    const narrativeCriticalCount = narrativeSignals.filter((s: any) => s.severity === 'critical').length;
    const narrativeHighCount     = narrativeSignals.filter((s: any) => s.severity === 'high').length;
    const isNarrativeQuietPeriod =
      narrativeCriticalCount === 0
      && narrativeHighCount === 0
      && newIncidentsLast24h.length === 0
      && (overallRiskLevel || '').toUpperCase() === 'LOW';

    let narratives: Array<{ category: string; narrative: string; signals: any[] }> = [];
    if (isNarrativeQuietPeriod) {
      console.log('[generate-executive-report] narrative quiet-period — using deterministic narratives (no LLM call)');
      // Deterministic per-category narrative consistent with the Flash.
      // If no narrative-eligible categories survive (e.g. only pattern signals
      // existed), emit a single general entry pointing to Signal History so
      // operators still see why the section is sparse.
      narratives = weightedCategories.length > 0
        ? weightedCategories.map(({ category }) => ({
            category,
            narrative: `No significant ${getCategoryDisplay(category).toLowerCase()} activity detected in the reporting period. See Signal History below for detail on lower-severity items.`,
            signals: [],
          }))
        : (patternSignalCount > 0
          ? [{
              category: 'active_threat',
              narrative: `No significant active-threat activity detected in the reporting period. ${patternSignalCount} internal pattern-detector signal(s) were observed (signal-volume meta-metric, not direct threat observations) — see Signal History below for detail.`,
              signals: [],
            }]
          : []);
    } else {
      const narrativesPromises = weightedCategories.map(async ({ category, categorySignals }) => {
        const topSignals = (categorySignals as any[]).slice(0, 5);

        // Belt-and-braces (Approach 3, defensive): even though pattern signals
        // are excluded above, if any pattern signal ever reaches this layer in
        // future, label it explicitly so the LLM doesn't promote signal-volume
        // observations to threat-escalation narrative voice.
        const formatSignalLine = (s: any, i: number) => {
          const isPattern = s.signal_type === 'pattern';
          const patternTag = isPattern ? ' [INTERNAL PATTERN DETECTOR — describes signal volume, not observed threat activity]' : '';
          const dateStr = new Date(s.received_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          return `${i + 1}. [${s.severity?.toUpperCase()}]${patternTag} ${cleanSignalExcerpt(s.normalized_text)} (Source: ${getHostname(s.source_url)}, ${dateStr})`;
        };

        const narrativePrompt = `Write a professional intelligence narrative about ${getCategoryDisplay(category)} threats for ${client.name}. Apply the specialist knowledge and agent assessments below.
${knowledgeContext}
${agentContext}

MANDATORY TRADECRAFT RULES:
- Write ALL surnames of named individuals in CAPITALS (e.g., organizer Richard BROOKS, journalist Danny NUNES)
- Include exact dates for all cited events — never use vague references like "recently"
- State the trajectory for this threat category: ESCALATING, STABLE, or DE-ESCALATING vs last period
- End with a DEDUCTIONS: paragraph that connects this category specifically to ${client.name} operations, reputation, or personnel
- Include one RECOMMENDED ACTION with a specific owner role and timeframe
- If no significant activity occurred in this category during the reporting period, state clearly: "No significant ${category} activity detected in the reporting period." Do not pad with generic content.
- STRICT SOURCE DISCIPLINE: every factual claim must trace to one of the signals listed above — never introduce events, statistics, or context from your training data
- If a signal references a historical event for context, you may mention it was historical — but do not expand on it with details not in the signal
- SIGNAL-VOLUME vs THREAT DISTINCTION: any signal tagged "[INTERNAL PATTERN DETECTOR — describes signal volume, not observed threat activity]" is a meta-observation about how many signals were collected. NEVER use such signals as evidence of escalating threat activity. They may be referenced as "signal volume increased" but never as "threats escalated" or "threats are rising."
- RELEVANCE FILTER: if any signal in the list above is NOT actually relevant to ${client.name} on closer reading — wrong sector, wrong geography, different company, tangential industry news — exclude it from the narrative entirely. Do NOT mention it just to dismiss it ("noted but not directly relevant" / "while this reflects broader dynamics it does not concern us") — that is exactly the filler a sophisticated executive reader will reject. Silent exclusion only.

Signals to analyze:
${topSignals.map(formatSignalLine).join('\n')}
${topSignals.some((s: any) => {
  const eventDate = s.event_date ? new Date(s.event_date) : null;
  return eventDate && (Date.now() - eventDate.getTime()) > 365 * 24 * 60 * 60 * 1000;
}) ? '\nWARNING: Some signals above have event dates older than 1 year. Treat these as historical context only — never as current active threats.' : ''}

Write 2-3 paragraphs of narrative followed by a DEDUCTIONS: paragraph. Use executive-appropriate language. Be specific about names, dates, organizations, and implications for ${client.name}.

LANGUAGE CALIBRATION (consolidated brief-quality ruling — enforce strictly):
- Partnership, equity, consultation, and divestment developments (e.g. a partner selling a stake) are "developments requiring engagement," never threat-framed.
- Report activist/community events neutrally by name and date. Do NOT use "escalating", "intensifying", or similar unless a signal explicitly states it.
- A claim must never exceed its source: reviews are reviews (not approvals), proposals are proposals (not decisions), concerns are concerns (not findings).
- Do NOT name private individuals; reference people by role or community unless they are a public figure acting in a public capacity.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

        const narrativeResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a senior intelligence analyst writing for executives. You apply structured analytical tradecraft (BLUF, SAT, Minto Pyramid) and draw on specialist agent assessments.' },
            { role: 'user', content: narrativePrompt }
          ],
          functionName: 'generate-executive-report',
        });

        return {
          category,
          narrative: applyToneTransformation(narrativeResult.content || 'Analysis unavailable'),
          signals: topSignals
        };
      });

      console.log('Generating detailed narratives...');
      narratives = await Promise.all(narrativesPromises);
    }

    const threatCategories = Object.keys(signalsByCategory);

    // Item 2 (second red-pen): collapse NAAD/CAP awareness items that share
    // event type + area into ONE line with an update count. Distinct CAP ids
    // are updates of one event (e.g. a severe-thunderstorm warning re-issued 7
    // times), not seven events — rendering them as seven awareness lines
    // overstated activity. Non-CAP awareness items pass through individually.
    const awarenessRenderItems: Array<{ title: string; category: string; date: string; count: number }> = (() => {
      const groups = new Map<string, { title: string; category: string; date: string; count: number; event: string; area: string }>();
      const passthrough: Array<{ title: string; category: string; date: string; count: number }> = [];
      for (const s of awarenessSignals as any[]) {
        const cap = (s.raw_json && typeof s.raw_json === 'object') ? s.raw_json.cap : null;
        const event = cap ? String(cap.event || '').trim() : '';
        const area = cap ? String(cap.area_desc ?? cap.areaDesc ?? '').trim() : '';
        const date = String(s.received_at || '').slice(0, 10);
        const category = String(s.category || 'context');
        if (cap && event) {
          const key = `${event.toLowerCase()}|${area.toLowerCase()}`;
          const g = groups.get(key);
          if (g) {
            g.count += 1;
            if (date > g.date) g.date = date; // keep the latest update date
          } else {
            groups.set(key, { title: '', category, date, count: 1, event, area });
          }
        } else {
          passthrough.push({ title: String(s.title || '').trim(), category, date, count: 1 });
        }
      }
      const collapsed = Array.from(groups.values()).map((g) => {
        // "severe thunderstorm warnings, 7 updates, Peace region"
        const evtLabel = /warning|watch|statement|advisory/i.test(g.event) ? g.event : `${g.event} warnings`;
        const areaLabel = g.area ? `, ${g.area}` : '';
        const title = g.count > 1
          ? `${evtLabel}, ${g.count} updates${areaLabel}`
          : `${g.event}${areaLabel}`;
        return { title, category: g.category, date: g.date, count: g.count };
      });
      return [...collapsed, ...passthrough];
    })();

    // Format dates
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    // Generate HTML report with all enhancements
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Executive Intelligence Brief - ${client.name}</title>
  <style>
    @page { margin: 1in 0.9in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #111;
      background: white;
      max-width: 860px;
      margin: 0 auto;
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
    .report-date { font-family: 'Arial', sans-serif; font-size: 9pt; color: #555; }
    .logo-area { text-align: center; margin-bottom: 4pt; }
    .company-name { font-family: 'Arial', sans-serif; font-size: 16pt; font-weight: 700; color: #111; letter-spacing: 2pt; text-transform: uppercase; margin-bottom: 3pt; }
    .report-title { font-family: 'Arial', sans-serif; font-size: 11pt; color: #333; }

    /* EXECUTIVE FLASH */
    .executive-flash {
      border: 1px solid #111;
      padding: 16pt;
      margin: 18pt 0;
    }
    .flash-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid #ccc;
      padding-bottom: 6pt;
      margin-bottom: 10pt;
    }
    .flash-title {
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5pt;
    }
    .flash-confidence {
      font-family: 'Arial', sans-serif;
      font-size: 8pt;
      color: #555;
    }
    .flash-issue {
      font-size: 12pt;
      font-weight: bold;
      margin-bottom: 10pt;
      line-height: 1.4;
    }
    .flash-action {
      border-left: 3pt solid #111;
      padding-left: 10pt;
      margin-bottom: 10pt;
    }
    .flash-action-label {
      font-family: 'Arial', sans-serif;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1pt;
      color: #555;
      margin-bottom: 3pt;
    }
    .flash-action-text { font-size: 10.5pt; }
    .flash-meta {
      display: flex;
      gap: 24pt;
      font-family: 'Arial', sans-serif;
      font-size: 8.5pt;
      color: #333;
      border-top: 1px solid #ccc;
      padding-top: 8pt;
      margin-top: 8pt;
    }
    .flash-meta-item strong { font-weight: 700; }

    /* REPORT META */
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
    .meta-label { text-transform: uppercase; font-weight: 700; color: #666; font-size: 7.5pt; letter-spacing: 0.5pt; margin-bottom: 2pt; }
    .meta-value { color: #111; font-weight: 600; }

    /* SECTIONS */
    .section { margin-bottom: 26pt; }
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
    .subsection-title {
      font-family: 'Arial', sans-serif;
      font-size: 10pt;
      font-weight: 700;
      color: #111;
      margin: 16pt 0 6pt 0;
    }

    /* EXECUTIVE SUMMARY */
    .executive-summary {
      border-left: 3pt solid #111;
      padding-left: 14pt;
      margin: 12pt 0;
      font-size: 10.5pt;
      line-height: 1.7;
    }

    /* RISK TABLE */
    .risk-table {
      width: 100%;
      border-collapse: collapse;
      margin: 12pt 0;
      font-size: 9.5pt;
      font-family: 'Arial', sans-serif;
    }
    .risk-table th {
      border-bottom: 2px solid #111;
      border-top: 1px solid #111;
      padding: 6pt 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 0.5pt;
      background: white;
      color: #111;
    }
    .risk-table td {
      padding: 6pt 8pt;
      border-bottom: 1px solid #ddd;
      vertical-align: top;
    }
    .risk-level { font-weight: 700; font-size: 9pt; text-transform: uppercase; }
    .risk-low { color: #111; }
    .risk-moderate { color: #111; }
    .risk-elevated { color: #111; }
    .risk-high { color: #111; }

    /* INCIDENT TABLE */
    .incident-detail-table {
      width: 100%;
      border-collapse: collapse;
      margin: 12pt 0;
      font-size: 8.5pt;
      font-family: 'Arial', sans-serif;
    }
    .incident-detail-table th {
      border-bottom: 2px solid #111;
      border-top: 1px solid #111;
      padding: 6pt 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 7.5pt;
      letter-spacing: 0.5pt;
      background: white;
      color: #111;
    }
    .incident-detail-table td {
      padding: 6pt 8pt;
      border-bottom: 1px solid #ddd;
      vertical-align: top;
    }
    .incident-detail-table tbody tr:nth-child(even) { background: #f9f9f9; }
    .incident-id-link { font-family: monospace; font-size: 8pt; color: #111; }
    .priority-label { font-weight: 700; font-size: 8.5pt; }
    .system-origin { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.3pt; color: #555; }

    /* IMPACT ANALYSIS */
    .impact-item {
      border-left: 2pt solid #555;
      padding-left: 12pt;
      margin-bottom: 14pt;
    }
    .impact-issue {
      font-weight: 700;
      font-size: 10.5pt;
      margin-bottom: 6pt;
    }
    .impact-row {
      display: flex;
      margin: 4pt 0;
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
    }
    .impact-label {
      width: 130pt;
      font-weight: 600;
      color: #555;
    }
    .impact-value { flex: 1; color: #111; }

    /* ACTION ITEMS */
    .action-item {
      border-top: 1px solid #ddd;
      padding-top: 10pt;
      margin-bottom: 12pt;
    }
    .action-item:first-child { border-top: none; }
    .action-description {
      font-weight: bold;
      font-size: 10.5pt;
      margin-bottom: 6pt;
    }
    .action-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8pt;
      font-family: 'Arial', sans-serif;
      font-size: 8.5pt;
    }
    .action-meta-label { font-weight: 700; color: #555; text-transform: uppercase; font-size: 7.5pt; margin-bottom: 1pt; }
    .action-meta-value { color: #111; }
    .priority-label-critical { font-weight: 700; }
    .priority-label-high { font-weight: 700; }
    .priority-label-medium { font-weight: 600; }

    /* NARRATIVE */
    .narrative-section { margin: 16pt 0 20pt 0; }
    .narrative-text {
      font-size: 10.5pt;
      line-height: 1.7;
      color: #111;
    }

    /* EVIDENCE CITATIONS */
    .evidence-citation {
      border-left: 2pt solid #aaa;
      padding: 6pt 12pt;
      margin: 8pt 0;
      font-family: 'Arial', sans-serif;
      font-size: 8.5pt;
      color: #333;
    }

    /* DEDUCTIONS */
    .deduction-box {
      border-left: 3pt solid #111;
      padding-left: 14pt;
      margin: 12pt 0;
    }
    .deduction-label {
      font-family: 'Arial', sans-serif;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 1pt;
      color: #555;
      margin-bottom: 6pt;
    }
    .deduction-text { font-size: 10.5pt; line-height: 1.7; }

    .footer {
      text-align: center;
      font-family: 'Arial', sans-serif;
      font-size: 7.5pt;
      color: #888;
      padding: 10pt 0;
      border-top: 1px solid #ccc;
      margin-top: 24pt;
    }

    .page-break { page-break-after: always; }
    @media print { .no-print { display: none; } }

    /* ── PRINT / PDF OVERRIDES ─────────────────────────────────────────────
       Forces white background for all elements so the PDF is readable
       regardless of the viewing environment or browser dark-mode settings.
    ──────────────────────────────────────────────────────────────────────── */
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      html, body {
        background: #ffffff !important;
        color: #111111 !important;
      }

      body * {
        background-color: transparent !important;
        color: #111111 !important;
        border-color: #cccccc !important;
      }

      /* Preserve colored elements that should stay dark */
      .executive-flash, .executive-flash * {
        background-color: transparent !important;
        color: #111111 !important;
      }

      /* Risk level text — keep readable */
      .risk-high, .risk-elevated, .risk-moderate, .risk-low { color: #111111 !important; }

      /* Source citation blocks */
      .evidence-block, .evidence-block * {
        background-color: #f8f8f8 !important;
        color: #111111 !important;
      }

      h1, h2, h3, h4, h5, h6 { color: #111111 !important; }

      a { color: #333333 !important; }

      @page { margin: 1.2cm 1.8cm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="classification">SENSITIVE SECURITY INFORMATION</div>
      <div class="report-date">${reportDate}</div>
    </div>
    <div class="logo-area">
      <div class="company-name">Fortress AI</div>
      <div class="report-title">${client.name} – Executive Intelligence Brief</div>
    </div>
  </div>

  <!-- EXECUTIVE FLASH -->
  <div class="executive-flash">
    <div class="flash-header">
      <div class="flash-title">Executive Flash</div>
      <div class="flash-confidence">Confidence: ${executiveFlash.confidence}</div>
    </div>
    <div class="flash-issue">${executiveFlash.mostPressingIssue}</div>
    <div class="flash-action">
      <div class="flash-action-label">Recommended Action</div>
      <div class="flash-action-text">${executiveFlash.recommendedAction}</div>
    </div>
    <div class="flash-meta">
      <div class="flash-meta-item"><strong>Owner:</strong> ${executiveFlash.ownerSuggestion}</div>
      <div class="flash-meta-item"><strong>Timeline:</strong> ${executiveFlash.deadlineUrgency}</div>
      <div class="flash-meta-item"><strong>Risk Level:</strong> ${overallRiskLevel}</div>
      <div class="flash-meta-item"><strong>Trajectory:</strong> ${executiveFlash.trajectory || 'STABLE'} — ${executiveFlash.trajectoryReason || 'Insufficient data for trend comparison'}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">Client</div>
      <div class="meta-value">${client.name}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Reporting Period</div>
      <div class="meta-value">${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Report Generated</div>
      <div class="meta-value">${reportGeneratedAt.toLocaleString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Industry</div>
      <div class="meta-value">${client.industry || 'N/A'}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Signals Analyzed</div>
      <div class="meta-value">${freshSignals.length}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">P1/P2 Incidents</div>
      <div class="meta-value">${p1p2Incidents.length} total (${newIncidentsLast24h.length} new, ${staleOpenIncidents.length} stale)</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <div class="executive-summary">
      ${executiveSummary.split('\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
    </div>
  </div>

  <!-- P1/P2 INCIDENT DETAIL TABLE -->
  ${p1p2Incidents.length > 0 ? `
  <div class="section">
    <h2 class="section-title">P1/P2 Incident Detail</h2>
    <p style="margin-bottom: 12pt; font-size: 10pt; color: #666;">
      <strong>${p1p2Incidents.length}</strong> priority incidents total: 
      <strong style="color: #22c55e;">${newIncidentsLast24h.length}</strong> new (last 24h), 
      <strong style="color: #f97316;">${staleOpenIncidents.length}</strong> stale (&gt;7 days old), 
      <strong>${unknownIncidents.length}</strong> require classification.
    </p>
    <table class="incident-detail-table">
      <thead>
        <tr>
          <th style="width: 80pt;">Incident ID</th>
          <th style="width: 60pt;">Priority</th>
          <th style="width: 60pt;">Age</th>
          <th style="width: 80pt;">System Origin</th>
          <th>Type / Classification Rationale</th>
          <th style="width: 100pt;">Opened At</th>
        </tr>
      </thead>
      <tbody>
        ${incidentsWithAge.slice(0, 10).map(incident => {
          const rationale = incident.incident_classification_rationale?.[0];
          const systemOrigin = rationale?.system_of_origin || 'Unknown';
          const ageLabel = incident.isNew ? 'NEW' : (incident.isStale ? 'STALE' : `${incident.ageDays}d`);
          return `
        <tr>
          <td><span class="incident-id-link">${incident.id.substring(0, 8).toUpperCase()}</span></td>
          <td><span class="priority-label">${incident.priority?.toUpperCase()}</span></td>
          <td style="font-family: Arial, sans-serif; font-size: 8.5pt;">${ageLabel}</td>
          <td><span class="system-origin">${systemOrigin}</span></td>
          <td>
            <strong>${scrubPrivateIndividualNames(incident.title || incident.incident_type || 'Untitled Incident')}</strong><br>
            <span style="font-family: Arial, sans-serif; font-size: 8pt; color: #555;">
              ${scrubPrivateIndividualNames(rationale?.rationale || incident.description || incident.summary || `${incident.incident_type ? incident.incident_type.replace(/_/g, ' ') : 'Security incident'} — under investigation`)}
            </span>
          </td>
          <td style="font-family: monospace; font-size: 8pt;">${incident.openedAtFormatted}</td>
        </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="section">
    <h2 class="section-title">Risk Assessment</h2>
    <p style="font-family: Arial, sans-serif; font-size: 9pt; margin-bottom: 12pt; color: #333;">
      Overall inherent risk rating for ${client.name}: <strong>${overallRiskLevel}</strong>
    </p>

    <table class="risk-table">
      <thead>
        <tr>
          <th>Threat Factor</th>
          <th>Risk Rating</th>
          <th>Signal Count</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Surveillance / Reconnaissance</td>
          <td><span class="risk-level">${getRiskLevel(surveillanceRisk)}</span></td>
          <td>${surveillanceRisk}</td>
        </tr>
        <tr>
          <td>Protest / Activism</td>
          <td><span class="risk-level">${getRiskLevel(protestRisk)}</span></td>
          <td>${protestRisk}</td>
        </tr>
        <tr>
          <td>Work Interruption</td>
          <td><span class="risk-level">${getRiskLevel(workInterruptionRisk)}</span></td>
          <td>${workInterruptionRisk}</td>
        </tr>
        <tr>
          <td>Sabotage / Vandalism</td>
          <td><span class="risk-level">${getRiskLevel(sabotageThreat)}</span></td>
          <td>${sabotageThreat}</td>
        </tr>
        <tr>
          <td>Critical Threats</td>
          <td><span class="risk-level">${getRiskLevel(criticalThreatCount)}</span></td>
          <td>${criticalThreatCount}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- A. INDUSTRY & COMMUNITY AWARENESS (0.30–0.59 relevance — context only) -->
  <!-- Ruling 5: synthesized themed paragraphs (asset-gated), not a raw title list. -->
  ${awarenessSynthesis ? `
  <div class="section">
    <h2 class="section-title">Industry &amp; Community Awareness</h2>
    <p style="font-size:12px;color:#555;margin-bottom:8px;">Lower-relevance regional and sector context for situational awareness only — including client-adjacent items that did not rise to a cited, main-tier threat. No action items, incident references, or risk ratings derive from this section, and nothing here is asserted as a cited fact in the report body.</p>
    ${awarenessSynthesis.split(/\n\n+/).filter((p) => p.trim()).map((p) => `<p style="font-size:13px;line-height:1.6;margin-bottom:8px;">${p.trim().replace(/[<>]/g, '')}</p>`).join('')}
    ${awarenessTotal > awarenessForSynthesis.length ? `<p style="font-size:11px;color:#888;margin-top:6px;">Synthesized from ${awarenessForSynthesis.length} asset-gated context items; the full awareness tier (${awarenessTotal}) is queryable in-platform.</p>` : ''}
  </div>` : ''}

  <!-- IMPACT ANALYSIS -->
  ${impactLadders.length > 0 ? `
  <div class="section">
    <h2 class="section-title">Impact Analysis</h2>
    ${impactLadders.map(ladder => `
    <div class="impact-item">
      <div class="impact-issue">${ladder.issue}</div>
      <div class="impact-row">
        <div class="impact-label">Worst Consequence:</div>
        <div class="impact-value">${ladder.worstConsequence}</div>
      </div>
      <div class="impact-row">
        <div class="impact-label">Earliest Indicator:</div>
        <div class="impact-value">${ladder.earliestIndicator}</div>
      </div>
      <div class="impact-row">
        <div class="impact-label">Mitigation:</div>
        <div class="impact-value">${ladder.mitigation}</div>
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- ACTION ITEMS -->
  ${actionItems.length > 0 ? `
  <div class="section">
    <h2 class="section-title">Action Items & Ownership</h2>
    ${actionItems.map((item, idx) => `
    <div class="action-item">
      <div class="action-description">${idx + 1}. ${item.description}</div>
      <div class="action-meta">
        <div>
          <div class="action-meta-label">Owner</div>
          <div class="action-meta-value">${item.ownerName || item.ownerRole}</div>
        </div>
        <div>
          <div class="action-meta-label">Deadline</div>
          <div class="action-meta-value">${new Date(item.deadline).toLocaleDateString()}</div>
        </div>
        <div>
          <div class="action-meta-label">Priority</div>
          <div class="action-meta-value">${item.priority?.toUpperCase()}</div>
        </div>
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  ${narratives.length > 0 ? `
  <div class="page-break"></div>
  <div class="section">
    <h2 class="section-title">Issues of Specific Concern</h2>
    ${narratives.map(item => `
      <div class="narrative-section">
        <h3 class="subsection-title">${getCategoryDisplay(item.category)}</h3>
        <div class="narrative-text">
          ${item.narrative.split('\n\n').map((p: string) => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
        </div>
        ${item.signals.slice(0, 3).map((signal: any) => `
          <div class="evidence-citation">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4pt;">
              <span style="font-weight: 700; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5pt;">Source: ${((citeLineById.get(signal.id) || '').split(',')[0] || getHostname(signal.source_url) || 'unattributed').replace(/[<>]/g, '')}</span>
              <span style="font-family: monospace; font-size: 7.5pt; color: #666;">${new Date(signal.received_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
            <p style="margin: 0 0 4pt; line-height: 1.5;">
              <strong>${getCategoryDisplay(signal.category || 'signal')}:</strong> ${cleanSignalExcerpt(signal.normalized_text).substring(0, 250) || 'No details available'}
            </p>
            <div style="font-size: 8pt; color: #666;">
              ID: ${signal.signal_number || `SIG-${signal.id.substring(0, 8).toUpperCase()}`}${signal.source_url ? ` — <a href="${signal.source_url}" target="_blank" rel="noopener noreferrer" style="color: #333; text-decoration: underline;">Original Source</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="section">
    <div class="deduction-box">
      <div class="deduction-label">Strategic Deductions</div>
      <div class="deduction-text">
        ${deductions.split('\n\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
      </div>
    </div>
  </div>

  <div class="footer">
    Client: ${client.name} | Effective Date: ${reportDate}<br>
    Copyright © 2026. Fortress AI Security Intelligence Platform. All Rights Reserved.
  </div>
</body>
</html>`;

    // Store report with enhanced metadata
    // WO-DATA-INTEGRITY (2026-07-10): reports must be tenant-owned (AEGIS reads reports by
    // tenant_id). Previously client_id lived ONLY in meta_json and tenant_id was never set →
    // every executive report was an invisible orphan. Set BOTH columns from the (required,
    // access-checked) client. client.tenant_id is guaranteed for a real client.
    const reportTenantId = (client as { tenant_id?: string | null }).tenant_id ?? null;
    if (!reportTenantId) {
      return new Response(JSON.stringify({ error: 'PROVENANCE: client has no tenant_id; cannot write a tenant-owned report.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        type: 'executive_intelligence',
        client_id,
        tenant_id: reportTenantId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        meta_json: {
          client_id,
          client_name: client.name,
          report_generated_at: currentDateTimeISO,
          total_signals: freshSignals.length,
          critical_signals: criticalSignals.length,
          high_signals: highSignals.length,
          p1p2_incidents: p1p2Incidents.length,
          new_incidents_last_24h: newIncidentsLast24h.length,
          stale_open_incidents: staleOpenIncidents.length,
          unknown_incidents: unknownIncidents.length,
          lead_time_advantage: freshSignals.filter(s =>
            new Date(s.received_at) < new Date(reportGeneratedAt.getTime() - 24*60*60*1000)
          ).length,
          overall_risk_level: overallRiskLevel,
          categories: Object.keys(signalsByCategory),
          executive_flash: executiveFlash,
          impact_ladders: impactLadders,
          action_items: actionItems.map(a => ({
            description: a.description,
            owner: a.ownerName || a.ownerRole,
            deadline: a.deadline,
            priority: a.priority
          })),
          executive_summary: executiveSummary,
          deductions,
          narratives: narratives.map(n => ({ category: n.category, narrative: n.narrative })),
          // WO-PROVENANCE-01 — persisted to meta_json (DB column) so the review-queue note is a
          // deterministic figure and the watchdog probe (b) can read meta_json->'review_queue'.
          signals_analyzed: freshSignals.length,
          distinct_citable_publishers: new Set(freshSignals.map((s: any) => citeFor(s).publisherEntity).filter(Boolean)).size,
          review_queue_count: reviewQueueSignals.length,
          review_queue: reviewQueueSignals.map((s: any) => ({
            id: s.id,
            signal_number: s.signal_number,
            relevance: s.relevance_score,
            source: (provById.get(s.source_id)?.publisher_kind || 'unknown'),
            reason: citeFor(s).reason,
          })),
          // Deterministic denominator chain (single unit = signal counts). in_window (cross-client
          // platform total) is analyst-external and intentionally not embedded in a client report.
          denominator_chain: {
            client_gated: chainClientGated,
            quality: chainQuality,
            relevance_main: chainRelevanceMain,
            citable: chainCitable,
            post_dedup: freshSignals.length,
          },
        }
      })
      .select()
      .single();

    if (reportError) throw reportError;

    // Store evidence sources for traceability
    if (report && evidenceSources.length > 0) {
      await supabase.from('report_evidence_sources').insert(
        evidenceSources.slice(0, 50).map(es => ({
          report_id: report.id,
          claim_text: es.claim,
          source_type: es.sourceType,
          source_id: es.sourceId,
          source_title: es.sourceTitle,
          source_url: es.sourceUrl,
          internal_url: es.internalUrl,
          timestamp: es.timestamp,
          confidence_score: es.confidence
        }))
      );
    }

    // Store action items for tracking
    if (report && actionItems.length > 0) {
      await supabase.from('report_action_items').insert(
        actionItems.map(a => ({
          report_id: report.id,
          action_description: a.description,
          owner_id: a.ownerId,
          owner_role: a.ownerRole,
          deadline: a.deadline,
          first_update_due: a.firstUpdateDue,
          priority: a.priority,
          status: 'pending'
        }))
      );
    }

    // Run evidence gate on the final HTML to detect fabricated or uncited content
    let reliabilityScore = 100;
    let gateIssues: string[] = [];
    try {
      const gateSettings = {
        ...DEFAULT_RELIABILITY_SETTINGS,
        max_source_age_hours: 168, // 7 days for weekly reports
        require_min_sources: 3,
        block_unverified_claims: false, // Log only — don't block report delivery
      };
      const evidenceCheck = await runEvidenceGate(supabase, html, [], gateSettings, {
        signalIds: freshSignals.map((s: any) => s.id),
      });
      reliabilityScore = evidenceCheck.reliability_score;
      gateIssues = evidenceCheck.qa_issues;

      if (reliabilityScore < 70) {
        console.warn(`[generate-executive-report] Reliability score: ${reliabilityScore}/100 — ${gateIssues.length} issue(s) detected`);
      }

      // Best-effort log — table may not exist yet
      await supabase.from('report_quality_log').insert({
        report_id: report.id,
        reliability_score: reliabilityScore,
        issues: gateIssues,
        passed: evidenceCheck.passed,
        tested_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});
    } catch (gateErr) {
      console.warn('[generate-executive-report] Evidence gate check failed (non-blocking):', gateErr instanceof Error ? gateErr.message : gateErr);
    }

    console.log(`Enhanced executive report generated successfully. Reliability score: ${reliabilityScore}/100`);

    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.id,
        html,
        metadata: {
          client: client.name,
          period: `${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
          signals_analyzed: freshSignals.length,
          distinct_citable_publishers: new Set(freshSignals.map((s: any) => citeFor(s).publisherEntity).filter(Boolean)).size,
          review_queue_count: reviewQueueSignals.length,
          review_queue: reviewQueueSignals.map((s: any) => ({ id: s.id, signal_number: s.signal_number, relevance: s.relevance_score, source: (provById.get(s.source_id)?.publisher_kind || 'unknown'), reason: citeFor(s).reason })),
          p1p2_incidents: p1p2Incidents.length,
          risk_level: overallRiskLevel,
          executive_flash: executiveFlash,
          action_items_count: actionItems.length,
          categories: Object.keys(signalsByCategory),
          reliability_score: reliabilityScore,
          reliability_issues: gateIssues.length,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating executive report:', error);
    const msg = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error)
        ? String((error as any).message)
        : String(error);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});