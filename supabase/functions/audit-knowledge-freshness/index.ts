/**
 * Knowledge Freshness Auditor (CRUCIBLE subsystem)
 * 
 * Audits expert_knowledge entries for staleness using confidence decay.
 * Deactivates entries that have decayed below usability threshold.
 * Logs audit results for trend tracking.
 * 
 * Called by: system-watchdog (remediation), scheduled cron, manual trigger
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const HALF_LIFE_DAYS = 180; // 6-month half-life
const DEACTIVATION_THRESHOLD = 0.3; // Below this = deactivate
const STALE_THRESHOLD = 0.5; // Below this = flagged as stale
const REVALIDATION_ALERT_DAYS = 365; // 1 year without validation = alert

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run || false;

    console.log(`[KnowledgeFreshness] Starting audit (dry_run=${dryRun})...`);

    // Fetch all active knowledge entries
    const { data: entries, error } = await supabase
      .from('expert_knowledge')
      .select('id, title, domain, subdomain, confidence_score, last_validated_at, created_at, updated_at')
      .eq('is_active', true);

    if (error) throw error;
    if (!entries || entries.length === 0) {
      return successResponse({ success: true, message: 'No active knowledge entries' });
    }

    const now = Date.now();
    const staleEntries: Array<{ id: string; title: string; domain: string; decayedConfidence: number; daysSinceValidation: number }> = [];
    const decayedEntries: Array<{ id: string; title: string; domain: string; decayedConfidence: number }> = [];
    const deactivationCandidates: string[] = [];
    const domainStats = new Map<string, { total: number; stale: number; avgDecayed: number; scores: number[] }>();

    let totalDecayedConfidence = 0;
    let totalOriginalConfidence = 0;

    for (const entry of entries) {
      const refDate = new Date(entry.last_validated_at || entry.created_at).getTime();
      const daysSince = (now - refDate) / 86400000;
      const decayFactor = Math.pow(2, -(daysSince / HALF_LIFE_DAYS));
      const originalConfidence = entry.confidence_score || 0.5;
      const decayedConfidence = Math.max(0.1, originalConfidence * decayFactor);

      totalDecayedConfidence += decayedConfidence;
      totalOriginalConfidence += originalConfidence;

      // Track domain stats
      const domain = entry.domain || 'unknown';
      if (!domainStats.has(domain)) {
        domainStats.set(domain, { total: 0, stale: 0, avgDecayed: 0, scores: [] });
      }
      const ds = domainStats.get(domain)!;
      ds.total++;
      ds.scores.push(decayedConfidence);

      // Flag stale
      if (decayedConfidence < STALE_THRESHOLD) {
        ds.stale++;
        staleEntries.push({
          id: entry.id,
          title: entry.title,
          domain,
          decayedConfidence,
          daysSinceValidation: Math.round(daysSince),
        });
      }

      // Flag for deactivation
      if (decayedConfidence < DEACTIVATION_THRESHOLD) {
        decayedEntries.push({
          id: entry.id,
          title: entry.title,
          domain,
          decayedConfidence,
        });
        deactivationCandidates.push(entry.id);
      }
    }

    // Calculate domain averages
    const staleDomains: Array<{ domain: string; total: number; stale: number; avgDecayed: number }> = [];
    for (const [domain, stats] of domainStats) {
      stats.avgDecayed = stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length;
      if (stats.stale > 0) {
        staleDomains.push({
          domain,
          total: stats.total,
          stale: stats.stale,
          avgDecayed: Math.round(stats.avgDecayed * 100) / 100,
        });
      }
    }
    staleDomains.sort((a, b) => b.stale - a.stale);

    const actionsTaken: string[] = [];

    // Deactivate entries below threshold (unless dry run)
    if (!dryRun && deactivationCandidates.length > 0) {
      const { error: deactivateErr } = await supabase
        .from('expert_knowledge')
        .update({ is_active: false })
        .in('id', deactivationCandidates);

      if (deactivateErr) {
        console.error('[KnowledgeFreshness] Deactivation failed:', deactivateErr);
        actionsTaken.push(`FAILED: Deactivate ${deactivationCandidates.length} entries`);
      } else {
        actionsTaken.push(`Deactivated ${deactivationCandidates.length} entries below ${DEACTIVATION_THRESHOLD} decayed confidence`);
        console.log(`[KnowledgeFreshness] Deactivated ${deactivationCandidates.length} stale entries`);
      }
    }

    // Log audit results
    const { error: auditErr } = await supabase.from('knowledge_freshness_audits').insert({
      total_entries: entries.length,
      stale_entries: staleEntries.length,
      decayed_entries: decayedEntries.length,
      avg_confidence: totalOriginalConfidence / entries.length,
      avg_decayed_confidence: totalDecayedConfidence / entries.length,
      stale_domains: staleDomains,
      actions_taken: actionsTaken,
    });

    if (auditErr) console.error('[KnowledgeFreshness] Failed to log audit:', auditErr);

    const result = {
      success: true,
      dry_run: dryRun,
      total_entries: entries.length,
      stale_entries: staleEntries.length,
      decayed_below_threshold: decayedEntries.length,
      deactivated: dryRun ? 0 : deactivationCandidates.length,
      avg_original_confidence: Math.round((totalOriginalConfidence / entries.length) * 100) / 100,
      avg_decayed_confidence: Math.round((totalDecayedConfidence / entries.length) * 100) / 100,
      stale_domains: staleDomains.slice(0, 10),
      actions_taken: actionsTaken,
      top_stale: staleEntries.slice(0, 10).map(e => ({
        title: e.title,
        domain: e.domain,
        decayed: Math.round(e.decayedConfidence * 100) / 100,
        days_since_validation: e.daysSinceValidation,
      })),
    };

    console.log(`[KnowledgeFreshness] Audit complete: ${staleEntries.length}/${entries.length} stale, ${decayedEntries.length} below threshold`);

    return successResponse(result);

  } catch (error) {
    console.error('[KnowledgeFreshness] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
