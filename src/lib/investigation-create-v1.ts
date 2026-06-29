/**
 * Create Investigation hotfix helpers.
 *
 * Routes investigation creation through the EXISTING production v1 RPC
 * `create_investigation(p_client_id, p_prepared_by, p_created_by_name)` instead
 * of the broken client-side file-number allocator + direct `investigations`
 * insert. The server allocates the file number under an advisory lock and
 * enforces membership authorization; the browser supplies only a *request*.
 *
 * Pure module: no network, no UI, no secret. Identity (`p_prepared_by`,
 * `p_created_by_name`) is derived from the AUTHENTICATED session only — never
 * from form/route state or user-editable input.
 */

export const CREATE_INVESTIGATION_RPC = 'create_investigation' as const;

export interface CreateInvestigationIdentity {
  /** authenticated session user id */
  userId: string | null | undefined;
  /** authenticated session email (fallback display name) */
  userEmail?: string | null;
  /** authenticated profile display name (preferred) */
  profileName?: string | null;
  /** requested client; server-side v1 membership checks remain authoritative */
  selectedClientId: string | null | undefined;
}

export interface CreateInvestigationV1Args {
  p_client_id: string;
  p_prepared_by: string;
  p_created_by_name: string;
}

/** Thrown to BLOCK creation before any RPC call. Carries only safe, non-DB text. */
export class CreateInvestigationBlocked extends Error {
  readonly reason: 'no-auth' | 'no-client';
  constructor(reason: 'no-auth' | 'no-client', message: string) {
    super(message);
    this.name = 'CreateInvestigationBlocked';
    this.reason = reason;
  }
}

/**
 * Build the v1 RPC args from the AUTHENTICATED identity only.
 * Throws `CreateInvestigationBlocked` (before any RPC call) when there is no
 * authenticated user or no selected client (v1 requires a non-null client).
 */
export function buildCreateInvestigationV1Args(
  input: CreateInvestigationIdentity,
): CreateInvestigationV1Args {
  const userId = (input.userId ?? '').trim();
  if (!userId) {
    throw new CreateInvestigationBlocked('no-auth', 'You must be signed in to create an investigation.');
  }
  const clientId = (input.selectedClientId ?? '').trim();
  if (!clientId) {
    throw new CreateInvestigationBlocked('no-client', 'Select a client before creating an investigation.');
  }
  // created_by_name derives from the authenticated profile/email — NOT user-editable input.
  const createdByName = input.profileName?.trim() || input.userEmail?.trim() || 'Unknown';
  return { p_client_id: clientId, p_prepared_by: userId, p_created_by_name: createdByName };
}

/**
 * v1 `RETURNS investigations` (single composite). PostgREST may surface the row
 * as an object or a 1-element array; normalise to the canonical server row so
 * callers use the SERVER-issued id/file_number (never an optimistic local one).
 */
export function extractInvestigationRow<T = unknown>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
}

/**
 * Safe user-facing message. NEVER surfaces raw Postgres/RPC text (constraint
 * names, function messages, etc.). Our own pre-flight blocks carry safe text.
 */
export function safeCreateInvestigationMessage(err: unknown): string {
  if (err instanceof CreateInvestigationBlocked) return err.message;
  return 'Could not create the investigation. Please try again.';
}
