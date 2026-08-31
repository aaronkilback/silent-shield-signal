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
