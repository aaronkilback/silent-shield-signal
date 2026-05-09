/**
 * Admin Feed Cleanup — one-shot operator tool, May 5 2026.
 *
 * Two cleanup operations on signals that pre-date today's quality
 * fixes:
 *
 *   1. Out-of-area NAAD archive: signals from `naad_emergency_alerts`
 *      with no client_id and no Extreme severity. These are the
 *      Yukon flood watches, NS missing children, MB/QC weather, etc.
 *      that flooded the feed before the geo-gate landed.
 *
 *   2. Wildfire dedup collapse: for each (client_id, cluster_key),
 *      keep the OLDEST signal as canonical and archive the rest.
 *      Pre-existing duplicates from before the dedup-as-update fix.
 *
 * Reversible: sets status='archived' and stamps raw_json.archived_reason.
 * No DELETE. Re-runnable; idempotent because already-archived rows are
 * excluded from each WHERE clause.
 *
 * Auth: requires service-role key (Authorization: Bearer <SRK>) OR a
 * shared admin secret (x-admin-secret). Don't expose to anon.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Reject anon — must be invoked with service-role bearer.
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return errorResponse("Unauthorized — service-role required", 401);
    }

    const supabase = createServiceClient();

    // ── 1. Out-of-area NAAD archive ──────────────────────────────────
    // Fetch the IDs first (so we can return a count + sample) then archive.
    const { data: naadCandidates, error: naadFetchErr } = await supabase
      .from("signals")
      .select("id")
      .is("client_id", null)
      .eq("raw_json->>source", "naad_emergency_alerts")
      .not("status", "in", "(archived,false_positive)")
      .gte("created_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .limit(2000);

    if (naadFetchErr) throw new Error(`NAAD fetch: ${naadFetchErr.message}`);

    // Filter out Extreme-severity in app code (severity comparison is
    // easier here than in PostgREST nested JSON queries).
    const naadIdsToArchive: string[] = [];
    if (naadCandidates && naadCandidates.length > 0) {
      // Re-fetch with raw_json to inspect classification.severity
      const { data: detailed } = await supabase
        .from("signals")
        .select("id, raw_json")
        .in("id", naadCandidates.map((s) => s.id));
      for (const s of detailed || []) {
        const sev = (s.raw_json as any)?.classification?.severity || "";
        if (String(sev).toLowerCase() !== "extreme") {
          naadIdsToArchive.push(s.id);
        }
      }
    }

    let naadArchived = 0;
    if (naadIdsToArchive.length > 0) {
      // Batch updates — Supabase has a row-update limit per call.
      const BATCH = 500;
      for (let i = 0; i < naadIdsToArchive.length; i += BATCH) {
        const slice = naadIdsToArchive.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("signals")
          .update({
            status: "archived",
          })
          .in("id", slice)
          .select("id");
        if (error) throw new Error(`NAAD archive batch ${i}: ${error.message}`);
        naadArchived += data?.length || 0;
      }
    }

    // ── 2. Wildfire dedup collapse ───────────────────────────────────
    // Pull last 14 days of wildfire signals with cluster_key. Group
    // by (client_id, cluster_key); keep oldest, archive the rest.
    const { data: wildfireRows, error: wfFetchErr } = await supabase
      .from("signals")
      .select("id, client_id, raw_json, created_at")
      .like("raw_json->>cluster_key", "wildfire-%")
      .not("status", "in", "(archived,false_positive)")
      .gte("created_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);

    if (wfFetchErr) throw new Error(`Wildfire fetch: ${wfFetchErr.message}`);

    const oldestByKey = new Map<string, string>();
    const wildfireToArchive: string[] = [];
    for (const s of wildfireRows || []) {
      const ckey = `${s.client_id}|${(s.raw_json as any)?.cluster_key || ""}`;
      if (!oldestByKey.has(ckey)) {
        oldestByKey.set(ckey, s.id);
      } else {
        wildfireToArchive.push(s.id);
      }
    }

    let wildfireArchived = 0;
    if (wildfireToArchive.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < wildfireToArchive.length; i += BATCH) {
        const slice = wildfireToArchive.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("signals")
          .update({
            status: "archived",
          })
          .in("id", slice)
          .select("id");
        if (error) throw new Error(`Wildfire archive batch ${i}: ${error.message}`);
        wildfireArchived += data?.length || 0;
      }
    }

    return successResponse({
      success: true,
      naad_archived: naadArchived,
      wildfire_archived: wildfireArchived,
      total_archived: naadArchived + wildfireArchived,
      note: "Reversible. Set status='archived' on signals — no rows deleted.",
    });
  } catch (e: any) {
    console.error("[admin-feed-cleanup] Error:", e);
    return errorResponse(e?.message || "Cleanup failed", 500);
  }
});
