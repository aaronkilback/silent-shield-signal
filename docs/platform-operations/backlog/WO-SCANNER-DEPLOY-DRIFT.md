# WO-SCANNER-DEPLOY-DRIFT (2026-08-31) — control defect, priority ABOVE queued report-wording fixes

**Discovered incidentally** during WO-EXPOSURE-CORROBORATION when the corroboration gate couldn't be
deployed for future scans.

## The defect
`subject-retrieval` runs the reputational scanner in **prod at version 43** with **no
`functions/subject-retrieval/index.ts` in the repo** (unlanded orphan). Worse, the repo's
`_shared/subject-retrieval.ts` is **ahead of the deployed build** by an undeployed change:

```
+ const SRC_RANK = { third_party: 0, self_published: 1 };   // authorship weighting
+ source_class ranking in compareExposureItems (third-party exposure ranked above self-published)
```

**Net effect: the code running the scanner is not the code in the repo, and the delta was only found by
accident.** This is a control defect (git ≠ prod for a core producer), not a feature defect.

## Scope
1. Restore `functions/subject-retrieval/index.ts` to the repo from the deployed build (verified against
   live, not trusted).
2. Establish what else has drifted between repo and deployed **across the whole function set** (git↔prod
   parity audit — same class as `scripts/security-gate/drift-baseline.json`, extended to entrypoints).
3. Rule on the pending `SRC_RANK` authorship change **deliberately**, not as a side effect of another deploy.

## Cross-references
- **WO-SELF-PUBLISHED-CLASS** — the undeployed `SRC_RANK` change (third_party vs self_published ordering)
  is prior work on the SAME authorship problem that WO-SELF-PUBLISHED-CLASS addresses (self-published
  content mis-classed as third-party mention). Decide the authorship model **once**, here, not twice.
- Root of the disabled-function-deploy-lane orphan class (`project_built_but_unconnected` memory).

## Blocked/interim state left by WO-EXPOSURE-CORROBORATION
The corroboration gate is live for EXISTING rows (backfilled + counter trigger) but NOT for FUTURE scans
until `subject-retrieval` ships. New scans land `corroborates=false` / `gate_failed='not_gated'` —
undercount (safe direction, amendment 1), but currently invisible (no probe on `not_gated`). WO does not
close until the gate is live for new scans.

## Part A CLOSED (2026-08-31) — scanner deployed from repo; orphan closed; gates live on new scans
`subject-retrieval` now deploys **from repo source** (entrypoint landed + committed to main; `verify_jwt=true`
confirmed by 401). The git-≠-prod orphan for the scanner is closed. config.toml now carries verify_jwt for all
5 subject-* functions (view=false, others=true).
- **What shipped (exhaustive):** corroboration-gate wiring (ACTIVE) + media-litigation classify wiring (NEW,
  ACTIVE) + ai-gateway fixed version (first propagation to scanner, behaviorally INERT — scanner uses
  gpt-4o-mini not sonar) + SRC_RANK in exported compareExposureItems (INERT — scanner never calls it). Four
  other _shared modules byte-identical.
- **Fresh scan proof (Kilback, scan 890d604b, completed):** 140 new locations gated at scan time —
  `gate_failed` = {passed 131, gate2_entity 3, gate1_subject 6}, **ZERO not_gated**; global Probe-2i not_gated
  = **0**. → **WO-EXPOSURE-CORROBORATION CLOSED** (was PARTIAL; the gate is now live for new scans, oracle met).
- **Media gate live at classify time (item-4 real test PASSED):** the Olynyk matter was **re-found this scan**
  (`202773a2.scan_id=890d604b`) and **classified `category='media'` LIVE** (headline + verbatim subject line,
  no case name) — NOT carried over from the reclassify pass. → **WO-MEDIA-LITIGATION-FINDING scanner-wiring
  deferral CLOSED.**
- **Miss telemetry live:** 69 M1-pass/M2-fail misses recorded on this scan's captures (WO revisit-trigger).
- **Legal fabrication (operator check):** this scan produced **0 legal items** (media 1 + mention 67). The
  fabrication code path (`isRealLegal → category='legal'`) is UNCHANGED (media is additive, checked first);
  it simply did not trigger on this scan's captures. So fabrication is NOT fixed — the capability remains
  (WO-LEGAL-FABRICATION still open, classifier rebuild pending) — it just didn't manifest this run.
- **Remaining (not Part A's blocker):** the other 4 subject-* functions have repo entrypoints but still run
  their old orphan-deployed versions; redeploy for git↔prod parity is optional. The repo-wide parity audit
  (original Part A item 2) remains.
