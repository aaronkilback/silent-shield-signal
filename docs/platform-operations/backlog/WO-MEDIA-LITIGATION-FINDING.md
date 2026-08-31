# WO-MEDIA-LITIGATION-FINDING — the honest version of what the legal classifier faked

**Status:** APPROVED IN PRINCIPLE, report-only. **Do not build.** **Opened:** 2026-08-31 (WO-LEGAL-FABRICATION
Step 2 ruling #2). Scoping report SLOTS between queue (a)/(b) and (c) — deliver after WO-SIGNAL-STALL, before
WO-SCANNER-DEPLOY-DRIFT Part A. This file is the tracked scope only.

## Principle
A press report that a person was sued/charged is a **real finding with a real source**, asserting nothing
beyond what the article says. `category=media`, never counted as legal.

## Scope to report on (operator's 5 items; last is the acceptance test)
1. **Trigger rule:** the capturing article must **name the subject by FULL name** AND **state the legal event
   in the article's own words** (sued/charged/arrested/convicted/indicted/lawsuit-against/pleaded-guilty…).
   No inference, **no case name, no party order, no citation.**
2. **Title:** the article's own headline or a direct restatement of what it reports — **never a constructed
   "X v. Y".**
3. **Isolation from legal:** it is `category=media`, never counted as legal, and it must **not weaken the
   legal-category suppression** (no legal-by-another-name).
4. **Olynyk render:** show exactly what it would produce for the Olynyk matter (expected: a media finding
   titled from the Vancouver Sun report, no case name, anchored to pressreader/Vancouver Sun).
5. **THE TEST — run the rule against the 46 legal-noise items** and show which return as media findings. The
   **hunting-club post ("65 NEW HUNTERS")** and the **motivational quote ("Most people don't fail…")** MUST
   NOT survive. A narrower classifier that still admits a motivational quote has fixed nothing.

## Do NOT
Report only. Do not build the classifier, do not deploy. CanLII (WO-CANLII-INTEGRATION) is a separate,
legal-blocked substrate; this path needs neither CanLII nor a key.

## Step 1 scoping (2026-08-31) — report only, not built

### Proposed rule (deterministic, no LLM, no inference)
A capture yields a **media** finding iff, ON THE SAME location's stored text (snippet+title), BOTH:
- **M1 subject full name** — `\yAaron\s+([A-Z]\.?\s+)?Kilback\y` (or `Kilback, Aaron`). Bare surname fails.
- **M2 explicit legal event** — `sued|charged|convicted|acquitted|arrested|indicted|lawsuit|pleaded guilty|
  found liable|prosecuted|malicious prosecution`.
No inference, **no case name, no party order, no citation.** `category='media'`, never counted as legal;
the legal-category suppression is untouched (a media finding is not a legal finding).

### Title
The **article's own headline** = the location's `title` (e.g. "Prosecution policy comes back to bite
Liberals | Vancouver Sun"). Never a constructed "X v. Y".

### Olynyk render (item 4)
The real matter (active item 202773a2) → a **media** finding titled "Prosecution policy comes back to bite
Liberals | Vancouver Sun", anchored to pressreader/Vancouver Sun, **no case name, no party order** — the
honest version of what the legal classifier was faking.

### THE ACCEPTANCE TEST — run against all 56 legal items (46 noise + findings)
**PASSES.** Media path survives on **exactly 4 items — all the REAL Olynyk/Kilback malicious-prosecution
matter** (incl. the active "Kilback v. Olynyk" = 49/54 locations carry name+event, and the Vancouver Sun
article). **Everything else is rejected**, including:
- **"Let's welcome our new members: 65 NEW HUNTERS!!" → REJECTED** (0 name, 0 event). ✅ hunting-club post does NOT survive.
- **"Most people don't fail because they lack information" → REJECTED** (name present, 0 event). ✅ motivational quote does NOT survive.
- Every fabricated case name — Kilback v. Photo/Permanent/Most/Technology/Security/They/View/Wearable,
  Filing/Countering/Arms/Alaska/Craggs/Gavin/Harcros/Jeffries v. Kilback — **REJECTED** (name without a
  legal-event verb, or an event word without the full name; M1∧M2 co-location required).
- All Instagram/LinkedIn/quote/directory noise — REJECTED.
The `Filing v. Kilback` row is instructive: it had a location with an event word but 0 with the full name →
rejected, because M1∧M2 must co-occur on the SAME capture.

## Step 2 (2026-08-31) — build conditions reported, awaiting verb-list ruling

### Condition 1 — M2 verb list, FP risk (population-before-check)
**Empirical result against the 56-item / 215-location corpus: current M2 = 4 TP / 0 FP. All 7 candidate
terms = 0 occurrences** (settled 0, under-investigation 0, allegation 0, complaint 0, cleared 0, wrongdoing
0, filed 1 — the one "filed" is the fabricated *"Filing v. Kilback"* noun). **The corpus is one subject with
ONE real legal matter (Olynyk), so it CANNOT validate the candidate verbs** — their real-world FP risk is
unmeasurable here. Reported honestly, not papered over.
- **Reasoned (not measured) per-term FP risk:** `settled` bare = HIGH (settled area/estate/down) — exclude
  or require "settled the (suit|lawsuit|claim|case)"; `cleared of` bare = MOD-HIGH (snow/debris) — require
  "cleared of (charges|wrongdoing)"; `under investigation` = LOW-MOD (mitigated by M1 co-location); `faces
  allegations` = LOW-MOD; `named in a complaint` = LOW; `filed against` = require object "(suit|lawsuit|
  complaint|claim) filed against" (bare "filed" too broad); `denied wrongdoing` = WEAK — not an event by
  itself, do NOT make it a standalone trigger.
- **Recommendation:** ship the PROVEN current M2 now (4TP/0FP). Treat candidates as UNVALIDATED — add only
  with the constraints above, and MEASURE FP as more subjects are scanned (measure-before-and-after). Await
  operator ruling on the final list before building.

### Condition 2 — subject line (verbatim, not generated) — Olynyk render
- **Title (headline, kept):** `Prosecution policy comes back to bite Liberals | Vancouver Sun`
- **Subject line (near-verbatim from the stored snippet — the sentence carrying M1∧M2):**
  *"Ken Olynyk sued the ministry and conservation officer Aaron Kilback after he was charged twice with the
  same offence, for shooting a cougar…"*
- **Source:** pressreader.com (Vancouver Sun). **No case name, no party order, no citation.** `category='media'`.
- Renderer rule: subject line = the passing location's stored snippet sentence(s) containing the full name +
  the legal-event verb, verbatim/trimmed — never synthesized.

## Verb-list ruling (2026-08-31, operator): ship current M2; candidates DEFERRED with constraints
Final M2 (shipped): sued | charged | convicted | acquitted | arrested | indicted | lawsuit | pleaded guilty
| found liable | prosecuted | malicious prosecution.

**Deferred candidates — the CONSTRAINED forms are the versions to test later (never the bare terms):**
- `settled the (suit|lawsuit|claim|case)`
- `cleared of (charges|wrongdoing)`
- `(suit|lawsuit|complaint|claim) filed against`
- `under investigation`
- `faces allegations`
- `named in a complaint`
- **`denied wrongdoing` — EXCLUDED PERMANENTLY** (presupposes an accusation; not itself an event).

**Revisit trigger (condition, not a date):** when **five distinct subjects** have been scanned, OR the **first
real legal-in-press capture that current M2 misses** — whichever comes first. To make the second trigger
observable: **when a capture passes M1 but fails M2, record it** (not a finding, not displayed — countable),
so a too-narrow list is learnable. Implemented as `subject_exposure_locations.m1_pass` / `.m2_pass`.
