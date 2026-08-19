// Module #1 — SHARED subject-retrieval. Single entry point retrieveSubject(). Called by
// vip-deep-scan, AEGIS chat, entity Investigate, CRT — nothing reimplements retrieval inline.
// Two (soon three) phases: (1) standing battery sweep → (2) pivot on each source event for
// propagation → cluster into exposure items → persist owner-scoped.
//
// CONSTRAINT C1 (do not violate): recall in the query, precision in the verifier. Discovery
// queries carry the exact name + category terms ONLY — never narrowed by a current-identity
// anchor (that would miss pre-current-employer history, e.g. the 2011 Olynyk case). Anchors are
// used to EXPAND (supplementary queries) or VERIFY (homonym filter), never to RESTRICT discovery.
import { callAiGateway } from "./ai-gateway.ts";

export const SUBJECT_RETRIEVAL_VERSION = "subject-retrieval-v1-2026-08-18";

export interface Subject {
  name: string;
  entityId?: string;
  aliases?: string[];
  anchors?: { employer?: string; location?: string; role?: string; emails?: string[]; knownHandles?: string[]; ownDomains?: string[] };
}
export interface Scope {
  categories?: string[];               // subset of the 7; default all
  depth?: "shallow" | "standard" | "deep";
  phase2?: boolean;                     // default true
}
export interface RetrieveOpts {
  persist?: boolean;
  owner?: { clientId?: string; tenantId?: string; entityId?: string };
  createdBy?: string;
  maxPivots?: number;
  debug?: boolean;   // capture the pre-cluster findings set to subject_scan_findings for diagnosis
}
interface Raw { title: string; url: string; snippet: string; domain?: string; category: string; phase: number; query: string; rank?: number; source_class?: "third_party" | "self_published"; }
export interface ExposureLocation { url: string; domain?: string; platform?: string; title?: string; snippet?: string; found_by_query?: string; phase: number; found_at_rank?: number; }
export interface ExposureItem { title: string; category: string; summary?: string; severity?: string; fingerprint: string; source_class?: "third_party" | "self_published"; locations: ExposureLocation[]; }

const ALL_CATEGORIES = ["legal", "financial", "professional", "media", "social", "corporate", "property"];
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return undefined; } };

// ── PHASE 1: battery (C1 — name + category terms only, no current-anchor narrowing) ──
function buildBattery(subject: Subject, scope: Scope): Array<{ category: string; query: string; pages: number }> {
  const n = `"${subject.name}"`;
  const cats = scope.categories?.length ? scope.categories : ALL_CATEGORIES;
  const P = scope.depth === "deep" ? 4 : scope.depth === "shallow" ? 2 : 3;
  const b: Array<{ category: string; query: string; pages: number }> = [];
  const add = (category: string, query: string, pages = P) => b.push({ category, query, pages });
  if (cats.includes("legal")) {
    // RC1: QUOTED MULTI-WORD PROCEDURAL phrases (absent from marketing prose — self-filter self-authored
    // "human judgment" noise) instead of bare common words. Recall in the query, precision in the verifier.
    add("legal", `${n} ("reasons for judgment" OR "the plaintiff" OR "the defendant" OR "pleaded guilty" OR "found liable" OR "statement of claim" OR "Court of Appeal" OR "Supreme Court")`, Math.max(P, 3));
    add("legal", `${n} ("malicious prosecution" OR "v." OR "abuse of process" OR "found guilty" OR "class action")`, Math.max(P, 3));
    // Site-restricted legal domains (guaranteed-clean results).
    add("legal", `${n} site:canlii.org`, 2);
    add("legal", `${n} site:courtlistener.com`, 1);
    add("legal", `${n} site:bccourts.ca`, 1);
  }
  if (cats.includes("financial")) add("financial", `${n} (bankruptcy OR insolvency OR lien OR creditor OR foreclosure OR receivership OR "tax lien")`);
  if (cats.includes("professional")) add("professional", `${n} (disciplinary OR sanction OR reprimand OR "license revoked" OR suspended OR barred OR "professional conduct")`);
  if (cats.includes("media")) add("media", `${n} (investigation OR alleged OR controversy OR scandal OR "charged with" OR "found guilty")`);
  // RC3: bare-name baseline paginated DEEP — the subject's own top-5 must be paged past to reach third-party content.
  if (cats.includes("social")) { add("social", n, Math.max(P + 2, 5)); add("social", `${n} (site:facebook.com OR site:instagram.com OR site:x.com OR site:reddit.com OR site:linkedin.com)`, 2); }
  if (cats.includes("corporate")) add("corporate", `${n} (director OR officer OR founder OR shareholder OR "board of" OR incorporated)`);
  if (cats.includes("property")) add("property", `${n} (property OR "real estate" OR deed OR title OR mortgage)`, 1);
  return b;
}

