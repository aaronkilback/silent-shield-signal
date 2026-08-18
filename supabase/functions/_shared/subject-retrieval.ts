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
  anchors?: { employer?: string; location?: string; role?: string; emails?: string[]; knownHandles?: string[] };
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
}
interface Raw { title: string; url: string; snippet: string; domain?: string; category: string; phase: number; query: string; }
export interface ExposureLocation { url: string; domain?: string; platform?: string; title?: string; snippet?: string; found_by_query?: string; phase: number; }
export interface ExposureItem { title: string; category: string; summary?: string; severity?: string; fingerprint: string; locations: ExposureLocation[]; }

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
    add("legal", `${n} (lawsuit OR court OR judgment OR ruling OR "v." OR plaintiff OR defendant OR prosecution OR charged OR convicted OR acquitted OR litigation OR tribunal)`);
    add("legal", `${n} site:canlii.org`, 2);
    add("legal", `${n} site:courtlistener.com`, 1);
  }
  if (cats.includes("financial")) add("financial", `${n} (bankruptcy OR insolvency OR lien OR creditor OR foreclosure OR receivership OR "tax lien")`);
  if (cats.includes("professional")) add("professional", `${n} (disciplinary OR sanction OR reprimand OR "license revoked" OR suspended OR barred OR "professional conduct")`);
  if (cats.includes("media")) add("media", `${n} (investigation OR alleged OR controversy OR scandal OR reported OR charged)`);
  if (cats.includes("social")) { add("social", n, 2); add("social", `${n} (site:facebook.com OR site:instagram.com OR site:x.com OR site:reddit.com OR site:linkedin.com)`, 2); }
  if (cats.includes("corporate")) add("corporate", `${n} (director OR officer OR founder OR shareholder OR "board of" OR incorporated)`);
  if (cats.includes("property")) add("property", `${n} (property OR "real estate" OR deed OR title OR mortgage)`, 1);
  return b;
}

async function cseSearch(query: string, pages: number): Promise<Raw[]> {
  const key = Deno.env.get("GOOGLE_SEARCH_API_KEY");
  const cx = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
  if (!key || !cx) throw new Error("CSE credentials missing (GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID)");
  const out: Raw[] = [];
  for (let p = 0; p < pages; p++) {
    const start = p * 10 + 1;
    if (start > 91) break;
    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&start=${start}`;
    let resp: Response;
    try { resp = await fetch(url); } catch { break; }
    if (!resp.ok) break;                       // 429/4xx → stop paginating this query
    const data = await resp.json();
    const items = data.items || [];
    for (const it of items) out.push({ title: it.title, url: it.link, snippet: it.snippet || "", domain: domainOf(it.link), category: "", phase: 1, query });
    if (items.length < 10) break;
  }
  return out;
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

// ── PHASE 2: pivot → propagation ──
async function pivotTerms(f: Raw): Promise<{ case_name?: string; parties?: string[]; distinctive_quote?: string; event_terms?: string[] }> {
  const { content } = await callAiGateway({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Extract propagation pivot terms from a reputational finding. Return JSON {"case_name":"","parties":[],"distinctive_quote":"","event_terms":[]}. distinctive_quote = the most verbatim, unusual quoted phrase from the ruling/article (a near-unique fingerprint); "" if none. case_name = legal style of cause if present.` },
      { role: "user", content: `Title: ${f.title}\nSnippet: ${f.snippet}\nURL: ${f.url}` },
    ],
    functionName: "subject-retrieval",
  });
  return parseJson(content, {});
}
function propagationQueries(p: { case_name?: string; parties?: string[]; distinctive_quote?: string }, subjectName: string): string[] {
  const qs: string[] = [];
  if (p.case_name) qs.push(`"${p.case_name}"`);
  if (p.distinctive_quote && p.distinctive_quote.length > 12) qs.push(`"${p.distinctive_quote}"`);
  if (p.parties && p.parties.length >= 2) qs.push(p.parties.slice(0, 3).map((x) => `"${x}"`).join(" "));
  qs.push(`"${p.case_name || subjectName}" (site:reddit.com OR site:x.com OR site:facebook.com)`);
  return [...new Set(qs)].slice(0, 6);
}

