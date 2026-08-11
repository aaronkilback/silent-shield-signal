// Incident-creation gate — the single admission authority for BOTH creation paths
// (check-incident-escalation, ai-decision-engine). WO-INCIDENT-QA Step 1 (2026-07-28).
//
// Doctrine: an incident is a signal that has earned tracked client response —
// NOT merely a high-severity world event. Promotion requires ALL of:
//   • relevance_score >= 0.60   (client relevance)
//   • confidence     >= 0.65    WHEN a confidence value is present; when confidence
//                               is null, fall back to corroboration (>=2 independent
//                               linked signals / entity corroboration).  [Option-1 ruling]
//   • for hazard classes: a client impact pathway (Step 6, freeze lifted) — proximity to
//     assets / corridor overlap / HQ, scored by PostGIS distance. No pathway → awareness
//     only (relevance capped to 0.40 at ingest); pathway → normal relevance/confidence gate.
// Severity sets PRIORITY (p1/p2/p3) only — never admission by itself.
// [PATTERN] meta-observations (signals about signals) NEVER create incidents.
//
// Every evaluation is persisted to public.incident_gate_decisions — no unauditable gates.
//
// REVISIT CONDITION (Step 3b): once composite_confidence coverage exceeds ~80% over a
// rolling week (see project ledger: null on ~84% of signals as of 2026-07-28), drop the
// corroboration fallback and enforce confidence >= 0.65 primarily.

import { tokenBoundaryMatch } from "./shadow-matcher.ts";

export const HAZARD_CLASSES = new Set<string>([
  'civil_emergency', 'wildfire', 'weather', 'natural_disaster', 'health_concern', 'amber_alert',
]);

export const REL_MIN = 0.60;
export const CONF_MIN = 0.65;
export const CORROBORATION_MIN = 2; // independent linked signals / entity corroboration

export type GatePriority = 'p1' | 'p2' | 'p3';

export interface GateResult {
  admit: boolean;
  branch:
    | 'pattern_excluded'
    | 'hazard_no_pathway'
    | 'no_pathway'
    | 'relevance_below'
    | 'confidence_below'
    | 'confidence_null_uncorroborated'
    | 'admit_confidence'
    | 'admit_corroboration_fallback';
  reason: string;
  priority: GatePriority | null;
  values: {
    category: string | null;
    signal_type: string | null;
    signal_origin: string | null;
    relevance_score: number | null;
    confidence: number | null;
    confidence_present: boolean;
    corroboration_count: number | null;
  };
}

function isPatternSignal(signal: any): boolean {
  return (signal?.signal_type === 'pattern') || /^\s*\[PATTERN\]/i.test(String(signal?.title || ''));
}

export function isHazardSignal(signal: any): boolean {
  return HAZARD_CLASSES.has(String(signal?.category || '')) ||
    signal?.signal_origin === 'monitor-naad-alerts';
}

// ── D6 / WO-CLIENT-THREAT-RELEVANCE: universal client-pathway test ──────────────
// The pathway test that already existed for HAZARD classes (asset-geo) generalized to
// ALL categories, because priority must derive from threat-to-THIS-client, not magnitude.
// A signal has a pathway if ANY leg fires; no leg → awareness only (never an incident).
// Behind feature_flags.pathway_gate_enabled — off = legacy hazard-only behavior, instant revert.
export type PathwayLeg = 'asset' | 'entity' | 'operations' | null;
export interface PathwayResult { has_pathway: boolean; leg: PathwayLeg; reasoning: string; }

// Operations leg is a CATEGORY-ELIGIBILITY filter keyed on client-config `industry` —
// NEVER an industry keyword matched against signal text. It only decides whether the
// operating-area (location∈clients.locations) test is allowed to run for this category.
const OPERATIONS_ELIGIBLE: Record<string, Set<string>> = {
  energy:          new Set(['regulatory','operational','infrastructure','environmental']),
  venue_security:  new Set(['operational','event','crowd','infrastructure']),
};
function operationsCategoryEligible(category: string | null, industry: string | null): boolean {
  const set = OPERATIONS_ELIGIBLE[String(industry || '').toLowerCase()];
  return !!set && !!category && set.has(String(category));
}

export async function isPathwayGateEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from('feature_flags').select('enabled')
      .eq('key', 'pathway_gate_enabled').maybeSingle();
    return data?.enabled === true;
  } catch (_) { return false; }
}

