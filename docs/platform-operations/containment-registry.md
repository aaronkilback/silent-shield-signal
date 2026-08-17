# Containment Registry — standing rule (ratified 2026-07-31)

## Rule
**Every deliberate containment, deletion/deprovision, or freeze of a platform subject (edge function, store,
table, subsystem) is REGISTERED in `public.containment_registry` in the same change that effects it — with a WO
or incident reference.** The watchdog consults the registry and reports registered subjects as
**contained-by-design, not as failures.** An intentional state that is not registered is a health-monitor lie
waiting to happen: the watchdog will re-emit it as a CRITICAL/chronic failure and burn operator attention on a
decision that was already made (attention doctrine — silence over noise).

This is the health-monitor twin of the Registry-is-a-Promise rule: a registered cron is a promise that work is
happening; a **containment registry entry is a promise that a subject is intentionally OFF**, so the monitor
should stop crying wolf about it.

## Table
`public.containment_registry` (RLS enabled, deny-by-default, service-role only). Columns: `subject_type`
(`edge_function|store_freeze|table|subsystem`), `subject`, `state` (`contained_503|deleted|deprovisioned|frozen`),
`wo_reference`, `reason`, `since`, `expected_resolution`, timestamps. Unique on `(subject_type, subject)`.

## Consumer (the point of the table)
`system-watchdog` loads the active set (`state in contained_503|deleted|deprovisioned|frozen`) once per run and,
at the single finding-persist seam (`record_platform_finding`), **reclassifies any finding naming a registered
subject: high/critical/warning → info, and prepends `[CONTAINED-BY-DESIGN — <state>, <wo_reference>]` to the
analysis.** The finding is still visible (not dropped), but it no longer surfaces as a failure/CRITICAL. Registry
absence = no-op (fail-open on the reclassification, never breaks the watchdog).

- This generalizes the pre-existing hardcoded INC-LEARN-CONTAM special-case in system-watchdog (the belief-store
  freeze note) into a data-driven rule. **Label reconciled 2026-07-31:** the watchdog note and the registry both
  now cite **`WO-BELIEF-PROVENANCE-01`** (the live WO) as the unfreeze gate. (Other strategic docs —
  `registry-hygiene-phantom-sweep.md`, `INC-ALERT-DELIVERY-2026-07-29.md`, `WO-LEARNING-LOOP-phase1` — still say
  `WO-LEARN-UNFREEZE` in a broader parking context; sweep those separately if a single canonical label is wanted.)

## Seeded 2026-07-31 (INC-AITOOLS-XTENANT / WO-CHECK5-BURNDOWN-01 week)
- **21 contained_503** deployed stubs: the 15 WO-CHECK5-BURNDOWN-01 LOG-A stubs + aegis-chat, assess-entity
  (batch 1) + entity-deep-scan, correlate-entities (batch 2) + generate-monitoring-proposals, map-policy-to-controls.
- **3 deleted**: fuse-geospatial-intelligence, identify-precursor-indicators, learn-from-investigations.
- **1 deprovisioned**: create-entity (batch-2 "contain-and-de-provision, no caller surfaced" — now absent from
  deploy; **flagged discrepancy**: the operator's tally said "3 deletions" but create-entity is also gone → 4 absent).
- **3 frozen** stores: expert_knowledge, global_learning_insights, agent_beliefs (INC-LEARN-CONTAM, gating
  WO-BELIEF-PROVENANCE-01).

## Maintenance
- When a contained subject is fixed-and-restored or a frozen store is unfrozen, **set `state='remediated'` +
  `remediated_at=now()` — do NOT delete the row** (operator ruling 2026-08-17, WO-VIP-DEEP-SCAN-REMEDIATION-01).
  The disable→re-enable history must persist: `since` = when it was contained, `remediated_at` = when it was
  restored. **Rationale:** vip-deep-scan sat disabled for seven weeks with NO registry entry at all; losing the
  record is exactly the failure. A deleted row erases that the subject was ever contained.
  - `remediated` is intentionally OUTSIDE the watchdog suppression set (`contained_503|deleted|deprovisioned|frozen`,
    L4484), so the watchdog RESUMES reporting real failures for a remediated subject — the "stale registry row
    silences a genuinely-broken subject" hazard does not apply to `remediated` (only to the four active states).
  - `deleted`/`deprovisioned` rows stay as-is (the subject is gone); `remediated` is the terminal state for a
    subject that came BACK.
- Deploy note: the watchdog code change (reclassification at `record_platform_finding`) ships with the normal
  system-watchdog deploy; the registry table + rows are already applied to prod (`wo_containment_registry_01`).
