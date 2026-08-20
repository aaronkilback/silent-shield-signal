# FINDING — consolidate-signals: an unregistered deleter, already fail-safed, but the REPO holds the dangerous version (2026-08-20)

**Type:** FINDING (investigation, report-before-modify — operator held modification). **Do not modify pending ruling.**
**Severity of the finding:** high (unregistered prod object that hard-deleted 6,113 signal rows), **but the active
risk is contained** — the deleter has been OFF since 2026-07-04.

## What invokes it (it is not cron, not registered)
Chain: **`auto-orchestrator`** (`index.ts:471`) enqueues a job `{ action: 'consolidate', hours_back: 24 }` →
**`signal-processor`** job-worker (`index.ts:33` maps `'consolidate'` → `consolidate-signals`) → invokes the
function. So it is an **indirect job**, which is why it has no `cron_job_registry` entry under its own name and
no direct `cron.job`. The 182 `consolidate-signals-quarantined` heartbeats are this path firing.

## It is already fail-safed (repo↔prod drift — prod is NEWER than git)
The **deployed** function (v92) begins with a kill-switch the **repo does not have**:
```js
// WO-DEL quarantine (2026-07-04): deleter disabled unless DEDUP_DELETER_ENABLED='true'.
if (Deno.env.get('DEDUP_DELETER_ENABLED') !== 'true') { /* write heartbeat, return deleted:0 */ }
```
Default-unset ⇒ no deletes. This is why **deletions stopped 2026-07-04 while heartbeats continue** (the no-op path
writes the heartbeat). **The git repo still contains the OLD always-delete code (no env gate).**

### ⚠ The live risk is the repo, not the running function
**A deploy of `consolidate-signals` from the current repo would OVERWRITE the prod kill-switch and re-arm the
always-delete path** (the repo version deletes whenever `!dry_run`, with no `DEDUP_DELETER_ENABLED` check). This is
the WO-LEDGER-RECONCILE hazard in its most dangerous form: git is the unsafe version of a data-destroying object.

## How many rows deleted / recoverable
**6,113 signal rows hard-deleted** (2026-05-07 → 2026-07-04). **Recoverable** from `public.signal_updates` where
`metadata->>'consolidated'='true'` — each carries the dup's `content`, `source`, and
`metadata.{original_signal_id, original_created_at, original_category, original_severity}`. This is enough to
**audit/reconstruct**, NOT a perfect row restore (the original `id`, `signal_number`, `severity_score`, full
`raw_json` are gone). Severity of the deleted: **critical 2,238 · high 3,675 · medium 83 · low 117** (97% crit/high).

## Were the deletions correct? MIXED.
- **Correct (genuine dups):** exact-title / same-content re-reports — e.g. "Suspicious Domain Detected: personai.com"
  merged with another report of the SAME domain (title similarity 1.00). Strategy C (exact normalized title) is safe.
- **The 97% crit/high skew is mostly SYNTHETIC internal signals:** the bulk of deletions were `[PATTERN] Entity
  escalation` / `Geographic cluster` / `Threat type cluster` pattern-detector output — merged ACROSS DISTINCT
  entities/locations by Strategy **A (location-only)** and **D (same-source keyword-overlap ≥0.5)**. Samples show a
  "…escalation for 'home'/'West'/'LNG'" collapsed into a primary about "BC Lions"/"FIFA", and a "Geographic cluster
  near kuujjuaq" merged at similarity **0.31**. **Strategies A and D over-merge** — they collapsed distinct signals.
  Real-world-observation loss is limited because most were synthetic `[PATTERN]` signals, but the over-merge is real.
- Net: exact-title (C) and same-content merges were correct; location-only (A) and keyword-overlap (D) merges were
  not safe and did collapse distinct rows. All recoverable per above.

## Does it need to stop? It already has. What needs a RULING:
1. **Do NOT re-enable the deleter** (`DEDUP_DELETER_ENABLED` must stay unset). Strategies A/D are unsafe as written.
2. **Reconcile git → prod** so the repo no longer holds the dangerous always-delete version (commit the deployed
   kill-switch version, or the retirement below). Until then, redeploy-from-repo is a data-loss footgun.
3. **Retire or formalize:** either de-register/retire the auto-orchestrator→signal-processor `consolidate` job
   (it is a no-op writing phantom heartbeats), or, if signal dedup is wanted, replace A/D with the safe fuzzy
   title key (the brief-dedup pg_trgm approach) — but that is the held THIRD item and comes AFTER this ruling.
