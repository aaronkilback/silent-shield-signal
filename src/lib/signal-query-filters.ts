/**
 * PROD-S Track H1 (2026-05-23) — analyst-default signal query filters.
 *
 * Track G prevents future junk ingress. Track H1 quarantines existing
 * contamination via signals.quality_status. Analyst-facing surfaces
 * (signal feed, AEGIS context, reports, etc.) MUST apply this filter so
 * quarantined rows are excluded from reasoning, presentation, and
 * downstream pipelines.
 *
 * Operator / super_admin diagnostic surfaces (MonitoringDiagnostics,
 * LearningDashboard, AutonomousSystemStatus, DatabaseSettings,
 * DeleteClientDialog) SHOULD NOT use this helper — they legitimately
 * need quarantined rows for audit / health checks.
 *
 * Track H2 will add a richer mode parameter and operator UX toggle.
 */

/**
 * Restrict a Supabase signals query to `quality_status = 'active'`.
 * Apply to every analyst-facing signal SELECT.
 *
 * Generic over the query builder so it can be chained with any
 * postgrest-js-style filter chain (`.from('signals').select(...).eq(...)`).
 */
export function applyAnalystSignalFilter<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T): T {
  return query.eq('quality_status', 'active');
}
