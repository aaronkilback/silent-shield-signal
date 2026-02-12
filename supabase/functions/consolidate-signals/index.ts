import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Signal Consolidation Engine
 * 
 * Runs post-ingestion to merge related signals from different sources
 * into a single primary signal with nested updates (timeline).
 * 
 * Strategy:
 * 1. Fetch recent signals (last 24h) that haven't been consolidated
 * 2. Extract location + event-type keywords to build cluster keys
 * 3. Group signals sharing the same cluster key
 * 4. Keep the earliest signal as primary; move others to signal_updates
 * 5. Delete the duplicate signals
 */

interface SignalRow {
  id: string;
  normalized_text: string;
  title: string | null;
  category: string | null;
  severity: string | null;
  content_hash: string | null;
  created_at: string;
  client_id: string | null;
  raw_json: Record<string, unknown> | null;
}

// ── Keyword extraction ──────────────────────────────────────────────────

const LOCATION_PATTERNS = [
  // Canadian cities / regions likely to appear in signals
  /\b(tumbler\s*ridge|prince\s*george|kamloops|kelowna|vancouver|victoria|surrey|burnaby|nanaimo|kitimat|terrace|fort\s*st\s*john|dawson\s*creek|prince\s*rupert|whitehorse|yellowknife|edmonton|calgary|saskatoon|regina|winnipeg|thunder\s*bay|toronto|ottawa|montreal|quebec\s*city|halifax|fredericton|charlottetown|st\.?\s*john'?s?)\b/gi,
  // Province abbreviations and names
  /\b(b\.?c\.?|british\s*columbia|alberta|saskatchewan|manitoba|ontario|quebec|nova\s*scotia|new\s*brunswick|pei|newfoundland|yukon|nwt|nunavut)\b/gi,
];

const EVENT_TYPE_PATTERNS: Array<{ pattern: RegExp; eventType: string }> = [
  { pattern: /\b(active\s*shooter|mass\s*shoot|shooting|shooter|shots?\s*fired|gunm[ae]n|gunfire)\b/i, eventType: 'shooting' },
  { pattern: /\b(bomb\s*threat|explosion|bombing|ied|suspicious\s*package|detonat)\b/i, eventType: 'bombing' },
  { pattern: /\b(hostage|barricade|standoff|stand-off)\b/i, eventType: 'hostage' },
  { pattern: /\b(stabb?ing|knife\s*attack|bladed?\s*weapon|machete)\b/i, eventType: 'stabbing' },
  { pattern: /\b(amber\s*alert|child\s*abduction|missing\s*child)\b/i, eventType: 'amber_alert' },
  { pattern: /\b(wildfire|forest\s*fire|bush\s*fire)\b/i, eventType: 'wildfire' },
  { pattern: /\b(flood|flooding|flash\s*flood)\b/i, eventType: 'flood' },
  { pattern: /\b(tornado|hurricane|cyclone)\b/i, eventType: 'tornado' },
  { pattern: /\b(earthquake|seismic)\b/i, eventType: 'earthquake' },
  { pattern: /\b(evacuation\s*order|civil\s*emergency)\b/i, eventType: 'civil_emergency' },
  { pattern: /\b(terrorist|terrorism|radicali[sz])\b/i, eventType: 'terrorism' },
  { pattern: /\b(mass\s*casualty|multiple\s*deaths|deaths?\s*reported|fatalities|tragedy|tragic|massacre)\b/i, eventType: 'mass_casualty' },
  { pattern: /\b(lockdown|shelter[\s-]in[\s-]place|police\s*incident|critical\s*incident)\b/i, eventType: 'critical_incident' },
];

function extractLocations(text: string): string[] {
  const locations = new Set<string>();
  for (const pattern of LOCATION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      locations.add(m[1].toLowerCase().replace(/\s+/g, ' ').trim());
    }
  }
  return [...locations];
}

function extractEventTypes(text: string): string[] {
  const types = new Set<string>();
  for (const { pattern, eventType } of EVENT_TYPE_PATTERNS) {
    if (pattern.test(text)) {
      types.add(eventType);
    }
  }
  return [...types];
}

