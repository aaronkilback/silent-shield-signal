# DIAG 2026-08-04 — (1) DR storage backup never ran on cadence · (2) quarantine spike

**Diagnostic only — no fixes applied.** Prod `kpuqukppbmwebiptqmog`.

## 1. DR storage backup (`dr-storage-backup-daily`) — cadence NEVER ran; one-time snapshot IS real

| question | finding |
|---|---|
| Cron registered + enabled? | **YES.** `cron.job` jobid 220, `dr-storage-backup-daily`, schedule `23 8 * * *` (08:23 UTC), `active=true`, command `net.http_post(...dr-storage-backup?mode=cron...)`. |
| Registry name matches heartbeat name? | Registry `cron_job_registry.job_name = dr-storage-backup-daily` (is_critical, 1440m) **matches** the cron jobname. But `cron_heartbeat` has **0 rows** under *any* dr/backup/restore name — there is nothing to match against; the fn has never emitted a heartbeat. |
| Ever executed (monitored path)? | **NO.** 0 heartbeats ever · `registry_phantom_check()` → `has_cron=true, ever_succeeded=false` (confirmed **registry phantom**) · 0 `edge_function_errors` for the fn. |
| Function state | **HARD-DISABLED 503 stub** since 2026-07-31 (v18, INC-AITOOLS-XTENANT-2026-07-30). Was a **deploy-drift orphan never in git** (`git log -S cron_heartbeat` on the fn path = empty), `verify_jwt=false`, gated only by a **compromised** `x-smoke-key`; it read every tenant bucket + could DELETE R2 objects. So for the last ~34 days the daily cron POSTs and gets a 503. |
| ss-fortress-dr bucket now | R2 (external to Supabase). **Bucket exists, created `2026-07-06T16:07Z`** (verified via `wrangler r2 bucket list`). Exact object count / latest write **not enumerable from here** (wrangler has no bulk-list; needs the R2 S3 creds). Per ledger the 2026-07-06 run copied **498 objects, additive/never-delete**, so the bucket most likely still holds that snapshot. |
| Test-restore performed, or WO closed on a code change? | **The one-time backup + test-restore WAS performed and documented 2026-07-06** (`ops/ledger/WORK-ORDERS.md:314-322`): 498 objects copied, per-prefix **byte-identical** test-restores (investigation-files 61 / hostile-evidence 1 / archival `_unresolved` 365 / tenant-files `_system` 71), tenant isolation proven. **NOT a pure code change.** BUT the **daily-cadence half** was closed on "test-fired successfully" + "registry+heartbeat wired" — **both contradicted by 0 heartbeats ever.** The recurring backup was accepted on a single-shot claim monitoring never corroborated (the single-event-proxy acceptance anti-pattern already flagged in `docs/platform-operations/wo-coverage-82-retirement-spec.md`). |

**Net:** a **real point-in-time snapshot from 2026-07-06 exists** (bucket confirmed) — so it is *not* true that there has never been any proven backup. But **no daily incremental has ever run** through the monitored path, and the fn has been a 503 since 2026-07-31. Everything created/changed in Storage since 2026-07-06 is **unprotected**, and the neural "last: never" is accurate for the cadence. Belief that daily DR was live for a month was wrong; the initial backup belief was right.

## 2. Quarantine spike — catching fabrication at volume, NOT suppressing PECL

Last 24h: **39 signals total, 22 quarantined (56%)** — all 22 `fabricated_client_match_auto`, **0 other reasons**.

- **Distinct clients affected: 1 — Kilbacks.** `pecl_suppressed = 0`. **No PECL coverage is being suppressed.**
- **Trigger keywords:** `asset:Home` (~16) and `asset:cabin` (~6) — both ≤5-char **asset labels** matching generic English words. This is exactly the known fabrication signature.
- **Titles (all Kilbacks, none genuine Kilbacks intel):** WestJet cabin-crew-strike cluster (×~9, via "cabin"→"cabin crew"); "Support for Seniors Staying at Home", "Hybrid Work in Parliament"×2, "Belugas moved to U.S.", "Trade of Canadian Offensive Lineman", "Surf Park Development" (via "Home"). All correct quarantines.
- **Honest gray zone (human judgment):** the fire/emergency titles — "Support for Fire Evacuees"×2, "State of Emergency Declared", "Wildfires in eastern Washington", "Resident gathering for action on flooding" — *could* be relevant IF the Kilbacks have a home/cabin in an affected area, but they matched only on the generic label, not a geo link, so none are provably real intel. Not clearly-genuine coverage being lost.

