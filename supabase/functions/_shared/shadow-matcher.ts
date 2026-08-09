// _shared/shadow-matcher.ts — WO-GATE-PHASE3-SHADOW-PLAN, Requirement 1 (slice 2 of 7).
//
// PURE + WRITE-ISOLATED. This module does NO database access and NO network I/O. It replaces the
// live `.includes()` substring gate (process-intelligence-document `matchClientKeywords`,
// ingest-signal client attribution) with a token-boundary + asset-geo-anchor verdict, and exposes
// an INJECTION POINT for the semantic leg (the caller supplies an async classifier so this module
// stays pure and the AI cost lives at — and is budgeted by — the wiring layer). It computes what a
// new matcher WOULD decide; it never writes signals and never calls the live decision engine.
//
// What it fixes vs the live gate:
//   • `.includes('home')` matched "homeless"/"homelessness" — token-boundary kills that (whole-token only).
//   • A whole-token common-noun asset ("cabin" in "cabin crew") still matches at a boundary, so those
//     require a GEO/ENTITY ANCHOR (item also matches the client's geography). Clients without geo →
//     fail CLOSED (suppressed) and are counted as `geo_pending` (operator change 2 cost counter).
//   • Retires the transitional ≤5-char length heuristic + SHORT_KW_ALLOWLIST: a whole-token "LNG" is
//     legitimate at any length; a substring "home" is not, regardless of length.

export interface ShadowClient {
  id: string;
  name: string;
  monitoring_keywords?: string[] | null;
  competitor_names?: string[] | null;
  high_value_assets?: string[] | null;
  locations?: string[] | null;
}

export type ShadowMatchBasis = "semantic" | "token" | "asset_geo";

export interface PerClientVerdict {
  client_id: string;
  matched: boolean;
  basis: ShadowMatchBasis | null;
  confidence: number | null;      // null = semantic leg not evaluated; distinct from 0
  matched_terms: string[];        // the token(s)/phrase(s) that anchored the match
  geo_suppressed: boolean;        // asset-label matched at a boundary but client had no geo anchor
  asset_label: string | null;     // the common-noun asset that (would have) matched, for the counter
}

export interface ShadowMatchResult {
  matched: boolean;
  client_ids: string[];
  basis: ShadowMatchBasis | null; // strongest basis across matched clients (token > asset_geo > semantic)
  match_confidence: number | null;// confidence of the strongest matched client
  geo_suppressed: boolean;        // any client had an asset-label match suppressed for geo_pending
  asset_label: string | null;     // the suppressed asset label (for the per-client geo_pending counter)
  per_client: PerClientVerdict[]; // full detail for analysis
}

/** Optional injected semantic classifier. Returns a 0..1 confidence that the item concerns the
 *  client, or null if it declined/failed (never throws into the caller). Supplied at the wiring
 *  layer so the AI call is budgeted/sampled there, not here. */
export type SemanticClassifier = (
  itemText: string,
  client: ShadowClient,
) => Promise<number | null>;

// Transitional lexicon (documented, like the ≤5-char heuristic it helps retire): single-token asset
// labels that are common English nouns and therefore fabrication-prone as bare substrings. A
// single-token, all-lowercase asset is ALSO treated as common-noun (conservative). Multi-token or
// mixed/upper-case assets ("Coastal GasLink", "LNG Canada Terminal") are distinctive and do NOT
// require a geo anchor. Retires fully once client geography + linked-entity anchors are provisioned.
const COMMON_NOUN_ASSET = new Set([
  "cabin", "home", "house", "office", "ranch", "farm", "lodge", "property",
  "residence", "site", "plant", "station", "field", "camp", "yard", "shop",
]);

const SEMANTIC_MATCH_THRESHOLD = 0.60; // a semantic-only match must clear this to count as recall gain
const TOKEN_CONFIDENCE = 0.9;          // whole-token keyword/name/competitor match (distinctive)
const ASSET_GEO_CONFIDENCE = 0.7;      // common-noun asset anchored by client geography

/** Whole-token (word-boundary) test. `home` does NOT match "homeless"/"homelessness";
 *  `LNG` matches "LNG Canada" as a whole token. Multi-word phrases match with boundaries at the
 *  ends only (interior spacing is literal). Case-insensitive. Pure. */
