# WO-CHRONIC-CLASSIFIER — recurrence/CHRONIC keys on finding SHAPE, not the specific incident

**Status:** LOGGED, report only, do NOT fix. **Opened:** 2026-08-31 (operator observation on WO-ALERT-PAUSE
proving runs). Operator: "I have been reading those counts as real."

## The defect (confirmed 2026-08-31)
`platform_findings.occurrence_count` / `first_seen_at` — which drive the CHRONIC label and the recurrence
counts on the watchdog panel — key on the finding's **normalized-title SHAPE**, not the specific incident.

**Fingerprint** (system-watchdog index.ts ~L4620; mirrored in `record_platform_finding()`):
```js
normTitle = title.slice(0,100).replace(/[0-9]+/g,'#');   // ALL digit runs -> '#'
fp = sha256(`${category}|${normTitle}|${job}`);
```
So `"3 tier=interruption … 5260min"` and `"1 tier=interruption … 25min"` collapse to the SAME fingerprint.

**Consequence, observed:** during the WO-ALERT-PAUSE proof, a **synthetic** stuck-anyway row (age 25 min)
was emitted as `"1 tier=interruption…"`. It **upserted the pre-existing interruption-finding row** — inheriting
`first_seen_at=2026-08-28`, incrementing `occurrence_count` to **5**, and being re-opened — so the LLM
labeled it **CHRONIC at 25 minutes old**. A test row inherited the real alerts' multi-day history.

## What this means (the operator's read is unsafe)
- **occurrence_count aggregates across DISTINCT episodes** of the same shape — including resolve→reopen
  cycles and count changes — not a single continuous incident.
- **`first_seen_at` is the shape's first-ever appearance**, so "age since first seen" (which the CHRONIC
  heuristic uses) overstates chronicity for any recurring-shape finding.
- **A brand-new occurrence (or a test row) of a known shape presents as CHRONIC with an inflated count.**
- The digit-normalization was an intentional WO-LEARNING-LOOP dedup (good: "same KIND of problem" = one
  row). The side effect — conflating incident identity with shape identity for the chronicity/recurrence
  signal — was not intended and makes panel counts unreliable as per-incident measures.

## To report on (not fix): options
- Separate **shape identity** (for dedup/one-row-per-kind) from **episode identity** (reset first_seen /
  occurrence on resolve→reopen, or track a per-episode counter), so CHRONIC reflects a genuinely
  continuous condition, not a shape's lifetime.
- Have the CHRONIC heuristic read "continuously-true-since" (last unresolved streak) rather than
  `first_seen_at`.

## Do NOT
Report only. Do not change the fingerprint or the classifier.

## Added 2026-08-31 (operator, log only)
The digit-normalized fingerprint makes `occurrence_count` and `first_seen_at` properties of a **SHAPE, not an
incident**. Therefore **every age and recurrence figure on the panel is unverified**: e.g. "92d / x11",
"101d / x39", "112d / x35" are the age of the **shape's first appearance** and the count of **all episodes of
that shape**, NOT one continuous incident. Do not read any panel age/recurrence as per-incident until fixed.
