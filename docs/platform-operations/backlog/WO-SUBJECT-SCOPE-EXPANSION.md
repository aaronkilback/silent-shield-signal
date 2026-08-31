# WO-SUBJECT-SCOPE-EXPANSION — scan beyond the principal

**Status:** LOGGED (do not scope, do not build). **Opened:** 2026-08-31 (operator direction).
**Recorded so it is not lost.**

## Direction
The platform should be able to scan **household members, contractors and workers**, not only the principal.
Online vulnerability exposure is the primary use.

## Three groups — three different problems. Do NOT build them as one feature.

### WORKERS / CONTRACTORS — the commercial case
A client engaging Silent Shield for named staff. **Largest revenue shape** (many subjects per client).
- Consent question: does the **company** authorize, or must **each individual**?

### ADULT HOUSEHOLD — closest to current capability
Consent is the principal's household, but **each adult is their own subject**.
- Concrete in-code manifestation today: **WO-FAMILY-SCAN-GAP** (identities held, never scanned).

### MINORS — hardest, and not primarily technical
The current refusal (no DOB provided → cannot confirm adult → refuse) is **correct and stays the default**
until there is a policy behind it.
- Open questions: who consents; what a minor's report may contain; whether a stored, emailable artifact
  about a child should exist at all.
- **Starting position for later argument (not a decision):** a minor's findings are delivered to the parent
  as **remediation items**, with **no stored report and no email delivery**. The value is knowing what to
  take down, not holding a dossier.

## BLOCKED ON
**Consent model, per group.** Counsel question. Sits with the CanLII terms question and the PECL IP position.

## Do NOT
Do not scope. Do not build.
