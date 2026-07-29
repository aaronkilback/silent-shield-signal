// Incident-creation gate — the single admission authority for BOTH creation paths
// (check-incident-escalation, ai-decision-engine). WO-INCIDENT-QA Step 1 (2026-07-28).
//
// Doctrine: an incident is a signal that has earned tracked client response —
// NOT merely a high-severity world event. Promotion requires ALL of:
//   • relevance_score >= 0.60   (client relevance)
//   • confidence     >= 0.65    WHEN a confidence value is present; when confidence
//                               is null, fall back to corroboration (>=2 independent
//                               linked signals / entity corroboration).  [Option-1 ruling]
//   • for hazard classes: a pathway — but until pathway scoring ships (Step 6) hazard
//     classes are FROZEN (awareness only), a blanket temporary rule.
// Severity sets PRIORITY (p1/p2/p3) only — never admission by itself.
// [PATTERN] meta-observations (signals about signals) NEVER create incidents.
//
// Every evaluation is persisted to public.incident_gate_decisions — no unauditable gates.
//
// REVISIT CONDITION (Step 3b): once composite_confidence coverage exceeds ~80% over a
// rolling week (see project ledger: null on ~84% of signals as of 2026-07-28), drop the
// corroboration fallback and enforce confidence >= 0.65 primarily.

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
    | 'hazard_frozen'
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
  const { data } = await supabase
    .from('entity_mentions')
    .select('signal_id')
    .in('entity_id', entityIds)
    .neq('signal_id', signal.id)
    .gte('created_at', windowStart);
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

  // 2. INTERIM HAZARD FREEZE — until pathway scoring (Step 6). Awareness only.
  if (isHazardSignal(signal)) {
    return { admit: false, branch: 'hazard_frozen', priority: null,
      reason: `INTERIM hazard freeze: ${category || 'hazard/NAAD'} creates no incident until pathway scoring lands`,
      values: baseValues };
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
