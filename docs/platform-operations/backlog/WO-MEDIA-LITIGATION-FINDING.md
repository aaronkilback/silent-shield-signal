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
