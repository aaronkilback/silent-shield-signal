/**
 * Detect Threat Patterns
 *
 * Runs after each OSINT monitor cycle. Analyses signals from the last 7 days
 * per client and detects four pattern types:
 *
 *   entity_escalation  — same entity in 3+ signals within 7 days
 *   geographic_cluster — 2+ signals from the same location within 48h
 *   frequency_spike    — this week's signal count > 2× last week's AND ≥ 3 signals
 *   type_cluster       — 3+ sabotage/protest/threat/violence signals within 72h
 *
 * For each new pattern a "pattern" signal is created and contributing signal IDs
 * are recorded in signal_pattern_contributors.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { enqueueJob } from "../_shared/queue.ts";
import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const THREAT_SIGNAL_TYPES = new Set(['sabotage', 'protest', 'threat', 'violence', 'theft']);

// #83 (2026-07-09) — SEVERITY RECALIBRATION for [PATTERN] meta-signals.
// A pattern signal (entity escalation / geo cluster / frequency spike / type cluster)
// is an ANALYST-ATTENTION nudge, not a direct threat event — it never auto-creates an
// incident (check-incident-escalation is intentionally not invoked for patterns).
// Previously severity was derived from maxScore+N and could reach 'high'/'critical',
// flooding the feed with meta-signals that read as real threats (~35/wk at high/crit on
// common nouns). Cap pattern severity at MEDIUM: strong → medium, weak → low; never
// high/critical. (severity_score is still recorded for ranking.)
const patternSeverity = (score: number): 'medium' | 'low' => (score >= 50 ? 'medium' : 'low');

// #83 (2026-07-09) — COMMON-NOUN / ecosystem-term suppression (rarity-over-commonality).
// "LNG", "pipeline", "Toronto", "Switzerland" appear in many signals BECAUSE they are
// common words/geographies, not because an actor is escalating. Entity-escalation
// patterns on these are pure noise. Skip them. Starter list — TUNABLE; extend as the
// feed reveals more ecosystem nouns (operator-reviewable).
const COMMON_NOUN_STOPLIST = new Set([
  'lng', 'pipeline', 'oil', 'gas', 'natural gas', 'energy', 'crude', 'refinery', 'fuel', 'petroleum', 'coal',
  'canada', 'bc', 'british columbia', 'alberta', 'ontario', 'toronto', 'vancouver', 'calgary', 'ottawa',
  'montreal', 'edmonton', 'winnipeg', 'halifax', 'switzerland', 'usa', 'us', 'united states', 'uk',
  'china', 'russia', 'india', 'europe', 'asia', 'america', 'north america',
  'security', 'threat', 'attack', 'protest', 'protests', 'activism', 'government', 'police', 'military',
  'company', 'corporation', 'project', 'news', 'report', 'update', 'statement', 'community', 'industry',
  'market', 'economy', 'climate', 'environment', 'indigenous', 'first nations',
]);

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // WO-CHECK5-BURNDOWN-01: machine-only (cron + auto-orchestrator). Internal-caller gate BEFORE
  // service-role client + body. Joins the batch-1 cutover group (deploy with FORTRESS_INTERNAL_SECRET wired).
  const gate = requireInternalCaller(req);
  if (gate) return gate;

  // hb handles outside try so the catch can fail the heartbeat. job_name matches cron_job_registry + cron jobname.
  let hbClient: any = null;
  let hb: any = null;
  try {
    const supabase = createServiceClient();
    hbClient = supabase;
    hb = await startHeartbeat(supabase, 'fortress-detect-patterns-6h');
    const body = await req.json().catch(() => ({}));
    const targetClientId: string | undefined = body.client_id;

    // #120 Phase 1 — resolve "Fortress Pattern Detector" source_id ONCE for all
    // pattern signal inserts below. Pattern signals are internally derived; this
    // source row makes their internal provenance explicit so Aegis can cite them
    // as "Fortress internal pattern detection" rather than as a ghost source.
    // Created in migration 20260521020000_source_attribution_phase1.sql.
    const { data: patternSourceRow } = await supabase
      .from('sources')
      .select('id')
      .eq('name', 'Fortress Pattern Detector')
      .maybeSingle();
    const patternSourceId: string | null = patternSourceRow?.id ?? null;
    if (!patternSourceId) {
      console.warn('[detect-threat-patterns] Fortress Pattern Detector source row not found — pattern signals will land without internal attribution');
    }

    // Fetch clients to process
    const clientQuery = supabase.from('clients').select('id, name').eq('status', 'active');
    if (targetClientId) clientQuery.eq('id', targetClientId);
    const { data: clients, error: clientsError } = await clientQuery;
    if (clientsError) throw clientsError;

    let totalPatternsDetected = 0;
    const patternSummary: any[] = [];

    for (const client of clients || []) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

      // Fetch all signals for this client in the last 7 days (excluding pattern signals)
      const { data: recentSignals } = await supabase
        .from('signals')
        .select('id, title, signal_type, severity_score, severity, location, entity_tags, created_at, raw_json')
        .eq('client_id', client.id)
        .neq('signal_type', 'pattern')
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false });

      if (!recentSignals || recentSignals.length === 0) continue;

      // Phase 4C: also load entity_mentions for signals in this window.
      // entity_mentions uses resolved entity IDs (from Phase 4B correlate-entities),
      // which are far more reliable than raw entity_tags text strings.
      // We build a map: signal_id -> [entity_id, ...]
      const signalIds = recentSignals.map(s => s.id);
      const { data: mentionRows } = await supabase
        .from('entity_mentions')
        .select('signal_id, entity_id, entities(id, name)')
        .in('signal_id', signalIds);

      // Build: entity_id -> { name, signal_ids[], maxScore }
      const entityMentionMap: Record<string, { name: string; signalIds: string[]; maxScore: number }> = {};
      for (const row of (mentionRows || [])) {
        const entityId = row.entity_id;
        const entityName = (row.entities as any)?.name || entityId;
        const sig = recentSignals.find(s => s.id === row.signal_id);
        if (!entityMentionMap[entityId]) {
          entityMentionMap[entityId] = { name: entityName, signalIds: [], maxScore: 0 };
        }
        entityMentionMap[entityId].signalIds.push(row.signal_id);
        entityMentionMap[entityId].maxScore = Math.max(
          entityMentionMap[entityId].maxScore,
          sig?.severity_score || 0
        );
      }

      const clientPatterns: any[] = [];

      // ── 1. ENTITY ESCALATION ──────────────────────────────────────────
      // Phase 4C: prefer entity_mentions (resolved entity IDs from Phase 4B)
      // over raw entity_tags text. Falls back to entity_tags if no mentions exist.
      const entitySignalMap: Record<string, { ids: string[]; maxScore: number; resolvedName?: string }> = {};

      // Primary: use resolved entity mentions (more reliable)
      for (const [entityId, data] of Object.entries(entityMentionMap)) {
        const uniqueIds = [...new Set(data.signalIds)];
        entitySignalMap[`entity:${entityId}`] = {
          ids: uniqueIds,
          maxScore: data.maxScore,
          resolvedName: data.name,
        };
      }

      // Fallback: raw entity_tags for signals without mention data
      const signalsWithMentions = new Set(Object.values(entityMentionMap).flatMap(d => d.signalIds));
      for (const sig of recentSignals) {
        if (signalsWithMentions.has(sig.id)) continue; // already covered by mentions
        for (const tag of (sig.entity_tags || [])) {
          const key = `tag:${tag.toLowerCase().trim()}`;
          if (!entitySignalMap[key]) entitySignalMap[key] = { ids: [], maxScore: 0 };
          entitySignalMap[key].ids.push(sig.id);
          entitySignalMap[key].maxScore = Math.max(entitySignalMap[key].maxScore, sig.severity_score || 0);
        }
      }

      for (const [entityKey, data] of Object.entries(entitySignalMap)) {
        if (data.ids.length < 3) continue;

        // Deduplicate contributing IDs
        const uniqueIds = [...new Set(data.ids)];
        if (uniqueIds.length < 3) continue;

        // Use resolved entity name if available, fall back to raw key
        const displayName = data.resolvedName || entityKey.replace(/^(entity:|tag:)/, '');
        const isResolvedEntity = entityKey.startsWith('entity:');
        const entityId = isResolvedEntity ? entityKey.replace('entity:', '') : null;

        // #83 — suppress common-noun / ecosystem-term escalations (rarity-over-commonality):
        // these cluster because the word is common, not because an actor is escalating.
        if (COMMON_NOUN_STOPLIST.has(displayName.trim().toLowerCase())) {
          console.log(`[PatternDetect] SKIP entity_escalation for common-noun "${displayName}" — ecosystem term, not an actor (#83)`);
          continue;
        }

        const alreadyDetected = await supabase.rpc('pattern_already_detected', {
          p_client_id: client.id,
          p_pattern_type: 'entity_escalation',
          p_window_hours: 24,
        });
        if (alreadyDetected.data) {
          console.log(`[PatternDetect] entity_escalation already detected for ${client.name}, skipping`);
          break; // only one per client per 24h
        }

        const escalatedScore = Math.min(100, data.maxScore + 20);
        const severity = patternSeverity(escalatedScore); // #83: [PATTERN] capped at medium

        const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
          client_id: client.id,
          source_id: patternSourceId,
          title: `[PATTERN] Entity escalation: "${displayName}" (${uniqueIds.length} signals in 7d)`,
          description: `Automated pattern detection: entity "${displayName}" has appeared in ${uniqueIds.length} signals over the past 7 days${isResolvedEntity ? ' (resolved via entity graph)' : ''}, indicating sustained attention or escalating activity. Contributing signals have been linked below.`,
          normalized_text: `Entity escalation pattern detected for "${displayName}": ${uniqueIds.length} signals in 7 days.`,
          signal_type: 'pattern',
          category: 'active_threat',
          severity_score: escalatedScore,
          severity,
          status: 'new',
          is_test: false,
          raw_json: {
            pattern_type: 'entity_escalation',
            pattern_window_hours: 168,
            contributing_signal_ids: uniqueIds,
            contributing_count: uniqueIds.length,
            entity_name: displayName,
            entity_id: entityId,
            resolved_from_graph: isResolvedEntity,
            max_contributing_score: data.maxScore,
            detected_at: new Date().toISOString(),
            auto_detected: true,
          },
        }).select('id').single();

        if (!psErr && patternSignal) {
          // Link contributing signals
          await supabase.from('signal_pattern_contributors').insert(
            uniqueIds.slice(0, 20).map(sid => ({
              pattern_signal_id: patternSignal.id,
              contributing_signal_id: sid,
              pattern_type: 'entity_escalation',
            }))
          );
          totalPatternsDetected++;
          clientPatterns.push({ type: 'entity_escalation', entity: displayName, count: uniqueIds.length, severity, resolved: isResolvedEntity });
          console.log(`[PatternDetect] entity_escalation: "${displayName}" × ${uniqueIds.length} for ${client.name} → ${severity} (${isResolvedEntity ? 'graph-resolved' : 'tag-based'})`);

          // Pattern signals must not auto-create incidents — they are meta-signals, not raw threat events
          // check-incident-escalation intentionally not invoked here
        }
        break; // one entity escalation per run per client
      }

      // ── 2. GEOGRAPHIC CLUSTER ─────────────────────────────────────────
      const geoSignals = recentSignals.filter(s => s.created_at >= fortyEightHoursAgo && s.location);
      const geoMap: Record<string, { ids: string[]; maxScore: number }> = {};
      for (const sig of geoSignals) {
        const loc = (sig.location || '').trim().toLowerCase().split(',')[0]; // city-level
        if (!loc || loc.length < 3) continue;
        if (!geoMap[loc]) geoMap[loc] = { ids: [], maxScore: 0 };
        geoMap[loc].ids.push(sig.id);
        geoMap[loc].maxScore = Math.max(geoMap[loc].maxScore, sig.severity_score || 0);
      }

      for (const [location, data] of Object.entries(geoMap)) {
        if (data.ids.length < 2) continue;

        const alreadyDetected = await supabase.rpc('pattern_already_detected', {
          p_client_id: client.id,
          p_pattern_type: 'geographic_cluster',
          p_window_hours: 24,
        });
        if (alreadyDetected.data) break;

        const escalatedScore = Math.min(100, data.maxScore + 15);
        const severity = patternSeverity(escalatedScore); // #83: [PATTERN] capped at medium
        const uniqueIds = [...new Set(data.ids)];

        const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
          client_id: client.id,
          source_id: patternSourceId,
          title: `[PATTERN] Geographic cluster: ${data.ids.length} signals near "${location}" in 48h`,
          description: `Automated pattern detection: ${data.ids.length} signals from the "${location}" area have been detected within the last 48 hours, suggesting a localized incident cluster or coordinated activity.`,
          normalized_text: `Geographic cluster: ${data.ids.length} signals near "${location}" within 48 hours.`,
          signal_type: 'pattern',
          category: 'active_threat',
          severity_score: escalatedScore,
          severity,
          location,
          status: 'new',
          is_test: false,
          raw_json: {
            pattern_type: 'geographic_cluster',
            pattern_window_hours: 48,
            contributing_signal_ids: uniqueIds,
            contributing_count: uniqueIds.length,
            cluster_location: location,
            max_contributing_score: data.maxScore,
            detected_at: new Date().toISOString(),
            auto_detected: true,
          },
        }).select('id').single();

        if (!psErr && patternSignal) {
          await supabase.from('signal_pattern_contributors').insert(
            uniqueIds.slice(0, 20).map(sid => ({
              pattern_signal_id: patternSignal.id,
              contributing_signal_id: sid,
              pattern_type: 'geographic_cluster',
            }))
          );
          totalPatternsDetected++;
          clientPatterns.push({ type: 'geographic_cluster', location, count: uniqueIds.length, severity });
          console.log(`[PatternDetect] geographic_cluster: "${location}" × ${uniqueIds.length} for ${client.name} → ${severity}`);
        }
        break;
      }

      // ── 3. FREQUENCY SPIKE ────────────────────────────────────────────
      const currentWeekCount = recentSignals.length; // already filtered to 7 days
      const { count: priorWeekCount } = await supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .neq('signal_type', 'pattern')
        .gte('created_at', fourteenDaysAgo)
        .lt('created_at', sevenDaysAgo);

      const prior = priorWeekCount || 0;
      if (currentWeekCount >= 3 && currentWeekCount > (prior * 2)) {
        const alreadyDetected = await supabase.rpc('pattern_already_detected', {
          p_client_id: client.id,
          p_pattern_type: 'frequency_spike',
          p_window_hours: 24,
        });

        if (!alreadyDetected.data) {
          const avgScore = recentSignals.reduce((sum, s) => sum + (s.severity_score || 0), 0) / recentSignals.length;
          const escalatedScore = Math.min(100, Math.round(avgScore + 20));
          const severity = patternSeverity(escalatedScore); // #83: [PATTERN] capped at medium
          const uniqueIds = recentSignals.map(s => s.id);

          const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
            client_id: client.id,
            source_id: patternSourceId,
            title: `[PATTERN] Frequency spike: ${currentWeekCount} signals this week (${prior} prior week)`,
            description: `Automated pattern detection: signal volume for this client has spiked from ${prior} signals last week to ${currentWeekCount} this week — a ${prior > 0 ? Math.round((currentWeekCount / prior - 1) * 100) : 100}% increase. This volume anomaly may indicate elevated threat activity or a coordinated campaign.`,
            normalized_text: `Signal frequency spike: ${currentWeekCount} signals this week vs ${prior} last week.`,
            signal_type: 'pattern',
            category: 'active_threat',
            severity_score: escalatedScore,
            severity,
            status: 'new',
            is_test: false,
            raw_json: {
              pattern_type: 'frequency_spike',
              pattern_window_hours: 168,
              contributing_signal_ids: uniqueIds.slice(0, 30),
              contributing_count: currentWeekCount,
              current_week_count: currentWeekCount,
              prior_week_count: prior,
              spike_ratio: prior > 0 ? (currentWeekCount / prior).toFixed(2) : 'new',
              detected_at: new Date().toISOString(),
              auto_detected: true,
            },
          }).select('id').single();

          if (!psErr && patternSignal) {
            await supabase.from('signal_pattern_contributors').insert(
              uniqueIds.slice(0, 20).map(sid => ({
                pattern_signal_id: patternSignal.id,
                contributing_signal_id: sid,
                pattern_type: 'frequency_spike',
              }))
            );
            totalPatternsDetected++;
            clientPatterns.push({ type: 'frequency_spike', current: currentWeekCount, prior, severity });
            console.log(`[PatternDetect] frequency_spike: ${currentWeekCount} vs ${prior} for ${client.name} → ${severity}`);
          }
        }
      }

      // ── 4. TYPE CLUSTER (sabotage / protest / threat / violence) ──────
      const typeClusterSignals = recentSignals.filter(s =>
        s.created_at >= seventyTwoHoursAgo && THREAT_SIGNAL_TYPES.has(s.signal_type)
      );

      if (typeClusterSignals.length >= 3) {
        const alreadyDetected = await supabase.rpc('pattern_already_detected', {
          p_client_id: client.id,
          p_pattern_type: 'type_cluster',
          p_window_hours: 24,
        });

        if (!alreadyDetected.data) {
          const typeCount: Record<string, number> = {};
          for (const sig of typeClusterSignals) {
            typeCount[sig.signal_type] = (typeCount[sig.signal_type] || 0) + 1;
          }
          const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0][0];
          const maxScore = Math.max(...typeClusterSignals.map(s => s.severity_score || 0));
          const escalatedScore = Math.min(100, maxScore + 25);
          const severity = patternSeverity(escalatedScore); // #83: [PATTERN] capped at medium
          const uniqueIds = [...new Set(typeClusterSignals.map(s => s.id))];

          const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
            client_id: client.id,
            source_id: patternSourceId,
            title: `[PATTERN] Threat type cluster: ${typeClusterSignals.length} ${dominantType} signals in 72h`,
            description: `Automated pattern detection: ${typeClusterSignals.length} threat signals of type "${dominantType}" (and related types) have been detected within 72 hours. Types observed: ${Object.entries(typeCount).map(([t, c]) => `${t} (${c})`).join(', ')}. This clustering suggests a coordinated or escalating threat campaign.`,
            normalized_text: `Threat type cluster: ${typeClusterSignals.length} signals (${dominantType}-dominant) within 72 hours.`,
            signal_type: 'pattern',
            category: 'active_threat',
            severity_score: escalatedScore,
            severity,
            status: 'new',
            is_test: false,
            raw_json: {
              pattern_type: 'type_cluster',
              pattern_window_hours: 72,
              contributing_signal_ids: uniqueIds,
              contributing_count: uniqueIds.length,
              dominant_type: dominantType,
              type_breakdown: typeCount,
              max_contributing_score: maxScore,
              detected_at: new Date().toISOString(),
              auto_detected: true,
            },
          }).select('id').single();

          if (!psErr && patternSignal) {
            await supabase.from('signal_pattern_contributors').insert(
              uniqueIds.slice(0, 20).map(sid => ({
                pattern_signal_id: patternSignal.id,
                contributing_signal_id: sid,
                pattern_type: 'type_cluster',
              }))
            );
            totalPatternsDetected++;
            clientPatterns.push({ type: 'type_cluster', dominantType, count: uniqueIds.length, severity });
            console.log(`[PatternDetect] type_cluster: ${typeClusterSignals.length} threat signals for ${client.name} → ${severity}`);

            if (escalatedScore >= 50) {
              // Durable queue — was fire-and-forget invoke.
              enqueueJob(supabase, {
                type: 'check-incident-escalation',
                payload: { signalId: patternSignal.id },
                idempotencyKey: `check-incident-escalation:${patternSignal.id}`,
              }).catch(err => console.error('[PatternDetect] escalation enqueue error:', err));
            }
          }
        }
      }

      if (clientPatterns.length > 0) {
        patternSummary.push({ client: client.name, patterns: clientPatterns });
      }
    }

    console.log(`[PatternDetect] Complete. ${totalPatternsDetected} patterns detected across ${(clients || []).length} clients.`);
    await completeHeartbeat(supabase, hb, {
      patterns_detected: totalPatternsDetected,
      clients_scanned: (clients || []).length,
    });
    return successResponse({
      success: true,
      patterns_detected: totalPatternsDetected,
      clients_scanned: (clients || []).length,
      summary: patternSummary,
    });

  } catch (error) {
    console.error('[PatternDetect] Error:', error);
    if (hbClient && hb) { try { await failHeartbeat(hbClient, hb, error); } catch (_) { /* best-effort */ } }
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
