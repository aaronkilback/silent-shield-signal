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
import { dgicStage } from "../dgic-stage.ts";
import type { AdmissionContext, AdmissionResult, SignalCandidate, StageResult, WorkingSignal } from "../types.ts";

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

// ── SLICE 3: dedup ── verbatim lift of ingest-signal L1024-1303: content-hash + previously-
// rejected check, CVE dedup, URL dedup (30d), title dedup (24h), detect-duplicates invoke
// (exact 409 / near-dup ≥0.8 200), and the 0.5-0.8 same-story filing. Supabase (incl.
// functions.invoke), the AI gateway, and the clock are injected. Time uses deps.now (timestamps
// are on the approved nondeterminism allowlist).
//
// ⚠ PRESERVED LEGACY DEFECT (do NOT fix in this mechanical lift): on the same-story path,
// `signal.source_name`/`signal.source_url` reference `signal`, which legacy declares (const) only
// at the INSERT (a later slice) — so at dedup time it is in the temporal dead zone and throws
// ReferenceError while building the signal_updates insert argument. That throw is caught below
// ("AI check failed, proceeding with new signal") → fail-open. CONSEQUENCE: the same-story
// signal_updates filing + its rejected_content_hashes upsert + the `filed_as_update` return are
// DEAD CODE in legacy and never execute. The lift reproduces this exactly for byte-parity. The
// dead same-story filing is flagged as a separate post-Phase-B defect to fix deliberately.
export interface DedupWork {
  signalText: string;
  source_url?: string | null;
  classification: any;
  clientId: string | null;
  sourceType?: string | null;       // validationResult.data.sourceType
  rawBodySourceType?: string | null; // rawBody?.sourceType
  rawBodyIsTest?: boolean;          // rawBody?.is_test
  isTest?: boolean;                 // is_test
}
export interface DedupDeps {
  supabase: any;
  callAiGatewayJson: (args: any) => Promise<any>;
  now: () => number;
}

const dterm = (r: AdmissionResult): StageResult => ({ kind: "terminal", result: r });

