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
    let signalsFailed = 0;

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
          // Client without tech_stack configured — preserve the old
          // attribute-to-all behavior so we don't silently drop
          // signals for newly onboarded clients.
        } else {
          const matched = stack.some((entry: string) => {
            const norm = (entry || '').toLowerCase().trim();
            return norm.length >= 3 && kevHaystack.includes(norm);
          });
          if (!matched) {
            console.log(`[CISA-KEV] ${v.cveID} (${v.vendorProject}/${v.product}) — no tech_stack match for ${client.name}, skipping`);
            continue;
          }
        }
        try {
          const { error: ingestError } = await supabase.functions.invoke("ingest-signal", {
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
          if (!ingestError) {
            signalsCreated++;
          } else {
            signalsFailed++;
            console.warn(`[CISA-KEV] ingest-signal error for ${v.cveID} → ${client.name}:`, ingestError.message);
          }
        } catch (err: any) {
          signalsFailed++;
          console.error(`[CISA-KEV] ingest-signal threw for ${v.cveID} → ${client.name}:`, err?.message || err);
        }
      }
    }

    console.log(`[CISA-KEV] Complete. Created ${signalsCreated} / failed ${signalsFailed} / scanned ${recent.length} recent entries.`);

    await completeHeartbeat(supabase, hb, {
      signals_created: signalsCreated,
      signals_failed: signalsFailed,
      catalog_version: feed.catalogVersion,
      recent_kev_entries: recent.length,
      lookback_days: DAYS_LOOKBACK,
    });

    return successResponse({
      success: true,
      signals_created: signalsCreated,
      signals_failed: signalsFailed,
      recent_kev_entries: recent.length,
      catalog_version: feed.catalogVersion,
    });
  } catch (error: any) {
    console.error("[CISA-KEV] Fatal error:", error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error.message, 500);
  }
});
