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
    items.forEach((it: any, idx: number) => out.push({ title: it.title, url: it.link, snippet: it.snippet || "", domain: domainOf(it.link), category: "", phase: 1, query, rank: start + idx }));
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

// ── Source-class classifier (RC3): self-published (subject's own footprint) vs third-party. BOTH are
// kept and reported — self-published is "self-published exposure" ranked separately, NOT discarded. ──
async function classifySourceClass(subject: Subject, rows: Raw[]): Promise<Raw[]> {
  if (rows.length === 0) return rows;
  const handles = (subject.anchors?.knownHandles || []).join(", ");
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const { content, error } = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `Classify each web result about a person as "self_published" (content the SUBJECT authored/owns — their own LinkedIn/Instagram/Medium/X/personal-site posts, first-person, an account that is theirs) or "third_party" (someone ELSE writing about them — court, news, blog, forum). Return JSON {"c":[{"i":<index>,"cls":"self_published|third_party"}]}.` },
        { role: "user", content: `SUBJECT: ${subject.name}${handles ? `\nKnown handles: ${handles}` : ""}\n\nRESULTS:\n${batch.map((r, j) => `[${j}] ${r.title} — ${r.snippet} (${r.domain})`).join("\n")}` },
      ],
      functionName: "subject-retrieval",
    });
    const parsed = error ? { c: [] } : parseJson<{ c: Array<{ i: number; cls: string }> }>(content, { c: [] });
    const map = new Map(parsed.c.map((x) => [x.i, x.cls]));
    batch.forEach((r, j) => { r.source_class = (map.get(j) === "self_published" ? "self_published" : "third_party"); });
  }
  return rows;
}

// ── PHASE 2: pivot → propagation. EVENT-WORTHINESS GATE (RC2): only third_party findings that carry an
// event signature (case name / citation / a THIRD-PARTY quote) are pivoted — never a marketing tagline. ──
async function pivotTerms(f: Raw): Promise<{ case_name?: string; parties?: string[]; distinctive_quote?: string; event_terms?: string[]; is_event?: boolean }> {
  const { content } = await callAiGateway({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Extract propagation pivot terms from a finding ONLY IF it reports an event of consequence (a court case, charge, sanction, controversy, regulatory action). Return JSON {"is_event":true|false,"case_name":"","parties":[],"distinctive_quote":"","event_terms":[]}. is_event=false for marketing bios, taglines, product blurbs, or the subject's own promotional content. distinctive_quote = a verbatim, unusual phrase written by a THIRD PARTY about the subject (a judge/journalist/regulator) — NEVER the subject's own first-person promotional words; "" if none. case_name = legal style of cause if present.` },
      { role: "user", content: `Title: ${f.title}\nSnippet: ${f.snippet}\nURL: ${f.url}` },
    ],
    functionName: "subject-retrieval",
  });
  return parseJson(content, { is_event: false });
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
  return parsed.items.map((it) => {
    const clustered = (it.location_indices || []).map((idx) => findings[idx]).filter(Boolean);
    // item is third_party exposure if ANY of its locations is third-party; else self-published exposure.
    const source_class = clustered.some((f) => f.source_class === "third_party") ? "third_party" : "self_published";
    return {
      title: it.title, category: it.category, summary: it.summary, severity: it.severity, source_class,
      fingerprint: (it.fingerprint || it.title || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80),
      locations: clustered.map((f) => ({ url: f.url, domain: f.domain, platform: undefined, title: f.title, snippet: f.snippet, found_by_query: f.query, phase: f.phase, found_at_rank: f.rank })),
    } as ExposureItem;
  }).filter((x) => x.locations.length > 0);
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
  let raw: Raw[] = [];
  for (const bq of battery) {
    const results = await cseSearch(bq.query, bq.pages);
    for (const r of results) raw.push({ ...r, category: bq.category });
  }
  raw = dedupeByUrl(raw);
  let verified = await verifyFindings(subject, raw);
  verified = await classifySourceClass(subject, verified);   // tag self_published vs third_party (both kept)
  // PHASE 2 — pivot ONLY third_party, event-worthy findings (RC2). Self-published never seeds propagation.
  let phase2: Raw[] = [];
  if (scope.phase2 !== false) {
    const pivotCandidates = verified.filter((f) => f.source_class === "third_party").slice(0, opts.maxPivots ?? 6);
    for (const f of pivotCandidates) {
      const pivot = await pivotTerms(f);
      // event-worthiness gate: must be an event AND yield a case name or a third-party quote — never a tagline
      if (!pivot.is_event || (!pivot.case_name && !(pivot.distinctive_quote && pivot.distinctive_quote.length > 12))) continue;
      for (const q of propagationQueries(pivot, subject.name)) {
        const results = await cseSearch(q, 1);
        for (const r of results) phase2.push({ ...r, category: f.category, phase: 2, query: q });
      }
    }
    const knownUrls = new Set(verified.map((v) => v.url));
    phase2 = dedupeByUrl(phase2).filter((r) => !knownUrls.has(r.url));
    phase2 = await verifyFindings(subject, phase2);
    phase2 = await classifySourceClass(subject, phase2);
  }
  // CLUSTER
  const exposureItems = await clusterFindings(subject.name, [...verified, ...phase2]);
  // PERSIST
  if (opts.persist) await persist(supabase, subject, opts.owner, opts.createdBy, scanId, exposureItems);
  // PS2 ranking: source_class (third_party bucket first), then obscurity (an item's obscurity = the
  // shallowest rank it appears at anywhere; more buried = higher value). subject_awareness applies later.
  const obscurity = (x: ExposureItem) => Math.min(999, ...x.locations.map((l) => l.found_at_rank ?? 999));
  const byObscurity = (a: ExposureItem, b: ExposureItem) => obscurity(b) - obscurity(a);
  const thirdParty = exposureItems.filter((x) => x.source_class === "third_party").sort(byObscurity);
  const selfPublished = exposureItems.filter((x) => x.source_class === "self_published").sort(byObscurity);
  return {
    scanId, version: SUBJECT_RETRIEVAL_VERSION,
    thirdPartyExposure: thirdParty,      // external exposure (the product's core)
    selfPublishedExposure: selfPublished, // subject's own footprint (reported, ranked separately)
    counts: { battery_queries: battery.length, phase1_verified: verified.length, phase2_verified: phase2.length, third_party_items: thirdParty.length, self_published_items: selfPublished.length },
  };
}