export async function dedup(work: DedupWork, deps: DedupDeps): Promise<StageResult> {
  const { signalText, source_url, classification, clientId } = work;
  const supabase = deps.supabase;

  const encoder = new TextEncoder();
  const contentToHash = source_url ? `url:${source_url}` : signalText;
  const data = encoder.encode(contentToHash);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const contentHash = hashArray.map((b: number) => b.toString(16).padStart(2, "0")).join("");

  console.log(`Calculated content hash: ${contentHash.substring(0, 16)}... (basis: ${source_url ? "source_url" : "text"})`);

  const isQaTestEarly = work.sourceType === "qa_test" || work.rawBodySourceType === "qa_test";
  const { data: rejectedHash } = isQaTestEarly ? { data: null } : await supabase
    .from("rejected_content_hashes").select("id").eq("content_hash", contentHash).limit(1).maybeSingle();

  if (rejectedHash) {
    console.log(`[Rejected] Signal blocked - content was previously rejected/deleted`);
    return dterm({ outcome: "rejected", reason: "previously_rejected", httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "rejected", reason: "previously_rejected", message: "This content was previously deleted or marked irrelevant by an analyst" } });
  }

  const isQaTest = work.sourceType === "qa_test" || work.rawBodySourceType === "qa_test" || work.rawBodyIsTest === true || work.isTest === true;

  // CVE dedup
  if (!isQaTest) {
    const cveMatch = signalText.match(/CVE-\d{4}-\d+/gi);
    const cveIds = cveMatch ? [...new Set(cveMatch.map((c: string) => c.toUpperCase()))] : [];
    if (cveIds.length > 0) {
      const todayStart = new Date(deps.now());
      todayStart.setHours(0, 0, 0, 0);
      const { data: existingCve } = await supabase
        .from("signals").select("id, title")
        .gte("created_at", todayStart.toISOString())
        .or(cveIds.map((cve: string) => `title.ilike.%${cve}%,normalized_text.ilike.%${cve}%`).join(","))
        .limit(1);
      if (existingCve && existingCve.length > 0) {
        console.log(`[CVE-dedup] Duplicate CVE advisory blocked: ${cveIds.join(", ")} already filed as signal ${existingCve[0].id}`);
        return dterm({ outcome: "deduplicated", reason: "duplicate_cve", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: existingCve[0].id,
          body: { filtered: true, reason: "duplicate_cve", cve_ids: cveIds, existing_signal_id: existingCve[0].id, message: `CVE advisory already ingested today: ${cveIds.join(", ")}` } });
      }
    }
  }

  // URL dedup (30d)
  if (source_url && !isQaTest) {
    const thirtyDaysAgo = new Date(deps.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingByUrl } = await supabase
      .from("signals").select("id").eq("source_url", source_url).gte("created_at", thirtyDaysAgo).limit(1).maybeSingle();
    if (existingByUrl) {
      console.log(`[URL-dedup] Duplicate source URL blocked: ${source_url}`);
      return dterm({ outcome: "deduplicated", reason: "duplicate_url", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: existingByUrl.id,
        body: { status: "suppressed", reason: "duplicate_url", existing_signal_id: existingByUrl.id } });
    }
  }

  // Title dedup (24h)
  if (!isQaTest && signalText) {
    const titleLine = signalText.split("\n")[0].trim().substring(0, 200);
    if (titleLine.length > 20) {
      const oneDayAgo = new Date(deps.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existingByTitle } = await supabase
        .from("signals").select("id").ilike("title", `%${titleLine.substring(0, 80)}%`).gte("created_at", oneDayAgo).limit(1).maybeSingle();
      if (existingByTitle) {
        console.log(`[Title-dedup] Duplicate title blocked: "${titleLine.substring(0, 60)}..."`);
        return dterm({ outcome: "deduplicated", reason: "duplicate_title", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: existingByTitle.id,
          body: { status: "suppressed", reason: "duplicate_title", existing_signal_id: existingByTitle.id } });
      }
    }
  }

  // detect-duplicates (semantic near-dup)
  const dupCheck = isQaTest ? null : await supabase.functions.invoke("detect-duplicates", {
    body: { type: "signal", content: (classification.normalized_text || signalText).toString(), client_id: clientId || undefined, near_duplicate_threshold: 0.8, lookback_days: 30, use_semantic: true, autoCheck: false },
  });

  if (dupCheck?.data?.isDuplicate && dupCheck?.data?.exactMatch) {
    console.log(`EXACT duplicate detected - blocking signal creation`);
    return dterm({ outcome: "rejected", reason: "exact_duplicate", httpStatusHint: 409, payloadShape: "deduplicated", existing_signal_id: dupCheck.data.duplicate?.id,
      body: { error: "Duplicate signal detected and blocked", duplicate_of: dupCheck.data.duplicate?.id, message: dupCheck.data.message } });
  }

  if (dupCheck?.data?.nearDuplicateMatch && (dupCheck?.data?.duplicates || []).length > 0) {
    const top = dupCheck.data.duplicates[0];
    console.log(`NEAR duplicate detected (>=80%) - returning existing signal`);
    return dterm({ outcome: "deduplicated", reason: "near_duplicate", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: top?.id,
      body: { signal_id: top?.id, deduplicated: true, duplicate_of: top?.id, similarity_score: top?.similarity_score, lookback_days: dupCheck.data.lookback_days_used ?? 30, threshold: dupCheck.data.near_duplicate_threshold_used ?? 0.8, message: `Near-duplicate detected (similarity ${(top?.similarity_score ?? 0).toFixed(2)}). Returning existing signal.` } });
  }

  // Same-story filing (0.5-0.8) — see PRESERVED LEGACY DEFECT note above.
  if (dupCheck?.data?.duplicates && dupCheck.data.duplicates.length > 0) {
    const topMatch = dupCheck.data.duplicates[0];
    const similarity = topMatch?.similarity_score ?? 0;
    if (similarity >= 0.50 && similarity < 0.80 && topMatch?.id) {
      console.log(`[Same-Story] Moderate similarity ${(similarity * 100).toFixed(0)}% with signal ${topMatch.id} — checking if same story...`);
      try {
        const existingTitle = topMatch.title || "";
        const newTitle = (classification.normalized_text || signalText).substring(0, 300);
        const sameStoryCheck = await deps.callAiGatewayJson({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: 'You determine if two intelligence signals are about the same ongoing story/event. Return JSON with: {"same_story": boolean, "has_new_intel": boolean, "reason": "brief explanation"}. "same_story" means they describe the same event, policy, or situation. "has_new_intel" means the new signal contains genuinely new facts, developments, or outcomes not present in the existing one.' },
            { role: "user", content: `EXISTING SIGNAL: "${existingTitle}"\n\nNEW SIGNAL: "${newTitle}"\n\nAre these about the same story? Does the new one add genuinely new intelligence?` },
          ],
          functionName: "ingest-signal-same-story-check",
        });
        const sameStoryResult = sameStoryCheck as any;
        if (sameStoryResult?.same_story === true) {
          const newIntel = sameStoryResult?.has_new_intel === true;
          console.log(`[Same-Story] FILING as update on ${topMatch.id} (${newIntel ? "NEW INTEL" : "rehash"}): ${sameStoryResult.reason}`);
          const updateHashData = new TextEncoder().encode(`same-story|${topMatch.id}|${contentHash}`);
          const updateHashBuffer = await crypto.subtle.digest("SHA-256", updateHashData);
          const updateHash = Array.from(new Uint8Array(updateHashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
          const { data: existingUpdate } = await supabase
            .from("signal_updates").select("id").eq("content_hash", updateHash).maybeSingle();
          if (!existingUpdate) {
            await supabase.from("signal_updates").insert({
              signal_id: topMatch.id,
              content: (classification.normalized_text || signalText).substring(0, 2000),
              source_name: signal.source_name || "same-story-filing", // ⚠ TDZ throw (see note) — DO NOT change
              source_url: signal.source_url || null,
              content_hash: updateHash,
              metadata: { filed_reason: sameStoryResult.reason, similarity_score: similarity, original_content_hash: contentHash, has_new_intel: newIntel, same_story_check: true },
            });
          }
          await supabase.from("rejected_content_hashes").upsert({
            content_hash: contentHash, client_id: clientId, reason: newIntel ? "same_story_new_intel_filed" : "same_story_filed", original_signal_title: newTitle.substring(0, 200),
          }, { onConflict: "content_hash,client_id", ignoreDuplicates: true });
          return dterm({ outcome: "updated", reason: "filed_as_update", httpStatusHint: 200, payloadShape: "deduplicated", existing_signal_id: topMatch.id,
            body: { status: "filed_as_update", filed_on: topMatch.id, similarity_score: similarity, has_new_intel: newIntel, reason: sameStoryResult.reason, message: newIntel ? "Signal filed as new-intel update on existing story (no separate feed entry)." : "Signal filed as rehash update on existing story." } });
        } else {
          console.log(`[Same-Story] AI says different story — creating as new signal. Reason: ${sameStoryResult?.reason || "(no reason given)"}`);
        }
      } catch (sameStoryErr) {
        console.warn(`[Same-Story] AI check failed, proceeding with new signal:`, sameStoryErr);
      }
    }
  }

  return { kind: "continue" };
}

