# WO-WATCHDOG-FINDING-TRIAGE (2026-09-09) — triage + durable fix

**Status:** BUILT, PR open (operator merges + deploys). Report-only triage below; rulings applied through a durable mechanism, not per-surface suppression.

## Root cause — two independent producers, no first-class ruling

Watchdog findings were produced by two systems that never agreed:
- **PANEL** (`WatchdogFindingsPanel`) renders `platform_findings` rows written by deterministic probes via `record_platform_finding`. Ruling-aware, but only through **hardcoded substring reclassification** against `containment_registry`.
- **EMAIL** rendered `analysis.findings` = deterministic findings **∪ the AI-analysis path**, which **re-judged severity every run** (ruling-blind), deduped by **title** only, severity never reconciled, and backfilled only open critical/high.

No first-class ruling state existed — a decision lived only as hardcoded text in one probe branch, invisible to the other producer. That single gap caused the duplicate, the panel↔email severity disagreement, and the silent 5-of-8 drop.

## The three mechanisms

- **Duplicate (`monitor-instagram-2h` ×2):** `fingerprint = sha256(category | digit-normalized title | affected_job)` — the same condition under two probe branches with different titles ("structurally broken" HIGH vs "deferred by ruling" LOW) minted two rows; and the structurally-broken loop (`:3463`) never consulted the deferral map (`:3065`) the other loop used.
- **Panel medium/"contained" vs email CRITICAL/"strategic review":** the panel's severity came from the ruling-aware probe; the email's from the AI re-judging raw telemetry, blind to the ruling (which only existed as hardcoded text in the other producer). Merge deduped by title, never reconciled severity → the AI's critical survived.
- **Email 5 of 8:** the email built membership from AI findings + a critical/high backfill and printed a bare "N of M"; the least-severe (info + two lows) were dropped with only a count shown.

## Rulings (operator, 2026-09-09) and disposition

| # | Finding | Bucket | Applied by |
|---|---|---|---|
| 1 | instagram "structurally broken" (high) | **FIX (duplicate)** | structurally-broken loop now skips deferred-by-ruling jobs; condition-keyed fingerprint; the pre-ruling HIGH row resolved as a duplicate |
| 2 | monitor-news-google heartbeat counter drift | **FIX** (separate subsystem) | re-keyed only (`behavioral:heartbeat-counter-drift:…`); the instrumentation repair is its own WO |
| 3 | belief writes frozen (INC-LEARN-CONTAM) | **SUPPRESS w/ ruling** | `finding_rulings` accepted → pinned low, carries the ruling |
| 4 | instagram "deferred by ruling" (low) | **SUPPRESS w/ ruling** | `finding_rulings` accepted (2026-07-15 social audit); the surviving condition record |
| 5 | fleet dormant (capability ledger) | **SUPPRESS w/ ruling** | `finding_rulings` accepted |
| 6 | provenance coverage, 14 sources | **SUPPRESS w/ ruling** | `finding_rulings` accepted (tracked under INC-XTEN) |
| 7 | incident non-citable evidence, n=1 | **SUPPRESS w/ ruling** | `finding_rulings` accepted, `escalate_when_metric_gt = 5` (re-alarms above 5) |
| 8 | registry phantoms, 34 jobs | **FIX severity** | condition-keyed → bypasses the over-broad containment reclassification that wrongly downgraded it to info; now surfaces at **critical** per Registry-is-a-Promise. Triage of the 34 = separate WO |
| 9 | auto_approve "0 approvals while N eligible" | **DISREGARD** | the check counted upgrade proposals the downgrade-only job never approves (the false "83"); **predicate repaired** to count only downgrade/dismiss/false-positive actions (see deviation note) |
| 10 | feedback not updating learning profiles | **FIX** (separate subsystem) | the learning loop is empty (`learning_profiles` 0 rows); repair is its own WO. Note the current probe is aperture-blind (needs feedback>0 to fire) |

**#9 deviation (flagged for merge):** the ruling said "delete the check." I **repaired** its eligibility predicate instead of deleting it — a correct check that counts only what the job can auto-approve preserves a genuine auto-approve-failure detector, whereas deletion loses it. If you prefer literal deletion, say so and I'll remove the P1.1 block.

## Durable mechanism (the fix, not just suppression)

1. **`condition_key`** on `platform_findings` + a stable-key fingerprint in `record_platform_finding` (`sha256('ck:'||condition_key)`) — re-wording a title no longer mints a duplicate. Un-keyed probes fall back to the legacy title identity (no regression).
2. **`finding_rulings`** table (condition-keyed): `accepted` = suppress-with-ruling (pins severity, carries the note, optional `escalate_when_metric_gt`); `disregarded` = the RPC refuses to surface it. RLS-enabled, service-role only.
3. **Both surfaces read the ruling.** The RPC applies it at write time and denormalizes `ruling_state`/`ruling_note` onto the row. Condition-keyed findings bypass the fuzzy containment reclassification (rulings are authoritative). The email is refactored to render from `platform_findings` after remediation — **the AI can no longer mint a parallel severity** for a ruled condition.
4. **The email enumerates what it drops.** Ruled-accepted + info are moved into a "Not shown — ruled or below alert threshold" section listing each title · severity · why — never a bare "N of M".

## Files
- `supabase/migrations/20260909000000_watchdog_finding_rulings.sql` — schema + `finding_rulings` + RPC + seed rulings + re-key/collapse current rows + registry severity fix.
- `supabase/functions/system-watchdog/index.ts` — condition keys on the ruled probes; instagram duplicate guard; registry severity via keying; auto_approve predicate repair; persist loop keys on condition_key; email single-source rebuild + "Not shown" enumeration.
- `src/hooks/useConstellationData.ts`, `src/components/neural-constellation/WatchdogFindingsPanel.tsx` — surface `ruling_state`/`ruling_note`; ruled findings render dimmed under a "Ruled — accepted" divider, out of the active alarm count.

## Out of scope (separate WOs)
- monitor-news-google heartbeat counter-drift repair (#2).
- learning-loop repair + aperture-blind feedback probe (#10).
- Registry-phantom triage of the 34 jobs (#8) — severity fixed here, triage deferred.
