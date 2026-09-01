// =====================================================================================
// DGIC P1 — evaluateDGIC()  ·  DRAFT v0.2 — REVIEW ONLY. DO NOT WIRE IN / DO NOT DEPLOY.
// Intended home (later): supabase/functions/_shared/dgic.ts, called from ingest-signal.
// =====================================================================================
// Refinements in v0.2 (answering the pre-approval architecture challenges):
//  #1 AUDIT AUTHORITY: the verdict is stamped on the signals row inside the ATOMIC signal
//     insert (never dropped) → all baseline analytics derive from `signals`. `dgic_evaluations`
//     is reserved for EXCEPTIONS/diagnostics (audit_error detail), written AWAITED (rare).
//  #2 HEURISTIC CERTAINTY: lexical/regex checks (title fragment, title<->source overlap,
//     homepage shape) are SUSPICION only → they go in `semantic_review[]` and NEVER set
//     would_be sub_grade. Only deterministic facts (structural) and policy (doctrine) do.
//  #3 CHRONOLOGY: no arbitrary constant. Tolerance is config-driven + justified (max global
//     UTC offset span). FUTURE event_ts is VALID (forward-looking intel) and is NOT a
//     violation. The only deterministic chronology fact is publication-after-detection.
//     Staleness is a DOCTRINE concern, not an incoherence.
//  #4 TAXONOMY: findings split into structural | doctrine | semantic_review.
//  #5 LATENCY: returns `evaluator_compute_ms` (pure sync). Caller measures
//     `total_dgic_overhead_ms`. Both go to ingest-signal's EXISTING function_telemetry
//     context — NOT onto the signals table.
//  #6 SCHEMA DISCIPLINE: only queryable/visibility-driving attributes are returned as
//     signal columns. Free-text explanations go into raw_json. Latency goes to telemetry.
//  Still: NO AI inline, NO DB, NO network, NO enforcement, NO visibility change.
// =====================================================================================

export const DGIC_VERSION = "v0.2";

// ---- Finding taxonomy (#4) ----
// STRUCTURAL = deterministic, objectively-true facts (no judgement).
export type StructuralViolation =
  | "SOURCE_URL_MISSING" | "SOURCE_URL_UNPARSEABLE"
  | "PROVENANCE_MISSING"               // no platform AND/OR no retrieval path
  | "PUBLICATION_AFTER_DETECTION";     // detected before published = impossible (beyond skew)
// DOCTRINE = policy-defined (deterministic given policy).
export type DoctrineViolation =
  | "ENTITY_LINKAGE_NONE"
  | "EVENT_TS_ABSENT"
  | "PUBLICATION_TS_ABSENT"            // only for publisher-class sources
  | "STALE_EVENT"                      // older than configured horizon and not flagged historical
  | "CRIT_HIGH_REASONING_REQUIRED"
  | "CRIT_HIGH_CONFIDENCE_EXPL_REQUIRED";
// SEMANTIC_REVIEW = heuristic/AI suspicion ONLY — never sets sub_grade; routes to enrichment.
export type SemanticReview =
  | "TITLE_FRAGMENT_SUSPECTED" | "TITLE_SOURCE_MATCH_UNVERIFIED"
  | "SOURCE_URL_NONCANONICAL_SUSPECTED"
  | "RELEVANCE_RATIONALE_QUALITY_UNVERIFIED" | "REASONING_ADEQUACY_UNVERIFIED"
  | "CONFIDENCE_EXPLANATION_QUALITY_UNVERIFIED";

export type Disposition = "ignore" | "monitor" | "enrich" | "escalate" | "investigate";
export type DgicStatus = "decision_grade" | "sub_grade" | "audit_error";

