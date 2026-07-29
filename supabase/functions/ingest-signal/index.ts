import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.22.4";
import { isFalsePositiveContent } from '../_shared/keyword-matcher.ts';
import { isTestContent, scoreSignalRelevance } from '../_shared/signal-relevance-scorer.ts';
import { callAiGateway, callAiGatewayJson } from '../_shared/ai-gateway.ts';
import { logError } from '../_shared/error-logger.ts';
import { fetchVerifiedRecipientEmails, UNROUTED_RECIPIENT } from '../_shared/alert-tier.ts';
import { coerceOrigin, deriveOrigin } from '../_shared/signal-origins.ts';
import { computeComposite } from '../_shared/signal-scores.ts';
import { enqueueJob } from '../_shared/queue.ts';
import { scoreForeignAlignment, extractMentions } from './foreign-alignment.ts';
import { getCallerIdentity, getAccessibleClientIds } from '../_shared/supabase-client.ts';
import { upsertHostileHandleOnSignal, extractHandleFromRawJson } from '../_shared/hostile-attribution.ts';
import { recordTelemetry } from '../_shared/observability.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const SignalInputSchema = z.object({
  source_key: z.string().optional(),
  event: z.any().optional(),
  text: z.string().min(1).max(5000000).optional(), // Increased to 5MB for large documents
  url: z.string().url().optional(),
  source_url: z.string().url().optional(),  // Canonical URL of the source article
  image_url: z.string().url().optional(),   // Open Graph / thumbnail image
  location: z.string().max(500).optional(),
  raw_json: z.any().optional(),
  is_test: z.boolean().optional(),
  client_id: z.string().uuid().optional(), // snake_case client ID
  clientId: z.string().uuid().optional(),  // camelCase alias (used by QA agent and frontend)
  sourceType: z.string().optional(),       // source type tag (e.g. 'qa_test')
  sourceData: z.any().optional(),          // source metadata
  skip_relevance_gate: z.boolean().optional(), // bypass AI gate when upstream keyword matching already vetted the signal
  // Fallback classification when the AI classifier silently fails (returns
  // empty/unknown). Monitors with known signal types (monitor-wildfires →
  // 'wildfire', NAAD → 'active_threat') should provide these so a classifier
  // outage doesn't collapse the entire feed to category=unknown / sev=medium.
  fallback_category: z.string().optional(),
  fallback_severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  origin: z.string().optional(),           // #79 signal_origin — producer identity (coerced to vocab)
  // F-CRT (2026-05-15) — source platform tag. Used by downstream
  // attribution (hostile_handles uniqueness, dispatch guardrails,
  // platform-scoped analysis). Optional; when present, written to
  // signals.platform on insert.
  platform: z.enum(['x','reddit','instagram','facebook','telegram_public','youtube','rss','other']).optional(),
  // #256 Phase 1 (2026-05-23) — explicit opt-in for tenant-fan-out signals.
  // Schema is accepted in Phase 1 but actual broadcast routing is NOT
  // implemented — broadcast requests return 501 NotImplemented until Phase 3
  // re-introduces a vetted fan-out path. Callers MUST either pass an explicit
  // `client_id` (single-tenant) or `tenant_broadcast` (multi-tenant intent).
  // Object shape (vs boolean) forces an explicit scope declaration; future
  // scopes can extend the enum without breaking callers.
  tenant_broadcast: z.object({
    scope: z.enum(['all_active_tenants']),
    // future Phase 3+: 'tenant_ids' (z.array(z.string().uuid())),
    //                  'tenant_filter' (industry / role / capability),
    //                  'exclude_tenants' (z.array(z.string().uuid())).
  }).optional(),
}).refine(data => data.text || data.event || data.url, {
  message: "Either 'text', 'event', or 'url' must be provided"
});

// Rules-based classification (rules.yaml equivalent)
const RULES = {
  p1: {
    keywords: ['credible threat', 'weapon', 'kidnap', 'active shooter', 'bomb'],
    severity: 'critical',
    priority: 'p1',
    shouldOpenIncident: true
  },
  p2: {
    keywords: ['suspicious', 'prowler', 'tamper', 'breach attempt', 'intrusion'],
    severity: 'high',
    priority: 'p2',
    shouldOpenIncident: true
  }
};

