/**
 * CISA Known Exploited Vulnerabilities (KEV) monitor.
 *
 * Replaces the structurally-broken monitor-pastebin (which never
 * produced a single signal in platform history because its design
 * required the client name to appear in a paste TITLE on
 * pastebin.com/archive — that's just not how leaks land).
 *
 * CISA KEV is the U.S. CISA-curated list of CVEs that are known to
 * be ACTIVELY EXPLOITED in the wild. Federal agencies must remediate
 * KEV entries within a defined window (BOD 22-01). For our clients
 * — Petronas Canada, BCCH — the KEV catalog is the cleanest possible
 * cyber-threat-horizon signal: every entry is pre-vetted by a
 * federal authority as actually-being-used-against-people RIGHT NOW.
 *
 * Cron: every 12h (KEV updates ~daily Mon-Fri; 12h cadence catches
 * each new entry within hours of publication).
 *
 * Signal shape:
 *   - source_key: cisa-kev
 *   - skip_relevance_gate: true (these are inherently relevant)
 *   - category: cybersecurity
 *   - severity: high (KEV entries have known exploitation; per-CVE
 *     CVSS not always present, but presence on KEV alone is the
 *     elevation criterion)
 *   - source_url: linked to NVD CVE detail page
 *
 * Dedup: per-CVE via source_key + raw_json.cve_id (handled by
 * ingest-signal's title/URL prefix match).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const KEV_FEED_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

// How far back we'll consider entries "new enough to surface" on a
// given run. KEV updates Mon-Fri so a 3-day window catches every
// new entry on the cron's 12h cadence with margin. ingest-signal's
// AI classification + dedup costs ~5-8s per call, so we need to
// keep per-run volume below ~15 entries to stay under the 150s
// edge-function timeout. (Initial backfill on the first deploy
// produced 18 KEV entries in 14 days → 150s timeout. 3 days
// produces ≤5 entries per run.)
const DAYS_LOOKBACK = 3;

interface KevVulnerability {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;        // YYYY-MM-DD
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
  cwes?: string[];
}

interface KevFeed {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KevVulnerability[];
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, "monitor-cisa-kev-12h");

  try {
    console.log("[CISA-KEV] Fetching catalog…");
    const tFetchStart = Date.now();
    const resp = await fetch(KEV_FEED_URL, {
      headers: { "User-Agent": "Fortress-Security-Platform/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`CISA KEV HTTP ${resp.status}`);
    const feed = (await resp.json()) as KevFeed;
    console.log(`[CISA-KEV] Catalog v${feed.catalogVersion} — ${feed.count} total vulnerabilities (fetched in ${Date.now() - tFetchStart}ms)`);

    // Filter to vulnerabilities added in the last DAYS_LOOKBACK days.
    // ingest-signal dedups on subsequent runs so re-encountering an
    // already-ingested CVE is a no-op.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - DAYS_LOOKBACK);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const recent = feed.vulnerabilities.filter((v) => v.dateAdded >= cutoffStr);
    console.log(`[CISA-KEV] ${recent.length} entries in the last ${DAYS_LOOKBACK} days`);

    // Pull every client + their tech_stack. KEV entries are NOT
    // client-agnostic — a LiteLLM SQL injection is irrelevant if the
    // client doesn't run LiteLLM. We only attribute a CVE to a client
    // when the KEV vendor/product overlaps with the client's
    // tech_stack[]. Pre-2026-05-08 every CVE was attributed to every
    // client, which polluted dashboards with off-stack noise (LiteLLM,
    // ConnectWise, cPanel, WP2 all surfaced for Petronas/BCCH despite
    // none of them running those products).
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, tech_stack")
      .eq("status", "active");

    if (!clients || clients.length === 0) {
      console.log("[CISA-KEV] No active clients — nothing to ingest against.");
      await completeHeartbeat(supabase, hb, {
        signals_created: 0,
        catalog_version: feed.catalogVersion,
        recent_kev_entries: recent.length,
        note: "no active clients",
      });
      return successResponse({
        success: true,
        signals_created: 0,
        recent_kev_entries: recent.length,
      });
    }

    let signalsCreated = 0;
    // #90 (2026-07-09) — ingest-signal returns HTTP 200 with a body `status`
    // of 'suppressed' | 'filed_as_update' | 'rejected' for dedup/same-story/
    // prior-reject outcomes. functions.invoke() only flags NON-2xx as `error`,
    // so those 200s were previously counted as CREATED — inflating the metric
    // and hiding that a signal never actually landed. Count them separately.
    let signalsSuppressed = 0;
    let signalsFailed = 0;
    // #82 (2026-07-09) — per-client failure detail (bounded) so a real ingest
    // rejection is VISIBLE in the heartbeat with its exact status + body,
    // instead of a generic "non-2xx" that erases which client failed and why.
    const failureDetails: Array<{ cve: string; client: string; http: number | null; retryable: boolean; body: string }> = [];
    const SUPPRESSED_STATUSES = new Set(['suppressed', 'filed_as_update', 'rejected', 'duplicate', 'duplicate_url', 'duplicate_title']);
    let clientsSkippedEmptyTechStack = 0;

    for (const v of recent) {
      const ransomwareNote = v.knownRansomwareCampaignUse === "Known"
        ? " ⚠ KNOWN RANSOMWARE USE."
        : "";

      const text =
        `CISA KEV: ${v.vendorProject} ${v.product} — ${v.vulnerabilityName}\n\n` +
        `CVE: ${v.cveID} | Added to KEV: ${v.dateAdded} | Federal due date: ${v.dueDate}.${ransomwareNote}\n\n` +
        `${v.shortDescription}\n\n` +
        `Required action: ${v.requiredAction}`;

      const cveDetailUrl = `https://nvd.nist.gov/vuln/detail/${v.cveID}`;

      // Severity tier:
      //   - High by default (KEV entry = actively exploited).
      //   - Critical if known ransomware-campaign use.
      const severity = v.knownRansomwareCampaignUse === "Known" ? "critical" : "high";

      // 2026-05-08: per-client tech_stack matching. Build a
      // searchable haystack from KEV vendor + product, then check
      // each client's tech_stack[] for any substring match. Skip
      // clients whose stack doesn't overlap with this CVE.
      const kevHaystack = `${v.vendorProject} ${v.product}`.toLowerCase();

      for (const client of clients) {
        const stack: string[] = Array.isArray((client as any).tech_stack) ? (client as any).tech_stack : [];
        if (stack.length === 0) {
          // #256 Phase 4 (2026-05-23) — empty tech_stack = SKIP, not
          // attribute-to-all. The pre-#256 fallback dispatched every KEV
          // CVE to every client lacking a configured tech_stack, which
          // is the source of the CRT cisa_not_applicable contamination
          // quarantined by Track H1. Per Aaron-approved doctrine:
          // explicit ownership only. Tenants who want broad CVE coverage
          // will later opt in via accepts_global_cve_feed (not in this
          // release — see #256 follow-up backlog).
          clientsSkippedEmptyTechStack++;
          console.log(`[CISA-KEV][#256] skipping ${v.cveID} (${v.vendorProject}/${v.product}) → ${client.name}: empty tech_stack (no opt-in to global CVE feed)`);
          continue;
        }
        const matched = stack.some((entry: string) => {
          const norm = (entry || '').toLowerCase().trim();
          return norm.length >= 3 && kevHaystack.includes(norm);
        });
        if (!matched) {
          console.log(`[CISA-KEV] ${v.cveID} (${v.vendorProject}/${v.product}) — no tech_stack match for ${client.name}, skipping`);
          continue;
        }
        try {
          const { data: ingestData, error: ingestError } = await supabase.functions.invoke("ingest-signal", {
            body: {
              text,
              source_url: cveDetailUrl,
              location: "Global / Internet",
              client_id: client.id,
              source_key: "cisa-kev",
              skip_relevance_gate: true,
              raw_json: {
                cve_id: v.cveID,
                kev_date_added: v.dateAdded,
                kev_due_date: v.dueDate,
                vendor_project: v.vendorProject,
                product: v.product,
                vulnerability_name: v.vulnerabilityName,
                cwes: v.cwes ?? [],
                known_ransomware_use: v.knownRansomwareCampaignUse,
                category_hint: "cybersecurity",
                severity_hint: severity,
                signal_origin: "monitor-cisa-kev",
                source: "CISA KEV",
                cisa_notes: v.notes,
              },
            },
          });
          if (ingestError) {
            // Non-2xx. #82 — pull the actual response body + status out of the
            // FunctionsHttpError context so the failure is diagnosable per client
            // (a 503 client_validation_unavailable is retryable; a 400 is not).
            signalsFailed++;
            let http: number | null = null;
            let body = ingestError.message ?? String(ingestError);
            const ctx = (ingestError as any).context;
            if (ctx && typeof ctx.status === 'number') http = ctx.status;
            try {
              if (ctx && typeof ctx.json === 'function') body = JSON.stringify(await ctx.json());
            } catch (_) { /* keep .message fallback */ }
            const retryable = http === 503 || http === 429 || (http !== null && http >= 500);
            if (failureDetails.length < 50) failureDetails.push({ cve: v.cveID, client: client.name, http, retryable, body: body.slice(0, 500) });
            console.warn(`[CISA-KEV] ingest FAILED ${v.cveID} → ${client.name} (http=${http ?? '?'}, retryable=${retryable}): ${body.slice(0, 300)}`);
          } else {
            // 2xx. Classify created vs suppressed (#90) — a 200 that did NOT
            // land a signal comes in TWO shapes from ingest-signal:
            //   • { status: 'suppressed' | 'rejected' | 'filed_as_update' }  (url/title/prior-reject/same-story)
            //   • { filtered: true, reason: 'duplicate_cve' | ... }          (cve-dedup / relevance filters)
            // Both mean no row for this client — count either as suppressed,
            // never as created.
            const d = ingestData as any;
            const st = (d && typeof d.status === 'string') ? d.status : null;
            const isSuppressed = !!d && (d.filtered === true || (st !== null && SUPPRESSED_STATUSES.has(st)));
            if (isSuppressed) {
              signalsSuppressed++;
              console.log(`[CISA-KEV] ingest SUPPRESSED ${v.cveID} → ${client.name}: ${d.reason ?? st ?? 'unknown'}`);
            } else {
              signalsCreated++;
            }
          }
        } catch (err: any) {
          signalsFailed++;
          if (failureDetails.length < 50) failureDetails.push({ cve: v.cveID, client: client.name, http: null, retryable: true, body: (err?.message || String(err)).slice(0, 500) });
          console.error(`[CISA-KEV] ingest-signal threw for ${v.cveID} → ${client.name}:`, err?.message || err);
        }
      }
    }

    console.log(`[CISA-KEV] Complete. Created ${signalsCreated} / suppressed ${signalsSuppressed} / failed ${signalsFailed} / scanned ${recent.length} recent entries. Skipped (empty tech_stack, #256 Phase 4): ${clientsSkippedEmptyTechStack}`);

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      signals_suppressed: signalsSuppressed,
      signals_failed: signalsFailed,
      clients_skipped_empty_tech_stack: clientsSkippedEmptyTechStack,
      failure_details: failureDetails,
      catalog_version: feed.catalogVersion,
      recent_kev_entries: recent.length,
      lookback_days: DAYS_LOOKBACK,
    });

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      signals_suppressed: signalsSuppressed,
      signals_failed: signalsFailed,
      clients_skipped_empty_tech_stack: clientsSkippedEmptyTechStack,
      failure_details: failureDetails,
      recent_kev_entries: recent.length,
      catalog_version: feed.catalogVersion,
    });
  } catch (error: any) {
    console.error("[CISA-KEV] Fatal error:", error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error.message, 500);
  }
});