// ── SLICE 4: relevance-gate ── verbatim lift of ingest-signal L1419-1670: skip bypass, the
// PECL-calibrated AI relevance gate (2nd AI call, functionName 'ingest-signal-relevance-gate'),
// learning-profile threshold bias, per-source (Phase3C) threshold, reject (filtered_signals +
// rejected_content_hashes writes) / accept, and the fail-closed catch (filtered_signals write).
// Supabase + AI gateway injected. Fire-and-forget writes preserved verbatim.
export interface RelevanceWork {
  clientId: string | null;
  skip_relevance_gate?: boolean;
  classification: any;
  signalText: string;
  source_url?: string | null;
  source_key?: string | null;
  signalRaw: Record<string, any>;
  signalTitle: string;
  sourceType?: string | null;
  rawBodySourceType?: string | null;
  isTest?: boolean;
}
export interface RelevanceDeps {
  supabase: any;
  callAiGatewayJson: (args: any) => Promise<any>;
}

export async function relevance(work: RelevanceWork, deps: RelevanceDeps): Promise<StageResult> {
  const { clientId, skip_relevance_gate, classification, signalText, source_url, source_key, signalRaw, signalTitle } = work;
  const supabase = deps.supabase;

  if (skip_relevance_gate) {
    console.log(`[AI Relevance Gate] BYPASSED — upstream keyword matching already vetted this signal`);
  }
  if (clientId && !skip_relevance_gate) {
    try {
      const { data: clientForGate } = await supabase
        .from("clients").select("name, industry, locations, high_value_assets").eq("id", clientId).single();

      let approvedPatternBlock = "";
      let rejectedPatternBlock = "";
      let learnedThresholdAdjustment = 0;
      try {
        const { data: profiles } = await supabase
          .from("learning_profiles").select("profile_type, features")
          .in("profile_type", ["approved_signal_patterns", "rejected_signal_patterns"]).limit(2);
        if (profiles && profiles.length > 0) {
          const textLower = (classification.normalized_text || signalText).toLowerCase();
          for (const profile of profiles) {
            const features: Record<string, number> = profile.features || {};
            const topKeywords = Object.entries(features)
              .sort(([, a], [, b]) => (b as number) - (a as number)).slice(0, 12).map(([k]) => k).filter((k) => !k.startsWith("reason:"));
            const matchCount = topKeywords.filter((k) => textLower.includes(k)).length;
            if (profile.profile_type === "approved_signal_patterns") {
              if (topKeywords.length > 0) approvedPatternBlock = `\nPATTERNS ANALYSTS HAVE APPROVED: ${topKeywords.slice(0, 8).join(", ")}`;
              if (matchCount >= 2) learnedThresholdAdjustment -= 0.05;
            } else if (profile.profile_type === "rejected_signal_patterns") {
              if (topKeywords.length > 0) rejectedPatternBlock = `\nPATTERNS ANALYSTS HAVE REJECTED: ${topKeywords.slice(0, 8).join(", ")}`;
              if (matchCount >= 3) learnedThresholdAdjustment += 0.05;
            }
          }
        }
      } catch { /* non-blocking */ }

      if (clientForGate) {
        const gateResult = await deps.callAiGatewayJson({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
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

Respond with JSON: {"score": 0.0-1.0, "relevant": true/false, "primary_connection": "...", "reason": "one sentence"}`,
            },
            {
              role: "user",
              content: `CLIENT: ${clientForGate.name}
INDUSTRY: ${clientForGate.industry || "unknown"}
LOCATIONS: ${(clientForGate.locations || []).join(", ")}
KEY ASSETS: ${(clientForGate.high_value_assets || []).join(", ")}

SIGNAL:
${(classification.normalized_text || signalText).substring(0, 1500)}

Score this signal's relevance and classify the connection.`,
            },
          ],
          functionName: "ingest-signal-relevance-gate",
          extraBody: { max_completion_tokens: 120 },
        });

        const gateScore: number = gateResult.data?.score ?? (gateResult.data?.relevant === false ? 0.1 : 0.7);
        const gateReason: string = gateResult.data?.reason || "";
        const primaryConnection: string = gateResult.data?.primary_connection || "none";

        let relevanceThreshold = Math.min(0.55, Math.max(0.25, 0.30 + learnedThresholdAdjustment));
        if (learnedThresholdAdjustment !== 0) {
          console.log(`[Learning] Threshold adjusted by analyst patterns: ${learnedThresholdAdjustment > 0 ? "+" : ""}${learnedThresholdAdjustment.toFixed(2)} → ${relevanceThreshold.toFixed(2)}`);
        }
        if (source_key) {
          const { data: credScore } = await supabase
            .from("source_credibility_scores").select("current_credibility, total_signals").eq("source_key", source_key).maybeSingle();
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
          supabase.from("filtered_signals").insert({
            raw_text: (classification.normalized_text || signalText).substring(0, 2000),
            source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
            source_name: source_key || signalRaw?.source_name || null,
            client_id: clientId,
            filter_reason: "ai_relevance_gate",
            relevance_score: gateScore,
            relevance_reason: gateReason,
            primary_connection: primaryConnection,
          }).then(() => {}).catch(() => {});

          const encoder2 = new TextEncoder();
          const data2 = encoder2.encode(classification.normalized_text || signalText);
          const hashBuffer2 = await crypto.subtle.digest("SHA-256", data2);
          const hashArray2 = Array.from(new Uint8Array(hashBuffer2));
          const rejectedHash2 = hashArray2.map((b: number) => b.toString(16).padStart(2, "0")).join("");

          await supabase.from("rejected_content_hashes").insert({
            content_hash: rejectedHash2,
            client_id: clientId,
            reason: "ai_relevance_gate",
            original_signal_title: signalTitle.substring(0, 200),
          }).then(() => {}).catch(() => {});

          return { kind: "terminal", result: {
            outcome: "rejected", reason: "ai_relevance_gate", httpStatusHint: 200, payloadShape: "rejected",
            body: { status: "rejected", reason: "ai_relevance_gate", relevance_score: gateScore, primary_connection: primaryConnection, detail: gateReason, message: "Signal rejected by AI relevance gate — not actionable intelligence for this client" },
          } };
        } else {
          console.log(`[AI Relevance Gate] ACCEPTED (score ${gateScore.toFixed(2)}, connection: ${primaryConnection}): ${gateReason}`);
        }
      }
    } catch (gateError) {
      const gateErrMsg = gateError instanceof Error ? gateError.message : String(gateError);
      console.error("[AI Relevance Gate] Error (failing closed):", gateErrMsg);
      const isQaTestForGate = work.sourceType === "qa_test" || work.rawBodySourceType === "qa_test" || work.isTest === true;
      if (!isQaTestForGate) {
        supabase.from("filtered_signals").insert({
          raw_text: signalText.substring(0, 2000),
          source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
          source_name: source_key || signalRaw?.source_name || null,
          client_id: clientId,
          filter_reason: "ai_relevance_gate_error",
          relevance_score: null,
          relevance_reason: gateErrMsg.substring(0, 500),
          primary_connection: null,
        }).then(() => {}).catch(() => {});

        return { kind: "terminal", result: {
          outcome: "rejected", reason: "ai_relevance_gate_error", httpStatusHint: 200, payloadShape: "rejected",
          body: { status: "rejected", reason: "ai_relevance_gate_error", detail: gateErrMsg.substring(0, 200), message: "Signal rejected because the AI relevance gate could not be evaluated" },
        } };
      }
    }
  }
  return { kind: "continue" };
}

