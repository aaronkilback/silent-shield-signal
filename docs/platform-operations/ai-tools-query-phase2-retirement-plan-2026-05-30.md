# `ai-tools-query` Phase 2 — Retirement Plan

**Operator §112 Phase 2 PLANNING ONLY.** Not authorized for execution.
**Created:** 2026-05-30.
**Predecessor:** Task #112 Phase 1 (this branch `feat/collapse-ai-tools-query-phase1`).

Phase 1 collapsed `lookup_ioc_indicator` + `update_risk_profile` into `dashboard-ai-assistant` with PR #79 R1+R5 protections preserved inline. Dashboard no longer invokes `ai-tools-query` for either tool. The function remains deployed; the 15 anon-reachable unscoped cases remain as latent exfil surface until Phase 2 executes.

Phase 2 deletes the function from prod + staging + repo. **Not executed until Phase 1 is merged, deployed, and observed.**

---

## §1 — Phase 2 retirement checklist

| # | Item | Detail |
|---|---|---|
| 1 | Phase 1 merged | PR for `feat/collapse-ai-tools-query-phase1` merged to main. |
| 2 | Phase 1 deployed to staging | `supabase functions deploy dashboard-ai-assistant --project-ref lkvyrvuakzguszbpwnfz` |
| 3 | Phase 1 deployed to prod | `supabase functions deploy dashboard-ai-assistant --project-ref kpuqukppbmwebiptqmog` |
| 4 | **Observation window ≥ 24h (recommended 48–72h)** | `mcp__plugin_supabase_supabase__get_logs` on `ai-tools-query` filtered to post-deploy window; verify **zero non-fixture invocations**. Two acceptable invocation classes only: (a) explicit operator probe for verification, (b) zero invocations. Anything else = unknown caller — halt and investigate. |
| 5 | Pre-flight grep on main | `grep -rnE "ai-tools-query" supabase/ src/ scripts/ .github/` returns only the three expected references: comments in `dashboard-ai-assistant/index.ts:4397 + 4596` (Phase 1 historical), `_shared/deployment-verification.ts:19` (this line is removed in Phase 2), and `agent-chat/index.ts:1920` (already broken; addressed below). |
| 6 | `agent-chat` broken caller disposition | `agent-chat/index.ts:1920` invokes ai-tools-query with `body: { tool: 'lookup_ioc_indicator', … }` — wrong key (`tool` not `toolName`). Today: falls through to `default: "Unknown tool"` at the app layer. Post-retirement: 404 at HTTP layer. **Same broken state, different failure mode.** Operator decides whether to fix-or-remove this call site in the same PR or leave it as-is (status quo: broken). Recommended: remove the broken invoke block in agent-chat as a 5-line stub change inside Phase 2 PR. |
| 7 | Pre-flight Aegis Flight Recorder check | If any trace in the prior 30 days shows `ai-tools-query` activity from a non-dashboard caller, surface it before deletion. |

---

## §2 — Deployment sequence

```
Phase 1 (already implemented; awaiting operator merge + deploy)
  ├─ Merge PR (this branch → main)
  ├─ Deploy dashboard-ai-assistant to STAGING
  │   └─ Smoke: invoke lookup_ioc_indicator + update_risk_profile via Aegis chat
  ├─ Deploy dashboard-ai-assistant to PROD
  │   └─ Smoke: same shape
  └─ Observation window: 24–72h
      └─ `gh api` / Supabase Function Logs filter ai-tools-query invocations
         Expected: zero. Any non-zero = halt + investigate.

Phase 2 (gated on Phase 1 observation green)
  ├─ Branch:  feat/retire-ai-tools-query-phase2
  ├─ Files removed:
  │   - supabase/functions/ai-tools-query/  (entire directory)
  ├─ Files modified:
  │   - supabase/config.toml  (remove [functions.ai-tools-query] + verify_jwt = false block at lines 172-173)
  │   - supabase/functions/_shared/deployment-verification.ts:19  (remove 'ai-tools-query' from the verification list)
  │   - supabase/functions/agent-chat/index.ts:1920  (remove the broken invoke block — operator-decision)
  ├─ Build verification:  npm run build
  ├─ PR open
  ├─ Merge PR
  ├─ Deploy:
  │   - supabase functions delete ai-tools-query --project-ref lkvyrvuakzguszbpwnfz  (staging)
  │   - Verify staging: curl https://lkvyrvuakzguszbpwnfz.supabase.co/functions/v1/ai-tools-query
  │     Expected: 404 NOT_FOUND
  │   - supabase functions delete ai-tools-query --project-ref kpuqukppbmwebiptqmog  (prod)
  │   - Verify prod: curl https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/ai-tools-query
  │     Expected: 404 NOT_FOUND
  └─ Observation: 24h watchdog + cron heartbeat + edge function logs
      └─ Confirm no spike in failures elsewhere
```

---

## §3 — Rollback plan

### Phase 1 rollback

Phase 1 is a single-file dashboard change. Rollback path:

