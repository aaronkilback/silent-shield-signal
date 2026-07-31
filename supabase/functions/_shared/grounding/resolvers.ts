// WO-GROUNDING-01 Phase 2 — real GroundingDeps factory. Async setup (fetch pool signal texts + client aliases +
// pre-resolve Gate-3 asset links), sync accessors — so the constructor stays pure. The derivation pass (next)
// builds deps once per report over its bounded signal pool, then constructs claims signal-by-signal.

import type { GroundingDeps } from "./derived-claim.ts";

/** Names too ambiguous to be client aliases on their own (would false-match unrelated orgs). */
const AMBIGUOUS_ALIASES = new Set(["petronas", "progress", "energy", "canada", "pcl"]);

export interface BuildGroundingDepsOptions {
  onReject?: GroundingDeps["onReject"];
}

/**
 * Build GroundingDeps for one report over its bounded signal pool.
 * - getSignalText   ← signals.normalized_text for the pool (map lookup).
 * - clientAliases   ← the client's org-entity alias set (name + aliases[]); ambiguous singletons dropped.
 * - resolveAssetLink← public.grounding_resolve_asset_links RPC (place→gazetteer→ST_DWithin to client_geo_assets).
 */
export async function buildGroundingDeps(
  supabase: {
    from: (t: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  },
  clientId: string,
  signalIds: string[],
  opts: BuildGroundingDepsOptions = {},
): Promise<GroundingDeps> {
  // 1) signal texts
  const textById = new Map<string, string>();
  if (signalIds.length) {
    const { data: sigs, error } = await supabase.from("signals").select("id, normalized_text").in("id", signalIds);
    if (error) throw new Error(`[grounding] signal text fetch failed: ${error.message}`);
    for (const s of sigs ?? []) if (s?.normalized_text) textById.set(s.id, s.normalized_text as string);
  }

  // 2) client aliases from the client's org entity alias set (NOT string equality — Amendment 7a).
  const aliasSet = new Set<string>();
  const { data: orgs, error: orgErr } = await supabase
    .from("entities").select("name, aliases").eq("client_id", clientId).eq("type", "organization");
  if (orgErr) throw new Error(`[grounding] client alias fetch failed: ${orgErr.message}`);
  for (const o of orgs ?? []) {
    const candidates: string[] = [o?.name, ...(Array.isArray(o?.aliases) ? o.aliases : [])];
    // only entities that actually carry a resolved alias set contribute (the canonical client org entity);
    // this avoids pulling bare sub-department names in as client aliases.
    if (!Array.isArray(o?.aliases) || o.aliases.length === 0) continue;
    for (const a of candidates) {
      const v = String(a ?? "").trim();
      if (v.length >= 3 && !AMBIGUOUS_ALIASES.has(v.toLowerCase())) aliasSet.add(v);
    }
  }

  // 3) Gate-3 asset links (Amendment 7b) — one RPC call for the whole pool.
  const assetLinked = new Set<string>();
  if (signalIds.length) {
    const { data: links, error: rpcErr } = await supabase.rpc("grounding_resolve_asset_links", {
      p_client_id: clientId, p_signal_ids: signalIds,
    });
    if (rpcErr) throw new Error(`[grounding] asset-link RPC failed: ${rpcErr.message}`);
    for (const l of links ?? []) if (l?.resolved) assetLinked.add(l.signal_id);
  }

  return {
    getSignalText: (id) => textById.get(id) ?? null,
    clientAliases: [...aliasSet],
    resolveAssetLink: (id) => assetLinked.has(id),
    onReject: opts.onReject,
  };
}