// ── SLICE 5: signals insert ── verbatim lift of ingest-signal L1672-1866: relevance scoring
// (scoreSignalRelevance) + suppress, event/surface-date, staleness gate, severity_score,
// quality_score, foreign-alignment, the signals insert (the 12th core effect), and insert
// success/failure. scoreSignalRelevance + foreign-alignment + clock are injected. The controller
// boundary ends HERE (at the insert); the post-insert orchestration tail stays in ingest-signal.
export interface InsertWork {
  classification: any;
  signalText: string;
  source_key?: string | null;
  skip_relevance_gate?: boolean;
  signalRaw: Record<string, any>;
  signalTitle: string;
  sourceId: string | null;
  clientId: string | null;
  matchedKeywords: string[];
  matchConfidence: string;
  source_url?: string | null;
  image_url?: string | null;
  is_test?: boolean;
  platform?: string | null;
  contentHash: string;
  classResultData?: any;            // classResult.data (for event_date)
}
export interface InsertDeps {
  supabase: any;
  now: () => number;
  scoreSignalRelevance: (supabase: any, text: string, category: string | null, severityNum: number, sourceKey: string | null) => Promise<{ score: number; recommendation: string; matchedPatterns: string[]; reason: string }>;
  extractMentions: (text: string) => string[];
  scoreForeignAlignment: (text: string, mentions: string[], author: string | null) => { score: number; indicators: any[]; matched_handles: any[]; matched_phrases: any[] };
}

