// generate-subject-exposure-report — the $10k deliverable. Follows the generate-report pattern: build a
// styled PRINT-HTML document (light theme, NOT the app's dark CSS) + persist a `reports` row
// (type='reputational_exposure', issuable=false deny-by-default — nothing leaves until an operator flips it).
// Five sections: (1) Scope & method incl. the DENOMINATOR and what was NOT searched (negative-space
// discipline); (2) third-party exposure ordered by obscurity; (3) self-published; (4) breach w/ recency
// caveat stated plainly; (5) remediation — operator-authored ONLY, never fabricated.
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";

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

    const { data: entity } = await supabase.from("entities").select("id, name, client_id, tenant_id").eq("id", entityId).maybeSingle();
    if (!entity) return errorResponse("entity not found", 404);
    if (!(await authorize(supabase, caller, entity.client_id))) return errorResponse("NOT_AUTHORIZED", 403);
    const { data: client } = entity.client_id ? await supabase.from("clients").select("name").eq("id", entity.client_id).maybeSingle() : { data: null };

    // ── gather: items + locations, latest scan run, family disposition ──
    const { data: items } = await supabase.from("subject_exposure_items")
      .select("id, category, title, summary, severity, source_class, fingerprint, subject_awareness, first_seen_date")
      .eq("subject_entity_id", entityId);
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
      return { ...i, locations: ls, obscurity_rank: ls.length ? Math.min(...ls.map((l) => l.found_at_rank ?? 999)) : 999 };
    });
    const byObscurity = (a: any, b: any) => b.obscurity_rank - a.obscurity_rank;   // buried-first
    const thirdParty = enriched.filter((i: any) => i.source_class !== "self_published" && i.category !== "data_breach").sort(byObscurity);
    const selfPublished = enriched.filter((i: any) => i.source_class === "self_published").sort(byObscurity);
    const breaches = enriched.filter((i: any) => i.category === "data_breach").sort((a, b) => (b.first_seen_date ?? "").localeCompare(a.first_seen_date ?? ""));

    const { data: scan } = await supabase.from("subject_scan_runs").select("id, scope, counts, started_at, finished_at, status")
      .eq("subject_entity_id", entityId).eq("status", "completed").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const scope = scan?.scope ?? {};
    const counts = scan?.counts ?? {};
    const catsScanned: string[] = scope.categories ?? [];
    const catsWithFindings = [...new Set([...thirdParty, ...selfPublished].map((i: any) => i.category))];
    const catsEmpty = catsScanned.filter((c: string) => !catsWithFindings.includes(c));
    const catsOutOfScope = ALL7.filter((c) => !catsScanned.includes(c));

    // family NOT scanned — the edges of coverage, per person, with the reason
    const { data: family } = await supabase.from("entities").select("name, attributes")
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

    const meta = {
      subject: { name: entity.name, entity_id: entityId },
      client: client?.name ?? null,
      generated_at: new Date().toISOString(),
      coverage: {
        scan_id: scan?.id ?? null, depth: scope.depth ?? null,
        queries_run: counts.battery_queries ?? null, phase1_verified: counts.phase1_verified ?? null, phase2_verified: counts.phase2_verified ?? null,
        search_errors: counts.search_errors ?? 0,
        categories_scanned: catsScanned, categories_with_findings: catsWithFindings, categories_empty: catsEmpty,
        not_searched: { categories_out_of_scope: catsOutOfScope, sources_not_covered: SOURCES_NOT_COVERED, family_not_scanned: familyNotScanned },
      },
      counts: { third_party: thirdParty.length, self_published: selfPublished.length, breaches: breaches.length },
      remediation,
    };

    const reportId = crypto.randomUUID();
    const html = renderReport({ meta, thirdParty, selfPublished, breaches, reportId });

    // store the rendered HTML in the private generated-reports bucket
    const path = `reputational-exposure/${entityId}/${reportId}.html`;
    await supabase.storage.from(REPORT_BUCKET).upload(path, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: true });

    const { error: insErr } = await supabase.from("reports").insert({
      id: reportId, type: "reputational_exposure", subject_entity_id: entityId,
      client_id: entity.client_id ?? null, tenant_id: entity.tenant_id ?? null,
      period_start: scan?.started_at ?? new Date().toISOString(), period_end: new Date().toISOString(),
      storage_url: path, issuable: false, rendered_persisted_at: new Date().toISOString(), meta_json: meta,
    });
    if (insErr) return errorResponse(`report persist failed: ${insErr.message}`, 500);

    return successResponse({
      reportId, issuable: false, storage_path: path, bucket: REPORT_BUCKET,
      counts: meta.counts, remediation_authored: remediation.authored,
      note: "Report generated and PERSISTED, issuable=false. It will NOT deliver until an operator sets issuable=true. Remediation is operator-authored only.",
    });
  } catch (e) {
    console.error("[generate-subject-exposure-report] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});

// ── PRINT-HTML renderer — light theme, print-optimised (NOT the app dark CSS). ──
function renderReport({ meta, thirdParty, selfPublished, breaches, reportId }: any): string {
  const cov = meta.coverage;
  const sevBadge = (s: string) => `<span class="sev sev-${esc(s)}">${esc(s || "—")}</span>`;
  const awareness = (a: string) => a ? `<span class="aware aware-${esc(a)}">${a === "unknown" ? "not previously known" : esc(a)}</span>` : "";
  const locList = (ls: any[]) => `<ul class="locs">${ls.map((l) => `<li><a href="${esc(l.url)}">${esc(l.domain || l.url)}</a>${typeof l.found_at_rank === "number" ? ` <span class="rank">rank ${l.found_at_rank}</span>` : ""}<div class="prov">found via <code>${esc(l.found_by_query || "—")}</code>${l.date_captured ? ` · captured ${esc(String(l.date_captured).slice(0, 10))}` : ""}</div></li>`).join("")}</ul>`;
  const itemBlock = (i: any) => `<div class="item"><div class="ihead"><span class="cat">${esc(i.category)}</span>${sevBadge(i.severity)}<span class="buried">${i.obscurity_rank >= 999 ? "" : `buried at rank ${i.obscurity_rank}`}</span>${awareness(i.subject_awareness)}</div><div class="ititle">${esc(i.title)}</div>${i.summary ? `<div class="isum">${esc(i.summary)}</div>` : ""}<div class="lcount">${i.locations.length} source${i.locations.length === 1 ? "" : "s"}:</div>${locList(i.locations)}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Reputational Exposure — ${esc(meta.subject.name)}</title>
<style>
  @page { margin: 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff; line-height: 1.5; max-width: 820px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; margin: 32px 0 12px; }
  .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
  .section-intro { color: #444; font-size: 13px; font-style: italic; margin: 0 0 12px; }
  table.cov { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; } .cov td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; } .cov td:first-child { color: #666; width: 40%; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; background: #eef; margin: 2px 3px 2px 0; }
  .pill.empty { background: #f4f4f4; color: #888; } .pill.oos { background: #fbeaea; color: #a33; }
  .notsearched { background: #fafaf5; border: 1px solid #e8e4d0; border-radius: 6px; padding: 12px 16px; margin: 12px 0; font-size: 13px; }
  .notsearched ul { margin: 6px 0 0; padding-left: 18px; } .notsearched li { margin: 2px 0; }
  .item { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; margin: 10px 0; page-break-inside: avoid; }
  .ihead { font-size: 12px; margin-bottom: 4px; } .cat { text-transform: uppercase; letter-spacing: .04em; color: #666; margin-right: 8px; }
  .ititle { font-weight: bold; font-size: 15px; } .isum { color: #444; font-size: 13px; margin: 4px 0; }
  .lcount { font-size: 12px; color: #666; margin-top: 6px; } ul.locs { margin: 4px 0 0; padding-left: 16px; font-size: 13px; } ul.locs li { margin: 4px 0; }
  ul.locs a { color: #1a4a8a; word-break: break-all; } .prov { color: #888; font-size: 11px; } .prov code { background: #f4f4f4; padding: 0 3px; }
  .rank { color: #999; font-size: 11px; }
  .sev { font-size: 11px; padding: 1px 6px; border-radius: 3px; font-weight: bold; } .sev-critical { background: #7a1f1f; color: #fff; } .sev-high { background: #c0392b; color: #fff; } .sev-medium { background: #e6a817; color: #1a1a1a; } .sev-low { background: #ddd; color: #333; }
  .aware { font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px; } .aware-unknown { background: #c0392b; color: #fff; } .aware-disputed { background: #e6a817; } .aware-known { background: #eee; color: #777; }
  .buried { color: #7a5; font-size: 11px; margin-left: 6px; }
  .caveat { background: #fff8e6; border-left: 3px solid #e6a817; padding: 8px 12px; font-size: 13px; margin: 10px 0; }
  .rem-placeholder { color: #888; font-style: italic; border: 1px dashed #ccc; padding: 16px; border-radius: 6px; }
  .empty-note { color: #888; font-style: italic; font-size: 13px; }
  footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ddd; color: #999; font-size: 11px; }
</style></head><body>
<h1>Reputational Exposure Assessment</h1>
<div class="sub"><strong>${esc(meta.subject.name)}</strong>${meta.client ? ` · prepared for ${esc(meta.client)}` : ""} · generated ${esc(meta.generated_at.slice(0, 10))} · report ${esc(reportId.slice(0, 8))}</div>

<h2>1 · Scope &amp; Method</h2>
<p class="section-intro">What we searched, how much, and — equally — what we did not. A finding is only as meaningful as the space it was found in.</p>
<table class="cov">
  <tr><td>Queries run</td><td>${esc(cov.queries_run ?? "—")} across ${cov.categories_scanned.length} categories (depth: ${esc(cov.depth ?? "—")})</td></tr>
  <tr><td>Results verified</td><td>${esc(cov.phase1_verified ?? "—")} primary + ${esc(cov.phase2_verified ?? "—")} propagation${cov.search_errors ? ` · ${esc(cov.search_errors)} query error(s)` : ""}</td></tr>
  <tr><td>Categories with findings</td><td>${cov.categories_with_findings.length ? cov.categories_with_findings.map((c: string) => `<span class="pill">${esc(c)}</span>`).join("") : '<span class="empty-note">none</span>'}</td></tr>
  <tr><td>Categories searched, empty</td><td>${cov.categories_empty.length ? cov.categories_empty.map((c: string) => `<span class="pill empty">${esc(c)}</span>`).join("") : '<span class="empty-note">none — every searched category returned something</span>'}</td></tr>
</table>
<div class="notsearched"><strong>What was NOT searched — the edges of this assessment:</strong>
  ${cov.not_searched.categories_out_of_scope.length ? `<div>Categories out of scope: ${cov.not_searched.categories_out_of_scope.map((c: string) => `<span class="pill oos">${esc(c)}</span>`).join("")}</div>` : "<div>All seven exposure categories were in scope.</div>"}
  <div style="margin-top:6px">Sources this method does not cover:</div>
  <ul>${cov.not_searched.sources_not_covered.map((s: string) => `<li>${esc(s)}</li>`).join("")}</ul>
  ${cov.not_searched.family_not_scanned.length ? `<div style="margin-top:6px">Household members not scanned:</div><ul>${cov.not_searched.family_not_scanned.map((f: any) => `<li><strong>${esc(f.name)}</strong> — ${esc(f.reason)}</li>`).join("")}</ul>` : ""}
</div>

<h2>2 · Third-Party Exposure</h2>
<p class="section-intro">What is out there about you, written by others — ordered by how buried it is (most obscure first, because what you already see weekly is not the concern).</p>
${thirdParty.length ? thirdParty.map(itemBlock).join("") : '<p class="empty-note">No third-party exposure surfaced in the searched categories.</p>'}

<h2>3 · Self-Published Footprint</h2>
<p class="section-intro">What you publish about yourself — reported separately. This is within your control; it is here for completeness, not as a finding.</p>
${selfPublished.length ? selfPublished.map(itemBlock).join("") : '<p class="empty-note">No self-published accounts surfaced.</p>'}

<h2>4 · Breach Exposure</h2>
<p class="section-intro">Data breaches affecting your personal accounts (Have I Been Pwned).</p>
<div class="caveat"><strong>On severity and age:</strong> severity here reflects the <em>type</em> of data exposed, not the <em>age</em> of the breach. A breach from 2013 and a recent credential-stealer log may both show High. Read the breach date on each — a recent stealer-log finding means a device may have been compromised and credentials may be live, which is materially more urgent than a historical breach whose passwords you have since changed. Differentiated remediation guidance is in development.</div>
${breaches.length ? breaches.map(itemBlock).join("") : '<p class="empty-note">No breaches found for the personal emails checked.</p>'}

<h2>5 · Remediation</h2>
${meta.remediation.authored
    ? `${meta.remediation.summary ? `<p>${esc(meta.remediation.summary)}</p>` : ""}${meta.remediation.items.length ? `<ol>${meta.remediation.items.map((r: any) => `<li><strong>${esc(r.action)}</strong>${r.finding_ref ? ` <span class="rank">(${esc(r.finding_ref)})</span>` : ""}${r.rationale ? `<div class="isum">${esc(r.rationale)}</div>` : ""}</li>`).join("")}</ol>` : ""}<p class="section-intro">Remediation authored by analyst.</p>`
    : `<div class="rem-placeholder">Remediation is authored by your analyst and added before this report is issued. It is never machine-generated. (This copy has not yet been finalized.)</div>`}

<footer>Silent Shield Security · Reputational Exposure Assessment · Confidential. Every finding above carries the source URL and the query that surfaced it — this report is auditable end to end.</footer>
</body></html>`;
}
