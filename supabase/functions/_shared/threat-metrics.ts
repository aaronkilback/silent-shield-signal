/**
 * Single Source of Truth — Threat Metrics Aggregator (Trust Architecture v1, P1.1)
 *
 * THE PROBLEM THIS REPLACES
 * Today every surface counts signals/severity its own way. For one prod tenant
 * at one instant, five surfaces reported five different "critical/high" tallies
 * (see docs review: COP=1/3, send-briefing=0/1, generate(Petronas)=0/2,
 * generate(Cascade)=1/1, radar(global)=1/5). The divergence drivers are:
 *   - pattern-type signals (projections) counted as observed criticals
 *   - missing quarantine filter
 *   - missing test-data filter
 *   - per-surface row LIMITs that silently truncate the population
 *   - inconsistent scope (tenant vs active-clients vs single-client vs global)
 *
 * THE CANONICAL RULE (one definition, used everywhere)
 * A signal is a COUNTABLE OBSERVATION iff:
 *   - quality_status = 'active'        (quarantine visibility boundary)
 *   - is_test = false                  (not synthetic/test data)
 *   - signal_type <> 'pattern'         (pattern = projection, NOT an observation;
 *                                        type-integrity: a projection may never be
 *                                        counted as an observed signal)
 *   - status NOT IN ('false_positive','archived')   (not closed/dismissed)
 * Scope is ALWAYS tenant_id (+ optional client sub-scope). No row LIMIT — counts
 * are exact. Window is on created_at for v1; event-time freshness is a separate
 * later contract and is intentionally NOT applied here.
 *
 * Do NOT write ad-hoc severity/quality_status count queries in surface code.
 * Call getThreatMetrics(). The pure reducers (isCountableObservation /
 * tallySeverities) are exported so the golden contradiction test can verify the
 * rule without a database.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Minimal row shape the canonical predicate reasons over. */
export interface CountableSignalRow {
  severity?: string | null;
  signal_type?: string | null;
  quality_status?: string | null;
  is_test?: boolean | null;
  status?: string | null;
}

export interface ThreatMetricsQuery {
  tenantId: string;
  /** Optional sub-scope. Omit/empty => all clients in the tenant. */
  clientIds?: string[];
  /** Lookback window in hours. Default 24. */
  windowHours?: number;
  /** Deterministic "now" for tests. Default: real now. */
  asOf?: Date;
}

export interface ThreatMetrics {
  generated_at: string;
  tenant_id: string;
  client_ids: string[] | null;
  window_hours: number;
  signals: {
    total: number;
    by_severity: { critical: number; high: number; medium: number; low: number };
  };
  incidents: { active: number };
  /** Transparency: what the canonical rule removed from the naive population. */
  excluded: { projections: number; quarantined: number; test: number };
}

const CLOSED_STATUSES = new Set(["false_positive", "archived"]);

/**
 * PURE. True iff the row counts as a current observation under the canonical rule.
 * Mirrors applyAnalystSignalFilter's quarantine semantics (quality_status='active')
 * plus the projection/test/closed exclusions. Kept pure so the golden test can
 * assert the rule against an in-memory fixture with no DB.
 */
export function isCountableObservation(row: CountableSignalRow): boolean {
  if (row.quality_status !== "active") return false;        // quarantine boundary
  if (row.is_test === true) return false;                   // synthetic/test
  if ((row.signal_type ?? "") === "pattern") return false;  // projection, not observation
  if (CLOSED_STATUSES.has(row.status ?? "")) return false;  // closed/dismissed
  return true;
}

/** PURE. Tally severities over the countable subset of rows. */
export function tallySeverities(rows: CountableSignalRow[]): ThreatMetrics["signals"] {
  const by = { critical: 0, high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const r of rows) {
    if (!isCountableObservation(r)) continue;
    total++;
    const sev = (r.severity ?? "").toLowerCase();
    if (sev === "critical") by.critical++;
    else if (sev === "high") by.high++;
    else if (sev === "medium") by.medium++;
    else if (sev === "low") by.low++;
  }
  return { total, by_severity: by };
}

/**
 * DB-backed canonical metrics. One tenant-scoped fetch of the window, tallied by
 * the pure reducer above, plus an active-incident count and exclusion transparency.
 */
export async function getThreatMetrics(
  supabase: SupabaseClient,
  q: ThreatMetricsQuery,
): Promise<ThreatMetrics> {
  const asOf = q.asOf ?? new Date();
  const windowHours = q.windowHours ?? 24;
  const cutoff = new Date(asOf.getTime() - windowHours * 3600_000).toISOString();
  const clientIds = q.clientIds && q.clientIds.length > 0 ? q.clientIds : null;

  // Single fetch of the tenant+window population (no severity/quarantine filter at
  // the DB — we tally + compute exclusions in one pass). Only the columns the
  // canonical predicate needs. No LIMIT: counts are exact.
  let rowQuery = supabase
    .from("signals")
    .select("severity, signal_type, quality_status, is_test, status")
    .eq("tenant_id", q.tenantId)
    .gte("created_at", cutoff);
  if (clientIds) rowQuery = rowQuery.in("client_id", clientIds);

  const [{ data: rows, error: rowErr }, incidents] = await Promise.all([
    rowQuery,
    (() => {
      let iq = supabase
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", q.tenantId)
        .eq("status", "open")
        .is("deleted_at", null)
        .neq("is_test", true);
      if (clientIds) iq = iq.in("client_id", clientIds);
      return iq;
    })(),
  ]);

  if (rowErr) throw rowErr;
  const all = (rows ?? []) as CountableSignalRow[];

  const signals = tallySeverities(all);
  const excluded = {
    projections: all.filter((r) => (r.signal_type ?? "") === "pattern").length,
    quarantined: all.filter((r) => r.quality_status === "quarantined").length,
    test: all.filter((r) => r.is_test === true).length,
  };

  return {
    generated_at: asOf.toISOString(),
    tenant_id: q.tenantId,
    client_ids: clientIds,
    window_hours: windowHours,
    signals,
    incidents: { active: incidents.count ?? 0 },
    excluded,
  };
}