export async function insert(work: InsertWork, deps: InsertDeps): Promise<StageResult> {
  const { classification, signalText, source_key, skip_relevance_gate, signalRaw, signalTitle,
    sourceId, clientId, matchedKeywords, matchConfidence, source_url, image_url, is_test, platform, contentHash } = work;
  const supabase = deps.supabase;

  const severityNum = classification.severity === "critical" ? 100 :
    classification.severity === "high" ? 75 :
    classification.severity === "medium" ? 50 :
    classification.severity === "low" ? 20 : 50;

  const relevanceResult = await deps.scoreSignalRelevance(
    supabase, classification.normalized_text || signalText, classification.category || null, severityNum, source_key || null,
  );

  console.log(`[Relevance] Score: ${relevanceResult.score.toFixed(2)}, Recommendation: ${relevanceResult.recommendation}, Patterns: ${relevanceResult.matchedPatterns.join(", ")}`);

  if (relevanceResult.recommendation === "suppress") {
    console.log(`[Relevance] SUPPRESSING signal: ${relevanceResult.reason}`);
    return { kind: "terminal", result: {
      outcome: "rejected", reason: relevanceResult.reason, httpStatusHint: 200, payloadShape: "rejected",
      body: { status: "suppressed", reason: relevanceResult.reason, relevance_score: relevanceResult.score, matched_patterns: relevanceResult.matchedPatterns, message: "Signal suppressed by relevance filter based on learned patterns" },
    } };
  }

  const signalStatus = "new";

  let eventDate: string | null = null;
  let surfaceDate: Date = new Date(deps.now());
  if (work.classResultData?.event_date) {
    try {
      const parsed = new Date(work.classResultData.event_date);
      if (!isNaN(parsed.getTime())) { eventDate = parsed.toISOString(); console.log(`[EventDate] AI-extracted event_date: ${eventDate}`); }
    } catch { /* ignore */ }
  }
  const rawPubDate = signalRaw?.pubDate || signalRaw?.published_date || signalRaw?.published || signalRaw?.date || signalRaw?.article_published_time;
  if (rawPubDate) {
    try { const parsed = new Date(rawPubDate); if (!isNaN(parsed.getTime())) surfaceDate = parsed; } catch { /* ignore */ }
  }
  if (!eventDate) eventDate = surfaceDate.toISOString();

  let isHistorical = false;
  let triageOverride: string | null = null;
  if (!skip_relevance_gate) {
    const cyberCategories = ["malware", "phishing", "intrusion", "data_exfil", "ddos", "ransomware"];
    const isCyber = cyberCategories.includes(classification.category || "");
    const cutoffDays = isCyber ? 730 : 365;
    const cutoff = new Date(deps.now());
    cutoff.setDate(cutoff.getDate() - cutoffDays);
    if (surfaceDate < cutoff) {
      const daysOld = Math.floor((deps.now() - surfaceDate.getTime()) / 86400000);
      isHistorical = true;
      triageOverride = "historical";
      console.log(`[Staleness] Routing to historical — surface_date ${surfaceDate.toISOString()} is ${daysOld} days old (limit: ${cutoffDays})`);
    }
  }

  const severityScore = (() => {
    const base = classification.severity === "critical" ? 90 : classification.severity === "high" ? 70 : classification.severity === "medium" ? 40 : 20;
    const adjustment = Math.round((relevanceResult.score - 0.5) * 20);
    return Math.max(0, Math.min(100, base + adjustment));
  })();

  const qualityScore = (() => {
    let q = 0;
    if (signalRaw?.url || signalRaw?.source_url || signalRaw?.link) q += 0.25;
    if ((classification.entity_tags?.length ?? 0) > 0) q += 0.25;
    if (classification.location) q += 0.25;
    if (classification.category) q += 0.125;
    if ((classification.normalized_text?.length ?? 0) > 50) q += 0.125;
    return q;
  })();

  const fa_text = `${signalTitle || ""} ${classification.normalized_text || signalText || ""}`;
  const fa_author = (signalRaw as { author_handle?: string; author?: { username?: string } })?.author_handle
    ?? (signalRaw as { author?: { username?: string } })?.author?.username ?? null;
  const fa_mentions = deps.extractMentions(fa_text);
  const fa = deps.scoreForeignAlignment(fa_text, fa_mentions, fa_author ? `@${fa_author.replace(/^@/, "")}` : null);

  const { data: signal, error: insertError } = await supabase
    .from("signals")
    .insert({
      source_id: sourceId,
      client_id: clientId,
      title: signalTitle,
      foreign_alignment_score: fa.score > 0 ? fa.score : null,
      foreign_alignment_indicators: fa.indicators,
      raw_json: {
        ...signalRaw,
        matched_keywords: matchedKeywords.length > 0 ? matchedKeywords : undefined,
        match_confidence: matchConfidence,
        match_timestamp: new Date(deps.now()).toISOString(),
        relevance_score: relevanceResult.score,
        relevance_patterns: relevanceResult.matchedPatterns,
        relevance_recommendation: relevanceResult.recommendation,
        foreign_alignment: fa.score > 0 ? { score: fa.score, indicators: fa.indicators, matched_handles: fa.matched_handles, matched_phrases: fa.matched_phrases } : undefined,
      },
      normalized_text: classification.normalized_text,
      entity_tags: classification.entity_tags,
      location: classification.location,
      category: classification.category,
      severity: classification.severity,
      severity_score: severityScore,
      quality_score: qualityScore,
      confidence: classification.confidence,
      relevance_score: relevanceResult.score,
      status: signalStatus,
      is_test: is_test || false,
      content_hash: contentHash,
      event_date: eventDate,
      triage_override: triageOverride,
      signal_type: isHistorical ? "historical" : null,
      source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
      image_url: image_url || signalRaw?.image_url || signalRaw?.og_image || signalRaw?.thumbnail || null,
      platform: platform ?? null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Insert error:", insertError);
    throw new Error(`Signal insert failed: ${insertError.message} (code: ${insertError.code}, details: ${insertError.details})`);
  }

  console.log(`Signal ingested: ${signal.id}${matchedKeywords.length > 0 ? ` (keywords: ${matchedKeywords.join(", ")})` : ""}`);

  // Controller boundary: admitted. ingest-signal runs the post-insert orchestration tail.
  return { kind: "terminal", result: { outcome: "admitted", signal_id: signal.id, httpStatusHint: 200, payloadShape: "accepted" } };
}

// ── SLICE 6 helpers (pure, verbatim from ingest-signal) ──
const RULES = {
  p1: { keywords: ["credible threat", "weapon", "kidnap", "active shooter", "bomb"], severity: "critical", priority: "p1", shouldOpenIncident: true },
  p2: { keywords: ["suspicious", "prowler", "tamper", "breach attempt", "intrusion"], severity: "high", priority: "p2", shouldOpenIncident: true },
};
export function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) return { severity: RULES.p1.severity, priority: RULES.p1.priority, shouldOpenIncident: RULES.p1.shouldOpenIncident, matchedRule: "p1", matchedKeyword: keyword };
  }
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) return { severity: RULES.p2.severity, priority: RULES.p2.priority, shouldOpenIncident: RULES.p2.shouldOpenIncident, matchedRule: "p2", matchedKeyword: keyword };
  }
  return { severity: null, priority: null, shouldOpenIncident: false, matchedRule: null, matchedKeyword: null };
}

