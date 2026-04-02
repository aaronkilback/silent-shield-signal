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

const THREAT_SIGNAL_TYPES = new Set(['sabotage', 'protest', 'threat', 'violence', 'theft']);

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const targetClientId: string | undefined = body.client_id;

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

      const clientPatterns: any[] = [];

      // ── 1. ENTITY ESCALATION ──────────────────────────────────────────
      const entitySignalMap: Record<string, { ids: string[]; maxScore: number }> = {};
      for (const sig of recentSignals) {
        for (const tag of (sig.entity_tags || [])) {
          const key = tag.toLowerCase().trim();
          if (!entitySignalMap[key]) entitySignalMap[key] = { ids: [], maxScore: 0 };
          entitySignalMap[key].ids.push(sig.id);
          entitySignalMap[key].maxScore = Math.max(entitySignalMap[key].maxScore, sig.severity_score || 0);
        }
      }

      for (const [entityName, data] of Object.entries(entitySignalMap)) {
        if (data.ids.length < 3) continue;

        // Deduplicate contributing IDs
        const uniqueIds = [...new Set(data.ids)];
        if (uniqueIds.length < 3) continue;

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
        const severity = escalatedScore >= 80 ? 'critical' : escalatedScore >= 50 ? 'high' : escalatedScore >= 20 ? 'medium' : 'low';

        const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
          client_id: client.id,
          title: `[PATTERN] Entity escalation: "${entityName}" (${uniqueIds.length} signals in 7d)`,
          description: `Automated pattern detection: entity "${entityName}" has appeared in ${uniqueIds.length} signals over the past 7 days, indicating sustained attention or escalating activity. Contributing signals have been linked below.`,
          normalized_text: `Entity escalation pattern detected for "${entityName}": ${uniqueIds.length} signals in 7 days.`,
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
            entity_name: entityName,
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
          clientPatterns.push({ type: 'entity_escalation', entity: entityName, count: uniqueIds.length, severity });
          console.log(`[PatternDetect] entity_escalation: "${entityName}" × ${uniqueIds.length} for ${client.name} → ${severity}`);

          if (escalatedScore >= 50) {
            supabase.functions.invoke('check-incident-escalation', { body: { signalId: patternSignal.id } })
              .catch(err => console.error('[PatternDetect] escalation invoke error:', err));
          }
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
        const severity = escalatedScore >= 80 ? 'critical' : escalatedScore >= 50 ? 'high' : escalatedScore >= 20 ? 'medium' : 'low';
        const uniqueIds = [...new Set(data.ids)];

        const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
          client_id: client.id,
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
          const severity = escalatedScore >= 80 ? 'critical' : escalatedScore >= 50 ? 'high' : escalatedScore >= 20 ? 'medium' : 'low';
          const uniqueIds = recentSignals.map(s => s.id);

          const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
            client_id: client.id,
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
          const severity = escalatedScore >= 80 ? 'critical' : escalatedScore >= 50 ? 'high' : escalatedScore >= 20 ? 'medium' : 'low';
          const uniqueIds = [...new Set(typeClusterSignals.map(s => s.id))];

          const { data: patternSignal, error: psErr } = await supabase.from('signals').insert({
            client_id: client.id,
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
              supabase.functions.invoke('check-incident-escalation', { body: { signalId: patternSignal.id } })
                .catch(err => console.error('[PatternDetect] escalation invoke error:', err));
            }
          }
        }
      }

      if (clientPatterns.length > 0) {
        patternSummary.push({ client: client.name, patterns: clientPatterns });
      }
    }

    console.log(`[PatternDetect] Complete. ${totalPatternsDetected} patterns detected across ${(clients || []).length} clients.`);
    return successResponse({
      success: true,
      patterns_detected: totalPatternsDetected,
      clients_scanned: (clients || []).length,
      summary: patternSummary,
    });

  } catch (error) {
    console.error('[PatternDetect] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
