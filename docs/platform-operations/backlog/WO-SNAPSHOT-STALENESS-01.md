# WO-SNAPSHOT-STALENESS-01 — the vuln scanner scans stale source (BLOCKER for all WRAITH scan work)

**Logged:** 2026-08-02. **Status:** SCOPE + git_sha substrate added; automation/probe/refuse-gate HELD. **Priority:** BLOCKER — sits **ahead of everything in WO-WRAITH-SCOPE-01**. Until this closes, no wraith vuln finding reflects deployed reality.

## The finding
`codebase_snapshots` holds **~April source**, not what's deployed. Proven: the `ingest-signal` snapshot's handler entry is the **pre-F-026** posture (`Deno.serve → CORS → createClient(service_role) → health_check`, no `getCallerIdentity`) — the exact code F-026 *replaced* on 2026-05-14. The scanner faithfully analyzed that stale code and emitted a **false critical** (CWE-306 auth bypass) on a function that has been authenticated since May. All 5 snapshots lack current-era markers.

## When it last refreshed with current code
**~2026-04-29** (the `scripts/upload-codebase-snapshot.py` file is dated Apr 29; the `codebase-source` bucket has not been repopulated since). `snapshotted_at` shows **2026-08-02** on every row — misleading: `wraith-snapshot-codebase` runs nightly and re-copies the **frozen** bucket into `codebase_snapshots`, refreshing the timestamp but not the content. **Content is ~3 months stale; the timestamp lies.**

## Why `upload-codebase-snapshot.py` is not running post-deploy
**It is a manual script with zero automation.** Its own docstring says *"Run this after deploying functions: `python3 scripts/upload-codebase-snapshot.py`"* — and **nothing runs it.** No CI workflow, no deploy hook, no `package.json` script, no Makefile references it (grep across `*.json/*.yml/*.yaml/*.sh/*.toml` = empty). So it only ever ran when invoked by hand (~Apr 29), and every `supabase functions deploy` since has silently drifted the deployed code away from the frozen bucket. (It also still hardcodes the same 5 `SCAN_TARGETS`.)

## Snapshot rows had no git reference — added
`codebase_snapshots.sha256` is a **content hash** of `source_code`, not a git commit. A content hash detects *"did the bytes change"* but cannot answer *"is this the deployed commit."* **Added `git_sha text` column** (migration `codebase_snapshots_add_git_sha`; nullable; NULL = provenance unknown = treat as stale). The upload script must set it (`git rev-parse HEAD`, or per-file `git log -1 --format=%H -- <file>`).

## Freshness probe (design) — `snapshot.git_sha != deployed sha → finding`
1. **Record the deployed sha at deploy time** — a `deploy_manifest(function_name, git_sha, deployed_at)` row (or a single repo-HEAD marker), written by the deploy step.
2. **Probe** (agent-sentinel / watchdog): for each scan target, `snapshot.git_sha != deploy_manifest.git_sha` (or `snapshot.git_sha IS NULL`, or `snapshotted content-sha` doesn't match a freshly-computed sha) → **one aggregated finding** listing stale files.
3. **The scanner MUST refuse to scan stale source — fail-loud (doctrine applies directly).** `runVulnerabilityScan` checks freshness first: if a target's `git_sha` is NULL or ≠ the current deploy sha, it must **skip that file and record a `stale_source` scan error** (and if *all* targets are stale, throw — a scan over stale source is a failed scan, not a clean one). Scanning old code silently and emitting findings against it is exactly the silent-empty-default failure mode inverted: silent-wrong-input.

## Fix order (when authorized)
1. **Automate the upload** — run `upload-codebase-snapshot.py` (git_sha-stamped) as a post-deploy hook / CI step, over the full inventory not 5 files (ties to WO-WRAITH-SCOPE-01 §1).
2. **Populate `git_sha`** on upload + a `deploy_manifest`.
3. **Scanner refuse-if-stale** (fail-loud) + freshness probe.
4. Only then re-run scans and trust output.

## Impact
The 35 findings from the 2026-08-02 scan are marked `invalid_stale_source` (not deleted). The scanner's **first production output was a false critical** caused by stale source — the precision-validation argument in one line, and why WO-WRAITH-DAILY-DIGEST-01 stays blocked.
