// generate-subject-exposure-report — the $10k deliverable. Follows the generate-report pattern: build a
// styled PRINT-HTML document (light theme, NOT the app's dark CSS) + persist a `reports` row
// (type='reputational_exposure', issuable=false deny-by-default — nothing leaves until an operator flips it).
// Five sections: (1) Scope & method incl. the DENOMINATOR and what was NOT searched (negative-space
// discipline); (2) third-party exposure ordered by obscurity; (3) self-published; (4) breach w/ recency
// caveat stated plainly; (5) remediation — operator-authored ONLY, never fabricated.
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";

import { compareExposureItems } from "../_shared/subject-retrieval.ts";
import { excludeMergedEntities, excludeSupersededExposure } from "../_shared/soft-delete-filters.ts";
import { runSynthesis, renderSynthesisSection } from "../_shared/synthesis-primitives.ts";

const REPORT_BUCKET = "generated-reports";   // private bucket (migration 20260212143009), signed-URL only

const ALL7 = ["legal", "financial", "professional", "media", "social", "corporate", "property"];
const SOURCES_NOT_COVERED = [
  "Credentialed dark-web forums and marketplaces (access-restricted)",
  "Private or locked social-media accounts",
  "Paywalled public-records databases not integrated with this scan",
  "Non-indexed deep-web content and login-walled pages",
  "Real-time or ephemeral content (stories, disappearing posts) outside the capture window",
];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!data;
}
async function authorize(supabase: any, caller: any, clientId: string | null): Promise<boolean> {
  if (caller.kind !== "user") return true;
  if (clientId && await userCanAccessClient(supabase, caller.userId, clientId)) return true;
  return isSuperAdmin(supabase, caller.userId);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
    const body = await req.json().catch(() => null);
    const entityId = body?.entityId;
    if (!entityId) return errorResponse("entityId required", 400);
    const supabase = createServiceClient();

    const { data: entity } = await excludeMergedEntities(supabase.from("entities").select("id, name, client_id, tenant_id, attributes")).eq("id", entityId).maybeSingle();
    if (!entity) return errorResponse("entity not found", 404);
    if (!(await authorize(supabase, caller, entity.client_id))) return errorResponse("NOT_AUTHORIZED", 403);
    const { data: client } = entity.client_id ? await supabase.from("clients").select("name").eq("id", entity.client_id).maybeSingle() : { data: null };

    // ── gather: CURRENT items only (superseded/aged-out excluded), their locations, family disposition ──
    const { data: items } = await excludeSupersededExposure(supabase.from("subject_exposure_items")
      .select("id, category, title, summary, severity, is_finding, exposure_class, anchor_type, anchor_value, source_class, fingerprint, subject_awareness, first_seen_date, finding_basis"))
      .eq("subject_entity_id", entityId)
      // WO-LEGAL-FABRICATION (2026-08-31): blanket legal suppression REINSTATED. The 2026-08-30 lift assumed
      // the corroboration gate covered legal fabrication; it scores SOURCES, not classification — a fabricated
      // "X v. Y" on a page naming the subject in legal context passes it. OFF until the classifier is rebuilt
      // (CanLII-verified). Matches subject-exposure. Suppresses the one real case (Kilback v. Olynyk) — accepted.
      .neq("category", "legal");
    const ids = (items ?? []).map((i: any) => i.id);
    let locs: any[] = [];
    if (ids.length) {
      const { data } = await supabase.from("subject_exposure_locations")
        .select("exposure_item_id, url, domain, found_by_query, found_at_rank, date_captured").in("exposure_item_id", ids);
      locs = data ?? [];
    }
    const byItem = new Map<string, any[]>();
    for (const l of locs) { if (!byItem.has(l.exposure_item_id)) byItem.set(l.exposure_item_id, []); byItem.get(l.exposure_item_id)!.push(l); }
    const enriched = (items ?? []).map((i: any) => {
      const ls = (byItem.get(i.id) ?? []).sort((a, b) => (a.found_at_rank ?? 999) - (b.found_at_rank ?? 999));
      return { ...i, locations: ls, location_count: ls.length, obscurity_rank: ls.length ? Math.min(...ls.map((l) => l.found_at_rank ?? 999)) : 999 };
    });
    // Environmental findings are coordinate-anchored and carry no web sources — attach the live hazard feed
    // so the report's "every finding carries a source" claim holds.
    for (const i of enriched) {
      if (i.category === "environmental" && (!i.locations || i.locations.length === 0)) {
        const hz = String(i.title || "").split(" · ")[1]?.split(":")[0]?.trim().toLowerCase() || "";
        const feed = hz.includes("wildfire") ? { domain: "CWFIS / BC Wildfire Service", url: "https://cwfis.cfs.nrcan.gc.ca/" }
          : hz.includes("air") ? { domain: "Environment Canada — AQHI", url: "https://weather.gc.ca/airquality/forecast/current/" }
          : hz.includes("road") ? { domain: "DriveBC", url: "https://www.drivebc.ca/" }
          : hz.includes("avalanche") ? { domain: "Avalanche Canada", url: "https://avalanche.ca/" }
          : { domain: "Environment Canada — Weather", url: "https://weather.gc.ca/" };
        i.locations = [{ url: feed.url, domain: feed.domain, found_by_query: "live hazard feed", found_at_rank: 1 }];
        i.location_count = 1; i.obscurity_rank = 1;
      }
    }
    // THREE-BUCKET classification from the stored exposure_class (the DB identity-anchor gate is the source
    // of truth): finding (adverse+anchored) · verified_presence (corroborated, neutral — confirmed footprint)
    // · noise (unanchored single-source name-match). Breaches keep their own section. CONSEQUENCE-FIRST sort.
    const findings = enriched.filter((i: any) => i.category !== "data_breach" && i.exposure_class === "finding").sort(compareExposureItems);
    const verifiedPresence = enriched.filter((i: any) => i.exposure_class === "verified_presence").sort((a: any, b: any) => (b.location_count ?? 0) - (a.location_count ?? 0));
    const noise = enriched.filter((i: any) => i.category !== "data_breach" && i.exposure_class === "noise").sort(compareExposureItems);
    const breaches = enriched.filter((i: any) => i.category === "data_breach").sort((a: any, b: any) => (b.first_seen_date ?? "").localeCompare(a.first_seen_date ?? ""));

    // AGGREGATED DENOMINATOR (b) — latest-of-each-producer, HONEST ABOUT AGE. A category swept 6 days ago
    // and a breach checked today are stated per producer WITH their date. "Searched" without a date is the
    // same defect one level up.
    const { data: runs } = await supabase.from("subject_scan_runs").select("scope, counts, started_at, finished_at")
      .eq("subject_entity_id", entityId).eq("status", "completed").order("started_at", { ascending: false });
    const runsArr = runs ?? [];
    const dstr = (r: any) => (r?.finished_at || r?.started_at || "").slice(0, 10);
    const categorySweeps: Record<string, { last_swept: string; depth: string; queries: number } | null> = {};
    for (const cat of ALL7) {
      const run = runsArr.find((r: any) => (r.scope?.categories || []).includes(cat));
      categorySweeps[cat] = run ? { last_swept: dstr(run), depth: run.scope?.depth ?? "—", queries: run.counts?.battery_queries ?? null } : null;
    }
    // Coverage-contradiction fix: a category with captured items OR whose QUERY TERMS ran WAS searched —
    // never render "not searched" beside captures. financial/professional/corporate/property queries ran
    // (director/bankruptcy/lien/mortgage…) but classified as generic mentions, so key off found_by_query too.
    const QUERY_TERM_CAT: [string, RegExp][] = [
      ["financial", /\b(bankrupt\w*|insolvenc\w*|lien|creditor|foreclos\w*|receivership|garnish\w*)\b/i],
      ["professional", /\b(director|officer|founder|shareholder|disciplinary|licen[cs]e|misconduct)\b/i],
      ["corporate", /\b(incorporat\w*|registered company|corporate registry|registrar of companies)\b/i],
      ["property", /\b(propert\w*|real estate|deed|title search|mortgage|parcel|assessment roll)\b/i],
      ["legal", /\b(lawsuit|sued|litigation|judgment|plaintiff|defendant|court)\b/i],
    ];
    const capByCat: Record<string, string> = {};
    const touchCat = (cat: string, d: any) => { if (!d || !ALL7.includes(cat)) return; const s = String(d).slice(0, 10); if (!capByCat[cat] || capByCat[cat] < s) capByCat[cat] = s; };
    for (const i of enriched) {
      touchCat(i.category, i.first_seen_date);
      for (const l of (i.locations || [])) {
        touchCat(i.category, l.date_captured);
        const q = String(l.found_by_query || "");
        for (const [cat, re] of QUERY_TERM_CAT) if (re.test(q)) touchCat(cat, l.date_captured || i.first_seen_date);
      }
    }
    for (const cat of ALL7) if (!categorySweeps[cat] && capByCat[cat]) categorySweeps[cat] = { last_swept: capByCat[cat], depth: "captures on file — no dedicated sweep record", queries: null } as any;
    const catsSwept = ALL7.filter((c) => categorySweeps[c]);
    // A DEDICATED sweep = a real scan-run scope for that category. A category "swept" only via incidental
    // captures (capByCat, line 129) is NOT a dedicated sweep and must not be claimed as a clean bill.
    const isDedicatedSweep = (c: string) => !!categorySweeps[c] && !String((categorySweeps[c] as any).depth || "").includes("no dedicated sweep");
    const catsWithFindings = [...new Set([...findings, ...breaches, ...verifiedPresence].map((i: any) => i.category))];
    const catsWithAnyCapture = new Set(enriched.map((i: any) => i.category));
    const catsNeverSwept = ALL7.filter((c) => !categorySweeps[c] && !catsWithAnyCapture.has(c));
    // "Swept, no findings" is a clean-bill claim — restrict it to DEDICATED sweeps. Incidental-capture-only
    // categories are listed separately so we never over-claim (WO #4, 2026-08-30).
    const catsEmpty = ALL7.filter((c: string) => isDedicatedSweep(c) && !catsWithFindings.includes(c));
    const catsIncidentalOnly = ALL7.filter((c: string) => !!categorySweeps[c] && !isDedicatedSweep(c) && !catsWithFindings.includes(c));
    // Breach producer — last time HIBP was checked (latest capture among current breach locations).
    const breachDates = breaches.flatMap((b: any) => (b.locations || []).map((l: any) => l.date_captured)).filter(Boolean).sort();
    const breachLastChecked = breachDates.length ? String(breachDates[breachDates.length - 1]).slice(0, 10) : null;

    // family NOT scanned — the edges of coverage, per person, with the reason
    const { data: family } = await excludeMergedEntities(supabase.from("entities").select("name, attributes"))
      .eq("client_id", entity.client_id).contains("attributes", { parent_vip_entity_id: entityId });
    const familyNotScanned = (family ?? []).map((f: any) => {
      const a = f.attributes ?? {};
      const reason = a.is_minor === true ? "excluded — minor (under 18)"
        : a.is_minor === null || a.is_minor === undefined ? "not scanned — date of birth not provided (cannot confirm adult)"
        : a.scan_consent?.granted !== true ? "not scanned — no personal consent on file"
        : "scanned separately";
      return { name: f.name, reason };
    }).filter((f: any) => f.reason !== "scanned separately");

    // remediation: operator-authored ONLY. never fabricated.
    const remediation = body?.remediation && (body.remediation.summary || (body.remediation.items?.length))
      ? { authored: true, summary: String(body.remediation.summary ?? ""), items: Array.isArray(body.remediation.items) ? body.remediation.items : [] }
      : { authored: false, summary: "", items: [] };

    // ── Section 6 · Family & Child Safety (authored guidance; renders only for a family engagement) ──
    const childPlatforms: string[] = (entity.attributes?.child_platforms ?? []).map((p: string) => String(p).toLowerCase());
    const includeChildSafety = childPlatforms.length > 0 || body?.includeChildSafety === true;
    let childSafety: any = null;
    if (includeChildSafety) {
      const { data: g } = await supabase.from("child_safety_guidance").select("section, key, title, content, is_emergency, reviewed_by, last_reviewed_at, display_order").eq("is_active", true).order("display_order");
      const rows = g ?? [];
      const isDraft = (r: any) => !r.reviewed_by || /^DRAFT/i.test(r.reviewed_by);
      const pick = (sec: string, filterKeys?: string[]) => rows.filter((r: any) => r.section === sec && (!filterKeys || filterKeys.includes(r.key)));
      const platforms = pick("platform", childPlatforms);   // only the platforms the parent selected
      childSafety = {
        framing: pick("framing"), platforms, cross_platform: pick("cross_platform"),
        protocols: pick("protocol"), escalation: pick("escalation"),
        selected_platforms: childPlatforms,
        contains_draft: [...pick("framing"), ...platforms, ...pick("cross_platform"), ...pick("protocol"), ...pick("escalation")].some(isDraft),
      };
    }

    // ── synthesis primitives (deterministic, template-only; _shared/synthesis-primitives.ts) ──
    const { data: subjectDevices } = await supabase.from("subject_devices")
      .select("id, vendor, product, version, version_unknown, internet_exposed, device_type")
      .eq("entity_id", entityId);
    const synthesis = runSynthesis((items ?? []) as any, (subjectDevices ?? []) as any, entity.name);

    const meta = {
      subject: { name: entity.name, entity_id: entityId },
      client: client?.name ?? null,
      generated_at: new Date().toISOString(),
      child_safety: childSafety ? { included: true, selected_platforms: childPlatforms, contains_draft: childSafety.contains_draft } : { included: false },
      coverage: {
        producers: {
          reputational_by_category: categorySweeps,                       // per-category last-swept + depth (age-honest)
          breach: breachLastChecked ? { last_checked: breachLastChecked, current_findings: breaches.length } : null,
        },
        categories_with_findings: catsWithFindings, categories_swept_empty: catsEmpty,
        categories_incidental_only: catsIncidentalOnly,
        not_searched: { categories_never_swept: catsNeverSwept, sources_not_covered: SOURCES_NOT_COVERED, family_not_scanned: familyNotScanned },
      },
      counts: { findings: findings.length, verified_presence: verifiedPresence.length, noise: noise.length, breaches: breaches.length },
      remediation,
      synthesis,
    };

    const reportId = crypto.randomUUID();
    const html = renderReport({ meta, findings, verifiedPresence, noise, breaches, reportId, childSafety, synthesis });

    // store the rendered HTML in the private generated-reports bucket
    const path = `reputational-exposure/${entityId}/${reportId}.html`;
    await supabase.storage.from(REPORT_BUCKET).upload(path, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: true });

    const { error: insErr } = await supabase.from("reports").insert({
      id: reportId, type: "reputational_exposure", subject_entity_id: entityId,
      client_id: entity.client_id ?? null, tenant_id: entity.tenant_id ?? null,
      period_start: runsArr[0]?.started_at ?? new Date().toISOString(), period_end: new Date().toISOString(),
      storage_url: path, issuable: false, rendered_persisted_at: new Date().toISOString(), meta_json: meta,
    });
    if (insErr) return errorResponse(`report persist failed: ${insErr.message}`, 500);

    // Short-lived signed URL for OPERATOR review only (private bucket). issuable=false still gates any
    // client delivery — this link lets the operator read the draft, nothing more. Signed, never public.
    const { data: signed } = await supabase.storage.from(REPORT_BUCKET).createSignedUrl(path, 3600);

    return successResponse({
      reportId, issuable: false, storage_path: path, bucket: REPORT_BUCKET,
      view_url: signed?.signedUrl ?? null,
      html,   // rendered HTML returned so the client can render it from a text/html blob — Supabase
              // Storage neutralizes HTML content-type on serve (anti-XSS), so the signed URL alone
              // shows raw source. The blob path renders reliably regardless of storage serving.
      counts: meta.counts, remediation_authored: remediation.authored,
      note: "Report generated and PERSISTED, issuable=false. It will NOT deliver until an operator sets issuable=true. Remediation is operator-authored only. Render `html` via a text/html blob; view_url is the stored (neutralized) copy.",
    });
  } catch (e) {
    console.error("[generate-subject-exposure-report] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});

// ── PRINT-HTML renderer — light theme, print-optimised (NOT the app dark CSS). ──
function renderReport({ meta, findings, verifiedPresence, noise, breaches, reportId, childSafety, synthesis }: any): string {
  const cov = meta.coverage;
  const sevBadge = (s: string) => `<span class="sev sev-${esc(s)}">${esc(s || "—")}</span>`;
  const awareness = (a: string) => a ? `<span class="aware aware-${esc(a)}">${a === "unknown" ? "not previously known" : esc(a)}</span>` : "";
  // Collapse captures by domain, then by DISTINCT query — one line per query with a capture count,
  // so a source that returns the same query across many pages (e.g. 54 near-identical pressreader
  // captures) reads as "pressreader.com · found via <q> ×N", not 54 duplicate lines. Rank dropped —
  // a rank is meaningful per-capture, not per collapsed group.
  const locList = (ls: any[]) => {
    const byDomain = new Map<string, { url: string; queries: Map<string, { count: number; date: string | null }> }>();
    for (const l of ls || []) {
      const d = l.domain || l.url || "—";
      if (!byDomain.has(d)) byDomain.set(d, { url: l.url, queries: new Map() });
      const g = byDomain.get(d)!;
      const q = String(l.found_by_query || "—");
      if (!g.queries.has(q)) g.queries.set(q, { count: 0, date: null });
      const qi = g.queries.get(q)!;
      qi.count++;
      const dt = l.date_captured ? String(l.date_captured).slice(0, 10) : null;
      if (dt && (!qi.date || dt > qi.date)) qi.date = dt;
    }
    return `<ul class="locs">${[...byDomain.entries()].map(([domain, g]) =>
      `<li><a href="${esc(g.url)}">${esc(domain)}</a>${g.queries.size > 1 ? ` <span class="rank">${g.queries.size} queries</span>` : ""}<div class="prov">${[...g.queries.entries()].map(([q, qi]) =>
        `found via <code>${esc(q)}</code>${qi.count > 1 ? ` <span class="rank">×${qi.count} captures</span>` : ""}${qi.date ? ` · captured ${esc(qi.date)}` : ""}`).join("<br>")}</div></li>`).join("")}</ul>`;
  };
  const ANCHOR_LABEL: Record<string, string> = { email: "email", coordinate: "coordinate", profile_url: "profile URL", device: "device", data_broker: "data broker", source_corroboration: "source corroboration" };
  // D6: never print a raw coordinate in a client-facing document. The human label (e.g. "Kilback children
  // school") is already carried in the item TITLE, so a coordinate anchor line adds nothing but precise
  // geolocation of the subject/family in an emailed file. Suppress it entirely for coordinate anchors.
  // All other anchor types (email / profile URL / device / data broker) still render their value.
  const anchorLine = (i: any) => i.anchor_type && i.anchor_value && i.anchor_type !== "coordinate"
    ? `<div class="anchor"><span class="alabel">Tied to</span> <span class="aval">${esc(i.anchor_value)}</span> <span class="atype">${esc(ANCHOR_LABEL[i.anchor_type] || i.anchor_type)}</span></div>` : "";
  const srcCount = (i: any) => { const dd = new Set((i.locations || []).map((l: any) => l.domain).filter(Boolean)).size; const cc = i.locations.length; return `${dd} independent domain${dd === 1 ? "" : "s"}${cc !== dd ? ` · ${cc} capture${cc === 1 ? "" : "s"}` : ""}`; };
  // D1: rank is stated as a plain fact ("appeared at position N in search results"), not editorialized as
  // "buried". Meaning is defined ONCE at the top of the Third-Party Exposure section. Only search-derived
  // items ever carry a real rank (<999); breach/environmental render nothing here (breach has no search rank,
  // environmental renders via envBlock), so "in search results" is truthful wherever this actually prints.
  const itemBlock = (i: any) => `<div class="item"><div class="ihead"><span class="cat">${esc(i.category)}</span>${sevBadge(i.severity)}<span class="position">${i.obscurity_rank >= 999 ? "" : `appeared at position ${i.obscurity_rank} in search results`}</span>${awareness(i.subject_awareness)}</div><div class="ititle">${esc(i.title)}</div>${anchorLine(i)}${i.summary ? `<div class="isum">${esc(i.summary)}</div>` : ""}<div class="lcount">${srcCount(i)}:</div>${locList(i.locations)}</div>`;
  // Third-party split: real findings render prominently; bare mentions are counted + collapsed (web) or
  // moved to Appendix A (print), so the PDF the client keeps never silently omits the mention volume.
  // Environmental findings are LIVE HAZARD-FEED results (wildfire/weather/road tied to a coordinate),
  // not things others wrote — they get their own section and no search "rank". Everything else adverse
  // is third-party (written by others).
  const isEnvFeed = (f: any) => f.category === "environmental" || f.anchor_type === "coordinate";
  const envFindings = (findings || []).filter(isEnvFeed);
  const tpFindings = (findings || []).filter((f: any) => !isEnvFeed(f));  // written-by-others (legal / broker)
  const tpMentions = noise || [];                   // single-source name-matches — volume, not findings
  const presence = verifiedPresence || [];          // corroborated (>=2 domains) but neutral — confirmed footprint
  const mentionRow = (m: any) => `<div class="mention-row"><span class="cat">${esc(m.category)}</span> ${esc(m.title)} — ${(m.locations || []).map((l: any) => `<a href="${esc(l.url)}">${esc(l.domain || l.url)}</a>${l.date_captured ? ` <span class="rank">(captured ${esc(String(l.date_captured).slice(0, 10))})</span>` : ""}`).join(", ")}</div>`;
  // Hazard-feed finding renderer — location + hazard + severity + measurement; NO rank, NO domain/query list.
  const envBlock = (i: any) => `<div class="item"><div class="ihead"><span class="cat">environmental</span>${sevBadge(i.severity)}${awareness(i.subject_awareness)}</div><div class="ititle">${esc(i.title)}</div>${anchorLine(i)}${i.summary ? `<div class="isum">${esc(i.summary)}</div>` : ""}${i.first_seen_date ? `<div class="prov">measured ${esc(String(i.first_seen_date).slice(0, 10))}</div>` : ""}</div>`;
  // Dynamic section numbering — sections number sequentially in render order, so a conditional section
  // (Family, only on family engagements) never leaves a gap or keeps a stale number.
  let __sn = 0;
  const sec = (t: string) => `<h2>${++__sn} · ${t}</h2>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Reputational Exposure — ${esc(meta.subject.name)}</title>
<style>
  @page { margin: 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff; line-height: 1.5; max-width: 820px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; margin: 32px 0 12px; }
  .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
  .section-intro { color: #444; font-size: 13px; font-style: italic; margin: 0 0 12px; }
  .synth { border: 1px solid #e0e0e0; border-left: 4px solid #999; border-radius: 6px; padding: 11px 14px; margin: 10px 0; page-break-inside: avoid; }
  .synth h4 { margin: 0 0 6px; font-size: 14px; } .synth p { margin: 0 0 6px; }
  .synth-state { font-size: 10px; font-weight: 700; letter-spacing: .05em; padding: 1px 6px; border-radius: 3px; color: #fff; vertical-align: middle; }
  .synth-established { border-left-color: #b03a2e; } .synth-established .synth-state { background: #b03a2e; }
  .synth-qualified { border-left-color: #b9770e; } .synth-qualified .synth-state { background: #b9770e; }
  .synth-not_asserted { border-left-color: #7f8c8d; } .synth-not_asserted .synth-state { background: #7f8c8d; }
  .synth-part { margin: 0 0 4px; font-size: 13.5px; } .synth-lab { font-weight: 700; display: inline-block; min-width: 82px; color: #333; }
  .part-divider { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #555; border-top: 2px solid #cfcfcf; margin: 40px 0 10px; padding-top: 10px; }
  .part-divider .pd-sub { font-weight: 400; text-transform: none; letter-spacing: 0; color: #888; font-size: 12px; }
  table.cov { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; } .cov td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; } .cov td:first-child { color: #666; width: 40%; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; background: #eef; margin: 2px 3px 2px 0; }
  .pill.empty { background: #f4f4f4; color: #888; } .pill.oos { background: #fbeaea; color: #a33; }
  .notsearched { background: #fafaf5; border: 1px solid #e8e4d0; border-radius: 6px; padding: 12px 16px; margin: 12px 0; font-size: 13px; }
  .notsearched ul { margin: 6px 0 0; padding-left: 18px; } .notsearched li { margin: 2px 0; }
  .item { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; margin: 10px 0; page-break-inside: avoid; }
  .ihead { font-size: 12px; margin-bottom: 4px; } .cat { text-transform: uppercase; letter-spacing: .04em; color: #666; margin-right: 8px; }
  .ititle { font-weight: bold; font-size: 15px; } .isum { color: #444; font-size: 13px; margin: 4px 0; }
  .anchor { font-size: 12px; margin: 4px 0; padding: 3px 8px; background: #eef5ee; border-left: 3px solid #3a7d3a; border-radius: 3px; display: inline-block; }
  .anchor .alabel { color: #3a7d3a; font-weight: bold; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .anchor .aval { font-family: ui-monospace, Menlo, monospace; color: #1a1a1a; } .anchor .atype { color: #777; font-size: 11px; } .anchor .atype:before { content: "· "; }
  .lcount { font-size: 12px; color: #666; margin-top: 6px; } ul.locs { margin: 4px 0 0; padding-left: 16px; font-size: 13px; } ul.locs li { margin: 4px 0; }
  ul.locs a { color: #1a4a8a; word-break: break-all; } .prov { color: #888; font-size: 11px; } .prov code { background: #f4f4f4; padding: 0 3px; }
  .rank { color: #999; font-size: 11px; }
  .sev { font-size: 11px; padding: 1px 6px; border-radius: 3px; font-weight: bold; } .sev-critical { background: #7a1f1f; color: #fff; } .sev-high { background: #c0392b; color: #fff; } .sev-medium { background: #e6a817; color: #1a1a1a; } .sev-low { background: #ddd; color: #333; }
  .aware { font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px; } .aware-unknown { background: #c0392b; color: #fff; } .aware-disputed { background: #e6a817; } .aware-known { background: #eee; color: #777; }
  .position { color: #7a5; font-size: 11px; margin-left: 6px; }
  .caveat { background: #fff8e6; border-left: 3px solid #e6a817; padding: 8px 12px; font-size: 13px; margin: 10px 0; }
  .rem-placeholder { color: #888; font-style: italic; border: 1px dashed #ccc; padding: 16px; border-radius: 6px; }
  .empty-note { color: #888; font-style: italic; font-size: 13px; }
  .mentions { margin: 14px 0; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 14px; background: #fafafa; }
  .mentions summary { cursor: pointer; font-size: 13px; color: #444; }
  .mention-row { font-size: 12px; color: #555; padding: 4px 0; border-top: 1px solid #eee; margin-top: 6px; word-break: break-word; }
  .mention-row .cat { text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: #999; margin-right: 5px; }
  .mention-row a { color: #1a4a8a; }
  /* print vs screen are mutually exclusive media types: a PDF renderer applies @media print (never screen),
     a browser applies @media screen. So web gets the collapse, print gets Appendix A, and if a renderer
     applies NEITHER, everything shows — nothing is ever silently omitted from the deliverable. */
  @media print { .screen-collapse { display: none !important; } }
  @media screen { .print-ptr, .print-appendix { display: none; } }
  .print-ptr { font-size: 13px; color: #444; margin: 12px 0; }
  .print-appendix { margin-top: 40px; page-break-before: always; }
  .draft-banner { background: #7a1f1f; color: #fff; padding: 12px 16px; border-radius: 6px; font-weight: bold; margin: 16px 0; font-size: 14px; }
  .draft-tag { display: inline-block; background: #7a1f1f; color: #fff; font-size: 10px; font-weight: bold; padding: 1px 6px; border-radius: 3px; letter-spacing: .05em; margin-left: 8px; vertical-align: middle; }
  .cs-block { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; margin: 10px 0; page-break-inside: avoid; }
  .cs-block.emergency { border-color: #c0392b; background: #fdf3f2; }
  .cs-block h4 { margin: 0 0 6px; font-size: 15px; } .cs-block .prov { color: #999; font-size: 11px; margin-top: 6px; }
  .cs-block ul { margin: 6px 0 0; padding-left: 18px; } .cs-sub { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 2px; }
  footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ddd; color: #999; font-size: 11px; }
</style></head><body>
<h1>Reputational Exposure Assessment</h1>
<div class="sub"><strong>${esc(meta.subject.name)}</strong>${meta.client ? ` · prepared for ${esc(meta.client)}` : ""} · generated ${esc(meta.generated_at.slice(0, 10))} · report ${esc(reportId.slice(0, 8))}</div>
${childSafety?.contains_draft ? `<div class="draft-banner">⚠ DRAFT — this report contains family &amp; child-safety guidance (Section 3) that has NOT been reviewed or signed by a child-safety professional. It must not be delivered to a client in this state.</div>` : ""}

<div class="part-divider">Part I · What this means &amp; what to do</div>

${sec("Synthesis")}
<div class="caveat"><strong>Coverage:</strong> this reflects public and breach sources only — see Section 7 (Scope &amp; Method) for what was <em>not</em> checked (e.g. dark-web marketplaces, paywalled records).</div>
<p class="section-intro">What the findings in this report add up to — the higher-order exposure picture. Each item is a fixed template filled ONLY from those findings (listed in Part II below); no narrative is generated. States: <strong>ESTABLISHED</strong> (asserted from cited rows), <strong>QUALIFIED</strong> (asserted with a stated limit), <strong>NOT ASSERTED</strong> (checked, no basis — shown because the absence is itself informative).</p>
${synthesis && synthesis.length ? renderSynthesisSection(synthesis) : '<p class="empty-note">No synthesis primitives evaluated.</p>'}

${sec("Remediation")}
${meta.remediation.authored
    ? `${meta.remediation.summary ? `<p>${esc(meta.remediation.summary)}</p>` : ""}${meta.remediation.items.length ? `<ol>${meta.remediation.items.map((r: any) => `<li><strong>${esc(r.action)}</strong>${r.finding_ref ? ` <span class="rank">(${esc(r.finding_ref)})</span>` : ""}${r.rationale ? `<div class="isum">${esc(r.rationale)}</div>` : ""}</li>`).join("")}</ol>` : ""}<p class="section-intro">Remediation authored by analyst.</p>`
    : `<div class="rem-placeholder"><strong>Pending analyst review.</strong> Remediation for this assessment is authored by your analyst and added before the report is issued — it is never machine-generated.</div>`}

${childSafety ? sec("Family &amp; Child Safety") + renderChildSafety(childSafety) : ""}

<div class="part-divider">Part II · The evidence <span class="pd-sub">— supporting findings the conclusions above rest on</span></div>

${sec("Breach Exposure")}
<p class="section-intro">Data breaches affecting your personal accounts (Have I Been Pwned).</p>
<div class="caveat"><strong>On severity and age:</strong> severity here reflects the <em>type</em> of data exposed, not the <em>age</em> of the breach. A breach from 2013 and a recent credential-stealer log may both show High. Read the breach date on each — a recent stealer-log finding means a device may have been compromised and credentials may be live, which is materially more urgent than a historical breach whose passwords you have since changed. Differentiated remediation guidance is in development.</div>
${breaches.length ? breaches.map(itemBlock).join("") : '<p class="empty-note">No breaches found for the personal emails checked.</p>'}

${envFindings.length ? `${sec("Environmental Exposure")}
<p class="section-intro">Physical hazards at locations tied to you (home, family, property) from live hazard feeds — wildfire, weather, air quality, road, avalanche. These are conditions in the world around you, measured from feeds; they are not content anyone wrote about you, and they carry no search "rank".</p>
${envFindings.map(envBlock).join("")}` : ""}

${sec("Third-Party Exposure")}
<p class="section-intro">What is out there about you, written by others — real findings first (highest-consequence first). Bare mentions of your name that carry no finding are counted and collapsed below, so you can see the volume without the report implying they are problems.</p>
<p class="section-intro">Some items note the <strong>position</strong> they appeared at in the search results we ran — position 1 is the first result; a higher number means it appeared further down. Position records where something showed up, not how serious it is.</p>
${tpFindings.length ? tpFindings.map(itemBlock).join("") : '<p class="empty-note">No third-party FINDINGS (a finding is a legal matter, breach, or documented event — not a bare mention).</p>'}
${tpMentions.length ? `<details class="mentions screen-collapse"><summary><strong>Also found — ${tpMentions.length} mention${tpMentions.length === 1 ? "" : "s"} of your name with no finding attached.</strong> Pages where your name appears without a legal matter, breach, or event — expand to review.</summary>${tpMentions.map(mentionRow).join("")}</details>
<p class="print-ptr"><strong>Also found — ${tpMentions.length} mention${tpMentions.length === 1 ? "" : "s"} of your name with no finding attached</strong> — pages where your name appears without a legal matter, breach, or event. Listed in full at <strong>Appendix A</strong>.</p>` : ""}

${sec("Verified Public Presence")}
<p class="section-intro">Content about you confirmed by two or more independent sources but NOT adverse — your genuine public footprint (press, profiles, appearances). Not exposure, and not called such; but it is what an adversary assembles a picture from, so it is on the record. Distinct from the single-source name-matches in the volume below, whose attribution is unverified.</p>
${presence.length ? presence.map(itemBlock).join("") : '<p class="empty-note">No corroborated public presence surfaced (nothing confirmed by 2+ independent sources).</p>'}

${sec("Scope &amp; Method")}
<p class="section-intro">What we searched, when, and — equally — what we did not. A finding is only as meaningful as the space it was found in; and "searched" is only meaningful with a date. Each producer below is dated on its own last sweep.</p>
<table class="cov">
  <tr><td>Reputational sweep — by category</td><td>${ALL7.map((c) => { const s = (cov.producers.reputational_by_category || {})[c]; return s ? `<span class="pill">${esc(c)} — swept ${esc(s.last_swept)} (${esc(s.depth)})</span>` : `<span class="pill oos">${esc(c)} — not searched</span>`; }).join("")}</td></tr>
  <tr><td>Breach check (HIBP)</td><td>${cov.producers.breach ? `checked ${esc(cov.producers.breach.last_checked)} · ${esc(cov.producers.breach.current_findings)} current finding(s)` : '<span class="empty-note">not run</span>'}</td></tr>
  <tr><td>Categories with findings</td><td>${cov.categories_with_findings.length ? cov.categories_with_findings.map((c: string) => `<span class="pill">${esc(c)}</span>`).join("") : '<span class="empty-note">none</span>'}</td></tr>
  <tr><td>Searched via OSINT battery — no current findings</td><td>${cov.categories_swept_empty.length ? `${cov.categories_swept_empty.map((c: string) => `<span class="pill empty">${esc(c)}</span>`).join("")}<div class="prov">Our open-source battery surfaced nothing in these categories. This is NOT a dedicated public-records, court-registry, or financial-database search — those sources are listed under "not covered" below, so read this as "nothing surfaced in open sources", not a cleared records check.</div>` : '<span class="empty-note">none — every dedicated-sweep category has a current finding</span>'}</td></tr>
  ${cov.categories_incidental_only?.length ? `<tr><td>Incidental captures only — no dedicated sweep</td><td>${cov.categories_incidental_only.map((c: string) => `<span class="pill">${esc(c)}</span>`).join("")}<div class="prov">Surfaced in passing by other queries, not deliberately searched — treat as "not assessed", not "clear".</div></td></tr>` : ""}
</table>
<div class="notsearched"><strong>What was NOT searched — the edges of this assessment:</strong>
  ${cov.not_searched.categories_never_swept.length ? `<div>Categories never swept for this subject: ${cov.not_searched.categories_never_swept.map((c: string) => `<span class="pill oos">${esc(c)}</span>`).join("")}</div>` : "<div>All seven exposure categories have been swept at least once.</div>"}
  <div style="margin-top:6px">Sources this method does not cover:</div>
  <ul>${cov.not_searched.sources_not_covered.map((s: string) => `<li>${esc(s)}</li>`).join("")}</ul>
  ${cov.not_searched.family_not_scanned.length ? `<div style="margin-top:6px">Household members not scanned:</div><ul>${cov.not_searched.family_not_scanned.map((f: any) => `<li><strong>${esc(f.name)}</strong> — ${esc(f.reason)}</li>`).join("")}</ul>` : ""}
</div>

${tpMentions.length ? `<div class="print-appendix">
<h2>Appendix A — Mentions (${tpMentions.length})</h2>
<p class="section-intro">Every page where the subject's name appeared WITHOUT a finding attached — included in full so the complete search space is on the record, not silently omitted from the deliverable. URL and capture date for each.</p>
${tpMentions.map(mentionRow).join("")}
</div>` : ""}

<footer>Silent Shield Security · Reputational Exposure Assessment · Confidential. Every finding above carries the source URL and the query that surfaced it — this report is auditable end to end.</footer>
</body></html>`;
}

// Section 6 · Family & Child Safety — authored guidance. Every block that is still DRAFT renders a visible
// DRAFT tag on its face (operator addition 1) so an unreviewed section cannot be delivered unknowingly.
function renderChildSafety(cs: any): string {
  const draftTag = (r: any) => (!r.reviewed_by || /^DRAFT/i.test(r.reviewed_by)) ? `<span class="draft-tag">DRAFT — UNREVIEWED</span>` : "";
  const prov = (r: any) => `<div class="prov">authored/reviewed by ${esc(r.reviewed_by || "—")}${r.last_reviewed_at ? ` · ${esc(String(r.last_reviewed_at).slice(0, 10))}` : ""}</div>`;
  const src = (r: any) => r.content?.source ? `<div class="prov">Source: ${esc(r.content.source)}${r.content?.needs_source ? ` — <strong>primary citation to be confirmed by reviewer</strong>` : ""}</div>` : "";
  const framing = (cs.framing || []).map((r: any) => `<div class="cs-block"><h4>${esc(r.title)}${draftTag(r)}</h4><p>${esc(r.content?.body)}</p>${src(r)}${prov(r)}</div>`).join("");
  const platform = (cs.platforms || []).map((r: any) => `<div class="cs-block"><h4>${esc(r.title)}${draftTag(r)}</h4><p>${esc(r.content?.risk_profile)}</p><div class="cs-sub">Contact patterns to watch</div><ul>${(r.content?.contact_patterns || []).map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul><div class="cs-sub">Settings you can verify</div><ul>${(r.content?.verifiable_settings || []).map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>${prov(r)}</div>`).join("");
  const cross = (cs.cross_platform || []).map((r: any) => `<div class="cs-block"><h4>${esc(r.title)}${draftTag(r)}</h4><p>${esc(r.content?.body)}</p>${prov(r)}</div>`).join("");
  const protocols = (cs.protocols || []).map((r: any) => `<div class="cs-block${r.is_emergency ? " emergency" : ""}"><h4>${r.is_emergency ? "🚨 " : ""}${esc(r.title)}${draftTag(r)}</h4><p>${esc(r.content?.body)}</p>${prov(r)}</div>`).join("");
  const escalation = (cs.escalation || []).map((r: any) => `<div class="cs-block${r.is_emergency ? " emergency" : ""}"><h4>${r.is_emergency ? "🚨 " : ""}${esc(r.content?.org || r.title)}${draftTag(r)}</h4><p><strong>${esc(r.content?.contact)}</strong></p><p>${esc(r.content?.note)}</p>${prov(r)}</div>`).join("");
  return `
<p class="section-intro">Advisory guidance for the household. This section does not scan or analyse any minor — it is authored safety guidance and an assessment of what the principal's own public posts reveal.</p>
${framing}
${platform ? `<h3 style="font-size:15px;margin-top:20px">Platform Inventory &amp; Guidance</h3>${platform}` : (cs.selected_platforms?.length ? "" : `<p class="empty-note">No platforms were specified for the household's children.</p>`)}
${cross ? `<h3 style="font-size:15px;margin-top:20px">Cross-Platform Signals</h3>${cross}` : ""}
${protocols ? `<h3 style="font-size:15px;margin-top:20px">Response Protocols</h3>${protocols}` : ""}
${escalation ? `<h3 style="font-size:15px;margin-top:20px">Where to Get Help</h3>${escalation}` : ""}`;
}
