// _shared/admission/profiles/external-crawled.ts
// EXTERNAL / CRAWLED admission profile (Phase B). LEGACY remains authoritative; this is the
// extraction proven byte-for-byte against legacy via the Deno parity harness BEFORE flag-on.
//
// SLICE 1 (this increment): pre-gates only — the deterministic gates BEFORE the AI classifier
// (#256 contract, F-034.1/.2/.3/.4/.5/.7/.8/.9, FP filter, test filter). Verbatim lift of
// ingest-signal/index.ts L287→L510. `return new Response(...)` → terminal AdmissionResult whose
// `body` is the IDENTICAL object legacy serialized. console.* lines preserved verbatim. The only
// side effect is the #256 recordTelemetry (injected, so the harness captures it). Time is the one
// DI seam (deps.now) so the stale-CVE year + telemetry durationMs are deterministic in test
// (timestamps/duration are on the approved nondeterminism allowlist).
//
// Slices 2-5 (classify / dedup / relevance / insert) + the post-insert tail boundary land in
// later increments. `runExternalCrawledAdmission` therefore still throws — controller stays
// disabled (flag defaults to legacy).
import { isFalsePositiveContent } from "../../keyword-matcher.ts";
import { isTestContent } from "../../signal-relevance-scorer.ts";
import type { AdmissionContext, AdmissionResult, SignalCandidate, StageResult } from "../types.ts";

export class AdmissionExtractionPending extends Error {}

// Telemetry payload shape mirrors _shared/observability.ts recordTelemetry's 2nd arg.
export type RecordTelemetry = (client: unknown, payload: Record<string, unknown>) => Promise<void> | void;

// Inputs the pre-gates read (all derived BEFORE L287 in ingest-signal; client validation is a
// separate earlier stage, so validatedExplicitClientId arrives resolved). raw_json is mutated
// in place exactly as legacy does (F-034.4/.5/.7).
export interface PreGateInput {
  validatedExplicitClientId: string | null;
  tenant_broadcast?: { scope?: string } | null;
  source_key?: string | null;
  text?: string | null;
  event?: { title?: string } | null;
  url?: string | null;
  source_url?: string | null;
  raw_json: Record<string, any> | null;
  fallback_severity?: string | null;     // F-034.4 may cap this to 'low'
  skip_relevance_gate?: boolean;
  callerKind: string;                     // caller.kind — passed in, never rebuilt
}

export interface PreGateDeps {
  supabase: unknown;                      // dummy in tests; real service-role client in prod
  recordTelemetry: RecordTelemetry;
  now: () => number;                      // DI clock (= Date.now in prod)
  requestStartedAt: number;
}

const term = (r: AdmissionResult): StageResult => ({ kind: "terminal", result: r });

/**
 * Verbatim pre-gates (L287→L510). Returns a terminal AdmissionResult on any reject, else
 * {kind:'continue'} (after applying F-034.4/.5/.7 in-place mutations to input.raw_json and
 * returning the possibly-capped fallback_severity via the continue marker's mutation of input).
 */