const ABBREV_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|Sr|Jr|Inc|Corp|Co|Ltd|Ave|Blvd|Rd|U\.S|U\.K)$/i;
export function generateTitle(text: string, now: () => number = Date.now): string {
  if (!text || text.length === 0) return "Signal - " + new Date(now()).toISOString().slice(0, 16);
  let sentenceEnd = -1;
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    if (idx < 30) continue;
    if (text[idx] === ".") { const before = text.substring(Math.max(0, idx - 12), idx); if (ABBREV_RE.test(before)) continue; }
    sentenceEnd = idx + 1;
    break;
  }
  const honorSentence = sentenceEnd > 0;
  const TITLE_CAP = 200;
  const titleLength = honorSentence ? Math.min(sentenceEnd, TITLE_CAP) : TITLE_CAP;
  let title = text.substring(0, titleLength).trim();
  const truncatedAtCap = (!honorSentence && text.length > TITLE_CAP) || (honorSentence && sentenceEnd > TITLE_CAP);
  if (truncatedAtCap) title = title.replace(/\s+\S*$/, "") + "...";
  return title || "Signal - " + new Date(now()).toISOString().slice(0, 16);
}

// ── SLICE 6: prep ── verbatim lift of ingest-signal L512-738: signalRaw setup + source_url merge,
// novelty tracking (recordObservation DB read/write → signalRaw.novelty mutation), optional
// website fetch+AI (url path; mutates signalText/signalLocation/signalRaw), sourceId source-lookup
// (404/403 terminals), the #120 EXTERNAL_UNATTRIBUTED guard (warn + env-gated 400), and rulesResult
// (applyRules). DB / AI gateway / fetch / clock / strict-flag injected. Mutates work.{signalText,
// signalLocation, signalRaw, sourceId, rulesResult}.
export interface PrepWork {
  location?: string | null;
  raw_json: Record<string, any> | null;
  event?: any;
  signalText: string;
  source_url?: string | null;
  url?: string | null;
  source_key?: string | null;
  client_id?: string | null;
  clientIdCamel?: string | null;
  is_test_input?: boolean;
  signalLocation?: string | null;     // OUT
  signalRaw?: Record<string, any>;    // OUT
  sourceId?: string | null;           // OUT
  rulesResult?: any;                  // OUT
}
export interface PrepDeps {
  supabase: any;
  recordObservation: (supabase: any, clientId: string, kind: string, value: string) => Promise<any>;
  extractDomain: (url: string | null | undefined) => string | null;
  callAiGateway: (args: any) => Promise<{ content?: string }>;
  fetchFn: (url: string, init?: any) => Promise<Response>;
  now: () => number;
  strictSourceAttribution: boolean;
}