/**
 * Build a cluster key from a signal's text.
 * Format: "location|eventType" — signals sharing any cluster key belong together.
 * Returns multiple keys if multiple locations/events are found.
 */
function buildClusterKeys(text: string): string[] {
  const locations = extractLocations(text);
  const eventTypes = extractEventTypes(text);

  if (locations.length === 0 || eventTypes.length === 0) return [];

  // Filter out province-level locations — too broad for clustering
  const PROVINCE_LEVEL = new Set(['b.c.', 'bc', 'british columbia', 'alberta', 'saskatchewan', 'manitoba', 'ontario', 'quebec', 'nova scotia', 'new brunswick', 'pei', 'newfoundland', 'yukon', 'nwt', 'nunavut']);
  const specificLocations = locations.filter(loc => !PROVINCE_LEVEL.has(loc));
  
  if (specificLocations.length === 0) return [];

  const keys: string[] = [];
  for (const loc of specificLocations) {
    for (const et of eventTypes) {
      keys.push(`${loc}|${et}`);
    }
  }
  return keys;
}

// ── Main handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  try {
    // Parse optional body params
    let hoursBack = 24;
    let dryRun = false;
    try {
      const body = await req.json();
      if (body?.hours_back) hoursBack = Number(body.hours_back);
      if (body?.dry_run) dryRun = Boolean(body.dry_run);
    } catch { /* no body is fine */ }

    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    console.log(`[Consolidate] Scanning signals since ${cutoff} (dry_run=${dryRun})`);

    // 1. Fetch recent signals
    const { data: signals, error: fetchErr } = await supabase
      .from('signals')
      .select('id, normalized_text, title, category, severity, content_hash, created_at, client_id, raw_json')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (fetchErr) throw new Error(`Failed to fetch signals: ${fetchErr.message}`);
    if (!signals || signals.length === 0) {
      return successResponse({ success: true, message: 'No recent signals to consolidate', merged: 0 });
    }

    console.log(`[Consolidate] Found ${signals.length} signals in window`);

    // 2. Build clusters
    // Map: clusterKey → signal IDs that share it
    const clusterMap = new Map<string, string[]>();
    const signalMap = new Map<string, SignalRow>();

    // Track location-only clusters for aggressive matching
    const locationMap = new Map<string, string[]>();
    const PROVINCE_LEVEL = new Set(['b.c.', 'bc', 'british columbia', 'alberta', 'saskatchewan', 'manitoba', 'ontario', 'quebec', 'nova scotia', 'new brunswick', 'pei', 'newfoundland', 'yukon', 'nwt', 'nunavut']);

    for (const sig of signals) {
      signalMap.set(sig.id, sig as SignalRow);
      const text = `${sig.title || ''} ${sig.normalized_text || ''}`;
      const keys = buildClusterKeys(text);
      for (const key of keys) {
        if (!clusterMap.has(key)) clusterMap.set(key, []);
        clusterMap.get(key)!.push(sig.id);
      }

      // Aggressive: cluster by specific city/town alone (not province-level)
      const locations = extractLocations(text);
      for (const loc of locations) {
        if (PROVINCE_LEVEL.has(loc)) continue;
        const locKey = `loc_only|${loc}`;
        if (!locationMap.has(locKey)) locationMap.set(locKey, []);
        locationMap.get(locKey)!.push(sig.id);
      }
    }

    // 3. Merge overlapping clusters via union-find
    const parent = new Map<string, string>();
    function find(id: string): string {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    }
    function union(a: string, b: string) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    }

    for (const ids of clusterMap.values()) {
      for (let i = 1; i < ids.length; i++) {
        union(ids[0], ids[i]);
      }
    }

    // Aggressive location-only clustering: signals about the same specific town/city
    for (const ids of locationMap.values()) {
      if (ids.length > 1) {
        for (let i = 1; i < ids.length; i++) {
          union(ids[0], ids[i]);
        }
      }
    }

    // Group signals by their root
    const groups = new Map<string, string[]>();
    for (const id of signalMap.keys()) {
      if (!parent.has(id)) continue; // no cluster key → skip
      const root = find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(id);
    }

    // 4. For each group with >1 signal, keep earliest, nest others
    let totalMerged = 0;
    const mergeDetails: Array<{ primary: string; merged_count: number; cluster_key: string }> = [];

    for (const [_root, memberIds] of groups) {
      if (memberIds.length <= 1) continue;

      // Sort by created_at ascending — earliest first
      memberIds.sort((a, b) => {
        const sa = signalMap.get(a)!, sb = signalMap.get(b)!;
        return new Date(sa.created_at).getTime() - new Date(sb.created_at).getTime();
      });

      const primaryId = memberIds[0];
      const primary = signalMap.get(primaryId)!;
      const duplicateIds = memberIds.slice(1);

      // Determine a representative cluster key for logging
      const primaryText = `${primary.title || ''} ${primary.normalized_text || ''}`;
      const repKeys = buildClusterKeys(primaryText);

      console.log(`[Consolidate] Merging ${duplicateIds.length} signals into primary ${primaryId} (${repKeys[0] || 'unknown'})`);

      if (!dryRun) {
        for (const dupId of duplicateIds) {
          const dup = signalMap.get(dupId)!;

          // Generate a content hash for update dedup
          const encoder = new TextEncoder();
          const updateHashData = encoder.encode(`consolidate|${primaryId}|${dupId}`);
          const hashBuffer = await crypto.subtle.digest('SHA-256', updateHashData);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const updateContentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          // Check if this update already exists
          const { data: existingUpdate } = await supabase
            .from('signal_updates')
            .select('id')
            .eq('content_hash', updateContentHash)
            .maybeSingle();

          if (!existingUpdate) {
            // Create signal_update entry
            const sourceUrl = dup.raw_json?.url as string || dup.raw_json?.source_url as string || null;
            const sourceName = dup.raw_json?.source as string || dup.raw_json?.source_name as string || 'consolidated';

            await supabase
              .from('signal_updates')
              .insert({
                signal_id: primaryId,
                content: dup.normalized_text || dup.title || 'Related signal merged',
                source_name: sourceName,
                source_url: sourceUrl,
                content_hash: updateContentHash,
                metadata: {
                  original_signal_id: dupId,
                  original_created_at: dup.created_at,
                  original_category: dup.category,
                  original_severity: dup.severity,
                  consolidated: true,
                },
              });
          }

          // Save content hash to rejected list so it doesn't get re-ingested
          if (dup.content_hash) {
            await supabase
              .from('rejected_content_hashes')
              .upsert({
                content_hash: dup.content_hash,
                client_id: dup.client_id,
                reason: 'consolidated_duplicate',
                original_signal_title: (dup.title || '').slice(0, 200),
              }, { onConflict: 'content_hash,client_id', ignoreDuplicates: true });
          }

          // Delete the duplicate signal
          await supabase.from('signals').delete().eq('id', dupId);
        }

        // Upgrade severity on primary if any duplicate was higher
        const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
        let maxSeverity = severityRank[primary.severity || 'low'] || 1;
        for (const dupId of duplicateIds) {
          const dup = signalMap.get(dupId)!;
          const rank = severityRank[dup.severity || 'low'] || 1;
          if (rank > maxSeverity) maxSeverity = rank;
        }
        const severityName = Object.entries(severityRank).find(([_, v]) => v === maxSeverity)?.[0] || primary.severity;
        if (severityName !== primary.severity) {
          await supabase.from('signals').update({ severity: severityName }).eq('id', primaryId);
        }
      }

      totalMerged += duplicateIds.length;
      mergeDetails.push({
        primary: primaryId,
        merged_count: duplicateIds.length,
        cluster_key: repKeys[0] || 'unknown',
      });
    }

    console.log(`[Consolidate] Done. Merged ${totalMerged} signals into ${mergeDetails.length} primaries.`);

    return successResponse({
      success: true,
      signals_scanned: signals.length,
      signals_merged: totalMerged,
      clusters: mergeDetails.length,
      details: mergeDetails,
      dry_run: dryRun,
    });

  } catch (error) {
    console.error('[Consolidate] Error:', error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
