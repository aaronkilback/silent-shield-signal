# CLAUDE.md — Fortress AI / Silent Shield Signal
# Rules for AI agents (Claude Code, Claude in Browser, etc.)
# Last updated: based on full source review March 2026

## 🔴 STOP — Read This Before Making Any Change

This is a **live security intelligence platform** used by real clients.
Bugs have direct safety implications. Every rule below exists because
something broke in production. Follow them.

---

## Stack Reference

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Supabase (Postgres + 200+ Edge Functions) |
| Edge Runtime | Deno (all supabase/functions/) |
| Auth | Supabase Auth + MFA |
| Realtime | Supabase Realtime |
| Deployment | Cloudflare Workers (wrangler.toml) |
| AI | OpenAI + Gemini (via edge functions) |
| Ops Router | system-ops (single entry point for all health/maintenance) |
| Tests | Playwright (frontend) + scheduled-pipeline-tests (backend) |

---

## How the Health System Works

Understanding this is critical — it's what keeps breaking.

```
useFortressHealth (frontend, every 2min)
  └── Queries 16 Supabase tables directly
  └── Scores 15 loops: closed / partial / idle
  └── Displays fortifyScore (0-1) in the UI

system-watchdog (Supabase cron, daily 06:00 MST)
  └── Load learnings from watchdog_learnings
  └── Collect telemetry (16 parallel DB queries)
  └── AI Analysis → auto-remediation attempts
  └── Re-verify → store learnings → email ak@silentshieldsecurity.com
  └── Self-validation: if it can't query its own tables → CRITICAL alert

system-ops (consolidated action router)
  └── action=health-check → probes DB, auth, storage, AI gateway
  └── action=watchdog     → delegates to system-watchdog
  └── action=pipeline-tests → delegates to scheduled-pipeline-tests
  └── action=smoke-test   → deploy-time smoke test

scheduled-pipeline-tests (cron + CI-callable)
  └── TEST 1: Document processing pipeline
  └── TEST 2: Signal ingestion → DB write → cleanup
  └── TEST 3: AI Decision Engine health + output quality
  └── TEST 4: AEGIS briefing response non-empty
  └── TEST 5: All 15 loops have activity (last 24h)
  └── TEST 6: Stalled autopilot tasks (<30min running)
  └── TEST 7: Bug workflow manager reachable
  └── TEST 8: Critical edge functions deployed
  └── TEST 9: Watchdog self-validation probe

bug-workflow-manager (frontend + edge function)
  └── Actions: get_open_bugs → propose_fix → verify_fix → run_tests → notify_user
  └── Uses bug_reports table
  └── Watchdog consumes bug_reports to detect fixable patterns
```

---

## 🚫 High-Risk Zones — Human Review Required Before Touching

### Auth & Identity (breaking = platform lockout)
- `src/hooks/useAuth.tsx`
- `src/hooks/useMFA.tsx`
- `src/hooks/useIsSuperAdmin.tsx`
- `src/hooks/useUserRole.tsx`
- `src/contexts/` — all context providers

### Health & Watchdog (breaking = silent failures)
- `src/hooks/useFortressHealth.ts` — 15-loop health monitor
- `src/hooks/useSystemHealth.tsx`
- `src/hooks/useSystemTestRun.ts`
- `src/lib/testing/systemTestRunManager.ts`
- `src/lib/testing/e2eTests.ts`
- `supabase/functions/system-watchdog/`
- `supabase/functions/system-ops/`
- `supabase/functions/scheduled-pipeline-tests/`

**Why:** If the health system breaks, you lose visibility into everything else.
A silent watchdog is worse than a missing feature.

### Database & API
- `src/integrations/supabase/` — never edit generated types manually
- `supabase/` migrations — always create new migrations, never edit old ones
- Any RLS policy changes

### Multi-Tenant
- `src/hooks/useTenant.tsx`
- `src/hooks/useClientSelection.tsx`
- Never remove `.eq('client_id', clientId)` guards from data queries

---

## Mandatory Workflow for Every Fix

```
1. Reproduce bug → write a FAILING test that demonstrates it
2. Make the fix
3. Run: npm run build       ← must complete with 0 TypeScript errors
4. Run: npm run test:e2e    ← Playwright tests must pass
5. For edge function changes: trigger system-ops pipeline-tests manually
6. For health system changes: verify fortifyScore stays ≥ 0.8 in UI
7. All green → commit with proper message format
```