export async function prep(work: PrepWork, deps: PrepDeps): Promise<StageResult> {
  const { location, raw_json, event, source_url, url, source_key, client_id, clientIdCamel, is_test_input } = work;
  let signalText = work.signalText;
  let signalLocation = location || null;
  let signalRaw: Record<string, any> = raw_json || event || { text: signalText };
  if (source_url && !signalRaw.source_url) signalRaw = { ...signalRaw, source_url };

  const noveltyClientId = client_id || clientIdCamel || null;
  if (noveltyClientId) {
    try {
      const domain = deps.extractDomain(source_url) ?? deps.extractDomain(signalRaw?.source_url);
      const noveltyMeta: Record<string, unknown> = {};
      if (domain) noveltyMeta.domain = await deps.recordObservation(deps.supabase, noveltyClientId, "source_domain", domain);
      if (source_key) noveltyMeta.source_key = await deps.recordObservation(deps.supabase, noveltyClientId, "source_key", source_key);
      if (Object.keys(noveltyMeta).length > 0) signalRaw = { ...signalRaw, novelty: noveltyMeta };
    } catch (noveltyErr) {
      console.warn("[Novelty] non-blocking error:", noveltyErr instanceof Error ? noveltyErr.message : noveltyErr);
    }
  }

  if (url) {
    console.log("Fetching website content from:", url);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const websiteResponse = await deps.fetchFn(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SOCBot/1.0)", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!websiteResponse.ok) throw new Error(`Failed to fetch website: ${websiteResponse.status}`);
      const html = await websiteResponse.text();
      let textContent = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
        .replace(/<(main|article)[^>]*>([\s\S]*?)<\/(main|article)>/gi, (_match: string, _tag: string, content: string) => "\n\n" + content + "\n\n");
      textContent = textContent
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
      const contentForAnalysis = textContent.substring(0, 8000);
      console.log(`Extracted ${contentForAnalysis.length} characters from website`);
      const analysisResult = await deps.callAiGateway({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are a corporate security intelligence analyst specializing in threat assessment. Analyze web content for security-relevant information including:\n- Direct threats or security incidents\n- Activist campaigns or protests targeting corporations\n- Legal disputes or regulatory actions\n- Operational disruptions or risks\n- Reputation threats or negative publicity\n- Supply chain or infrastructure vulnerabilities\n\nProvide a structured, actionable summary focused on business impact.` },
          { role: "user", content: `Analyze this content from ${url}\n\nCONTENT:\n${contentForAnalysis}\n\nProvide a clear summary including:\n1. KEY FINDINGS: What security-relevant events or threats are described?\n2. AFFECTED PARTIES: Which companies, organizations, or projects are mentioned or impacted?\n3. THREAT LEVEL: Rate as CRITICAL, HIGH, MEDIUM, or LOW\n4. BUSINESS IMPACT: What are the potential operational, legal, or reputational consequences?\n5. ACTIONABLE INTEL: What specific details (dates, locations, actors, tactics) are relevant for security teams?\n\nBe specific and concise. Focus on facts, not speculation.` },
        ],
        functionName: "ingest-signal",
        extraBody: { max_completion_tokens: 1200 },
        dlqOnFailure: true,
        dlqPayload: { url, signalText: signalText.substring(0, 500) },
      });
      const analysis = analysisResult.content || "";
      signalText = `Website Analysis - ${url}\n\n${analysis}`;
      signalLocation = url;
      signalRaw = { url, analysis, snippet: textContent.substring(0, 500), scannedAt: new Date(deps.now()).toISOString() };
      console.log("Website analysis complete:", analysis.substring(0, 200));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Error fetching/analyzing website:", error);
      signalText = `Failed to scan website ${url}: ${errorMessage}`;
      signalRaw = { url, error: errorMessage };
    }
  }

  console.log("Ingesting signal:", signalText.substring(0, 100));

  let sourceId: string | null = null;
  if (source_key) {
    const { data: source, error: sourceError } = await deps.supabase.from("sources").select("id, status").eq("name", source_key).single();
    if (sourceError || !source) {
      console.error("Source not found:", source_key, sourceError?.message);
      return dterm({ outcome: "rejected", reason: "source_not_found", httpStatusHint: 404, payloadShape: "rejected", body: { error: "Source not found or inactive" } });
    }
    if (source.status !== "active") {
      return dterm({ outcome: "rejected", reason: "source_inactive", httpStatusHint: 403, payloadShape: "rejected", body: { error: `Source ${source_key} status=${source.status}` } });
    }
    sourceId = source.id;
  }

  const externalUrl = source_url || url || null;
  if (sourceId === null && externalUrl && !externalUrl.includes("example.com") && !externalUrl.includes("qa.test") && is_test_input !== true) {
    console.warn(`[ingest-signal] EXTERNAL_UNATTRIBUTED — source_id null, source_url=${externalUrl.substring(0, 120)} source_key=${source_key ?? "NOT_PROVIDED"} client_id=${client_id ?? clientIdCamel ?? "NOT_PROVIDED"}`);
    if (deps.strictSourceAttribution) {
      return dterm({ outcome: "rejected", reason: "missing_source_attribution", httpStatusHint: 400, payloadShape: "rejected",
        body: { error: "External signal blocked: missing source attribution", message: "Signals with source_url must pass a source_key that matches a registered sources row. Set source_key, register the source in the sources table, or set INGEST_STRICT_SOURCE_ATTRIBUTION=false to bypass this guard.", source_url: externalUrl, source_key_provided: source_key ?? null } });
    }
  }

  const rulesResult = applyRules(signalText);
  console.log("Rules matched:", rulesResult);

  work.signalText = signalText;
  work.signalLocation = signalLocation;
  work.signalRaw = signalRaw;
  work.sourceId = sourceId;
  work.rulesResult = rulesResult;
  return { kind: "continue" };
}

// ── ASSEMBLY ── compose the five proven stages into the external/crawled admission pipeline:
// preGates → classify → dedup → relevance → dgicStage(no-op) → insert. Each terminal short-
// circuits (returns its AdmissionResult). `classification` is threaded from classify into
// dedup/relevance/insert; `contentHash` is computed once (as dedup does — deterministic) and
// threaded to insert. Controller boundary ends at the insert; ingest-signal runs the post-insert
// orchestration tail. Phase B: NO DGIC stamp, NO quality_status change. Controller stays disabled
// (flag false) until wired + burned-in.
export async function runExternalCrawledAdmission(
  work: WorkingSignal,
  ctx: AdmissionContext,
): Promise<AdmissionResult> {
  let signalText = work.text || JSON.stringify(work.event);

  // 1. pre-gates (#256 contract, F-034, FP/test) — uses the original signalText
  const pre = await preGates(
    { validatedExplicitClientId: work.validatedExplicitClientId, tenant_broadcast: work.tenant_broadcast, source_key: work.source_key, text: work.text, event: work.event, url: work.url, source_url: work.source_url, raw_json: work.raw_json, fallback_severity: work.fallback_severity, skip_relevance_gate: work.skip_relevance_gate, callerKind: work.callerKind },
    { supabase: ctx.supabase, recordTelemetry: ctx.recordTelemetry, now: ctx.now, requestStartedAt: ctx.requestStartedAt },
  );
  if (pre.kind === "terminal") return pre.result;

  // 2. prep (signalRaw/novelty/website/sourceId/guard/rulesResult) — may rewrite signalText
  const prepWork: PrepWork = {
    location: work.location, raw_json: work.raw_json, event: work.event, signalText,
    source_url: work.source_url, url: work.url, source_key: work.source_key,
    client_id: work.client_id, clientIdCamel: work.clientIdCamel, is_test_input: work.is_test_input,
  };
  const pr = await prep(prepWork, {
    supabase: ctx.supabase, recordObservation: ctx.recordObservation, extractDomain: ctx.extractDomain,
    callAiGateway: ctx.callAiGateway, fetchFn: ctx.fetchFn, now: ctx.now, strictSourceAttribution: ctx.strictSourceAttribution,
  });
  if (pr.kind === "terminal") return pr.result;
  signalText = prepWork.signalText;                       // prep may have rewritten it (website path)
  const signalRaw = prepWork.signalRaw ?? {};
  const signalLocation = prepWork.signalLocation ?? null;
  const sourceId = prepWork.sourceId ?? null;
  const rulesSeverity = prepWork.rulesResult?.severity ?? null;

  // contentHash computed post-prep (prep-mutated signalText), threaded to insert (dedup recomputes identical)
  const contentToHash = work.source_url ? `url:${work.source_url}` : signalText;
  const hb = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contentToHash));
  const contentHash = Array.from(new Uint8Array(hb)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // 3. classify (produces classification)
  const clsWork: ClassifyWork = {
    signalText, signalLocation, rulesSeverity, explicitClientId: work.explicitClientId,
    signalRaw, raw_json: work.raw_json, fallback_category: work.fallback_category, fallback_severity: work.fallback_severity,
    skip_relevance_gate: work.skip_relevance_gate, isQaTest: work.isQaTest,
  };
  const cls = await classify(clsWork, { supabase: ctx.supabase, callAiGatewayJson: ctx.callAiGatewayJson });
  if (cls.kind === "terminal") return cls.result;
  const classification = clsWork.classification;

  // 4. dedup
  const dd = await dedup(
    { signalText, source_url: work.source_url, classification, clientId: work.clientId, sourceType: work.sourceType, rawBodySourceType: work.rawBodySourceType, rawBodyIsTest: work.rawBodyIsTest, isTest: work.isTest },
    { supabase: ctx.supabase, callAiGatewayJson: ctx.callAiGatewayJson, now: ctx.now },
  );
  if (dd.kind === "terminal") return dd.result;

  // 5. signalTitle derived post-dedup via generateTitle (was the wiring gap)
  const signalTitle = generateTitle(classification.normalized_text || signalText, ctx.now);

  // 6. relevance gate
  const rel = await relevance(
    { clientId: work.clientId, skip_relevance_gate: work.skip_relevance_gate, classification, signalText, source_url: work.source_url, source_key: work.source_key, signalRaw, signalTitle, sourceType: work.sourceType, rawBodySourceType: work.rawBodySourceType, isTest: work.isTest },
    { supabase: ctx.supabase, callAiGatewayJson: ctx.callAiGatewayJson },
  );
  if (rel.kind === "terminal") return rel.result;

  // 7. DGIC seam (Phase B: no-op)
  const gate = await dgicStage(work, ctx);
  if (gate.kind === "terminal") return gate.result;

  // 8. insert (controller boundary). Only reached on the fully-admitted path.
  const ins = await insert(
    { classification, signalText, source_key: work.source_key, skip_relevance_gate: work.skip_relevance_gate, signalRaw, signalTitle, sourceId, clientId: work.clientId, matchedKeywords: work.matchedKeywords, matchConfidence: work.matchConfidence, source_url: work.source_url, image_url: work.image_url, is_test: work.isTest, platform: work.platform, contentHash, classResultData: work.classResultData },
    { supabase: ctx.supabase, now: ctx.now, scoreSignalRelevance: ctx.scoreSignalRelevance, extractMentions: ctx.extractMentions, scoreForeignAlignment: ctx.scoreForeignAlignment },
  );
  if (ins.kind === "terminal") return ins.result;
  return { outcome: "admitted", httpStatusHint: 200, payloadShape: "accepted" }; // defensive; insert always returns terminal
}