// Config (loaded ONCE by the caller from dgic_config; passed in to keep this fn pure/no-I/O).
export interface DgicConfig {
  skewToleranceHours: number;     // pub-after-detection tolerance. DEFAULT 26 — JUSTIFIED:
                                  //   global UTC offsets span UTC-12..UTC+14 = 26h. A source
                                  //   in UTC+14 timestamped "now" can appear up to 26h "ahead"
                                  //   of our UTC detection under tz mishandling. P1 records the
                                  //   real publication_ts-detection_ts distribution (derivable
                                  //   from signals columns) to recalibrate empirically.
  staleHorizonDays: number;       // DEFAULT 90 — matches existing is_historical threshold.
  monitorBand: number;            // provisional; recorded not enforced. Calibrated in P1.
  excludedCategories: string[];
  publisherPlatforms: string[];   // platforms for which publication_ts is doctrine-required
}
export const DGIC_DEFAULT_CONFIG: DgicConfig = {
  skewToleranceHours: 26,
  staleHorizonDays: 90,
  monitorBand: 0.45,
  excludedCategories: ["sports", "entertainment", "retail", "lifestyle"],
  publisherPlatforms: ["news", "rss", "google_news_api", "web", "facebook", "instagram", "twitter", "reddit"],
};

export interface DgicInput {
  title?: string | null;
  source_url?: string | null;
  severity?: string | null;
  category?: string | null;
  relevance_score?: number | null;
  confidence?: number | null;
  event_date?: string | null;     // event_ts (may be PAST historical or FUTURE planned)
  created_at?: string | null;     // detection_ts
  source_path?: string | null;
  client_id?: string | null;
  tenant_id?: string | null;
  raw_json?: Record<string, unknown> | null;
}

export interface DgicFindings { structural: StructuralViolation[]; doctrine: DoctrineViolation[]; semantic_review: SemanticReview[]; }

export interface DgicOutput {
  // (a) columns to merge into the signals insert (queryable / visibility-driving only) — #6
  signalPatch: {
    dgic_status: DgicStatus;
    dgic: { version: string; evaluated_at: string; findings: DgicFindings };
    connection_type: string | null;
    publication_ts: string | null;
    ai_proposed_disposition: Disposition;
  };
  // (b) free-text intel that belongs in raw_json, NOT promoted to hot-table columns — #6
  rawJsonPatch: { dgic_confidence_explanation: string | null; dgic_entity_linkage_explanation: string | null };
  // (c) latency for ingest-signal's EXISTING function_telemetry context — #5/#6 (not on signals)
  telemetry: { dgic_evaluator_compute_ms: number };
}

// ---- cheap synchronous helpers (no AI, no I/O) ----
const norm = (s?: string | null) => (s ?? "").trim();
const present = (s?: string | null) => norm(s).length > 0;
const normScore = (v?: number | null) => (v == null || Number.isNaN(v)) ? null : (v > 1 ? v / 100 : v);
const AGGREGATOR_HOSTS = ["msn.com", "news.google.com"];
const PEOPLE_COURT_DOMAINS = ["courts.gov", "canlii.org", "justice.gc.ca", "pacermonitor.com"];

function hostOf(url: string): string | null { try { let h = new URL(url).host.toLowerCase(); return h.startsWith("www.") ? h.slice(4) : h; } catch { return null; } }
function parseable(url: string): boolean { try { new URL(url); return true; } catch { return false; } }

// HEURISTIC (#2): homepage/profile shape — suspicion, not a structural truth.
function looksNonCanonical(url: string): boolean {
  try {
    const u = new URL(url); const host = (u.host || "").toLowerCase();
    if (AGGREGATOR_HOSTS.some(a => host === a || host.endsWith("." + a))) return true;
    if (PEOPLE_COURT_DOMAINS.some(d => host === d || host.endsWith("." + d))) return false;
    return u.pathname.split("/").filter(p => p.length > 0).length < 2;
  } catch { return false; }
}
// HEURISTIC (#2): fragment-title — suspicion only.
function looksLikeFragmentTitle(t: string): boolean {
  const s = t.trim();
  return s.length < 8 || /[,;:]\s*$/.test(s) || /\.\.\.$|…$/.test(s) || s.split(/\s+/).length > 40;
}
// HEURISTIC (#2): lexical (NOT semantic) overlap — suspicion only.
function lowTokenOverlap(a: string, b: string): boolean {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return true;
  let hits = 0; for (const w of ta) if (tb.has(w)) hits++;
  return hits / ta.size < 0.3;
}
const toTs = (s?: string | null) => { if (!present(s)) return null; const ms = Date.parse(s as string); return Number.isNaN(ms) ? null : ms; };

