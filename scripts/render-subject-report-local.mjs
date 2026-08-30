// LOCAL, READ-ONLY render of generate-subject-exposure-report against real prod rows.
// Reuses the function's exact renderReport() + compareExposureItems() so what you see == what the
// deployed function would produce. Does NOT touch prod: no reports row, no storage upload. Legal
// category is already excluded in the source query (WO-LEGAL-FABRICATION-CONTAIN). Input = the saved
// MCP result file (unwrapped). Output = a standalone HTML file to open in a browser.
import fs from "node:fs";

const RESULT_FILE = process.argv[2];
const OUT = process.argv[3] || "/tmp/subject-exposure-report-preview.html";
const FORMAT = (process.argv[4] || "reputational").toLowerCase();   // reputational | executive

// ── load render_input: accept either a plain render_input JSON object, or the raw saved MCP result ──
const rawFile = fs.readFileSync(RESULT_FILE, "utf8");
const parsed = JSON.parse(rawFile);
let input;
if (parsed && Array.isArray(parsed.items)) {
  input = parsed;                                             // plain render_input object
} else {
  const txt = parsed.result;
  const start = txt.indexOf('[{"render_input"');
  const end = txt.lastIndexOf("}]") + 2;
  input = JSON.parse(JSON.parse(txt.slice(start, end))[0].render_input);
}

// ── verbatim from _shared/subject-retrieval.ts ──
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
// Authorship weighting: third-party content ABOUT the subject is the real exposure; self-published is
// within the subject's control (context). Third-party ranks above self-published (lower number = first).
const SRC_RANK = { third_party: 0, self_published: 1 };
function compareExposureItems(a, b) {
  return (Number(b.is_finding ?? false) - Number(a.is_finding ?? false))
    || ((SRC_RANK[a.source_class ?? "third_party"] ?? 0) - (SRC_RANK[b.source_class ?? "third_party"] ?? 0))
    || ((SEV_RANK[b.severity ?? ""] ?? 0) - (SEV_RANK[a.severity ?? ""] ?? 0))
    || ((b.location_count ?? 0) - (a.location_count ?? 0))
    || ((b.obscurity_rank ?? 0) - (a.obscurity_rank ?? 0));
}

