# WO-LEARNING-LOOP — Phase 1 Evidence Report

**Date:** 2026-07-29 · **Scope:** prod `kpuqukppbmwebiptqmog` · **Status:** EVIDENCE ONLY — no changes. Rulings HELD.

Triggered by the 2026-07-28 watchdog finding "Agent learning pipeline has stalled (895h, recurring, no successful remediation)." Headline: **the agents run and report success, but every shared-learning belief store has been write-frozen since 2026-05-27 by INC-LEARN-CONTAM containment (by design), `learning_profiles` is empty, and `knowledge-synthesizer` has never once completed. No remediation was ever dispatched — 92 findings, 0 attempts.**

---

## 1. Agent status (2a) — cron / last invocation / last success / errors

| Agent (job) | Cron registered | Last invocation | Last SUCCESS | Errors |
|---|---|---|---|---|
| `thread-weaver-2am` | ✅ but interval **misconfigured 525600 min (1 yr)** | 2026-07-29 02:00 | 2026-07-29 02:00 (succeeded) | none — runs daily, **writes into frozen `agent_beliefs`** |
| `self-improvement-nightly` | ✅ but interval **525600 min (1 yr)** | **never** (`last_status` NULL) | **never invoked** | n/a — effectively disabled by the 1-yr interval |
| `agent-knowledge-seeker-4am` | ✅ 1440 min | 2026-07-29 04:00 | 2026-07-29 04:00 (succeeded) | none — runs fine, writes into frozen stores |
| `agent-self-learning-proactive-8h` | ✅ 480 min | 2026-07-29 08:42 | 2026-07-29 08:42 (succeeded) | none — runs fine, writes into frozen stores |
| `knowledge-synthesizer-nightly` | ✅ 1440 min | 2026-07-29 05:00 (**status='running'**) | **NEVER** (0 lifetime `succeeded`) | 4 heartbeats stuck `running`, 0 completions in 14d — **genuinely broken** |

**Key:** the "succeeded" agents are the trap CLAUDE.md warns about — the watchdog sees the function *ran*, not that it *did the right thing*. thread-weaver / knowledge-seeker / self-learning all complete successfully and then write into stores that reject the write.

---

## 2. Last belief written + what stopped (2b)

| Store | Last write | Rows | Status |
|---|---|---|---|
| `agent_beliefs` | **2026-05-27 12:15** | 15,533 | **WRITE-FROZEN** by trigger `trg_inc_learn_contam_freeze_ab` (migration `20260527000000_inc_learn_contam_write_freeze.sql`). No `updated_at` column → no evolution updates either. 0 in 7d. |
| `expert_knowledge` | **2026-05-27 08:42** | — | frozen (INC-LEARN-CONTAM) |
| `global_learning_insights` | **2026-05-27 05:00** | — | frozen (INC-LEARN-CONTAM) |
| `learning_profiles` | **never** (`last_updated` NULL) | **0** | EMPTY — the feedback→profile loop (Path A) never populates. Prior diagnosis: `tenant_id`-omission, B-class. |
| `agent_investigation_memory` | 2026-07-29 00:15 | (9 in 7d) | **ALIVE** — the one live learning store |
| `feedback_events` | 2026-07-15 17:27 | (0 in 7d) | feedback inflow itself stopped ~2026-07-15 |

**What actually stopped, and when:** the belief-write freeze is **2026-05-27** (INC-LEARN-CONTAM containment), NOT "~June 21." The watchdog's reported **895h (~June 22) does not match** the real freeze date — May 27 is ~1,516h. **The reported figure under-states the true stall by ~600h**; the watchdog's belief-age computation is anchoring on the wrong/stale metric (a watchdog-accuracy defect in its own right — see §4). Git history 2026-06-17→06-24 is entirely Aegis Voice / Home work (voice reliability, tenant-context, half-duplex gate) — **no learning-related deploy on/around June 21**, so the "June 21" origin is a watchdog artifact, not a real change event. The real root event is the **May 27 containment freeze** (intentional) layered on the **already-empty `learning_profiles`** (Path A never worked).

---

## 3. Why prior remediations failed (2c)

**They did not fail — none were ever dispatched.**

- `watchdog_learnings`: **92 learning-related finding rows** (2026-04-05 → 2026-07-28), max `recurrence_count` **17**, and **`remediation_action` is NULL on every single one** → 0 attempted, 0 succeeded, 0 failed.
- `platform_findings`: "Agent learning pipeline has stalled" first_seen **2026-05-18**, last_seen 2026-07-28, severity **critical**. `knowledge-synthesizer` stuck-running flagged since **2026-05-31**, escalating 3→4→5 invocations across separate finding rows.
- The `trigger_belief_synthesis` remediation exists in the watchdog's action enum but was **never fired** for this finding — the learning stall is effectively flagged-for-human-review with no auto-remediation wired.
- Even if it had fired, the **dominant cause is not auto-remediable**: INC-LEARN-CONTAM is an intentional containment (`Do NOT lift without anonymization gate`). A `trigger_belief_synthesis` call would hit the freeze trigger and fail. So the correct remediation is not "restart synthesis" — it is the anonymization-gate work that INC-LEARN-CONTAM is blocked on.

Side-defect: `occurrence_count` on `platform_findings` reads **1** for each recurrence — the watchdog's fingerprint/dedup is not collapsing recurrences, so a 3.7-month-recurring finding looks like 92 one-offs. This is why it "recurred silently" (§ item 3 backlog).

---

