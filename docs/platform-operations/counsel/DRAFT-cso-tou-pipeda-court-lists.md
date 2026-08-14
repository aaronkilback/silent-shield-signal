# DRAFT for counsel — BC court-list monitoring (two questions)

**Status:** DRAFT for operator to send. Not sent. Belongs in the INC-AITOOLS-XTENANT counsel thread.
**Prepared:** 2026-08-14. **Court-registry build is gated on the answer to Q1.**

---

**To:** [counsel]
**Re:** INC-AITOOLS-XTENANT — two questions on monitoring BC court records

We are scoping a feature that would monitor **BC Daily Court Lists** (the daily criminal and civil hearing lists) to detect when a **client organisation** appears as a party to a proceeding. We want your ruling on two questions before we build anything. The second question concerns a deferred capability we are **not** building yet but want settled in the same thread.

## Q1 — CSO Usage Agreement and automated access (gating)

The BC Daily Court Lists are published through **Court Services Online (CSO)** at `justice.gov.bc.ca/cso/courtLists.do` — civil updated daily by 06:00 PST, criminal by 06:30 PST, selected per courthouse. The lists are not archived (civil), so any monitor must retrieve them **daily and automatically**.

Fortress is a **commercial** security-monitoring product. The CSO E‑Search Usage Agreement contains, among others:
- a prohibition on decompiling / reverse-engineering CSO or its databases;
- a prohibition on **"alter[ing] the format or content of a print or display"** of CSO information;
- **"read-only"** access limited to authorized UserID/password;
- **"court record information … may not be copied or distributed in any fashion for resale or other commercial use without the express written permission"** of the relevant Chief Justice / Chief Judge.

**Question:** Does the Usage Agreement permit a commercial security firm to **programmatically and automatically retrieve the Daily Court Lists on a recurring (daily) basis**, and to match them against our clients' organisation names, for the purpose of alerting those clients that they appear as a party? Specifically:
1. Do the "no altering the format of a display" and "read-only / authorized-credential" clauses prohibit automated/scripted retrieval (as opposed to manual eSearch)?
2. Does surfacing a match (party name + file number + registry + hearing date) to a paying client constitute **"resale or other commercial use"** requiring the express written permission of the Chief Justice / Chief Judge?
3. If it would otherwise be prohibited, **what authorization would make it permissible** — written permission from the Court, a subscription/licensing tier, a data-sharing agreement, or a different sanctioned access channel? Is there an approved bulk/commercial access path for court-list data in BC?

We will not retrieve CSO data programmatically until we have your answer.

## Q2 — PIPEDA and matching named individuals (deferred; asking now)

Separately, and **not** part of the initial build, we may later match **named individuals from our internal entity graph** — client executives and other persons we are engaged to protect, and, distinctly, adverse persons of interest (e.g. an identified harasser) — against the same court lists. This would create an **automated, retained record of specific individuals' court appearances**.

**Question:** What PIPEDA obligations attach to systematically collecting, matching, and retaining court-list information keyed to named individuals for a commercial security purpose? In particular:
1. Does the **"publicly available information" exemption** (PIPEDA Regulations s.1 — court/tribunal records) extend to **systematic automated collection, matching, and ongoing retention** for a commercial monitoring service, or is it narrower than the raw fact that the record is public?
2. Does the analysis differ between a **protected person** (our client's principal, arguably with a protective interest) and an **adverse third party** (a person of interest who has not consented and is not our client)?
3. What obligations — consent, purpose limitation, accuracy, retention limits, openness, right of access/correction — would we need to satisfy, and are any of them disqualifying for the adverse-third-party case?

We are holding person-matching entirely pending this answer; the initial build is **organisation-name only**.

## What we need back
A go / no-go on Q1 (with any conditions or required authorization), and a risk assessment on Q2 with the obligations that would apply if we later proceed. Q1 is gating; Q2 is informational-but-important.
