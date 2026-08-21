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

## #4 RECONSTRUCTION REPORT on the 6,113 deleted rows (2026-08-21)

### Synthetic vs real
- **3,692 synthetic `[PATTERN]` rows** (3,566 crit/high, all `active_threat`) — internal pattern-detector output
  (entity-escalation / geographic-cluster / threat-type-cluster). Regenerable; low restore value.
- **2,421 REAL observations** (2,347 crit/high) across 17 categories (civil_emergency, wildfire, activism,
  crime, malware, phishing, protest, regulatory, operational, environmental, litigation, …). **Not "mostly
  synthetic" — 40% were real.**

### Real observations by client + defensibility (similarity of deleted row to its surviving primary)
| client | real rows | defensible dup (sim≥0.6) | OVER-MERGE (sim<0.5) | avg sim |
|---|---|---|---|---|
| Kilbacks (test/personal) | 2,106 | 2,078 | 27 | 0.98 |
| BC Place | 206 | 194 | 12 | 0.77 |
| **Cascade Energy** | 57 | 11 | **39** | 0.39 |
| **Petronas Canada** | 11 | 2 | **8** | 0.34 |
| test/_qa/_benchmark | ~43 | ~25 | ~11 | — |

- **Correct (Strategy C, exact title / same content):** the bulk — Kilbacks 0.98 avg = near-exact re-reports.
- **NOT defensible (Strategy A location-only + D keyword-overlap):** **~59 distinct real observations for actual
  customers** (Cascade 39, Petronas 8, BC Place 12) collapsed at sim 0.10–0.29 into unrelated/over-generic
  primaries. Examples (Cascade): a **homicide trial** ("Crown delivers closing submissions … Christopher
  Cathcart") → "Evacuation Order Issued" (0.10); an **out-of-control wildfire near Boston Bar** → "Alberta
  Proposes New Pipeline" (0.10); distinct **West Kelowna / Lytton / Boston Bar evacuation orders** (critical/high
  civil_emergency) → generic "Wildfire Activity in B.C." These are real, operationally-significant events wrongly
  destroyed. This is what strategies A and D do — no threshold rescues them (ruling #2 removes them).

### What a reconstruction from signal_updates restores — PARTIAL (not full row, better than reference)
Preserved per deleted row: `content` (normalized_text/title), `source_name`, `source_url`, `original_category`,
`original_severity`, `original_created_at`, `original_signal_id`. Client is recoverable from the surviving
primary (same cluster). **LOST:** `signal_number`, `severity_score` (numeric), `raw_json` (the full evidence
payload — IOC indicators, CAP identifiers, `entity_tags`, publisher provenance), `event_date`, `relevance_score`,
`tenant_id`. So a restore faithfully re-creates the OBSERVATION (text + source + category + severity + date) but
NOT the original row identity or structured evidence. Adequate for news/observation signals; lossy for
structured IOC/CAP signals (their indicators lived in raw_json).

### Downstream references — NONE (chain of custody INTACT)
- `incidents.signal_id` → deleted: **0** · `incident_signals.signal_id` → deleted: **0** ·
  `alert_emission_refusals.signal_id` → deleted: **0**.
- reports/briefs `meta_json` → deleted: **0** (scan validated — 107 meta_json UUID mentions match *existing*
  signals, 0 match deleted). **No delivered brief cites a hard-deleted signal.**
- `signal_updates` rows pointing at a hard-gone primary: **0** (every survivor exists; 87 Kilbacks primaries are
  soft-deleted-but-present). No broken provenance chains anywhere.

### Restore recommendation (operator decides)
Do NOT restore the 3,692 synthetic `[PATTERN]` rows or the ~2,100 correct near-exact dups. The restore candidates
are the **~59 real-customer over-merges** (Cascade 39, Petronas 8, BC Place 12) — distinct real observations
wrongly deleted, reconstructable as PARTIAL signals (content/source/category/severity/date; no raw_json). Nothing
downstream breaks either way, so restore is a completeness decision, not a chain-repair emergency.

## Does it need to stop? It already has. What needs a RULING:
1. **Do NOT re-enable the deleter** (`DEDUP_DELETER_ENABLED` must stay unset). Strategies A/D are unsafe as written.
2. **Reconcile git → prod** so the repo no longer holds the dangerous always-delete version (commit the deployed
   kill-switch version, or the retirement below). Until then, redeploy-from-repo is a data-loss footgun.
3. **Retire or formalize:** either de-register/retire the auto-orchestrator→signal-processor `consolidate` job
   (it is a no-op writing phantom heartbeats), or, if signal dedup is wanted, replace A/D with the safe fuzzy
   title key (the brief-dedup pg_trgm approach) — but that is the held THIRD item and comes AFTER this ruling.