---

## Supabase Edge Function Rules

- **Batch size limit:** Never exceed 50 IDs per delete/update query (400 URL length errors)
- **Always use service role key** in edge functions, never anon key for writes
- **New functions:** add to `deploy-functions.sh` AND document in `API_DOCUMENTATION.md`
- **system-ops is the router:** new maintenance actions go in system-ops, not new functions
- **Deno imports:** use `npm:` prefix for npm packages, pin versions (e.g. `npm:@supabase/supabase-js@2`)
- **55s timeout:** all edge function operations must complete in <55s (Supabase hard limit)
- **Cron changes:** update supabase/ config, not frontend timers

---

## The 15 Fortress Loops (Never Break These Writers)

Each loop writes to a specific table. If you touch a function that writes
to these tables, verify the loop stays `closed` (not `idle`) after your change:

| Loop | Table | Layer |
|---|---|---|
| OODA | autonomous_actions_log | reliability |
| Watchdog | watchdog_learnings | observability |
| Signal Ingestion | signals | reliability |
| Knowledge Growth | expert_knowledge | learning |
| Consolidation | signal_updates | reliability |
| Learning Sessions | agent_learning_sessions | learning |
| Feedback Events | implicit_feedback_events | observability |
| Predictive Scoring | predictive_incident_scores | learning |
| Agent Accuracy | agent_accuracy_tracking | learning |
| Analyst Preferences | analyst_preferences | learning |
| Hypothesis Trees | hypothesis_trees | learning |
| Debate Records | agent_debate_records | learning |
| Scan Results | autonomous_scan_results | observability |
| AEGIS Briefings | ai_assistant_messages | reliability |
| Escalation Rules | auto_escalation_rules | safety |

---

## Known Recurring Bug Patterns (Watchdog Auto-Fixes These)

The watchdog already knows about these — it auto-remediates them.
Don't introduce new code that creates them:

| Pattern | Root Cause | Watchdog Fix |
|---|---|---|
| Orphaned signals | Deleted clients with linked signals | fix_orphaned_signals |
| Orphaned feedback | Deleted signals with linked feedback | fix_orphaned_feedback |
| Stale source timestamps | Sources not ingesting | fix_stale_source_timestamps |
| Stalled autopilot tasks | Tasks stuck in 'running' >30min | fix_stalled_autopilot_tasks |
| Orphaned autopilot tasks | Tasks with no session_id | fix_orphaned_autopilot_tasks |
| Open circuit breakers | Monitors not running | reset_circuit_breakers |
| Supabase 400 errors | URL too long (>50 IDs in query) | chunk arrays to ≤50 items |
| vip_id references | Legacy field — use client_id | rename on sight |

---

## Hook Dependency Chain

Before editing any hook, grep for its consumers first:
`grep -r "useAuth" src/ --include="*.tsx" --include="*.ts"`

```
useAuth
  └── useIsSuperAdmin → useUserRole → useTenant → useClientSelection
  └── useRealtimeNotifications
  └── useFortressHealth
      └── useSystemHealth → useErrorNotifications
      └── useSystemTestRun → systemTestRunManager → e2eTests
```

---

## TypeScript Rules

- Zero `any` in hooks, contexts, or lib/
- All Supabase query results must use generated types from `src/integrations/supabase/types.ts`
- New hooks must export a named TypeScript interface for their return value

---

## Commit Message Format

```
type(scope): description

Types: feat | fix | perf | refactor | test | docs | chore
Scopes: auth | health | watchdog | supabase | ui | agents | travel | signals | pipeline

Examples:
  fix(watchdog): prevent self-validation false positive on empty tables
  feat(pipeline): add AI output quality check to scheduled-pipeline-tests
  test(health): add loop freshness assertions to e2eTests
  fix(supabase): chunk batch deletes to avoid 400 URL length errors
```

---

## When In Doubt

1. `npm run build` — zero TypeScript errors before anything else
2. Check `CRITICAL_WORKFLOWS.md` for business-critical flows
3. Check `DATABASE_SCHEMA.md` before any schema changes
4. Trigger `system-ops?action=health-check` after any edge function change
5. Watch the fortifyScore in the UI — it should stay ≥ 0.8 after your change
6. If you broke a loop: find what stopped writing to its table and fix that first
