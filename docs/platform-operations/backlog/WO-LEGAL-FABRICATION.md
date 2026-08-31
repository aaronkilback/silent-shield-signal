# WO-LEGAL-FABRICATION — legal classifier fabricates cases; contained at display, not fixed at collection

**Status:** OPEN. **Step 1 (this doc):** report only, 2026-08-31. Raised after the `.neq("category","legal")`
suppression surfaced in passing during WO-SCANNER-SOURCE-RESTORE review.

## 1. What WO-LEGAL-FABRICATION-CONTAIN is
**There is no WO/incident doc.** It exists ONLY as code comments (subject-exposure/index.ts +
generate-subject-exposure-report/index.ts). That absence is why it rode a full week of legal-finding work
unmentioned — no tracked artifact to surface it.
- **Opened:** 2026-08-26 (per the subject-exposure comment).
- **Established:** "legal category fabricates lawsuits + mislabels noise. OFF entirely… until the classifier
  is fixed." Containment = blanket-suppress the legal category from display.
- **What the classifier was/is doing** (`_shared/subject-retrieval.ts`, matcher `subject-retrieval-v1-2026-08-18`):
  `matchCaseName` = `/[A-Z]\w+ v. [A-Z]\w+/` grabs ANY two capitalized tokens around "v." (a pub race, a
  rabbit registry, a horse show "WORTH v. WAIT", a law blog quoting "Worcester v. …"). `isRealLegal` fires on
  a citation OR a STRONG_LEGAL word OR (case-name + legal-context) — computed over a snippet that is tied to
  the subject only by a **name-match query**. So a page that merely co-occurs the subject's surname with
  legal-flavored text becomes a **high-severity `Legal case: X v. Y` finding**. Precision guards
  (STRONG_LEGAL, LEGAL_CONTEXT_CLASSIFY, `litigants()` to avoid garbage party-pairs, "only real case gets the
  title") were added to REDUCE it — but the mode is not eliminated at collection.
- **Still open?** YES as a **collection/classification** defect (the classifier still emits fabricated legal
  findings). It was never "fixed"; the containment evolved (see #2). No doc tracked it until this one.

## 2. Where suppression is applied — and a divergence
- **subject-exposure (entity-UI reader):** STILL blanket `.neq("category","legal")` — shows **zero** legal.
- **generate-subject-exposure-report (client report):** blanket exclusion **LIFTED 2026-08-30**, replaced by
  the DB identity-anchor / corroboration gate (`exposure_class`): a legal item shows only if it is an
  `exposure_class='finding'` (adverse + anchored). Query at index.ts:54-61 — no `.neq` legal; three-bucket
  split on stored `exposure_class` (finding / verified_presence / noise).
- **Divergence:** the entity UI hides ALL legal (even the real case); the client report shows the anchored
  one. Same subject, two different truths.

## 3. Why report e7f8af9c shows "Legal case: Kilback v. Olynyk"
Not a bypass — the generator **intentionally no longer suppresses legal** (lifted 2026-08-30, five days
before the 2026-08-31 report). It trusts the DB gate; item `202773a2` is `exposure_class='finding'`,
`anchor_type='single_source'`, `anchor_value='pressreader.com'` → adverse single-source → displayed. So:
the generator does **not** suppress; the item is shown because the corroboration gate anchored it as a
real single-source finding.

## 4. Is Kilback v. Olynyk fabricated? — NO. Real.
The one corroborating source (pressreader → **Vancouver Sun**, "Prosecution policy comes back to bite
Liberals") snippet: *"Ken Olynyk sued the ministry and conservation officer Aaron Kilback after he was
charged twice with the same offence, for shooting a cougar… malicious prosecution."* Real parties, real
"sued", real publication. The 5 other domains (arbormemorial funeral sitemap, facebook = **Kelly Olynyk the
NBA player**, UBC surname directory, wiselaw generic law blog, WSHJA horse show) all failed Gate 1
(`gate_failed='gate1_subject'`) — the name co-occurrences.
- **Could the fabrication mode have produced it? NO.** "Olynyk" was extracted from a genuine "sued" sentence
  naming both parties; STRONG_LEGAL ("sued","malicious prosecution") fired on real legal text about the
  subject. isRealLegal is correct here.
- **One real defect in this finding:** party order. Olynyk is the plaintiff (he sued Kilback) → the case is
  properly **Olynyk v. Kilback**; the classifier titled it subject-first as "Kilback v. Olynyk."

## 5. Legal-item census (all subjects)
`subject_exposure_items` where `category='legal'`: **56 items, ALL for one subject (Aaron Kilback)** — no
other subject has any. **Active (`superseded_at IS NULL`): 1** — `202773a2` (the real case, single_source).
The other 55 are superseded (46 explicit `noise`, plus older findings aged out).
- **Suppressed from display today:** entity UI (subject-exposure) hides all 56. Report generator would show
  only active findings → **1** (`202773a2`). No consumer shows the noise/superseded 55.
- Consumers that read legal: subject-exposure (suppresses), generate-subject-exposure-report (shows anchored
  findings). No other surface renders them.

## 6. What the corroboration gate does and does NOT cover — operator's reading CONFIRMED (with a nuance)
- **Confirmed:** the gate scores **sources** (Gate 1 = subject full name in the snippet; Gate 2 = the finding
  entity/legal context), producing `anchor_type` (source_corroboration / single_source / name_match_only). It
  does **nothing** about whether the classifier's category/title was validly derived — it does not re-judge
  classification.
- **Nuance (indirect containment):** a fabricated legal finding built from bare name co-occurrence tends to
  have sources that fail Gate 1 → 0 passing domains → `name_match_only` → `exposure_class='noise'` → not
  displayed. So the gate **demotes** most fabrication out of the findings view. But it is not a fabrication
  check: a fabricated "X v. Y" that happens to sit on ≥1 page naming the subject's full name AND legal
  context would still pass and display. **The classification-fabrication risk lives entirely upstream of the
  gate.**

## Structural point (the reason this was raised)
The classification fabrication was **contained by hiding output** (blanket suppress → then corroboration-gate
demotion), **never fixed at collection.** The classifier still emits fabricated legal findings; they are now
merely demoted rather than shown. And it was tracked by nothing until this doc.

## Step 2 (2026-08-31) — suppression SHIPPED; classifier rebuild scoped (report-only)

**Suppression reinstated + deployed** (operator-approved): `generate-subject-exposure-report` v46 now carries
`.neq("category","legal")` matching subject-exposure. verify_jwt=true preserved (401 on unauth). Regenerated
report `097ae092` (Kilback): rendered HTML contains **no "Kilback v. Olynyk"**; synthesis P6 = **NOT ASSERTED**
("No court case naming you was found"); Section 5 (Third-Party Exposure) legal-free; all 6 synthesis
primitives still render (P6 flipped to not_asserted, not dropped → numbering intact); sections 1–7
contiguous. Count parity: 1 active legal item exists, both consumers apply identical `.neq` → both return 0.

**Party order (ruled): the classifier cannot determine it.** matchCaseName retired in the rebuild; no
replacement asserts an ordering it cannot verify.

**Classifier — REBUILD, not tune (do not build yet).** Retire `matchCaseName` entirely.
- **Evidence bar for a legal finding:** a citation, OR a CanLII-verified match, OR an explicit
  sued/charged/convicted/judgment sentence naming the subject by FULL name. Never a regex over a
  name-matched snippet; never assert a case name/party order not given canonically by the source.
- **CanLII API scope (verified 2026-08-31):** covers BC + all Canadian courts/tribunals; returns
  citation, court, date, **canonical style-of-cause (fixes party order)**, URL, snippet; search by party
  name/citation. **Free API key**, apply at canlii.org/en/api (gated, describe scope). Rate limits: **1
  concurrent · 2 req/s · 5,000/day hard cap** (ample for per-subject scans). **COMMERCIAL USE = OPEN
  BLOCKER:** free reproduction is for personal use *with attribution*; the terms restrict systematic
  programmatic downloading + commercial applications, and API keys are oriented to research/educational.
  Fortress is a sold product → **explicit CanLII authorization / legal review REQUIRED before building or
  applying.** Do not assume permitted.
- **Unreported-matter gap:** a matter documented in press but absent from CanLII (Olynyk v. Kilback likely
  has no reported decision) is **NOT a legal finding** — it is a **media finding that mentions litigation**,
  titled as the article says (e.g. the Vancouver Sun headline), **no case name asserted, no party order
  implied**, anchored to the news source.
- **Suppress vs media path (RULED 2026-08-31):** legal category stays SUPPRESSED **indefinitely — not "until
  CanLII", but until something AUTHORIZED replaces the classifier** (CanLII blocked on legal review,
  WO-CANLII-INTEGRATION). The media path may surface litigation-in-press sooner. (no regex case
  names). The **media-finding path could surface litigation-in-press sooner** (Kilback/Olynyk would return
  as a real *media* finding with no fabricated case name) — operator to decide whether to open that path
  before CanLII lands.

## Step 1 ends here — Step 2 shipped the suppression + scoped the rebuild. Classifier rebuild NOT started.
