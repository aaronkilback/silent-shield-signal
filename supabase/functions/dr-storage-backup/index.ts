// dr-storage-backup — REBUILT 2026-09-14 (WO-DR-CADENCE-REBUILD / supersedes the
// INC-AITOOLS-XTENANT-2026-07-30 containment stub).
//
// Backs up the IRREPLACEABLE Supabase Storage buckets (user-uploaded originals + delivered
// deliverables — NOT derivable from DB rows, and NOT covered by Supabase's database backups) to
// Cloudflare R2, additively and verifiably.
//
// Hard requirements this rebuild satisfies (design approved 2026-09-14):
//   1. REAL AUTH, no static secret. verify_jwt=true at the gateway + service-role-only server-side
//      (getCallerIdentity). The prior orphan was gated only by a leaked hardcoded x-smoke-key.
//   2. NO DELETE CAPABILITY. This function only LISTs source objects and PUTs to R2. It never issues
//      an R2 DELETE and has no cleanup path. Additive-only.
//   3. VERIFIED READ-BACK. After each PUT we issue an INDEPENDENT HEAD on the R2 object and require
//      status 200 + Content-Length === source bytes + ETag === the PUT's ETag. An object counts as
//      backed up ONLY if the read-back matches. (Absence of a positive read-back is not success.)
//   4. HEARTBEAT. startHeartbeat/completeHeartbeat('dr-storage-backup-daily') with real counts, so
//      the registry promise is measurable. Acceptance = two consecutive scheduled non-failed runs.
//   5. SCOPED + INCREMENTAL + RESUMABLE. Only the protected buckets. Self-healing HEAD-compare
//      (upload iff missing/size-mismatch in R2) makes it inherently incremental. A per-run time+byte
//      budget with a {bucket, after} cursor seeds the full ~1.9 GB across cron runs; the cursor is
//      carried in the previous run's heartbeat result_summary (no new table).