**Answer to the question:** the rule is **catching fabrication at volume**, not suppressing genuine PECL. The 56% rate is entirely Kilbacks noise from two common-word asset labels ("Home", "cabin") matching unrelated news; the born-quarantine is doing its job. **Root cause is upstream** (Kilbacks assets labelled with common words + the ≤5-char matcher), not the quarantine — the fix, when ruled, is upstream (asset labels / token-boundary matcher), not loosening the gate. `LNG` allowlist correctly protects PECL's real acronym; the Kilbacks words are correctly not allowlisted.

### Ruling 2026-08-04 — no change; geo-anchor is the real fix (report only)

Operator: **rule works as designed, no change.** One thing to fix (report only, do not build): the **gray-zone fire/flood titles** — if the Kilbacks have property in an affected area, those are exactly the signals that matter, being discarded alongside WestJet cabin-crew noise.

**What geo-anchoring `asset:Home` for Kilbacks would take:** `asset:Home` (or `asset:cabin`) counts as a real match **only when the same item also matches a client geography**, not on the label word alone. Requirements:
1. **A client geography set for Kilbacks** — lat/long or named place(s) for the actual Home/cabin (a `client_locations` / asset-geo field). Today the asset is a bare label with no coordinates, so there is nothing to anchor against.
2. **A geo signal on the item** — the signal/document carries a place (entity_tags, geocoded source region, or place-name extraction). The fire/evac items ("eastern Washington", "B.C. Fire Evacuees") do carry geography; a matcher could compare it to the Kilbacks asset geography.
3. **Co-occurrence rule:** short/common asset label matches only if `item_geo ∈ client_geo_radius` (or shares a named region). "cabin"→"cabin crew" fails (no Kilbacks-geo co-occurrence); "cabin" + a fire in the Kilbacks' actual valley passes.
4. **This is exactly the already-logged Phase-3 requirement:** *asset labels require geo/entity anchor co-occurrence* (retires the ≤5-char length heuristic + allowlist, per WO-GATE-KEYWORD-PRESCORE-01 / the CLAUDE.md born-quarantine "transitional" note). Geo-anchoring Kilbacks is the concrete first instance of that general rule — build it as the Phase-3 anchor, not a Kilbacks special-case.

**Dependency:** #1 (client asset geography) is the missing substrate — without coordinates/place on the Kilbacks Home/cabin assets, geo-anchoring cannot be evaluated. That is the first thing to provision when Phase 3 is ruled.

## 3. Self-reporting integrity (neural page) — the "42 idle vs agents scanning" contradiction

**The board contradicts itself because two panels on the same screen read two different tables — one real-work, one synthetic heartbeat.**

| panel / counter | source table | 24h reality (2026-08-04) |
|---|---|---|
| **"0/42 online · 42 idle · FLEET DORMANT"** (`useAgentActivityMetrics`) | **`signal_agent_analyses`** (real specialist reasoning) | **0 rows in 24h** (latest 2026-08-03 06:01, >24h ago); 70 rows/7d across only 11 agents |
| **"Live Activity" scanning + "96 scans" counter** (`useScanPulses`/`useScanCount`) | **`autonomous_scan_results`** | **96 scans / 43 agents in 24h, latest 2 min ago** |

