// Tier 1A: Per-client first-time-seen tracking.
//
// Splunk Cookbook recipe ("first-time-seen domain per client") translated
// to a Postgres-backed primitive every monitor function can call. The
// cookbook keeps these as `outputlookup csv` files; we persist in the
// `client_observation_baselines` table for queryability and RLS.
//
// Usage from a monitor or ingest-signal:
//
//   const novelty = await recordObservation(supabase, clientId, 'source_domain',
//     extractDomain(sourceUrl) ?? '', { source_url: sourceUrl });
//   raw_json.novelty = novelty;   // surface to the operator + downstream agents
//
// Returns the novelty BEFORE the upsert is written, so callers can attach
// the result to the signal at creation time.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ObservationKind =
  | 'source_domain'    // host extracted from source_url
  | 'source_key'       // monitor-passed source identifier (e.g. 'Google News API')
  | 'user_agent'       // for HIBP / web-scrape paths
  | 'source_ip'        // for inbound webhook / API auth events
  | 'github_repo'      // for monitor-github
  | 'hibp_breach'      // for monitor-darkweb — value is 'breach_name@domain'
  | 'social_handle'    // for social monitors
  | 'rss_feed_url'     // for monitor-rss-sources (architectural — sees client linkage)
  | 'naad_event_type'  // for monitor-naad-alerts
  | 'cve_id';          // for monitor-cisa-kev — track which CVEs hit each client

export type NoveltyLabel =
  | 'first_seen'        // first time this (client, kind, value) has ever been recorded
  | 'first_seen_30d'    // returning after >30 days of silence — meaningful re-emergence
  | 'recurring'         // seen before, occurrence_count between 2-49
  | 'frequent';         // occurrence_count >= 50, baseline noise

export interface NoveltyResult {
  label: NoveltyLabel;
  is_first_seen_ever: boolean;
  is_first_seen_30d: boolean;
  occurrence_count: number;     // count AFTER this observation is recorded
  first_seen_at: string | null;
  last_seen_at: string | null;  // BEFORE this observation
  days_since_last: number | null;
}

export async function recordObservation(
  supabase: SupabaseClient,
  clientId: string,
  kind: ObservationKind,
  rawValue: string,
  metadata?: Record<string, unknown>,
): Promise<NoveltyResult> {
  const value = (rawValue || '').trim().toLowerCase();
  if (!clientId || !value) {
    return zeroNovelty();
  }

  const { data: existing } = await supabase
    .from('client_observation_baselines')
    .select('first_seen_at, last_seen_at, occurrence_count')
    .eq('client_id', clientId)
    .eq('observation_kind', kind)
    .eq('observation_value', value)
    .maybeSingle();

  const now = new Date();
  const nowIso = now.toISOString();

  if (!existing) {
    // First-ever observation for this (client, kind, value)
    await supabase.from('client_observation_baselines').insert({
      client_id: clientId,
      observation_kind: kind,
      observation_value: value,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      occurrence_count: 1,
      metadata: metadata ?? null,
    }).then(() => {}).catch(() => {});

    return {
      label: 'first_seen',
      is_first_seen_ever: true,
      is_first_seen_30d: true,
      occurrence_count: 1,
      first_seen_at: nowIso,
      last_seen_at: null,
      days_since_last: null,
    };
  }

  const lastSeen = new Date(existing.last_seen_at);
  const daysSinceLast = (now.getTime() - lastSeen.getTime()) / (24 * 3600 * 1000);
  const newCount = (existing.occurrence_count ?? 0) + 1;

  // Update existing
  await supabase
    .from('client_observation_baselines')
    .update({
      last_seen_at: nowIso,
      occurrence_count: newCount,
      ...(metadata ? { metadata } : {}),
    })
    .eq('client_id', clientId)
    .eq('observation_kind', kind)
    .eq('observation_value', value)
    .then(() => {}).catch(() => {});

  const isFirstSeen30d = daysSinceLast > 30;
  const label: NoveltyLabel =
    isFirstSeen30d ? 'first_seen_30d'
    : newCount >= 50 ? 'frequent'
    : 'recurring';

  return {
    label,
    is_first_seen_ever: false,
    is_first_seen_30d: isFirstSeen30d,
    occurrence_count: newCount,
    first_seen_at: existing.first_seen_at,
    last_seen_at: existing.last_seen_at,
    days_since_last: Number(daysSinceLast.toFixed(1)),
  };
}

// Extracts a domain from a URL with protocol stripping + www normalization.
// Returns null on malformed input — callers should treat null as "skip".
export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    // Maybe it's a bare host without protocol
    const m = String(url).trim().toLowerCase().match(/^(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/);
    return m ? m[1] : null;
  }
}

function zeroNovelty(): NoveltyResult {
  return {
    label: 'recurring',
    is_first_seen_ever: false,
    is_first_seen_30d: false,
    occurrence_count: 0,
    first_seen_at: null,
    last_seen_at: null,
    days_since_last: null,
  };
}
