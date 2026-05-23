// PROD-N Phase 1 (2026-05-22) — monitor telemetry shape contract.
//
// Single source of truth for the result_summary shape that monitor
// functions write into cron_heartbeat. Consumers (system-watchdog,
// scripts/validate-monitor-telemetry-shape.mjs) read against this
// contract.
//
// Phase 1 ships the contract + the watchdog's typed-classification
// rules. Phase 2 (architectural review gate) migrates monitor
// functions to write the full shape, so currently-optional fields
// become required.
//
// Why this exists: monitor-social-unified zero-yield (PROD-N diagnosis)
// showed that the watchdog's single-output check (`signals_created`)
// cannot distinguish "broken upstream" from "over-filtering" from
// "scope gap" from "genuinely quiet". The watchdog needs per-stage
// counters to classify failure mode. This file pins those counters
// so every future monitor lands on the same shape.
//
// DO NOT add fields here without updating BOTH consumers in the same
// PR (the file scripts/validate-monitor-telemetry-shape.mjs hardcodes
// REQUIRED_FIELDS — keep them in sync).

/**
 * Per-stage rejection counters. monitor-social-unified writes these
 * today; other monitors will migrate in the architectural review gate.
 *
 * The shape is open — monitors may add additional stage-specific
 * counters (e.g. generic_x_profile, blocked_domain, non_canadian_xr)
 * beyond the required ones. Consumers tolerate extras.
 */
export interface RejectionCounters {
  /** Raw items returned by upstream search/API before any filtering. */
  items_returned: number;
  /** Queries that returned 0 items from upstream (per-query, not per-item). */
  empty_payload: number;
  /** Items rejected by the AI relevance gate. */
  ai_rejected: number;
  /** Items rejected because a signal with matching content_hash / source_url already exists. */
  duplicate_db: number;
}

/** Optional rich rejection example for forensic / operator triage. */
export interface RejectionSample {
  stage: string;
  url: string | null;
  title: string;
  snippet?: string;
  reason?: string;
  source_name?: string;
  source_type?: 'client' | 'entity';
  platform?: string;
  query?: string;
}

/**
 * Full result_summary shape for monitor heartbeats.
 *
 * `signals_created` and `rejection_counters` are written today by
 * monitor-social-unified. The other fields are introduced in Phase 1
 * as optional so they can be populated in Phase 2 without a flag day.
 */
export interface MonitorTelemetry {
  signals_created: number;

  /** Count of queries actually sent to upstream (post-scope-generation). */
  queries_executed?: number;

  /** Count of distinct clients iterated this run (post-fixture-filter). */
  distinct_clients_iterated?: number;

  /**
   * Fixture clients that were SKIPPED by the iteration filter. Empty
   * array = filter applied, no fixtures detected. Absent (undefined)
   * = filter not yet wired (Phase 2 closes this).
   */
  fixture_clients_iterated?: string[];

  rejection_counters?: RejectionCounters;
  rejection_samples?: RejectionSample[];
}

/** Factory for a fresh counter object. Used by monitors during run init. */
export function emptyRejectionCounters(): RejectionCounters {
  return {
    items_returned: 0,
    empty_payload: 0,
    ai_rejected: 0,
    duplicate_db: 0,
  };
}
