# Subject Retrieval — shared two-phase capability (DESIGN ONLY, do not build) — 2026-08-18

> **SCOPE (operator correction 2026-08-18): this is a SHARED PLATFORM CAPABILITY, not a VIP-scan feature.** One extracted module, one entry point, called by vip-deep-scan · AEGIS chat (entity/person questions) · entity-deep-scan / the Investigate button · the CRT investigation product · anything asking "what is findable about X". Do NOT build it inside one function — that repeats the trapped-capability mistake (vip-osint-discovery reachable only via an absent wizard caller; score_signal_hazard_pathway post-admission-only; matchClientKeywords inline until extracted to `_shared/deterministic-matcher.ts`). Module boundary below.

## MODULE BOUNDARY — shared vs caller-specific

**Proposed extraction: `_shared/subject-retrieval.ts` (Module #1) with ONE entry point.**
```
retrieveSubject(subject, scope, opts) -> { exposureItems: ExposureItem[], provenance }
  subject : { name, aliases?, anchors?: { employer, location, role, dob_era, emails, phones, known_handles } }
  scope   : { categories: subset of [legal,financial,professional,media,social,corporate,property],
              depth: 'shallow'|'standard'|'deep' (pagination + phase-2 breadth), phase2: bool }
  opts    : { persist: bool, owner: {client_id|tenant_id|entity_id}, budget?: maxRequests }
```

**SHARED — Module #1 (subject-retrieval):** battery construction · CSE retrieval (pagination, rate-limit, retry, safe-fetch, daily-cap/budget) · **verification** (homonym/relevance LLM filter using the anchors) · **pivot** (Phase-2 term extraction + propagation queries) · **clustering** (fingerprint + LLM merge into exposure items) · **persistence** (owner-scoped, RLS-at-creation, provenance-tagged, idempotent) · provenance (query, url, date_captured, verifier version). *Everything from "given a subject" to "clustered, persisted exposure items" is shared.*

**SHARED — Module #2 (remediation-advisor), a SEPARATE module that CONSUMES Module #1's exposure items.**
> **I move remediation-guidance to SHARED, disagreeing with the proposed line.** The reasoning — given an exposure item + its spread, produce options (removal request / de-index / suppression / correction / accept-and-prepare) with effort, likelihood, and cross-item priority — is subject-agnostic and caller-agnostic. Putting it in one caller is the SAME trap. It is a distinct module (single-responsibility: retrieval finds, advisor plans) but it is shared. Callers compose #1 → #2.

**CALLER-SPECIFIC (the line):**
- **What triggers a scan** — wizard submit / chat intent / Investigate click / CRT workflow / cron. The caller decides *when*.
- **Scope + authorization** — the caller picks `scope` (which categories, depth) and validates the subject↔owner relationship, passing `owner` context. The module persists to that owner; it does NOT decide who may scan whom (tenant-membership stays at the caller, same gate as generate-executive-report / the vip-deep-scan rebuild).
- **Report format / rendering** — VIP report document · AEGIS chat prose · entity-card panel · CRT investigation file. Module returns structured `ExposureItem[]` + remediation plans; each surface renders its own way.

**Net line:** *find → pivot → cluster → persist → plan-remediation* is shared (two modules). *When to run, for whom, and how to present* is caller-specific.

**Un-trapping the existing overlap (part of the design, not a separate cleanup):** the four current CSE functions collapse into Module #1 + thin callers — `vip-osint-discovery`'s query-source logic folds into the battery (it stops being a trapped parallel); `osint-entity-scan` (the Investigate path) and `osint-web-search` / `perform-external-web-search` become thin wrappers or are retired. A single-source-of-truth CI guard (like the deterministic-matcher extraction) prevents any surface from reimplementing retrieval inline.

---
## CONSTRAINTS (invariants — a violation is a regression, enforce in review/CI)

**C1 — Recall in the query, precision in the verifier.** A Phase-1 discovery query MUST NOT be narrowed by a current-identity anchor (employer, current city, current role). Disambiguation happens ONLY in the verifier (LLM homonym filter over the anchor set), never by making an anchor a *required* term in a discovery query.
- **Why:** anchoring on a current employer would have missed the 2011 Olynyk case — the subject was not at that employer then. The most damaging exposure predates current identity by definition.
- **Regression test:** any change that moves an anchor from the verifier into a discovery query's required terms (e.g. `"Name" PETRONAS (legal terms)`) is a regression and must be rejected. Discovery queries carry the exact name + category terms only.
- **Allowed (not a violation):** ADDING supplementary queries that expand coverage — e.g. a Phase-2 propagation query `"Name" "conservation officer"` or a Phase-3 re-sweep with a *discovered* historical role. Anchors may EXPAND recall (more queries) or VERIFY precision; they may never RESTRICT the base discovery sweep.
- **Corollary:** the verifier must not reject a finding solely because it fails to match *current* anchors — a role/employer/city mismatch is expected for historical exposure. It rejects only on positive disconfirming evidence (clearly a different individual).

## PHASE 3 — Historical identity (sweep → discover history → re-sweep)
**The battery DOES need historical anchors, and current intake cannot supply them fully.** A subject's exposure spans employers, addresses, roles, and names they no longer hold; the intake captures current state only, and subjects forget or omit the very history that is most damaging. Two sources, both required:

1. **Subject-supplied (high precision, incomplete):** extend the intake to capture prior employers, prior cities/addresses, former roles/titles, former/maiden names, past affiliations. Cheap, precise, but bounded by what the subject remembers and is willing to disclose.
2. **Scan-inferred — Phase 3 (catches what the subject omits):** after Phase 1 verification, extract identity facts from confirmed findings (role="conservation officer", org="BC Conservation Officer Service", prior city, former title) and feed them back as (a) verifier context (raising confidence on historical findings) and (b) NEW supplementary discovery queries (expanding recall per C1 — additive, never restrictive). Iterate: sweep → extract identity history → re-sweep with learned anchors → until no new identity facts appear (bounded, e.g. ≤2 iterations for cost).

**Why Phase 3 is load-bearing for the acceptance test:** verifying that the 2011 conservation-officer judgment is *this* Aaron Kilback (now PETRONAS security) requires knowing he *was* a conservation officer — a fact the intake does not contain. Phase 3 discovers "Aaron Kilback → BC conservation officer" from the finding itself, which both confirms the identity link and seeds propagation. Without it, a strict verifier could reject the most important finding as a presumed homonym. (Interim for v1: for an uncommon exact-name like "Aaron Kilback", name-match + absence-of-disconfirmation suffices; Phase 3 becomes essential for common names and deeper histories.)

---
## Two-phase retrieval design (the shared internals of Module #1)

**Whole-web (empirical):** entity_content shows **567 distinct domains / 2,231 URLs** (facebook, reddit, wikipedia, cbc.ca, courtlistener.com, justice.gov, researchgate, foreign gov, niche orgs). Consistent with a whole-web PSE, not a site-restricted engine. Operator confirms authoritatively in the PSE panel. Creds `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` are set.

**Core principle:** a cold scan does not know the subject has legal (or financial, or regulatory) history. So retrieval is NOT smarter queries — it is a **standing battery** run against every subject regardless of what is known, then a **pivot phase** on every source event to map its spread. One finding is not the exposure; the spread is.

**The disambiguation tension (drives the whole design):** anchoring a query with a known handle (employer "PETRONAS", location "Kaleden BC") cuts homonym noise BUT also cuts historical recall — the 2011 Olynyk case *predates* the PETRONAS role, so a PETRONAS-anchored query would miss it. Therefore the battery runs BOTH: unanchored/high-recall queries (broad, noisy) + a mandatory **verification pass** (LLM homonym filter using every intake anchor) rather than pre-filtering the query. Recall in the query; precision in the verifier.

---
## PHASE 1 — Standing query battery (source-event discovery)
Every query is `"Full Name"` (exact) + category terms; `{name}` = exact-quoted full name, plus alias variants. Pagination depth = CSE `start` pages (each page = 1 request, 10 results).

| # | Category | Query shape(s) | Pages | Precision vs noise |
|---|---|---|---|---|
| 1 | **Legal & court** | `{name} (lawsuit OR court OR judgment OR ruling OR "v." OR plaintiff OR defendant OR prosecution OR charged OR convicted OR acquitted OR litigation)` · `{name} site:canlii.org` · `{name} site:courtlistener.com` · `{name} (tribunal OR "human rights" OR appeal OR "small claims")` | 3 | MED precision / MED-HIGH noise (legal terms + common name → homonyms; verifier essential). The Olynyk case lives here. |
| 2 | **Financial & bankruptcy** | `{name} (bankruptcy OR insolvency OR proposal OR lien OR "tax lien" OR creditor OR foreclosure OR receivership OR CCAA)` · `{name} site:canlii.org insolvency` | 3 | LOW-MED / HIGH (financial terms very noisy; registry data often paywalled — CSE weak, flag for dedicated source). |
| 3 | **Professional & regulatory** | `{name} (disciplinary OR sanction OR reprimand OR "license revoked" OR suspended OR barred OR "professional conduct" OR "regulatory action")` · `{name} site:<role-regulator>` (law society / college / securities commission — role-dependent) | 2 | MED / MED. Anchor to profession from intake. |
| 4 | **Media & press** | `{name} (investigation OR alleged OR controversy OR scandal OR reported)` · `{name} (site:cbc.ca OR site:theglobeandmail.com OR site:thestar.com)` · `{name} "<home city>"` | 3 | MED / MED (byline false-positives; older press buried → pagination). |
| 5 | **Personal & social** | `{name}` (bare identity baseline) · `{name} (site:facebook.com OR site:instagram.com OR site:x.com OR site:reddit.com OR site:linkedin.com OR site:tiktok.com)` · `{name} (arrested OR obituary OR mugshot OR wedding)` | 2 | LOW / HIGH (handles + homonyms; requires handle confirmation). Baseline query = current-identity map (this is what a naive scan does — kept, but it is the FLOOR not the scan). |
| 6 | **Corporate & directorships** | `{name} (director OR officer OR founder OR shareholder OR "board of" OR incorporated OR "registered agent")` · `{name} site:opencorporates.com` · `{name} site:<jurisdiction registry>` | 2 | MED / MED. |
| 7 | **Property** | `{name} (property OR "real estate" OR deed OR title OR mortgage OR "assessed value")` · `{name} "<known address/city>"` | 1 | LOW via CSE / HIGH (records behind registries — CSE weak, flag for dedicated source). |

Battery size ≈ **~20–24 query patterns** (some categories carry anchored + unanchored variants). Weighted pagination ≈ **~2.3 pages** → **~50–60 CSE requests for Phase 1.**

---
## PHASE 2 — Pivot on each source event (propagation / spread mapping)
For each Phase-1 source event that clears the verifier, extract pivot terms and re-query — a single finding's spread is the actual exposure. Example (the wiselaw court judgment):

**Pivot-term extraction (per finding, LLM + rules):**
- **Style of cause / case name:** `"Olynyk v. Kilback"`
- **Neutral citation / docket:** e.g. `"2010 BCSC …"` (if present)
- **Parties:** `"Ken Olynyk"`, `"Aaron Kilback"`
- **Distinctive verbatim quote:** `"unskilled, uninformed, incompetent and careless"` — a verbatim string is a near-unique fingerprint and the single highest-precision propagation finder (this is how christopherdiarmani.com surfaced — a DIFFERENT query than the one that found the blog).
- **Event nouns:** `cougar`, `malicious prosecution`, `conservation officer`

**Propagation queries (per event):**
- `"Olynyk v. Kilback"` (case name → legal DBs, blogs)
- `"unskilled, uninformed, incompetent and careless"` (quote → echoes/reposts anywhere)
- `"Ken Olynyk" "Kilback"` (parties)
- Platform-targeted: `site:reddit.com "Kilback" cougar` · `site:x.com` · `site:facebook.com` · `(site:cbc.ca OR site:vancouversun.com) Kilback Olynyk` · `site:archive.org "Olynyk v. Kilback"`

Per event ≈ **~8 queries × ~1.2 pages**. For ~5 pivot-worthy events/scan → **~45–50 CSE requests for Phase 2.**

---
## CLUSTERING — one exposure item, N locations (NOT N findings)
The client must see **"2011 court judgment — findable in 7 places"**, not seven disconnected findings.
- **Deterministic pre-cluster:** group raw findings by shared fingerprints — same normalized URL, same verbatim quote-hash, same case-name/citation, same parties-set.
- **LLM merge:** a clustering pass merges near-dupes that refer to the same underlying fact/event (a news retelling + a forum thread + a blog repost of the same judgment).
- **Exposure item shape:** `{ canonical_description, category, severity, first_seen_date, locations: [{url, platform, date_captured, snippet}], location_count }`.
- Cluster key ≈ `normalize(case_name | parties_set | quote_hash | event)`. The christopherdiarmani echo and the wiselaw blog cluster into ONE item because they share `Olynyk|Kilback|"incompetent and careless"`.
- **Why it matters for remediation:** removing one post is pointless if the story sits in six other places. The location list IS the remediation surface — de-index vs takedown vs suppress is decided per-cluster against ALL its locations, not per-URL.

---
## PRODUCT STANDARD (above the acceptance test) — a finding the subject already knew is not a finding
The report's value is **what the client did not know** — a forgotten indexed record, a data-broker page with their home address, an associate's post naming them, a geotagged photo revealing a property. If a client reads the report and recognises everything in it, we charged $10,000 for a mirror. The acceptance test is the *mechanical* proof (the pipeline surfaces + clusters a target); this standard is the *product* bar.

**PS1 — subject_awareness is the real metric.** Every finding carries `subject_awareness ∈ {known, unknown, disputed}`, **captured at DELIVERY** (with the client, not by the scan). A scan surfacing 12 items where the client knew 11 has FAILED, however cleanly the pipeline ran. This metric — not item count — grades a scan. (Substrate: `subject_exposure_items.subject_awareness`, null until delivery.)

**PS2 — obscurity is a TIEBREAKER among real findings, not a primary sort (CORRECTED 2026-08-20).** The
earlier wording ("obscurity changes ranking") was stated too broadly — it read as a primary sort and let a
buried NON-finding outrank a prominent real one. Obscurity was always meant to rank EQUIVALENT findings: a
buried real finding beats a prominent one because the client has not seen it. A junk result at rank 40 is
not valuable for being buried; it is junk that happens to be buried. Corrected order (implemented as
`compareExposureItems` in `_shared/subject-retrieval.ts`, used by BOTH AEGIS `get_subject_exposure` and the
report so they never disagree):
1. **is_finding** — a real finding (legal matter, breach, documented event) ALWAYS ranks above a bare
   mention. Non-findings never rank above findings regardless of obscurity. Classified from CONTENT, not
   from which query found the item (provenance ≠ classification).
2. **consequence (severity)** — computed from what the thing IS (case name / citation / strong legal-action
   signal → high; financial/professional/media event → medium), NOT from the query that surfaced it.
3. **corroboration** — location count. 18 locations is spread; 1 location is a mention.
4. **obscurity** — the TIEBREAKER among items equal on the above. `found_at_rank` (deeper = higher value);
   an item's obscurity = the shallowest rank it appears at anywhere.
5. **source_class** — `self_published` reported separately (almost always known).
6. **subject_awareness** (post-delivery) — `unknown` > `disputed` > `known`.
The scan sets is_finding + severity + source_class + obscurity; delivery sets awareness.

## COST (per scan)
CSE JSON API: **$5 / 1,000 queries**, 1 query = 1 request (≤10 results); 100 free/day; **hard cap 10,000/day**.

| Phase | Requests |
|---|---|
| Phase 1 battery (~22 queries × ~2.3 pages) | ~55 |
| Phase 2 pivots (~5 events × ~8 queries × ~1.2 pages) | ~48 |
| **Total per scan** | **~100–130** (heavy/thorough end ~180, matching the operator's 60×3 estimate) |

- **CSE fees: ~130 × $5/1000 ≈ $0.65/scan** (heavy 180 ≈ $0.90).
- **LLM: ~$0.05–0.20/scan** — homonym verification (gpt-4o-mini over name-matched candidates) + one clustering pass.
- **HIBP + overhead: negligible.**
- **Total COGS ≈ ~$1–2 per scan.** Against a **$10,000** product that is **< 0.02% COGS** — cost is a non-issue.
- **The real ceiling is throughput, not cost:** 10,000 CSE requests/day ÷ ~130 = **~75 scans/day** before the daily cap. Far above expected bespoke volume; raise the CSE quota or add a SERP API if volume ever demands it.
- **If the PSE were NOT whole-web** (pending panel check): swap to a whole-web PSE (free) or a SERP API (SerpAPI/Bing/Brave, ~$1–15/1000). Even at SerpAPI's higher tier, ~130 × $15/1000 ≈ **$2/scan** — still negligible vs $10k.

**Bottom line:** a thorough two-phase reputational scan costs **~$1–2 in retrieval**; COGS is not the constraint on a $10k product. The constraints are the daily provider cap (throughput) and verification/clustering quality (accuracy).

## ACCEPTANCE TEST (amended 2026-08-19 — reflects what it always tested)
Given "Aaron Kilback": **(1) the wiselaw.blogspot.com Olynyk v. Kilback judgment is surfaced, AND (2) at least one INDEPENDENT propagation location clusters into the SAME exposure item.** (christopherdiarmani was a stand-in for "propagation gets found," not a required specific URL.) **Serper PASSES: wiselaw (rank #1 for the exact case name, where CSE returned 0) + the Vancouver Sun (Dec 2010, via pressreader), clustered as one item** — a stronger echo than a personal-blog repost (higher reach, harder to remove, more likely to be encountered). A retrieval run must pass this before anything ships.

### Open limitation — WO-LONGTAIL-COVERAGE-01 (logged, NOT resolved)
Serper returns **Google organic**, which ranks authoritative sources UP and long-tail personal blogs / forums / obscure sites DOWN. christopherdiarmani exists, is reachable, and Serper does not surface it (`site:christopherdiarmani.com Kilback` → 0 on Serper too). **For reputational exposure, the ugly material often sits on small blogs and forums, not newspapers — so Google organic may systematically under-surface exactly the class of finding a principal most needs to know about.** To test later (not a blocker): run the same harness against Brave and Bing and compare long-tail recall; a multi-provider union may be the answer.