**What writes each — the decisive fact:**
- `signal_agent_analyses` is written **inside the real work loop** (`review-signal-agent` inserts one when an agent actually reasons over a signal ≥0.60 confidence; also red-team-review, ai-decision-engine, activate-dormant-specialists). Work-coupled → honest.
- `autonomous_scan_results` is written by **`agent-activity-scanner`, whose documented purpose is literally** *"every agent gets scanned roughly every 7 hours. This will move all agents from 'idle' to 'standby' on the Neural Constellation."* It round-robins one agent per 15-min cron, calls the AI to write a 120-word status blurb about the **shared** environment, and stores `alerts_generated = critCount+highCount` of **all** signals (not that agent's work). It is a **synthetic per-agent pulse written OUTSIDE the work loop** — a heartbeat dressed as a scan. AUTO-SENTINEL: 48 "scans"/24h, **zero `signal_agent_analyses` ever**.

**Answers to the four questions:**
1. **What drives online/idle/dormant + what writes it:** `signal_agent_analyses` (last-24h per `agent_call_sign`), thresholded to statusDot (>0.35 active / >0.05 standby / ≤0.05 idle). Written by the real reasoning path (`review-signal-agent` et al.). It is 0/24h → every agent scores 0 → all 42 idle.
2. **Why AUREUS-GUARD / ECHO-WATCH show recent activity but count idle:** their "recent activity" is the **synthetic `autonomous_scan_results` pulse** (Live Activity panel); the idle score reads `signal_agent_analyses`, where they have **0 recent rows** (AUREUS-GUARD's last real analysis was 2026-06-29). The two panels measure different pipelines. **"Idle" is the honest reading; "scanning" is the synthetic one** — the inverse of the initial assumption.
3. **Is "9/42 ran in 7d" from the same field?** **Yes** — `system-watchdog` line 3610 counts distinct `agent_call_sign` in **`signal_agent_analyses`** over 7d (observed 11 distinct → ~"9/42"). It is the **same real-work table** as the idle panel — deliberately chosen (2026-05-10, post-May-9) *because* `autonomous_scan_results` had "inflated active to 42/48 even when the pipeline was 100% broken." So the watchdog is measuring **real usage, correctly** — it is NOT the instrumentation artifact. The instrumentation artifact is the **other** number (the 96 synthetic scans / "43 agents active").
4. **Every place a heartbeat/status is written — flag those outside the work loop:**
   - `signal_agent_analyses` — INSIDE work loop (real reasoning). Honest. ✅
   - **`autonomous_scan_results` via `agent-activity-scanner` — OUTSIDE the work loop (synthetic round-robin pulse, explicit purpose = make agents look non-idle).** 🚩 This is the one that feeds the misleading "scanning" display.
   - `autonomous_scan_results` via `autonomous-threat-scan` / `proactive-intelligence-push` / `autonomous-operations-loop` / `threat-cluster-detector` / `visibility-gap-scanner` / `fortress-loop-closer` — real sweeps, but attributed generically; mixed with the synthetic pulse in the same table, so the table can't distinguish real from synthetic. 🚩 (table conflation)
   - `agent_conversations.updated_at` / `agent_messages` — work-coupled (real exchanges). ✅
   - `cron_heartbeat` — job-level, work-coupled (the DR case shows the failure mode: writer wrote nothing). ✅
   - `operator_heartbeats` — operator devices, not agents. n/a

**Conclusion — the operator's core worry is correct, culprit inverted.** The self-reporting layer *is* unreliable, but not because "idle" is wrong — "idle/dormant/9-ran" are the honest, work-coupled numbers. The unreliability is that the **same screen also shows a synthetic-heartbeat panel ("Live Activity scanning", "96 scans", "54 alerts") with no label saying it's a liveness pulse, not real output.** An operator glancing at it reasonably concludes agents are working. The 2026-05-10 fix was **half-applied**: the *status* panel + watchdog were switched to the real table, but the *Live Activity* panel + scan counter still read the synthetic one. **Same class as the DR heartbeat gap and monitor-news-google "0 signals / 370 in DB": a displayed metric decoupled from the work it claims to represent.** The three findings share this root: *self-report ≠ work unless the write is coupled to the work.* (Report only — no fix applied; the genuine open question underneath is whether `signal_agent_analyses` being 0/24h is expected-low or `review-signal-agent` has itself stalled — a separate follow-on.)