function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  
  // Check P1 rules first
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p1.severity,
        priority: RULES.p1.priority,
        shouldOpenIncident: RULES.p1.shouldOpenIncident,
        matchedRule: 'p1',
        matchedKeyword: keyword
      };
    }
  }
  
  // Check P2 rules
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p2.severity,
        priority: RULES.p2.priority,
        shouldOpenIncident: RULES.p2.shouldOpenIncident,
        matchedRule: 'p2',
        matchedKeyword: keyword
      };
    }
  }
  
  return {
    severity: null,
    priority: null,
    shouldOpenIncident: false,
    matchedRule: null,
    matchedKeyword: null
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    // CORS preflight is unauthenticated by browser-protocol design. Only
    // justified pre-auth exception. Everything else runs behind the gate.
    return new Response(null, { headers: corsHeaders });
  }

  const requestStartedAt = Date.now();
  try {
    // F-026 (2026-05-14) — auth gate at true handler entry. Locked rules:
    //   anonymous (no auth / anon publishable key) → 401
    //   unauthorized (malformed/fake bearer)        → 401 (explicit reject, no downgrade)
    //   service_role                                 → bypass tenant check
    //                                                  (compensating control: caller
    //                                                  inventory documented all 22 of 26
    //                                                  service-role callers in the
    //                                                  F-026 evidence file)
    //   user JWT                                     → must verify body client_id ∈
    //                                                  accessibleClientIds; reject 403 if not
    // Replaces the prior posture (`verify_jwt = false` + no in-function auth),
    // which allowed anonymous cross-tenant signal injection if the attacker
    // knew a target client_id. See docs/audit-evidence/f-026-iteration-6/.
    const caller = await getCallerIdentity(req);
    if (caller.kind === 'unauthorized') {
      return new Response(
        JSON.stringify({ error: caller.error }),
        { status: caller.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (caller.kind === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // F-026 — resolve caller's accessible client_ids if user-tier. Service-role
    // bypasses the per-client check (trusted internal caller; locked compensating
    // control). null = no filter; non-null array = enforce client_id ∈ set.
    const accessibleClientIds: string[] | null =
      caller.kind === 'user' ? await getAccessibleClientIds(supabase, caller.userId) : null;

    // Validate input
    const rawBody = await req.json();

    // Health check endpoint for pipeline tests. Now gated behind auth — no
    // legitimate unauth caller was identified during the F-026 inventory.
    if (rawBody.health_check) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          function: 'ingest-signal',
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const validationResult = SignalInputSchema.safeParse(rawBody);
    
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { source_key, event, text, url, source_url, image_url, location, raw_json, is_test: is_test_input, client_id, clientId: clientIdCamel, skip_relevance_gate, fallback_category, fallback_severity, platform, tenant_broadcast, origin } = validationResult.data;
    // Auto-flag any signal whose source URL points at example.com / qa.test / localhost
    // as is_test=true, regardless of caller. These domains are always test fixtures and
    // must never appear in the production live feed (operators have mistaken them for
    // real intel before — see 2026-04-30 pipeline audit).
    const effectiveSourceUrl = (source_url || url || '') as string;
    const isTestSourceUrl = /^https?:\/\/(?:[\w.-]+\.)?(?:example\.com|qa\.test|localhost)\b/i.test(effectiveSourceUrl);
    const is_test = is_test_input || isTestSourceUrl;
    const explicitClientId = client_id || clientIdCamel || null;
    
    // CRITICAL FIX: Validate explicit client_id if provided
    let validatedExplicitClientId: string | null = null;
    if (explicitClientId) {
      const { data: clientCheck, error: clientCheckError } = await supabase
        .from('clients')
        .select('id, name, status, is_test')
        .eq('id', explicitClientId)
        .maybeSingle();

      // #82 (2026-07-09) — HARDEN the client-check: distinguish a TRANSIENT
      // query error from a GENUINE not-found.
      //
      // Prior code used .single() (which surfaces BOTH "0 rows" AND a real
      // DB/network error as an error) and hard-400'd on either. A transient
      // DB hiccup mid-run therefore looked identical to "invalid client_id"
      // and permanently rejected that client for the whole cycle — silently
      // starving it (the monitor's counter, #90, booked the 400 as failed or
      // even as "created"). Root cause of the cisa-kev → single-client
      // delivery: a per-client validation error that read as "not found."
      //
      // .maybeSingle() separates the two cases:
      //   • genuine 0 rows        → { data: null, error: null }  → permanent 400
      //   • real DB/network error → { error: <set> }             → transient 503
      // A transient failure MUST degrade to "this client fails THIS cycle"
      // (retryable), NEVER a permanent 400. The monitor retries next cycle.
      if (clientCheckError) {
        console.error(`⚠ CLIENT_ID VALIDATION TRANSIENT ERROR for ${explicitClientId}: ${clientCheckError.message ?? clientCheckError}`);
        return new Response(
          JSON.stringify({
            status: 'error',
            reason: 'client_validation_unavailable',
            message: 'Client validation could not be completed (transient). Safe to retry.',
            retryable: true,
          }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!clientCheck) {
        console.error(`⚠ INVALID CLIENT_ID: Provided client_id ${explicitClientId} does not exist`);
        return new Response(
          JSON.stringify({
            error: 'Invalid client_id',
            message: `Client with id ${explicitClientId} not found`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // F-026 — AUTHORIZATION CHECK MUST PRECEDE ALL BUSINESS-RULE CHECKS.
      //
      // Reasoning: the F-026 access gate determines whether the CALLER is
      // permitted to interact with this client_id AT ALL. Any subsequent
      // check that returns information about the client (its status, its
      // name in the error message, its existence as distinct from "not
      // found") is a cross-tenant information disclosure if the caller
      // does not actually own the client.
      //
      // Defect history (caught by F-026 staging Mode 6 validation, #112):
      //   Originally (commit f2965d9c, 2026-05-18) this check ran AFTER
      //   the test-signals-on-active-clients guard at line ~250. A CRT
      //   user sending `is_test=true` + a Petronas `client_id` received
      //   `{"error":"test signals not permitted on active clients",
      //   "message":"Client Petronas Canada has status='active'..."}`
      //   — leaking the existence + name + status of a client outside
      //   the caller's accessible scope, AND skipping the 403 entirely.
      //
      //   Reordered 2026-05-20 (#112) so the F-026 gate fires before any
      //   subsequent guard that could leak client metadata or differential
      //   timing.
      //
      // Service-role callers (accessibleClientIds === null) bypass this
      // check — same as before. Trusted internal caller inventory is in
      // the F-026 evidence record.
      if (caller.kind === 'user' && accessibleClientIds !== null
          && !accessibleClientIds.includes(clientCheck.id)) {
        console.error(`⚠ FORBIDDEN: user ${caller.userId} attempted ingest into client ${clientCheck.id} outside accessible scope`);
        return new Response(
          JSON.stringify({
            error: 'forbidden: client_id outside accessible scope',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // --- Synthetic-client write-seam guard (WO-B, 2026-07-04) -------------
      // REJECT-not-write: a LIVE signal (is_test !== true) must never be written
      // to an is_test client (synthetic / benchmark / QA fixture). This is the
      // single write seam — every signal carries an explicit client_id (required
      // since #256; there is no keyword→client fallback), so guarding HERE catches
      // misroutes from ALL ~73 client-fetching callers, present and future,
      // without touching each monitor. (The client-fetch layer is fragmented:
      // the shared pickActiveClients helper — which already excludes inactive +
      // '_'-prefixed fixtures — has only 3 adopters; ~13 signal-routing monitors
      // fetch clients directly and bypass it. Consolidating them onto the helper
      // is the WO-A follow-on; this guard is the stopgap.)
      //
      // Root cause of the misroute is that benchmark clients carry real
      // keywords/geography and win a routing match (e.g. BCWS wildfire 17a006a2
      // → _benchmark_petronas). Correct re-resolution to the RIGHT real client is
      // WO-A canonical routing — non-trivial, NOT built here. This guard only
      // makes the misroute VISIBLE (misrouted_signals) instead of silently
      // absorbed onto the synthetic client OR silently dropped (the deleter class).
      //
      // Scope note — this is the MISMATCH, not a blanket block: intentional QA
      // writes (is_test === true → inactive test client) are the DESIGNED fixture
      // path enforced by the guard just below, and remain allowed. We reject only
      // a live signal landing on a test client. Monitors never send is_test=true,
      // so this stops 100% of monitor drift while preserving the QA/CIPHER path.
      //
      // Returns 200 (not 4xx/5xx): the caller (monitor / job-worker) acted in
      // good faith and must not 500-and-poison-retry — same poison-queue
      // discipline as the deleter quarantine. The signal is logged-and-not-
      // written, never swallowed. `supabase` here is service-role (line ~152),
      // so the misrouted_signals insert bypasses RLS and always records.
      if (clientCheck.is_test === true && is_test !== true) {
        console.error(`⚠ MISROUTE BLOCKED: live signal routed to is_test client ${clientCheck.name} (${clientCheck.id}) — logging to misrouted_signals, NOT writing`);
        try {
          const { error: logError } = await supabase.from('misrouted_signals').insert({
            intended_client_id: clientCheck.id,
            intended_client_name: clientCheck.name,
            intended_client_is_test: true,
            source_key: source_key ?? null,
            source_url: source_url ?? null,
            signal_text: typeof text === 'string' ? text.slice(0, 4000) : null,
            reason: 'live_signal_to_is_test_client',
            caller_kind: caller.kind ?? null,
            raw_payload: { source_key, source_url, url, location, event, platform, is_test_input, raw_json, explicitClientId },
          });
          if (logError) {
            console.error(`⚠ misrouted_signals LOG FAILED (signal still not written): ${logError.message}`);
          }
        } catch (logErr: any) {
          console.error(`⚠ misrouted_signals LOG THREW (signal still not written): ${logErr?.message}`);
        }
        return new Response(
          JSON.stringify({
            status: 'rejected_misrouted',
            written: false,
            logged: true,
            reason: 'live_signal_to_is_test_client',
            intended_client: clientCheck.id,
            message: `Signal not written: client ${clientCheck.name} is a test/synthetic fixture (is_test=true). Recorded in misrouted_signals. Re-resolution to a real client is handled by canonical routing (WO-A).`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Block test signals against active clients. Until 2026-05-07 the
      // fortress-qa-agent injected synthetic signals into Petronas Canada
      // because is_test=true was permitted on any client. Use a status
      // != 'active' QA client (e.g. _qa_test_client).
      //
      // This check is INTENTIONALLY downstream of F-026 — it only fires
      // for callers that already have access to the target client. A
      // cross-tenant caller is rejected at the F-026 gate above.
      if (is_test === true && clientCheck.status === 'active') {
        console.error(`⚠ TEST SIGNAL BLOCKED: is_test=true cannot target active client ${clientCheck.name} (${clientCheck.id})`);
        return new Response(
          JSON.stringify({
            error: 'test signals not permitted on active clients',
            message: `Client ${clientCheck.name} has status='active'. Use a status='inactive' QA test client instead.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      validatedExplicitClientId = clientCheck.id;
      console.log(`✓ VALIDATED EXPLICIT CLIENT: ${clientCheck.name} (${clientCheck.id}) status=${clientCheck.status}`);
    }

    // #256 Phase 1 (2026-05-23) — TENANT-BOUNDARY CONTRACT (EARLY REJECT)
    // Fires BEFORE the AI classifier, the URL fetcher, the F-034 gates, and
    // any downstream cost. See block comment near the matching block below
    // for full rationale. The reject is positioned here so callers that omit
    // client_id burn ~0 OpenAI tokens and ~0 outbound HTTP — the failure
    // mode is visible and cheap.
    if (!validatedExplicitClientId && !tenant_broadcast) {
      const previewText = (text || JSON.stringify(event) || '').toString().substring(0, 200);
      console.warn(`[#256 Phase 1] REJECTED: signal lacks client_id and tenant_broadcast. source_key=${source_key ?? 'none'} preview="${previewText}"`);
      // Branch 2A.0 — surface contract rejections on the canonical watchdog
      // telemetry source (function_telemetry). P0.4 watchdog rule reads this.
      await recordTelemetry(supabase, {
        functionName: 'ingest-signal',
        durationMs: Date.now() - requestStartedAt,
        status: 'error',
        errorClass: 'other',
        errorMessage: 'contract_rejected:missing_client_id',
        context: {
          rejection_reason: 'missing_client_id',
          ticket: '#256',
          phase: 1,
          source_key: source_key ?? null,
          caller_kind: caller.kind,
        },
      });
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'missing_client_id',
          message: 'client_id is required. Cross-tenant signal scoring was removed 2026-05-23 (#256) — callers must pass an explicit client_id or use tenant_broadcast (Phase 3, not yet implemented).',
          ticket: '#256',
          phase: 1,
          source_key: source_key ?? null,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!validatedExplicitClientId && tenant_broadcast) {
      console.warn(`[#256 Phase 1] tenant_broadcast rejected: routing not yet implemented (scope=${tenant_broadcast.scope})`);
      await recordTelemetry(supabase, {
        functionName: 'ingest-signal',
        durationMs: Date.now() - requestStartedAt,
        status: 'error',
        errorClass: 'other',
        errorMessage: 'contract_rejected:broadcast_not_implemented',
        context: {
          rejection_reason: 'broadcast_not_implemented',
          ticket: '#256',
          phase: 1,
          broadcast_scope: tenant_broadcast.scope,
          source_key: source_key ?? null,
          caller_kind: caller.kind,
        },
      });
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'broadcast_not_implemented',
          message: `tenant_broadcast routing (scope=${tenant_broadcast.scope}) is reserved for #256 Phase 3 and not yet implemented. Until then, pass an explicit client_id.`,
          ticket: '#256',
          phase: 1,
        }),
        { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let signalText = text || JSON.stringify(event);

    // ════════════════════════════════════════════════════════════════════
    // F-034 (2026-05-14) — TRUSTWORTHINESS GOVERNANCE AT INGEST
    // Driven by Phase 1 source-fidelity audit (3/20 PASS pre-remediation).
    // Each rejection here is a structural CRT trust-killer caught at admit.
    // ════════════════════════════════════════════════════════════════════
    const effectiveUrl: string | null = (source_url || url || null) as string | null;
    const effectiveTitle: string = (raw_json?.title || event?.title || (text ? text.slice(0, 200) : '')) as string;

    // F-034.1 — Reject NULL / blank source_url unless it's an inherently-internal
    // signal type. CCCS, NAAD, BCWS, wildfire feeds carry synthesized internal
    // URLs from the monitor — skip_relevance_gate is the signal that the upstream
    // monitor has already vetted provenance. Everything else MUST carry a URL.
    if (!effectiveUrl && !skip_relevance_gate) {
      console.log(`[F-034.1] Reject — null source_url, not pre-vetted: "${signalText.slice(0, 80)}"`);
      return new Response(
        JSON.stringify({ status: 'rejected', reason: 'null_source_url',
          message: 'source_url required for auditable signal provenance' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // F-034.2 — Reject MSN aggregator URLs (paragraph-merger chimeras observed
    // in Phase 1 sample). Future-proof: any aggregator-style host where snippets
    // from unrelated stories share one page.
    if (effectiveUrl && /^https?:\/\/(www\.)?msn\.com\//i.test(effectiveUrl)) {
      console.log(`[F-034.2] Reject — MSN aggregator (paragraph-merger risk): ${effectiveUrl}`);
      return new Response(
        JSON.stringify({ status: 'rejected', reason: 'aggregator_url_not_canonical',
          message: 'aggregator-hosted URLs produce chimeric signals; follow to publisher URL or drop' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // F-034.3 — Reject titles that are paragraph fragments (leading ellipsis,
    // mid-sentence start). 13 such signals in prod before remediation.
    if (effectiveTitle && (effectiveTitle.startsWith('…') || effectiveTitle.startsWith('...'))) {
      console.log(`[F-034.3] Reject — paragraph-fragment title: "${effectiveTitle.slice(0, 80)}"`);
      return new Response(
        JSON.stringify({ status: 'rejected', reason: 'paragraph_fragment_title',
          message: 'title is a mid-sentence snippet, not a coherent headline' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // F-034.4 — Opinion-piece URL patterns cannot carry severity ≥ medium.
    // op-ed columns / letters / editorials are commentary, not operational
    // threats. Phase 1: 4 such signals at severity=high/medium were trust-killers.
    if (effectiveUrl && /\/(opinion|letters|columnists?|editorial)\//i.test(effectiveUrl)) {
      // Force-cap to low rather than reject — opinion content may still have
      // monitoring value at low severity (sentiment tracking).
      if (rawBody.fallback_severity && ['medium','high','critical'].includes(rawBody.fallback_severity)) {
        rawBody.fallback_severity = 'low';
      }
      if (raw_json) {
        (raw_json as any).severity_capped_by_governance = true;
      }
      console.log(`[F-034.4] Severity capped to 'low' (opinion URL): ${effectiveUrl}`);
    }

    // F-034.5 — Source-class consistency by URL host.
    // Phase 1 re-run found that the original twitter-only fix left reddit + threads
    // mislabeled under "google_news_api". Generalize: every recognized social host
    // canonicalizes the source class so attribution doesn't lie.
    if (effectiveUrl && raw_json) {
      const HOST_TO_CLASS: Array<[RegExp, string]> = [
        [/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, 'twitter'],
        [/^https?:\/\/(www\.|old\.|new\.)?reddit\.com\//i, 'reddit'],
        [/^https?:\/\/(www\.)?threads\.com\//i, 'threads'],
        [/^https?:\/\/(www\.)?instagram\.com\//i, 'instagram'],
        [/^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//i, 'facebook'],
        [/^https?:\/\/(www\.)?(t\.me|telegram\.org)\//i, 'telegram'],
        [/^https?:\/\/(www\.)?bsky\.app\//i, 'bluesky'],
        [/^https?:\/\/(www\.)?(tiktok\.com)\//i, 'tiktok'],
      ];
      const claimedSource = (raw_json.source || raw_json.monitor || '').toString().toLowerCase();
      for (const [re, canonical] of HOST_TO_CLASS) {
        if (re.test(effectiveUrl) && !claimedSource.includes(canonical)) {
          (raw_json as any).source = canonical;
          (raw_json as any).source_class_corrected_by_governance = true;
          break;
        }
      }
    }

    // F-034.8 — Reject stale advisories. CCCS feed has re-emitted 10-year-old
    // CVEs (CVE-2016-3714 surfaced as "current" threat intel). Heuristic:
    //   if title or body mentions CVE-YYYY-NNNN and YYYY is ≥ 5 years before
    //   the current year, reject as stale unless skip_relevance_gate is set
    //   (skip path is for analyst-uploaded historical material).
    const STALE_CVE_THRESHOLD_YEARS = 5;
    const cveMatch = (effectiveTitle + ' ' + (signalText ?? '')).match(/CVE-(\d{4})-\d+/i);
    if (cveMatch && !skip_relevance_gate) {
      const cveYear = parseInt(cveMatch[1], 10);
      const currentYear = new Date().getUTCFullYear();
      if (Number.isFinite(cveYear) && (currentYear - cveYear) >= STALE_CVE_THRESHOLD_YEARS) {
        console.log(`[F-034.8] Reject stale CVE — ${cveMatch[0]} (${currentYear - cveYear}y old): "${effectiveTitle.slice(0, 80)}"`);
        return new Response(
          JSON.stringify({ status: 'rejected', reason: 'stale_advisory',
            message: `${cveMatch[0]} is ${currentYear - cveYear} years old; refusing to surface as current threat intel` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // F-034.9 — Reject "no results found" signals. multi_platform_search has
    // admitted signals where the content itself reports the search returned
    // nothing actionable. These are platform-state metadata, not intel.
    const NULL_RESULT_PATTERNS = [
      /search\s+results?\s+indicate\s+no\s+(recent\s+)?(information|results?|signals?|news|data)/i,
      /no\s+(recent\s+)?(information|results?|signals?|news|data)\s+(found|available)/i,
      /search\s+found\s+nothing\s+(actionable|relevant)/i,
    ];
    const fullContentForNullCheck = `${effectiveTitle}\n${signalText ?? ''}`;
    if (!skip_relevance_gate && NULL_RESULT_PATTERNS.some((re) => re.test(fullContentForNullCheck))) {
      console.log(`[F-034.9] Reject — null-result signal (search reported nothing actionable): "${effectiveTitle.slice(0, 80)}"`);
      return new Response(
        JSON.stringify({ status: 'rejected', reason: 'null_result_signal',
          message: 'signal content reports the search itself found nothing; not actionable intelligence' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // F-034.7 — Relevance score scale normalization. Phase 1 found 222 rows
    // in 0-1 range and 85 rows in 0-N integer range mixed in the same feed,
    // produced by monitors that pass keyword-matcher raw integer scores
    // (e.g. monitor-canadian-sources → match.score is keyword-length-sum).
    // Canonical scale is 0-1. Anything above 1.0 is normalized via
    // min(score / 100, 1.0); the original raw value is preserved for audit.
    if (raw_json && typeof (raw_json as any).relevance_score === 'number') {
      const orig = (raw_json as any).relevance_score as number;
      if (orig > 1.0) {
        (raw_json as any).relevance_score_raw = orig;
        (raw_json as any).relevance_score = Math.min(orig / 100, 1.0);
        (raw_json as any).relevance_score_normalized_by_governance = true;
      }
    }

    // EARLY REJECTION: Check for false positive content patterns
    if (isFalsePositiveContent(signalText)) {
      console.log(`[FP Filter] Rejecting false positive signal: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({ 
          status: 'rejected',
          reason: 'false_positive_pattern',
          message: 'Content matches known false positive pattern'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // EARLY REJECTION: Check for test/verification content
    if (isTestContent(signalText)) {
      console.log(`[Test Filter] Rejecting test content: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({ 
          status: 'rejected',
          reason: 'test_content',
          message: 'Test/verification content rejected from production pipeline'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let signalLocation = location || null;
    let signalRaw = raw_json || event || { text: signalText };
    // Ensure source_url is always accessible inside raw_json (UI reads from both places)
    if (source_url && !signalRaw.source_url) signalRaw = { ...signalRaw, source_url };

    // Tier 1A: per-client first-time-seen tracking (Splunk Cookbook recipe).
    // Record the source_domain and source_key observations; attach novelty
    // metadata to raw_json so review-signal-agent and operators can see
    // whether this signal is from a brand-new source for this client. Best
    // effort — failures here MUST NOT block ingest.
    //
    // 2026-05-10 fix: previously referenced `clientId` here, but `clientId`
    // is `let`-declared at line ~587 — TDZ violation threw "Cannot access
    // 'clientId' before initialization" on every ingest, breaking the
    // benchmark and the live signal pipeline silently. Use the request-
    // body values (client_id snake or clientIdCamel) instead — those are
    // already destructured at line 133 and stable here.
    const noveltyClientId = client_id || clientIdCamel || null;
    if (noveltyClientId) {
      try {
        const { recordObservation, extractDomain } = await import('../_shared/observation-baselines.ts');
        const domain = extractDomain(source_url) ?? extractDomain(signalRaw?.source_url);
        const noveltyMeta: Record<string, unknown> = {};
        if (domain) {
          noveltyMeta.domain = await recordObservation(supabase, noveltyClientId, 'source_domain', domain);
        }
        if (source_key) {
          noveltyMeta.source_key = await recordObservation(supabase, noveltyClientId, 'source_key', source_key);
        }
        if (Object.keys(noveltyMeta).length > 0) {
          signalRaw = { ...signalRaw, novelty: noveltyMeta };
        }
      } catch (noveltyErr) {
        console.warn('[Novelty] non-blocking error:', noveltyErr instanceof Error ? noveltyErr.message : noveltyErr);
      }
    }
    
    // If URL is provided, fetch and analyze the website
    if (url) {
      console.log('Fetching website content from:', url);
      
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        
        const websiteResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOCBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        if (!websiteResponse.ok) {
          throw new Error(`Failed to fetch website: ${websiteResponse.status}`);
        }

        const html = await websiteResponse.text();
        
        // Improved content extraction
        let textContent = html
          // Remove scripts, styles, and comments
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          // Remove navigation, headers, footers
          .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
          .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
          .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
          // Extract main content preferentially
          .replace(/<(main|article)[^>]*>([\s\S]*?)<\/(main|article)>/gi, (match, tag, content) => {
            return '\n\n' + content + '\n\n';
          });
        
        // Now strip remaining HTML and clean up
        textContent = textContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Take more content for better analysis
        const contentForAnalysis = textContent.substring(0, 8000);

        console.log(`Extracted ${contentForAnalysis.length} characters from website`);

        // Enhanced AI analysis with better prompting (resilient)
        const analysisResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a corporate security intelligence analyst specializing in threat assessment. Analyze web content for security-relevant information including:
- Direct threats or security incidents
- Activist campaigns or protests targeting corporations
- Legal disputes or regulatory actions
- Operational disruptions or risks
- Reputation threats or negative publicity
- Supply chain or infrastructure vulnerabilities

Provide a structured, actionable summary focused on business impact.`
            },
            {
              role: 'user',
              content: `Analyze this content from ${url}

CONTENT:
${contentForAnalysis}

Provide a clear summary including:
1. KEY FINDINGS: What security-relevant events or threats are described?
2. AFFECTED PARTIES: Which companies, organizations, or projects are mentioned or impacted?
3. THREAT LEVEL: Rate as CRITICAL, HIGH, MEDIUM, or LOW
4. BUSINESS IMPACT: What are the potential operational, legal, or reputational consequences?
5. ACTIONABLE INTEL: What specific details (dates, locations, actors, tactics) are relevant for security teams?

Be specific and concise. Focus on facts, not speculation.`
            }
          ],
          functionName: 'ingest-signal',
          extraBody: { max_completion_tokens: 1200 },
          dlqOnFailure: true,
          dlqPayload: { url, signalText: signalText.substring(0, 500) },
        });

        const analysis = analysisResult.content || '';
        
        signalText = `Website Analysis - ${url}\n\n${analysis}`;
        signalLocation = url;
        signalRaw = {
          url,
          analysis,
          snippet: textContent.substring(0, 500),
          scannedAt: new Date().toISOString()
        };

        console.log('Website analysis complete:', analysis.substring(0, 200));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error fetching/analyzing website:', error);
        signalText = `Failed to scan website ${url}: ${errorMessage}`;
        signalRaw = { url, error: errorMessage };
      }
    }
    
    console.log('Ingesting signal:', signalText.substring(0, 100));

    let sourceId = null;
    
    // If source_key provided, validate source. Note: the sources
    // table has a `status` text column, not an `is_active` boolean
    // — this path was dormant until cyber-advisory monitors started
    // passing source_key in May 2026.
    if (source_key) {
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .select('id, status')
        .eq('name', source_key)
        .single();

      if (sourceError || !source) {
        console.error('Source not found:', source_key, sourceError?.message);
        return new Response(
          JSON.stringify({ error: 'Source not found or inactive' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (source.status !== 'active') {
        return new Response(
          JSON.stringify({ error: `Source ${source_key} status=${source.status}` }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      sourceId = source.id;
    }

    // ─── #120 Phase 1 — REGRESSION GUARD: external signal attribution invariant ───
    // Goal: prevent new externally-sourced signals from landing silently without
    // source attribution. "Aegis confidently citing junk destroys trust faster than
    // missing marginal signals" — un-attributed external signals are exactly that.
    //
    // Modes:
    //   Always-on: emit a console.warn marker that watchdogs / log aggregators
    //   can grep for ("EXTERNAL_UNATTRIBUTED"). Makes silent drift observable.
    //
    //   Env-gated strict block: when INGEST_STRICT_SOURCE_ATTRIBUTION=true is set,
    //   reject any external signal (source_url present, not example.com, not test)
    //   that arrives without a resolvable source_id. Default OFF so the current
    //   broken paths (#125 — 280 other_external signals, monitor-cisa-kev's
    //   re-processing-path bug) don't immediately 4xx. Flip to true once #125
    //   audits each monitor.
    const externalUrl = source_url || url || null;
    if (
      sourceId === null &&
      externalUrl &&
      !externalUrl.includes('example.com') &&
      !externalUrl.includes('qa.test') &&
      is_test_input !== true
    ) {
      console.warn(
        `[ingest-signal] EXTERNAL_UNATTRIBUTED — source_id null, source_url=${externalUrl.substring(0, 120)} ` +
        `source_key=${source_key ?? 'NOT_PROVIDED'} client_id=${client_id ?? clientIdCamel ?? 'NOT_PROVIDED'}`
      );
      if (Deno.env.get('INGEST_STRICT_SOURCE_ATTRIBUTION') === 'true') {
        return new Response(
          JSON.stringify({
            error: 'External signal blocked: missing source attribution',
            message: 'Signals with source_url must pass a source_key that matches a registered sources row. Set source_key, register the source in the sources table, or set INGEST_STRICT_SOURCE_ATTRIBUTION=false to bypass this guard.',
            source_url: externalUrl,
            source_key_provided: source_key ?? null,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 1: Apply rules-based classification
    const rulesResult = applyRules(signalText);
    console.log('Rules matched:', rulesResult);
    
    // Step 2: Enhance with AI classification (resilient)
    let classification = {
      normalized_text: signalText,
      entity_tags: [],
      location: signalLocation,
      category: 'unknown',
      severity: rulesResult.severity || 'medium',
      confidence: 0.5
    };

    // #130 Phase 0B — tenant-scope few-shot feedback to prevent cross-tenant
    // ML contamination of signal classification. Resolve the incoming signal's
    // tenant_id via its client (if known). Fail-closed: if tenant cannot be
    // resolved (matching-mode signal where client_id isn't yet derived), skip
    // few-shot entirely — better to lose calibration than contaminate
    // classification with another tenant's feedback notes.
    let fewShotTenantId: string | null = null;
    if (explicitClientId) {
      const { data: fewShotClientRow } = await supabase
        .from('clients')
        .select('tenant_id')
        .eq('id', explicitClientId)
        .maybeSingle();
      fewShotTenantId = fewShotClientRow?.tenant_id ?? null;
    }

    // Fetch analyst feedback for severity calibration (few-shot injection)
    // Reads from feedback_events joined to signals — tenant-scoped per #130 Phase 0B
    let fewShotBlock = '';
    let fewShotTelemetry: { state: string; tenant_id: string | null; examples: number } = {
      state: 'unknown', tenant_id: fewShotTenantId, examples: 0,
    };
    try {
      // #130 Phase 0B: skip few-shot entirely if no tenant context (fail-closed)
      if (!fewShotTenantId) {
        fewShotTelemetry = { state: 'skipped_no_tenant', tenant_id: null, examples: 0 };
        console.log(`[#130 telemetry] ingest-signal few_shot=skipped reason=no_tenant_context`);
      } else {
      // PostgREST inner-join scopes feedback to signals owned by THIS tenant.
      // This is the marker-provable tenant isolation gate.
      const { data: feedbackEvents } = await supabase
        .from('feedback_events')
        .select('feedback, notes, correction, object_id, signals!inner(tenant_id)')
        .eq('object_type', 'signal')
        .eq('signals.tenant_id', fewShotTenantId)
        .in('feedback', ['irrelevant', 'wrong_severity', 'confirmed'])
        .not('notes', 'is', null)
        .order('created_at', { ascending: false })
        .limit(8);

      if (feedbackEvents && feedbackEvents.length > 0) {
        // Fetch the signal titles for context
        const signalIds = feedbackEvents.map((e: any) => e.object_id).filter(Boolean);
        const { data: signalTitles } = signalIds.length > 0
          ? await supabase.from('signals').select('id, title, severity, category').in('id', signalIds)
          : { data: [] };
        const titleMap = Object.fromEntries((signalTitles || []).map((s: any) => [s.id, s]));

        const examples = feedbackEvents
          .map((ex: any) => {
            const sig = titleMap[ex.object_id];
            if (!sig) return null;
            if (ex.feedback === 'irrelevant') return `- IRRELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ''}`;
            if (ex.feedback === 'wrong_severity') return `- SEVERITY CORRECTION [${sig.severity} → ${ex.correction || '?'}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ''}`;
            if (ex.feedback === 'confirmed') return `- CONFIRMED RELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"`;
            return null;
          })
          .filter(Boolean);

        if (examples.length > 0) {
          fewShotBlock = '\n\nANALYST CALIBRATION EXAMPLES (learn from these real corrections):\n' + examples.join('\n');
          fewShotTelemetry = { state: 'applied', tenant_id: fewShotTenantId, examples: examples.length };
          console.log(`[#130 telemetry] ingest-signal few_shot=applied tenant=${fewShotTenantId} examples=${examples.length}`);
        } else {
          fewShotTelemetry = { state: 'applied_empty', tenant_id: fewShotTenantId, examples: 0 };
          console.log(`[#130 telemetry] ingest-signal few_shot=applied_empty tenant=${fewShotTenantId} (no tenant-local feedback yet)`);
        }
      } else {
        fewShotTelemetry = { state: 'applied_empty', tenant_id: fewShotTenantId, examples: 0 };
        console.log(`[#130 telemetry] ingest-signal few_shot=applied_empty tenant=${fewShotTenantId} (query returned 0)`);
      }
      } // close `if (fewShotTenantId)` from #130 Phase 0B
    } catch (err) {
      fewShotTelemetry = { state: 'error', tenant_id: fewShotTenantId, examples: 0 };
      console.warn(`[#130 telemetry] ingest-signal few_shot=error tenant=${fewShotTenantId} err=${err instanceof Error ? err.message : String(err)}`);
    }

    const classResult = await callAiGatewayJson({
      model: 'gpt-4o-mini',
      // #130 Phase 0B observation — annotate telemetry with few-shot state
      // so we can measure the calibration-quality tradeoff from fail-closed
      // skipping when explicitClientId is absent (matching-mode signals).
      extraContext: {
        few_shot_state: fewShotTelemetry.state,
        few_shot_tenant_id: fewShotTelemetry.tenant_id,
        few_shot_examples: fewShotTelemetry.examples,
        explicit_client_id_provided: !!explicitClientId,
      },
      messages: [
        {
          role: 'system',
          content: `You are a PECL (Physical, Environmental, Cyber, Legal) security intelligence classifier for a corporate protective intelligence platform.

Extract the following fields as JSON:
- normalized_text: clean, factual one-paragraph summary of the event
- entity_tags: array of named entities (people, orgs, locations, IPs, domains, project names)
- location: specific geographic location if mentioned
- category: one of — active_threat, protest, sabotage, physical_threat, trespass, surveillance, wildfire, hazmat, flood, natural_disaster, malware, phishing, intrusion, data_exfil, ddos, ransomware, regulatory, litigation, compliance, injunction, activism, social_sentiment, crime, document_upload, insider_threat, other
- severity: critical | high | medium | low (see rules below)
- confidence: 0-100
- event_date: ISO 8601 date (YYYY-MM-DD) of WHEN THE EVENT OCCURRED — extract from text clues, not crawl date
- is_historical: true if event occurred >90 days ago

SEVERITY RUBRIC (ANCHORED — grade the CLIENT IMPACT, not the drama of the world-event):
- critical: imminent threat to LIFE or to CRITICAL INFRASTRUCTURE — active sabotage in progress, ongoing breach of client systems, credible imminent attack on client people/sites/operations.
- high: DIRECT threat to client-class assets or operations requiring near-term (days) response — planned direct action against the client's sites/corridors within ~7 days, a serious legal/regulatory order directly affecting client operations, an active malware campaign specifically targeting the client or its named systems.
- medium: relevant but not an imminent client threat — activist monitoring, routine regulatory filings, general sector cyber indicators, planned protest >7 days out. NEWS COVERAGE OF A DISTANT EVENT IS MEDIUM AT MOST unless it has a concrete client pathway (proximity to client assets/corridors, named client systems, direct supply-chain/personnel impact). A severe event happening far away, reported in the news, is NOT a high/critical signal for THIS client.
- low: historical (>90 days), informational/background, geopolitical context with no client nexus, general-interest coverage.

DISTRIBUTION EXPECTATION: severity must discriminate. A healthy feed is PYRAMID-SHAPED — the large majority of signals are low or medium, high is uncommon, critical is rare. If you are assigning high/critical to most items (especially news coverage), you are grading world-event drama, not client impact — step down. Grade what this means for the CLIENT, not how dramatic the headline is. The analyst-calibration examples below (if present) SUPPLEMENT this rubric; the rubric is the foundation and holds even with zero examples.

CATEGORY GUIDANCE:
- active_threat: Use for ongoing or imminent threats requiring immediate attention (violence, active sabotage, credible attack)
- insider_threat: ONLY for individuals with a direct employment, contractor, or privileged access relationship to the client organization. Public activists, protesters, Indigenous land defenders, journalists, and named individuals WITHOUT a direct employment or access relationship to the client are NEVER insider threats — classify them as active_threat, protest, activism, or social_sentiment instead.
- social_sentiment: Use for aftermath/recovery coverage, public reactions, and ongoing media attention to a past event (e.g. shooting victim updates weeks after the incident)
- protest / activism: Use for Indigenous land defense actions, pipeline opposition, environmental campaigns, direct action by external parties

TEMPORAL RULES:
- Extract the ACTUAL event date, not publication date
- Historical signals (>90 days old) MUST be severity "low" unless actively resurging
- Past years (2019-2024) = is_historical true${fewShotBlock}

TITLE AND NORMALIZATION RULES:
- The normalized_text must be a faithful compression of what the source actually says — not an interpretation
- Never attribute a role or position to a named individual unless that role is explicitly stated in the source text
- If the source mentions a person in a different context (their new company, a past role, a passing reference), do not reframe them in any other role
- If the source is about Company A and merely mentions Person X who previously worked at Company B, the normalized_text is about Company A — not about Person X's role at Company B
- If uncertain whether a claim appears in the source, omit it from normalized_text entirely

Respond ONLY with valid JSON.`
        },
        { role: 'user', content: signalText }
      ],
      functionName: 'ingest-signal',
      dlqOnFailure: true,
      dlqPayload: { signalText: signalText.substring(0, 500) },
    });

    if (classResult.data) {
      // 2026-05-08 source-fidelity: when the input is scraped news (Google
      // News API or RSS), preserve the verbatim title+snippet as
      // normalized_text. gpt-4o-mini was generating prose from background
      // knowledge that didn't match the source URL — 50% drift rate
      // observed in May 8 audit. Classification fields (category, severity,
      // entities) are still LLM-derived, but the rendered prose is now
      // directly traceable to what was scraped.
      const sourceTag = String(signalRaw?.source || raw_json?.source || '');
      // Sources that ship pre-structured verbatim content (we want
      // operators to read the source's own words, not LLM
      // re-interpretation). Originally just news/RSS to fix the May 8
      // 50%-drift problem; extended to GitHub Code Search after May 8
      // false-positive audit (LLM was rewriting the monitor's own
      // structured "GitHub Credential Exposure" text into vague
      // "may have been exposed" prose).
      const isScrapedNews =
        sourceTag === 'google_news_api' ||
        sourceTag === 'rss' ||
        sourceTag === 'rss_feed' ||
        sourceTag === 'GitHub Code Search';
      const llmFields = isScrapedNews
        ? { ...classResult.data, normalized_text: signalText }
        : classResult.data;
      classification = { ...classification, ...llmFields };
      // Normalize confidence to 0-1 range
      if (classResult.data.confidence && classResult.data.confidence > 1) {
        classification.confidence = classResult.data.confidence / 100;
      }
      // Floor confidence for pre-vetted signals (skip_relevance_gate) — AI sometimes returns
      // near-zero decimal confidence for these, which is misleading. The gate bypass itself
      // means the upstream monitor already validated the signal.
      if (skip_relevance_gate && classification.confidence < 0.75) {
        classification.confidence = 0.80;
      }
      // Keep rules-based severity if matched
      if (rulesResult.severity) {
        classification.severity = rulesResult.severity;
      }
      // ═══ HISTORICAL CONTENT GUARDRAIL AT INGESTION ═══
      // If AI identifies this as historical content, force severity to low
      if (classResult.data.is_historical === true) {
        console.log(`[HISTORICAL GUARDRAIL] AI classified signal as historical — forcing severity to low`);
        if (!rulesResult.severity) {
          classification.severity = 'low';
        }
      }
    } else if (classResult.error) {
      // The classifier returned no data (gateway failure, JSON parse fail,
      // empty content). Without this log the failure is invisible — the May
      // 2026 'unknown-category flood' regression went unnoticed for hours
      // because there was no surface for "AI didn't classify this."
      console.warn(`[Classifier] AI classification failed: ${classResult.error}. signalText="${signalText.substring(0, 120)}"`);
    }

    // ═══ FALLBACK CLASSIFICATION ═══
    // When AI silently fails, monitors with known signal types provide
    // fallback_category / fallback_severity so the feed doesn't collapse to
    // unknown/medium. A classifier outage shouldn't strip every wildfire
    // detection of its category.
    if (classification.category === 'unknown' && fallback_category) {
      console.log(`[Classifier Fallback] Using fallback_category=${fallback_category} for monitor-supplied signal`);
      classification.category = fallback_category;
      if (fallback_severity && !rulesResult.severity) {
        classification.severity = fallback_severity;
      }
      // Confidence floor: fallback came from a monitor that knows what it
      // detected, treat as high-trust enough to not get rejected as noise.
      if (classification.confidence < 0.70) {
        classification.confidence = 0.75;
      }
    }

    // ═══ UNKNOWN-CATEGORY REJECTION ═══
    // The AI classifier has 25 categories including a generic "other". A `category=unknown`
    // result means the AI failed entirely or returned malformed JSON — we have no signal
    // about what this is. Default behaviour was to ingest as severity=medium/category=unknown,
    // which is the largest single source of feed noise. Reject instead. Skipped for
    // skip_relevance_gate (analyst uploads) and rules-matched signals (P1/P2 keywords already
    // give us the priority). qa_test signals are also passed through so QA can verify.
    const isQaTestForCategory = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || is_test === true;
    if (
      classification.category === 'unknown' &&
      !rulesResult.severity &&
      !skip_relevance_gate &&
      !isQaTestForCategory
    ) {
      console.log(`[Category Filter] Rejecting uncategorizable signal: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'uncategorizable',
          message: 'AI classifier could not assign a category — signal lacks structure to be actionable intelligence'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Match signal to clients using keyword and AI-powered matching
    let clientId: string | null = validatedExplicitClientId || null; // Use validated explicit client_id if provided
    let matchedKeywords: string[] = [];
    let matchConfidence: 'explicit' | 'high' | 'medium' | 'low' | 'ai' | 'none' = 'none';
    
    // #256 Phase 1 (2026-05-23) — TENANT-BOUNDARY CONTRACT HARDENING
    //
    // BACKGROUND
    //   The prior cross-tenant scoring loop (formerly at this site, removed
    //   2026-05-23) read ALL clients across ALL tenants without a tenant
    //   filter, scored each on keyword/asset/location match against the
    //   inbound signal text, and assigned the signal to the single highest-
    //   scoring client. This silently misattributed signals when multiple
    //   tenants had overlapping keywords — empirical proof: 3 prod CISA-KEV
    //   signals from monitor-threat-intel all landed in Petronas Canada
    //   despite being generic infrastructure CVEs. The "losing" tenants
    //   silently never saw signals they had legitimate interest in.
    //
    // NEW CONTRACT (Aaron-approved, Option D, 2026-05-23)
    //   Default: reject any signal arriving with neither `client_id` nor
    //   `tenant_broadcast`. The reject fires EARLY (right after explicit
    //   client_id validation, before any AI / URL-fetch / F-034 work) —
    //   see the early-reject block at ~line 278. By the time we reach this
    //   site, `validatedExplicitClientId` is guaranteed truthy.
    //
    //   Phase 3 will introduce broadcast routing for legitimate fan-out
    //   feeds. In Phase 1, broadcast is accepted at the schema layer but
    //   the routing is not implemented; broadcast requests return 501.
    //
    //   The old scoring loop is REMOVED entirely (not gated by a flag) so
    //   it cannot accidentally come back. To re-introduce ambiguous matching
    //   would require an intentional new feature, not a flag flip.
    console.log(`✓ EXPLICIT CLIENT: Using validated client_id ${validatedExplicitClientId}`);
    matchedKeywords.push('explicit_client_override');
    matchConfidence = 'explicit';

    // (#256 Phase 1 — pre-#256 cross-tenant scoring + AI-match loop deleted
    //  2026-05-23. See block comment above for context. Any future
    //  multi-tenant fan-out must go through Phase 3 broadcast routing.)

    // Calculate content hash BEFORE insertion for duplicate detection.
    // Hash on source_url when available — AI paraphrases snippet text each run, so
    // text-based hashes diverge even for the same article. URL is the stable identifier.
    const encoder = new TextEncoder();
    const contentToHash = source_url ? `url:${source_url}` : signalText;
    const data = encoder.encode(contentToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');

    console.log(`Calculated content hash: ${contentHash.substring(0, 16)}... (basis: ${source_url ? 'source_url' : 'text'})`);
    
    // Check if this content was previously rejected/deleted by user
    // Skip for qa_test signals so repeated QA runs always reach the relevance gate
    const isQaTestEarly = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test';
    const { data: rejectedHash } = isQaTestEarly ? { data: null } : await supabase
      .from('rejected_content_hashes')
      .select('id')
      .eq('content_hash', contentHash)
      .limit(1)
      .maybeSingle();

    if (rejectedHash) {
      console.log(`[Rejected] Signal blocked - content was previously rejected/deleted`);
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'previously_rejected',
          message: 'This content was previously deleted or marked irrelevant by an analyst'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // For qa_test sources, skip near-dedup so the signal always reaches the relevance gate.
    // This allows QA tests to reliably verify both ingest and filter behaviour.
    const isQaTest = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || rawBody?.is_test === true || is_test === true;

    // CVE dedup: if the signal text contains a CVE ID, check if we already have a signal
    // for that CVE today. This prevents the same advisory being filed every 15 minutes.
    //
    // #82 (2026-07-09) — CLIENT-SCOPED. This dedup was previously GLOBAL (no
    // client_id filter): the FIRST client to receive a KEV CVE on a given day
    // won it, and every OTHER client with the same CVE was `duplicate_cve`-
    // filtered — the exact root cause of monitor-cisa-kev delivering each CVE to
    // only ONE tenant (Petronas, processed after BC Place/Cascade, got 0). A CVE
    // relevant to N clients is N legitimate client-scoped signals. This is the
    // sibling of the Finding-1.2 URL/title client-scoping, which missed this
    // fourth (cve_id) dedup layer.
    //
    // NULL-client semantics (explicit): clientless signals dedup only within the
    // clientless bucket (client_id IS NULL), never against client-scoped rows.
    // `.eq('client_id', null)` matches NOTHING in Postgres, so we branch to
    // `.is('client_id', null)` — otherwise orphan dedup silently breaks. (Per
    // #256, clientId is normally non-null here; the NULL branch is a defensive
    // floor for any future clientless path.)
    if (!isQaTest) {
      const cveMatch = signalText.match(/CVE-\d{4}-\d+/gi);
      const cveIds = cveMatch ? [...new Set(cveMatch.map((c: string) => c.toUpperCase()))] : [];
      if (cveIds.length > 0) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let cveDedupQuery = supabase
          .from('signals')
          .select('id, title')
          .gte('created_at', todayStart.toISOString())
          .or(cveIds.map((cve: string) => `title.ilike.%${cve}%,normalized_text.ilike.%${cve}%`).join(','));
        cveDedupQuery = clientId ? cveDedupQuery.eq('client_id', clientId) : cveDedupQuery.is('client_id', null);
        const { data: existingCve } = await cveDedupQuery.limit(1);
        if (existingCve && existingCve.length > 0) {
          console.log(`[CVE-dedup] Duplicate CVE advisory blocked: ${cveIds.join(', ')} already filed as signal ${existingCve[0].id}`);
          return new Response(
            JSON.stringify({
              filtered: true,
              reason: 'duplicate_cve',
              cve_ids: cveIds,
              existing_signal_id: existingCve[0].id,
              message: `CVE advisory already ingested today: ${cveIds.join(', ')}`,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Fast URL-based dedup: if we've already ingested this URL in the last 30 days, skip.
    // This catches repeated monitor runs returning the same article with different snippet text.
    if (source_url && !isQaTest) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existingByUrl } = await supabase
        .from('signals')
        .select('id')
        .eq('source_url', source_url)
        .eq('client_id', clientId)   // Finding-1.2: client-scope the dedup — a URL for client A must not suppress client B's copy
        .gte('created_at', thirtyDaysAgo)
        .limit(1)
        .maybeSingle();
      if (existingByUrl) {
        console.log(`[URL-dedup] Duplicate source URL blocked: ${source_url}`);
        return new Response(JSON.stringify({
          status: 'suppressed',
          reason: 'duplicate_url',
          existing_signal_id: existingByUrl.id
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Title-based dedup: if the exact same title was ingested in the last 24h, skip.
    // Catches social monitors finding the same tweet/post across repeated runs when
    // the source_url varies (search result URL vs permalink).
    if (!isQaTest && signalText) {
      const titleLine = signalText.split('\n')[0].trim().substring(0, 200);
      if (titleLine.length > 20) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: existingByTitle } = await supabase
          .from('signals')
          .select('id')
          .ilike('title', `%${titleLine.substring(0, 80)}%`)
          .eq('client_id', clientId)   // Finding-1.2: client-scope the dedup — a title for client A must not suppress client B's copy
          .gte('created_at', oneDayAgo)
          .limit(1)
          .maybeSingle();
        if (existingByTitle) {
          console.log(`[Title-dedup] Duplicate title blocked: "${titleLine.substring(0, 60)}..."`);
          return new Response(JSON.stringify({
            status: 'suppressed',
            reason: 'duplicate_title',
            existing_signal_id: existingByTitle.id
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // Check for duplicates BEFORE insertion
    // - Use normalized_text for near-duplicate detection (more stable than raw text)
    // - Scope to the matched client
    // - Enforce near-duplicate blocking at 80% over the last 30 days
    const dupCheck = isQaTest ? null : await supabase.functions.invoke('detect-duplicates', {
      body: {
        type: 'signal',
        content: (classification.normalized_text || signalText).toString(),
        client_id: clientId || undefined,
        near_duplicate_threshold: 0.8,
        lookback_days: 30,
        use_semantic: true,
        autoCheck: false, // Don't create detection records yet since signal doesn't exist
      },
    });

    if (dupCheck?.data?.isDuplicate && dupCheck?.data?.exactMatch) {
      console.log(`EXACT duplicate detected - blocking signal creation`);
      return new Response(
        JSON.stringify({
          error: 'Duplicate signal detected and blocked',
          duplicate_of: dupCheck.data.duplicate?.id,
          message: dupCheck.data.message,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (dupCheck?.data?.nearDuplicateMatch && (dupCheck?.data?.duplicates || []).length > 0) {
      const top = dupCheck.data.duplicates[0];
      console.log(`NEAR duplicate detected (>=80%) - returning existing signal`);
      // Return 200 with the existing signal_id so callers (e.g. QA agent) can confirm
      // the signal exists in the system rather than treating dedup as an error.
      return new Response(
        JSON.stringify({
          signal_id: top?.id,
          deduplicated: true,
          duplicate_of: top?.id,
          similarity_score: top?.similarity_score,
          lookback_days: dupCheck.data.lookback_days_used ?? 30,
          threshold: dupCheck.data.near_duplicate_threshold_used ?? 0.8,
          message: `Near-duplicate detected (similarity ${(top?.similarity_score ?? 0).toFixed(2)}). Returning existing signal.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== SAME-STORY FILING: Catch moderate-similarity signals (50-70%) =====
    // These aren't exact/near duplicates, but are about the SAME ongoing story.
    // File them as signal_updates on the existing signal instead of creating noise.
    if (dupCheck?.data?.duplicates && dupCheck.data.duplicates.length > 0) {
      const topMatch = dupCheck.data.duplicates[0];
      const similarity = topMatch?.similarity_score ?? 0;
      
      // 50-79% similarity range — same story, different article
      if (similarity >= 0.50 && similarity < 0.80 && topMatch?.id) {
        console.log(`[Same-Story] Moderate similarity ${(similarity * 100).toFixed(0)}% with signal ${topMatch.id} — checking if same story...`);
        
        try {
          // Quick AI check: is this genuinely new intelligence or a rehash?
          const existingTitle = topMatch.title || '';
          const newTitle = (classification.normalized_text || signalText).substring(0, 300);
          
          const sameStoryCheck = await callAiGatewayJson({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You determine if two intelligence signals are about the same ongoing story/event. Return JSON with: {"same_story": boolean, "has_new_intel": boolean, "reason": "brief explanation"}. "same_story" means they describe the same event, policy, or situation. "has_new_intel" means the new signal contains genuinely new facts, developments, or outcomes not present in the existing one.'
              },
              {
                role: 'user',
                content: `EXISTING SIGNAL: "${existingTitle}"\n\nNEW SIGNAL: "${newTitle}"\n\nAre these about the same story? Does the new one add genuinely new intelligence?`
              }
            ],
            functionName: 'ingest-signal-same-story-check',
          });

          const sameStoryResult = sameStoryCheck as any;

          // Any signal the AI flags as the SAME ongoing story files onto
          // the parent's timeline, regardless of whether it carries new
          // intel. The has_new_intel flag is preserved in metadata so
          // the UI can render evolution updates differently from rehashes
          // later, but architecturally there's only one place a new
          // datum about an existing story should live: on that story's
          // timeline, not as a duplicate signal in the feed.
          //
          // Was previously gated on `has_new_intel !== true`, which meant
          // the timeline only ever caught rehashes — the genuinely useful
          // case (new intel about an ongoing story) created a separate
          // signal instead, so the Live Updates feed was almost always
          // empty.
          if (sameStoryResult?.same_story === true) {
            const newIntel = sameStoryResult?.has_new_intel === true;
            console.log(
              `[Same-Story] FILING as update on ${topMatch.id} ` +
              `(${newIntel ? 'NEW INTEL' : 'rehash'}): ${sameStoryResult.reason}`
            );

            // Generate content hash for the update
            const updateHashData = new TextEncoder().encode(`same-story|${topMatch.id}|${contentHash}`);
            const updateHashBuffer = await crypto.subtle.digest('SHA-256', updateHashData);
            const updateHash = Array.from(new Uint8Array(updateHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            // Check if this update already exists (re-ingestion of the same
            // article) so we don't double-write the same row.
            const { data: existingUpdate } = await supabase
              .from('signal_updates')
              .select('id')
              .eq('content_hash', updateHash)
              .maybeSingle();

            if (!existingUpdate) {
              await supabase.from('signal_updates').insert({
                signal_id: topMatch.id,
                content: (classification.normalized_text || signalText).substring(0, 2000),
                source_name: signal.source_name || 'same-story-filing',
                source_url: signal.source_url || null,
                content_hash: updateHash,
                metadata: {
                  filed_reason: sameStoryResult.reason,
                  similarity_score: similarity,
                  original_content_hash: contentHash,
                  has_new_intel: newIntel,
                  same_story_check: true,
                },
              });
            }

            // Block the content hash so this exact article doesn't come back.
            // Future articles about the same story have different hashes and
            // will go through this same path — their hash is unique even if
            // they file onto the same parent.
            await supabase.from('rejected_content_hashes').upsert({
              content_hash: contentHash,
              client_id: clientId,
              reason: newIntel ? 'same_story_new_intel_filed' : 'same_story_filed',
              original_signal_title: newTitle.substring(0, 200),
            }, { onConflict: 'content_hash,client_id', ignoreDuplicates: true });

            return new Response(
              JSON.stringify({
                status: 'filed_as_update',
                filed_on: topMatch.id,
                similarity_score: similarity,
                has_new_intel: newIntel,
                reason: sameStoryResult.reason,
                message: newIntel
                  ? 'Signal filed as new-intel update on existing story (no separate feed entry).'
                  : 'Signal filed as rehash update on existing story.',
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            console.log(
              `[Same-Story] AI says different story — creating as new signal. ` +
              `Reason: ${sameStoryResult?.reason || '(no reason given)'}`
            );
          }
        } catch (sameStoryErr) {
          console.warn(`[Same-Story] AI check failed, proceeding with new signal:`, sameStoryErr);
          // Fail open — create the signal rather than risk losing new intel
        }
      }
    }

    // Generate a descriptive incident title from signal metadata
    const generateIncidentTitle = (sig: any, cls: any): string => {
      const categoryMap: Record<string, string> = {
        malware: 'Malware Detection',
        phishing: 'Phishing Campaign',
        intrusion: 'Network Intrusion',
        data_exfil: 'Data Exfiltration',
        ddos: 'DDoS Attack',
        ransomware: 'Ransomware Activity',
        social_engineering: 'Social Engineering',
        insider_threat: 'Insider Threat',
        physical: 'Physical Security Threat',
        fraud: 'Fraud Activity',
        extremism: 'Extremist Activity',
        protest: 'Protest Activity',
        cyber: 'Cyber Threat',
        sabotage: 'Sabotage Threat',
        espionage: 'Espionage Activity',
      };
      const cat = cls.category || sig.category || '';
      const catLabel = categoryMap[cat] ||
        (cat ? cat.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Security Incident');
      const sev = (cls.severity || sig.severity || '').toLowerCase();
      const loc = cls.location || sig.location || '';
      const entities: string[] = cls.entity_tags || sig.entity_tags || [];
      const sevPrefix = sev === 'critical' ? 'Critical ' : sev === 'high' ? 'High-Severity ' : '';

      // Prefer named entities as target descriptor, fall back to location
      const meaningful = entities.filter((e: string) => e.length > 2 && !/^\d+$/.test(e));
      const target = meaningful.length > 0 ? meaningful.slice(0, 2).join(', ') : loc;

      if (target) {
        return `${sevPrefix}${catLabel} — ${target}`.substring(0, 100);
      }

      // Fall back to first clean sentence of signal title
      const raw = sig.title || sig.normalized_text || '';
      const clean = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      const short = clean.split(/[.!?]/)[0].trim().substring(0, 60);
      if (short.length > 10) {
        return `${sevPrefix}${catLabel}: ${short}`.substring(0, 100);
      }

      return `${sevPrefix}${catLabel} Detected`.substring(0, 100);
    };

    // Generate title from normalized_text (first sentence or first 100 chars).
    //
    // Sentence-end detection has to ignore periods inside numbers ($1.5B),
    // abbreviations (Fort St., Mr., Inc.), and very short fragments. Earlier
    // logic was `text.match(/[.!?]/)` — that cut at the first period anywhere,
    // producing titles like "TC Energy has approved the $1." and "Coastal
    // GasLink pipeline section near Fort St.". Two corrections:
    //   1. Period must be followed by whitespace OR end-of-string (rules out
    //      numbers like "$1.5" where the period is followed by a digit).
    //   2. The chars immediately before the period must not be a known
    //      abbreviation (St, Mr, Mrs, Ms, Dr, Prof, Inc, Corp, Ltd, Co, Ave,
    //      Blvd, Rd, Mt, Sr, Jr, U.S, U.K).
    //   3. Sentence end must be at least 30 chars in (defensive — short
    //      fragments aren't titles).
    const ABBREV_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Sr|Jr|Inc|Corp|Co|Ltd|Ave|Blvd|Rd|U\.S|U\.K)$/i;
    const generateTitle = (text: string): string => {
      if (!text || text.length === 0) return 'Signal - ' + new Date().toISOString().slice(0, 16);

      let sentenceEnd = -1;
      const re = /[.!?](?=\s|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const idx = m.index;
        if (idx < 30) continue;
        // For periods (not ! or ?), check the immediately preceding word for
        // a known abbreviation pattern.
        if (text[idx] === '.') {
          const before = text.substring(Math.max(0, idx - 12), idx);
          if (ABBREV_RE.test(before)) continue;
        }
        sentenceEnd = idx + 1;
        break;
      }

      const honorSentence = sentenceEnd > 0;
      const TITLE_CAP = 200;
      const titleLength = honorSentence ? Math.min(sentenceEnd, TITLE_CAP) : TITLE_CAP;
      let title = text.substring(0, titleLength).trim();

      // Append ellipsis when we couldn't render the full intended span — either
      // no sentence end was found and the source ran past TITLE_CAP, OR we
      // found a sentence end but it lay beyond the cap.
      const truncatedAtCap =
        (!honorSentence && text.length > TITLE_CAP) ||
        (honorSentence && sentenceEnd > TITLE_CAP);
      if (truncatedAtCap) {
        title = title.replace(/\s+\S*$/, '') + '...';
      }

      return title || 'Signal - ' + new Date().toISOString().slice(0, 16);
    };
    
    const signalTitle = generateTitle(classification.normalized_text || signalText);
    
    // ===== AI RELEVANCE GATE: PECL-calibrated two-stage check =====
    // Stage 1: LLM scores relevance (0-1) + classifies connection type
    // Stage 2: Threshold check at 0.40 — below = write to filtered_signals and reject
    // Threshold history: 0.60 → 0.45 (admitted too much junk) → 0.65 (rejected legit
    // signals like Coastal GasLink blockade + Petronas Canada at score 0.60) → 0.55.
    // 2026-05-08 audit: 0.55 was rejecting JERA/LNG-Canada (0.45), Tangeman/Kitimat
    // (0.20), Poirier/TC-Energy (0) — all real but borderline. Dropped to 0.45 with
    // bounds 0.40–0.65 to admit the JERA-class signals. Operators can dismiss noise
    // via the relevance score visible in UI.
    // 2026-05-10 audit: 0.45 was rejecting 84% of incoming items (49 filtered vs
    // 9 admitted in 24h) — gate was over-tight, producing fleet dormancy + sparse
    // gate-distribution histogram. Dropped to 0.40 with bounds 0.35–0.65 as a
    // CONTROLLED EXPERIMENT — watch admit-rate over 6h. Reverts trivially if
    // junk floods in.
    if (skip_relevance_gate) {
      console.log(`[AI Relevance Gate] BYPASSED — upstream keyword matching already vetted this signal`);
    }
    if (clientId && !skip_relevance_gate) {
      try {
        const { data: clientForGate } = await supabase
          .from('clients')
          .select('name, industry, locations, high_value_assets')
          .eq('id', clientId)
          .single();

        // Fetch analyst learning profiles to bias the gate
        let approvedPatternBlock = '';
        let rejectedPatternBlock = '';
        let learnedThresholdAdjustment = 0;
        try {
          const { data: profiles } = await supabase
            .from('learning_profiles')
            .select('profile_type, features')
            .in('profile_type', ['approved_signal_patterns', 'rejected_signal_patterns'])
            .limit(2);

          if (profiles && profiles.length > 0) {
            const textLower = (classification.normalized_text || signalText).toLowerCase();

            for (const profile of profiles) {
              const features: Record<string, number> = profile.features || {};
              // Top keywords sorted by frequency
              const topKeywords = Object.entries(features)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 12)
                .map(([k]) => k)
                .filter(k => !k.startsWith('reason:'));

              // Check how many top keywords this signal matches
              const matchCount = topKeywords.filter(k => textLower.includes(k)).length;

              if (profile.profile_type === 'approved_signal_patterns') {
                if (topKeywords.length > 0) {
                  approvedPatternBlock = `\nPATTERNS ANALYSTS HAVE APPROVED: ${topKeywords.slice(0, 8).join(', ')}`;
                }
                // Lower threshold if signal matches approved patterns
                if (matchCount >= 2) learnedThresholdAdjustment -= 0.05;
              } else if (profile.profile_type === 'rejected_signal_patterns') {
                if (topKeywords.length > 0) {
                  rejectedPatternBlock = `\nPATTERNS ANALYSTS HAVE REJECTED: ${topKeywords.slice(0, 8).join(', ')}`;
                }
                // Raise threshold if signal matches rejected patterns
                if (matchCount >= 3) learnedThresholdAdjustment += 0.05;
              }
            }
          }
        } catch { /* non-blocking */ }

        if (clientForGate) {
          const gateResult = await callAiGatewayJson({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are a relevance scorer for a corporate protective intelligence platform. Your job is to admit signals that change a principal-protection or asset-security analyst's situational picture — NOT only signals that name an active threat.

Score on a 0.0–1.0 scale. Classify the primary connection type.

SCORE GUIDE:
0.8–1.0  Direct: client or asset explicitly named in a threat, incident, legal action, or material development (M&A, project FID, pipeline approval, divestment announcement, named protest target)
0.6–0.79 Strong indirect: same named project/partner/transporter as client, same threat actor active against client's sector, adjacent geography with credible spillover, regulatory ruling that affects client's operating posture
0.45–0.59 Moderate: sector-wide risk, regulatory trend, activist tactic relevant to client's industry, supply-chain partner (lender, insurer, transporter, indigenous-territory counterparty) material event ← INGESTION FLOOR
0.2–0.44 Weak: tangential keyword match, distant geography, generic corporate PR with no client nexus, historical >6 months without resurgence
0.0–0.19 No connection: wrong industry, wrong region, sports/entertainment, generic content

WHAT COUNTS AS "MATERIAL DEVELOPMENT" (admit at ≥0.45 if client or core asset is named):
- Named M&A, finance deals, capital decisions, project approvals, FID announcements
- First Nations / Indigenous treaty agreements, consultation outcomes, treaty rulings
- Bank / insurer / pension fund decisions about financing the client's projects
- Regulatory rulings, environmental review outcomes, sanctions decisions
- Reputational events naming the client (boycotts, divestment campaigns, public letters)
- Named supply-chain or transporter changes (e.g. TC Energy is Petronas's CGL transporter)

These are NOT "security threats" in the narrow sense, but they DO change the principal-protection threat surface (capital flow, activist target prioritization, geopolitical alignment, stakeholder posture). Admit them.

CONNECTION TYPES (pick one):
- direct_naming: client or asset explicitly named
- threat_actor: known threat group also targeting client's sector
- regulatory: regulation/legal ruling affecting client's industry
- geographic: incident in client's operational area
- tactical: activist/attack tactic relevant to client's threat model
- material_development: M&A, capital, treaty, regulatory, reputational event affecting client's threat surface
- supply_chain: client's transporter, lender, insurer, or named partner has a material event
- none: no meaningful connection

INDIGENOUS-RELATIONS CONTEXT (admit these — they shape the protective-intelligence operating environment):
- Treaty / benefits agreement ratifications affecting client's projects or operating territory → 0.65–0.85 (material_development)
- Court rulings on Indigenous law in client's operating territory → 0.55–0.75 (regulatory)
- MMIWG memorials, Red Dress Day, residential school commemorations in client's operating territory → 0.45–0.60 (geographic)
- Indigenous-rights legal proceedings (defamation suits, injunctions, charges) within or adjacent to operating area → 0.50–0.70 (regulatory)
- First Nations chief / council public statements about client or sector → 0.55–0.75 (material_development)
A "good news" benefits agreement is STILL a material development — it shapes activist target prioritization, capital flow, and stakeholder dynamics. Do not score low because no threat is named.

DOXXING / NAMED-STAFF TARGETING (admit at ≥0.7 regardless of how indirect the threat language is):
- Any signal that names a specific client staff member or executive in a public-pressure, exposure, or campaign-to-fire context → 0.7–0.95 (direct_naming)
- Activist newsletter / coalition piece naming individual healthcare providers, security staff, or executives → 0.7–0.85
- The mere act of NAMING is the protective-intel concern, not the explicit threat words

CATEGORICAL EXCLUSIONS — return score 0.0 regardless of location:
- Sports leagues, tryouts, tournaments, recreational activities
- School events, graduations, concerts, festivals, community social events (paint nights, art classes)
- Retail sales, restaurant openings, local lifestyle news with no client/asset/threat nexus
- Client's own positive PR, sponsorships, community goodwill posts (UNLESS reputational pushback is present)
- Software product announcements (non-security)
- Generic "about us" pages, merchandise listings, job postings

Geographic location alone does NOT override these exclusions. If a signal matches an exclusion, set score to 0.0 and primary_connection to "none".
${approvedPatternBlock}${rejectedPatternBlock}

Respond with JSON: {"score": 0.0-1.0, "relevant": true/false, "primary_connection": "...", "reason": "one sentence"}`
              },
              {
                role: 'user',
                content: `CLIENT: ${clientForGate.name}
INDUSTRY: ${clientForGate.industry || 'unknown'}
LOCATIONS: ${(clientForGate.locations || []).join(', ')}
KEY ASSETS: ${(clientForGate.high_value_assets || []).join(', ')}

SIGNAL:
${(classification.normalized_text || signalText).substring(0, 1500)}

Score this signal's relevance and classify the connection.`
              }
            ],
            functionName: 'ingest-signal-relevance-gate',
            extraBody: { max_completion_tokens: 120 },
          });

          const gateScore: number = gateResult.data?.score ?? (gateResult.data?.relevant === false ? 0.1 : 0.7);
          const gateReason: string = gateResult.data?.reason || '';
          const primaryConnection: string = gateResult.data?.primary_connection || 'none';

          // Phase 3C: Per-source threshold adjustment
          // Low-credibility sources face a higher bar; proven sources get more slack.
          //
          // 2026-05-12 tuning — pipeline audit showed AI gate was rejecting
          // 80-95% of candidates (admit rate 7-17%/day) including signals the
          // AI itself reasoned were "directly related to Petronas Canada's
          // key asset" (score 0.45 → rejected against threshold 0.50). Base
          // lowered from 0.40 → 0.30 to admit borderline content the relevance
          // gate is being over-conservative on. Floor lowered to 0.25 so
          // proven-credible sources can get even more slack. Ceiling reduced
          // to 0.55 — even low-credibility sources shouldn't be punished into
          // ~zero admit rate.
          let relevanceThreshold = Math.min(0.55, Math.max(0.25, 0.30 + learnedThresholdAdjustment));
          if (learnedThresholdAdjustment !== 0) {
            console.log(`[Learning] Threshold adjusted by analyst patterns: ${learnedThresholdAdjustment > 0 ? '+' : ''}${learnedThresholdAdjustment.toFixed(2)} → ${relevanceThreshold.toFixed(2)}`);
          }
          if (source_key) {
            const { data: credScore } = await supabase
              .from('source_credibility_scores')
              .select('current_credibility, total_signals')
              .eq('source_key', source_key)
              .maybeSingle();
            // Only adjust if we have enough signal history (thin data protection)
            if (credScore?.current_credibility && (credScore.total_signals ?? 0) >= 5) {
              const adjustment = (0.55 - credScore.current_credibility) * 0.40;
              relevanceThreshold = Math.min(0.55, Math.max(0.25, 0.30 + adjustment));
              if (Math.abs(relevanceThreshold - 0.30) > 0.005) {
                console.log(`[Phase3C] ${source_key} threshold adjusted: ${relevanceThreshold.toFixed(2)} (credibility: ${credScore.current_credibility.toFixed(3)}, signals: ${credScore.total_signals})`);
              }
            }
          }

          if (gateScore < relevanceThreshold) {
            console.log(`[AI Relevance Gate] REJECTED (score ${gateScore.toFixed(2)}): ${gateReason}`);

            // Audit trail — write to filtered_signals
            supabase.from('filtered_signals').insert({
              raw_text: (classification.normalized_text || signalText).substring(0, 2000),
              source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
              source_name: source_key || signalRaw?.source_name || null,
              client_id: clientId,
              filter_reason: 'ai_relevance_gate',
              signal_origin: coerceOrigin(origin ?? deriveOrigin({ sourceKey: source_key, isTest: is_test, rawSource: signalRaw?.source })),
              relevance_score: gateScore,
              relevance_reason: gateReason,
              primary_connection: primaryConnection,
            }).then(() => {}).catch(() => {});

            // Store hash so this content doesn't re-enter
            const encoder2 = new TextEncoder();
            const data2 = encoder2.encode(classification.normalized_text || signalText);
            const hashBuffer2 = await crypto.subtle.digest('SHA-256', data2);
            const hashArray2 = Array.from(new Uint8Array(hashBuffer2));
            const rejectedHash2 = hashArray2.map((b: number) => b.toString(16).padStart(2, '0')).join('');

            await supabase.from('rejected_content_hashes').insert({
              content_hash: rejectedHash2,
              client_id: clientId,
              reason: 'ai_relevance_gate',
              original_signal_title: signalTitle.substring(0, 200)
            }).then(() => {}).catch(() => {});

            return new Response(
              JSON.stringify({
                status: 'rejected',
                reason: 'ai_relevance_gate',
                relevance_score: gateScore,
                primary_connection: primaryConnection,
                detail: gateReason,
                message: 'Signal rejected by AI relevance gate — not actionable intelligence for this client'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            console.log(`[AI Relevance Gate] ACCEPTED (score ${gateScore.toFixed(2)}, connection: ${primaryConnection}): ${gateReason}`);
          }
        }
      } catch (gateError) {
        // Fail closed — if the gate fails, reject rather than admit unreviewed noise.
        // Previous behaviour was non-blocking (let the signal through), but in practice
        // gate timeouts/errors meant junk signals slipped past during AI gateway hiccups.
        // qa_test signals still pass through so smoke tests remain reliable.
        const gateErrMsg = gateError instanceof Error ? gateError.message : String(gateError);
        console.error('[AI Relevance Gate] Error (failing closed):', gateErrMsg);
        const isQaTestForGate = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || is_test === true;
        if (!isQaTestForGate) {
          // Audit trail — write to filtered_signals so the rejection is
          // visible in dashboards/queries. Without this, gate-failure
          // rejections silently drop on the floor (May 9 2026 incident:
          // OpenAI 429s caused gate failures; monitor-news-google scanned
          // 49 items and created 0 signals, with filtered_signals empty —
          // operators saw symptoms but no diagnostic trail).
          supabase.from('filtered_signals').insert({
            raw_text: signalText.substring(0, 2000),
            source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
            source_name: source_key || signalRaw?.source_name || null,
            client_id: clientId,
            filter_reason: 'ai_relevance_gate_error',
            relevance_score: null,
            relevance_reason: gateErrMsg.substring(0, 500),
            primary_connection: null,
          }).then(() => {}).catch(() => {});

          return new Response(
            JSON.stringify({
              status: 'rejected',
              reason: 'ai_relevance_gate_error',
              detail: gateErrMsg.substring(0, 200),
              message: 'Signal rejected because the AI relevance gate could not be evaluated'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // ===== RELEVANCE SCORING: Use learned patterns to gate noise =====
    const severityNum = classification.severity === 'critical' ? 100 :
                        classification.severity === 'high' ? 75 :
                        classification.severity === 'medium' ? 50 :
                        classification.severity === 'low' ? 20 : 50;
    
    const relevanceResult = await scoreSignalRelevance(
      supabase,
      classification.normalized_text || signalText,
      classification.category || null,
      severityNum,
      source_key || null  // Pass source key so Phase 2 (source reliability) activates
    );
    
    console.log(`[Relevance] Score: ${relevanceResult.score.toFixed(2)}, Recommendation: ${relevanceResult.recommendation}, Patterns: ${relevanceResult.matchedPatterns.join(', ')}`);
    
    // Suppress signals that are clearly noise
    if (relevanceResult.recommendation === 'suppress') {
      console.log(`[Relevance] SUPPRESSING signal: ${relevanceResult.reason}`);
      return new Response(
        JSON.stringify({ 
          status: 'suppressed',
          reason: relevanceResult.reason,
          relevance_score: relevanceResult.score,
          matched_patterns: relevanceResult.matchedPatterns,
          message: 'Signal suppressed by relevance filter based on learned patterns'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Determine status based on relevance
    const signalStatus = 'new'; // low_confidence is not a valid signal_status enum value
    
    // Extract event_date + decide historical bucketing.
    //
    // Two distinct things here:
    //   (1) event_date — descriptive metadata about WHEN the underlying
    //       event happened. AI-extracted from text. Stored on the row.
    //   (2) surface_date — when the article/post BECAME NEWS. Used for
    //       historical-bucket routing because operational relevance is
    //       about when intelligence broke, not when the event itself
    //       occurred. A fresh article ABOUT a 2024 court ruling is still
    //       a CURRENT signal — the surge of coverage IS the operational
    //       intel.
    //
    // 2026-05-11 fix: previously AI event_date alone gated historical
    // routing, which mis-bucketed recent journalism that referenced
    // older events (e.g. May 2026 Law360 piece on a 2024 BCSC ruling →
    // tagged historical and buried). Now: surface_date is the gate, AI
    // event_date is informational only.
    let eventDate: string | null = null;
    let surfaceDate: Date = new Date(); // default: now (monitor just saw it)

    if (classResult.data?.event_date) {
      try {
        const parsed = new Date(classResult.data.event_date);
        if (!isNaN(parsed.getTime())) {
          eventDate = parsed.toISOString();
          console.log(`[EventDate] AI-extracted event_date: ${eventDate}`);
        }
      } catch { /* ignore */ }
    }

    // Surface date comes from the article's actual publish metadata if the
    // upstream monitor passed one. RSS feeds typically have a real pubDate;
    // Google CSE may include article:published_time in pagemap. Falls back
    // to "now" (we just saw it) which is the right answer for monitor-side
    // ingestion.
    const rawPubDate = signalRaw?.pubDate || signalRaw?.published_date
                    || signalRaw?.published || signalRaw?.date
                    || signalRaw?.article_published_time;
    if (rawPubDate) {
      try {
        const parsed = new Date(rawPubDate);
        if (!isNaN(parsed.getTime())) surfaceDate = parsed;
      } catch { /* ignore */ }
    }

    // Fall back to surface date if AI gave us nothing (preserves prior
    // behaviour where event_date column was populated from rawPubDate).
    if (!eventDate) eventDate = surfaceDate.toISOString();

    // ── STALENESS GATE ────────────────────────────────────────────────────────
    // Gated on SURFACE date, not AI event_date. An article that surfaced
    // today is operational regardless of when the underlying event happened.
    // skip_relevance_gate bypasses (analyst uploads of historical material).
    let isHistorical = false;
    let triageOverride: string | null = null;
    if (!skip_relevance_gate) {
      const cyberCategories = ['malware', 'phishing', 'intrusion', 'data_exfil', 'ddos', 'ransomware'];
      const isCyber = cyberCategories.includes(classification.category || '');
      const cutoffDays = isCyber ? 730 : 365;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - cutoffDays);
      if (surfaceDate < cutoff) {
        const daysOld = Math.floor((Date.now() - surfaceDate.getTime()) / 86400000);
        isHistorical = true;
        triageOverride = 'historical';
        console.log(`[Staleness] Routing to historical — surface_date ${surfaceDate.toISOString()} is ${daysOld} days old (limit: ${cutoffDays})`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Compute severity_score (0-100) from text severity + relevance adjustment
    const severityScore = (() => {
      const base = classification.severity === 'critical' ? 90
                 : classification.severity === 'high'     ? 70
                 : classification.severity === 'medium'   ? 40
                 : 20; // low
      const adjustment = Math.round((relevanceResult.score - 0.5) * 20);
      return Math.max(0, Math.min(100, base + adjustment));
    })();

    // Compute quality_score (0-1) from metadata completeness
    const qualityScore = (() => {
      let q = 0;
      if (signalRaw?.url || signalRaw?.source_url || signalRaw?.link) q += 0.25;
      if ((classification.entity_tags?.length ?? 0) > 0) q += 0.25;
      if (classification.location) q += 0.25;
      if (classification.category) q += 0.125;
      if ((classification.normalized_text?.length ?? 0) > 50) q += 0.125;
      return q;
    })();

    // ─── Foreign-alignment scoring ─────────────────────────────────
    // Score the signal content + (when available) the author handle /
    // mentioned handles for state-media alignment indicators. Driven
    // by the Vashouk / @NeoIntel7 case where grievance fixation was
    // amplified by Iranian state-media interactions. Deterministic
    // (no AI call) so cost is zero per signal and indicators are
    // explainable.
    const fa_text = `${signalTitle || ''} ${classification.normalized_text || signalText || ''}`;
    const fa_author = (signalRaw as { author_handle?: string; author?: { username?: string } })?.author_handle
      ?? (signalRaw as { author?: { username?: string } })?.author?.username
      ?? null;
    const fa_mentions = extractMentions(fa_text);
    const fa = scoreForeignAlignment(fa_text, fa_mentions, fa_author ? `@${fa_author.replace(/^@/, '')}` : null);

    // Insert signal WITH content_hash and title from the start
    // Include match metadata for audit trail and potential re-assignment
    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        source_id: sourceId,
        // #79: explicit producer stamp wins; null lets the BEFORE INSERT trigger derive (non-bypassable floor).
        signal_origin: origin ? coerceOrigin(origin) : null,
        client_id: clientId,
        title: signalTitle,
        foreign_alignment_score: fa.score > 0 ? fa.score : null,
        foreign_alignment_indicators: fa.indicators,
        raw_json: {
          ...signalRaw,
          matched_keywords: matchedKeywords.length > 0 ? matchedKeywords : undefined,
          match_confidence: matchConfidence,
          match_timestamp: new Date().toISOString(),
          relevance_score: relevanceResult.score,
          relevance_patterns: relevanceResult.matchedPatterns,
          relevance_recommendation: relevanceResult.recommendation,
          foreign_alignment: fa.score > 0 ? {
            score: fa.score,
            indicators: fa.indicators,
            matched_handles: fa.matched_handles,
            matched_phrases: fa.matched_phrases,
          } : undefined,
        },
        normalized_text: classification.normalized_text,
        entity_tags: classification.entity_tags,
        location: classification.location,
        category: classification.category,
        severity: classification.severity,
        severity_score: severityScore,
        quality_score: qualityScore,
        confidence: classification.confidence,
        // WO-INCIDENT-QA Step 3b: persist composite_confidence on EVERY signal at
        // ingest so the creation gate has a confidence value to enforce (was null on
        // ~84% of signals). Provisional — source_credibility uses a neutral 0.5 prior
        // here; ai-decision-engine recomputes with the real source_credibility_scores
        // lookup downstream. When coverage exceeds ~80% over a rolling week, revisit
        // the gate to drop the corroboration fallback (see _shared/incident-creation-gate.ts).
        composite_confidence: computeComposite({
          ai_confidence: classification.confidence,
          relevance_score: relevanceResult.score,
          source_credibility: 0.5,
        }),
        relevance_score: relevanceResult.score,
        status: signalStatus,
        is_test: is_test || false,
        content_hash: contentHash,
        event_date: eventDate,
        triage_override: triageOverride,
        signal_type: isHistorical ? 'historical' : null,
        source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
        image_url: image_url || signalRaw?.image_url || signalRaw?.og_image || signalRaw?.thumbnail || null,
        // F-CRT (2026-05-15) — source platform tag, set by monitor-* callers.
        // Powers downstream hostile_handles attribution + platform-scoped
        // analyst views. Null when caller omits (legacy callers).
        platform: platform ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw new Error(`Signal insert failed: ${insertError.message} (code: ${insertError.code}, details: ${insertError.details})`);
    }

    console.log(`Signal ingested: ${signal.id}${matchedKeywords.length > 0 ? ` (keywords: ${matchedKeywords.join(', ')})` : ''}`);

    // WO-HAZARD-RELEVANCE Step 6: pathway-score hazard-class signals at ingest. A hazard
    // with no client impact pathway (proximity/corridor/HQ) has its relevance capped to
    // 0.40 — awareness only, never main-tier — and the reasoning is persisted. Fire-and-await
    // (the RPC caps signals.relevance_score); failure is logged, never blocks ingest.
    const HAZARD_CATS_INGEST = ['civil_emergency', 'wildfire', 'weather', 'natural_disaster', 'health_concern', 'amber_alert'];
    if (signal?.id && HAZARD_CATS_INGEST.includes(classification.category)) {
      try {
        await supabase.rpc('score_signal_hazard_pathway', { p_signal_id: signal.id });
      } catch (e) {
        console.warn('[hazard-pathway] scoring failed for', signal.id, (e as Error).message);
      }
    }

    // F-CRT-XQ (2026-05-15) — X quota/spend telemetry.
    // When a signal originates from the X filtered stream, record one
    // tweet-read against x_quota_consumption. Source-class buckets enable
    // burn-rate dashboards per Annex A v3.1 operating constraint 1.
    // Fire-and-forget; failure is logged, never blocks ingest.
    if (signal?.id && platform === 'x' && raw_json && (raw_json as Record<string, unknown>).source === 'x_filtered_stream') {
      const ruleTags = (raw_json as { matching_rules?: Array<{ kind?: string }> })?.matching_rules ?? [];
      const sourceClass = ruleTags.some((r) => r?.kind === 'entity') ? 'entity'
        : ruleTags.some((r) => r?.kind === 'handle') ? 'handle'
        : 'keyword';
      supabase.from('x_quota_consumption').insert({
        source_class: sourceClass,
        client_id: clientId,
        reads: 1,
        query_text: ruleTags.map((r: { label?: string }) => r?.label).filter(Boolean).join(', ').slice(0, 500) || null,
        metadata: {
          signal_id: signal.id,
          tweet_id: (raw_json as Record<string, unknown>).tweet_id ?? null,
          rule_count: ruleTags.length,
        },
      }).then((res) => {
        if (res.error) console.warn(`[ingest-signal] x_quota_consumption insert error: ${res.error.message}`);
      });
    }

    // F-CRT-HH (2026-05-15) — hostile-handle continuity upsert.
    // Skip on test signals or when platform / client_id / handle is missing.
    // Failure is logged but non-fatal — the signal is already persisted,
    // and the hostile_handles memory is a derived artifact.
    //
    // F-CRT-HH-2 (2026-05-18) — read from the LOCAL `raw_json` (input body)
    // instead of `signal.raw_json` (post-insert). The URL-fetcher rewrites
    // the persisted raw_json (replacing it with the fetched content + error
    // metadata), which drops the author/username fields the upsert helper
    // needs. The local raw_json still has the original X-stream Worker
    // payload with handle data intact. Discovered during 2026-05-18
    // source-readiness check.
    if (signal?.id && clientId && platform && !is_test) {
      try {
        const inputRaw = (raw_json as Record<string, unknown> | null | undefined) ?? null;
        const sigRaw = (signal as { raw_json?: Record<string, unknown> })?.raw_json ?? null;
        // Prefer the local input body; fall back to the persisted row in case
        // the input was already URL-fetched form.
        const handleInfo = extractHandleFromRawJson(inputRaw, platform)
                       ?? extractHandleFromRawJson(sigRaw, platform);
        if (handleInfo) {
          const result = await upsertHostileHandleOnSignal(supabase, {
            signal_id: signal.id,
            client_id: clientId,
            platform,
            handle: handleInfo.handle,
            author_id: handleInfo.author_id,
          });
          if (result.outcome === 'error') {
            console.warn(`[ingest-signal] hostile-handle upsert error for signal=${signal.id}: ${result.reason}`);
          } else if (result.outcome === 'inserted') {
            console.log(`[ingest-signal] new hostile_handle ${result.hostile_handle_id} on platform=${platform} handle=${handleInfo.handle}`);
          }
        }
      } catch (e) {
        console.warn(`[ingest-signal] hostile-handle upsert threw for signal=${signal.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Fire-and-forget: generate and store content_embedding for pgvector semantic dedup.
    // Embeddings accumulate over time — detect-duplicates will use find_similar_signals_by_embedding
    // once enough signals have embeddings, giving better cross-outlet dedup than GPT-60-candidates.
    const openaiKeyForEmbed = Deno.env.get('OPENAI_API_KEY');
    if (openaiKeyForEmbed && signal?.id) {
      const embedText = (classification.normalized_text || signalText).substring(0, 8000);
      fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKeyForEmbed}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: embedText }),
      }).then((r: Response) => r.json()).then((embedData: any) => {
        const embedding = embedData.data?.[0]?.embedding;
        if (embedding) {
          supabase.from('signals')
            .update({ content_embedding: JSON.stringify(embedding) })
            .eq('id', signal.id)
            .then(() => {}, () => {});
        }
      }).catch(() => {});
    }

    // Non-blocking — anomaly scoring runs after insert. Enqueued via durable
    // queue (was fire-and-forget invoke) so the work survives runtime teardown.
    enqueueJob(supabase, {
      type: 'score-signal-anomaly',
      payload: {
        signal_id: signal.id,
        category: signal.category,
        severity: signal.severity,
        client_id: clientId,
        location: signal.location,
        normalized_text: signal.normalized_text,
        created_at: signal.created_at,
      },
      idempotencyKey: `score-signal-anomaly:${signal.id}`,
    }).catch(err => console.error('[ingest-signal] anomaly scoring enqueue:', err));

    // Speculative agent dispatch for high/critical signals — durable queue.
    if (classification.severity === 'critical' || classification.severity === 'high') {
      enqueueJob(supabase, {
        type: 'speculative-dispatch',
        payload: {
          signal_id: signal.id,
          signal_text: signal.normalized_text,
          category: classification.category,
          severity: classification.severity,
          client_id: clientId,
          trigger_reason: 'auto_ingest',
        },
        idempotencyKey: `speculative-dispatch:${signal.id}`,
      }).catch(err => console.error('[ingest-signal] speculative-dispatch enqueue failed:', err));
    }

    // Now create duplicate detection records if any near-duplicates found
    if (dupCheck?.data?.duplicates && dupCheck.data.duplicates.length > 0) {
      console.log(`Found ${dupCheck.data.duplicates.length} near-duplicate signals`);
      try {
        const detections = dupCheck.data.duplicates.map((dup: any) => ({
          detection_type: 'signal',
          source_id: signal.id,
          duplicate_id: dup.id,
          similarity_score: dup.similarity_score || 1.0,
          detection_method: dup.similarity_score ? 'text_similarity' : 'hash',
          status: 'pending'
        }));
        await supabase.from('duplicate_detections').insert(detections);
      } catch (detectionError) {
        console.error('Failed to create duplicate detection records:', detectionError);
        // Don't fail the whole request if detection records fail
      }
    }
    
    // Entity correlation — durable queue (was fire-and-forget invoke).
    enqueueJob(supabase, {
      type: 'correlate-entities',
      payload: {
        text: signalText,
        sourceType: 'signal',
        sourceId: signal.id,
        autoApprove: false,
      },
      idempotencyKey: `correlate-entities:${signal.id}:standard`,
    }).catch(err => console.error('Entity correlation enqueue error:', err));
    
    // ===== EXPERT KNOWLEDGE ENRICHMENT (async, non-blocking) =====
    // Match incoming signal against learned expert knowledge for contextual intelligence
    (async () => {
      try {
        const signalCategory = classification.category || '';
        const signalSeverity = classification.severity || 'medium';
        
        // Map signal category to expert knowledge domain
        const domainMap: Record<string, string> = {
          malware: 'cyber', phishing: 'cyber', intrusion: 'cyber', data_exfil: 'cyber',
          ransomware: 'cyber', data_exposure: 'cyber', cyber: 'cyber',
          protest: 'geopolitical', civil_unrest: 'geopolitical', regulatory: 'compliance',
          theft: 'physical_security', sabotage: 'physical_security', violence: 'physical_security',
          surveillance: 'physical_security', trespass: 'physical_security',
          threat: 'threat_intelligence', emergency: 'crisis_management',
          wildfire: 'crisis_management', weather: 'crisis_management', earthquake: 'crisis_management',
          travel: 'travel_security', executive: 'executive_protection',
        };
        
        const mappedDomain = domainMap[signalCategory] || null;
        
        // Build search keywords from signal text (top 8 meaningful words)
        const stopWords = new Set(['the','a','an','is','are','was','were','be','been','has','have','had','do','does','did','will','would','could','should','may','might','shall','can','for','and','but','or','not','no','this','that','these','those','from','with','into','about','after','before','during','between','through','above','below','under','over','such','than','too','very','just','also','more','most','some','any','each','every','all','both','few','many','much','other','another','new','old','first','last','long','great','little','own','same','big','high','small','large','next','early','young','important','few','public','bad','good']);
        const keywords = (classification.normalized_text || signalText)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !stopWords.has(w))
          .slice(0, 8);
        
        if (keywords.length < 2) return; // Not enough signal content to match
        
        // Query expert knowledge for matching entries
        let query = supabase
          .from('expert_knowledge')
          .select('id, domain, subdomain, knowledge_type, title, content, applicability_tags, confidence_score')
          .eq('is_active', true)
          .gte('confidence_score', 0.7)
          .order('confidence_score', { ascending: false })
          .limit(5);
        
        // Filter by domain if we can map it
        if (mappedDomain) {
          query = query.eq('domain', mappedDomain);
        }
        
        // Use OR conditions on keywords for relevance matching
        const orConditions = keywords
          .slice(0, 4)
          .map(k => `title.ilike.%${k}%,content.ilike.%${k}%,applicability_tags.cs.{${k}}`)
          .join(',');
        query = query.or(orConditions);
        
        const { data: matchedKnowledge, error: knowledgeError } = await query;
        
        if (knowledgeError) {
          console.error('[Knowledge Enrichment] Query error:', knowledgeError);
          return;
        }
        
        if (!matchedKnowledge || matchedKnowledge.length === 0) {
          console.log(`[Knowledge Enrichment] No matches for signal ${signal.id} (domain: ${mappedDomain || 'any'})`);
          return;
        }
        
        // Build expert context payload
        const expertContext = {
          matched_at: new Date().toISOString(),
          domain: mappedDomain,
          matches: matchedKnowledge.map(k => ({
            id: k.id,
            title: k.title,
            domain: k.domain,
            subdomain: k.subdomain,
            knowledge_type: k.knowledge_type,
            confidence: k.confidence_score,
            // Include actionable excerpt (first 300 chars of content)
            excerpt: k.content.substring(0, 300),
            tags: k.applicability_tags,
          })),
          total_matches: matchedKnowledge.length,
          enrichment_keywords: keywords.slice(0, 4),
        };
        
        // Update signal with expert context
        await supabase
          .from('signals')
          .update({ expert_context: expertContext })
          .eq('id', signal.id);
        
        console.log(`[Knowledge Enrichment] ✅ Signal ${signal.id} enriched with ${matchedKnowledge.length} expert knowledge entries (domain: ${mappedDomain || 'cross-domain'})`);
        
        // For high-severity signals, trigger reactive learning if no matches in the mapped domain.
        if ((signalSeverity === 'critical' || signalSeverity === 'high') && matchedKnowledge.length < 2) {
          console.log(`[Knowledge Enrichment] Knowledge gap detected for ${signalSeverity} signal — enqueueing reactive learning`);
          enqueueJob(supabase, {
            type: 'agent-self-learning',
            payload: {
              mode: 'reactive',
              topic: `${signalCategory} security threat: ${(classification.normalized_text || signalText).substring(0, 200)}`,
              context: `High-severity signal detected with insufficient expert knowledge coverage in domain "${mappedDomain || 'unknown'}"`,
              agent_call_sign: mappedDomain === 'cyber' ? 'NEO' : mappedDomain === 'physical_security' ? 'ARGUS' : mappedDomain === 'geopolitical' ? 'MERIDIAN' : 'AEGIS-CMD',
            },
            idempotencyKey: `agent-self-learning:reactive:${signal.id}`,
          }).catch(err => console.error('[Knowledge Enrichment] Reactive learning enqueue:', err));
        }
      } catch (enrichError) {
        console.error('[Knowledge Enrichment] Error (non-blocking):', enrichError);
      }
    })();
    
    // ===== CRITICAL SIGNAL FAST-PATH (P0 Priority) =====
    // For P1/Critical signals: Bypass queue, parallel execution for sub-10s latency
    const isCriticalFastPath = 
      rulesResult.priority === 'p1' || 
      rulesResult.severity === 'critical' ||
      classification.severity === 'critical';
    
    if (isCriticalFastPath) {
      console.log('🚨 CRITICAL FAST-PATH ACTIVATED for signal:', signal.id);
      const fastPathStartTime = Date.now();
      
      // Build critical signal payload
      const criticalSignalPayload = {
        id: signal.id,
        normalized_text: signal.normalized_text,
        source: signal.source_id,
        category: classification.category || rulesResult.matchedRule,
        severity: 'critical',
        status: 'critical_processing',
        client_id: clientId,
        match_confidence: 1.0,
        detected_at: signal.detected_at || new Date().toISOString(),
        rule_matched: rulesResult.matchedRule,
        keyword_matched: rulesResult.matchedKeyword,
      };
      
      // PARALLEL EXECUTION: AI Decision + Webhook + Alert in parallel
      const [aiResult, webhookResult, alertResult] = await Promise.allSettled([
        // 1. AI Decision Engine with force_ai for immediate deep analysis
        supabase.functions.invoke('ai-decision-engine', {
          body: {
            signal_id: signal.id,
            force_ai: true
          }
        }),
        
        // 2. Webhook Dispatcher for external system integration
        supabase.functions.invoke('webhook-dispatcher', {
          body: {
            event_type: 'signal.p1_critical',
            signal: criticalSignalPayload,
          }
        }),
        
        // 3. Create immediate P1 incident for alert-delivery
        (async () => {
          // Check if incident exists
          const { data: existingIncident } = await supabase
            .from('incidents')
            .select('id')
            .eq('signal_id', signal.id)
            .maybeSingle();
          
          if (!existingIncident) {
            const { data: newIncident, error: incidentError } = await supabase
              .from('incidents')
              .insert({
                signal_id: signal.id,
                client_id: clientId,
                priority: 'p1',
                status: 'open',
                severity_level: 'P1',
                is_test: signal.is_test || false,
                title: generateIncidentTitle(signal, classification),
                summary: `Fast-path critical signal detected. Rule: ${rulesResult.matchedRule || 'AI-classified'}. Keyword: ${rulesResult.matchedKeyword || 'N/A'}`,
                sla_targets_json: { mttd: 5, mttr: 30 },
                timeline_json: [{
                  timestamp: new Date().toISOString(),
                  action: 'critical_fast_path',
                  details: `Critical signal detected via fast-path. Processing time target: <10s`
                }]
              })
              .select('id')
              .single();
            
            if (incidentError) {
              console.error('Fast-path incident creation error:', incidentError);
              return { error: incidentError };
            }
            
            // Create immediate alert for delivery
            if (newIncident) {
              // C-1 (#76): P1 fast-path = CRITICAL -> 'interruption' tier. Recipients come ONLY from
              // client_alert_recipients (active+verified) for this client (NOT a hardcoded address);
              // zero verified -> one alert to an unroutable sentinel (never claimable/sent) surfaced via
              // the #69 operator-alert-bridge. SMS/oncall interruption transport deferred per AV.3 —
              // email stands in for now.
              const __fpVerified = await fetchVerifiedRecipientEmails(supabase, clientId);
              const __fpTargets = __fpVerified.length > 0 ? __fpVerified : [UNROUTED_RECIPIENT];
              for (const __fpRecipient of __fpTargets) {
              await supabase.from('alerts').insert({
                incident_id: newIncident.id,
                channel: 'email',
                recipient: __fpRecipient,
                tier: 'interruption',
                status: 'pending',
                response_json: {
                  subject: `🚨 P1 CRITICAL: ${signal.normalized_text?.substring(0, 50)}`,
                  body: signal.normalized_text,
                  threat_level: 'critical',
                  location: signal.location || 'Unknown',
                  reasoning: `Fast-path detection: ${rulesResult.matchedKeyword || 'AI-classified critical threat'}`,
                  containment_actions: [
                    'Verify threat validity immediately',
                    'Notify client security team',
                    'Prepare incident response resources'
                  ],
                  priority: 'immediate'
                }
              });
              } // C-1: end fan-out over verified recipients / sentinel

              // Trigger email alert delivery immediately
              supabase.functions.invoke('alert-delivery', {
                body: { priority: 'immediate' }
              }).catch(err => console.error('Alert delivery error:', err));
              
              // === SECURE MESSAGING FAST-PATH ===
              // Parallel delivery to Teams/Slack/SMS for P1 critical alerts
              supabase.functions.invoke('alert-delivery-secure', {
                body: {
                  incident_id: newIncident.id,
                  signal_id: signal.id,
                  priority: 'p1',
                  title: signal.normalized_text?.substring(0, 100) || 'Critical Security Alert',
                  summary: signal.normalized_text || 'Critical threat detected via fast-path processing',
                  threat_level: 'critical',
                  location: signal.location || 'Unknown',
                  client_id: clientId,
                  client_name: null, // Will be resolved in alert-delivery-secure
                  recommended_actions: [
                    'Verify threat validity immediately',
                    'Notify client security team',
                    'Activate incident response protocol',
                    'Document all actions taken'
                  ],
                  channels: ['teams', 'slack', 'sms'] // All secure channels
                }
              }).catch(err => console.error('Secure alert delivery error:', err));
            }
            
            return { incident_id: newIncident?.id };
          }
          return { existing_incident: existingIncident.id };
        })()
      ]);
      
      const fastPathDuration = Date.now() - fastPathStartTime;
      console.log(`✅ CRITICAL FAST-PATH COMPLETE in ${fastPathDuration}ms`);
      console.log('  AI Result:', aiResult.status === 'fulfilled' ? 'success' : aiResult.reason);
      console.log('  Webhook Result:', webhookResult.status === 'fulfilled' ? 'success' : webhookResult.reason);
      console.log('  Alert Result:', alertResult.status === 'fulfilled' ? 'success' : alertResult.reason);
      
      // Update signal with fast-path metadata
      await supabase
        .from('signals')
        .update({
          status: 'critical_processed',
          raw_json: {
            ...signalRaw,
            fast_path_activated: true,
            fast_path_duration_ms: fastPathDuration,
            fast_path_timestamp: new Date().toISOString()
          }
        })
        .eq('id', signal.id);

      // Phase 4B: entity correlation on fast-path critical signals — durable queue.
      enqueueJob(supabase, {
        type: 'correlate-entities',
        payload: { text: signal.normalized_text || signalText, sourceType: 'signal', sourceId: signal.id, autoApprove: false },
        idempotencyKey: `correlate-entities:${signal.id}:fast-path`,
      }).catch((err: Error) => console.error('[Phase4B] Fast-path entity correlation enqueue:', err));
      
      // Return immediately with fast-path confirmation
      return new Response(
        JSON.stringify({ 
          signal_id: signal.id,
          status: 'critical_processed',
          fast_path: true,
          processing_time_ms: fastPathDuration,
          message: `Critical signal processed via fast-path in ${fastPathDuration}ms`,
          results: {
            ai_decision: aiResult.status,
            webhook_dispatch: webhookResult.status,
            alert_creation: alertResult.status
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // ===== STANDARD PATH (Non-Critical Signals) =====
    // Do not auto-create operational incidents from cyber advisory signals.
    // These are intelligence signals, not PECL operational incidents.
    const cyberAdvisoryCategories = ['cyber', 'malware', 'data_exfil', 'intrusion', 'phishing', 'ddos', 'ransomware'];
    const cyberAdvisorySources = ['cisa', 'cccs', 'threat_intel'];
    const isCyberAdvisory =
      cyberAdvisoryCategories.includes(signal.category) ||
      cyberAdvisorySources.includes(signal.raw_json?.sourceType) ||
      cyberAdvisorySources.includes(signal.raw_json?.source_name?.toLowerCase());

    // Historical signals skip the AI decision engine entirely — no incident creation, no escalation
    if (isHistorical) {
      console.log(`[Staleness] Skipping AI decision engine for historical signal ${signal.id}`);
      return new Response(
        JSON.stringify({ success: true, signal_id: signal.id, signal_type: 'historical', message: 'Signal stored as historical intel — no incident created.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apply AI decision engine for rule-based categorization and analysis.
    //
    // Fire-and-forget via EdgeRuntime.waitUntil — the previous `await` chained
    // monitor-news-google → ingest-signal → ai-decision-engine → review-signal-
    // agent into a single ~150s budget, and when the parent monitor timed out
    // mid-loop the downstream analyses never landed. Tier-2 review gap watchdog
    // finding (2026-05-13) traced ~40% of google_news_api signals missing
    // AI-DECISION-ENGINE rows because of this.
    //
    // The result was already only used inside `if (false && ...)` dead code, so
    // there's nothing to lose by not awaiting. EdgeRuntime.waitUntil keeps the
    // runtime alive after the HTTP response so the analysis completes.
    // WO-TRIGGER (2026-07-05): DURABLE escalation. This was a fire-and-forget
    // `supabase.functions.invoke('ai-decision-engine')` + EdgeRuntime.waitUntil.
    // That silently died ~06-19: edge teardown dropped the async call, and because
    // the only error handling was console.error, it produced NO incident, NO
    // incident_creation_failures row, NO surfaced error — the PRIMARY real-incident
    // path was dead for 2+ weeks, invisibly (WO-TRIGGER). Replaced with a durable
    // job: job-worker invokes ai-decision-engine reliably (retries + failure lands
    // visibly in function_jobs.error_message), and the incident flows through the
    // WO-A create_incident door (owned/stamped/deduped). Silent-loss call -> observable queue.
    // idempotencyKey = one escalation job per signal (re-ingest can't double-enqueue).
    try {
      const enq = await enqueueJob(supabase, {
        type: 'ai-decision-engine',
        payload: {
          signal_id: signal.id,
          force_ai: rulesResult.priority === 'p1' || rulesResult.priority === 'p2',
        },
        idempotencyKey: `ai-decision-engine:${signal.id}`,
      });
      console.log(`[ingest-signal] ai-decision-engine job ${enq.deduped ? 'already queued' : 'enqueued'} for signal ${signal.id} (${enq.jobId})`);
    } catch (error) {
      // enqueueJob throws loudly on DB error. Log but don't fail the ingest —
      // the failure is at least surfaced here (not silently dropped like before).
      console.error('[ingest-signal] failed to enqueue ai-decision-engine job:', error);
    }
    
    // Auto-open incident based on rules — P1 ONLY (active shooter, bomb, weapon, kidnap, credible threat).
    // P2 rules ('suspicious', 'tamper', 'intrusion') are too broad and create false incidents.
    // Analysts must create incidents manually for all other signal types.
    if (rulesResult.shouldOpenIncident && rulesResult.matchedRule === 'p1' && !isCyberAdvisory && !isQaTest) {
      // Check if incident was already created by AI
      const { data: existingIncident } = await supabase
        .from('incidents')
        .select('id')
        .eq('signal_id', signal.id)
        .single();
      
      if (!existingIncident) {
        const { error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signal.id,
            client_id: signal.client_id,
            priority: rulesResult.priority,
            status: 'open',
            is_test: signal.is_test || false,
            sla_targets_json: { 
              mttd: 10, 
              mttr: rulesResult.priority === 'p1' ? 60 : 120 
            },
            timeline_json: [{
              timestamp: new Date().toISOString(),
              action: 'incident_opened',
              details: `Auto-opened by rule: ${rulesResult.matchedRule} (${rulesResult.matchedKeyword})`
            }]
          });
        
        if (incidentError) {
          console.error('Error creating incident:', incidentError);
        } else {
          console.log('Incident auto-opened for signal:', signal.id);
        }
      }
    }

    // ===== WEBHOOK TRIGGERS =====
    // Trigger webhooks for critical/high severity signals or client matches
    try {
      const shouldTriggerWebhook = 
        (classification.severity === 'critical' || classification.severity === 'high') ||
        (clientId && matchConfidence !== 'none');
      
      if (shouldTriggerWebhook) {
        const eventType = (classification.severity === 'critical' || classification.severity === 'high')
          ? 'signal.critical_high'
          : 'signal.client_match';
        
        console.log(`Triggering webhook for event: ${eventType}`);
        
        // Build signal payload for webhook
        const webhookSignal = {
          id: signal.id,
          normalized_text: signal.normalized_text,
          source: signal.source_id,
          category: classification.category,
          severity: classification.severity,
          status: signal.status,
          client_id: clientId,
          match_confidence: matchConfidence === 'high' ? 0.9 : 
                           matchConfidence === 'medium' ? 0.7 : 
                           matchConfidence === 'low' ? 0.5 :
                           matchConfidence === 'ai' ? 0.6 :
                           matchConfidence === 'explicit' ? 1.0 : 0,
          detected_at: signal.detected_at || new Date().toISOString(),
        };
        
        // Dispatch webhook asynchronously
        supabase.functions.invoke('webhook-dispatcher', {
          body: {
            event_type: eventType,
            signal: webhookSignal,
          }
        }).then(({ data, error }) => {
          if (error) {
            console.error('Webhook dispatch error:', error);
          } else {
            console.log('Webhook dispatch result:', data);
          }
        }).catch(err => {
          console.error('Webhook dispatch failed:', err);
        });
      }
    } catch (webhookError) {
      console.error('Error triggering webhooks:', webhookError);
      // Don't fail the main request if webhook triggering fails
    }

    // Trigger signal correlation (async, don't wait for it)
    try {
      console.log('Triggering signal correlation...');
      supabase.functions.invoke('correlate-signals', {
        body: { signal_id: signal.id }
      }).then(({ data, error }) => {
        if (error) {
          console.error('Correlation error:', error);
        } else {
          console.log('Correlation result:', data);
        }
      });
    } catch (error) {
      console.error('Failed to trigger correlation:', error);
      // Don't fail the main request if correlation fails
    }

    // Phase 4B: Entity correlation — durable queue (was fire-and-forget invoke).
    // Matches signal text against the entity graph (name + aliases + trigram).
    // autoApprove: false means matches go to suggestions queue for analyst review.
    try {
      await enqueueJob(supabase, {
        type: 'correlate-entities',
        payload: {
          text: signal.normalized_text || signalText,
          sourceType: 'signal',
          sourceId: signal.id,
          autoApprove: false,
        },
        idempotencyKey: `correlate-entities:${signal.id}:phase4b`,
      });
    } catch (error) {
      console.error('[Phase4B] Failed to enqueue entity correlation:', error);
    }

    // WRAITH: Signal threat DNA analysis — durable queue (was fire-and-forget invoke).
    // Detects AI-generated attacks, synthetic intel, and adversarial payloads.
    try {
      await enqueueJob(supabase, {
        type: 'wraith-security-advisor',
        payload: {
          action: 'analyze_signal_threat_dna',
          signal_id: signal.id,
          signal_text: signal.normalized_text || signalText,
          signal_source_url: signal.source_url || undefined,
        },
        idempotencyKey: `wraith-threat-dna:${signal.id}`,
      });
    } catch (error) {
      console.error('[WRAITH] Failed to enqueue threat DNA analysis:', error);
    }

    // Enqueue signal for batch processing instead of immediate processing
    // This is more scalable and prevents memory issues
    try {
      const priority = rulesResult.priority === 'p1' ? 1 :
                      rulesResult.priority === 'p2' ? 2 : 5;
      
      const { error: queueError } = await supabase.rpc('enqueue_signal_processing', {
        signal_id: signal.id,
        priority_level: priority
      });

      if (queueError) {
        console.error('Error enqueuing signal:', queueError);
        // Don't fail the main request if queuing fails
      } else {
        console.log(`Signal ${signal.id} enqueued for processing with priority ${priority}`);
      }
    } catch (error) {
      console.error('Failed to enqueue signal:', error);
      // Don't fail the main request if queuing fails
    }

    return new Response(
      JSON.stringify({ 
        signal_id: signal.id,
        status: 'enqueued',
        message: 'Signal enqueued for batch processing'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ingest-signal:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
