// PROD-N Tranche A (2026-05-22) — fixture-isolation enforcement helper.
//
// Single source of truth for "iteration-shape access to clients" from
// monitor functions. Closes the "policy exists, enforcement missing"
// class: isFixtureClient() existed but no monitor called it on its
// client iteration loop. This helper makes the filter the default path.
//
// Tranche A scope: helper + monitor-social-unified migration only.
// Other monitors migrate per operational priority under the soft-warn
// CI guidance (scripts/validate-fixture-isolation.mjs), not in bulk.
//
// Design properties:
//   * Throws on DB error — forces callers to handle, no silent empty arrays
//   * Default `select='id, name'` — narrow default; callers pass richer
//     select when they need more fields
//   * Returns ALL active non-fixture rows — no internal cap. Tranche B
//     replaces clients.slice(N) iteration with LRU-style fairness; that
//     concern stays in the caller, not in this helper
//   * `excluded_fixtures` returned for telemetry — monitors feed it into
//     their `fixture_clients_iterated` field on completeHeartbeat so the
//     watchdog can detect future regressions (PROD-N Phase 1 Rule D)

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface ActiveClientsResult<T = { id: string; name: string }> {
  active: T[];
  excluded_fixtures: string[];
}

export async function pickActiveClients<T = { id: string; name: string }>(
  supabase: SupabaseClient,
  options?: { select?: string }
): Promise<ActiveClientsResult<T>> {
  const selectClause = options?.select ?? 'id, name';
  const { data, error } = await supabase
    .from('clients')
    .select(selectClause)
    .eq('status', 'active');
  if (error) throw error;

  const rows = (data ?? []) as Array<T & { name?: string | null }>;
  const active: T[] = [];
  const excluded_fixtures: string[] = [];
  for (const row of rows) {
    if (typeof row.name === 'string' && row.name.startsWith('_')) {
      excluded_fixtures.push(row.name);
    } else {
      active.push(row as T);
    }
  }
  return { active, excluded_fixtures };
}