// ── PROVIDER-AGNOSTIC SEARCH (one file to swap providers — burned once by a hardcoded assumption).
// CONTRACT: a failed REQUEST and an EMPTY result set are DISTINCT. ok=false+error → the search failed;
// ok=true+results=[] → it genuinely found nothing. They must never look the same (that ambiguity sent
// the CSE diagnosis down the wrong path). Provider via env SEARCH_PROVIDER (default 'serper'; 'cse'
// retained as fallback). Brave/Bing (WO-LONGTAIL-COVERAGE-01) = one more case here.
interface SearchResult { ok: boolean; error?: string; results: Raw[]; provider: string; }

async function searchProvider(query: string, pages: number): Promise<SearchResult> {
  const provider = (Deno.env.get("SEARCH_PROVIDER") || "serper").toLowerCase();
  if (provider === "cse") return searchCSE(query, pages);
  return searchSerper(query, pages);
}

async function searchSerper(query: string, pages: number): Promise<SearchResult> {
  const key = Deno.env.get("SERPER_API_KEY");
  if (!key) return { ok: false, error: "SERPER_API_KEY not set", results: [], provider: "serper" };
  const results: Raw[] = [];
  for (let p = 1; p <= pages; p++) {
    let resp: Response;
    try {
      resp = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q: query, num: 10, page: p }),
      });
    } catch (e) { return { ok: false, error: `serper fetch failed: ${e instanceof Error ? e.message : String(e)}`, results, provider: "serper" }; }
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); msg = j.message || j.error || msg; } catch { /* keep HTTP status */ }
      return { ok: false, error: `serper ${msg}`, results, provider: "serper" };   // request error — DISTINCT from empty
    }
    const d = await resp.json();
    const organic = d.organic || [];
    organic.forEach((o: any, i: number) => results.push({ title: o.title, url: o.link, snippet: o.snippet || "", domain: domainOf(o.link), category: "", phase: 1, query, rank: o.position ?? ((p - 1) * 10 + i + 1) }));
    if (organic.length < 10) break;   // no more pages
  }
  return { ok: true, results, provider: "serper" };   // genuine result set (possibly empty) — DISTINCT from error
}

async function searchCSE(query: string, pages: number): Promise<SearchResult> {
  const key = Deno.env.get("GOOGLE_SEARCH_API_KEY");
  const cx = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
  if (!key || !cx) return { ok: false, error: "CSE credentials missing", results: [], provider: "cse" };
  const results: Raw[] = [];
  for (let p = 0; p < pages; p++) {
    const start = p * 10 + 1;
    if (start > 91) break;
    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&start=${start}`;
    let resp: Response;
    try { resp = await fetch(url); } catch (e) { return { ok: false, error: `cse fetch failed: ${e instanceof Error ? e.message : String(e)}`, results, provider: "cse" }; }
    if (!resp.ok) return { ok: false, error: `cse HTTP ${resp.status}`, results, provider: "cse" };
    const d = await resp.json();
    if (d.error) return { ok: false, error: `cse ${d.error.message ?? "api error"}`, results, provider: "cse" };
    const items = d.items || [];
    items.forEach((it: any, idx: number) => results.push({ title: it.title, url: it.link, snippet: it.snippet || "", domain: domainOf(it.link), category: "", phase: 1, query, rank: start + idx }));
    if (items.length < 10) break;
  }
  return { ok: true, results, provider: "cse" };
}

const dedupeByUrl = (rows: Raw[]) => { const seen = new Set<string>(); return rows.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url)); };

function parseJson<T>(content: string | undefined, fallback: T): T {
  if (!content) return fallback;
  try { const m = content.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
}

// ── Verifier (C1 corollary: reject only clear homonyms; NEVER reject on historical role/employer mismatch) ──
async function verifyFindings(subject: Subject, rows: Raw[]): Promise<Raw[]> {
  if (rows.length === 0) return [];
  const anchors = [subject.anchors?.employer && `Known employer(s): ${subject.anchors.employer}`, subject.anchors?.location && `Known location(s): ${subject.anchors.location}`, subject.anchors?.role && `Known role(s): ${subject.anchors.role}`].filter(Boolean).join("\n") || "(no anchors)";
  const kept: Raw[] = [];
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const { content, error } = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You verify whether web results are about a specific person. The person may have PAST roles/employers/cities NOT in the known anchors — do NOT reject a result because its role/employer/city differs; historical exposure is EXPECTED and important. Reject ONLY if the result is clearly a DIFFERENT individual (different full name, or positively contradictory identity). Return JSON {"verdicts":[{"i":<index>,"keep":true|false}]}.` },
        { role: "user", content: `PERSON: ${subject.name}\n${anchors}\n\nRESULTS:\n${batch.map((r, j) => `[${j}] ${r.title} — ${r.snippet} (${r.domain})`).join("\n")}` },
      ],
      functionName: "subject-retrieval",
    });
    if (error) { kept.push(...batch); continue; }   // fail-open (C1: better to include for the verifier's job than wrongly exclude)
    const parsed = parseJson<{ verdicts: Array<{ i: number; keep: boolean }> }>(content, { verdicts: [] });
    if (!parsed.verdicts.length) { kept.push(...batch); continue; }
    const drop = new Set(parsed.verdicts.filter((v) => v.keep === false).map((v) => v.i));
    batch.forEach((r, j) => { if (!drop.has(j)) kept.push(r); });
  }
  return kept;
}