// Evaluate the three legs. Read-only; each leg fails safe to "no pathway" on error.
export async function evaluateClientPathway(supabase: any, signal: any): Promise<PathwayResult> {
  const clientId = signal?.client_id;
  if (!clientId) return { has_pathway: false, leg: null, reasoning: 'no client_id' };
  const text = String(signal?.normalized_text || signal?.title || '').toLowerCase();

  // LEG 1 — ASSET (PostGIS proximity to client_geo_assets / corridor / HQ). Reuse the existing scorer.
  try {
    const { data: existing } = await supabase.from('hazard_pathway_scores')
      .select('has_pathway, reasoning').eq('signal_id', signal.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    let asset = existing;
    if (!asset) {
      const { data: scored } = await supabase.rpc('score_signal_hazard_pathway', { p_signal_id: signal.id });
      asset = scored ? { has_pathway: scored.has_pathway, reasoning: scored.reason } : null;
    }
    if (asset?.has_pathway) return { has_pathway: true, leg: 'asset', reasoning: `asset: ${asset.reasoning || 'proximity to client asset'}` };
  } catch (_) { /* asset leg best-effort */ }

  // LEG 2 — ENTITY (CURATED/REVIEWED ONLY — never extracted/auto_extracted/suggested).
  try {
    const { data: curated } = await supabase.from('entities')
      .select('id, name').eq('client_id', clientId).in('visibility_class', ['curated', 'reviewed']);
    if (curated?.length) {
      const curatedIds = new Set(curated.map((e: any) => e.id));
      const mentions = Array.isArray(signal?.entity_mentions) ? signal.entity_mentions : [];
      const hitId = mentions.map((m: any) => m?.entity_id).filter(Boolean).find((id: string) => curatedIds.has(id));
      if (hitId) {
        const e = curated.find((c: any) => c.id === hitId);
        return { has_pathway: true, leg: 'entity', reasoning: `entity: mentions curated "${e?.name}"` };
      }
      for (const e of curated) {
        if (e.name && tokenBoundaryMatch(text, String(e.name).toLowerCase())) {
          return { has_pathway: true, leg: 'entity', reasoning: `entity: names curated "${e.name}"` };
        }
      }
    }
  } catch (_) { /* entity leg best-effort */ }

  // LEG 3 — OPERATIONS (operating area from clients.locations; industry gates category eligibility).
  try {
    const { data: cfg } = await supabase.from('clients').select('locations, industry').eq('id', clientId).maybeSingle();
    if (cfg?.locations?.length && operationsCategoryEligible(signal?.category, cfg.industry)) {
      const locText = String(signal?.location || signal?.normalized_text || '').toLowerCase();
      for (const loc of cfg.locations) {
        if (loc && tokenBoundaryMatch(locText, String(loc).toLowerCase())) {
          return { has_pathway: true, leg: 'operations', reasoning: `operations: location "${loc}" in operating area` };
        }
      }
    }
  } catch (_) { /* operations leg best-effort */ }

  return { has_pathway: false, leg: null, reasoning: 'no asset/entity/operations pathway to client' };
}

// Severity → PRIORITY only (never admission). Mirrors the prior PECL grading intent
// but decoupled from the create/no-create decision.
export function severityToPriority(signal: any): GatePriority {
  const P1_CATEGORIES = ['active_threat'];
  const P2_CATEGORIES = ['cybersecurity', 'protest', 'insider_threat', 'regulatory', 'violence'];
  const score = Number(signal?.severity_score) || 0;
  const isCisaKev = signal?.category === 'malware' &&
    (String(signal?.source_url || '').includes('cisa.gov') ||
     String(signal?.normalized_text || '').toLowerCase().includes('cisa kev'));
  // A signal is only admitted once it has real client relevance, so client nexus is a
  // given here — priority is about how hard/fast to respond, from severity + category.
  if (score >= 80 && P1_CATEGORIES.includes(signal?.category) && !isCisaKev) return 'p1';
  if (score >= 50 || P2_CATEGORIES.includes(signal?.category)) return 'p2';
  return 'p3';
}

/**
 * Count independent corroboration for a signal: OTHER signals within `windowDays`
 * that share at least one mentioned entity. Used only on the confidence-null branch.
 */
export async function countCorroboration(supabase: any, signal: any, windowDays = 7): Promise<number> {
  const mentions = signal?.entity_mentions;
  const entityIds = Array.isArray(mentions)
    ? mentions.map((m: any) => m?.entity_id).filter(Boolean)
    : [];
  if (entityIds.length === 0) return 0;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('entity_mentions')
    .select('signal_id')
    .in('entity_id', entityIds)
    .neq('signal_id', signal.id)
    .gte('created_at', windowStart);
  // WO-FAIL-LOUD-AUDIT-01: a failed corroboration lookup must NOT read as zero
  // corroboration — that silently mis-scores the incident-creation gate. Fail loud.
  if (error) throw new Error(`countCorroboration: entity_mentions query failed: ${error.message}`);
  const distinct = new Set((data || []).map((r: any) => r.signal_id));
  return distinct.size;
}

/**
 * Evaluate the gate. Computes corroboration itself (confidence-null branch only) so both
 * callers behave identically. Does NOT persist — call persistGateDecision separately so
 * the caller can attach the created incident_id.
 */
export async function evaluateIncidentGate(
  supabase: any, signal: any, windowDays = 7,
  opts: { corroborationOverride?: boolean } = {},
): Promise<GateResult> {
  const category = signal?.category ?? null;
  const signal_type = signal?.signal_type ?? null;
  const signal_origin = signal?.signal_origin ?? null;
  const rel = signal?.relevance_score == null ? null : Number(signal.relevance_score);
  const rawConf = signal?.composite_confidence ?? signal?.confidence ?? null;
  const conf = rawConf == null ? null : Number(rawConf);
  const confidence_present = conf != null && Number.isFinite(conf);

  const baseValues = {
    category, signal_type, signal_origin,
    relevance_score: rel, confidence: conf,
    confidence_present, corroboration_count: null as number | null,
  };

  // 1. [PATTERN] meta-observations never create incidents — route to analyst review.
  if (isPatternSignal(signal)) {
    return { admit: false, branch: 'pattern_excluded', priority: null,
      reason: '[PATTERN] meta-observation (signal about signals) — routed to analyst review, never an incident',
      values: baseValues };
  }

  // 2. CLIENT PATHWAY (D6 / WO-CLIENT-THREAT-RELEVANCE). Priority derives from
  // threat-to-THIS-client, not magnitude. Flag ON: universal 3-leg test (asset/entity/
  // operations) for ALL categories — no pathway → awareness only. Flag OFF: legacy
  // hazard-only pathway (unchanged). Rule 4: this is ORDERING; the relevance threshold
  // below is untouched. Go-live gated on the BC Place inversion + 0-of-15 replay.
  if (await isPathwayGateEnabled(supabase)) {
    const pw = await evaluateClientPathway(supabase, signal);
    if (!pw.has_pathway) {
      return { admit: false, branch: 'no_pathway', priority: null,
        reason: `no client pathway — awareness only: ${pw.reasoning}`,
        values: baseValues };
    }
    // pathway confirmed (leg: ${pw.leg}) — fall through to the relevance/confidence gates.
  } else if (isHazardSignal(signal)) {
    let pathway: any = null;
    const { data: existing } = await supabase.from('hazard_pathway_scores')
      .select('has_pathway, reasoning').eq('signal_id', signal.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      pathway = existing;
    } else {
      const { data: scored } = await supabase.rpc('score_signal_hazard_pathway', { p_signal_id: signal.id });
      pathway = scored ? { has_pathway: scored.has_pathway, reasoning: scored.reason } : null;
    }
    if (!pathway?.has_pathway) {
      return { admit: false, branch: 'hazard_no_pathway', priority: null,
        reason: `hazard has no client impact pathway — awareness only: ${pathway?.reasoning || 'no pathway score'}`,
        values: baseValues };
    }
    // pathway confirmed — fall through to the relevance/confidence gates.
  }

  // 3. Relevance gate (always).
  if (rel == null || rel < REL_MIN) {
    return { admit: false, branch: 'relevance_below', priority: null,
      reason: `relevance ${rel ?? 'null'} < ${REL_MIN}`,
      values: baseValues };
  }

  // 4. Confidence gate with corroboration fallback.
  // corroborationOverride: a Tier-2 review agent that promotes a sub-threshold signal
  // has already established human/agent corroboration — it satisfies the corroboration
  // fallback in place of a numeric confidence bar (relevance/hazard/pattern still enforced).
  if (confidence_present) {
    if ((conf as number) < CONF_MIN) {
      if (opts.corroborationOverride) {
        return { admit: true, branch: 'admit_corroboration_fallback', priority: severityToPriority(signal),
          reason: `admitted via Tier-2 promotion: relevance ${rel} >= ${REL_MIN}, confidence ${conf} < ${CONF_MIN} overridden by agent corroboration`,
          values: baseValues };
      }
      return { admit: false, branch: 'confidence_below', priority: null,
        reason: `confidence ${conf} < ${CONF_MIN}`,
        values: baseValues };
    }
    return { admit: true, branch: 'admit_confidence', priority: severityToPriority(signal),
      reason: `admitted: relevance ${rel} >= ${REL_MIN} AND confidence ${conf} >= ${CONF_MIN}`,
      values: baseValues };
  }

  // confidence null → require corroboration (Tier-2 override counts as corroboration).
  const corroboration = await countCorroboration(supabase, signal, windowDays);
  const values = { ...baseValues, corroboration_count: corroboration };
  if (corroboration < CORROBORATION_MIN && !opts.corroborationOverride) {
    return { admit: false, branch: 'confidence_null_uncorroborated', priority: null,
      reason: `confidence null and corroboration ${corroboration} < ${CORROBORATION_MIN}`,
      values };
  }
  return { admit: true, branch: 'admit_corroboration_fallback', priority: severityToPriority(signal),
    reason: `admitted (confidence null): relevance ${rel} >= ${REL_MIN} AND corroboration ${corroboration} >= ${CORROBORATION_MIN}${opts.corroborationOverride ? ' (Tier-2 override)' : ''}`,
    values };
}

// ── Classification write (WO-INCIDENT-QA Step 3) ──
// Every created incident gets a real incident_type AND an incident_classification_rationale
// row — fail-loud if the rationale cannot be written (an incident without provenance is the
// exact "UNKNOWN" defect this closes).

const CYBER_CATS = new Set(['cybersecurity', 'malware', 'phishing', 'intrusion', 'data_exfil', 'ddos', 'ransomware', 'vulnerability', 'cyber']);
const PHYSICAL_CATS = new Set(['wildfire', 'civil_emergency', 'natural_disaster', 'weather', 'violence', 'active_threat', 'physical', 'sabotage', 'health_concern', 'amber_alert', 'environmental']);
const SOCIAL_CATS = new Set(['protest', 'activism', 'social_sentiment', 'extremism', 'crime']);

export function deriveIncidentClassification(signal: any): { incident_type: string; system_of_origin: string } {
  const cat = String(signal?.category || '').toLowerCase();
  let system_of_origin = 'intel_platform';
  if (CYBER_CATS.has(cat)) system_of_origin = 'cyber';
  else if (PHYSICAL_CATS.has(cat)) system_of_origin = 'physical';
  else if (SOCIAL_CATS.has(cat)) system_of_origin = 'social_media';
  const incident_type = signal?.signal_type || cat || 'other';
  return { incident_type, system_of_origin };
}

/**
 * Write the classification-rationale row for a freshly-created incident. FAIL-LOUD:
 * throws if the row cannot be written, so a classification gap surfaces immediately
 * instead of silently producing an UNKNOWN incident.
 */
export async function writeIncidentClassification(
  supabase: any, incidentId: string, signal: any, gate: GateResult,
): Promise<{ incident_type: string; system_of_origin: string; classification: string }> {
  const { incident_type, system_of_origin } = deriveIncidentClassification(signal);
  const classification = String(gate.priority || 'p3').toUpperCase(); // P1|P2|P3
  const { error } = await supabase.from('incident_classification_rationale').insert({
    incident_id: incidentId,
    classification,
    system_of_origin,
    rationale: `Auto-classified at creation. Gate ${gate.branch}: ${gate.reason}. category=${signal?.category ?? 'n/a'}, type=${incident_type}.`,
    classified_by: 'auto',
  });
  if (error) {
    throw new Error(`classification write failed for incident ${incidentId}: ${error.message}`);
  }
  return { incident_type, system_of_origin, classification };
}

/**
 * Persist the gate decision. Best-effort: a logging failure must not itself admit or
 * block an incident, but it is surfaced (console.error) so the gap is visible.
 */
export async function persistGateDecision(
  supabase: any, signalId: string, callerFunction: string, result: GateResult, incidentId: string | null = null,
): Promise<void> {
  try {
    const { error } = await supabase.from('incident_gate_decisions').insert({
      signal_id: signalId,
      caller_function: callerFunction,
      admitted: result.admit,
      branch: result.branch,
      reason: result.reason,
      category: result.values.category,
      signal_type: result.values.signal_type,
      signal_origin: result.values.signal_origin,
      relevance_score: result.values.relevance_score,
      confidence: result.values.confidence,
      confidence_present: result.values.confidence_present,
      corroboration_count: result.values.corroboration_count,
      assigned_priority: result.priority,
      incident_id: incidentId,
    });
    if (error) console.error('[incident-gate] persist failed:', error.message, 'signal', signalId);
  } catch (e) {
    console.error('[incident-gate] persist threw:', (e as Error).message, 'signal', signalId);
  }
}
