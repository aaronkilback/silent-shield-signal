# INC-WRANGLER-MISFIRE-2026-07-13

**Severity:** P0 (production frontend worker deleted; no user-visible downtime observed due to edge cache).
**Status:** Resolved.
**Detected by:** self-inspection of wrangler stdout + CF account listing during teardown execution.
**Author:** Claude session (with operator supervision).

## Summary

While executing the operator-authorized teardown of the `news-rss-proxy` Cloudflare Worker, the `wrangler delete` command **deleted the wrong worker**: `silent-shield-signal` (Fortress AI production frontend, bound to `fortress.silentshieldsecurity.com/*`) instead of `news-rss-proxy`.

**Deletion:** 2026-07-13T21:01:28 UTC
**Detection:** 2026-07-13T~21:01:35 UTC (within ~10 s, from wrangler stdout `Successfully deleted silent-shield-signal` + CF API account listing).
**Restoration:** 2026-07-13T21:11:01 UTC — via `wrangler deploy` from repo root on `main`, redeploying `silent-shield-signal` from `dist/` at version `cfa49e38-d404-477c-ac2f-f9daf4821a0c`.
**Correct teardown completed:** 2026-07-13T21:12 UTC — `wrangler delete --name news-rss-proxy`.

Total window between misfire and full restoration: **~10 min**. Fortress AI production frontend never returned non-200 during the window — CF edge cache continued serving the deployed dist/ contents through the gap.

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-07-13T20:53 | Comparative-experiment observation window closed; operator ruled TEARDOWN GO on the 6-step sequence. |
| 21:00:52 | Step (a) BCER `sources.config.feed_url` reverted to direct `news.google.com` URL — CORRECT. |
| 21:01:28 | Step (b) `wrangler delete` executed from `cloudflare/news-rss-proxy/`. **Misfire:** wrangler.toml missing in cwd → parent-directory walk → matched root `wrangler.toml` (`name = "silent-shield-signal"`) → confirmation prompt `Are you sure you want to delete silent-shield-signal?` → auto-yes → **prod frontend worker deleted**. |
| ~21:01:35 | CF API account listing confirmed `silent-shield-signal` absent from account. Halted teardown. |
| 21:01:40 | Reported P0 to operator, proposed corrective redeploy, HELD for explicit GO. |
| ~21:05 | Operator ruled: GO on P0 rollback with mandatory pre-step (`git checkout main && git status --short`, confirm clean tree, do not stash-pop anything onto main). |
| 21:10:34 | `wrangler deploy` started on `main` (clean tree, 2 commits fast-forwarded from earlier session merges). |
| 21:11:01 | Deploy complete: version `cfa49e38-d404-477c-ac2f-f9daf4821a0c`. |
| 21:11:28 | Verifications green: worker present in account listing; `fortress.silentshieldsecurity.com/` → 200; `/dashboard` → 200; route binding `fortress.silentshieldsecurity.com/* → silent-shield-signal` confirmed; title tag `Fortress AI — Security Intelligence Platform`; `dist/` grep confirmed baked-in prod Supabase URL `kpuqukppbmwebiptqmog.supabase.co` (zero staging refs). |
| 21:12 | `wrangler delete --name news-rss-proxy` — correct target, "Successfully deleted news-rss-proxy". Account listing confirms `news-rss-proxy` GONE + `silent-shield-signal` PRESENT. |

## Root cause

**Two contributing factors:**

1. **Missing `wrangler.toml` in `cloudflare/news-rss-proxy/` on session's working branch.** The session was on `fix/wo-data-integrity-reports-tenant-guard`, which was branched BEFORE PR #123 merged into `main`. PR #123 is what introduced `cloudflare/news-rss-proxy/wrangler.toml`. On the session's stale working branch, that file did not exist. When `wrangler delete` ran from `cloudflare/news-rss-proxy/`, wrangler walked up the tree until it found `wrangler.toml` at the repo root — which declares `name = "silent-shield-signal"` (Fortress AI prod frontend).

2. **Confirmation-prompt name misread.** Wrangler's confirmation prompt correctly named its target (`Are you sure you want to delete silent-shield-signal?`). The pipe-fed `y` bypassed interactive review. The action taker (me) did not verify the prompt named `news-rss-proxy` before piping the confirmation.

**Neither factor alone would have caused the delete:**
- If (1) hadn't been present, wrangler would have found the correct wrangler.toml and asked about `news-rss-proxy`.
- If (2) hadn't been present, the prompt would have surfaced the wrong target and the operator would have caught it.

