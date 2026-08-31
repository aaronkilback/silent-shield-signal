# WO-SRCRANK-LIVE-UNTRACKED — a client-report ordering change reached prod untracked

**Status:** LOGGED (do not start). **Opened:** 2026-08-31 (WO-LEGAL-FABRICATION Step 2 ruling).
**Not a defect in the change — a defect in knowing.** Operator: third-party-above-self-published is the
right ordering; NOT reversing it.

## What happened
`SRC_RANK` (authorship weighting in `compareExposureItems`, `_shared/subject-retrieval.ts`: third_party
sorts above self_published) is **live in the client report path** — bundled into
`generate-subject-exposure-report` **v42+ and the current v45** (deployed 2026-08-30 19:45Z, after the
SRC_RANK commit 7943b7b7 at 13:57Z). It changed the ordering of findings in every report generated since,
**including report e7f8af9c** — and it reached prod purely as a **side effect of redeploying the generator
for an unrelated reason**, recorded nowhere. It was believed to be "undeployed, awaiting ruling"; it was
neither.

## Why it matters
- A behavioral change to customer-facing output shipped with no decision record. The only reason it
  surfaced was tracing the `.neq` deploy's `_shared` bundling during WO-LEGAL-FABRICATION.
- Same class as the stale-ai-gateway hiding in content drift: **content drift lets `_shared` behavior
  changes ride any function's redeploy, untracked.** Cross-reference **WO-DEPLOY-LANE-REPAIR** (content-drift
  dimension) and the Population-Before-Check / Track-Every-Containment standing rules.

## The authorship model is HALF-SHIPPED
- **Consumer LIVE:** `SRC_RANK` sort in the generator (v45) — active.
- **Producer NOT shipped:** nothing populates `source_class` on scan (subject-retrieval v43, the scanner,
  predates it and is the unlanded orphan). `compareExposureItems` defaults absent `source_class` to
  `third_party`, so **SRC_RANK currently sorts everything as third_party → a no-op in practice.** It only
  *becomes* behavior once the producer ships. So it is live-but-inert today, which is its own trap: it will
  silently change report ordering the day the producer lands, again with no decision gate.
- **Ruling required:** decide `SRC_RANK` (consumer) and **WO-SELF-PUBLISHED-CLASS** (producer:
  `source_class` population + the self-published-vs-third-party classification) **together** — they are one
  authorship model, currently split across a shipped half and an unshipped half.

## Do NOT (per ruling)
Do not reverse SRC_RANK, do not ship the producer. Log only; rule the two together later.
