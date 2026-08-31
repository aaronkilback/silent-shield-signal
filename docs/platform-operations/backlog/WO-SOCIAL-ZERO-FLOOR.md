# WO-SOCIAL-ZERO-FLOOR — a zero-row social sweep is more likely a broken search than a clean result

**Status:** LOGGED. **BLOCKED ON: WO-SWEEP-CATEGORY-MAPPING.** **Opened:** 2026-08-31.
**Class:** false-negative / failure-masquerading-as-clean.

## The issue
The social sweep runs two battery queries (`buildBattery`, `_shared/subject-retrieval.ts:95`): the **bare name
paged deep** (5 pages) and **name + `site:facebook OR instagram OR x OR reddit OR linkedin`**. For a real
person, "returned nothing" across both — including a 5-page bare-name search — is effectively impossible from
*content*. The realistic path to a literal zero is **the search failing** — provider error, quota exhaustion,
an empty provider response — which today is swallowed and is indistinguishable from a genuine clean absence. A
client would read the failure as good news.

## What it should do at zero (position, for later ruling)
A zero-row social sweep must NOT render as a clean "returned nothing." It should say the search returned
nothing **and flag it as unexpected / likely a failed search** — i.e. distinguish *search-ran-empty* (verify
the search executed) from *search-failed-empty*. Mechanically the social producer must record whether the
search actually executed (provider ok, non-error, ≥1 page fetched) and the renderer surfaces a failed-empty as
a caveat, never as a result. Same shape as the measured-vs-never-ran (NULL-vs-0) discipline elsewhere.

## Why it is BLOCKED
You cannot detect an anomalous zero while **normal non-zeros are being reported as zero**
(WO-SWEEP-CATEGORY-MAPPING: social's search returned 56 captures for the Kilback subject yet Section 7 reports
"returned nothing"). The zero-detection floor is meaningless until the mapping reports true non-zeros. Fix the
mapping first; then a residual zero is a real signal worth flagging.

## First step when unblocked (do NOT assert without it)
Run the population query across ALL subjects to establish whether a **true zero-row social sweep** has ever
occurred — answer "has it happened" from data, not assertion. Only then design the floor.

## Do NOT
Do not build. Do not touch social-zero until WO-SWEEP-CATEGORY-MAPPING is resolved.
