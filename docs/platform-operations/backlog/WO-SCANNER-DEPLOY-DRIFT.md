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
