# WO-BREACH-RUN-MARKER — P1 cannot tell a clean breach check from one that never ran

**Status:** LOGGED (report only, do not fix). **Opened:** 2026-08-31 (P1 not_assessed build).

## The problem
`breachChecked` (which gates P1 Credential Compromise into `not_assessed`) is derived from
`breachLastChecked != null`. That value is the latest `date_captured` **across breach locations** — and a
clean run (HIBP returns zero breaches) persists **no** breach locations. So a breach check that **ran and
found zero** and one that **never ran** produce the **same null**, and P1 cannot distinguish them.

## Effect
A genuinely clean subject gets **"credentials not assessed"** instead of the honest positive **"no leak
found."** This is the **safe direction** under anti-fabrication (better to under-claim than fake a clean bill)
and was **shipped deliberately** — but it **swallows a true positive result**: a real, provable clean outcome
is presented as "not evaluated."

## The important part
**The honest clean result currently lives ONLY in the ephemeral response body** of `subject-breach-check`
(the `note`: *"No breaches found for the checked personal emails (a genuine clean result from HIBP)."*). It is
never persisted, so nothing downstream — not P1, not the report, not any consumer — can recover the fact that
the check ran clean. The good-news signal exists for one HTTP response and is then lost.

## Direction (report only, later)
Persist a **positive "breach check executed at T" marker on EVERY run, including clean** — a per-subject /
per-scan run row (or a `last_breach_checked` timestamp on the subject), written regardless of whether any
breach was found. Then P1 reads **did-it-run** from that marker rather than inferring it from the **absence**
of breach items. With the marker: ran-clean → "no leak found (clean)"; genuinely-not-run → `not_assessed`.

Same shape as the never-substitute-absence-for-evidence discipline: absence of a written artifact is not proof
the work was not done, only that nothing was recorded — so record it.

## Do NOT
Do not fix. Report only. This is the correct fix for P1's understatement once picked up.