// ── Source-class classifier (RC3): self-published (subject's own footprint) vs third-party. BOTH are
// kept and reported — self-published is "self-published exposure" ranked separately, NOT discarded. ──
// ── #2 Source-class classifier — DETERMINISTIC rules, no LLM (WO-RETRIEVAL-NONDETERMINISM-01 #2).
// self_published = the URL is on the subject's OWN account (a social host whose path carries their
// handle) or their own domain. Else third_party. This correctly rejects OTHER people's LinkedIn posts
// that merely mention the subject (which the LLM wrongly marked self_published).
const SOCIAL_HOSTS = ["linkedin.com", "x.com", "twitter.com", "instagram.com", "facebook.com", "medium.com", "soundcloud.com", "tiktok.com", "youtube.com", "threads.net", "substack.com", "github.com"];
function deriveHandles(subject: Subject): string[] {
  const hs = new Set<string>([subject.name.toLowerCase().replace(/[^a-z0-9]+/g, "")]);
  for (const h of (subject.anchors?.knownHandles || [])) { const n = h.toLowerCase().replace(/[^a-z0-9]+/g, ""); if (n) hs.add(n); }
  return [...hs].filter((h) => h.length >= 5);
}
function isSelfPublished(url: string, handles: string[], ownDomains: string[]): boolean {
  let host = "", path = "";
  try { const x = new URL(url); host = x.hostname.replace(/^www\./, "").toLowerCase(); path = x.pathname.toLowerCase().replace(/[^a-z0-9]+/g, ""); } catch { return false; }
  if (ownDomains.some((d) => host === d || host.endsWith("." + d))) return true;
  if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith("." + s))) return handles.some((h) => path.includes(h));
  return false;
}
function classifySourceClass(subject: Subject, rows: Raw[]): Raw[] {
  const handles = deriveHandles(subject);
  const ownDomains = (subject.anchors?.ownDomains || []).map((d) => d.toLowerCase());
  for (const r of rows) r.source_class = isSelfPublished(r.url, handles, ownDomains) ? "self_published" : "third_party";
  return rows;
}

