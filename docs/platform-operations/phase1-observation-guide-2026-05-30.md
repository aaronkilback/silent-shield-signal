# Phase 1 Deploy Observation Guide — `ai-tools-query` Retirement

**Created:** 2026-05-30.
**Status:** Phase 1 (PRs #77 / #78 / #79 / #80) merged to main. Edge function auto-deploy initiated. This document drives the 24–72 hour observation window before Phase 2 deletion is authorized.

---

## §1 — What Phase 1 deployed

Four PRs merged in conservative sequence per operator directive 2026-05-30:

| PR | Commit | Scope | Files deployed |
|---|---|---|---|
| #77 | `089fc81c` | R2 + R6 tenant-scope handlers | `dashboard-ai-assistant` (bundles `_shared/handlers-signals-incidents.ts`) |
| #78 | `620eac97` | R3 entity count + R4 monitoring honest-refusal | `dashboard-ai-assistant` |
| #79 | `adce9554` | R1 + R5 ai-tools-query receiver-side tenant scoping | `ai-tools-query` (transient hardening during observation window) |
| #80 | `34c77b5c` | Phase 1 collapse — ai-tools-query → dashboard-ai-assistant | `dashboard-ai-assistant` (final code path for IOC + risk profile tools) |

After deploy completion, **dashboard-ai-assistant no longer invokes ai-tools-query for `lookup_ioc_indicator` or `update_risk_profile`**. ai-tools-query remains deployed with PR #79 hardening on its receiver-side cases (defense-in-depth against direct-HTTP exploits during the observation window).

---

## §2 — Observation criteria

### Primary check — ai-tools-query invocation count

The expected post-deploy invocation rate on `ai-tools-query` is **near-zero** because:
- Dashboard no longer routes either tool through it (PR #80)
- `agent-chat:1920` pre-existing broken caller (wrong key shape) falls through to `default: "Unknown tool"` regardless
- No frontend / script / cron / external caller exists per Task #110 inventory

**Non-zero invocation count → halt and investigate** (unknown caller has been surfaced).

### How to check (canonical commands)

#### A. Supabase function logs via MCP

```
mcp__plugin_supabase_supabase__get_logs
  project_id: kpuqukppbmwebiptqmog
  service: edge-function
```

Filter for `ai-tools-query` in the logs. Note the time window — the MCP helper returns the last 24h by default. For longer windows, repeat after 24h and 48h.

**Pass criterion:** zero invocations OR only documented agent-chat:1920 broken-caller fall-throughs (which would log as `Unknown tool` errors, not successful case body executions).

#### B. Direct curl probe (any time)

```
curl -X POST https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/ai-tools-query \
  -H "Authorization: Bearer <anon-key-or-service-role>" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"get_recent_signals"}'
```

**Pre-Phase-2 result:** function responds (potentially with cross-tenant data on unscoped cases, because PR #79 only hardened `update_risk_profile` + `lookup_ioc_indicator`; the other 15 unscoped cases remain).

**Post-Phase-2 result (target):** HTTP 404 NOT_FOUND. That confirms the function is gone.

#### C. Aegis Flight Recorder trace replay (operator-only)

If any Aegis chat session in the observation window invoked IOC lookup or risk-profile update, verify the trace shows the dashboard-local code path (not the old ai-tools-query invoke shape).

```sql
SELECT * FROM aegis_trace_replay('<debug_trace_id>');
```

**Pass criterion:** no rows in the trace contain `supabase.functions.invoke("ai-tools-query"...)` references for these tools.

### Secondary checks — regression boundary

| Check | Method | Pass |
|---|---|---|
| Aegis chat IOC lookup works | Vince/CRT chat → "Has hash X been seen before?" | Returns CRT-only matches (not cross-tenant) |
| Aegis chat risk profile update works | Aegis chat → "Set entity Y to risk score 90" | Updates the CRT entity; returns success object with `entity_id`, `updated_risk_score`, `timestamp` |
| R1 cross-tenant write blocked | Probe with a known Petronas entity_id from CRT scope | 404 "not found in current tenant scope"; no Petronas entity mutation |
| R5 cross-tenant IOC scope | Probe with indicator known in Petronas only from CRT scope | Returns "unknown" verdict (not "known_malicious") |
| R2 active incidents | CRT user asks "what's active?" | CRT-scope-only incidents (1 today), not 52 cross-tenant |
| R3 entity count | CRT user → "agent_self_assessment" | Self-assessment surfaces "Total entities monitored: 62" (not 2,966) |
| R4 monitoring lie | CRT user → "toggle all entities to monitored" | Honest refusal pointing to Entities UI |
| R6 signal status | CRT user with foreign signal UUID | Honest "not found in current tenant scope" |
| Watchdog cron | `cron_heartbeat` for `system-watchdog-daily` | Succeeded with no new errors |
| Cloudflare Pages prod | curl `https://fortress.silentshieldsecurity.com/` headers | HTTP 200, bundle hash unchanged (PR #80 was edge-function only, no frontend change) |

---

## §3 — Phase 2 GO criteria

**Phase 2 retirement is GO only if ALL of the following hold at the 24-72h decision point:**

| Criterion | Method | Pass |
|---|---|---|
| Phase 1 merged | gh CLI | PRs #77, #78, #79, #80 all merged ✓ (verified at 2026-05-31T03:33:05Z) |
| Phase 1 deployed | GitHub Actions: `Deploy Edge Functions` workflow on HEAD commit `34c77b5c` | Workflow conclusion = success |
| ai-tools-query invocations during window | §2.A check | Zero non-fixture invocations |
| No unknown caller surfaced | §2.A + §2.B | Same |
| Secondary regression checks | §2 secondary table | All pass |
| Watchdog cron clean | `cron_heartbeat` | Succeeded |
| Operator BC Place / FIFA delivery window | Operator decision | Not imminent (Phase 2 not advisable during active customer demo) |

**Phase 2 is NOT GO if:**
- Any of the above fails
- Unknown caller invokes ai-tools-query during observation
- Any secondary regression check shows a 500 or wrong-tenant result
- Operator's customer-facing window prohibits changes

---

## §4 — Phase 2 execution path (when authorized)

Per `docs/platform-operations/ai-tools-query-phase2-retirement-plan-2026-05-30.md`. Summary:

1. Branch `feat/retire-ai-tools-query-phase2`.
2. `git rm -r supabase/functions/ai-tools-query/`
3. Remove `[functions.ai-tools-query]` block from `supabase/config.toml`
4. Remove `'ai-tools-query'` entry from `supabase/functions/_shared/deployment-verification.ts:19`
5. Disposition `agent-chat/index.ts:1920` broken caller (operator decides: remove or leave broken)
6. Build verification: `npm run build` green
7. Open PR
8. Merge
9. Execute deletion against staging + prod via `supabase functions delete ai-tools-query --project-ref <ref>`
10. Verify deletion: `curl https://<ref>.supabase.co/functions/v1/ai-tools-query` → 404
11. 24h post-deletion observation: no new 500s elsewhere; watchdog clean

Total Phase 2 effort: ~30–60 min execution + 24h post-deletion observation.

---

## §5 — Rollback paths

### Phase 1 rollback (if deploy reveals regression)

1. `git revert <merge-commit-sha>` for any of #77/#78/#79/#80 (in reverse order if multiple)
2. Push to main → auto-redeploy via `deploy-functions.yml`
3. Edge functions revert to prior shape within ~5–10 min

No schema or migration to reconcile. Frontend unchanged (this batch is edge-function-only).

### Phase 2 rollback (if deletion reveals an unknown caller)

1. `git revert <phase2-merge-commit>` → restores file tree
2. `supabase functions deploy ai-tools-query --project-ref <ref>` for both staging + prod → restores runtime
3. ~10–20 min recovery time

---

## §6 — What this document is NOT

- Not authorization for Phase 2 execution.
- Not authorization for any new workstream (Watchdog reliability, Health monitoring, Executive report redesign — those follow Phase 2 observation per operator directive).
- Not a deploy. The deploy happens via GitHub Actions on push to main.
- Not a customer-facing demo guide.

---

## §7 — Resume points for next session

When the operator next picks up this thread:

1. **Pre-flight:** verify §2.A returned zero invocations across the chosen observation window.
2. **If clean:** authorize Phase 2 retirement; the plan in §4 + the Phase 2 plan doc execute.
3. **After Phase 2 observation green:** begin the program plan for:
   - Watchdog reliability
   - Health monitoring
   - Executive report redesign
   tied to Commander's Intent (*"Preserve decision space by shortening Signal → Decision → Action"*).
4. **If unclean:** investigate the unknown caller; do not proceed to Phase 2 until resolved.

---

## §8 — Held

- No further work in this session beyond Phase 1 deploy verification + this observation guide.
- No Phase 2 execution.
- No new workstreams.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
