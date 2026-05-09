/**
 * Operator-facing signal reference formatting.
 *
 * Every signal has a UUID `id` (system-internal foreign key) and a
 * human-readable `signal_number` like `SIG-2026-000001` (operator
 * reference). The signal_number is auto-assigned by a DB trigger
 * after the May 2026 migration. Pre-migration rows may not have one
 * yet — this helper returns a stable fallback derived from the UUID
 * prefix so the UI always shows SOMETHING the operator can quote.
 *
 * Why a fallback: the migration runs once but the column is added
 * non-destructively, and there's a window between deploy and migrate
 * where rows lack signal_number. Defensive formatting keeps the UI
 * working through that window.
 *
 * Format examples:
 *   - With migration applied: "SIG-2026-000123"
 *   - Without migration:      "SIG-a3f8b2c4"
 */
export function formatSignalRef(signal: { id: string; signal_number?: string | null } | null | undefined): string {
  if (!signal) return "—";
  if (signal.signal_number && signal.signal_number.trim().length > 0) {
    return signal.signal_number;
  }
  // Fallback: first 8 chars of UUID, prefixed for visual consistency.
  const prefix = (signal.id || "").substring(0, 8);
  return prefix ? `SIG-${prefix}` : "—";
}