The interaction of a **stale branch** with a **prompt-piped confirmation** produced the misfire.

## Impact

- **`silent-shield-signal` worker deleted from CF account for ~10 min** (21:01:28 → 21:11:01).
- **No observed user-visible downtime.** During the gap, `fortress.silentshieldsecurity.com/` and dynamic paths continued to return HTTP 200 with the correct HTML title and assets. Attribution: CF edge cache serving prebuilt static assets through the window. The cache would have exhausted at some point (asset TTL varies; some paths were `cf-cache-status: HIT`) — restoration happened before that.
- **Route binding restored:** `fortress.silentshieldsecurity.com/* → silent-shield-signal` reattached automatically via `wrangler deploy` from `main`'s `wrangler.toml`.
- **Secrets:** worker had zero runtime secrets (`wrangler secret list --name silent-shield-signal` returned `[]` post-restore; no `[vars]` / `kv_namespaces` / `d1_databases` / `r2_buckets` / `services` in wrangler.toml). Vite env vars (Supabase URL/anon key) are baked into `dist/` at build time and were re-baked correctly (confirmed prod project ref `kpuqukppbmwebiptqmog.supabase.co` in the new dist/).
- **`silent-shield-signal-staging` untouched** — verified in account listing throughout.
- **No data loss.**

## Detection

CF account API listing showed `silent-shield-signal` MISSING from the workers list within ~10 s of the delete. This was the first authoritative signal. `wrangler` stdout also included the target name in its confirmation ("silent-shield-signal") but the pipe-yes flow bypassed operator eyeballs on that.

## Resolution

1. Halted teardown sequence.
2. Reported P0 to operator with full detail (worker deleted, current site state, proposed corrective action, HELD for GO).
3. Operator ruled: GO on rollback with mandatory pre-step `git checkout main && git status --short`, confirm clean tree, no stash-pop onto main.
4. Executed pre-step: swapped to `main`, fast-forwarded 2 commits, tree clean (untracked `.claude/` harness state only).
5. `wrangler deploy` from repo root — rebuilt `dist/` from source-of-truth on `main`, redeployed silent-shield-signal, reattached route.
6. Verified: worker in account listing, root 200, dynamic path 200, HTML title correct, route binding correct, dist/ baked with prod Supabase URL only.
7. Correctly executed `wrangler delete --name news-rss-proxy` (explicit name flag, from root; confirmation prompt correctly named news-rss-proxy).

## Corrective actions (Prevention)

**NEW STANDING RULE (effective immediately):**

> All `wrangler delete` and `wrangler deploy` commands MUST use the `--name <target>` flag explicitly, and MUST echo the target name to stdout before execution. No exceptions. Directory-walk auto-detection of `wrangler.toml` is not a safe default when multiple workers exist in the repo (there are ≥3: `silent-shield-signal`, `silent-shield-signal-staging`, and any queued worker experiments). The `--name` flag makes the target unambiguous and matches what wrangler's confirmation prompt will show.

**Application:**
1. Add the rule to `CLAUDE.md` under a new "Cloudflare Worker operations" section — at next CLAUDE.md edit.
2. Add the rule to the system-watchdog KB — at the next watchdog deploy (per operator ruling).
3. Add a memory feedback item so the rule persists across sessions.
4. Any future teardown / redeploy sequence must include a dry-run step: `wrangler versions view --name <target>` or `wrangler deployments list --name <target>` BEFORE any destructive command, to confirm the target exists and has the expected route/version.

**Additional lesson (branch hygiene):**
- Long-running work on a stale branch masks main-tracked files. Any `wrangler`/CF operation should be executed only from a branch that is up to date with `main`, or from `main` itself. Session working branches diverging from main introduce this class of misfire whenever they interact with tools that use file-tree auto-detection.

## Task tracking

- No new task created for this incident (fully resolved within this session). Referenced from `cloudflare/news-rss-proxy/DEPLOYMENT.md` teardown record.
- Standing rule addition to CLAUDE.md + watchdog KB: **deferred to next relevant deploy**, per operator ruling.

## Anti-summary

This document is the incident record, not a summary. The comparative-experiment result, teardown ruling, and worker RETIRED status are separately captured in `DEPLOYMENT.md`. This file exists solely to record the wrangler misfire, its root cause, and the standing rule that prevents its recurrence.
