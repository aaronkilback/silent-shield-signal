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

## CORRECTION 2026-08-31 — SRC_RANK is FULLY LIVE, not a no-op (my earlier claim was wrong)
- **Producer IS shipped.** `source_class` population (`isSelfPublished` → third_party/self_published) is in
  the DEPLOYED scanner **v43** (line ~334) — NOT in the repo-vs-v43 diff. Stored items carry it: **261 have
  source_class (191 third_party / 78 self_published / … ), 65 ACTIVE self_published.** Only 6 are null (0 active).
- **Consumer IS live.** The generator (v45, since 2026-08-30) sorts those populated values by SRC_RANK →
  **third-party findings have been rendering ABOVE self-published in client reports for a day.** This is real
  behavior, not inert. My prior "defaults everything to third_party → no-op" statement was **incorrect** and
  is retracted here.
- **The scanner deploy (Part A) adds nothing new for SRC_RANK.** The scanner only *exports*
  `compareExposureItems` (consumers = generator + dashboard-ai-assistant); it never calls it. So shipping the
  scanner just syncs its exported copy — behaviorally inert for the scanner.
- **Ruling still required** on the authorship model (SRC_RANK ordering) with **WO-SELF-PUBLISHED-CLASS** — but
  note it is ALREADY affecting client output, so the ruling is on live behavior, not a pending change.

## Do NOT (per ruling)
Do not reverse SRC_RANK, do not ship the producer. Log only; rule the two together later.

## CLOSED-WITH-FINDING (2026-08-31, operator)
Not reversing SRC_RANK — the third-party-above-self-published ordering is correct and has been live in client
reports since 2026-08-30 (producer in scanner v43, consumer in generator v45). **The finding is not the sort
order — it is that determining WHAT WAS ACTUALLY DEPLOYED took THREE passes today** (first "undeployed/awaiting
ruling", then "live in generator but no-op", then "fully live producer+consumer"). That difficulty of knowing
running-state is the defect — the same class as WO-DEPLOY-LANE-REPAIR (content drift) and the whole
git-≠-prod theme. **Dropped from the queue: SRC_RANK was never awaiting a ruling.** WO-SELF-PUBLISHED-CLASS now
inherits ONLY the classification question (self-published vs third-party), NOT the ranking one (settled: live,
correct, kept).
