// Tier 1B: multi-stage signal sequence detection.
//
// Splunk Cookbook recipe ("group multi-stage attacks") translated to a
// Postgres-backed cron. Every 30 min:
//   1. Load active sequence_patterns (declarative stage definitions)
//   2. For each active client, pull recent signals within the largest
//      pattern window
//   3. Group signals by anchor (entity_tag OR detected asset/keyword)
//   4. For each (pattern, anchor), test which stages are matched and if
//      ≥ min_stages_to_trigger, upsert a signal_sequences row
//   5. Mark stale rows expired
//
// The sequence is what makes an escalation pattern visible — single-signal
// classification can't see "announcement → mobilization → physical
// proximity" as one event. Cookbook page 9, "Grouping" method.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SequencePattern {
  id: string;
  name: string;
  stages: { name: string; match: StageMatch }[];
  window_seconds: number;
  min_stages_to_trigger: number;
}

interface StageMatch {
  category?: string;
  category_in?: string[];
  signal_type?: string;
  signal_type_in?: string[];
  source_substr?: string[];
  keywords?: string[];
}

interface SignalRow {
  id: string;
  title: string | null;
  category: string | null;
  signal_type: string | null;
  severity: string | null;
  raw_json: Record<string, any> | null;
  created_at: string;
  entity_tags: string[] | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: patterns } = await supabase
      .from('sequence_patterns')
      .select('id, name, stages, window_seconds, min_stages_to_trigger')
      .eq('is_active', true);

    if (!patterns || patterns.length === 0) {
      await recordHeartbeat(supabase, 'detect-signal-sequences-30min', 'completed', { reason: 'no_active_patterns' });
      return json({ status: 'no_active_patterns' });
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, high_value_assets, monitoring_keywords')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      await recordHeartbeat(supabase, 'detect-signal-sequences-30min', 'completed', { reason: 'no_active_clients' });
      return json({ status: 'no_active_clients' });
    }

    let detected = 0;
    let updated = 0;
    let expired = 0;

    // Largest window across all patterns determines how far back to query
    const maxWindowSec = Math.max(...patterns.map((p: SequencePattern) => p.window_seconds));

    for (const client of clients) {
      const sinceISO = new Date(Date.now() - maxWindowSec * 1000).toISOString();

      const { data: signals } = await supabase
        .from('signals')
        .select('id, title, category, signal_type, severity, raw_json, created_at, entity_tags')
        .eq('client_id', client.id)
        .gt('created_at', sinceISO)
        .is('deleted_at', null)
        .limit(3000);

      if (!signals || signals.length === 0) continue;

      // Build per-client anchor candidates from high_value_assets +
      // monitoring_keywords. These replace the hardcoded KNOWN_ASSETS
      // list — new clients work without code changes.
      const clientAnchors = buildClientAnchors(client);

      for (const pattern of patterns as SequencePattern[]) {
        const patternSinceISO = new Date(Date.now() - pattern.window_seconds * 1000).toISOString();
        const inWindow = signals.filter(s => s.created_at > patternSinceISO);
        if (inWindow.length === 0) continue;

        // Group by anchor — first entity_tag, matched_client, or one of
        // the client's high_value_assets / monitoring_keywords.
        const grouped = groupByAnchor(inWindow, clientAnchors);

        for (const [anchor, anchorSignals] of grouped.entries()) {
          // For each pattern stage, find matching signals
          const stageHits = pattern.stages.map(stage => ({
            name: stage.name,
            signal_ids: anchorSignals.filter(s => stageMatches(s, stage.match)).map(s => s.id),
          }));

          const matchedStages = stageHits.filter(h => h.signal_ids.length > 0);
          if (matchedStages.length < pattern.min_stages_to_trigger) continue;

          const allSignalIds = Array.from(new Set(matchedStages.flatMap(h => h.signal_ids)));
          const matchedSignals = anchorSignals.filter(s => allSignalIds.includes(s.id));
          if (matchedSignals.length === 0) continue;

          const startedAt = matchedSignals.reduce(
            (min, s) => (new Date(s.created_at) < min ? new Date(s.created_at) : min),
            new Date(matchedSignals[0].created_at),
          );
          const lastEventAt = matchedSignals.reduce(
            (max, s) => (new Date(s.created_at) > max ? new Date(s.created_at) : max),
            new Date(matchedSignals[0].created_at),
          );

          const sequenceScore = matchedStages.length / pattern.stages.length;
          const status = sequenceScore >= 0.66 ? 'escalated' : 'open';

          const { data: existing } = await supabase
            .from('signal_sequences')
            .select('id, signal_ids, matched_stages, status')
            .eq('pattern_id', pattern.id)
            .eq('client_id', client.id)
            .eq('anchor_label', anchor)
            .gt('last_event_at', patternSinceISO)
            .order('last_event_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existing) {
            const mergedSignalIds = Array.from(new Set([...(existing.signal_ids ?? []), ...allSignalIds]));
            const mergedStages = Array.from(new Set([...(existing.matched_stages ?? []), ...matchedStages.map(h => h.name)]));
            await supabase
              .from('signal_sequences')
              .update({
                signal_ids: mergedSignalIds,
                matched_stages: mergedStages,
                last_event_at: lastEventAt.toISOString(),
                sequence_score: sequenceScore,
                status: status,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
            updated++;
          } else {
            await supabase.from('signal_sequences').insert({
              pattern_id: pattern.id,
              client_id: client.id,
              anchor_label: anchor,
              signal_ids: allSignalIds,
              matched_stages: matchedStages.map(h => h.name),
              started_at: startedAt.toISOString(),
              last_event_at: lastEventAt.toISOString(),
              status,
              sequence_score: sequenceScore,
            });
            detected++;
          }
        }
      }
    }

    // Mark expired: open sequences with last_event_at older than their pattern's window
    const { data: expiredCandidates } = await supabase
      .from('signal_sequences')
      .select('id, pattern_id, last_event_at, sequence_patterns(window_seconds)')
      .in('status', ['open', 'escalated']);

    for (const row of expiredCandidates ?? []) {
      const w = (row.sequence_patterns as any)?.window_seconds ?? 604800;
      const ageSec = (Date.now() - new Date(row.last_event_at).getTime()) / 1000;
      if (ageSec > w) {
        await supabase.from('signal_sequences').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', row.id);
        expired++;
      }
    }

    await recordHeartbeat(supabase, 'detect-signal-sequences-30min', 'completed', {
      detected,
      updated,
      expired,
      patterns: patterns.length,
      clients: clients.length,
    });

    return json({ status: 'ok', detected, updated, expired });
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await recordHeartbeat(supabase, 'detect-signal-sequences-30min', 'failed', {}, errMsg);
    return json({ error: errMsg }, 500);
  }
});