// ── Clustering: N findings → exposure items (one item = one underlying fact, N locations) ──
async function clusterFindings(subjectName: string, findings: Raw[]): Promise<ExposureItem[]> {
  if (findings.length === 0) return [];
  const { content, error } = await callAiGateway({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Group web findings about ${subjectName} into EXPOSURE ITEMS. One item = one underlying fact/event even if it appears at multiple URLs (a blog + a news repost + a forum thread about the SAME court case = ONE item, with those URLs as its locations). Return JSON {"items":[{"title":"","category":"legal|financial|professional|media|social|corporate|property","summary":"","severity":"low|medium|high|critical","fingerprint":"short-slug-of-the-core-event","location_indices":[<input indices>]}]}. Every input index belongs to exactly one item.` },
      { role: "user", content: findings.map((f, i) => `[${i}] (${f.category}) ${f.title} — ${f.snippet} (${f.url})`).join("\n") },
    ],
    functionName: "subject-retrieval",
  });
  if (error) return [];
  const parsed = parseJson<{ items: Array<{ title: string; category: string; summary: string; severity: string; fingerprint: string; location_indices: number[] }> }>(content, { items: [] });
  return parsed.items.map((it) => ({
    title: it.title, category: it.category, summary: it.summary, severity: it.severity,
    fingerprint: (it.fingerprint || it.title || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80),
    locations: (it.location_indices || []).map((idx) => findings[idx]).filter(Boolean).map((f) => ({
      url: f.url, domain: f.domain, platform: undefined, title: f.title, snippet: f.snippet, found_by_query: f.query, phase: f.phase,
    })),
  })).filter((x) => x.locations.length > 0);
}

async function persist(supabase: any, subject: Subject, owner: RetrieveOpts["owner"], createdBy: string | undefined, scanId: string, items: ExposureItem[]) {
  for (const item of items) {
    const { data: row, error } = await supabase.from("subject_exposure_items").upsert({
      subject_entity_id: subject.entityId ?? null, client_id: owner?.clientId ?? null, tenant_id: owner?.tenantId ?? null,
      category: item.category || "other", title: item.title, summary: item.summary ?? null, severity: item.severity ?? null,
      fingerprint: item.fingerprint, scan_id: scanId, matcher_version: SUBJECT_RETRIEVAL_VERSION, created_by: createdBy ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "subject_entity_id,fingerprint" }).select("id").single();
    if (error || !row) continue;
    for (const loc of item.locations) {
      await supabase.from("subject_exposure_locations").upsert({
        exposure_item_id: row.id, url: loc.url, domain: loc.domain ?? null, platform: loc.platform ?? null,
        title: loc.title ?? null, snippet: loc.snippet ?? null, found_by_query: loc.found_by_query ?? null, phase: loc.phase,
      }, { onConflict: "exposure_item_id,url" });
    }
  }
}

// ── ENTRY POINT ──
export async function retrieveSubject(supabase: any, subject: Subject, scope: Scope = {}, opts: RetrieveOpts = {}) {
  const scanId = crypto.randomUUID();
  // PHASE 1 — battery sweep
  const battery = buildBattery(subject, scope);
  let raw: Raw[] = [];
  for (const bq of battery) {
    const results = await cseSearch(bq.query, bq.pages);
    for (const r of results) raw.push({ ...r, category: bq.category });
  }
  raw = dedupeByUrl(raw);
  const verified = await verifyFindings(subject, raw);
  // PHASE 2 — pivot on each verified source event
  let phase2: Raw[] = [];
  if (scope.phase2 !== false) {
    for (const f of verified.slice(0, opts.maxPivots ?? 6)) {
      const pivot = await pivotTerms(f);
      for (const q of propagationQueries(pivot, subject.name)) {
        const results = await cseSearch(q, 1);
        for (const r of results) phase2.push({ ...r, category: f.category, phase: 2, query: q });
      }
    }
    const knownUrls = new Set(verified.map((v) => v.url));
    phase2 = dedupeByUrl(phase2).filter((r) => !knownUrls.has(r.url));
    phase2 = await verifyFindings(subject, phase2);
  }
  // CLUSTER
  const exposureItems = await clusterFindings(subject.name, [...verified, ...phase2]);
  // PERSIST
  if (opts.persist) await persist(supabase, subject, opts.owner, opts.createdBy, scanId, exposureItems);
  return { scanId, version: SUBJECT_RETRIEVAL_VERSION, exposureItems, counts: { battery_queries: battery.length, phase1_verified: verified.length, phase2_verified: phase2.length, exposure_items: exposureItems.length } };
}