## 4. Ledger — real-vs-aspirational (2d)

**The learning loop has been non-functional since 2026-05-27 (belief stores frozen) and `learning_profiles` has never been populated at all.** This is the **third pillar-grade real-vs-aspirational finding this week**, alongside:
1. **Confidence sparsity** — `composite_confidence` null on ~84% of signals (WO-INCIDENT-QA).
2. **Fleet idle** — self-improvement never invoked; knowledge-synthesizer never completes.
3. **Learning loop stalled** — 63 days of frozen belief stores + empty learning_profiles.

**The moat thesis's operational-memory claim ("the system learns and its archive appreciates") is currently ASPIRATIONAL.** The one store that is actually accumulating is `agent_investigation_memory`; everything the "learning" agents nominally feed (`agent_beliefs`, `expert_knowledge`, `global_learning_insights`, `learning_profiles`) is frozen or empty. Recorded honestly.

---

## PHASE 2 — HELD FOR RULINGS

Surfaced, not implemented:
1. **The real unblocker is the INC-LEARN-CONTAM anonymization gate** — belief stores cannot resume until L2 anonymization/classification ships. This is upstream of any agent fix. Restarting synthesis without it re-opens the contamination.
2. **`learning_profiles` Path-A repair** (tenant_id-omission) — independent of the freeze; the feedback→profile loop is separately broken and empty.
3. **`knowledge-synthesizer` never completes** — a genuine stuck-running defect (0 lifetime success); needs its own diagnosis (timeout / OOM / hang).
4. **Cron misconfig** — `self-improvement-nightly` and `thread-weaver-2am` registered at 525600-min (1-yr) intervals; self-improvement has never run.
5. **Watchdog accuracy** — belief-age metric under-reports the stall by ~600h; `occurrence_count` dedup not collapsing recurrences (feeds item-3 escalation backlog).

**Ruling needed on sequencing:** the learning loop cannot be "fixed" as an agent problem — it is gated on the INC-LEARN-CONTAM anonymization work. The honest options are (a) prioritize the anonymization gate, (b) repair the independently-broken pieces (learning_profiles, knowledge-synthesizer, cron intervals) while beliefs stay frozen, or (c) accept the loop as intentionally-contained and downgrade the recurring-critical to a known-limitation until the gate is scheduled.

---

## PHASE 2 — RULINGS EXECUTED (2026-07-29)

**Item 1 — findings fingerprint dedup (DONE, deployed).** Root bug: fingerprints embedded variable counts/hours from the title, so every recurrence hashed differently → `occurrence_count` stuck at 1 and 261 rows for 49 real findings. Fixed: canonical fingerprint normalizes digit-runs (`record_platform_finding` RPC = single source of truth); historical collapse **261 → 49 rows** (`max_occurrence_count` now 58; synth-stuck 4→1). Unblocks the session-start escalation backlog.

**Item 2 — "runs but does nothing" trap killed (DONE, deployed).** `skipHeartbeat` helper + `has_learning_freeze()` RPC. **Correction to Phase-1 over-generalization:** not all three agents write into frozen stores —
- `agent-knowledge-seeker`: writes ONLY `expert_knowledge` (frozen) → now reports **`skipped`** (verified live: "stores frozen (INC-LEARN-CONTAM)").
- `knowledge-synthesizer`: reads `expert_knowledge` + writes `agent_beliefs` (both frozen) → **`skipped`** (verified live) — this also fixes its stuck-running (skips instantly, no hang).
- `agent-self-learning`: writes BOTH frozen `expert_knowledge` AND **live `agent_investigation_memory`** → does real memory work; now flags `expert_knowledge_frozen: true` in its run summary (skips only if it also produced zero memory).
- `thread-weaver`: writes ONLY live stores (`investigation_threads`/`thread_memories`/`agent_investigation_memory`) → **does real work, not touched.** Phase-1 was wrong to list it as stalled.

**Item 3 — hygiene (DONE).** 4 stuck `knowledge-synthesizer` 'running' rows reaped→failed; reap-on-next-start guard added (the practical run-timeout for platform-killed isolates). `self-improvement-nightly` cleanly disabled — it was a **phantom** (registry-only, never in cron, 1-yr interval); registry annotated DISABLED. Watchdog stall metric **re-anchored** from `last_updated_at` (modification, ~895h) to `created_at` (actual new-belief write, **~1516h true stall**); the finding now recognizes the freeze (`has_learning_freeze`) and reports it as **contained-and-known** ('medium', "no cron action") instead of critical-chase-the-crons.

**Item 5 — LEDGER (positive entry):** **the containment freeze WORKED for 2 months — the system stayed clean.** No contaminated belief crossed from client-scoped to global in that window. The failure was **visibility**, not containment: the freeze status was invisible to the learning jobs (they reported false success), to the watchdog (wrong anchor, no freeze-awareness), and to the operator (buried in muted email). Items 1–3 fix the visibility. Containment itself is a success to bank.

**Item 4 — WO-LEARN-UNFREEZE (NOT NOW, parked):** the real unfreeze. Design doc FIRST against the ratified §2b two-layer belief architecture — what anonymization means concretely, what crosses client-scoped→global, how the INC-LEARN-CONTAM contamination class is provably excluded. Read-only design work; slots **after SENTINEL-1 and the 7-day gate evidence**. No unfreeze code before the doc is ruled. **Interim posture: accept-as-contained, honestly ledgered** — the moat's operational-memory claim stays marked aspirational until writes resume.