function groupByAnchor(signals: SignalRow[], clientAnchors: string[]): Map<string, SignalRow[]> {
  const grouped = new Map<string, SignalRow[]>();
  for (const sig of signals) {
    const anchor = pickAnchor(sig, clientAnchors);
    if (!anchor) continue;
    const norm = anchor.toLowerCase().trim().substring(0, 100);
    if (!grouped.has(norm)) grouped.set(norm, []);
    grouped.get(norm)!.push(sig);
  }
  return grouped;
}

// Build a flat list of anchor candidates for a client by normalizing their
// high_value_assets + the meaningful subset of monitoring_keywords. Skips
// short tokens (<6 chars) and generic keywords because they'd over-group.
function buildClientAnchors(client: { high_value_assets?: string[] | null; monitoring_keywords?: string[] | null }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const norm = (raw || '').trim().toLowerCase();
    // Strip parenthetical qualifiers: "LNG Canada terminal (Kitimat)" → "lng canada terminal"
    const cleaned = norm.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 6) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };
  for (const a of client.high_value_assets ?? []) add(a);
  for (const k of client.monitoring_keywords ?? []) {
    // Only include monitoring_keywords that look proper-noun-ish
    // (mixed case in original, length ≥ 8). Drops generic terms like
    // "protest", "lawsuit", "cybersecurity vulnerability healthcare".
    if (typeof k === 'string' && k.length >= 8 && /[A-Z]/.test(k)) add(k);
  }
  return out;
}

// Anchor selection precedence:
//   1. First entity_tag (if monitor populated it)
//   2. raw_json.matched_client (Petronas / BCCH / etc.)
//   3. Substring match against the client's own high_value_assets /
//      monitoring_keywords — this scales to new clients without code changes.
//   4. null — signal can't be grouped, drops out of sequence detection
function pickAnchor(sig: SignalRow, clientAnchors: string[]): string | null {
  const tags = sig.entity_tags ?? [];
  if (tags.length > 0 && tags[0]) return tags[0];

  const matchedClient = sig.raw_json?.matched_client;
  if (matchedClient) return matchedClient;

  const haystack = `${sig.title ?? ''} ${sig.raw_json?.snippet ?? ''}`.toLowerCase();
  // Prefer the LONGEST matching anchor — "lng canada terminal" beats
  // "lng canada" beats "lng" — so the most specific group wins.
  let best: string | null = null;
  for (const anchor of clientAnchors) {
    if (haystack.includes(anchor) && (!best || anchor.length > best.length)) {
      best = anchor;
    }
  }
  return best;
}

function stageMatches(signal: SignalRow, m: StageMatch): boolean {
  if (m.category && signal.category !== m.category) return false;
  if (m.category_in && (!signal.category || !m.category_in.includes(signal.category))) return false;
  if (m.signal_type && signal.signal_type !== m.signal_type) return false;
  if (m.signal_type_in && (!signal.signal_type || !m.signal_type_in.includes(signal.signal_type))) return false;

  if (m.source_substr && m.source_substr.length > 0) {
    const sourceStr = String(
      signal.raw_json?.source ?? signal.raw_json?.source_kind ?? signal.raw_json?.source_function ?? ''
    ).toLowerCase();
    if (!m.source_substr.some(sub => sourceStr.includes(sub.toLowerCase()))) return false;
  }

  if (m.keywords && m.keywords.length > 0) {
    const hay = `${signal.title ?? ''} ${signal.raw_json?.snippet ?? ''} ${signal.raw_json?.description ?? ''}`.toLowerCase();
    if (!m.keywords.some(kw => hay.includes(kw.toLowerCase()))) return false;
  }
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