// ── verbatim from generate-subject-exposure-report/index.ts ──
const ALL7 = ["legal", "financial", "professional", "media", "social", "corporate", "property"];
const SOURCES_NOT_COVERED = [
  "Credentialed dark-web forums and marketplaces (access-restricted)",
  "Private or locked social-media accounts",
  "Paywalled public-records databases not integrated with this scan",
  "Non-indexed deep-web content and login-walled pages",
  "Real-time or ephemeral content (stories, disappearing posts) outside the capture window",
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── gather/enrich/meta — mirrors the function body (fixtures instead of supabase calls) ──
const entity = input.entity;
const client = input.client;
const items = input.items ?? [];        // legal-excluded + superseded-excluded in the source query
const locs = input.locations ?? [];
const byItem = new Map();
for (const l of locs) { if (!byItem.has(l.exposure_item_id)) byItem.set(l.exposure_item_id, []); byItem.get(l.exposure_item_id).push(l); }
const enriched = items.map((i) => {
  const ls = (byItem.get(i.id) ?? []).sort((a, b) => (a.found_at_rank ?? 999) - (b.found_at_rank ?? 999));
  return { ...i, locations: ls, location_count: ls.length, obscurity_rank: ls.length ? Math.min(...ls.map((l) => l.found_at_rank ?? 999)) : 999 };
});
// ── Identity-anchor gate + THREE-BUCKET classification (2026-08-29 rework) ──
// finding = anchored AND adverse · verified_presence = anchored (corroborated) AND neutral · noise = unanchored.
// Anchors: email(owned) · coordinate(declared) · data_broker · source_corroboration(>=2 independent domains)
//          [· profile_url · device when intake lands]. Broker domains match EXACT eTLD+1, NEVER substring.
const BROKER_DOMAINS = ["rocketreach.co","zoominfo.com","spokeo.com","beenverified.com","whitepages.com","intelius.com","radaris.com","mylife.com","peoplefinder.com","truepeoplesearch.com","fastpeoplesearch.com","apollo.io","lusha.com","contactout.com","signalhire.com","nuwber.com","clustrmaps.com","thatsthem.com"];
const host1 = (h) => String(h || "").toLowerCase().replace(/^www\./, "");
const isBrokerDomain = (h) => { const x = host1(h); return BROKER_DOMAINS.some((d) => x === d || x.endsWith("." + d)); };
const ADVERSE_CATS = new Set(["data_breach", "environmental", "legal", "financial", "professional", "media"]);
const CORROBORATION_MIN_DOMAINS = 2;
for (const i of enriched) {
  // Environmental findings are coordinate-anchored; their SOURCE is the live hazard feed. Attach it so the
  // footer's "every finding carries a source URL" is TRUE (was rendering 0 sources — a false claim).
  if (i.category === "environmental" && (!i.locations || i.locations.length === 0)) {
    const hz = String(i.title || "").split(" · ")[1]?.split(":")[0]?.trim().toLowerCase() || "";
    const FEED = hz.includes("wildfire") ? { domain: "CWFIS / BC Wildfire Service", url: "https://cwfis.cfs.nrcan.gc.ca/" }
      : hz.includes("air") ? { domain: "Environment Canada — AQHI", url: "https://weather.gc.ca/airquality/forecast/current/" }
      : hz.includes("road") ? { domain: "DriveBC", url: "https://www.drivebc.ca/" }
      : hz.includes("avalanche") ? { domain: "Avalanche Canada", url: "https://avalanche.ca/" }
      : { domain: "Environment Canada — Weather", url: "https://weather.gc.ca/" };
    i.locations = [{ url: FEED.url, domain: FEED.domain, found_by_query: "live hazard feed", found_at_rank: 1 }];
    i.location_count = 1; i.obscurity_rank = 1;
  }
  // Full-email fix: capture the whole account list, not up to the first period (".com" was truncating it).
  if (i.category === "data_breach" && typeof i.summary === "string") {
    const m = i.summary.match(/Affected account\(s\):\s*(.+?)\.\s*Breach/i);
    if (m) { i.anchor_type = "email"; i.anchor_value = m[1].trim(); }
  }
  const domains = [...new Set((i.locations || []).map((l) => host1(l.domain)).filter(Boolean))];
  const brokerHits = domains.filter(isBrokerDomain);
  const corroborated = domains.length >= CORROBORATION_MIN_DOMAINS;
  if (!(i.anchor_type && i.anchor_value)) {
    if (brokerHits.length) { i.anchor_type = "data_broker"; i.anchor_value = brokerHits.join(", "); }
    else if (corroborated) { i.anchor_type = "source_corroboration"; i.anchor_value = domains.join(", "); }
  }
  const anchored = !!(i.anchor_type && i.anchor_value);
  const adverse = ADVERSE_CATS.has(i.category) || brokerHits.length > 0;
  i.exposure_class = !anchored ? "noise" : (adverse ? "finding" : "verified_presence");
  i.is_finding = i.exposure_class === "finding";
  i.corroboration_domains = domains.length;
}
const thirdParty = enriched.filter((i) => i.category !== "data_breach" && i.exposure_class === "finding").sort(compareExposureItems);
const verifiedPresence = enriched.filter((i) => i.exposure_class === "verified_presence").sort((a, b) => (b.corroboration_domains ?? 0) - (a.corroboration_domains ?? 0));
const noise = enriched.filter((i) => i.category !== "data_breach" && i.exposure_class === "noise").sort(compareExposureItems);
const selfPublished = [];   // folded into the three buckets; unverified name-matches are noise, not "yours"
const breaches = enriched.filter((i) => i.category === "data_breach").sort((a, b) => (b.first_seen_date ?? "").localeCompare(a.first_seen_date ?? ""));
const runsArr = input.runs ?? [];
const dstr = (r) => (r?.finished_at || r?.started_at || "").slice(0, 10);
const categorySweeps = {};
for (const cat of ALL7) {
  const run = runsArr.find((r) => (r.scope?.categories || []).includes(cat));
  categorySweeps[cat] = run ? { last_swept: dstr(run), depth: run.scope?.depth ?? "—", queries: run.counts?.battery_queries ?? null } : null;
}
// Coverage-contradiction fix: a category with captured items WAS searched — never render "not searched"
// next to captures in that category (page one was claiming legal not-searched beside legal captures).
// A category is "searched" if items classified into it OR if the query battery ran terms for it —
// the financial/professional/corporate/property QUERIES ran (director, bankruptcy, lien, mortgage…) but
// their results classified as generic 'mention', so keying only on item category missed them.
const QUERY_TERM_CAT = [
  ["financial", /\b(bankrupt\w*|insolvenc\w*|lien|creditor|foreclos\w*|receivership|garnish\w*)\b/i],
  ["professional", /\b(director|officer|founder|shareholder|disciplinary|licen[cs]e|misconduct)\b/i],
  ["corporate", /\b(incorporat\w*|registered company|corporate registry|registrar of companies)\b/i],
  ["property", /\b(propert\w*|real estate|deed|title search|mortgage|parcel|assessment roll)\b/i],
  ["legal", /\b(lawsuit|sued|litigation|judgment|plaintiff|defendant|court)\b/i],
];
const capByCat = {};
const touchCat = (cat, dstr) => { if (!dstr || !ALL7.includes(cat)) return; const d = String(dstr).slice(0, 10); if (!capByCat[cat] || capByCat[cat] < d) capByCat[cat] = d; };
for (const i of enriched) {
  touchCat(i.category, i.first_seen_date);
  for (const l of (i.locations || [])) {
    touchCat(i.category, l.date_captured);
    const q = String(l.found_by_query || "");
    for (const [cat, re] of QUERY_TERM_CAT) if (re.test(q)) touchCat(cat, l.date_captured || i.first_seen_date);
  }
}
for (const cat of ALL7) {
  if (!categorySweeps[cat] && capByCat[cat]) categorySweeps[cat] = { last_swept: capByCat[cat], depth: "captures on file — no dedicated sweep record", queries: null };
}
const catsSwept = ALL7.filter((c) => categorySweeps[c]);
const catsWithFindings = [...new Set([...thirdParty, ...breaches, ...verifiedPresence].map((i) => i.category))];
// Coverage-contradiction fix: a category with ANY captured item WAS searched — never claim "not searched"
// while findings/captures exist in it (page one was saying legal not-searched next to legal captures).
const catsWithAnyCapture = new Set(enriched.map((i) => i.category));
const catsNeverSwept = ALL7.filter((c) => !categorySweeps[c] && !catsWithAnyCapture.has(c));
const catsEmpty = catsSwept.filter((c) => !catsWithFindings.includes(c));
const breachDates = breaches.flatMap((b) => (b.locations || []).map((l) => l.date_captured)).filter(Boolean).sort();
const breachLastChecked = breachDates.length ? String(breachDates[breachDates.length - 1]).slice(0, 10) : null;
const familyNotScanned = (input.family ?? []).map((f) => {
  const a = f.attributes ?? {};
  const reason = a.is_minor === true ? "excluded — minor (under 18)"
    : a.is_minor === null || a.is_minor === undefined ? "not scanned — date of birth not provided (cannot confirm adult)"
    : a.scan_consent?.granted !== true ? "not scanned — no personal consent on file"
    : "scanned separately";
  return { name: f.name, reason };
}).filter((f) => f.reason !== "scanned separately");
const remediation = { authored: false, summary: "", items: [] };
const childSafety = null;   // no child_platforms / body flag in this preview

const meta = {
  subject: { name: entity.name, entity_id: entity.id },
  client: client?.name ?? null,
  generated_at: new Date().toISOString(),
  child_safety: { included: false },
  coverage: {
    producers: {
      reputational_by_category: categorySweeps,
      breach: breachLastChecked ? { last_checked: breachLastChecked, current_findings: breaches.length } : null,
    },
    categories_with_findings: catsWithFindings, categories_swept_empty: catsEmpty,
    not_searched: { categories_never_swept: catsNeverSwept, sources_not_covered: SOURCES_NOT_COVERED, family_not_scanned: familyNotScanned },
  },
  counts: { third_party: thirdParty.length, self_published: selfPublished.length, breaches: breaches.length },
  remediation,
};
const reportId = "preview0-0000-0000-0000-000000000000";
const html = FORMAT === "executive"
  ? renderExecutive({ meta, thirdParty, selfPublished, breaches })
  : renderReport({ meta, thirdParty, verifiedPresence, noise, breaches, reportId, childSafety });
fs.writeFileSync(OUT, html);

console.log("format:", FORMAT);
console.log("wrote:", OUT, "(" + html.length + " bytes)");
console.log("buckets:", JSON.stringify({
  adverse_findings: thirdParty.length + breaches.length,
  "  breach": breaches.length, "  environmental+broker+legal": thirdParty.length,
  verified_public_presence: verifiedPresence.length,
  noise_volume: noise.length,
}));

// ── renderReport + renderChildSafety — copied verbatim from the edge function ──
function renderReport({ meta, thirdParty, verifiedPresence, noise, breaches, reportId, childSafety }) {
  const cov = meta.coverage;
  const sevBadge = (s) => `<span class="sev sev-${esc(s)}">${esc(s || "—")}</span>`;
  const awareness = (a) => a ? `<span class="aware aware-${esc(a)}">${a === "unknown" ? "not previously known" : esc(a)}</span>` : "";
  const locList = (ls) => `<ul class="locs">${ls.map((l) => `<li><a href="${esc(l.url)}">${esc(l.domain || l.url)}</a>${typeof l.found_at_rank === "number" ? ` <span class="rank">rank ${l.found_at_rank}</span>` : ""}<div class="prov">found via <code>${esc(l.found_by_query || "—")}</code>${l.date_captured ? ` · captured ${esc(String(l.date_captured).slice(0, 10))}` : ""}</div></li>`).join("")}</ul>`;
  const ANCHOR_LABEL = { email: "email", coordinate: "coordinate", profile_url: "profile URL", device: "device" };
  const anchorLine = (i) => i.anchor_type && i.anchor_value
    ? `<div class="anchor"><span class="alabel">Tied to</span> <span class="aval">${esc(i.anchor_value)}</span> <span class="atype">${esc(ANCHOR_LABEL[i.anchor_type] || i.anchor_type)}</span></div>`
    : "";
  const itemBlock = (i) => `<div class="item"><div class="ihead"><span class="cat">${esc(i.category)}</span>${sevBadge(i.severity)}<span class="buried">${i.obscurity_rank >= 999 ? "" : `buried at rank ${i.obscurity_rank}`}</span>${awareness(i.subject_awareness)}</div><div class="ititle">${esc(i.title)}</div>${anchorLine(i)}${i.summary ? `<div class="isum">${esc(i.summary)}</div>` : ""}<div class="lcount">${(() => { const dd = new Set((i.locations || []).map((l) => l.domain).filter(Boolean)).size; const cc = i.locations.length; return `${dd} independent domain${dd === 1 ? "" : "s"}${cc !== dd ? ` · ${cc} capture${cc === 1 ? "" : "s"}` : ""}`; })()}:</div>${locList(i.locations)}</div>`;
  const tpFindings = thirdParty || [];              // adverse + anchored (environmental / legal / broker)
  const tpMentions = noise || [];                   // single-source name-matches — volume, not findings
  const presence = verifiedPresence || [];          // corroborated (>=2 domains) but neutral — confirmed footprint
  const mentionRow = (m) => `<div class="mention-row"><span class="cat">${esc(m.category)}</span> ${esc(m.title)} — ${(m.locations || []).map((l) => `<a href="${esc(l.url)}">${esc(l.domain || l.url)}</a>${l.date_captured ? ` <span class="rank">(captured ${esc(String(l.date_captured).slice(0, 10))})</span>` : ""}`).join(", ")}</div>`;

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
  .anchor { font-size: 12px; margin: 4px 0; padding: 3px 8px; background: #eef5ee; border-left: 3px solid #3a7d3a; border-radius: 3px; display: inline-block; }
  .anchor .alabel { color: #3a7d3a; font-weight: bold; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .anchor .aval { font-family: ui-monospace, Menlo, monospace; color: #1a1a1a; }
  .anchor .atype { color: #777; font-size: 11px; } .anchor .atype:before { content: "· "; }
  .lcount { font-size: 12px; color: #666; margin-top: 6px; } ul.locs { margin: 4px 0 0; padding-left: 16px; font-size: 13px; } ul.locs li { margin: 4px 0; }
  ul.locs a { color: #1a4a8a; word-break: break-all; } .prov { color: #888; font-size: 11px; } .prov code { background: #f4f4f4; padding: 0 3px; }
  .rank { color: #999; font-size: 11px; }
  .sev { font-size: 11px; padding: 1px 6px; border-radius: 3px; font-weight: bold; } .sev-critical { background: #7a1f1f; color: #fff; } .sev-high { background: #c0392b; color: #fff; } .sev-medium { background: #e6a817; color: #1a1a1a; } .sev-low { background: #ddd; color: #333; }
  .aware { font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px; } .aware-unknown { background: #c0392b; color: #fff; } .aware-disputed { background: #e6a817; } .aware-known { background: #eee; color: #777; }
  .buried { color: #7a5; font-size: 11px; margin-left: 6px; }
  .caveat { background: #fff8e6; border-left: 3px solid #e6a817; padding: 8px 12px; font-size: 13px; margin: 10px 0; }
  .rem-placeholder { color: #888; font-style: italic; border: 1px dashed #ccc; padding: 16px; border-radius: 6px; }
  .empty-note { color: #888; font-style: italic; font-size: 13px; }
  .mentions { margin: 14px 0; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 14px; background: #fafafa; }
  .mentions summary { cursor: pointer; font-size: 13px; color: #444; }
  .mention-row { font-size: 12px; color: #555; padding: 4px 0; border-top: 1px solid #eee; margin-top: 6px; word-break: break-word; }
  .mention-row .cat { text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: #999; margin-right: 5px; }
  .mention-row a { color: #1a4a8a; }
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
${childSafety?.contains_draft ? `<div class="draft-banner">⚠ DRAFT — this report contains family &amp; child-safety guidance (Section 6) that has NOT been reviewed or signed by a child-safety professional. It must not be delivered to a client in this state.</div>` : ""}

<h2>1 · Scope &amp; Method</h2>
<p class="section-intro">What we searched, when, and — equally — what we did not. A finding is only as meaningful as the space it was found in; and "searched" is only meaningful with a date. Each producer below is dated on its own last sweep.</p>
<table class="cov">
  <tr><td>Reputational sweep — by category</td><td>${ALL7.map((c) => { const s = (cov.producers.reputational_by_category || {})[c]; return s ? `<span class="pill">${esc(c)} — swept ${esc(s.last_swept)} (${esc(s.depth)})</span>` : `<span class="pill oos">${esc(c)} — not searched</span>`; }).join("")}</td></tr>
  <tr><td>Breach check (HIBP)</td><td>${cov.producers.breach ? `checked ${esc(cov.producers.breach.last_checked)} · ${esc(cov.producers.breach.current_findings)} current finding(s)` : '<span class="empty-note">not run</span>'}</td></tr>
  <tr><td>Categories with findings</td><td>${cov.categories_with_findings.length ? cov.categories_with_findings.map((c) => `<span class="pill">${esc(c)}</span>`).join("") : '<span class="empty-note">none</span>'}</td></tr>
  <tr><td>Categories swept, no current findings</td><td>${cov.categories_swept_empty.length ? cov.categories_swept_empty.map((c) => `<span class="pill empty">${esc(c)}</span>`).join("") : '<span class="empty-note">none — every swept category has a current finding</span>'}</td></tr>
</table>
<div class="notsearched"><strong>What was NOT searched — the edges of this assessment:</strong>
  ${cov.not_searched.categories_never_swept.length ? `<div>Categories never swept for this subject: ${cov.not_searched.categories_never_swept.map((c) => `<span class="pill oos">${esc(c)}</span>`).join("")}</div>` : "<div>All seven exposure categories have been swept at least once.</div>"}
  <div style="margin-top:6px">Sources this method does not cover:</div>
  <ul>${cov.not_searched.sources_not_covered.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
  ${cov.not_searched.family_not_scanned.length ? `<div style="margin-top:6px">Household members not scanned:</div><ul>${cov.not_searched.family_not_scanned.map((f) => `<li><strong>${esc(f.name)}</strong> — ${esc(f.reason)}</li>`).join("")}</ul>` : ""}
</div>

<h2>2 · Third-Party Exposure</h2>
<p class="section-intro">What is out there about you, written by others — real findings first (highest-consequence first). Bare mentions of your name that carry no finding are counted and collapsed below, so you can see the volume without the report implying they are problems.</p>
${tpFindings.length ? tpFindings.map(itemBlock).join("") : '<p class="empty-note">No third-party FINDINGS (a finding is a legal matter, breach, or documented event — not a bare mention).</p>'}
${tpMentions.length ? `<details class="mentions screen-collapse"><summary><strong>Also found — ${tpMentions.length} mention${tpMentions.length === 1 ? "" : "s"} of your name with no finding attached.</strong> Pages where your name appears without a legal matter, breach, or event — expand to review.</summary>${tpMentions.map(mentionRow).join("")}</details>
<p class="print-ptr"><strong>Also found — ${tpMentions.length} mention${tpMentions.length === 1 ? "" : "s"} of your name with no finding attached</strong> — pages where your name appears without a legal matter, breach, or event. Listed in full at <strong>Appendix A</strong>.</p>` : ""}

<h2>3 · Verified Public Presence</h2>
<p class="section-intro">Content about you confirmed by two or more independent sources but NOT adverse — your genuine public footprint (press, profiles, appearances). Not exposure, and not called such; but it is what an adversary assembles a picture from, so it is on the record. Distinct from the single-source name-matches in the volume below, whose attribution is unverified.</p>
${presence.length ? presence.map(itemBlock).join("") : '<p class="empty-note">No corroborated public presence surfaced (nothing confirmed by 2+ independent sources).</p>'}

<h2>4 · Breach Exposure</h2>
<p class="section-intro">Data breaches affecting your personal accounts (Have I Been Pwned).</p>
<div class="caveat"><strong>On severity and age:</strong> severity here reflects the <em>type</em> of data exposed, not the <em>age</em> of the breach. A breach from 2013 and a recent credential-stealer log may both show High. Read the breach date on each — a recent stealer-log finding means a device may have been compromised and credentials may be live, which is materially more urgent than a historical breach whose passwords you have since changed. Differentiated remediation guidance is in development.</div>
${breaches.length ? breaches.map(itemBlock).join("") : '<p class="empty-note">No breaches found for the personal emails checked.</p>'}

<h2>5 · Remediation</h2>
${meta.remediation.authored
    ? `${meta.remediation.summary ? `<p>${esc(meta.remediation.summary)}</p>` : ""}${meta.remediation.items.length ? `<ol>${meta.remediation.items.map((r) => `<li><strong>${esc(r.action)}</strong>${r.finding_ref ? ` <span class="rank">(${esc(r.finding_ref)})</span>` : ""}${r.rationale ? `<div class="isum">${esc(r.rationale)}</div>` : ""}</li>`).join("")}</ol>` : ""}<p class="section-intro">Remediation authored by analyst.</p>`
    : `<div class="rem-placeholder"><strong>Pending analyst review.</strong> Remediation for this assessment is authored by your analyst and added before the report is issued — it is never machine-generated.</div>`}

${childSafety ? renderChildSafety(childSafety) : ""}

${tpMentions.length ? `<div class="print-appendix">
<h2>Appendix A — Mentions (${tpMentions.length})</h2>
<p class="section-intro">Every page where the subject's name appeared WITHOUT a finding attached — included in full so the complete search space is on the record, not silently omitted from the deliverable. URL and capture date for each.</p>
${tpMentions.map(mentionRow).join("")}
</div>` : ""}

<footer>Silent Shield Security · Reputational Exposure Assessment · Confidential. Every finding above carries the source URL and the query that surfaced it — this report is auditable end to end.</footer>
</body></html>`;
}

function renderChildSafety() { return ""; }   // not exercised in this preview

// ── EXECUTIVE-BRIEF format — the exposure data presented in generate-executive-report's branded
// layout (SENSITIVE header / Fortress AI / Executive Flash / meta-grid / .section-title sections).
// Anti-fabrication discipline (render-only-provable): every value is code-derived. NO invented
// Executive Flash narrative, NO invented risk ratings, NO machine-authored remediation, and the
// name-mentions block is framed as unverified volume, never as findings.
function renderExecutive({ meta, thirdParty, selfPublished, breaches }) {
  const name = meta.subject.name;
  const genDate = meta.generated_at.slice(0, 10);
  const cov = meta.coverage;
  const tpMentions = (thirdParty || []).filter((i) => !i.is_finding);
  const tpFindings = (thirdParty || []).filter((i) => i.is_finding);
  const highCrit = (breaches || []).filter((b) => b.severity === "high" || b.severity === "critical").length;
  const ALL7 = ["legal", "financial", "professional", "media", "social", "corporate", "property"];
  const catsSwept = ALL7.filter((c) => (cov.producers.reputational_by_category || {})[c]);
  const breachRow = (b) => {
    const loc = (b.locations || [])[0] || {};
    const when = b.first_seen_date ? String(b.first_seen_date).slice(0, 10) : (loc.date_captured ? String(loc.date_captured).slice(0, 10) : "—");
    return `<tr><td><strong>${esc(String(b.title).replace(/^Data breach:\s*/i, ""))}</strong></td><td><span class="risk-level">${esc(b.severity || "—")}</span></td><td style="font-family:monospace;font-size:8pt">${esc(when)}</td><td style="font-size:8pt;color:#555">${esc(loc.domain || "haveibeenpwned.com")}</td></tr>`;
  };
  const spRow = (i) => `<div class="action-item"><div class="action-description" style="font-weight:600;font-size:9.5pt">${esc(i.title)}</div><div class="action-meta" style="grid-template-columns:repeat(2,1fr)"><div><div class="action-meta-label">Category</div><div class="action-meta-value">${esc(i.category)}</div></div><div><div class="action-meta-label">Sources</div><div class="action-meta-value">${(i.locations || []).length}</div></div></div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reputational Exposure Brief - ${esc(name)}</title>
<style>
    @page { margin: 1in 0.9in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Georgia', 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.6; color: #111; background: white; max-width: 860px; margin: 0 auto; }
    .header { border-bottom: 1px solid #111; padding-bottom: 10pt; margin-bottom: 18pt; }
    .header-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8pt; }
    .classification { font-family: 'Arial', sans-serif; font-size: 8pt; font-weight: 700; letter-spacing: 1.5pt; text-transform: uppercase; color: #111; border: 1px solid #111; padding: 2pt 8pt; }
    .report-date { font-family: 'Arial', sans-serif; font-size: 9pt; color: #555; }
    .logo-area { text-align: center; margin-bottom: 4pt; }
    .company-name { font-family: 'Arial', sans-serif; font-size: 16pt; font-weight: 700; color: #111; letter-spacing: 2pt; text-transform: uppercase; margin-bottom: 3pt; }
    .report-title { font-family: 'Arial', sans-serif; font-size: 11pt; color: #333; }
    .executive-flash { border: 1px solid #111; padding: 16pt; margin: 18pt 0; }
    .flash-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ccc; padding-bottom: 6pt; margin-bottom: 10pt; }
    .flash-title { font-family: 'Arial', sans-serif; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5pt; }
    .flash-confidence { font-family: 'Arial', sans-serif; font-size: 8pt; color: #555; }
    .flash-issue { font-size: 12pt; font-weight: bold; margin-bottom: 10pt; line-height: 1.4; }
    .flash-action { border-left: 3pt solid #111; padding-left: 10pt; margin-bottom: 10pt; }
    .flash-action-label { font-family: 'Arial', sans-serif; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; color: #555; margin-bottom: 3pt; }
    .flash-action-text { font-size: 10.5pt; }
    .flash-meta { display: flex; gap: 24pt; font-family: 'Arial', sans-serif; font-size: 8.5pt; color: #333; border-top: 1px solid #ccc; padding-top: 8pt; margin-top: 8pt; flex-wrap: wrap; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin-bottom: 22pt; border: 1px solid #ccc; }
    .meta-item { font-family: 'Arial', sans-serif; font-size: 8.5pt; padding: 8pt 10pt; border-right: 1px solid #ccc; border-bottom: 1px solid #ccc; }
    .meta-label { text-transform: uppercase; font-weight: 700; color: #666; font-size: 7.5pt; letter-spacing: 0.5pt; margin-bottom: 2pt; }
    .meta-value { color: #111; font-weight: 600; }
    .section { margin-bottom: 26pt; }
    .section-title { font-family: 'Arial', sans-serif; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; color: #111; margin-bottom: 10pt; padding-bottom: 4pt; border-bottom: 1px solid #111; }
    .executive-summary { border-left: 3pt solid #111; padding-left: 14pt; margin: 12pt 0; font-size: 10.5pt; line-height: 1.7; }
    .risk-table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 9.5pt; font-family: 'Arial', sans-serif; }
    .risk-table th { border-bottom: 2px solid #111; border-top: 1px solid #111; padding: 6pt 8pt; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.5pt; background: white; color: #111; }
    .risk-table td { padding: 6pt 8pt; border-bottom: 1px solid #ddd; vertical-align: top; }
    .risk-table tbody tr:nth-child(even) { background: #f9f9f9; }
    .risk-level { font-weight: 700; font-size: 9pt; text-transform: uppercase; color: #111; }
    .action-item { border-top: 1px solid #ddd; padding-top: 10pt; margin-bottom: 12pt; }
    .action-item:first-child { border-top: none; }
    .action-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; font-family: 'Arial', sans-serif; font-size: 8.5pt; }
    .action-meta-label { font-weight: 700; color: #555; text-transform: uppercase; font-size: 7.5pt; margin-bottom: 1pt; }
    .action-meta-value { color: #111; }
    .caveat-box { border-left: 3pt solid #7a5c00; background: #fff8e1; padding: 10pt 14pt; margin: 12pt 0; font-family: 'Arial', sans-serif; font-size: 9pt; color: #5a4500; }
    .notsearched { border: 1px solid #ccc; padding: 10pt 14pt; margin: 12pt 0; font-family: 'Arial', sans-serif; font-size: 8.5pt; }
    .notsearched ul { margin: 4pt 0 0 16pt; } .notsearched li { margin: 2pt 0; }
    .pill { display: inline-block; padding: 1pt 8pt; border: 1px solid #ccc; border-radius: 10px; font-size: 8pt; margin: 2pt 3pt 2pt 0; }
    .footer { text-align: center; font-family: 'Arial', sans-serif; font-size: 7.5pt; color: #888; padding: 10pt 0; border-top: 1px solid #ccc; margin-top: 24pt; }
    @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } @page { margin: 1.2cm 1.8cm; size: A4; } }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div class="classification">SENSITIVE SECURITY INFORMATION</div>
      <div class="report-date">${esc(genDate)}</div>
    </div>
    <div class="logo-area">
      <div class="company-name">Fortress AI</div>
      <div class="report-title">${esc(name)} – Reputational Exposure Brief</div>
    </div>
  </div>

  <div class="executive-flash">
    <div class="flash-header">
      <div class="flash-title">Executive Flash</div>
      <div class="flash-confidence">Basis: deterministic sources only (LLM-classified categories excluded)</div>
    </div>
    <div class="flash-issue">${breaches.length} verified data breach${breaches.length === 1 ? "" : "es"} expose your personal accounts — ${highCrit} rated high or critical. This is the only exposure category with verified findings.</div>
    <div class="flash-action">
      <div class="flash-action-label">Recommended Action</div>
      <div class="flash-action-text">Remediation for this assessment is authored by your analyst before the report is issued — it is never machine-generated. Pending analyst review.</div>
    </div>
    <div class="flash-meta">
      <div class="flash-meta-item"><strong>Subject:</strong> ${esc(name)}</div>
      <div class="flash-meta-item"><strong>Breach severity:</strong> ${highCrit}/${breaches.length} high–critical</div>
      <div class="flash-meta-item"><strong>Third-party findings:</strong> ${tpFindings.length}</div>
      <div class="flash-meta-item"><strong>Generated:</strong> ${esc(genDate)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Subject</div><div class="meta-value">${esc(name)}</div></div>
    <div class="meta-item"><div class="meta-label">Report Generated</div><div class="meta-value">${esc(genDate)}</div></div>
    <div class="meta-item"><div class="meta-label">Verified Breaches</div><div class="meta-value">${breaches.length} (${highCrit} high/crit)</div></div>
    <div class="meta-item"><div class="meta-label">Self-Published Items</div><div class="meta-value">${selfPublished.length}</div></div>
    <div class="meta-item"><div class="meta-label">Name-Mentions (unverified)</div><div class="meta-value">${tpMentions.length}</div></div>
    <div class="meta-item"><div class="meta-label">Categories Swept</div><div class="meta-value">${catsSwept.length} / 7</div></div>
  </div>

  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <div class="executive-summary">
      <p style="margin-bottom:10pt">This assessment for ${esc(name)} draws on ${catsSwept.length} of 7 reputational categories plus a breach check. Only one category carries <strong>verified findings</strong>: data breach, from Have I Been Pwned — ${breaches.length} breaches, ${highCrit} rated high or critical. All breach entries are deterministic, structured-source lookups.</p>
      <p style="margin-bottom:10pt">${selfPublished.length} items are your own self-published content (reported for completeness, within your control — not findings). ${tpFindings.length} third-party findings were confirmed.</p>
      <p style="margin-bottom:0">A further ${tpMentions.length} name-mentions were surfaced. These are presented as <strong>volume only, not findings</strong>: their attribution is unverified and a substantial share do not refer to this subject. They must not be read as exposure until the mention-attribution layer is rebuilt.</p>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Breach Exposure — Verified (HIBP)</h2>
    <p style="font-family:Arial,sans-serif;font-size:9pt;margin-bottom:8pt;color:#333">${breaches.length} data breaches affecting personal accounts. Severity reflects the <em>type</em> of data exposed, not the breach's age.</p>
    ${breaches.length ? `<table class="risk-table"><thead><tr><th>Breach</th><th style="width:70pt">Severity</th><th style="width:80pt">First Seen</th><th style="width:150pt">Source</th></tr></thead><tbody>${breaches.map(breachRow).join("")}</tbody></table>` : '<p style="font-style:italic;color:#888">No breaches found for the personal emails checked.</p>'}
  </div>

  <div class="section">
    <h2 class="section-title">Self-Published Footprint</h2>
    <p style="font-family:Arial,sans-serif;font-size:9pt;margin-bottom:8pt;color:#333">${selfPublished.length} items you publish about yourself — within your control, listed for completeness, not as findings.</p>
    ${selfPublished.slice(0, 12).map(spRow).join("")}
    ${selfPublished.length > 12 ? `<p style="font-size:8.5pt;color:#888;font-family:Arial,sans-serif;margin-top:6pt">+ ${selfPublished.length - 12} more self-published items.</p>` : ""}
  </div>

  <div class="section">
    <h2 class="section-title">Name-Mentions — Unverified Volume</h2>
    <div class="caveat-box"><strong>${tpMentions.length} pages mention a matching name, but attribution is UNVERIFIED.</strong> A substantial share do not refer to this subject (other people of the same/similar name, generic content, and search-pagination artifacts). This block is a <strong>volume count only</strong> — it is deliberately NOT itemised as findings, and no risk rating derives from it. The mention-attribution layer is under rebuild; until then these are not client-deliverable as exposure.</div>
  </div>

  <div class="section">
    <h2 class="section-title">Coverage &amp; Method</h2>
    <div class="notsearched">
      <div><strong>Categories swept:</strong> ${ALL7.map((c) => { const s = (cov.producers.reputational_by_category || {})[c]; return s ? `<span class="pill">${esc(c)} — ${esc(s.last_swept)}</span>` : `<span class="pill" style="border-color:#c99;color:#a33">${esc(c)} — not searched</span>`; }).join("")}</div>
      <div style="margin-top:8pt"><strong>Not covered by this method:</strong></div>
      <ul>${cov.not_searched.sources_not_covered.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      ${cov.not_searched.family_not_scanned.length ? `<div style="margin-top:6pt"><strong>Household members not scanned:</strong></div><ul>${cov.not_searched.family_not_scanned.map((f) => `<li>${esc(f.name)} — ${esc(f.reason)}</li>`).join("")}</ul>` : ""}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Remediation</h2>
    <div class="caveat-box" style="border-left-color:#111;background:#f7f7f7;color:#333"><strong>Pending analyst review.</strong> Remediation is authored by your analyst and added before the report is issued — it is never machine-generated.</div>
  </div>

  <div class="footer">Silent Shield Security · Reputational Exposure Brief · Confidential · Every breach entry is a deterministic HIBP lookup; LLM-classified categories are excluded pending anti-fabrication rebuild.</div>
</body></html>`;
}
