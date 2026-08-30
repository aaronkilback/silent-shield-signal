/**
 * Identity-anchor gate + three-bucket exposure classification — SINGLE SOURCE OF TRUTH (TS side).
 *
 * A subject_exposure_items row is exactly one of three classes:
 *   finding            — anchored AND adverse           → renders as exposure
 *   verified_presence  — corroborated (>=2 independent domains) AND neutral → confirmed public footprint
 *   noise              — unanchored single-source name-match → unattributed volume
 *
 * Anchors (what "we cannot be wrong about"): email (owned) · coordinate (declared) · data_broker
 *   · source_corroboration (>=2 independent domains) · profile_url · device (last two when intake lands).
 *
 * Broker + corroboration depend on the row's LOCATIONS, so classification must run AFTER locations
 * exist (DB: a trigger on subject_exposure_locations / a reclassify RPC). This module is the canonical
 * TS logic used by the report renderer.
 *
 * LOCKSTEP DUPLICATION (by necessity — SQL cannot import TS): the DB reclassify function MUST keep
 * BROKER_DOMAINS, CORROBORATION_MIN_DOMAINS and ADVERSE_CATEGORIES IDENTICAL to the constants here.
 * Any change here changes there. Same discipline as the short-keyword strip noted in CLAUDE.md.
 *
 * Exact-match rule ([[feedback_exact_match_not_substring]]): broker domains match by EXACT eTLD+1,
 * NEVER substring — scalemylife.com is NOT mylife.com.
 */

export const BROKER_DOMAINS = [
  "rocketreach.co", "zoominfo.com", "spokeo.com", "beenverified.com", "whitepages.com", "intelius.com",
  "radaris.com", "mylife.com", "peoplefinder.com", "truepeoplesearch.com", "fastpeoplesearch.com",
  "apollo.io", "lusha.com", "contactout.com", "signalhire.com", "nuwber.com", "clustrmaps.com", "thatsthem.com",
];
export const CORROBORATION_MIN_DOMAINS = 2;
export const ADVERSE_CATEGORIES = new Set(["data_breach", "environmental", "legal", "financial", "professional", "media"]);

export function host1(h: string): string {
  return String(h || "").toLowerCase().replace(/^www\./, "");
}

/** EXACT eTLD+1 match — never substring. */
export function isBrokerDomain(h: string): boolean {
  const x = host1(h);
  return BROKER_DOMAINS.some((d) => x === d || x.endsWith("." + d));
}

export interface ExposureLike {
  category: string;
  summary?: string | null;
  title?: string | null;
  anchor_type?: string | null;
  anchor_value?: string | null;
}
export interface LocationLike { domain?: string | null }

export interface AnchorResult { anchor_type: string | null; anchor_value: string | null }
export interface ClassifyResult extends AnchorResult {
  exposure_class: "finding" | "verified_presence" | "noise";
  is_finding: boolean;
}

/**
 * Derive the anchor from data the row already carries + its locations. A producer-set typed anchor
 * (email / coordinate / profile_url / device) is respected as-is; data_broker and source_corroboration
 * derive from the location domains. (coordinate for environmental is set by the producer/DB via the
 * client_geo_assets lookup — not derivable here without DB access — and passed through untouched.)
 */
export function deriveAnchor(
  item: ExposureLike,
  locations: LocationLike[],
): AnchorResult & { brokerHits: string[]; distinctDomains: number } {
  const domains = [...new Set((locations || []).map((l) => host1(l.domain || "")).filter(Boolean))];
  const brokerHits = domains.filter(isBrokerDomain);
  let anchor_type = item.anchor_type ?? null;
  let anchor_value = item.anchor_value ?? null;

  // Full owned email(s) from a breach summary: "Affected account(s): X, Y. Breach date ..." — capture
  // the whole account list, not up to the first period (".com" truncation bug).
  if (!(anchor_type && anchor_value) && item.category === "data_breach" && typeof item.summary === "string") {
    const m = item.summary.match(/Affected account\(s\):\s*(.+?)\.\s*Breach/i);
    if (m) { anchor_type = "email"; anchor_value = m[1].trim(); }
  }
  if (!(anchor_type && anchor_value)) {
    if (brokerHits.length) { anchor_type = "data_broker"; anchor_value = brokerHits.join(", "); }
    else if (domains.length >= CORROBORATION_MIN_DOMAINS) { anchor_type = "source_corroboration"; anchor_value = domains.join(", "); }
  }
  return { anchor_type, anchor_value, brokerHits, distinctDomains: domains.length };
}

/** finding | verified_presence | noise, with the derived anchor. */
export function classify(item: ExposureLike, locations: LocationLike[]): ClassifyResult {
  const { anchor_type, anchor_value, brokerHits } = deriveAnchor(item, locations);
  const anchored = !!(anchor_type && anchor_value);
  const adverse = ADVERSE_CATEGORIES.has(item.category) || brokerHits.length > 0;
  const exposure_class = !anchored ? "noise" : (adverse ? "finding" : "verified_presence");
  return { anchor_type, anchor_value, exposure_class, is_finding: exposure_class === "finding" };
}
