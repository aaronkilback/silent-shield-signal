import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

/**
 * Signal Consolidation Engine — TITLE-SIMILARITY dedup, SOFT-DELETE only.
 *
 * Rewritten 2026-08-21 (operator rulings 1/2/3, FINDING-CONSOLIDATE-SIGNALS-DELETER):
 *   1. The HARD-DELETE path is GONE. A duplicate is SOFT-DELETED (deleted_at + reason + quarantined),
 *      like everything else on the platform. No `signals.delete()`. No DEDUP_DELETER_ENABLED flag — a
 *      flag that could be flipped is not "off"; the destructive path is removed by construction.
 *   2. Strategies A (location+event / location-only) and D (same-source keyword-overlap) are REMOVED.
 *      They merged distinct events at sim 0.10–0.29 (a homicide trial + a wildfire into unrelated
 *      primaries) and no threshold rescues them. Strategy B (same-source+actor) is removed as the same
 *      class (same actor != same event). Only title similarity remains.
 *   3. The remaining strategy is a FUZZY TITLE MERGE, scoped to the SAME client + SAME day, using a
 *      pg_trgm-equivalent trigram similarity (per-word "  w " padding, set Jaccard). Exact-title
 *      (old Strategy C) is the sim=1.0 special case. Threshold 0.50 — DB-calibrated (catches reworded
 *      cross-outlet dups like the Kitimat pair at 0.563; below 0.50 distinct events appear).
 *
 * Preservation before soft-delete is unchanged: the duplicate is copied to signal_updates (full content +
 * source + original metadata) and its content_hash recorded in rejected_content_hashes. The surviving
 * primary keeps the HIGHER severity.
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
  source_id: string | null;
  raw_json: Record<string, unknown> | null;
}

const SIM_THRESHOLD = 0.50;
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// pg_trgm-equivalent trigram similarity: split into words, pad each "  word ", set-Jaccard on trigrams.
function pgTrigrams(str: string): Set<string> {
  const set = new Set<string>();
  for (const w of (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)) {
    const p = '  ' + w + ' ';
    for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}
function trigramSim(a: string, b: string): number {
  const A = pgTrigrams(a), B = pgTrigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
const dayOf = (iso: string) => String(iso || '').slice(0, 10);

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  try {
    let hoursBack = 24;
    let dryRun = false;
    try {
      const body = await req.json();
      if (body?.hours_back) hoursBack = Number(body.hours_back);
      if (body?.dry_run) dryRun = Boolean(body.dry_run);
    } catch { /* no body is fine */ }

    const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    console.log(`[Consolidate] Scanning signals since ${cutoff} (dry_run=${dryRun})`);

    // Fetch recent ACTIVE signals only — never re-touch already soft-deleted / quarantined rows.
    const { data: signals, error: fetchErr } = await supabase
      .from('signals')
      .select('id, normalized_text, title, category, severity, content_hash, created_at, client_id, source_id, raw_json')
      .gte('created_at', cutoff)
      .eq('quality_status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (fetchErr) throw new Error(`Failed to fetch signals: ${fetchErr.message}`);
    if (!signals || signals.length === 0) {
      return successResponse({ success: true, message: 'No recent signals to consolidate', merged: 0, dry_run: dryRun });
    }
    console.log(`[Consolidate] Found ${signals.length} active signals in window`);

    // ── FUZZY TITLE CLUSTERING, scoped to (client_id, day). Cross-client NEVER merges (bucket key
    //    includes client_id). Greedy: each signal joins the first same-bucket cluster whose representative
    //    title is trigram-similar >= threshold, else opens a new cluster. Earliest is the primary. ──
    const buckets = new Map<string, SignalRow[]>();  // `${client_id}|${day}` -> signals (created_at asc)
    for (const s of signals as SignalRow[]) {
      if (!s.title || s.title.length < 6) continue; // untitled/degenerate rows are never fuzzy-merged
      const key = `${s.client_id ?? 'null'}|${dayOf(s.created_at)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(s);
    }

    const clusters: SignalRow[][] = [];
    for (const bucketSignals of buckets.values()) {
      const reps: SignalRow[][] = []; // each entry is a cluster; [0] is the representative (earliest)
      for (const s of bucketSignals) {
        let placed = false;
        for (const cluster of reps) {
          if (trigramSim(cluster[0].title || '', s.title || '') >= SIM_THRESHOLD) { cluster.push(s); placed = true; break; }
        }
        if (!placed) reps.push([s]);
      }
      for (const cluster of reps) if (cluster.length > 1) clusters.push(cluster);
    }

    // ── For each multi-member cluster: keep earliest as primary, SOFT-DELETE the rest (preserving them). ──
    let totalMerged = 0;
    const mergeDetails: Array<{ primary: string; primary_title: string; merged_count: number; sample: string; min_sim: number }> = [];

    for (const cluster of clusters) {
      cluster.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const primary = cluster[0];
      const dups = cluster.slice(1);
      let minSim = 1;
      for (const d of dups) minSim = Math.min(minSim, trigramSim(primary.title || '', d.title || ''));

      console.log(`[Consolidate] ${dryRun ? '[DRY] ' : ''}Merging ${dups.length} into ${primary.id} ("${(primary.title || '').slice(0, 60)}") minSim=${minSim.toFixed(2)}`);

      if (!dryRun) {
        for (const dup of dups) {
          // Preserve the duplicate to signal_updates (timeline of the primary) — unchanged.
          const enc = new TextEncoder().encode(`consolidate|${primary.id}|${dup.id}`);
          const hashBuf = await crypto.subtle.digest('SHA-256', enc);
          const updateContentHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          const { data: existingUpdate } = await supabase.from('signal_updates').select('id').eq('content_hash', updateContentHash).maybeSingle();
          if (!existingUpdate) {
            const rj = (dup.raw_json ?? {}) as Record<string, unknown>;
            await supabase.from('signal_updates').insert({
              signal_id: primary.id,
              content: dup.normalized_text || dup.title || 'Related signal merged',
              source_name: (rj.source as string) || (rj.source_name as string) || 'consolidated',
              source_url: (rj.url as string) || (rj.source_url as string) || null,
              content_hash: updateContentHash,
              metadata: {
                original_signal_id: dup.id, original_created_at: dup.created_at,
                original_category: dup.category, original_severity: dup.severity,
                consolidated: true, merge_similarity: trigramSim(primary.title || '', dup.title || ''),
              },
            });
          }
          // Prevent re-ingestion of the same content.
          if (dup.content_hash) {
            await supabase.from('rejected_content_hashes').upsert({
              content_hash: dup.content_hash, client_id: dup.client_id,
              reason: 'consolidated_duplicate', original_signal_title: (dup.title || '').slice(0, 200),
            }, { onConflict: 'content_hash,client_id', ignoreDuplicates: true });
          }
          // SOFT-DELETE the duplicate (operator ruling 1 — tombstone, never hard-delete). Reversible;
          // leaves the analyst/brief surfaces via quality_status + deleted_at.
          await supabase.from('signals').update({
            deleted_at: new Date().toISOString(),
            quality_status: 'quarantined',
            quarantine_reason: 'consolidated_duplicate',
            deletion_reason: `Consolidated into primary signal ${primary.id} (title-similarity ${trigramSim(primary.title || '', dup.title || '').toFixed(2)}). Soft-deleted; content preserved in signal_updates. WO consolidate-signals rewrite 2026-08-21.`,
          }).eq('id', dup.id);
        }
        // Upgrade the primary to the cluster's highest severity.
        let maxRank = SEV_RANK[primary.severity || 'low'] ?? 1;
        for (const d of dups) maxRank = Math.max(maxRank, SEV_RANK[d.severity || 'low'] ?? 1);
        const maxName = Object.entries(SEV_RANK).find(([, v]) => v === maxRank)?.[0];
        if (maxName && maxName !== primary.severity) {
          await supabase.from('signals').update({ severity: maxName }).eq('id', primary.id);
        }
      }

      totalMerged += dups.length;
      mergeDetails.push({
        primary: primary.id, primary_title: (primary.title || '').slice(0, 80),
        merged_count: dups.length, sample: (dups[0]?.title || '').slice(0, 80), min_sim: Number(minSim.toFixed(2)),
      });
    }

    console.log(`[Consolidate] Done. ${dryRun ? 'WOULD merge' : 'Soft-deleted'} ${totalMerged} duplicates into ${mergeDetails.length} primaries.`);
    // Tracked heartbeat under a STABLE name (Registry-is-a-Promise): this job runs via the job-worker, not
    // cron — without a named heartbeat it is invisible, which is how the old deleter stayed unseen. Records
    // per-run outcome so "is dedup running + what did it do" is answerable.
    if (!dryRun) {
      await recordHeartbeat(supabase, 'consolidate-signals', 'completed', {
        signals_scanned: signals.length, duplicates_soft_deleted: totalMerged, clusters: mergeDetails.length,
        method: 'fuzzy_title_same_client_same_day', threshold: SIM_THRESHOLD,
      });
    }
    return successResponse({
      success: true,
      signals_scanned: signals.length,
      duplicates_merged: totalMerged,
      clusters: mergeDetails.length,
      method: 'fuzzy_title_same_client_same_day',
      threshold: SIM_THRESHOLD,
      soft_delete: true,
      dry_run: dryRun,
      details: mergeDetails.slice(0, 100),
    });
  } catch (error) {
    console.error('[Consolidate] Error:', error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
