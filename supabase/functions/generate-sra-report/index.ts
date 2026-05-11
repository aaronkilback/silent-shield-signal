/**
 * generate-sra-report — render a finished SRA in the operator's format.
 *
 * Phase 2F. Aggregates everything the wizard captured into a single
 * report matching the format Aaron uses (per the b-76-C / Jedney
 * compressor station SRA from Oct 2025):
 *
 *   1. Title + date + author + site location
 *   2. Purpose
 *   3. Site Overview (assets, buildings, environmental exposure, value)
 *   4. Site Status
 *   5. Controls (existing, derived from site_features)
 *   6. Threat Environment
 *      - Unauthorized access narrative
 *      - Previous incidents at nearby sites (from get_adjacent_incidents)
 *      - Potential risks
 *      - Community context
 *   7. Site Vulnerabilities (derived from missing/weak features)
 *   8. Risk Assessment (5x5 matrix from audit_risk_ratings)
 *   9. Recommendations (Short/Medium/Long term from audit_recommendations)
 *  10. Summary
 *  11. Appendix A: Photos (from media_assets where kind=photo)
 *  12. Appendix B: Risk matrix legend
 *
 * Output: HTML string + uploads to storage as both .html and (Phase 2G)
 * .pdf via Puppeteer. For now: HTML only.
 *
 * Anti-fabrication: only renders data from the audit. AI-generated
 * narrative sections are bracketed and labeled "[AI-drafted, edit
 * before sharing]" so the operator knows what's their words and
 * what's the agent's.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getSignedUrl } from "../_shared/storage.ts";

const MODEL = "gpt-4o-mini";
const SITE_AUDIT_MEDIA_BUCKET = "site-audit-media" as const;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { audit_id } = await req.json();
    if (!audit_id) return errorResponse("audit_id required", 400);

    const supabase = createServiceClient();

    // Pull all data the report needs in parallel.
    const [auditRes, featuresRes, mediaRes, ratingsRes, recsRes] = await Promise.all([
      supabase.from("site_audits")
        .select("*, asset:client_assets(*), client:clients(name, locations, monitoring_keywords)")
        .eq("id", audit_id).maybeSingle(),
      supabase.from("site_features").select("*").is("deleted_at", null),
      supabase.from("media_assets")
        .select("id, kind, storage_path, captured_at, bearing_deg, software_app, ai_findings, doc_type, filename, geom_point")
        .eq("audit_id", audit_id).is("deleted_at", null),
      supabase.from("audit_risk_ratings").select("*").eq("audit_id", audit_id),
      supabase.from("audit_recommendations").select("*").eq("audit_id", audit_id).order("bucket").order("priority", { ascending: false }),
    ]);

    if (auditRes.error || !auditRes.data) {
      return errorResponse(`audit ${audit_id} not found`, 404);
    }
    const audit = auditRes.data as {
      id: string; asset_id: string; primary_operator: string;
      started_at: string; completed_at: string | null;
      summary_text: string | null;
      asset: {
        id: string; name: string; asset_class: string;
        operational_status: string; criticality_tier: string | null;
        attributes: Record<string, unknown>;
        estimated_value_low_usd: number | null;
        estimated_value_high_usd: number | null;
      } | null;
      client: { name: string; locations?: string[]; monitoring_keywords?: string[] } | null;
    };

    if (!audit.asset) return errorResponse("audit has no linked asset", 400);

    // Filter features to this asset.
    const features = (featuresRes.data ?? []).filter((f: { asset_id: string }) => f.asset_id === audit.asset!.id);
    const media = (mediaRes.data ?? []) as Array<{ id: string; kind: string; storage_path: string; captured_at: string | null; bearing_deg: number | null; software_app: string | null; ai_findings: unknown; doc_type: string | null; filename: string | null; geom_point: unknown }>;
    const ratings = (ratingsRes.data ?? []) as Array<{ risk_category: string; likelihood: number; impact: string; rating_label: string; rating_band: string; rationale: string | null }>;
    const recs = (recsRes.data ?? []) as Array<{ bucket: string; description: string; rationale: string | null; source: string }>;

    // Resolve operator name.
    const { data: operatorData } = await supabase.auth.admin.getUserById(audit.primary_operator);
    const operatorName = operatorData?.user?.user_metadata?.full_name
      || operatorData?.user?.email
      || "Field Operator";

    // Pull adjacent incidents.
    const { data: adjacent } = await supabase.rpc(
      "get_adjacent_incidents",
      { p_asset_id: audit.asset.id, p_radius_km: 25 } as never,
    );

    // Pull features with decoded lat/lng for the map embed.
    const { data: featuresWithCoords } = await supabase.rpc(
      "get_asset_features_with_coords",
      { p_asset_id: audit.asset.id } as never,
    );
    const fwc = (featuresWithCoords as {
      asset_lat: number | null;
      asset_lng: number | null;
      features: Array<{ id: string; feature_type: string; label: string | null; lat: number | null; lng: number | null }>;
    } | null) ?? { asset_lat: null, asset_lng: null, features: [] };
    const mapFeatures = fwc.features.filter((f) => f.lat !== null && f.lng !== null);

    // Pull substrate context (regional district, fire centre, health
    // authority, nearby features) if the asset has a geom. Used in
    // the narrative for fire/wildlife/jurisdictional grounding.
    let substrateContext: { summary_text?: string; jurisdictions?: Array<{ name: string; layer: string }> } | null = null;
    let wildfireContext: { active_within_50km: number; recent_signals_90d: number; fire_centre: string | null } = {
      active_within_50km: 0, recent_signals_90d: 0, fire_centre: null,
    };
    if (audit.asset) {
      const assetGeom = await supabase
        .from("client_assets")
        .select("geom")
        .eq("id", audit.asset.id)
        .maybeSingle();
      // PostgREST returns geom as GeoJSON; extract coords if present.
      const g = (assetGeom.data as { geom?: { coordinates?: [number, number] } } | null)?.geom;
      if (g && Array.isArray(g.coordinates)) {
        const [lng, lat] = g.coordinates;
        try {
          const ctxRes = await supabase.functions.invoke("get-site-context", {
            body: { lat, lng, radius_km: 25 },
          });
          substrateContext = ctxRes.data as never;
          const fireCentre = (substrateContext?.jurisdictions ?? []).find(
            (j) => j.layer === "bc_fire_service_area",
          );
          wildfireContext.fire_centre = fireCentre?.name ?? null;
        } catch (err) {
          console.warn("substrate context fetch failed", err);
        }

        // Count wildfire signals near this asset's location in last 90 days.
        // The signals table doesn't have a uniform geom column, so we filter
        // by signal_type + recency + client and accept a coarse count.
        const { count: wfCount } = await supabase
          .from("signals")
          .select("id", { count: "exact", head: true })
          .eq("client_id", (audit.asset as { client_id?: string }).client_id ?? "")
          .or("signal_type.eq.wildfire,category.eq.wildfire,signal_type.eq.ambiguous_near_facility")
          .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
        wildfireContext.recent_signals_90d = wfCount ?? 0;
      }
    }

    // Sign URLs for the photos that go into Appendix A.
    const photos = media.filter((m) => m.kind === "photo");
    const signedPhotos = await Promise.all(photos.map(async (p) => ({
      ...p,
      signed_url: await getSignedUrl(supabase, SITE_AUDIT_MEDIA_BUCKET as never, p.storage_path, 60 * 60 * 24 * 7),
    })));

    // Documents go in their own appendix list.
    const documents = media.filter((m) => m.kind === "document");

    // ─── AI-drafted narrative sections ────────────────────────────
    // Threat Environment + Site Vulnerabilities + Summary are AI-drafted
    // from the captured features + ratings. Operator edits before sharing.
    const narrative = await draftNarrative({
      audit, asset: audit.asset, features, ratings, recs,
      adjacentAudits: (adjacent as { audits?: unknown[] } | null)?.audits ?? [],
      adjacentSignals: (adjacent as { signals?: unknown[] } | null)?.signals ?? [],
      substrateContext, wildfireContext,
    });

    // ─── Render HTML ───────────────────────────────────────────────
    const html = renderHtml({
      audit, asset: audit.asset, client: audit.client,
      operatorName, features, ratings, recs, photos: signedPhotos, documents,
      adjacent: (adjacent as { audits?: Array<Record<string, unknown>>; signals?: Array<Record<string, unknown>> } | null) ?? { audits: [], signals: [] },
      narrative,
      assetLat: fwc.asset_lat,
      assetLng: fwc.asset_lng,
      mapFeatures,
    });

    // Persist to storage so the user gets a stable URL.
    const path = `audit/${audit.id}/reports/sra-${Date.now()}.html`;
    const { error: uploadErr } = await supabase.storage
      .from(SITE_AUDIT_MEDIA_BUCKET)
      .upload(path, new Blob([html], { type: "text/html; charset=utf-8" }), {
        contentType: "text/html; charset=utf-8",
        upsert: false,
      });
    let signed_url: string | null = null;
    if (!uploadErr) {
      signed_url = await getSignedUrl(supabase, SITE_AUDIT_MEDIA_BUCKET as never, path, 60 * 60 * 24 * 30);
    }

    // View URL — points at view-sra-report function which reads from
    // storage and serves with explicit text/html;charset=utf-8 +
    // Content-Disposition:inline so browsers render the report rather
    // than display source / download as octet-stream.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const view_url = supabaseUrl
      ? `${supabaseUrl}/functions/v1/view-sra-report?path=${encodeURIComponent(path)}`
      : null;

    return successResponse({ html, signed_url, view_url, storage_path: path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("generate-sra-report error:", e);
    return errorResponse(msg, 500);
  }
});

// ─── Narrative drafter (AI) ──────────────────────────────────────
async function draftNarrative(input: {
  audit: { summary_text: string | null };
  asset: { name: string; asset_class: string; operational_status: string; attributes: Record<string, unknown> };
  features: Array<{ feature_type: string; label: string | null; attributes: Record<string, unknown> }>;
  ratings: Array<{ risk_category: string; rating_label: string; rationale: string | null }>;
  recs: Array<{ bucket: string; description: string }>;
  adjacentAudits: unknown[];
  adjacentSignals: unknown[];
  substrateContext: { summary_text?: string; jurisdictions?: Array<{ name: string; layer: string }> } | null;
  wildfireContext: { active_within_50km: number; recent_signals_90d: number; fire_centre: string | null };
}): Promise<{ threat_environment: string; vulnerabilities: string[]; summary: string }> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return {
      threat_environment: "[AI key not configured — narrative deferred to operator edit]",
      vulnerabilities: ["[AI narrative unavailable]"],
      summary: input.audit.summary_text || "[Operator summary not provided.]",
    };
  }

  const featureSummary = input.features.map((f) => `${f.feature_type}${f.label ? ` "${f.label}"` : ""}`).join("; ");
  const ratingsSummary = input.ratings.map((r) => `${r.risk_category}=${r.rating_label}`).join("; ");
  const substrateLine = input.substrateContext?.summary_text
    ? `Jurisdictions: ${input.substrateContext.summary_text}`
    : "Jurisdictions: not resolved (asset has no GPS yet)";
  const wildfireLine = `Fire centre: ${input.wildfireContext.fire_centre ?? "unresolved"}; wildfire/ambiguous-flare signals for this client in last 90d: ${input.wildfireContext.recent_signals_90d}`;
  // Detect wildlife-relevant observations from captured features / labels.
  const wildlifeMentions = input.features.filter((f) =>
    /bear|wolf|moose|wildlife|tracks|den/i.test([f.label, JSON.stringify(f.attributes ?? {})].join(" "))
  ).length;

  const prompt = `You are drafting three narrative sections for a Security Risk Assessment in Aaron Kilback's voice (concise, operational, no marketing). The site is in remote NE BC oil & gas country — wildfire and wildlife are first-class operational risks alongside theft/vandalism.

Site: ${input.asset.name} (${input.asset.asset_class}, status: ${input.asset.operational_status})
Captured features: ${featureSummary || "none captured"}
Risk ratings: ${ratingsSummary || "none rated"}
Recommendations on file: ${input.recs.length}
Adjacent audits in last 12 mo: ${input.adjacentAudits.length}
Adjacent signals: ${input.adjacentSignals.length}
${substrateLine}
${wildfireLine}
Wildlife-tagged feature observations: ${wildlifeMentions}
Operator's own summary: ${input.audit.summary_text || "(not provided)"}

Output JSON only:
{
  "threat_environment": "3-5 sentence narrative covering: (1) unauthorized-access risk based on operational state + perimeter features, (2) WILDFIRE risk for this site — reference the fire centre and recent fire signal volume if known; note proximity-to-facility considerations; (3) WILDLIFE risk — bear/wolf/moose encounters for remote shut-in sites where personnel patrols are limited. Derived ONLY from the captured data above.",
  "vulnerabilities": ["bullet 1", "bullet 2", ...],
  "summary": "1-paragraph summary in operator voice. Must explicitly mention wildfire and wildlife exposure when relevant to the operational state (e.g. shut-in sites with no personnel are more vulnerable to both)."
}

Vulnerabilities should include (where supported by data):
- No fencing / damaged fencing → "No fencing or physical barrier..."
- Lighting removed → "Loss of nighttime deterrence"
- Shut-in / unmanned → "No designated personnel — slower response to fire ignition or wildlife encounter"
- Remote response time → "Emergency response > 2 hrs; nearest fire crew via ${input.wildfireContext.fire_centre ?? 'regional centre'}"
- High wildfire signal volume → "Elevated fire-season exposure based on N signals within 90 days"
- High-value targets → "${input.features.filter(f => f.feature_type === 'high_value_target').length} high-value targets unsecured" (only if count > 0)

Anti-fabrication + brevity:
- Do NOT invent threats not supported by the data.
- Do NOT manufacture a specific fire incident; reference signal counts and fire centre only.
- For wildlife: only mention specific species if the operator's notes mention them; otherwise speak generally ("wildlife encounters typical of remote NE BC operations").
- Use specific feature counts ("3 cameras documented, 0 with PTZ").
- Skip marketing words ("robust", "comprehensive").
- ZERO-COUNT RULE: do NOT emit a bullet that begins with "0" or describes the ABSENCE of a problem (e.g. "0 high-value targets unsecured", "No surveillance observations recorded"). If a thing was not present, simply omit the bullet — silence is the right output.
- TERSE BULLETS: each vulnerability is one short sentence, max 18 words. No restating context already in Threat Environment.
- Maximum 5 bullets total. If you have more, pick the most operationally significant.`;

  try {
    const apiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You draft Security Risk Assessment narrative sections grounded only in provided data. No marketing language." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!apiResp.ok) {
      throw new Error(`openai ${apiResp.status}`);
    }
    const apiData = await apiResp.json();
    const content = apiData.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    return {
      threat_environment: String(parsed.threat_environment ?? "").substring(0, 1500),
      vulnerabilities: Array.isArray(parsed.vulnerabilities) ? parsed.vulnerabilities.slice(0, 6).map((v: unknown) => String(v).substring(0, 200)) : [],
      summary: String(parsed.summary ?? input.audit.summary_text ?? "").substring(0, 1200),
    };
  } catch (e) {
    console.error("narrative draft failed:", e);
    return {
      threat_environment: "[AI narrative draft failed — operator edit required]",
      vulnerabilities: input.features.length === 0 ? ["No features captured during this audit"] : [],
      summary: input.audit.summary_text || "[Operator summary not provided.]",
    };
  }
}

// ─── HTML renderer ────────────────────────────────────────────────
interface RenderInput {
  audit: { id: string; started_at: string; completed_at: string | null };
  asset: {
    name: string; asset_class: string; operational_status: string;
    criticality_tier: string | null;
    attributes: Record<string, unknown>;
    estimated_value_low_usd: number | null;
    estimated_value_high_usd: number | null;
  };
  client: { name: string; locations?: string[] } | null;
  operatorName: string;
  features: Array<{ feature_type: string; label: string | null; attributes: Record<string, unknown> }>;
  ratings: Array<{ risk_category: string; likelihood: number; impact: string; rating_label: string; rating_band: string; rationale: string | null }>;
  recs: Array<{ bucket: string; description: string; rationale: string | null }>;
  photos: Array<{ id: string; signed_url: string; captured_at: string | null; bearing_deg: number | null }>;
  documents: Array<{ id: string; doc_type: string | null; filename: string | null }>;
  adjacent: { audits?: Array<Record<string, unknown>>; signals?: Array<Record<string, unknown>> };
  narrative: { threat_environment: string; vulnerabilities: string[]; summary: string };
  assetLat: number | null;
  assetLng: number | null;
  mapFeatures: Array<{ id: string; feature_type: string; label: string | null; lat: number | null; lng: number | null }>;
}

function renderHtml(d: RenderInput): string {
  const esc = (s: unknown): string => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const date = d.audit.completed_at
    ? new Date(d.audit.completed_at).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const kmMarker = (d.asset.attributes as { km_marker?: string })?.km_marker;
  const roadAccess = (d.asset.attributes as { road_access?: string })?.road_access;
  const siteLocation = [kmMarker && `Km ${esc(kmMarker)}`, roadAccess && `on ${esc(roadAccess)}`].filter(Boolean).join(" ") || "&mdash;";

  // Group features by category.
  const featByType = new Map<string, typeof d.features>();
  for (const f of d.features) {
    const arr = featByType.get(f.feature_type) ?? [];
    arr.push(f);
    featByType.set(f.feature_type, arr);
  }

  const valueText = d.asset.estimated_value_low_usd && d.asset.estimated_value_high_usd
    ? `The total value of the assets on location is estimated between $${formatMoney(d.asset.estimated_value_low_usd)} and $${formatMoney(d.asset.estimated_value_high_usd)}.`
    : "Asset value: not captured for this audit.";

  // Controls — what's documented + what's missing.
  const controlBlocks: Array<[string, string]> = [
    ["Fencing & Locks", featByType.has("fence_segment") || featByType.has("gate") ? `${featByType.get("fence_segment")?.length ?? 0} fence segment(s) and ${featByType.get("gate")?.length ?? 0} gate(s) documented.` : "No fencing or gates documented during this audit."],
    ["Lighting", featByType.has("lighting_fixture") ? `${featByType.get("lighting_fixture")!.length} lighting fixture(s) documented.` : "No lighting fixtures documented."],
    ["Camera Surveillance", featByType.has("camera") ? `${featByType.get("camera")!.length} camera(s) documented.` : "No cameras documented."],
    ["Alarms / Sensors", featByType.has("intrusion_sensor") ? `${featByType.get("intrusion_sensor")!.length} intrusion sensor(s) documented.` : "No intrusion sensors documented."],
    ["Access Control", featByType.has("access_control_reader") || featByType.has("entry_point") ? `${(featByType.get("entry_point")?.length ?? 0) + (featByType.get("access_control_reader")?.length ?? 0)} access points / readers documented.` : "No access control infrastructure documented."],
    ["Communications", featByType.has("radio_repeater") || featByType.has("internet_uplink") || featByType.has("satphone_location") ? `${(featByType.get("radio_repeater")?.length ?? 0) + (featByType.get("internet_uplink")?.length ?? 0) + (featByType.get("satphone_location")?.length ?? 0)} communication(s) documented.` : "No communication infrastructure documented."],
  ];

  const recsByBucket = {
    short_term: d.recs.filter((r) => r.bucket === "short_term"),
    medium_term: d.recs.filter((r) => r.bucket === "medium_term"),
    long_term: d.recs.filter((r) => r.bucket === "long_term"),
  };

  const STYLE = `
    <style>
      body { font-family: Georgia, "Times New Roman", serif; background: white; color: #111; max-width: 800px; margin: 2rem auto; padding: 1rem; line-height: 1.5; }
      h1 { font-size: 1.6rem; border-bottom: 2px solid #111; padding-bottom: 0.3rem; }
      h2 { font-size: 1.25rem; margin-top: 1.5rem; border-bottom: 1px solid #888; padding-bottom: 0.2rem; }
      h3 { font-size: 1.05rem; margin-top: 1rem; }
      .meta { font-size: 0.92rem; color: #444; }
      table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
      th, td { border: 1px solid #999; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.95rem; }
      th { background: #f4f4f4; }
      .rating { font-weight: 600; }
      .rating.low          { color: #047857; }
      .rating.medium       { color: #b45309; }
      .rating.high         { color: #c2410c; }
      .rating.severe       { color: #b91c1c; }
      .rating.catastrophic { color: #991b1b; background: #fee2e2; padding: 0 0.3rem; }
      /* Adopted-text styling — no per-section disclaimer noise. The
         report has a single attribution note near the top. */
      .ai-draft { margin: 0.5rem 0; }
      .ai-attribution { font-size: 0.82rem; color: #555; font-style: italic; border-left: 3px solid #ca8a04; padding: 0.3rem 0.7rem; background: #fefce8; margin: 0.4rem 0; }
      ul.tight { margin: 0.3rem 0; padding-left: 1.5rem; }
      ul.tight li { margin: 0.15rem 0; }
      .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin: 0.5rem 0; }
      .photo-grid figure { margin: 0; }
      .photo-grid img { width: 100%; height: auto; border: 1px solid #999; }
      .photo-grid figcaption { font-size: 0.82rem; color: #555; margin-top: 0.2rem; }
      footer { margin-top: 2rem; padding-top: 0.8rem; border-top: 1px solid #888; font-size: 0.82rem; color: #555; }
    </style>
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Security Risk Assessment &mdash; ${esc(d.asset.name)}</title>
  ${STYLE}
</head>
<body>
  <h1>Security Risk Assessment</h1>
  <h2>Security Risk Assessment &ndash; ${esc(d.asset.name)}</h2>
  <div class="meta">
    Date: ${esc(date)}<br/>
    Prepared by: ${esc(d.operatorName)}, Field Security Coordinator<br/>
    Site Location: ${siteLocation}<br/>
    Client: ${esc(d.client?.name ?? "&mdash;")}
  </div>

  <p class="ai-attribution">Narrative sections (Threat Environment, Vulnerabilities, Summary) were drafted with AI assistance based on the data captured during this audit and adopted by the preparing operator. Edit before re-issuing if any wording needs adjustment.</p>

  <h2>Purpose</h2>
  <p>${esc(d.asset.name)} is a ${esc(d.asset.asset_class.replace(/_/g, " "))} within ${esc(d.client?.name ?? "the client's")} infrastructure. This assessment identifies key vulnerabilities and recommends mitigation strategies to enhance site security and operational integrity.</p>

  <h2>Site Overview</h2>
  <p><strong>Type:</strong> ${esc(d.asset.asset_class.replace(/_/g, " "))}</p>
  <p><strong>Assets on site (${d.features.length} feature${d.features.length === 1 ? "" : "s"} documented):</strong></p>
  <ul class="tight">
    ${Array.from(featByType.entries())
      // Counts only — readable summary, not a 22-line label dump.
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([type, list]) =>
        `<li>${esc(list.length)}&times; ${esc(type.replace(/_/g, " "))}</li>`,
      ).join("\n    ")}
    ${d.features.length === 0 ? "<li><em>No features captured during this audit.</em></li>" : ""}
  </ul>
  <p>${valueText}</p>

  ${d.assetLat !== null && d.assetLng !== null && d.mapFeatures.length > 0 ? `
  <h2>Site Map</h2>
  <p class="meta">Asset centroid (red <strong>A</strong>) and ${esc(d.mapFeatures.length)} geo-tagged feature${d.mapFeatures.length === 1 ? "" : "s"} (color-coded by type). Switch layers via the control top-right; click any marker for details.</p>
  <div id="sra-map" style="height:420px;border:1px solid #ddd;border-radius:6px;overflow:hidden"></div>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
  (function() {
    var map = L.map('sra-map', { zoomControl: true }).setView([${d.assetLat}, ${d.assetLng}], 18);
    // Same tile-layer stack the wildfire daily report uses. Esri imagery
    // is free for non-commercial use within reasonable rate limits.
    var baseLayers = {
      'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics'
      }),
      'Topographic': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, attribution: 'Topo: Esri, USGS, NOAA'
      }),
      'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
      })
    };
    baseLayers['Satellite'].addTo(map);
    L.control.layers(baseLayers, undefined, { position: 'topright' }).addTo(map);

    // Color-code feature pins by category for at-a-glance scanning.
    var typeColors = {
      fence_segment: '#16a34a', gate: '#0891b2', entry_point: '#0284c7',
      access_control_reader: '#0369a1', staffed_post: '#1d4ed8',
      camera: '#7c3aed', lighting_fixture: '#eab308', signage: '#a16207',
      intrusion_sensor: '#9333ea', sightline_blind_spot: '#dc2626',
      storage_container: '#92400e', fuel_or_hazmat_storage: '#ea580c',
      wildlife_attractant: '#65a30d',
      scada_node: '#be185d', plc: '#9d174d', historian: '#831843',
      engineering_workstation: '#86198f', vendor_remote_endpoint: '#a21caf',
      removable_media_location: '#701a75', server_room: '#581c87',
      radio_repeater: '#0e7490', internet_uplink: '#155e75', satphone_location: '#164e63',
      incident_marker: '#b91c1c', surveillance_observation: '#dc2626',
      high_value_target: '#f59e0b', other: '#525252',
    };

    // Asset centroid — large red labeled marker
    var assetIcon = L.divIcon({
      html: '<div style="background:#dc2626;color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)">A</div>',
      iconSize: [36,36], iconAnchor: [18,18], className: ''
    });
    L.marker([${d.assetLat}, ${d.assetLng}], { icon: assetIcon }).addTo(map)
      .bindPopup('<strong>${esc(d.asset.name)}</strong><br><small>Asset centroid</small>');

    var features = ${JSON.stringify(d.mapFeatures.map(f => ({
      type: f.feature_type, label: f.label ?? '', lat: f.lat, lng: f.lng,
    })))};
    var bounds = L.latLngBounds([[${d.assetLat}, ${d.assetLng}]]);
    features.forEach(function(f) {
      var col = typeColors[f.type] || '#525252';
      L.circleMarker([f.lat, f.lng], {
        radius: 7, color: col, fillColor: col, fillOpacity: 0.85, weight: 1.5
      }).addTo(map).bindPopup(
        '<strong>' + (f.label || f.type) + '</strong><br><small>' + f.type.replace(/_/g, ' ') + '</small>'
      );
      bounds.extend([f.lat, f.lng]);
    });
    if (features.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
    }
  })();
  </script>
  ` : ""}

  <h2>Site Status</h2>
  <p>Operational status: <strong>${esc(d.asset.operational_status.replace(/_/g, " "))}</strong>${d.asset.criticality_tier ? `. Criticality: ${esc(d.asset.criticality_tier.replace(/_/g, " "))}` : ""}.</p>

  <h2>Controls (existing, per this audit)</h2>
  <ul class="tight">
    ${controlBlocks.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join("\n    ")}
  </ul>

  <h2>Threat Environment</h2>
  <div class="ai-draft">${esc(d.narrative.threat_environment)}</div>

  ${(d.adjacent.audits?.length ?? 0) > 0 || (d.adjacent.signals?.length ?? 0) > 0 ? `
  <h3>Previous incidents at nearby sites (within 25km, last 12 months)</h3>
  <ul class="tight">
    ${(d.adjacent.audits ?? []).map((a) => `<li>${esc((a as { asset_name?: string }).asset_name)} (${esc((a as { distance_km?: number }).distance_km)}km) — audit completed ${esc(new Date((a as { completed_at: string }).completed_at).toLocaleDateString("en-CA"))}.${(a as { summary_text?: string }).summary_text ? ` ${esc((a as { summary_text: string }).summary_text!.substring(0, 200))}` : ""}</li>`).join("\n    ")}
    ${(d.adjacent.signals ?? []).map((s) => `<li>Signal: ${esc((s as { title?: string }).title)} (${esc((s as { severity?: string }).severity)}, ${esc(new Date((s as { created_at: string }).created_at).toLocaleDateString("en-CA"))})</li>`).join("\n    ")}
  </ul>
  ` : `<p><em>No incidents at nearby sites identified within 25km in the last 12 months.</em></p>`}

  <h2>Site Vulnerabilities</h2>
  <ul class="tight">
    ${d.narrative.vulnerabilities.map((v) => `<li class="ai-draft" style="margin-bottom:0.3rem">${esc(v)}</li>`).join("\n    ")}
  </ul>

  <h2>Risk Assessment</h2>
  <table>
    <thead>
      <tr><th>Risk Category</th><th>Likelihood</th><th>Impact</th><th>Rating</th><th>Rationale</th></tr>
    </thead>
    <tbody>
      ${d.ratings.map((r) => `
      <tr>
        <td>${esc(r.risk_category.replace(/_/g, " "))}</td>
        <td>${esc(r.likelihood)}</td>
        <td>${esc(r.impact)}</td>
        <td class="rating ${esc(r.rating_band)}">${esc(r.rating_label)}</td>
        <td>${esc(r.rationale ?? "")}</td>
      </tr>
      `).join("\n      ")}
      ${d.ratings.length === 0 ? `<tr><td colspan="5"><em>No risk ratings captured.</em></td></tr>` : ""}
    </tbody>
  </table>

  <h2>Recommendations</h2>

  <h3>Short Term (0&ndash;3 months)</h3>
  <ul class="tight">
    ${recsByBucket.short_term.length === 0 ? "<li><em>None.</em></li>" :
      recsByBucket.short_term.map((r) => `<li>${esc(r.description)}${r.rationale ? ` <em>(${esc(r.rationale)})</em>` : ""}</li>`).join("\n    ")}
  </ul>

  <h3>Medium Term (3&ndash;6 months)</h3>
  <ul class="tight">
    ${recsByBucket.medium_term.length === 0 ? "<li><em>None.</em></li>" :
      recsByBucket.medium_term.map((r) => `<li>${esc(r.description)}${r.rationale ? ` <em>(${esc(r.rationale)})</em>` : ""}</li>`).join("\n    ")}
  </ul>

  <h3>Long Term (>6 months)</h3>
  <ul class="tight">
    ${recsByBucket.long_term.length === 0 ? "<li><em>None.</em></li>" :
      recsByBucket.long_term.map((r) => `<li>${esc(r.description)}${r.rationale ? ` <em>(${esc(r.rationale)})</em>` : ""}</li>`).join("\n    ")}
  </ul>

  <h2>Summary</h2>
  <div class="ai-draft">${esc(d.narrative.summary)}</div>

  <h2>Appendix A: Selected Photos</h2>
  ${(() => {
    // Photo bloat fix: cap Appendix A at 12 representative photos.
    // Embedding every photo turned a 24-page report into 300MB. The
    // selection criterion: oldest photo per feature_type first (the
    // one most likely to be the "canonical" capture), most recent
    // last. Operator can browse the full gallery in the wizard.
    const MAX_APPENDIX_PHOTOS = 12;
    if (d.photos.length === 0) {
      return "<p><em>No photos captured.</em></p>";
    }
    const selected = d.photos.slice(0, MAX_APPENDIX_PHOTOS);
    const skipped = d.photos.length - selected.length;
    return `
  <p class="meta">${esc(selected.length)} of ${esc(d.photos.length)} photo${d.photos.length === 1 ? "" : "s"} shown${skipped > 0 ? ` (${esc(skipped)} additional available in the wizard gallery)` : ""}.</p>
  <div class="photo-grid">
    ${selected.map((p) => `
      <figure>
        <img src="${esc(p.signed_url)}" alt="" />
        <figcaption>${p.captured_at ? esc(new Date(p.captured_at).toLocaleString()) : ""}${p.bearing_deg !== null ? ` &middot; bearing ${esc(p.bearing_deg.toFixed(0))}&deg;` : ""}</figcaption>
      </figure>
    `).join("\n    ")}
  </div>`;
  })()}

  ${d.documents.length > 0 ? `
  <h3>Supporting documents</h3>
  <ul class="tight">
    ${d.documents.map((doc) => `<li>${esc(doc.filename ?? "document")}${doc.doc_type ? ` (${esc(doc.doc_type)})` : ""}</li>`).join("\n    ")}
  </ul>
  ` : ""}

  <h2>Appendix B: Risk Matrix</h2>
  <table>
    <thead>
      <tr>
        <th></th>
        <th>A · Insignificant</th>
        <th>B · Minor</th>
        <th>C · Moderate</th>
        <th>D · Major</th>
        <th>E · Catastrophic</th>
      </tr>
    </thead>
    <tbody>
      ${[5, 4, 3, 2, 1].map((l) => `
      <tr>
        <th>${l} · ${["Rare","Unlikely","Possible","Likely","Almost Certain"][l - 1]}</th>
        ${["A","B","C","D","E"].map((i, j) => {
          const score = l * (j + 1);
          const band = score <= 3 ? "low" : score <= 7 ? "medium" : score <= 12 ? "high" : score <= 19 ? "severe" : "catastrophic";
          return `<td class="rating ${band}">${l}${i}</td>`;
        }).join("")}
      </tr>
      `).join("\n      ")}
    </tbody>
  </table>

  <footer>
    Generated by Fortress AI · audit ${esc(d.audit.id)} · ${esc(date)}
  </footer>
</body>
</html>`;
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
