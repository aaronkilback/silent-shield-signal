// Canonical active-incident definition — FRONTEND mirror of the
// public.active_incidents view + public.is_incident_active() SQL function
// (migration 20260730120000_canonical_active_incidents_view.sql). Edge mirror:
// supabase/functions/_shared/incident-status.ts. Keep all three in lockstep.
//
// The bug this closes: every consumer implemented its own status allowlist/denylist
// over the incidents enum, so a soft-close (status='closed') was invisible to some
// queries and visible to others. Single source of truth — same doctrine as the
// quarantine signal-query-filters and the findings single-source rule.

// Terminal = the incident is done. Everything else is active.
export const TERMINAL_INCIDENT_STATUSES = new Set<string>(['resolved', 'closed']);

// Active statuses (enum minus terminal): open, acknowledged, contained,
// investigating, mitigated. Use for `.in('status', [...])` where a view read
// is not convenient.
export const ACTIVE_INCIDENT_STATUSES: readonly string[] = [
  'open',
  'acknowledged',
  'contained',
  'investigating',
  'mitigated',
];

export function isTerminalIncidentStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_INCIDENT_STATUSES.has(status);
}

// Status-only half of the canonical definition (mirrors is_incident_active(text)).
export function isIncidentStatusActive(status: string | null | undefined): boolean {
  return status != null && !TERMINAL_INCIDENT_STATUSES.has(status);
}

// Full definition (mirrors the active_incidents view): not terminal, not deleted,
// not superseded, not a test row.
export function isIncidentActive(row: {
  status?: string | null;
  deleted_at?: string | null;
  superseded_by?: string | null;
  is_test?: boolean | null;
} | null | undefined): boolean {
  if (!row) return false;
  return (
    isIncidentStatusActive(row.status) &&
    row.deleted_at == null &&
    row.superseded_by == null &&
    row.is_test !== true
  );
}
