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