import { AwsClient } from "npm:aws4fetch@1.0.17";
import { getCallerIdentity, createServiceClient, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The irreplaceable set (per 2026-09-14 storage triage). Derived/re-sourceable buckets
// (site-audit-media, entity-photos, osint-media, episode-audio, bug-screenshots, codebase-source)
// are intentionally EXCLUDED — losing them is recoverable, and copying them wastes budget.
const PROTECTED_BUCKETS = [
  "archival-documents",
  "tenant-files",
  "ai-chat-attachments",
  "investigation-files",
  "generated-reports",
  "travel-documents",
];

const JOB = "dr-storage-backup-daily";
const BUDGET_MS = 120_000;              // exit cleanly under the 150s platform SIGKILL ceiling
const BYTE_BUDGET = 600 * 1024 * 1024;  // cap upload volume per run; cursor resumes next run
const LIST_PAGE = 100;
const MAX_FAILURES_RECORDED = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Encode an object key into a path-safe URL suffix (preserve '/', encode each segment).
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ObjRec { name: string; size: number }

// Recursively enumerate every object in a bucket via the Storage API (folders have id===null).
// Returns full paths sorted ascending so the {after} cursor is stable across runs.
async function listBucket(supabase: ReturnType<typeof createServiceClient>, bucket: string, prefix = ""): Promise<ObjRec[]> {
  const out: ObjRec[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null || item.metadata == null) {
        out.push(...await listBucket(supabase, bucket, full)); // folder → recurse
      } else {
        out.push({ name: full, size: Number(item.metadata?.size ?? 0) });
      }
    }
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // 1. Real auth — service-role only. verify_jwt=true means the gateway already required a valid JWT;
  //    this refuses anything that is not the trusted internal service-role caller (the cron).
  const caller = await getCallerIdentity(req);
  if (caller.kind !== "service_role") {
    return errorResponse("Forbidden: dr-storage-backup is service-role only", caller.kind === "unauthorized" ? caller.status : 403);
  }

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB);

  try {
    // R2 credentials (operator-provisioned; never hardcoded).
    const accountId = Deno.env.get("R2_ACCOUNT_ID");
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const r2Bucket = Deno.env.get("R2_BUCKET");
    if (!accountId || !accessKeyId || !secretAccessKey || !r2Bucket) {
      const msg = "R2 not configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)";
      await failHeartbeat(supabase, hb, new Error(msg));
      return json({ error: msg }, 500);
    }

    // Resume cursor: explicit body override, else the previous run's heartbeat next_cursor if it was partial.
    let body: { cursor?: { bucket: string; after: string }; full?: boolean } = {};
    try { body = await req.json(); } catch { /* cron posts empty body */ }
    let cursor = body.cursor ?? null;
    if (!cursor) {
      const { data: last } = await supabase
        .from("cron_heartbeat")
        .select("result_summary")
        .eq("job_name", JOB)
        .in("status", ["succeeded"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const rs = last?.result_summary as { partial?: boolean; next_cursor?: { bucket: string; after: string } } | null;
      if (rs?.partial && rs.next_cursor) cursor = rs.next_cursor;
    }

    const aws = new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3" });
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const r2Url = (key: string) => `${endpoint}/${encodeKey(`${r2Bucket}/${key}`)}`;

    const t0 = Date.now();
    let scanned = 0, uploaded = 0, verified = 0, skipped = 0, failed = 0, bytesUploaded = 0;
    const failures: Array<{ bucket: string; name: string; reason: string }> = [];
    let partial = false;
    let nextCursor: { bucket: string; after: string } | null = null;

    const startIdx = cursor ? Math.max(0, PROTECTED_BUCKETS.indexOf(cursor.bucket)) : 0;

    outer:
    for (let bi = startIdx; bi < PROTECTED_BUCKETS.length; bi++) {
      const bucket = PROTECTED_BUCKETS[bi];
      const after = (cursor && bi === startIdx) ? cursor.after : "";
      const objects = (await listBucket(supabase, bucket)).filter((o) => o.name > after);
      // Last object fully handled in THIS bucket this run; the resume point if the budget trips.
      // Seeded with `after` so an immediate break re-resumes at the same spot rather than skipping.
      let prevName = after;

      for (const obj of objects) {
        // Budget check is BEFORE processing this object, so prevName (last completed) is the correct
        // resume cursor — the next run picks up with name > prevName, retrying this same object.
        if (Date.now() - t0 > BUDGET_MS || bytesUploaded > BYTE_BUDGET) {
          partial = true;
          nextCursor = { bucket, after: prevName };
          break outer;
        }
        scanned++;
        const key = `${bucket}/${obj.name}`;
        try {
          // Self-healing incremental: skip iff R2 already holds a same-size object.
          const head = await aws.fetch(r2Url(key), { method: "HEAD" });
          if (head.status === 200 && obj.size > 0 && Number(head.headers.get("content-length")) === obj.size) {
            skipped++;
            prevName = obj.name;
            continue;
          }

          const dl = await supabase.storage.from(bucket).download(obj.name);
          if (dl.error || !dl.data) throw new Error(`download: ${dl.error?.message ?? "no data"}`);
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          const sha = await sha256Hex(bytes);

          const put = await aws.fetch(r2Url(key), {
            method: "PUT",
            body: bytes,
            headers: { "content-type": dl.data.type || "application/octet-stream", "x-amz-meta-sha256": sha },
          });
          if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
          uploaded++;
          bytesUploaded += bytes.length;

          // 3. Verified read-back — an INDEPENDENT HEAD, not the PUT response.
          const verify = await aws.fetch(r2Url(key), { method: "HEAD" });
          const okSize = Number(verify.headers.get("content-length")) === bytes.length;
          const okEtag = !!put.headers.get("etag") && verify.headers.get("etag") === put.headers.get("etag");
          if (verify.status === 200 && okSize && okEtag) {
            verified++;
          } else {
            failed++;
            if (failures.length < MAX_FAILURES_RECORDED) {
              failures.push({ bucket, name: obj.name, reason: `read-back mismatch status=${verify.status} size=${okSize} etag=${okEtag}` });
            }
          }
          prevName = obj.name;
        } catch (e) {
          failed++;
          if (failures.length < MAX_FAILURES_RECORDED) {
            failures.push({ bucket, name: obj.name, reason: e instanceof Error ? e.message : String(e) });
          }
          prevName = obj.name;
        }
      }
    }

    const summary = {
      buckets: PROTECTED_BUCKETS,
      scanned, uploaded, verified, skipped, failed,
      bytes_uploaded: bytesUploaded,
      partial,
      next_cursor: nextCursor,
      elapsed_ms: Date.now() - t0,
      failures,
    };
    await completeHeartbeat(supabase, hb, summary);
    return json({ success: true, ...summary });
  } catch (e) {
    await failHeartbeat(supabase, hb, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
