/**
 * Centralized constants for investigation-related schemas.
 * These MUST match the DB check constraints exactly.
 * If you add a new status here, also run a migration to update the constraint.
 */

export const INVESTIGATION_PERSON_STATUSES = [
  'complainant',
  'witness',
  'suspect',
  'supervisor',
  'other',
] as const;

export type InvestigationPersonStatus = typeof INVESTIGATION_PERSON_STATUSES[number];

export const PERSON_STATUS_LABELS: Record<InvestigationPersonStatus, string> = {
  complainant: 'Complainant',
  witness: 'Witness',
  suspect: 'Suspect',
  supervisor: 'Supervisor',
  other: 'Other',
};