export async function preGates(input: PreGateInput, deps: PreGateDeps): Promise<StageResult> {
  const { validatedExplicitClientId, tenant_broadcast, source_key, text, event, raw_json } = input;
  const callerKind = input.callerKind;

  // ── #256 Phase 1 — missing client_id ──
  if (!validatedExplicitClientId && !tenant_broadcast) {
    const previewText = (text || JSON.stringify(event) || "").toString().substring(0, 200);
    console.warn(`[#256 Phase 1] REJECTED: signal lacks client_id and tenant_broadcast. source_key=${source_key ?? "none"} preview="${previewText}"`);
    await deps.recordTelemetry(deps.supabase, {
      functionName: "ingest-signal",
      durationMs: deps.now() - deps.requestStartedAt,
      status: "error",
      errorClass: "other",
      errorMessage: "contract_rejected:missing_client_id",
      context: { rejection_reason: "missing_client_id", ticket: "#256", phase: 1, source_key: source_key ?? null, caller_kind: callerKind },
    });
    return term({
      outcome: "rejected", reason: "missing_client_id", httpStatusHint: 400, payloadShape: "rejected",
      body: { status: "rejected", reason: "missing_client_id", message: "client_id is required. Cross-tenant signal scoring was removed 2026-05-23 (#256) — callers must pass an explicit client_id or use tenant_broadcast (Phase 3, not yet implemented).", ticket: "#256", phase: 1, source_key: source_key ?? null },
    });
  }

  // ── #256 Phase 1 — tenant_broadcast not implemented ──
  if (!validatedExplicitClientId && tenant_broadcast) {
    console.warn(`[#256 Phase 1] tenant_broadcast rejected: routing not yet implemented (scope=${tenant_broadcast.scope})`);
    await deps.recordTelemetry(deps.supabase, {
      functionName: "ingest-signal",
      durationMs: deps.now() - deps.requestStartedAt,
      status: "error",
      errorClass: "other",
      errorMessage: "contract_rejected:broadcast_not_implemented",
      context: { rejection_reason: "broadcast_not_implemented", ticket: "#256", phase: 1, broadcast_scope: tenant_broadcast.scope, source_key: source_key ?? null, caller_kind: callerKind },
    });
    return term({
      outcome: "rejected", reason: "broadcast_not_implemented", httpStatusHint: 501, payloadShape: "rejected",
      body: { status: "rejected", reason: "broadcast_not_implemented", message: `tenant_broadcast routing (scope=${tenant_broadcast.scope}) is reserved for #256 Phase 3 and not yet implemented. Until then, pass an explicit client_id.`, ticket: "#256", phase: 1 },
    });
  }

  const signalText = text || JSON.stringify(event);

  // ── F-034 trustworthiness governance ──
  const effectiveUrl: string | null = (input.source_url || input.url || null) as string | null;
  const effectiveTitle: string = (raw_json?.title || event?.title || (text ? text.slice(0, 200) : "")) as string;

  // F-034.1 — null source_url (unless pre-vetted)
  if (!effectiveUrl && !input.skip_relevance_gate) {
    console.log(`[F-034.1] Reject — null source_url, not pre-vetted: "${signalText.slice(0, 80)}"`);
    return term({ outcome: "rejected", reason: "null_source_url", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "null_source_url", message: "source_url required for auditable signal provenance" } });
  }

  // F-034.2 — MSN aggregator
  if (effectiveUrl && /^https?:\/\/(www\.)?msn\.com\//i.test(effectiveUrl)) {
    console.log(`[F-034.2] Reject — MSN aggregator (paragraph-merger risk): ${effectiveUrl}`);
    return term({ outcome: "rejected", reason: "aggregator_url_not_canonical", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "aggregator_url_not_canonical", message: "aggregator-hosted URLs produce chimeric signals; follow to publisher URL or drop" } });
  }

  // F-034.3 — paragraph-fragment title
  if (effectiveTitle && (effectiveTitle.startsWith("…") || effectiveTitle.startsWith("..."))) {
    console.log(`[F-034.3] Reject — paragraph-fragment title: "${effectiveTitle.slice(0, 80)}"`);
    return term({ outcome: "rejected", reason: "paragraph_fragment_title", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "paragraph_fragment_title", message: "title is a mid-sentence snippet, not a coherent headline" } });
  }

  // F-034.4 — opinion URL severity cap (mutation, not reject)
  if (effectiveUrl && /\/(opinion|letters|columnists?|editorial)\//i.test(effectiveUrl)) {
    if (input.fallback_severity && ["medium", "high", "critical"].includes(input.fallback_severity)) {
      input.fallback_severity = "low";
    }
    if (raw_json) { (raw_json as any).severity_capped_by_governance = true; }
    console.log(`[F-034.4] Severity capped to 'low' (opinion URL): ${effectiveUrl}`);
  }

  // F-034.5 — source-class canonicalization by host (mutation)
  if (effectiveUrl && raw_json) {
    const HOST_TO_CLASS: Array<[RegExp, string]> = [
      [/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, "twitter"],
      [/^https?:\/\/(www\.|old\.|new\.)?reddit\.com\//i, "reddit"],
      [/^https?:\/\/(www\.)?threads\.com\//i, "threads"],
      [/^https?:\/\/(www\.)?instagram\.com\//i, "instagram"],
      [/^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//i, "facebook"],
      [/^https?:\/\/(www\.)?(t\.me|telegram\.org)\//i, "telegram"],
      [/^https?:\/\/(www\.)?bsky\.app\//i, "bluesky"],
      [/^https?:\/\/(www\.)?(tiktok\.com)\//i, "tiktok"],
    ];
    const claimedSource = (raw_json.source || raw_json.monitor || "").toString().toLowerCase();
    for (const [re, canonical] of HOST_TO_CLASS) {
      if (re.test(effectiveUrl) && !claimedSource.includes(canonical)) {
        (raw_json as any).source = canonical;
        (raw_json as any).source_class_corrected_by_governance = true;
        break;
      }
    }
  }

  // F-034.8 — stale CVE
  const STALE_CVE_THRESHOLD_YEARS = 5;
  const cveMatch = (effectiveTitle + " " + (signalText ?? "")).match(/CVE-(\d{4})-\d+/i);
  if (cveMatch && !input.skip_relevance_gate) {
    const cveYear = parseInt(cveMatch[1], 10);
    const currentYear = new Date(deps.now()).getUTCFullYear();
    if (Number.isFinite(cveYear) && (currentYear - cveYear) >= STALE_CVE_THRESHOLD_YEARS) {
      console.log(`[F-034.8] Reject stale CVE — ${cveMatch[0]} (${currentYear - cveYear}y old): "${effectiveTitle.slice(0, 80)}"`);
      return term({ outcome: "rejected", reason: "stale_advisory", httpStatusHint: 200, payloadShape: "rejected",
        body: { status: "rejected", reason: "stale_advisory", message: `${cveMatch[0]} is ${currentYear - cveYear} years old; refusing to surface as current threat intel` } });
    }
  }

  // F-034.9 — null-result signal
  const NULL_RESULT_PATTERNS = [
    /search\s+results?\s+indicate\s+no\s+(recent\s+)?(information|results?|signals?|news|data)/i,
    /no\s+(recent\s+)?(information|results?|signals?|news|data)\s+(found|available)/i,
    /search\s+found\s+nothing\s+(actionable|relevant)/i,
  ];
  const fullContentForNullCheck = `${effectiveTitle}\n${signalText ?? ""}`;
  if (!input.skip_relevance_gate && NULL_RESULT_PATTERNS.some((re) => re.test(fullContentForNullCheck))) {
    console.log(`[F-034.9] Reject — null-result signal (search reported nothing actionable): "${effectiveTitle.slice(0, 80)}"`);
    return term({ outcome: "rejected", reason: "null_result_signal", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "null_result_signal", message: "signal content reports the search itself found nothing; not actionable intelligence" } });
  }

  // F-034.7 — relevance_score normalization (mutation)
  if (raw_json && typeof (raw_json as any).relevance_score === "number") {
    const orig = (raw_json as any).relevance_score as number;
    if (orig > 1.0) {
      (raw_json as any).relevance_score_raw = orig;
      (raw_json as any).relevance_score = Math.min(orig / 100, 1.0);
      (raw_json as any).relevance_score_normalized_by_governance = true;
    }
  }

  // FP filter
  if (isFalsePositiveContent(signalText)) {
    console.log(`[FP Filter] Rejecting false positive signal: ${signalText.substring(0, 100)}...`);
    return term({ outcome: "rejected", reason: "false_positive_pattern", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "false_positive_pattern", message: "Content matches known false positive pattern" } });
  }

  // test filter
  if (isTestContent(signalText)) {
    console.log(`[Test Filter] Rejecting test content: ${signalText.substring(0, 100)}...`);
    return term({ outcome: "rejected", reason: "test_content", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "test_content", message: "Test/verification content rejected from production pipeline" } });
  }

  return { kind: "continue" };
}

// ── SLICE 2: classify ── verbatim lift of ingest-signal L740-982: few-shot calibration
// (tenant-scoped DB reads), the gpt-4o-mini classifier call, result handling (scraped-news
// verbatim normalization, confidence normalization, skip-gate floor, rules-severity override,
// historical guardrail), fallback classification, and the unknown-category reject. The AI
// gateway + Supabase are injected (deps) so the harness replays AI + stubs DB. The classifier's
// telemetry + DLQ-on-failure are behaviors of callAiGatewayJson (the injected gateway), captured
// by the replay stub. Time is not used here.
export interface ClassifyWork {
  signalText: string;
  signalLocation: string | null;
  rulesSeverity?: string | null;          // rulesResult.severity
  explicitClientId: string | null;
  signalRaw: Record<string, any>;
  raw_json: Record<string, any> | null;
  fallback_category?: string | null;
  fallback_severity?: string | null;
  skip_relevance_gate?: boolean;
  isQaTest: boolean;                       // sourceType==='qa_test' || rawBody.sourceType==='qa_test' || is_test===true
  classification?: any;                    // OUTPUT
}
export interface ClassifyDeps {
  supabase: any;
  callAiGatewayJson: (args: any) => Promise<{ data?: any; error?: any }>;
}

export async function classify(work: ClassifyWork, deps: ClassifyDeps): Promise<StageResult> {
  const { signalText, signalLocation, rulesSeverity, explicitClientId, signalRaw, raw_json,
    fallback_category, fallback_severity, skip_relevance_gate } = work;
  const supabase = deps.supabase;

  let classification: any = {
    normalized_text: signalText,
    entity_tags: [],
    location: signalLocation,
    category: "unknown",
    severity: rulesSeverity || "medium",
    confidence: 0.5,
  };

  // #130 Phase 0B — tenant-scoped few-shot calibration (fail-closed if no tenant context)
  let fewShotTenantId: string | null = null;
  if (explicitClientId) {
    const { data: fewShotClientRow } = await supabase
      .from("clients").select("tenant_id").eq("id", explicitClientId).maybeSingle();
    fewShotTenantId = fewShotClientRow?.tenant_id ?? null;
  }

  let fewShotBlock = "";
  let fewShotTelemetry: { state: string; tenant_id: string | null; examples: number } = {
    state: "unknown", tenant_id: fewShotTenantId, examples: 0,
  };
  try {
    if (!fewShotTenantId) {
      fewShotTelemetry = { state: "skipped_no_tenant", tenant_id: null, examples: 0 };
      console.log(`[#130 telemetry] ingest-signal few_shot=skipped reason=no_tenant_context`);
    } else {
      const { data: feedbackEvents } = await supabase
        .from("feedback_events")
        .select("feedback, notes, correction, object_id, signals!inner(tenant_id)")
        .eq("object_type", "signal")
        .eq("signals.tenant_id", fewShotTenantId)
        .in("feedback", ["irrelevant", "wrong_severity", "confirmed"])
        .not("notes", "is", null)
        .order("created_at", { ascending: false })
        .limit(8);

      if (feedbackEvents && feedbackEvents.length > 0) {
        const signalIds = feedbackEvents.map((e: any) => e.object_id).filter(Boolean);
        const { data: signalTitles } = signalIds.length > 0
          ? await supabase.from("signals").select("id, title, severity, category").in("id", signalIds)
          : { data: [] };
        const titleMap = Object.fromEntries((signalTitles || []).map((s: any) => [s.id, s]));

        const examples = feedbackEvents
          .map((ex: any) => {
            const sig = titleMap[ex.object_id];
            if (!sig) return null;
            if (ex.feedback === "irrelevant") return `- IRRELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ""}`;
            if (ex.feedback === "wrong_severity") return `- SEVERITY CORRECTION [${sig.severity} → ${ex.correction || "?"}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ""}`;
            if (ex.feedback === "confirmed") return `- CONFIRMED RELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"`;
            return null;
          })
          .filter(Boolean);

        if (examples.length > 0) {
          fewShotBlock = "\n\nANALYST CALIBRATION EXAMPLES (learn from these real corrections):\n" + examples.join("\n");
          fewShotTelemetry = { state: "applied", tenant_id: fewShotTenantId, examples: examples.length };
          console.log(`[#130 telemetry] ingest-signal few_shot=applied tenant=${fewShotTenantId} examples=${examples.length}`);
        } else {
          fewShotTelemetry = { state: "applied_empty", tenant_id: fewShotTenantId, examples: 0 };
          console.log(`[#130 telemetry] ingest-signal few_shot=applied_empty tenant=${fewShotTenantId} (no tenant-local feedback yet)`);
        }
      } else {
        fewShotTelemetry = { state: "applied_empty", tenant_id: fewShotTenantId, examples: 0 };
        console.log(`[#130 telemetry] ingest-signal few_shot=applied_empty tenant=${fewShotTenantId} (query returned 0)`);
      }
    }
  } catch (err) {
    fewShotTelemetry = { state: "error", tenant_id: fewShotTenantId, examples: 0 };
    console.warn(`[#130 telemetry] ingest-signal few_shot=error tenant=${fewShotTenantId} err=${err instanceof Error ? err.message : String(err)}`);
  }

  const classResult = await deps.callAiGatewayJson({
    model: "gpt-4o-mini",
    extraContext: {
      few_shot_state: fewShotTelemetry.state,
      few_shot_tenant_id: fewShotTelemetry.tenant_id,
      few_shot_examples: fewShotTelemetry.examples,
      explicit_client_id_provided: !!explicitClientId,
    },
    messages: [
      {
        role: "system",
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

SEVERITY RULES:
- critical: Immediate threat to life/safety, active sabotage in progress, ongoing breach, credible imminent attack
- high: Planned direct action within 7 days, serious legal order affecting operations, active malware campaign targeting sector
- medium: Activist monitoring, routine regulatory filing, general cyber indicator, planned protest >7 days out
- low: Historical event >90 days ago, informational/background, geopolitical context with no direct client nexus

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

Respond ONLY with valid JSON.`,
      },
      { role: "user", content: signalText },
    ],
    functionName: "ingest-signal",
    dlqOnFailure: true,
    dlqPayload: { signalText: signalText.substring(0, 500) },
  });

  if (classResult.data) {
    const sourceTag = String(signalRaw?.source || raw_json?.source || "");
    const isScrapedNews =
      sourceTag === "google_news_api" || sourceTag === "rss" || sourceTag === "rss_feed" || sourceTag === "GitHub Code Search";
    const llmFields = isScrapedNews ? { ...classResult.data, normalized_text: signalText } : classResult.data;
    classification = { ...classification, ...llmFields };
    if (classResult.data.confidence && classResult.data.confidence > 1) {
      classification.confidence = classResult.data.confidence / 100;
    }
    if (skip_relevance_gate && classification.confidence < 0.75) {
      classification.confidence = 0.80;
    }
    if (rulesSeverity) {
      classification.severity = rulesSeverity;
    }
    if (classResult.data.is_historical === true) {
      console.log(`[HISTORICAL GUARDRAIL] AI classified signal as historical — forcing severity to low`);
      if (!rulesSeverity) {
        classification.severity = "low";
      }
    }
  } else if (classResult.error) {
    console.warn(`[Classifier] AI classification failed: ${classResult.error}. signalText="${signalText.substring(0, 120)}"`);
  }

  if (classification.category === "unknown" && fallback_category) {
    console.log(`[Classifier Fallback] Using fallback_category=${fallback_category} for monitor-supplied signal`);
    classification.category = fallback_category;
    if (fallback_severity && !rulesSeverity) {
      classification.severity = fallback_severity;
    }
    if (classification.confidence < 0.70) {
      classification.confidence = 0.75;
    }
  }

  const isQaTestForCategory = work.isQaTest;
  if (
    classification.category === "unknown" &&
    !rulesSeverity &&
    !skip_relevance_gate &&
    !isQaTestForCategory
  ) {
    console.log(`[Category Filter] Rejecting uncategorizable signal: ${signalText.substring(0, 100)}...`);
    return { kind: "terminal", result: {
      outcome: "rejected", reason: "uncategorizable", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "uncategorizable", message: "AI classifier could not assign a category — signal lacks structure to be actionable intelligence" },
    } };
  }

  work.classification = classification;
  return { kind: "continue" };
}

export async function runExternalCrawledAdmission(
  _candidate: SignalCandidate,
  _ctx: AdmissionContext,
): Promise<AdmissionResult> {
  // Slices 2-5 not yet lifted; controller path must not be enabled. Flag defaults to legacy.
  throw new AdmissionExtractionPending(
    "external/crawled pipeline incomplete (pre-gates slice only). Controller disabled until all slices land + parity green.",
  );
}
