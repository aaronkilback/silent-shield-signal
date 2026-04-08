/**
 * WRAITH Codebase Snapshot
 *
 * Reads edge function source files from the `codebase-source` Supabase Storage
 * bucket (populated by scripts/upload-codebase-snapshot.py after each deploy)
 * and upserts them into codebase_snapshots so the vulnerability scanner has
 * fresh source to analyze.
 *
 * Runs at 05:45 UTC daily — 15 minutes before wraith-vuln-scan-nightly (06:00 UTC).
 */

import { createServiceClient, corsHeaders, handleCors, successResponse } from "../_shared/supabase-client.ts";

const BUCKET = "codebase-source";

const SCAN_TARGETS = [
  "supabase/functions/ingest-signal/index.ts",
  "supabase/functions/ai-decision-engine/index.ts",
  "supabase/functions/correlate-entities/index.ts",
  "supabase/functions/incident-action/index.ts",
  "supabase/functions/_shared/handlers-signals-incidents.ts",
];

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const results: { file_path: string; status: string; size?: number }[] = [];
  let snapshotted = 0;
  let failed = 0;

  for (const filePath of SCAN_TARGETS) {
    try {
      // Download from codebase-source storage bucket
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(filePath);

      if (error || !data) {
        console.warn(`[Snapshot] Storage download failed for ${filePath}:`, error?.message);
        results.push({ file_path: filePath, status: "not_in_storage" });
        failed++;
        continue;
      }

      const source = await data.text();
      const hash = await sha256hex(source);

      const { error: upsertError } = await supabase
        .from("codebase_snapshots")
        .upsert({
          file_path: filePath,
          source_code: source,
          file_size: source.length,
          sha256: hash,
          snapshotted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "file_path" });

      if (upsertError) {
        console.error(`[Snapshot] DB upsert failed for ${filePath}:`, upsertError);
        results.push({ file_path: filePath, status: "db_error" });
        failed++;
      } else {
        results.push({ file_path: filePath, status: "ok", size: source.length });
        snapshotted++;
        console.log(`[Snapshot] ✓ ${filePath} (${source.length} chars, sha256: ${hash.slice(0, 12)}...)`);
      }
    } catch (err) {
      console.error(`[Snapshot] Unexpected error for ${filePath}:`, err);
      results.push({ file_path: filePath, status: "error" });
      failed++;
    }
  }

  console.log(`[Snapshot] Complete: ${snapshotted} snapshotted, ${failed} failed`);

  return successResponse({
    success: snapshotted > 0,
    snapshotted,
    failed,
    total: SCAN_TARGETS.length,
    results,
    message: snapshotted === 0
      ? `No files found in storage bucket '${BUCKET}'. Run scripts/upload-codebase-snapshot.py after deploying functions.`
      : `${snapshotted}/${SCAN_TARGETS.length} files snapshotted. Vulnerability scan ready.`,
  });
});
