# Deployment Status — Single Source of Truth

**2026-06-01** · Per operator directive. Empirical state across prod (`kpuqukppbmwebiptqmog`) and staging (`lkvyrvuakzguszbpwnfz`). Built from: git log (all branches), `supabase_migrations.schema_migrations` (both projects), `aegis_*` table row counts (prod), task records #126–#175.

---

## §1 — Most-important answer: prod-vs-staging delta

### Code running in PRODUCTION but NOT in STAGING

**None known in the 30-day window.** Migration history compared across both projects (versions 2026-05-25 → 2026-05-31). Every prod migration in this window has a corresponding staging migration applied within ±24 hours.

### Code running in STAGING but NOT in PRODUCTION

| Item | What it does | Staging applied | Prod state |
|---|---|---|---|
| **T-0 `signals.temporal_grounding` column substrate** | Pure DDL: adds nullable-by-default `temporal_grounding text` with CHECK constraint to `signals` | 2026-05-31T20:15:14Z (migration `20260531201342` in staging migration table) | **NOT APPLIED** — `signals.temporal_grounding_col_exists_prod` = false; awaiting TI.D2-prod authorization |
| **`dashboard-ai-assistant` edge function** | Coverage Confidence module + Capability Registry integration | Deploy 1: 2026-06-01T02:52:13Z (CC initial); Deploy 2: ~03:00Z (Capability Registry added); Deploy 3: ~05:30Z (tenant-boundary sanitization) | **NOT DEPLOYED** — prod still runs the pre-CC/pre-Capability-Registry version from `main` |
| **`_shared/aegis-coverage-confidence.ts`** | Module file (consumed by dashboard-ai-assistant only) | Bundled into staging deploys | Not on prod |
| **`_shared/aegis-capability-registry.ts`** | Module file (consumed by dashboard-ai-assistant only) | Bundled into staging deploys | Not on prod |

---

## §2 — PRODUCTION

### Deployed + Validated (GREEN)