// ── PHASE 2: pivot → propagation. EVENT-WORTHINESS GATE (RC2): only third_party findings that carry an
// event signature (case name / citation / a THIRD-PARTY quote) are pivoted — never a marketing tagline. ──
// ── #3 Pivot — DETERMINISTIC case-name / citation / party extraction; the case-name query ALWAYS fires
// when a case is present (this is what lost wiselaw — the old LLM chose a quote instead). LLM kept ONLY
// for a distinctive THIRD-PARTY quote (genuine judgement), temperature 0.
const PIVOT_STOPWORDS = new Set(["Ken", "The", "This", "That", "Court", "Supreme", "Justice", "British", "Columbia", "Canada", "Canadian", "Vancouver", "Province", "Officer", "Conservation", "Prosecution", "Malicious", "Liberals", "Judge", "Case", "News", "Ministry", "Kind", "Student", "Director", "Alternate", "Chief", "Former", "Deadline", "Business", "Manager", "Founder", "December", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const LEGAL_CONTEXT = /\b(v\.|versus|sued|lawsuit|court|prosecution|charged|judgment|judgement|plaintiff|defendant|convicted|acquitted|tribunal|litigation|liable|immunity)\b/i;
function lastName(name: string): string { const p = name.trim().split(/\s+/); return (p[p.length - 1] || name).replace(/[^A-Za-z'’-]/g, ""); }
function firstName(name: string): string { return (name.trim().split(/\s+/)[0] || "").replace(/[^A-Za-z'’-]/g, ""); }
function matchCaseName(text: string): { a: string; b: string } | null {
  const m = text.match(/\b([A-Z][A-Za-z'’-]{2,})\s+v(?:s?\.|ersus)?\.?\s+([A-Z][A-Za-z'’-]{2,})/);
  return m ? { a: m[1], b: m[2] } : null;
}
function matchCitation(text: string): string {
  const m = text.match(/\b(\d{4})\s+(BCSC|BCCA|SCC|ONSC|ONCA|ABQB|ABCA|FCA|FC|QCCS|NSSC|SKQB|MBQB)\s+(\d+)\b/i);
  return m ? `${m[1]} ${m[2].toUpperCase()} ${m[3]}` : "";
}
function otherSurnames(text: string, exclude: string[]): string[] {
  const ex = new Set(exclude.map((s) => s.toLowerCase()));
  const found = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
    const w = m[1];
    if (ex.has(w.toLowerCase()) || PIVOT_STOPWORDS.has(w)) continue;
    found.add(w);
  }
  return [...found].slice(0, 2);
}
async function extractThirdPartyQuote(f: Raw): Promise<string> {
  const { content } = await callAiGateway({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Return JSON {"quote":""}. quote = ONE verbatim, distinctive phrase written by a THIRD PARTY about the subject (a judge/journalist/regulator) — NEVER the subject's own first-person promotional words. "" if none.` },
      { role: "user", content: `Title: ${f.title}\nSnippet: ${f.snippet}` },
    ],
    functionName: "subject-retrieval",
    extraBody: { temperature: 0 },
  });
  return (parseJson<{ quote: string }>(content, { quote: "" }).quote || "").trim();
}
// Deterministic propagation query set for ONE finding. [] if not event-worthy (no legal signal + no quote).
async function pivotQueriesFor(f: Raw, subject: Subject): Promise<string[]> {
  const blob = `${f.title} ${f.snippet}`;
  const surname = lastName(subject.name);
  const qs: string[] = [];
  const cn = matchCaseName(blob);
  if (cn) qs.push(`"${cn.a} v. ${cn.b}"`, `"${cn.b} v. ${cn.a}"`);
  const ci = matchCitation(blob);
  if (ci) qs.push(`"${ci}"`);
  if (LEGAL_CONTEXT.test(blob)) {
    for (const o of otherSurnames(blob, [surname, firstName(subject.name)])) {
      qs.push(`"${o} v. ${surname}"`, `"${surname} v. ${o}"`, `"${o}" "${surname}"`);   // case query ALWAYS fires
    }
  }
  const hasLegalSignal = qs.length > 0;
  const quote = await extractThirdPartyQuote(f);   // LLM (temp 0) — the only residual judgement call
  if (quote.length > 20) qs.push(`"${quote}"`);
  if (!hasLegalSignal && quote.length <= 20) return [];   // marketing/non-event → skip
  return [...new Set(qs)].slice(0, 8);
}

// ── Clustering: N findings → exposure items (one item = one underlying fact, N locations) ──
// ── DETERMINISTIC + LOSSLESS clusterer (WO-RETRIEVAL-NONDETERMINISM-01 #1). No LLM. Every finding lands
// in exactly one item; nothing is dropped. Cluster key priority: case name (X v. Y, order-insensitive)
// → citation (2010 BCSC ####) → canonical URL. url-singletons with identical normalized titles merge
// (same story, different URL). An unclustered finding is its own single-location item — never discarded.
function canonicalUrl(u: string): string {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/+$/, "").toLowerCase(); } catch { return (u || "").toLowerCase(); }
}
function caseNameKey(text: string): string {
  const m = text.match(/\b([A-Z][A-Za-z'’-]{2,})\s+v(?:s?\.|ersus)?\.?\s+([A-Z][A-Za-z'’-]{2,})/);
  return m ? [m[1], m[2]].map((s) => s.toLowerCase()).sort().join("|") : "";
}
function citationKey(text: string): string {
  const m = text.match(/\b(\d{4})\s+(BCSC|BCCA|SCC|ONSC|ONCA|ABQB|ABCA|FCA|FC|QCCS|NSSC|SKQB|MBQB)\s+(\d+)\b/i)
    || text.match(/\[(\d{4})\]\s+([A-Za-z]{2,6})\s+(\d+)/);
  return m ? `${m[1]}-${m[2].toLowerCase()}-${m[3]}` : "";
}
const normTitle = (t: string): string => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const mostCommon = (xs: string[]): string => { const c = new Map<string, number>(); for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1); let best = "", n = 0; for (const [k, v] of c) if (v > n) { best = k; n = v; } return best; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function clusterFindings(_subjectName: string, findings: Raw[]): ExposureItem[] {
  if (findings.length === 0) return [];
  // Pass 1 — assign EVERY finding to exactly one group key (lossless by construction).
  const groups = new Map<string, Raw[]>();
  for (const f of findings) {
    const blob = `${f.title} ${f.snippet}`;
    const cn = caseNameKey(blob), ci = citationKey(blob);
    const key = cn ? "case:" + cn : ci ? "cite:" + ci : "url:" + canonicalUrl(f.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  // Pass 2 — merge url-singletons that share an identical normalized title (same story, different URL).
  const titleToKey = new Map<string, string>();
  for (const [key, fs] of [...groups]) {
    if (!key.startsWith("url:")) continue;
    const nt = normTitle(fs[0].title);
    if (nt.length < 8) continue;                       // too-generic titles are not merged
    const existing = titleToKey.get(nt);
    if (existing && groups.has(existing)) { groups.get(existing)!.push(...fs); groups.delete(key); }
    else titleToKey.set(nt, key);
  }
  // Build items. category + first-pass severity are deterministic; Module #2 refines severity later.
  const items: ExposureItem[] = [];
  for (const [key, fs] of groups) {
    const source_class = fs.some((f) => f.source_class === "third_party") ? "third_party" : "self_published";
    const category = mostCommon(fs.map((f) => f.category)) || "other";
    const isLegal = key.startsWith("case:") || key.startsWith("cite:") || category === "legal";
    const severity = isLegal ? "high" : (category === "financial" || category === "professional") ? "medium" : undefined;
    const rep = fs.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
    const title = key.startsWith("case:") ? `Legal case: ${key.slice(5).split("|").map(cap).join(" v. ")}` : (rep.title || _subjectName);
    // dedupe identical URLs into one location (same place found by 2 queries is not two findings)
    const seen = new Set<string>();
    const locations: ExposureLocation[] = [];
    for (const f of fs) { if (seen.has(f.url)) continue; seen.add(f.url); locations.push({ url: f.url, domain: f.domain, platform: undefined, title: f.title, snippet: f.snippet, found_by_query: f.query, phase: f.phase, found_at_rank: f.rank }); }
    items.push({ title, category: isLegal ? "legal" : category, summary: undefined, severity, source_class, fingerprint: key.replace(/[^a-z0-9]+/g, "-").slice(0, 80), locations });
  }
  return items;
}

async function persist(supabase: any, subject: Subject, owner: RetrieveOpts["owner"], createdBy: string | undefined, scanId: string, items: ExposureItem[]) {
  for (const item of items) {
    const { data: row, error } = await supabase.from("subject_exposure_items").upsert({
      subject_entity_id: subject.entityId ?? null, client_id: owner?.clientId ?? null, tenant_id: owner?.tenantId ?? null,
      category: item.category || "other", title: item.title, summary: item.summary ?? null, severity: item.severity ?? null,
      source_class: item.source_class ?? null,
      fingerprint: item.fingerprint, scan_id: scanId, matcher_version: SUBJECT_RETRIEVAL_VERSION, created_by: createdBy ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "subject_entity_id,fingerprint" }).select("id").single();
    if (error || !row) continue;
    for (const loc of item.locations) {
      await supabase.from("subject_exposure_locations").upsert({
        exposure_item_id: row.id, url: loc.url, domain: loc.domain ?? null, platform: loc.platform ?? null,
        title: loc.title ?? null, snippet: loc.snippet ?? null, found_by_query: loc.found_by_query ?? null, phase: loc.phase, found_at_rank: loc.found_at_rank ?? null,
      }, { onConflict: "exposure_item_id,url" });
    }
  }
}

// ── ENTRY POINT ──
export async function retrieveSubject(supabase: any, subject: Subject, scope: Scope = {}, opts: RetrieveOpts = {}) {
  const scanId = crypto.randomUUID();
  // PHASE 1 — battery sweep
  const battery = buildBattery(subject, scope);
  const searchErrors: Array<{ query: string; error: string }> = [];   // failed requests surfaced, NOT swallowed as empty
  let providerUsed = "";
  let raw: Raw[] = [];
  for (const bq of battery) {
    const sr = await searchProvider(bq.query, bq.pages);
    providerUsed = sr.provider;
    if (!sr.ok) { searchErrors.push({ query: bq.query, error: sr.error ?? "unknown" }); continue; }  // error ≠ empty
    for (const r of sr.results) raw.push({ ...r, category: bq.category });
  }
  raw = dedupeByUrl(raw);
  let verified = await verifyFindings(subject, raw);
  verified = classifySourceClass(subject, verified);   // deterministic tag self_published vs third_party (both kept)
  // PHASE 2 — pivot ONLY third_party, event-worthy findings (RC2). Self-published never seeds propagation.
  let phase2: Raw[] = [];
  if (scope.phase2 !== false) {
    const pivotCandidates = verified.filter((f) => f.source_class === "third_party").slice(0, opts.maxPivots ?? 6);
    const ranQueries = new Set<string>();   // global dedup — never run the same propagation query twice
    for (const f of pivotCandidates) {
      const pqs = await pivotQueriesFor(f, subject);   // deterministic set; [] if not event-worthy
      for (const q of pqs) {
        if (ranQueries.has(q)) continue;
        ranQueries.add(q);
        const sr = await searchProvider(q, 1);
        if (!sr.ok) { searchErrors.push({ query: q, error: sr.error ?? "unknown" }); continue; }
        for (const r of sr.results) phase2.push({ ...r, category: f.category, phase: 2, query: q });
      }
    }
    const knownUrls = new Set(verified.map((v) => v.url));
    phase2 = dedupeByUrl(phase2).filter((r) => !knownUrls.has(r.url));
    phase2 = await verifyFindings(subject, phase2);
    phase2 = classifySourceClass(subject, phase2);
  }
  // CLUSTER
  const allFindings = [...verified, ...phase2];
  const exposureItems = clusterFindings(subject.name, allFindings);
  // DEBUG: capture the FULL pre-cluster set + which findings survived clustering (which were dropped)
  if (opts.debug) {
    const clusteredUrls = new Set(exposureItems.flatMap((it) => it.locations.map((l) => l.url)));
    const rows = allFindings.map((f) => ({
      scan_id: scanId, subject_entity_id: subject.entityId ?? null, url: f.url, domain: f.domain ?? null,
      title: (f.title ?? "").slice(0, 300), snippet: (f.snippet ?? "").slice(0, 300), source_class: f.source_class ?? null,
      phase: f.phase, found_at_rank: f.rank ?? null, found_by_query: (f.query ?? "").slice(0, 300), clustered: clusteredUrls.has(f.url),
    }));
    for (let i = 0; i < rows.length; i += 200) { try { await supabase.from("subject_scan_findings").insert(rows.slice(i, i + 200)); } catch (_) { /* debug best-effort, never fails the scan */ } }
  }
  // PERSIST
  if (opts.persist) await persist(supabase, subject, opts.owner, opts.createdBy, scanId, exposureItems);
  // PS2 ranking: source_class (third_party bucket first), then obscurity (an item's obscurity = the
  // shallowest rank it appears at anywhere; more buried = higher value). subject_awareness applies later.
  const obscurity = (x: ExposureItem) => Math.min(999, ...x.locations.map((l) => l.found_at_rank ?? 999));
  const byObscurity = (a: ExposureItem, b: ExposureItem) => obscurity(b) - obscurity(a);
  const thirdParty = exposureItems.filter((x) => x.source_class === "third_party").sort(byObscurity);
  const selfPublished = exposureItems.filter((x) => x.source_class === "self_published").sort(byObscurity);
  return {
    scanId, version: SUBJECT_RETRIEVAL_VERSION, provider: providerUsed,
    thirdPartyExposure: thirdParty,      // external exposure (the product's core)
    selfPublishedExposure: selfPublished, // subject's own footprint (reported, ranked separately)
    searchErrors,                        // failed requests — surfaced, never collapsed into "no results"
    counts: { battery_queries: battery.length, search_errors: searchErrors.length, phase1_verified: verified.length, phase2_verified: phase2.length, third_party_items: thirdParty.length, self_published_items: selfPublished.length },
  };
}