export function tokenBoundaryMatch(haystackLower: string, phrase: string): boolean {
  const p = (phrase || "").trim().toLowerCase();
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Boundaries defined against alphanumerics so hyphens/apostrophes/spaces act as separators
  // (matches "wet'suwet'en", "coastal gaslink"), while a longer word cannot host the token.
  const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`);
  return re.test(haystackLower);
}

/** A distinctive term is safe to match on token boundary alone (proper noun, acronym, or phrase).
 *  A single all-lowercase word, or a known common noun, is treated as a common-noun asset that
 *  needs a geo/entity anchor. */
export function isCommonNounAsset(assetRaw: string): boolean {
  const a = (assetRaw || "").trim();
  if (!a) return false;
  const tokens = a.split(/\s+/);
  if (tokens.length > 1) return false;                 // multi-token asset = distinctive
  const lower = a.toLowerCase();
  if (COMMON_NOUN_ASSET.has(lower)) return true;
  // single token, all-lowercase in source, purely alphabetic → treat as common noun (conservative)
  return a === lower && /^[a-z]+$/.test(a);
}

/** Strip the analytic prefix the live gate adds to matchedKeywords, so we compare the bare term. */
export function stripKw(k: string): string {
  return String(k).toLowerCase().replace(/^(asset|keyword|kw|competitor|client_name|tier2|tier-2):/, "");
}

const basisRank: Record<ShadowMatchBasis, number> = { token: 3, asset_geo: 2, semantic: 1 };

/**
 * Compute the shadow verdict for one item against all clients. Pure except for the OPTIONAL injected
 * `semantic` classifier (which the caller budgets). Never throws; a failing semantic leg yields null.
 */
export async function matchItemToClients(
  itemText: string,
  clients: ShadowClient[],
  opts?: { semantic?: SemanticClassifier },
): Promise<ShadowMatchResult> {
  const lower = (itemText || "").toLowerCase();
  const perClient: PerClientVerdict[] = [];

  for (const client of clients || []) {
    const matchedTerms: string[] = [];

    // 1. DISTINCTIVE token matches — client name, competitors, and non-common-noun keywords/assets.
    if (client.name && tokenBoundaryMatch(lower, client.name)) matchedTerms.push(`client_name:${client.name}`);
    for (const kw of client.monitoring_keywords || []) {
      if (kw && tokenBoundaryMatch(lower, kw)) matchedTerms.push(kw);
    }
    for (const comp of client.competitor_names || []) {
      if (comp && tokenBoundaryMatch(lower, comp)) matchedTerms.push(`competitor:${comp}`);
    }
    // Distinctive (multi-token / proper-noun / acronym) assets are token-safe; common-noun assets are held.
    const heldAssets: string[] = [];
    for (const asset of client.high_value_assets || []) {
      if (!asset || !tokenBoundaryMatch(lower, asset)) continue;
      if (isCommonNounAsset(asset)) heldAssets.push(asset);
      else matchedTerms.push(`asset:${asset}`);
    }

    let matched = matchedTerms.length > 0;
    let basis: ShadowMatchBasis | null = matched ? "token" : null;
    let confidence: number | null = matched ? TOKEN_CONFIDENCE : null;
    let geoSuppressed = false;
    let assetLabel: string | null = null;

    // 2. COMMON-NOUN ASSET anchor — count only if the item also matches the client's geography.
    //    No geo on the client → fail CLOSED and flag geo_pending (do not fabricate a match).
    if (heldAssets.length > 0) {
      const hasGeo = (client.locations || []).length > 0;
      const geoHit = hasGeo && (client.locations || []).some((loc) => loc && tokenBoundaryMatch(lower, loc));
      if (geoHit) {
        for (const a of heldAssets) matchedTerms.push(`asset:${a}`);
        if (!matched) { matched = true; basis = "asset_geo"; confidence = ASSET_GEO_CONFIDENCE; }
      } else {
        // suppressed: record the first held asset for the per-client geo_pending cost counter
        geoSuppressed = true;
        assetLabel = heldAssets[0];
      }
    }

    // 3. SEMANTIC leg (injected, optional) — recall for items with no keyword hit. Only promotes an
    //    UNMATCHED client (a token/asset_geo match already stands on firmer ground).
    let semConfidence: number | null = null;
    if (opts?.semantic) {
      try {
        semConfidence = await opts.semantic(itemText, client);
      } catch {
        semConfidence = null; // never let the semantic leg fail the verdict
      }
      if (!matched && semConfidence != null && semConfidence >= SEMANTIC_MATCH_THRESHOLD) {
        matched = true;
        basis = "semantic";
        confidence = semConfidence;
      }
    }

    if (matched || geoSuppressed) {
      perClient.push({
        client_id: client.id,
        matched,
        basis,
        confidence,
        matched_terms: matchedTerms,
        geo_suppressed: geoSuppressed,
        asset_label: assetLabel,
      });
    }
  }

  // Aggregate: strongest matched client sets the top-level basis/confidence; geo-suppression rolls up.
  const matchedClients = perClient.filter((p) => p.matched);
  matchedClients.sort((a, b) =>
    (basisRank[b.basis as ShadowMatchBasis] ?? 0) - (basisRank[a.basis as ShadowMatchBasis] ?? 0) ||
    (b.confidence ?? 0) - (a.confidence ?? 0));
  const top = matchedClients[0];
  const suppressed = perClient.find((p) => p.geo_suppressed);

  return {
    matched: matchedClients.length > 0,
    client_ids: matchedClients.map((p) => p.client_id),
    basis: top?.basis ?? null,
    match_confidence: top?.confidence ?? null,
    geo_suppressed: !!suppressed,
    asset_label: suppressed?.asset_label ?? null,
    per_client: perClient,
  };
}
