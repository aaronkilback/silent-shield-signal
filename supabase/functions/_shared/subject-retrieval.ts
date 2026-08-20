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
  scanId?: string;   // caller-supplied id (async path pre-writes the 'started' tracking row, then passes it)
}

// Bounded concurrency — parallelize Serper/LLM calls without bursting the provider's rate limit. JS is
// single-threaded so the sequential merge of results after each call is race-free.
const SEARCH_CONCURRENCY = 6;
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}
interface Raw { title: string; url: string; snippet: string; domain?: string; category: string; phase: number; query: string; rank?: number; source_class?: "third_party" | "self_published"; }
export interface ExposureLocation { url: string; domain?: string; platform?: string; title?: string; snippet?: string; found_by_query?: string; phase: number; found_at_rank?: number; }
export interface ExposureItem { title: string; category: string; summary?: string; severity?: string; is_finding?: boolean; fingerprint: string; source_class?: "third_party" | "self_published"; locations: ExposureLocation[]; }

// Consequence-first ranking used by BOTH surfaces (AEGIS get_subject_exposure + the report) so they never
// disagree. Order (operator ruling 2026-08-20): (1) real finding before non-finding; (2) severity from what
// the thing IS; (3) corroboration = location count; (4) obscurity is the TIEBREAKER among items equal on
// the above — a buried real finding beats a prominent one, but obscurity NEVER promotes a non-finding.
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export function compareExposureItems(
  a: { is_finding?: boolean; severity?: string | null; location_count?: number; obscurity_rank?: number },
  b: { is_finding?: boolean; severity?: string | null; location_count?: number; obscurity_rank?: number },
): number {
  return (Number(b.is_finding ?? false) - Number(a.is_finding ?? false))                 // findings first
    || ((SEV_RANK[b.severity ?? ""] ?? 0) - (SEV_RANK[a.severity ?? ""] ?? 0))            // consequence
    || ((b.location_count ?? 0) - (a.location_count ?? 0))                                // corroboration
    || ((b.obscurity_rank ?? 0) - (a.obscurity_rank ?? 0));                               // obscurity tiebreaker (buried = higher rank first)
}

const ALL_CATEGORIES = ["legal", "financial", "professional", "media", "social", "corporate", "property"];
const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return undefined; } };

// ── PHASE 1: battery (C1 — name + category terms only, no current-anchor narrowing) ──
function buildBattery(subject: Subject, scope: Scope, learned: LearnedTerm[] = []): Array<{ category: string; query: string; pages: number }> {
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
  // LEARNED BATTERY (additive only — C1 preserved). Facts discovered on prior scans seed extra queries so
  // they are never rediscovered by luck. Scope-respecting: a learned term whose category is out of scope
  // is not added. This never narrows the standing sweep above; it only expands recall.
  for (const q of learnedBatteryQueries(subject, learned)) if (cats.includes(q.category)) b.push(q);
  return b;
}

interface LearnedTerm { term_type: string; term_value: string; }