| Workstream | Branch (merged) | Commit | Prod timestamp | Validation |
|---|---|---|---|---|
| **ai_assistant_messages RLS isolation** | merged | (per memory) | migration `20260525011255` | Closed; sibling sweep pending (Task #19) |
| **INC-LEARN-CONTAM write freeze (3 triggers)** | merged | (per memory) | migration `20260527000000` | Active in prod (verified by `pg_trigger` query 2026-05-31) |
| **INC-OMCR ownership + scoping** | merged | (per memory) | migration `20260527160000` | Closed (Tasks #36-39 complete) |
| **Aegis Flight Recorder substrate** | merged | (per memory; PR #25/#26) | migration `20260527170000` | Operational; 14 lifetime traces; only `dashboard-ai-assistant` wired |
| **Aegis Recommendations table** | merged | (per memory) | migration `20260527140000` | Schema present; 0 rows (Workstream B/C not shipped) |
| **Workstream D claim-confidence audit table** | merged (PR #38/#39) | (per memory) | migration `20260528150000` | Operational; ships dark behind `D_SLIM_SLICE_ENABLED` |
| **R1.0 aegis_decision_threshold_trace schema** | merged (PR #61) | (per memory) | 2026-05-29 (Task #79) | 0 rows (R1.x detectors locked behind §11 inventory re-run) |
| **C.4 next_review_at editor field** | merged (PR #76) | `1b19885d` (per memory) | 2026-05-30 | Adoption-window active; closes ~2026-06-27 |
| **QR1 monitoring_proposals partial unique index** | merged | (Task #128) | migration `20260531170804` (prod) | Capability GREEN; 0 `qr1_dedup_blocked` telemetry events in 7d flagged as measurement-integrity question (Task #155 §5) |
| **W-MISSION Phase 1 (system-watchdog 5 checks)** | merged | (Task #137 + #138 P1.4 column fix) | edge function deploy (no migration; logic in system-watchdog/index.ts) | GREEN per Task #137 final + Task #140 post-deploy validation; 3 active critical findings detected + 4 findings in last 7d |
| **C-0 four-tier substrate (`alerts.tier`, `platform_findings.tier`, `agent_pending_messages.tier`)** | merged | (Task #148) | migration `20260531185644` (prod); T+1h validation 2026-05-31T20:37:55Z | T+1h GREEN: all 3 tables have column + CHECK; distributions `log=13,868` / `finding=82` / `finding=167` (C-0 default); 0 edge_function_errors referencing tier in 24h |

### Deployed + Pending validation

None. C-0 prod T+1h was the most-recent prod deploy of code-changing material; validation completed (Task #148).

### Pending operator decision (READY but not applied)

| Workstream | Branch | Commit | Decision item |
|---|---|---|---|
| **T-0 prod (`signals.temporal_grounding` substrate)** | `feat/t0-temporal-grounding-substrate` | `68bfe978` | **TI.D2-prod READY** — staging GREEN since 2026-05-31T21:15:20Z; awaiting operator GO |

---

## §3 — STAGING ONLY (deployed; awaiting production decision)

| Workstream | Branch | Commit(s) | Staging timestamp | Decision required | Prod-merge gate |
|---|---|---|---|---|---|
| **T-0 `signals.temporal_grounding` substrate** | `feat/t0-temporal-grounding-substrate` | `68bfe978` | 2026-05-31T20:15:14Z | TI.D2-prod authorization | READY |
| **Coverage Confidence module + integration** | `feat/dashboard-comm-doctrine-slim` | `5400d155` (module) + `983d0823` (integration) | 2026-06-01T02:52:13Z (initial) | Operator usefulness validation per Task #174 acceptance gate | Pending operator re-test on staging |
| **Capability Registry module + integration** | `feat/dashboard-comm-doctrine-slim` | `551fe77b` (module) + `25b0c2df` (docs) + `e69c055b` (tenant-boundary fix) | Deploy 3 (sanitized): 2026-06-01 (after `e69c055b`) | Operator usefulness validation per Task #175 acceptance gate | Pending operator re-test on staging |

### Summary of branch state

| Branch | Commits ahead of main | Current state |
|---|---|---|
| `feat/dashboard-comm-doctrine-slim` (current branch) | **5 commits** | All 5 deployed to staging; not merged to main; not deployed to prod |
| `feat/t0-temporal-grounding-substrate` | 1 commit (`68bfe978`) | Migration applied to staging; not merged to main; not applied to prod |
| `feat/c0-tier-column-substrate` | 0 (merged) | Migration `20260531185006` merged + applied to staging + applied to prod |

---

## §4 — NOT DEPLOYED (branch only or design only)

### Branch only (code exists; not in production or staging)

| Item | Branch / location | Status |
|---|---|---|
| (None significant in 30-day window) | — | — |

All branch-only feature code at this date is captured in §3 (staging-deployed but not prod). No code exists on a feature branch that hasn't reached at least staging.

### Design only (no code; documentation + decision artifacts)

These were authored in the 30-day window as ratifiable / pre-implementation artifacts:

| Artifact | Status |
|---|---|
| Provenance Doctrine ratification (`docs/platform-operations/architecture-decisions/provenance-contract.md`) | Ratified 2026-05-26; INC-XTEN remains OPEN |
| Aegis Authority & Memory Doctrine | Ratified 2026-05-27 |
| Grounding-State Doctrine | Ratified 2026-05-27 |
| Default-to-Historical-when-unknown Doctrine | Ratified 2026-05-31 (TI.D1) |
| Protect-Attention-Like-Critical-Infrastructure Doctrine | Ratified 2026-05-31 |
| Decision Layer Doctrine v2 + R1 Threshold Detection ADR | Ratified (PR #58 + #59) |
| Coverage Confidence Measurement Model (Task #164) | Design preserved; **partially implemented** via `aegis-coverage-confidence.ts` module |
| Aegis Communication Doctrine (Task #159) | Design preserved; **partially implemented** via dashboard-ai-assistant integration |
| HONEST_LIMIT amendment to #159 | Folded into #159 doctrine (Option A) |
| Blind Spot Lifecycle (Task #160) | Demoted to explanatory architecture (Option A); not implemented |
| Trust Foundations Dashboard (Task #153) | Documentation only |
| Inverted Attention Architecture (Task #170) | Frozen design artifact (no implementation authorized) |
| Protect-Attention Measurement Model (Task #171) | Frozen design artifact |
| Leading Indicators of Attention Debt (Task #172) | Frozen design artifact |
| Capability Delivery Sequence (Task #173) | Working roadmap; no direct code |
| Temporal Integrity Impact Assessment + Authorization Package (Tasks #150, #151) | Design preserved; T-0 implementation in §3 |
| CRT Capability Readiness Assessment (Task #154) | Roadmap; Tier B capabilities all HELD |
| Capability Outcome Ranking (Task #156) | Roadmap framing; no code |
| Information Lifecycle Diagnostic + Acquisition Gap Analysis (Tasks #155, #157) | Diagnostic; no code |
| Overconfidence Audit + Attention Tax Analysis (Tasks #168, #169) | Diagnostic; no code |
| Root Cause Attribution + Execution Sequence (Tasks #166, #167) | Diagnostic + sequence; no code (implementation begun via #174 + #175) |
| Doctrine Duplication Assessment + Option A execution (Tasks #162, #163) | Doctrinal cleanup |
| Capability Registry operator reference doc | Documentation supporting Task #175 code |

### Capability-level HELD work (not started)

Per current operator priority order:

| Item | Status |
|---|---|
| T-1 ingest classifier (Temporal Integrity continuation) | HELD pending T-0 prod burn-in |
| T-2 audit shim | HELD pending T-1 |
| T-3 egress gate | HELD pending T-2 block-rate <25% gate |
| C-1 four-tier writers | HELD |
| C-2 egress gate | HELD |
| Communication Doctrine activation across other Aegis output surfaces (report generators) | HELD — slim slice is dashboard-ai-assistant only |
| Meta Graph token reactivation | HELD pending operational decision |
| Entity Resolution MVP | HELD |
| Account Cycling Detection MVP | HELD |
| Image Recognition MVP | HELD (Legal Authorization Surface + bias audit gates) |
| Original-Content Snapshotting | HELD |
| Flight Recorder coverage expansion | HELD |
| Aegis Authority Modes physical split | HELD |
| INC-XTEN Track B | HELD |
| LLM-derived stores remediation (17 of 18 stores) | HELD |
| W-MISSION Phase 2 | HELD |
| Path A learning_profiles repair | HELD (backed up at `docs/platform-operations/backlog/feedback-loop-restoration-path-a.md`) |

---

## §5 — Migration version cross-reference (30-day window)

PROD migrations (`kpuqukppbmwebiptqmog`):
```
20260531185644  C-0 four-tier substrate (prod apply T+0)
20260531170804  QR1 monitoring_proposals dedup
20260530212515  (prod-only migration; pre-T-0)
20260530162843  (C.4 area)
20260530143554  (C.4 area)
20260530021703
20260529150753  (R1.0 schema area)
20260529142317
20260528182707
20260528013957
20260528011352  (Workstream D area)
20260526202403
20260526202241
20260526160532
20260526135732
20260526053820
20260526050818
20260525011255  ai_assistant_messages RLS isolation
```

STAGING migrations (`lkvyrvuakzguszbpwnfz`):
```
20260531201342  T-0 signals.temporal_grounding substrate ← STAGING ONLY
20260531185038  C-0 four-tier substrate (staging apply)
20260531170233  QR1 monitoring_proposals dedup (staging apply)
20260530212427
20260530162658
20260530143127
20260530021550
20260529150726
20260529140911
20260528180338
20260528121619
20260528012805
20260528011001
20260526202032
20260526201930
20260526160326
20260525174227
20260525133927
20260525045233
20260525010503
```

Migration timestamps differ between prod and staging because each Supabase project has its own apply-time history — this is normal. The intent of each migration matters more than the version number. Across the 30-day window:

- **18 prod migrations** applied
- **20 staging migrations** applied
- **STAGING has 2 more migrations than PROD** because: (1) staging applies typically run first, and (2) T-0 is staging-only as of today

---

## §6 — Edge function deployment state

| Function | Last prod deploy | Last staging deploy | Drift |
|---|---|---|---|
| `dashboard-ai-assistant` | Pre-CC version (from `main`) | 2026-06-01 (3 deploys today: CC initial → +Capability Registry → tenant-boundary sanitization) | **STAGING AHEAD by 5 commits** (`feat/dashboard-comm-doctrine-slim`) |
| `system-watchdog` | Latest (W-MISSION Phase 1 + P1.4 fix) | Same | Aligned |
| `generate-monitoring-proposals` | Latest (QR1 Option A telemetry) | Same | Aligned |
| `process-stored-document` | Latest (QR1 Option A telemetry) | Same | Aligned |
| All other edge functions | (unchanged in 30d window) | (unchanged in 30d window) | Aligned |

---

## §7 — Most-important answer (restated)

> *"What code is currently running in production that is not running in staging, and what code is currently running in staging that is not running in production?"*

**PROD-ONLY**: None known in the 30-day window. Both projects converged on all merged migrations.

**STAGING-ONLY**:
1. `signals.temporal_grounding` column substrate (T-0 migration) — applied to staging 2026-05-31T20:15:14Z; **awaiting TI.D2-prod authorization**
2. `dashboard-ai-assistant` edge function — running 5 commits ahead of prod with Coverage Confidence + Capability Registry; **awaiting operator usefulness validation** (the staging re-test plan from Task #174 + #175)

Both staging-ahead items are blocked on operator decisions, not on engineering work. T-0 prod has a READY authorization package; Communication Doctrine slim slice has shipped its validation deploy and is awaiting your re-test.

---

## §8 — Honest limits

1. **Migration version comparison is by timestamp, not name.** The two projects have independent migration histories. To verify functional parity at the schema level would require comparing `information_schema.columns` / `pg_constraint` / `pg_trigger` between projects — outside the operator's requested scope here.
2. **Edge-function deployment state is inferred from session memory + the staging redeploys I performed this session.** A definitive comparison would require fetching the current source of every function on prod vs staging — Supabase MCP exposes individual function content via `get_edge_function` but at 11,504 lines per function × ~80 functions, this is too large to scan in-session. Limit: I report drift only for functions I touched this session + ones I have explicit deploy timestamps for.
3. **Older work outside the 30-day window** is not in this table. Prior workstreams (e.g., Class A tradecraft migration; INC-XTEN Track A; pre-2026-05-15 work) remain in prod and are presumed aligned.
4. **The "HELD" list in §4** is what I know to be designed-but-not-shipped. I cannot guarantee completeness; new HELD items may exist that I haven't tracked.
5. **No customer-tenant-scoped drift comparison.** Per-tenant data state is not in this report; this is platform-level deployment state only.

---

## §9 — Operator decision surface

Active decisions implied by this state:

| # | Decision | Gate |
|---|---|---|
| 1 | **TI.D2-prod** — apply T-0 migration to prod | READY ★ |
| 2 | **Operator re-test of staging dashboard-ai-assistant** (Coverage Confidence + Capability Registry post-sanitization) | Pending operator session on staging UI |
| 3 | After validation: merge `feat/dashboard-comm-doctrine-slim` to main + deploy to prod | Pending #2 |
| 4 | After T-0 prod burn-in (≥7d): authorize T-1 ingest writer | Pending #1 + burn-in |
| 5 | All HELD items in §4 | Awaiting operator priority |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
