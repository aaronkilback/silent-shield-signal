/**
 * PROD-S Track G (2026-05-23) — per-tenant news domain allowlist.
 *
 * Architecture: GLOBAL_NEWS_BASELINE (hardcoded, universally-authoritative
 * news sources) + per-tenant overlay stored in
 * tenants.settings.news_domain_allowlist (JSONB string[]).
 * Effective allowlist = baseline ∪ overlay.
 *
 * Enforcement point: monitor-news-google rejects candidate URLs whose host
 * does not match the effective allowlist BEFORE invoking ingest-signal.
 * Saves AI-gate cost, telemetry pollution, and analyst-feed noise.
 *
 * Failure mode: if the per-tenant overlay lookup fails (DB error / throw),
 * the helper falls back to GLOBAL_NEWS_BASELINE only with overlay_failed=true.
 * The caller MUST surface this in telemetry. We never throw and never
 * return null — baseline coverage is always available. This preserves
 * degraded monitoring over silent blindness (Aaron 2026-05-23).
 *
 * Match rule: strict suffix-match. host === domain
 * OR host.endsWith("." + domain). Prevents domain-spoof attacks like
 * "cbc.ca.malicious-mirror.com" from matching "cbc.ca".
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Universally-authoritative news domains applied to every tenant as a
 * baseline floor. Operator-modifying this constant requires a deploy.
 *
 * Inclusion criteria (Aaron 2026-05-23):
 *   - established journalistic accountability
 *   - editorial standards
 *   - NOT advocacy / social / substack / entertainment / content-farm
 *
 * Tenant-specific or specialty domains go in tenants.settings overlay,
 * not promoted to the baseline.
 */
export const GLOBAL_NEWS_BASELINE: ReadonlyArray<string> = Object.freeze([
  'cbc.ca',
  'globalnews.ca',
  'theglobeandmail.com',
  'reuters.com',
  'apnews.com',
]);

/**
 * Curated regional / Indigenous / advocacy / major-news tier (#80, 2026-07-09).
 *
 * Amends the original baseline's "NOT advocacy" rule: the intelligence-quality audit + the newly
 * measurable `signal_origin` rejection data proved these outlets carry genuinely client-relevant
 * protective intelligence (Wet'suwet'en/CGL, PRGT/LNG, injunctions, energy-activism) that a
 * 5-domain baseline was silently dropping on the Google-News path. Selection is DATA-DRIVEN — the
 * top plausibly-relevant `source_domain_not_allowlisted` rejects (monitor-news-google, 30d) +
 * audit-named sources — NOT a blanket advocacy allow. Social/jobs/tickets/content-farms stay OUT.
 * The durable fix is relevance-gating (separate, sequenced after); this widening is measured by the
 * before/after query in the PR (news-google filtered-vs-admitted, 7d each side) and subject to the
 * same keep-or-kill discipline via signal_origin.
 */
export const CURATED_REGIONAL_ADVOCACY: ReadonlyArray<string> = Object.freeze([
  // Environmental / Indigenous / energy-activism journalism (the audit's core recovered bucket)
  'thenarwhal.ca', 'tworowtimes.com', 'thedeepdive.ca', 'dogwoodbc.ca',
  'aptnnews.ca', 'thetyee.ca', 'nationalobserver.com', 'ricochet.media',
  // Major reputable news the 5-domain baseline oddly excluded
  'nytimes.com', 'bbc.com', 'theguardian.com', 'nationalpost.com', 'ctvnews.ca', 'thestar.com',
  // Canadian BC / Alberta regional (NE-BC energy corridor + client geographies)
  'citynews.ca', 'vancouversun.com', 'timescolonist.com', 'calgaryherald.com',
  'edmontonjournal.com', 'energeticcity.ca', 'alaskahighwaynews.ca', 'thenorthernview.com',
]);

export interface AllowlistResolutionResult {
  /** Effective allowlist (baseline ∪ overlay if available, baseline only on failure). */
  allowlist: Set<string>;
  /** true = overlay loaded successfully; false = baseline-only (overlay missing or failed). */
  used_overlay: boolean;
  /** true = lookup threw or returned a DB error (forensic flag for telemetry). */
  overlay_failed: boolean;
}

/**
 * Resolve effective news-domain allowlist for a tenant.
 *
 * Failure mode contract:
 *   - lookup error / throw → baseline only, overlay_failed=true (telemetry MUST surface)
 *   - overlay absent or malformed → baseline only, overlay_failed=false (normal for new tenants)
 *   - overlay present + valid → baseline ∪ overlay, used_overlay=true
 *
 * Never throws. Never returns null. Baseline coverage is always available.
 */
export async function getTenantNewsAllowlist(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AllowlistResolutionResult> {
  const baseline = new Set<string>(
    [...GLOBAL_NEWS_BASELINE, ...CURATED_REGIONAL_ADVOCACY].map(d => d.toLowerCase()),
  );

  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle();

    if (error) {
      console.warn(`[Track G] Tenant ${tenantId} overlay lookup failed (${error.message}); falling back to GLOBAL_NEWS_BASELINE only`);
      return { allowlist: baseline, used_overlay: false, overlay_failed: true };
    }

    const raw = (data?.settings as { news_domain_allowlist?: unknown } | null | undefined)?.news_domain_allowlist;
    if (!Array.isArray(raw)) {
      // Missing or malformed overlay → baseline only.
      // Not an "overlay_failed" condition (absence is normal for new tenants).
      return { allowlist: baseline, used_overlay: false, overlay_failed: false };
    }

    const merged = new Set<string>(baseline);
    for (const entry of raw) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        merged.add(entry.trim().toLowerCase());
      }
    }

    return { allowlist: merged, used_overlay: true, overlay_failed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Track G] Tenant ${tenantId} overlay lookup threw (${msg}); falling back to GLOBAL_NEWS_BASELINE only`);
    return { allowlist: baseline, used_overlay: false, overlay_failed: true };
  }
}

/**
 * Extract bare host from a URL string. Lowercase, strip www./m. prefix.
 * Returns null on malformed input.
 */
export function extractHost(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    let host = u.host.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    if (host.startsWith('m.')) host = host.slice(2);
    return host;
  } catch {
    return null;
  }
}

/**
 * Strict suffix-match. host === domain OR host endsWith ("." + domain).
 * Prevents "cbc.ca.malicious-mirror.com" from matching "cbc.ca".
 */
export function isAllowedDomain(host: string | null, allowlist: Set<string>): boolean {
  if (!host) return false;
  if (allowlist.has(host)) return true;
  for (const d of allowlist) {
    if (host.endsWith('.' + d)) return true;
  }
  return false;
}
