# WO-BROKER-PAGE-FINDING-CLASS — broker contact pages are `exposure_class='finding'`, unranked against real events

**Status:** LOGGED (do not fix). **Opened:** 2026-08-31 (WO-SWEEP-CATEGORY-MAPPING title-order deviation).

## What surfaced
Two broker contact pages — `1efebb4a` ("Aaron Kilback Email & Phone Number | PETRONAS Canada …") and
`35c9b840` ("Contact Aaron Kilback, Email: a***@petronascanada.com & Phone …") — carry
`exposure_class='finding'` (severity `low`, 1 location each). Because they are findings, they contributed to
the social row's "contributed to a finding" outcome, and — before the ordering fix — one of them *led* the
row instead of the medium-severity litigation news story (`202773a2`, "Prosecution policy comes back to bite
Liberals", 63 locations).

## What is / isn't a defect
- Whether a broker listing of a work email + phone is a *finding* is arguable — it may well be one.
- The defect surfaced here was that **nothing ranked it against a litigation news story**, so a directory page
  could lead a coverage row. That SYMPTOM is fixed by the deterministic title order in WO-SWEEP-CATEGORY-MAPPING
  (severity desc → finding-class → most locations → title alphabetical).
- The OPEN QUESTION (not for now): should broker-contact pages be a **finding class of their own**, distinct
  from event-based findings (litigation, breach, misconduct)? A separate class would let the report rank and
  present them as what they are (a contactability/exposure fact) rather than lumping them with adverse events.

## Do NOT
Do not fix now. The ordering fix handles the symptom. Revisit the class distinction as a classifier question.