async function loadLearnedTerms(supabase: any, entityId?: string): Promise<LearnedTerm[]> {
  if (!entityId) return [];
  try {
    const { data } = await supabase.from("subject_learned_terms").select("term_type, term_value").eq("subject_entity_id", entityId).eq("status", "active").limit(200);
    return (data as LearnedTerm[]) ?? [];
  } catch { return []; }
}
// Additive seed queries from learned facts. Same shapes the pivot would generate — but STANDING, so they
// fire on every scan regardless of whether phase-1 rediscovers the seed this run.
function learnedBatteryQueries(subject: Subject, learned: LearnedTerm[]): Array<{ category: string; query: string; pages: number }> {
  const surname = lastName(subject.name);
  const n = `"${subject.name}"`;
  const out: Array<{ category: string; query: string; pages: number }> = [];
  const seen = new Set<string>();
  const add = (category: string, query: string, pages = 1) => { if (!seen.has(query)) { seen.add(query); out.push({ category, query, pages }); } };
  for (const t of learned) {
    const v = t.term_value;
    if (t.term_type === "litigant") { add("legal", `"${v} v. ${surname}"`); add("legal", `"${surname} v. ${v}"`); add("legal", `"${v}" "${surname}"`); }
    else if (t.term_type === "case_name" || t.term_type === "citation") add("legal", `"${v}"`);
    else if (t.term_type === "prior_employer" || t.term_type === "former_role") add("professional", `${n} "${v}"`);
  }
  return out;
}
// Extract learnable facts from a scan's third-party findings + persist with provenance (scan, finding, when).
// Deterministic types only (litigant/case_name/citation) — the ones the pipeline actually discovers and
// that make the case finding reproducible. Inserts NEW terms only (uses the already-loaded existing set),
// so no onConflict target needed; the unique index still guards races (swallowed on violation).
async function persistLearnedTerms(supabase: any, subject: Subject, scanId: string, findings: Raw[], existing: LearnedTerm[]) {
  if (!subject.entityId) return;
  const surnameLc = lastName(subject.name).toLowerCase(), firstLc = firstName(subject.name).toLowerCase();
  const have = new Set(existing.map((t) => `${t.term_type}:${t.term_value.toLowerCase()}`));
  const rows: Array<{ term_type: string; term_value: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (term_type: string, value: string, url: string) => {
    const v = value.trim(); if (!v) return;
    const k = `${term_type}:${v.toLowerCase()}`;
    if (seen.has(k) || have.has(k)) return; seen.add(k);
    rows.push({ term_type, term_value: v, url });
  };
  // Learn litigants/cases ONLY from real legal context — otherwise a pub race ("Craggs v Gavin … race") or
  // a directory list poisons the learned battery with fake litigants that fabricate cases every future scan.
  const LEGAL_CTX = /\b(court|ruling|judg(?:e|ment|ement)|tribunal|BCSC|BCCA|SCC|ONSC|justice|plaintiff|defendant|prosecution|lawsuit|litigation|appeal|liable|sued)\b/i;
  for (const f of findings) {
    if (f.source_class !== "third_party") continue;
    const blob = `${f.title} ${f.snippet}`;
    const ci = matchCitation(blob); if (ci) push("citation", ci, f.url);   // citations stand alone (unambiguous)
    if (!LEGAL_CTX.test(blob)) continue;                                    // no legal context → learn nothing
    const cn = matchCaseName(blob);
    if (cn) { push("case_name", `${cn.a} v. ${cn.b}`, f.url); for (const p of [cn.a, cn.b]) if (p.toLowerCase() !== surnameLc && p.toLowerCase() !== firstLc) push("litigant", p, f.url); }
    for (const o of litigants(blob, subject)) push("litigant", o, f.url);
  }
  if (!rows.length) return;
  try {
    await supabase.from("subject_learned_terms").insert(rows.map((r) => ({ subject_entity_id: subject.entityId, term_type: r.term_type, term_value: r.term_value, discovered_scan_id: scanId, discovered_finding_url: r.url })));
  } catch (_) { /* learning is best-effort; never fails the scan */ }
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

// GENERAL web search on the module's provider (Serper, not the thin CSE index). This is a DIFFERENT
// capability from subject retrieval — a free-text query, not the battery/pivot/cluster pipeline — but it
// runs on the SAME provider so there is one search backend, not two. Used by perform-external-web-search
// (AEGIS + agent-chat ad-hoc web search) to get off the CSE index that could not see the wiselaw case.
export async function webSearch(query: string, pages = 2): Promise<{ ok: boolean; error?: string; provider: string; results: Array<{ title: string; url: string; snippet: string; domain?: string; rank?: number }> }> {
  const sr = await searchProvider(query, pages);
  return { ok: sr.ok, error: sr.error, provider: sr.provider, results: sr.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, domain: r.domain, rank: r.rank })) };
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
// ── #4 Verifier — DETERMINISTIC name-gate first; LLM only for genuine bare-surname ambiguity (temp 0).
// Rule (operator): reject when the subject's SURNAME is preceded (or, reversed, followed) by a DIFFERENT
// first name. "Ash Kilback" fails, "Aaron Kilback" passes, bare "Kilback" → LLM residual. A name-gate of
// "does the surname appear" is NOT enough — every homonym contains the surname.
const NAME_TITLE_STOP = new Set(["officer", "conservation", "justice", "judge", "constable", "sergeant", "sgt", "detective", "mister", "mr", "mrs", "ms", "dr", "doctor", "professor", "prof", "chief", "director", "agent", "former", "late", "contact", "email", "phone", "reverend", "captain", "lieutenant", "corporal", "warden", "ranger", "deputy", "sheriff", "mayor", "councillor", "senator", "governor", "coach", "councilman"]);
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function nameGate(subject: Subject, blob: string): "pass" | "reject" | "residual" {
  const first = firstName(subject.name).toLowerCase();
  const surname = lastName(subject.name);
  if (!surname || !first) return "residual";
  if (new RegExp(`\\b${escapeRegex(first)}\\b[\\s.]+\\b${escapeRegex(surname)}\\b`, "i").test(blob)) return "pass";  // full name anywhere = subject
  const fwd = [...blob.matchAll(new RegExp(`\\b([A-Z][a-z]{2,})\\s+${escapeRegex(surname)}\\b`, "g"))].map((m) => m[1]);          // "Ash Kilback"
  const rev = [...blob.matchAll(new RegExp(`\\b${escapeRegex(surname)},\\s+([A-Z][a-z]{2,})\\b`, "g"))].map((m) => m[1]);        // "Kilback, Barry"
  const occ = [...fwd, ...rev].filter((w) => !NAME_TITLE_STOP.has(w.toLowerCase()));
  if (occ.length) return occ.some((w) => w.toLowerCase() === first) ? "pass" : "reject";
  return "residual";   // bare surname / initials / name only in the URL → hand to the LLM homonym check
}
async function verifyFindings(subject: Subject, rows: Raw[], urlQueries?: Map<string, Set<string>>): Promise<Raw[]> {
  if (rows.length === 0) return [];
  const surname = lastName(subject.name).toLowerCase();
  const kept: Raw[] = [];
  const residual: Raw[] = [];
  for (const r of rows) {
    const blob = `${r.title} ${r.snippet} ${r.url}`;
    // DIRECTORY / INDEX artifact — the name appears only as one alphabetical index entry, not about the
    // subject (e.g. linkedin.com/directory/posts/a-12 "Aaron Gavant… Aaron Gentry… Aaron Kilback…"). Reject.
    if (/\/directory\//i.test(r.url ?? "")) continue;
    const g = nameGate(subject, blob);
    if (g === "reject") continue;                    // deterministic homonym drop — provenance CANNOT rescue a clear different-first-name
    if (g === "pass") { kept.push(r); continue; }
    // provenance keep: a URL returned by a case query DERIVED from this subject (surname in the key) is
    // about them even if the snippet never names them (e.g. wiselaw's archive fragment).
    const pk = caseKeyFromQueries(r.url, urlQueries);
    if (pk && pk.split("|").includes(surname)) { kept.push(r); continue; }
    // NOT-THE-SUBJECT: with no full name, no provenance, the surname must at least APPEAR — a result that
    // never mentions the subject (a topical match like Nate Lange's insider-threat post) is not about them.
    if (!new RegExp(`\\b${escapeRegex(surname)}\\b`, "i").test(blob)) continue;   // reject — no subject reference
    residual.push(r);
  }
  const anchors = [subject.anchors?.employer && `Known employer(s): ${subject.anchors.employer}`, subject.anchors?.location && `Known location(s): ${subject.anchors.location}`, subject.anchors?.role && `Known role(s): ${subject.anchors.role}`].filter(Boolean).join("\n") || "(no anchors)";
  for (let i = 0; i < residual.length; i += 20) {
    const batch = residual.slice(i, i + 20);
    const { content, error } = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You verify whether web results are about a specific person. The person may have PAST roles/employers/cities NOT in the known anchors — do NOT reject a result because its role/employer/city differs; historical exposure is EXPECTED and important. Reject ONLY if the result is clearly a DIFFERENT individual (different full name, or positively contradictory identity). Return JSON {"verdicts":[{"i":<index>,"keep":true|false}]}.` },
        { role: "user", content: `PERSON: ${subject.name}\n${anchors}\n\nRESULTS:\n${batch.map((r, j) => `[${j}] ${r.title} — ${r.snippet} (${r.domain})`).join("\n")}` },
      ],
      functionName: "subject-retrieval",
      extraBody: { temperature: 0 },
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
function isSelfPublished(url: string, handles: string[], ownDomains: string[], contentText?: string, subjectNameLc?: string): boolean {
  let host = "", path = "";
  try { const x = new URL(url); host = x.hostname.replace(/^www\./, "").toLowerCase(); path = x.pathname.toLowerCase().replace(/[^a-z0-9]+/g, ""); } catch { return false; }
  if (ownDomains.some((d) => host === d || host.endsWith("." + d))) return true;
  const isSocial = SOCIAL_HOSTS.some((s) => host === s || host.endsWith("." + s));
  if (!isSocial) return false;
  if (handles.some((h) => path.includes(h))) return true;
  // The URL path did not carry the handle (Instagram permalinks /p/{id} & /reel/{id}; a comment under
  // another user's post URL). Fall back to an AUTHORSHIP marker in the CONTENT — the subject's handle
  // (@handle) or a "View profile for {name}" byline. Mere name-presence is NOT enough (a third-party
  // article about them also has the name); we require an authorship marker.
  if (contentText) {
    const t = contentText.toLowerCase();
    if (handles.some((h) => t.includes("@" + h))) return true;
    if (subjectNameLc && t.includes(`view profile for ${subjectNameLc}`)) return true;
  }
  return false;
}
function classifySourceClass(subject: Subject, rows: Raw[]): Raw[] {
  const handles = deriveHandles(subject);
  const ownDomains = (subject.anchors?.ownDomains || []).map((d) => d.toLowerCase());
  const nameLc = subject.name.toLowerCase();
  for (const r of rows) r.source_class = isSelfPublished(r.url, handles, ownDomains, `${r.title} ${r.snippet}`, nameLc) ? "self_published" : "third_party";
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
// Extract the OTHER real litigant surname(s) — ONLY names bound to an explicit legal-relation verb, never
// any capitalized word. This is what prevents garbage party-pairs like "Technology"/"Most"/"Arms" v. X
// (which both waste queries AND poison provenance so homonyms get whitelisted).
function litigants(text: string, subject: Subject): string[] {
  const ex = new Set([lastName(subject.name).toLowerCase(), firstName(subject.name).toLowerCase()]);
  const names = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\s+(?:sued|v\.|vs\.?|versus|prosecuted|charged|alleges|alleged)\b/g)) names.add(m[1]);
  for (const m of text.matchAll(/\b(?:sued|against|v\.|vs\.?|versus|prosecuted|convicted of defaming)\s+(?:the\s+)?([A-Z][a-z]{2,})\b/g)) names.add(m[1]);
  const cn = matchCaseName(text);
  if (cn) { names.add(cn.a); names.add(cn.b); }
  return [...names].filter((n) => !ex.has(n.toLowerCase()) && !PIVOT_STOPWORDS.has(n)).slice(0, 2);
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
    for (const o of litigants(blob, subject)) {
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
const addUrlQuery = (m: Map<string, Set<string>>, url: string, q: string) => { if (!m.has(url)) m.set(url, new Set()); m.get(url)!.add(q); };
// (A) Query PROVENANCE: a URL returned by a case query is about that case regardless of its snippet.
// Recognises "X v. Y" AND a two-quoted-surname party pair (`"Olynyk" "Kilback"`).
function caseKeyFromQuery(q: string): string {
  const cn = matchCaseName(q);
  if (cn) return [cn.a, cn.b].map((s) => s.toLowerCase()).sort().join("|");
  const names = [...q.matchAll(/"([A-Z][a-z'’-]{2,})"/g)].map((m) => m[1]);
  if (names.length >= 2 && names.length <= 3) return names.slice(0, 2).map((s) => s.toLowerCase()).sort().join("|");
  return "";
}
function caseKeyFromQueries(url: string, urlQueries?: Map<string, Set<string>>): string {
  const qs = urlQueries?.get(url); if (!qs) return "";
  for (const q of qs) { const k = caseKeyFromQuery(q); if (k) return k; }
  return "";
}

export function clusterFindings(_subjectName: string, findings: Raw[], urlQueries?: Map<string, Set<string>>): ExposureItem[] {
  if (findings.length === 0) return [];
  // Pass 1 — assign EVERY finding to exactly one group key (lossless by construction).
  const groups = new Map<string, Raw[]>();
  for (const f of findings) {
    const blob = `${f.title} ${f.snippet}`;
    // (A) Precedence (additive): case-name QUERY provenance > snippet case name > citation > canonical URL.
    // Query provenance wins because the query is intent; the snippet is a display artifact Google chose.
    const qk = caseKeyFromQueries(f.url, urlQueries);
    const cn = caseNameKey(blob), ci = citationKey(blob);
    const key = qk ? "case:" + qk : cn ? "case:" + cn : ci ? "cite:" + ci : "url:" + canonicalUrl(f.url);
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
  // Pass 3 — litigant-surname co-occurrence (precision fix, ranked BELOW query/snippet/citation provenance):
  // a url-group whose combined text contains ALL litigant surnames of a known case joins that case cluster.
  // This links same-case coverage whose own snippet lacked the case name — e.g. the Vancouver Sun
  // "Prosecution policy comes back to bite Liberals" echo of "Kilback v. Olynyk". Surnames ≥4 chars only,
  // matched on word boundaries, to avoid short-token false merges.
  const caseParts = [...groups.keys()].filter((k) => k.startsWith("case:"))
    .map((k) => ({ key: k, parts: k.slice(5).split("|").filter((p) => p.length >= 4) }))
    .filter((c) => c.parts.length >= 2);
  if (caseParts.length) {
    for (const [key, fs] of [...groups]) {
      if (!key.startsWith("url:")) continue;
      const blob = fs.map((f) => `${f.title} ${f.snippet}`).join(" ").toLowerCase();
      const hit = caseParts.find((c) => c.parts.every((p) => new RegExp(`\\b${p}\\b`).test(blob)));
      if (hit && groups.has(hit.key) && hit.key !== key) { groups.get(hit.key)!.push(...fs); groups.delete(key); }
    }
  }
  // Build items. CLASSIFY FROM CONTENT, not from which query found the item — provenance ("a legal query
  // surfaced it") is not classification ("it is a legal matter"). Conflating them tagged junk as legal/High.
  const items: ExposureItem[] = [];
  for (const [key, fs] of groups) {
    const source_class = fs.some((f) => f.source_class === "third_party") ? "third_party" : "self_published";
    const blob = fs.map((f) => `${f.title} ${f.snippet}`).join(" ");
    const isCase = key.startsWith("case:") || key.startsWith("cite:");
    // A real LEGAL finding carries a case name, a citation, or a STRONG legal-action signal — NOT merely a
    // legal search term. Uses a precision regex (NOT the loose pivot LEGAL_CONTEXT, whose common words
    // "court"/"liable"/"immunity"/"charged" match ordinary prose). Otherwise it loses the legal category
    // too, not just the severity — provenance (a legal query found it) is not classification.
    const STRONG_LEGAL = /\b(sued|lawsuit|prosecut(?:ion|ed|ing)|convicted|acquitted|plaintiff|defendant|litigation|disbarred|indicted|pleaded guilty|found liable|class action|malicious prosecution|reasons for judgment|statement of claim|wrongful (?:dismissal|death)|settlement)\b/i;
    // A case NAME ("X v. Y") is only a real case with LEGAL CONTEXT nearby — otherwise "v" is versus in a
    // pub race / a directory list / a rabbit registry (the false-case junk). Citation or strong-legal words
    // stand alone; a bare "X v. Y" needs court/judgment/ruling context.
    const LEGAL_CONTEXT_CLASSIFY = /\b(court|ruling|judg(?:e|ment|ement)|tribunal|BCSC|BCCA|SCC|ONSC|ONCA|ABQB|justice|plaintiff|defendant|prosecution|lawsuit|litigation|appeal|liable|sued)\b/i;
    const realCase = (isCase || matchCaseName(blob) != null) && LEGAL_CONTEXT_CLASSIFY.test(blob);
    const isRealLegal = matchCitation(blob) !== "" || STRONG_LEGAL.test(blob) || realCase;
    // Financial/professional/media findings require the SUBJECT to be the subject of the event, so these use
    // specific distress PHRASES, not bare topic words ("bankruptcy" matched metaphors like "Silent bankruptcy";
    // "disciplinary"/"reprimand" matched his own posts ABOUT workplace discipline).
    const hasFinancial = /\b(filed for bankruptcy|declared bankruptcy|bankruptcy filing|chapter (?:7|11|13)|insolvency proceeding|tax lien against|foreclosure (?:on|proceeding)|placed in receivership|wage garnishment)\b/i.test(blob);
    const hasProfessional = /\b(disciplinary action|was (?:sanctioned|reprimanded|suspended|disbarred)|licen[cs]e (?:revoked|suspended)|struck off (?:the )?(?:register|roll)|professional misconduct (?:finding|complaint)|malpractice (?:suit|claim|judgment))\b/i.test(blob);
    const hasMediaEvent = /\b(arrested|indicted|embezzl|defrauded|sexual assault|criminal charges?|restraining order)\b/i.test(blob);
    let category: string, severity: string | undefined, is_finding: boolean;
    if (isRealLegal) { category = "legal"; severity = "high"; is_finding = true; }
    else if (hasFinancial) { category = "financial"; severity = "medium"; is_finding = true; }
    else if (hasProfessional) { category = "professional"; severity = "medium"; is_finding = true; }
    else if (hasMediaEvent) { category = "media"; severity = "medium"; is_finding = true; }
    else { category = "mention"; severity = "low"; is_finding = false; }   // bare web mention, NOT a finding
    const rep = fs.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
    // Only a REAL case gets the "Legal case: X v. Y" title; a fabricated one (no legal context) keeps its
    // page title and is a mention, so the report never presents a pub race as a court case.
    const title = (isCase && realCase) ? `Legal case: ${key.slice(5).split("|").map(cap).join(" v. ")}` : (rep.title || _subjectName);
    // dedupe identical URLs into one location (same place found by 2 queries is not two findings)
    const seen = new Set<string>();
    const locations: ExposureLocation[] = [];
    for (const f of fs) { if (seen.has(f.url)) continue; seen.add(f.url); locations.push({ url: f.url, domain: f.domain, platform: undefined, title: f.title, snippet: f.snippet, found_by_query: f.query, phase: f.phase, found_at_rank: f.rank }); }
    items.push({ title, category, summary: undefined, severity, is_finding, source_class, fingerprint: key.replace(/[^a-z0-9]+/g, "-").slice(0, 80), locations });
  }
  return items;
}

async function persist(supabase: any, subject: Subject, owner: RetrieveOpts["owner"], createdBy: string | undefined, scanId: string, items: ExposureItem[]) {
  for (const item of items) {
    const { data: row, error } = await supabase.from("subject_exposure_items").upsert({
      subject_entity_id: subject.entityId ?? null, client_id: owner?.clientId ?? null, tenant_id: owner?.tenantId ?? null,
      category: item.category || "other", title: item.title, summary: item.summary ?? null, severity: item.severity ?? null, is_finding: item.is_finding ?? true,
      source_class: item.source_class ?? null,
      fingerprint: item.fingerprint, scan_id: scanId, matcher_version: SUBJECT_RETRIEVAL_VERSION, created_by: createdBy ?? null, updated_at: new Date().toISOString(),
      superseded_at: null,   // re-found this scan → current again (un-supersede if it had aged out)
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

// ── Scan-run tracking (fire-and-persist requirement). 'started' before work; 'completed'/'failed' after.
// A SIGKILL leaves the row at 'started' = visibly died-mid-run. Best-effort; never fails the scan.
export async function startScanRun(supabase: any, scanId: string, subject: Subject, scope: Scope, opts: RetrieveOpts) {
  try {
    await supabase.from("subject_scan_runs").insert({
      id: scanId, subject_entity_id: subject.entityId ?? null, subject_name: subject.name,
      owner_client_id: opts.owner?.clientId ?? null, owner_tenant_id: opts.owner?.tenantId ?? null,
      scope, status: "started", fired_by: opts.createdBy ?? null,
    });
  } catch (_) { /* tracking is best-effort */ }
}
async function finishScanRun(supabase: any, scanId: string, status: "completed" | "failed", counts: any, error?: unknown) {
  try {
    await supabase.from("subject_scan_runs").update({
      status, counts: counts ?? null, error: error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null,
      finished_at: new Date().toISOString(),
    }).eq("id", scanId);
  } catch (_) { /* tracking is best-effort */ }
}

// ── ENTRY POINT ──
export async function retrieveSubject(supabase: any, subject: Subject, scope: Scope = {}, opts: RetrieveOpts = {}) {
  const scanId = opts.scanId ?? crypto.randomUUID();
  if (opts.persist && !opts.scanId) await startScanRun(supabase, scanId, subject, scope, opts);   // async path pre-writes it
  try {
  // LEARNED BATTERY — load facts discovered on prior scans of THIS subject (litigants/cases/citations),
  // seeded additively into the battery so they fire every run regardless of phase-1 luck.
  const learned = await loadLearnedTerms(supabase, subject.entityId);
  // PHASE 1 — battery sweep
  const battery = buildBattery(subject, scope, learned);
  const searchErrors: Array<{ query: string; error: string }> = [];   // failed requests surfaced, NOT swallowed as empty
  let providerUsed = "";
  let raw: Raw[] = [];
  // (A) queries-per-URL — every query that returned a URL, tracked across BOTH phases (before any dedup
  // drops a duplicate occurrence). This is what lets clustering key on the case QUERY that found a URL,
  // even when that URL's stored finding came from a different (phase-1) query.
  const urlQueries = new Map<string, Set<string>>();
  const p1 = await mapLimit(battery, SEARCH_CONCURRENCY, async (bq) => ({ bq, sr: await searchProvider(bq.query, bq.pages) }));
  for (const { bq, sr } of p1) {   // sequential merge = race-free
    providerUsed = sr.provider;
    if (!sr.ok) { searchErrors.push({ query: bq.query, error: sr.error ?? "unknown" }); continue; }  // error ≠ empty
    for (const r of sr.results) { raw.push({ ...r, category: bq.category }); addUrlQuery(urlQueries, r.url, bq.query); }
  }
  raw = dedupeByUrl(raw);
  let verified = await verifyFindings(subject, raw, urlQueries);
  verified = classifySourceClass(subject, verified);   // deterministic tag self_published vs third_party (both kept)
  // CHECKPOINT — persist phase-1 items BEFORE phase-2 (durability). A SIGKILL during phase-2 then still
  // leaves the phase-1 findings written — and the learned-battery case query already ran in phase-1, so
  // the headline case item is preserved even on a 149s death. The end-of-scan persist upserts over this.
  if (opts.persist) { try { await persist(supabase, subject, opts.owner, opts.createdBy, scanId, clusterFindings(subject.name, verified, urlQueries)); } catch (_) { /* checkpoint best-effort */ } }
  // PHASE 2 — pivot ONLY third_party, event-worthy findings (RC2). Self-published never seeds propagation.
  let phase2: Raw[] = [];
  if (scope.phase2 !== false) {
    // Order pivot candidates by legal priority so the REAL case finding (e.g. "Olynyk sued … Kilback")
    // is pivoted BEFORE the cap — otherwise the case-name query never fires and its echo is never found.
    const legalScore = (f: Raw) => { const b = `${f.title} ${f.snippet}`; return (matchCaseName(b) ? 2 : 0) + (matchCitation(b) ? 2 : 0) + (LEGAL_CONTEXT.test(b) ? 1 : 0); };
    const pivotCandidates = verified.filter((f) => f.source_class === "third_party")
      .sort((a, b) => legalScore(b) - legalScore(a)).slice(0, opts.maxPivots ?? 8);
    // Compute all pivot query sets concurrently (each has an LLM quote call), then run the deduped union.
    const pivotSets = await mapLimit(pivotCandidates, SEARCH_CONCURRENCY, async (f) => ({ f, qs: await pivotQueriesFor(f, subject) }));
    const queryToCat = new Map<string, string>();   // dedup queries globally; keep first candidate's category
    for (const { f, qs } of pivotSets) for (const q of qs) if (!queryToCat.has(q)) queryToCat.set(q, f.category);
    const p2 = await mapLimit([...queryToCat.keys()], SEARCH_CONCURRENCY, async (q) => ({ q, sr: await searchProvider(q, 1) }));
    for (const { q, sr } of p2) {
      if (!sr.ok) { searchErrors.push({ query: q, error: sr.error ?? "unknown" }); continue; }
      // record provenance for EVERY returned URL — even ones later dropped from phase2 as phase-1 dups
      for (const r of sr.results) { phase2.push({ ...r, category: queryToCat.get(q)!, phase: 2, query: q }); addUrlQuery(urlQueries, r.url, q); }
    }
    const knownUrls = new Set(verified.map((v) => v.url));
    phase2 = dedupeByUrl(phase2).filter((r) => !knownUrls.has(r.url));
    phase2 = await verifyFindings(subject, phase2, urlQueries);
    phase2 = classifySourceClass(subject, phase2);
  }
  // CLUSTER
  const allFindings = [...verified, ...phase2];
  const exposureItems = clusterFindings(subject.name, allFindings, urlQueries);
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
  if (opts.persist) {
    await persist(supabase, subject, opts.owner, opts.createdBy, scanId, exposureItems);
    await persistLearnedTerms(supabase, subject, scanId, allFindings, learned);   // learn facts for next scan
    // RETIRE/DECAY: supersede items in the swept categories that THIS scan did not re-find (they kept an
    // older scan_id). Keeps the cumulative set from accumulating stale findings forever. Breach/household
    // items (categories outside the reputational sweep) are untouched — their own producers retire them.
    if (subject.entityId) {
      const sweptCats = scope.categories?.length ? scope.categories : ALL_CATEGORIES;
      try {
        await supabase.from("subject_exposure_items").update({ superseded_at: new Date().toISOString() })
          .eq("subject_entity_id", subject.entityId).in("category", sweptCats).neq("scan_id", scanId).is("superseded_at", null);
      } catch (_) { /* retire best-effort */ }
    }
  }
  // PS2 ranking: source_class (third_party bucket first), then obscurity (an item's obscurity = the
  // shallowest rank it appears at anywhere; more buried = higher value). subject_awareness applies later.
  const obscurity = (x: ExposureItem) => Math.min(999, ...x.locations.map((l) => l.found_at_rank ?? 999));
  const byObscurity = (a: ExposureItem, b: ExposureItem) => obscurity(b) - obscurity(a);
  const thirdParty = exposureItems.filter((x) => x.source_class === "third_party").sort(byObscurity);
  const selfPublished = exposureItems.filter((x) => x.source_class === "self_published").sort(byObscurity);
  const counts = { battery_queries: battery.length, learned_terms_seeded: learned.length, search_errors: searchErrors.length, phase1_verified: verified.length, phase2_verified: phase2.length, third_party_items: thirdParty.length, self_published_items: selfPublished.length };
  if (opts.persist) await finishScanRun(supabase, scanId, "completed", counts);
  return {
    scanId, version: SUBJECT_RETRIEVAL_VERSION, provider: providerUsed,
    thirdPartyExposure: thirdParty,      // external exposure (the product's core)
    selfPublishedExposure: selfPublished, // subject's own footprint (reported, ranked separately)
    searchErrors,                        // failed requests — surfaced, never collapsed into "no results"
    counts,
  };
  } catch (e) {
    if (opts.persist) await finishScanRun(supabase, scanId, "failed", null, e);
    throw e;
  }
}
