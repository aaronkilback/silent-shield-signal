# WO-MODULE2-BREACH-DIFFERENTIATION — breach findings are not one class

**Status:** LOGGED for Module #2 (remediation advisor), NOT built (operator ruling 2026-08-19: "Note it
for Module #2 rather than treating all 25 as one class. Everything else stays logged.").

## Context
`subject-breach-check` (built 2026-08-19) writes one `subject_exposure_items` row per HIBP breach
(`category='data_breach'`, `source_class='third_party'`). For the first live subject it produced 25 items.
They are correct as raw findings, but they are NOT yet differentiated in the two ways a client must act on.

## (a) Severity is credential-type derived, NOT recency-aware — stated plainly
`severityFor(dataClasses, isSensitive)` in `subject-breach-check`:
- **critical** = DataClasses ∩ {SSN, Credit cards, Bank accounts, Government IDs, Passport}
- **high** = Passwords present OR IsSensitive
- **medium** = otherwise

**Recency does NOT factor into severity.** So **Adobe (2013)** and a **2024 stealer log** both land at
`high` if both expose Passwords — the client cannot distinguish "historical, likely-rotated" from "recent,
credentials may be live" from the severity band alone. The breach DATE *is* captured and visible
(`first_seen_date` on the item, `published_date` on the location, and the summary text) — but it does not
drive the band. **A client acting on severity alone treats a decade-old breach and a live credential
compromise as the same problem.** That is the gap.

**Module #2 fix:** severity (or a separate urgency axis) must factor recency — a breach in the last
12–24 months weighs materially higher than one from 2013 — combined with credential type. Age is already
in the data; the advisor just has to use it.

## (b) Stealer-log findings are a different remediation CLASS
A **service breach** (Adobe, LinkedIn) → remediation = change the password on that service (+ anywhere it
was reused). A **stealer log** (e.g. "ALIEN TXTBASE Stealer Logs") means **a device was compromised** and
malware exfiltrated credentials from the machine — **a password change does not fix it.** Remediation is
device-level: malware removal / re-image, rotate ALL credentials (not just the breached service), check for
session-token theft. Treating a stealer log as "just another breach with a password" understates it.

**Detection:** HIBP exposes this — the breach `IsStealerLog` flag and/or the Name/Title ("… Stealer
Logs", "ALIEN TXTBASE", "Combolists"). The current writer does not branch on it; all 25 are one class.

**Module #2 fix:** classify `data_breach` items into `service_breach` vs `stealer_log` (device compromise)
vs `credential_stuffing/combolist`, and attach the correct remediation path per class. The device-compromise
path is the one that must not be collapsed into "change your password."

## Cross-refs
`subject-breach-check/index.ts` (severityFor, item write); the reputational Module #1 remediation is
similarly Module #2's job (a finding → what to do about it). Recency data already persisted.