function proposeDisposition(a: { severity: string; category: string; conn: string | null; rel: number | null; subGrade: boolean; cfg: DgicConfig }): Disposition {
  if (a.cfg.excludedCategories.includes(a.category)) return "ignore";
  if (a.severity === "critical" && a.conn === "direct_naming") return "escalate";
  if ((a.severity === "critical" || a.severity === "high") && ["direct_naming", "threat_actor", "supply_chain"].includes(a.conn ?? "")) return "investigate";
  if (a.subGrade && (a.severity === "high" || a.severity === "medium")) return "enrich";
  if ((a.rel ?? 0) >= a.cfg.monitorBand) return "monitor";
  return "ignore";
}

/**
 * PURE + SYNCHRONOUS. No AI, no DB, no network (#1). Advisory only — never decides admission
 * or visibility (#4). Returns columns to stamp, raw_json patch, and compute latency.
 */
export function evaluateDGIC(input: DgicInput, cfg: DgicConfig = DGIC_DEFAULT_CONFIG): DgicOutput {
  const t0 = performance.now();
  const raw = (input.raw_json ?? {}) as Record<string, any>;
  const sev = norm(input.severity).toLowerCase() || "low";
  const cat = norm(input.category).toLowerCase();
  const isHigh = sev === "critical" || sev === "high";
  const f: DgicFindings = { structural: [], doctrine: [], semantic_review: [] };

  // ---- Pillar A: source integrity ----
  const title = norm(input.title), sourceTitle = norm(raw.source_title);
  if (present(title) && looksLikeFragmentTitle(title)) f.semantic_review.push("TITLE_FRAGMENT_SUSPECTED");
  if (present(title) && (!present(sourceTitle) || lowTokenOverlap(title, sourceTitle))) f.semantic_review.push("TITLE_SOURCE_MATCH_UNVERIFIED");

  const url = norm(input.source_url) || norm(raw.source_url) || norm(raw.url);
  if (!present(url)) f.structural.push("SOURCE_URL_MISSING");
  else if (!parseable(url)) f.structural.push("SOURCE_URL_UNPARSEABLE");
  else if (looksNonCanonical(url)) f.semantic_review.push("SOURCE_URL_NONCANONICAL_SUSPECTED"); // heuristic → review, not fail

  const platform = norm(raw.platform) || norm(raw.source) || (present(url) ? hostOf(url) ?? "" : "");
  const retrievalPath = norm(raw.search_query) || norm(raw.source) || norm(raw.processing_method);
  if (!present(platform) || !present(retrievalPath)) f.structural.push("PROVENANCE_MISSING");

  // ---- Pillar B: entity relevance (no floor enforced in P1; recorded for calibration) ----
  const relevance = normScore(input.relevance_score ?? (raw.relevance_score as number));
  const relevanceReason = norm(raw.relevance_reason) || norm(raw.relevance_recommendation);
  if (!present(relevanceReason)) f.semantic_review.push("RELEVANCE_RATIONALE_QUALITY_UNVERIFIED");
  const connectionType = norm(raw.primary_connection) || norm(raw.connection_type) || null;
  if (!connectionType || connectionType === "none") f.doctrine.push("ENTITY_LINKAGE_NONE");

  // ---- Pillar C: timeline integrity (#3 — future events VALID; only pub>detection is a fact) ----
  const eventTs = toTs(input.event_date);
  const pubTs = toTs(norm(raw.article_published_time) || null);
  const detTs = toTs(input.created_at) ?? Date.now();
  const skewMs = cfg.skewToleranceHours * 3600_000;
  const staleMs = cfg.staleHorizonDays * 86_400_000;
  const isHistorical = raw.is_historical === true;
  if (pubTs != null && pubTs - detTs > skewMs) f.structural.push("PUBLICATION_AFTER_DETECTION"); // deterministic impossibility
  if (eventTs == null) f.doctrine.push("EVENT_TS_ABSENT");
  else if (!isHistorical && eventTs < detTs && detTs - eventTs > staleMs) f.doctrine.push("STALE_EVENT"); // future events are NOT flagged
  if (cfg.publisherPlatforms.includes(platform.toLowerCase()) && pubTs == null) f.doctrine.push("PUBLICATION_TS_ABSENT");

  // ---- Pillar D: AI reasoning (PRESENCE only — quality deferred to semantic_review) ----
  const hasReasoning = present(raw.ai_decision) || present(raw.agent_review) || present(raw.relevance_recommendation);
  if (hasReasoning) f.semantic_review.push("REASONING_ADEQUACY_UNVERIFIED");
  const confidenceExplanation = present(raw.confidence_explanation) ? norm(raw.confidence_explanation) : (present(relevanceReason) ? relevanceReason : null);
  const hasConfExpl = !!confidenceExplanation;
  if (hasConfExpl) f.semantic_review.push("CONFIDENCE_EXPLANATION_QUALITY_UNVERIFIED");
  if (isHigh && !hasReasoning) f.doctrine.push("CRIT_HIGH_REASONING_REQUIRED");
  if (isHigh && !hasConfExpl) f.doctrine.push("CRIT_HIGH_CONFIDENCE_EXPL_REQUIRED");

  // ---- Verdict: ONLY structural OR doctrine drive sub_grade. semantic_review NEVER does (#2). ----
  const subGrade = f.structural.length > 0 || f.doctrine.length > 0;
  const dgic_status: DgicStatus = subGrade ? "sub_grade" : "decision_grade";

  const proposed = proposeDisposition({ severity: sev, category: cat, conn: connectionType, rel: relevance, subGrade, cfg });
  const evaluated_at = new Date().toISOString();
  const dgic_evaluator_compute_ms = Math.round(performance.now() - t0);

  return {
    signalPatch: {
      dgic_status,
      dgic: { version: DGIC_VERSION, evaluated_at, findings: f },
      connection_type: connectionType,
      publication_ts: pubTs != null ? new Date(pubTs).toISOString() : null,
      ai_proposed_disposition: proposed,
    },
    rawJsonPatch: {
      dgic_confidence_explanation: confidenceExplanation,
      dgic_entity_linkage_explanation: present(relevanceReason) ? relevanceReason : null,
    },
    telemetry: { dgic_evaluator_compute_ms },
  };
}