1. `git revert <phase1-merge-commit>` on main
2. `supabase functions deploy dashboard-ai-assistant` to staging then prod
3. Behavior restores to ai-tools-query-routed (pre-PR #79 unprotected state, OR if PR #79 is merged separately, the PR #79-hardened state — depends on operator's intervening decisions about PR #79)

No schema, no migration, no data state to reconcile. Rollback window: ~5–15 minutes from decision to revert.

### Phase 2 rollback

Phase 2 deletes the function from prod. Rollback requires **re-deploying** the function from git history.

1. `git revert <phase2-merge-commit>` on main (restores the file tree + config.toml entry + deployment-verification entry)
2. `supabase functions deploy ai-tools-query --project-ref lkvyrvuakzguszbpwnfz` (staging)
3. `supabase functions deploy ai-tools-query --project-ref kpuqukppbmwebiptqmog` (prod)
4. Verify: curl on `/functions/v1/ai-tools-query` returns 200 (or expected response shape)
5. If Phase 1 was also reverted: dashboard's invoke calls would now succeed against the restored function

Rollback window: ~10–20 minutes (longer because requires re-deploy, not just revert).

### Combined rollback (Phase 1 + Phase 2 both deployed, both need to revert)

Order matters:
1. `git revert <phase2-merge>` first — restores the file tree
2. `supabase functions deploy ai-tools-query` to both envs — restores the runtime
3. `git revert <phase1-merge>` second — restores dashboard's invoke pattern
4. `supabase functions deploy dashboard-ai-assistant` to both envs

The intermediate state (Phase 2 reverted but Phase 1 still collapsed) is safe — dashboard ignores ai-tools-query's existence.

---

## §4 — Verification plan

### Phase 1 verification (post-deploy)

| Check | Method | Pass criterion |
|---|---|---|
| V1.1 Build green | CI on PR | TypeScript & Build success |
| V1.2 R1 own-tenant write succeeds | SQL probe replicating PR #79 T1 | Pre-check returns 1 row; if Aegis chat used, threat_score actually updates on the in-tenant entity |
| V1.3 R1 foreign-tenant write rejected | SQL probe replicating PR #79 T2 | Pre-check returns 0 rows; if Aegis chat used, dashboard returns 404 "not found in current tenant scope"; no entity_id in foreign tenant has its threat_score mutated |
| V1.4 R5 CRT-scope IOC | SQL probe replicating PR #79 R5.T1 | indicator "LNG" returns 2 (CRT) not 190 (cross-tenant); Petronas-scope returns 188 |
| V1.5 ai-tools-query invocation count drops to zero | Supabase function logs filtered by edge function = ai-tools-query, time = after-deploy | Zero invocations (or only the agent-chat:1920 broken caller falling through to default) |
| V1.6 No regression on adjacent tools | Aegis chat smoke (assign_agent_mission, recommend_playbook, generate_fortress_report) | Each tool returns its expected shape, no HTTP 500s |

### Phase 2 verification (post-deletion)

| Check | Method | Pass criterion |
|---|---|---|
| V2.1 Direct HTTP returns 404 | `curl -i https://<project-ref>.supabase.co/functions/v1/ai-tools-query` (both envs) | HTTP 404 |
| V2.2 Build green | CI on Phase 2 PR | TypeScript & Build success |
| V2.3 deployment-verification helper no longer probes the function | Inspect `_shared/deployment-verification.ts` post-merge | Function name absent from the list |
| V2.4 No new HTTP 500s on dashboard-ai-assistant | Edge function logs filtered post-deploy | Same baseline rate; no spike |
| V2.5 No new HTTP 500s on agent-chat | Same | Same; if the broken invoke block was removed in Phase 2 PR, no errors from there either |
| V2.6 Watchdog cron OK | `cron_heartbeat` query | `system-watchdog-daily` succeeded with no new errors related to missing function |
| V2.7 Aegis chat smoke for IOC lookup + risk profile update | Aegis chat invocation | Both tools work correctly using dashboard-local code |

### Long-horizon (1-week post-Phase-2)

| Check | Method | Pass criterion |
|---|---|---|
| L2.1 Zero `404 NOT_FOUND` log entries for `/functions/v1/ai-tools-query` | Function logs over 7 days | Zero non-zero count = no unknown caller surfaced |
| L2.2 `cron_job_registry` no orphaned entries | SQL: `SELECT * FROM cron_job_registry WHERE job_name LIKE '%ai-tools%'` | Zero rows |
| L2.3 Smoke harness clean | `node scripts/test-aegis-tools.mjs` | All tools pass without referencing ai-tools-query |

---

## §5 — Gating between Phase 1 and Phase 2

**Phase 2 is GO only if all of:**

- Phase 1 merged to main
- Phase 1 deployed to staging + prod
- 24h minimum observation window has passed (48–72h recommended)
- V1.5 confirms zero `ai-tools-query` invocations in the observation window (or only the documented agent-chat:1920 broken-caller fall-through, which is HTTP-side an error and app-side a "Unknown tool" — neither path is a legitimate caller)
- V1.2–V1.4 confirm runtime behavior matches PR #79 expectations
- No unknown caller surfaced via Aegis Flight Recorder

**Phase 2 is NOT GO if:**

- Any of the above fails
- Unknown caller invokes ai-tools-query during observation (e.g., script, cron, external service not identified in Task #110)
- Operator's BC Place / FIFA demo window is imminent and changes to Aegis are inadvisable

---

## §6 — Out of scope (held)

- `verify_jwt = true` flip on ai-tools-query (Task #110 Option 2) — superseded by Phase 2 deletion
- C2 cross-cutting concerns (handler signature class on `search_investigations`/`search_clients`/`get_client_details`/`get_monitoring_status`/`get_failed_scans`) — separate work
- AR1 CI guard — separate operator decision
- AR3 post-condition receipts — separate operator decision
- Any other open P0/P1 items from the Program Readiness Review

---

## §7 — Held

- No execution.
- No code, branch, migration, deploy beyond what is explicitly part of Phase 1.
- No memory updates.
- Phase 2 execution requires operator GO based on Phase 1 observation outcomes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
