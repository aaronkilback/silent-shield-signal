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
  // Added 2026-05-11 for the former_employee_fixation pattern:
  // match signals where foreign-alignment scoring (deterministic, from
  // ingest-signal) crossed a threshold. Lets a pattern stage say
  // "this stage matches any signal with foreign_alignment >= 0.3".
  foreign_alignment_min?: number;
  // Match signals where one of the listed foreign_alignment_indicators
  // tags is present (e.g. "iran_state_media", "iran_rhetoric_*").
  foreign_alignment_indicators?: string[];
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
  composite_confidence: number | null;
  foreign_alignment_score?: number | null;
  foreign_alignment_indicators?: string[] | null;
}

// Min composite_confidence required to admit a signal into sequence
// matching. Below this, the signal is too unscored/uncertain to be
// reliably stitched into a multi-stage pattern; admitting it produces
// false-positive sequences (Coastal GasLink reputational_attack on
// May 8 2026: a sig with conf=null was matched on a "statement"
// keyword and inflated a false sequence to escalated status).
const MIN_CONFIDENCE_FOR_SEQUENCE = 0.55;

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

      const { data: rawSignals } = await supabase
        .from('signals')
        .select('id, title, category, signal_type, severity, raw_json, created_at, entity_tags, composite_confidence, foreign_alignment_score, foreign_alignment_indicators')
        .eq('client_id', client.id)
        .gt('created_at', sinceISO)
        .is('deleted_at', null)
        .limit(3000);

      // Pre-pass filters — every signal in `signals` must clear ALL of:
      //  1. composite_confidence >= MIN_CONFIDENCE_FOR_SEQUENCE (drops
      //     unscored / low-confidence rows the relevance gate already
      //     graded marginally).
      //  2. Not historical — both the regex form ("in 2022") and the
      //     structured form (raw_json.is_historical=true, or
      //     event_details.date with a year > 12 months old). A 2022
      //     protest ingested in 2026 must not count toward a "current"
      //     60-day campaign sequence.
      //  3. Not Tier-2-dismissed — when review-signal-agent has written
      //     raw_json.agent_review.verdict='dismiss', the operator-side
      //     gate already concluded the signal isn't actionable. Letting
      //     it match a sequence stage rebuilds an alert from rejected
      //     evidence.
      const signals = (rawSignals ?? []).filter(s =>
        s.composite_confidence != null
        && s.composite_confidence >= MIN_CONFIDENCE_FOR_SEQUENCE
        && !looksHistorical(s)
        && !isTier2Dismissed(s)
      );

      if (signals.length === 0) continue;

      // Build per-client anchor candidates from high_value_assets +
      // monitoring_keywords. These replace the hardcoded KNOWN_ASSETS
      // list — new clients work without code changes.
      const clientAnchors = buildClientAnchors(client);

      for (const pattern of patterns as SequencePattern[]) {
        const patternSinceMs = Date.now() - pattern.window_seconds * 1000;
        const patternSinceISO = new Date(patternSinceMs).toISOString();
        // Filter to the pattern's window using the real event time
        // (event_details.date / published_at / created_at fallback).
        // A 90-day-old event ingested today must not slip into a
        // 60-day-window pattern just because it was created today.
        const inWindow = signals.filter(s => eventTime(s).getTime() > patternSinceMs);
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

          // Prefer real event time over ingestion time. When raw_json
          // carries an event_details.date or published_at, that's the
          // actual moment the campaign stage occurred — using
          // signals.created_at instead means a story ingested 6 days
          // late looks 6 days more recent than it was, distorting
          // window math for all sequences spanning the late ingest.
          const startedAt = matchedSignals.reduce(
            (min, s) => (eventTime(s) < min ? eventTime(s) : min),
            eventTime(matchedSignals[0]),
          );
          const lastEventAt = matchedSignals.reduce(
            (max, s) => (eventTime(s) > max ? eventTime(s) : max),
            eventTime(matchedSignals[0]),
          );

          const sequenceScore = matchedStages.length / pattern.stages.length;
          const status = sequenceScore >= 0.66 ? 'escalated' : 'open';

          // 2026-05-10: respect operator dismissals. The May 9 cron
          // kept resurrecting a Coastal GasLink reputational_attack
          // false positive even after the operator manually set
          // status='dismissed' — because this query found the row by
          // (pattern, client, anchor, window) regardless of status
          // and proceeded to update it. Now we treat dismissed/resolved
          // as a sticky "leave it alone" — if such a row exists in the
          // current window, skip both update and re-create.
          const { data: dismissedExisting } = await supabase
            .from('signal_sequences')
            .select('id, status')
            .eq('pattern_id', pattern.id)
            .eq('client_id', client.id)
            .eq('anchor_label', anchor)
            .gt('last_event_at', patternSinceISO)
            .in('status', ['dismissed', 'resolved'])
            .limit(1)
            .maybeSingle();
          if (dismissedExisting) {
            console.log(`[Sequences] skip ${pattern.name}/${anchor} — operator-dismissed (id=${dismissedExisting.id})`);
            continue;
          }

          const { data: existing } = await supabase
            .from('signal_sequences')
            .select('id, signal_ids, matched_stages, status')
            .eq('pattern_id', pattern.id)
            .eq('client_id', client.id)
            .eq('anchor_label', anchor)
            .gt('last_event_at', patternSinceISO)
            .in('status', ['open', 'escalated'])
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

// Detects signals that describe a past event rather than current
// activity. Three layers:
//   1. Structured `raw_json.is_historical === true` — set by monitors
//      (e.g. monitor-twitter) that explicitly know an X post or article
//      is referencing a years-old event.
//   2. `raw_json.event_details.date` whose parsed year is >12 months
//      old — signals that carry a stamped event date (often from
//      AI-summarized social media) where the event clearly predates
//      the relevant sequence window.
//   3. Regex fallback — `(in|on|since|during|back in|the) <year>` in
//      title/snippet where the year is >12 months old. Crude — misses
//      "five years ago" without a literal year — but catches the
//      common Wikipedia-style retrospective phrasing.
function looksHistorical(signal: SignalRow): boolean {
  if (signal.raw_json?.is_historical === true) return true;

  const eventDateStr = signal.raw_json?.event_details?.date;
  if (typeof eventDateStr === 'string') {
    const parsed = Date.parse(eventDateStr);
    if (Number.isFinite(parsed)) {
      const eventYear = new Date(parsed).getFullYear();
      const currentYear = new Date().getFullYear();
      if (eventYear < currentYear - 1) return true;
    }
  }

  const text = `${signal.title ?? ''} ${signal.raw_json?.snippet ?? ''}`;
  const yearMatch = text.match(/\b(?:in|on|since|during|back\s+in|the)\s+(20[0-2]\d)\b/i);
  if (!yearMatch) return false;
  const refYear = Number(yearMatch[1]);
  const currentYear = new Date().getFullYear();
  return refYear < currentYear - 1;
}

// Best estimate of when a signal's event actually happened, falling
// back to ingestion time. Tries (in order):
//   1. raw_json.event_details.date — stamped by AI extraction on social
//      media, often the only authoritative date.
//   2. raw_json.published_at — set by RSS / news monitors that capture
//      the article publish time.
//   3. signals.created_at — the safe fallback (ingest moment).
function eventTime(signal: SignalRow): Date {
  const rj = signal.raw_json ?? {};
  const candidates = [rj?.event_details?.date, rj?.published_at];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const ms = Date.parse(c);
      if (Number.isFinite(ms)) return new Date(ms);
    }
  }
  return new Date(signal.created_at);
}

// Tier-2 review (review-signal-agent) writes its verdict into
// raw_json.agent_review.verdict. When the operator-side reviewer has
// already concluded `dismiss`, the sequence detector must not stitch
// that signal into a multi-stage pattern — it would surface a campaign
// alert built on evidence the gate already rejected.
function isTier2Dismissed(signal: SignalRow): boolean {
  const verdict = signal.raw_json?.agent_review?.verdict;
  return typeof verdict === 'string' && verdict.toLowerCase() === 'dismiss';
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
  if (typeof m.foreign_alignment_min === 'number') {
    const sigScore = signal.foreign_alignment_score
      ?? (signal.raw_json?.foreign_alignment?.score as number | undefined)
      ?? 0;
    if (sigScore < m.foreign_alignment_min) return false;
  }
  if (m.foreign_alignment_indicators && m.foreign_alignment_indicators.length > 0) {
    const sigTags: string[] = signal.foreign_alignment_indicators
      ?? (signal.raw_json?.foreign_alignment?.indicators as string[] | undefined)
      ?? [];
    if (!m.foreign_alignment_indicators.some(t => sigTags.includes(t))) return false;
  }
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