// =====================================================================================
// CALLER WRAPPER (illustrative — ingest-signal, immediately BEFORE the signals insert)
// =====================================================================================
//   const cfg = await loadDgicConfigCached(supabase);     // ONE cached read per warm worker (not per signal)
//   const tOverhead0 = performance.now();
//   let out, dgicStatus = "audit_error", auditErr: string | null = null;
//   try {
//     out = evaluateDGIC({ title, source_url: effectiveUrl, severity, category, relevance_score: gateScore,
//                          confidence, event_date, created_at: nowIso, source_path, client_id, tenant_id, raw_json }, cfg);
//     dgicStatus = out.signalPatch.dgic_status;
//   } catch (e) { auditErr = e instanceof Error ? e.message : String(e); }
//
//   // STAMP onto the existing insert — verdict rides the ATOMIC signal write (#1: truth, never dropped).
//   const signalRow = auditErr
//     ? { ...baseSignalRow, dgic_status: "audit_error", dgic: { version: DGIC_VERSION, evaluated_at: nowIso, error: true } }
//     : { ...baseSignalRow, ...out!.signalPatch, raw_json: { ...raw_json, ...out!.rawJsonPatch } };
//   const { data: inserted } = await supabase.from("signals").insert(signalRow).select("id").single();
//   const dgic_total_overhead_ms = Math.round(performance.now() - tOverhead0);
//
//   // LATENCY → existing ingest-signal function_telemetry context (#5/#6: NOT on signals):
//   //   context: { dgic_evaluator_compute_ms: out?.telemetry.dgic_evaluator_compute_ms ?? null,
//   //              dgic_total_overhead_ms, dgic_status: dgicStatus }
//
//   // EXCEPTIONS ONLY → dgic_evaluations, AWAITED because audit_error is rare and must not be
//   //   lost (#1). Baseline analytics do NOT use this table — they derive from `signals`.
//   if (auditErr) {
//     await supabase.from("dgic_evaluations").insert({
//       signal_id: inserted?.id ?? null, dgic_version: DGIC_VERSION, kind: "audit_error",
//       error_message: auditErr, source_path, client_id, tenant_id,
//       evaluator_compute_ms: null, total_overhead_ms: dgic_total_overhead_ms,
//     });
//   }
//   // Admission proceeds exactly as before. No quarantine, no fail-closed, no floor (#4).
// =====================================================================================
