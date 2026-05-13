# Pre-CRT Onboarding Audit — 2026-05-13

**Auditor:** Claude Opus 4.7 (paired with operator Aaron Kilback)
**Repo HEAD at audit start:** `8d3d68cc`
**Scope:** Pipeline correctness · Agent network · Learning loops · Tenancy/RLS · Monitoring · Support path · AI behavior
**Out of scope:** `aegis.silentshieldsecurity.com` frontend (deferred post-demo)

**Rules of this document:**
1. Every finding has a verifiable evidence pointer (`file:line` or DB query + output).
2. No claim survives without a second-pass verification step.
3. Severity tags map to CRT-onboarding gating:
   - `BLOCKER` — cannot onboard CRT until fixed
   - `SERIOUS` — onboard but pay for it operationally
   - `NICE` — quality improvement, not gating
4. No fixes shipped during audit. Findings only.

---

## Topology snapshot (audit start)

Query: `SELECT counts FROM core tables` at 2026-05-13 ~17:35 UTC.

| Metric | Value |
|---|---|
| Public tables | 324 |
| Edge functions | 299 |
| Active cron jobs | 73 |
| Total agents | 59 |
| Active agents (`is_active=true`) | 42 |
| Distinct agents fired (signal_agent_analyses, 7d) | 32 |
| **Dormant active agents** | **10 (42 − 32)** |
| Clients | 5 (3 inactive: `_qa_test_client`, `_benchmark_petronas`, `_benchmark_bcch`) |
| Active clients | 2 (Petronas Canada, Cascade Energy) |
| Signals admitted (7d) | 185 |
| Filtered signals (7d) | 1166 |
| **AI gate admit ratio (7d)** | **13.7%** (target post-May-tuning: 25–30%) |
| Incidents (30d) | 36 |
| Entities under active monitoring | 48 |
| Published KB articles | 18 (12 seeded today) |

## Phase tracker

- [x] Phase 1 — Inventory & topology (every cron, function, table, agent)
- [ ] Phase 2 — Pipeline trace (5–10 real recent signals end-to-end)
- [ ] Phase 2 — Pipeline trace (5–10 real recent signals end-to-end)
- [ ] Phase 3 — Agent network audit (profiles, routing, calibration)
- [ ] Phase 4 — Learning loops (self-learning, KB, watchdog, calibration)
- [ ] Phase 5 — Tenancy & RLS audit
- [ ] Phase 6 — AI behavior (prompts, tool calls, hallucination, consistency)
- [ ] Phase 7 — Monitoring & regression detection
- [ ] Phase 8 — Support / bug-report path

---

## Findings index (filled as discovered)

| ID | Severity | Category | Title |
|---|---|---|---|
| F-001 | BLOCKER | pipeline | AI gate admit ratio chronically below target (13.7% 7d avg; 0% on 2026-05-07) |
| F-002 | BLOCKER | agent-network | 13 active agents have NEVER fired — including RYAN-INTEL, SHERLOCK, HERALD |
| F-003 | SERIOUS | agent-network | 5 agents went silent in the last 24h after firing earlier |
| F-004 | BLOCKER | observability | `filtered_signals.source_name` was 100% null for 10+ days (Apr 29–May 8) — operators could not debug what was being rejected from where |
| F-005 | BLOCKER | agent-network | activate-dormant-specialists cron runs daily but dispatches 0 most days — the dispatch loop is broken at agent-router scoring |
| F-006 | BLOCKER | tenancy | Real production signals (`is_test=false`) being routed to inactive sandbox clients (`_benchmark_petronas`, `_qa_test_client`) — tenant isolation is one-directional |
| F-007 | BLOCKER | tenancy / RLS | **Cross-tenant data leak via role-only RLS policies** — any `analyst` role sees every tenant's signals, incidents, reports, entities, agent analyses. Multiple wildcard auth.uid() IS NOT NULL policies. The proper tenant-scoped policies exist but are bypassed by OR-evaluation. |
| F-008 | BLOCKER | tenancy / RLS | Multiple tenant-sensitive tables have NO tenant_id and NO client_id column: `signal_agent_analyses`, `signal_correlation_groups`, `agent_debate_records`, `reports`, `agent_actions`, `poi_investigations`. Cannot be tenant-scoped without schema changes. |
| F-009 | BLOCKER | ai-behavior / learning | 88% of specialist analyses have no usable confidence score (56% zero, 32% null). Calibration loop and belief-decay are operating on near-empty data — claimed accuracy improvements are illusory. |
| F-010 | SERIOUS | ai-behavior | Specialist agents analyze fabricated/hallucinated signals as if real — no fact-check or epistemic flag. Brand-breaking exposure for CRT. |
| F-011 | SERIOUS | ai-behavior | Specialist agents drift outside their lane (e.g. WILDFIRE producing protest/activism analysis). Memory `feedback_drift_vs_applied_expertise.md` distinguishes drift from applied lens — but several analyses sampled today are drift, not applied. |
| F-012 | BLOCKER | monitoring | Benchmark is NEVER auto-run on deploy. Regression detection is manual-only. `loop-diagnostics.yml` is workflow_dispatch (manual). No alert pipeline for critical platform_findings rows — they sit in DB until an operator notices. |
| F-013 | SERIOUS | support-path | `bug_reports.user_id` exists but no `tenant_id`. CRT analyst files a bug → operator inbox shows it with no tenant attribution. Will collide when multiple tenants file similar bugs. |
| F-014 | NICE | observability | Heartbeat counter drift on multiple monitors (see F-001 context — partially fixed today in commit b9ce0e31). Other monitors still untested for the same pattern. |
| F-015 | BLOCKER | security / frontend | **`ProtectedRoute` has NO role-based access control.** Any authenticated user can navigate directly to `/super-admin`, `/user-management`, `/tenant-admin`, `/integrations`, `/rule-approvals`. CRT analyst URL-bars into operator pages. |
| F-016 | SERIOUS | observability / cost | No LLM cost alerting or budget cap. Token usage trending up ($3/day early May → $17/day today). No alarm if a runaway loop 10x's the bill. |
| F-017 | SERIOUS | security | LLM provider API keys (OpenAI, Gemini, Anthropic, Perplexity) untouched in 69+ days. No rotation cadence. No alert on stale keys. |
| F-018 | SERIOUS | data-integrity | `is_active=false` on `ai_agents` is not enforced consistently — `Scout` (deactivated 2026-05-10) fired twice afterwards. Some routing path ignores the flag. |
| F-019 | SERIOUS | data-integrity | 17 deactivated agents (not 6 as initially reported). Includes literal test agent `WATCH-ALPHA-2` with `specialty='test specialty'`, `persona='test persona'` still sitting in production table. |
| F-020 | UNVERIFIED | DR / backup | Cannot confirm backup retention or PITR enablement via MCP. Needs operator verification in Supabase dashboard. No tested restore procedure documented in repo. |
| F-021 | POSITIVE | ai-behavior | Agent system_prompts are high-quality. Sampled 7 active agents — all cite correct domain frameworks (CSIS Threat Assessment, RCMP INSET, CARVER, CFFDRS/FWI, OSFI/PIPEDA/NEB Act, NIST SP 800-161, MITRE ATT&CK, PTES, CPTED). This is NOT the source of the F-010/F-011 quality issues. |
| F-022 | SERIOUS | reproducibility | Production has schema artifacts NOT in migrations. Discovered during staging stand-up: `get_user_accessible_client_ids()` function (used by every tenant-scoped RLS policy) was created via SQL editor, never tracked in a migration file. A fresh prod rebuild from the migrations directory would have broken RLS silently. Plus duplicate-versioned migrations (two files named `20260503000002_*`), several data-seed migrations hardcoding production-only UUIDs, and at least one migration referencing a table not yet created. |

---

## F-001 — AI gate admit ratio chronically below target

**Severity:** BLOCKER
**Category:** pipeline / AI behavior
**Discovered:** Phase 1 inventory

**Claim:** The AI relevance gate has rejected the vast majority of all candidate signals across the last 14 days. Across many days it rejected ≥95%. On 2026-05-07 it rejected 100% (253/253 admitted=0). Today (2026-05-13) the running admit ratio is 16%. Best recent day (2026-05-12, after multiple tuning passes) was 28%. Target band per stated tuning intent: 25–30%.

**Evidence (DB query + result):**
```sql
SELECT date_trunc('day', t.created_at) AS day,
       COUNT(*) FILTER (WHERE t.tbl='signals') AS admitted,
       COUNT(*) FILTER (WHERE t.tbl='filtered_signals') AS rejected,
       ROUND(100.0 * COUNT(*) FILTER (WHERE t.tbl='signals') / NULLIF(COUNT(*),0), 1) AS pct
FROM (
  SELECT created_at, 'signals' AS tbl FROM signals
    WHERE created_at >= NOW() - INTERVAL '14 days' AND deleted_at IS NULL AND is_test=false
  UNION ALL
  SELECT filtered_at, 'filtered_signals' AS tbl FROM filtered_signals
    WHERE filtered_at >= NOW() - INTERVAL '14 days'
) t GROUP BY 1 ORDER BY 1 DESC;
```

Output (selected rows):
```
2026-05-13   admitted=29   rejected=152   pct=16.0
2026-05-12   admitted=97   rejected=250   pct=28.0
2026-05-11   admitted=25   rejected=135   pct=15.6
2026-05-10   admitted=3    rejected=28    pct=9.7
2026-05-09   admitted=13   rejected=66    pct=16.5
2026-05-08   admitted=17   rejected=222   pct=7.1
2026-05-07   admitted=0    rejected=253   pct=0.0     ← total blackout
2026-05-06   admitted=4    rejected=258   pct=1.5
2026-05-05   admitted=14   rejected=227   pct=5.8
2026-05-04   admitted=22   rejected=343   pct=6.0
2026-05-03   admitted=11   rejected=391   pct=2.7
2026-05-02   admitted=9    rejected=351   pct=2.5
```

**Why this is a BLOCKER for CRT:**
A CRT analyst opening the Petronas feed on a typical day in this window saw ≤10% of the OSINT signal volume the platform actually ingested. The rest sat in `filtered_signals` invisible to the operator UI. Coverage gaps were not because the platform missed content — it picked it up and threw it away. For a service whose value proposition is "we see the threats you'd miss," a 90%+ rejection rate against a 25–30% target is product-breaking when a paying tenant arrives.

The 2026-05-07 total-blackout day correlates with the QA contamination cleanup recorded in memory (`project_qa_signal_contamination_2026_05_07.md`) — the boundary added to `ingest-signal` (rejecting `is_test=true` on active clients) may have over-applied that day. Needs reproduction.

**Second-pass verification:** Crosscheck by source: which sources are being rejected hardest?
```sql
SELECT source_name, COUNT(*) FILTER (WHERE filtered_at >= NOW() - INTERVAL '7 days') AS rejected_7d
FROM filtered_signals GROUP BY 1 ORDER BY rejected_7d DESC LIMIT 10;
```
Output: `Google News API` rejected 575 in 7d, `null` source rejected 564. The `null` source category alone is a separate finding — source attribution is being dropped on a substantial fraction of rejections.

**Reproduction:** Same query, any day. Run before/after each AI gate tuning to verify direction.

**Fix scope:** Medium. Multiple gates contribute (monitor-social-unified, process-intelligence-document, ingest-signal). Requires consolidating to a shared gate (`_shared/ai-relevance-gate.ts`) with per-source threshold map + visible-to-UI rejection reasons. See F-006 (proposed) for the consolidation.

---

## F-002 — 13 active agents have NEVER fired

**Severity:** BLOCKER
**Category:** agent-network / routing
**Discovered:** Phase 1 inventory

**Claim:** Of 42 active agents, 13 have **never** appeared in `signal_agent_analyses` since the table was populated. They are configured (`is_active=true`, system_prompt present, specialty defined) but the routing layer has never reached them. Many are core CRT-facing agents:

| Call sign | Role | is_client_facing |
|---|---|---|
| `RYAN-INTEL` | Threat detection, OSINT analysis, behavioral signal mapping (primary OSINT agent) | true |
| `RYAN-GLOBE` | Global threat synthesis, strategic intelligence, PMESII multi-domain | true |
| `SHERLOCK` | Investigative intelligence, link analysis, timeline reconstruction | true |
| `HERALD` | Intelligence communication, executive briefing, BLUF writing | true |
| `DR-HOUSE` | Investigative diagnosis, ACH, alternative-hypothesis generation | true |
| `THE-SENTINEL` | Perimeter security, access-control intelligence | true |
| `JOCKO` | Military strategy, leadership, crisis response | true |
| `VECTOR-TRVL` | Executive protection, VIP travel security | true |
| `AUREUS-GUARD` | High-value asset security, art/precious-metals protection | false |
| `FORTRESS-GUARD` | Policy enforcement, content moderation | false |
| `PATTERN-SEEKER` | Pattern detection, correlation | false |
| `RED-TEAM` | Adversarial review, false-positive detection | false |
| `TIME-WARP` | Chronology reconstruction, time-pattern analysis | false |

**Evidence (DB query + result):**
```sql
SELECT
  CASE WHEN last_fired IS NULL THEN 'never_fired'
       WHEN last_fired < NOW() - INTERVAL '7 days' THEN 'silent_7d_plus'
       WHEN last_fired < NOW() - INTERVAL '24 hours' THEN 'silent_24h'
       ELSE 'active' END AS status,
  COUNT(*) AS agents
FROM (
  SELECT a.call_sign,
    (SELECT MAX(created_at) FROM signal_agent_analyses s WHERE s.agent_call_sign = a.call_sign) AS last_fired
  FROM ai_agents a WHERE a.is_active = true
) t GROUP BY 1;
```
Output: `never_fired: 13`, `silent_24h: 5`, `active: 24`.

**Why this is a BLOCKER for CRT:**
Memory entry `project_dormant_agent_learning_loop.md` claims the daily activate-dormant-specialists cron closes the loop "for all 42 specialists, not just the top traffic ones." Live data contradicts that — 13 specialists have produced zero analyses ever. The cron is running (`activate-dormant-specialists-daily` at `0 6 * * *`, last fired 11h ago) but evidently isn't reaching its declared scope. CRT will reasonably ask what coverage the platform provides; the memo claims "investigative", "executive briefing", "global threat" coverage. The agents exist; the routing doesn't reach them.

**Second-pass verification:** Spot-check agent-router to confirm whether RYAN-INTEL's specialty embedding exists at all:
```sql
SELECT a.call_sign,
  EXISTS(SELECT 1 FROM agent_specialty_embeddings e WHERE e.call_sign = a.call_sign) AS has_embedding
FROM ai_agents a WHERE a.is_active = true AND a.call_sign IN ('RYAN-INTEL','SHERLOCK','HERALD','DR-HOUSE','JOCKO');
```
*(deferred — to confirm in next pass)*

**Reproduction:** Same dormancy-status query, any day. If the activate-dormant cron is doing its job, the count of `never_fired` should fall over time. Track the trendline.

**Fix scope:** Medium. Likely root cause is one of: (a) agent-router pgvector embeddings missing for these specialists, (b) activate-dormant-specialists is firing but writing to the wrong table, or (c) routing in multi-agent-debate has a hard list that omits them. Need to read the function bodies to confirm.

---

## F-003 — 5 agents went silent in the last 24h after firing heavily earlier

**Severity:** SERIOUS
**Category:** agent-network / event-coupling
**Discovered:** Phase 1 inventory

**Claim:** ECHO-WATCH, GUARDIAN, INSIDE-EYE, ORACLE, SIM-ARCH each fired 1–30 times in the 7-day window but their last fire was ≥24h ago. The 30-fire trio (GUARDIAN, INSIDE-EYE, ORACLE) all last fired on `2026-05-10 14:48:42` — within milliseconds of each other. That suggests a single triggering event burst, after which they went silent. Memory entry `project_vashouk_neointel7_2026_05_11.md` confirms an insider-threat case escalated around that window.

The risk for CRT: these are agents whose value lies in event-driven analysis (insider threat, predictive forecasting, executive protection). If they only fire when a specific event is hand-curated by an operator, they're not autonomous specialists — they're manual tools. CRT will hit cases where these specialists *should* contribute proactively and they won't.

**Evidence:**
```sql
SELECT call_sign, fired_7d, last_fired FROM (
  SELECT a.call_sign,
    (SELECT COUNT(*) FROM signal_agent_analyses s WHERE s.agent_call_sign = a.call_sign AND s.created_at >= NOW() - INTERVAL '7 days') AS fired_7d,
    (SELECT MAX(s.created_at) FROM signal_agent_analyses s WHERE s.agent_call_sign = a.call_sign) AS last_fired
  FROM ai_agents a WHERE a.is_active = true
) t WHERE fired_7d > 0 AND last_fired < NOW() - INTERVAL '24 hours'
ORDER BY last_fired;
```
Output:
```
SIM-ARCH    fired_7d=1    last_fired=2026-05-10 16:32:14
ECHO-WATCH  fired_7d=1    last_fired=2026-05-12 12:25:15
GUARDIAN    fired_7d=30   last_fired=2026-05-10 14:48:43  ← burst event
INSIDE-EYE  fired_7d=30   last_fired=2026-05-10 14:48:42  ← burst event
ORACLE      fired_7d=30   last_fired=2026-05-10 14:48:43  ← burst event
```

**Second-pass verification:** Check `agent_debate_records` from 2026-05-10 14:48 to confirm the burst was a single multi-agent debate triggered for the Vashouk case. If yes, that's expected event-coupled behavior. If no, the agents are leaking outside their lane.
*(deferred)*

**Fix scope:** S to M. May need to add proactive routing triggers for these agents on relevant signal types instead of waiting for an operator-initiated debate.

---

## F-004 — `filtered_signals.source_name` was 100% null for 10+ days

**Severity:** BLOCKER
**Category:** observability / debugging
**Discovered:** Phase 1 inventory (second-pass on F-001)

**Claim:** Between 2026-04-29 and 2026-05-08, every single row inserted into `filtered_signals` had `source_name = null`. Across those 10 days, that's **2,484 rejected signal candidates** with no source attribution. An operator asking "why isn't Twitter showing anything?" had no way to query for rejected-from-Twitter rows. The bug was silently fixed by some deploy on 2026-05-09, but new null inserts continue (19% of today's rejections still have null source).

**Evidence (DB query + result):**
```sql
SELECT date_trunc('day', filtered_at) AS day,
  COUNT(*) FILTER (WHERE source_name IS NULL) AS null_source,
  COUNT(*) FILTER (WHERE source_name IS NOT NULL) AS named_source,
  COUNT(*) AS total
FROM filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1 DESC;
```
Output:
```
day           null  named  total
2026-05-13     29    123    152      ← 19% null still leaking
2026-05-12     15    235    250
2026-05-11     19    116    135
2026-05-10      9     19     28
2026-05-09      1     65     66      ← bug fixed
2026-05-08    148     74    222      ← partial regression
2026-05-07    253      0    253      ← total
2026-05-06    258      0    258
2026-05-05    227      0    227
2026-05-04    343      0    343
2026-05-03    391      0    391
2026-05-02    351      0    351
2026-05-01    219      0    219
2026-04-30    164      0    164
2026-04-29     56      0     56
```

**Why this is a BLOCKER for CRT:**
"What's being filtered and why" is the first question a tenant analyst asks when their coverage looks thin. Without `source_name` they can't sort, filter, or count by source. The support-chat platform pulse query relies on this column to surface stale sources. Half the diagnostic value of the filter audit table was missing for 10 days.

**Second-pass verification:** Trace which insert paths still set null. The 29 nulls today suggest one or more monitor functions still don't populate source_name.
```sql
SELECT filter_reason, COUNT(*) FROM filtered_signals
WHERE filtered_at >= NOW() - INTERVAL '24 hours' AND source_name IS NULL
GROUP BY 1;
```
*(deferred — to confirm in next pass)*

**Fix scope:** S. Audit all `INSERT INTO filtered_signals` call sites (likely in `ingest-signal/index.ts` and `monitor-rss-sources` / `process-intelligence-document`), require `source_name` to be set with a fallback (`source_key` or `raw_json->>'source'`).

---

## F-005 — activate-dormant-specialists dispatches 0 most days

**Severity:** BLOCKER
**Category:** agent-network / learning-loop
**Discovered:** Phase 1 inventory (second-pass on F-002)

**Claim:** The daily `activate-dormant-specialists` cron job runs successfully, identifies 10 dormant agents, identifies ~80 candidate signals, and dispatches **0** to them on most days. Only one day in the last week (2026-05-10) successfully dispatched (7 of 8 attempted).

**Evidence (DB query + result):**
```sql
SELECT job_name, status, started_at, result_summary
FROM cron_heartbeat
WHERE job_name = 'activate-dormant-specialists-daily'
ORDER BY started_at DESC LIMIT 5;
```
Output:
```
2026-05-13 06:00  {dormant:10, attempted:1, dispatched:0, signals_available:80}
2026-05-12 06:00  {dormant:10, dispatched:0, signals_available:80}
2026-05-11 06:00  {dormant:10, dispatched:0, signals_available:80}
2026-05-10 16:31  {dormant:10, attempted:8, dispatched:7, signals_available:80}  ← only success
2026-05-10 16:30  {dormant:10, dispatched:0, signals_available:80}
```

**Mechanism (read from `supabase/functions/activate-dormant-specialists/index.ts:135-157`):**
For each candidate signal, call `agent-router` with `top_k=5`, look at the returned agents, dispatch only if the matched agent is in the dormant set. The function logic is correct — but in practice, agent-router's pgvector similarity ranks the SPECIALIST agents (VERIDIAN-TANGO, WILDFIRE, CERBERUS, LEX-MAGNA) higher than generalist agents (RYAN-INTEL, RYAN-GLOBE, SHERLOCK, HERALD). Generalists never make top-5 → never dispatched → permanent dormancy.

This is a structural routing limitation: high-traffic narrow specialists crowd out broad analysts in cosine-similarity ranking. The "self-healing" loop doesn't self-heal because the routing layer it depends on doesn't surface dormant agents.

**Why this is a BLOCKER for CRT:**
The promise in `project_dormant_agent_learning_loop.md` is that the 5-cron daily chain "closes predict→grade→update for all 42 specialists, not just the top traffic ones." Live data falsifies this. CRT will reasonably ask which of the 42 agents are *actually* contributing to signal analysis. The honest answer today is 24. The other 18 are decoration.

**Second-pass verification:** Already done above — multiple cron runs confirm `dispatched: 0`. Final confirmation: the dispatch-0 days have `signals_available: 80` so it's not an input-starvation problem.

**Fix scope:** M. Two viable strategies:
1. Reserve a slot in the top-K for "least-recently-fired-eligible-by-tag" agents — guarantees dormancy is bled out over time.
2. Add a separate `dormant-quota` dispatch path that bypasses agent-router and uses a curated specialty→signal-category mapping (more deterministic but more curation burden).

---

## F-006 — Production signals leaking to inactive sandbox clients

**Severity:** BLOCKER
**Category:** tenancy / data integrity (PRECONDITION FOR CRT)
**Discovered:** Phase 2 (pipeline trace, attempt #1)

**Claim:** Real production signals (CCCS cyber advisories, etc.) — flagged `is_test=false` and **without** any `benchmark_run_id` — are being routed to inactive sandbox clients (`_benchmark_petronas`, `_qa_test_client`). Memory entry `project_qa_signal_contamination_2026_05_07.md` documented the *inverse* leak (qa-agent fake signals contaminating real Petronas) and added a guard. The *forward* direction is unguarded: real signals can still land on test clients.

**Evidence (DB query + result):**

The highest-confidence signal in the last 24h (composite=0.722, severity=`malware`, source=`Canadian Centre for Cyber Security`) was assigned to `_benchmark_petronas`, NOT real Petronas Canada:
```
SIG-2026-001494
title: "A recently disclosed vulnerability in ImageMagick..."
client_name: _benchmark_petronas (status=inactive)
composite_confidence: 0.722
relevance_score: 0.698
is_test: false
bench_run: null  ← not a benchmark run
```

The same CCCS Cyber Alert (April 6, 2016) created TWO production signals on 2026-05-12, one routed to `_qa_test_client` and one to `_benchmark_petronas` — both `is_test=false`, both `bench_run=null`. That's a real CCCS advisory that should have gone to Petronas Canada (active) being split between two sandbox tenants.

Query and exhibit IDs:
- `f397cc50-c50d-47b5-a444-620992821207` → `_qa_test_client`
- `b803ec07-0269-4d4e-9a34-884a548bbf90` → `_benchmark_petronas`
- `5456ed60-96c5-4080-9f5e-ebc29f9b1fef` → `_benchmark_petronas`
- `a12690ba-af1b-4db0-afdc-a4bfa797066a` → `_qa_test_client`

All four: `is_test=false`, no `bench_run`, source = `Canadian Centre for Cyber Security`. These are real signals on inactive clients.

**Why this is a BLOCKER for CRT (precondition):**
You cannot safely onboard CRT as a tenant when production signals can leak to other tenants' client_ids. The CRT-as-tenant model has CRT bringing their own clients (BC Place is the first). If the AI gate matches a real CCCS advisory to BOTH "BC Place" and "Petronas Canada" because both have overlapping keywords, that signal must either:
1. Be duplicated to both (intentional — `signal_correlation_groups` handles this), OR
2. Be routed to the highest-confidence single match (current behavior).

What MUST NOT happen: production signals landing on an inactive/sandbox tenant in production. The current guard rejects `is_test=true → active client`. The missing guard is `production signal → inactive client`. Both directions need enforcement.

**Second-pass verification:** Trace how `_qa_test_client` ended up matched. Check the monitor function logic that assigned it.
*(deferred — would need to read monitor-cisa-kev or similar)*

**Fix scope:** S. Add a symmetric guard in `ingest-signal`:
```ts
if (clientStatus !== 'active' && !signal.is_test && !signal.benchmark_run_id) {
  return reject('production_signal_inactive_client');
}
```
And reassign the 4 known production signals on inactive clients to their correct active client (or archive them).

---

## F-007 — Cross-tenant data leak via role-only RLS policies

**Severity:** BLOCKER (single biggest CRT precondition)
**Category:** tenancy / RLS / security
**Discovered:** Phase 5

**Claim:** PostgreSQL RLS evaluates multiple policies with **OR** semantics — if ANY policy permits the operation, access is granted. On the core tenant-sensitive tables, there is at least one policy per table that grants access on role alone (no tenant or client filter), defeating the tenant-scoped policies sitting beside them.

**Evidence (from `pg_policies`):**

| Table | Wildcard / role-only policy | Effect when CRT analyst is added |
|---|---|---|
| `signals` | `Admins and analysts can view signals` — `qual: has_role(auth.uid(), 'analyst') OR ...` | Sees every tenant's signals |
| `incidents` | `Admins and analysts can view incidents` — same role-only check | Sees every tenant's incidents |
| `clients` | `auth_users_can_view_clients` — `qual: auth.uid() IS NOT NULL` | Sees every tenant's client list |
| `entities` | `auth_users_can_view_entities` — `qual: auth.uid() IS NOT NULL` | Sees every tenant's entities |
| `signal_agent_analyses` | `authenticated_read_signal_agent_analyses` — `auth.uid() IS NOT NULL` | Reads every agent's reasoning on every tenant's signals |
| `signal_correlation_groups` | `Authenticated users can view signal correlations` — `qual: true` | All authenticated users see all correlation data |
| `agent_debate_records` | `Authorized roles can read debate records` — role-only | Sees every tenant's multi-agent debates |
| `reports` | `Analysts and admins can view reports` — role-only | Sees every tenant's executive reports |
| `poi_investigations` | `auth_read_poi_investigations` — `auth.uid() IS NOT NULL` | Sees every tenant's POI investigation results |

The **correct** tenant-scoped policies DO exist (`tenant_scoped_signals_select`, `tenant_scoped_incidents_select`) and they correctly use `get_user_accessible_client_ids()` which joins `clients` → `tenant_users` → `auth.uid()`. The plumbing works. **But the legacy role-only policies sit alongside them and grant access regardless.**

```sql
-- The right policy:
CREATE POLICY tenant_scoped_signals_select ON signals FOR SELECT
  USING (is_super_admin(auth.uid())
      OR client_id IS NULL
      OR client_id IN (SELECT client_id FROM get_user_accessible_client_ids()));

-- The legacy policy sitting beside it that defeats it:
CREATE POLICY "Admins and analysts can view signals" ON signals FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'analyst'));
```

**Verification — the helper is correct:**
```sql
SELECT pg_get_functiondef(...) FROM ... WHERE proname = 'get_user_accessible_client_ids';
-- returns:
CREATE OR REPLACE FUNCTION public.get_user_accessible_client_ids()
RETURNS TABLE(client_id uuid) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c.id FROM public.clients c
  INNER JOIN public.tenant_users tu ON tu.tenant_id = c.tenant_id
  WHERE tu.user_id = auth.uid()
$$;
```

`tenant_users` has 2 rows, `tenants` has 2 rows. The membership model exists. It just isn't enforced consistently.

**Why this is the SINGLE BIGGEST BLOCKER for CRT:**
The CRT-as-tenant model requires CRT analysts to log in, get role=`analyst` (or `admin` for their team lead), and see ONLY their own clients (initially BC Place). With current policies, the moment any CRT user holds the `analyst` role, they see Petronas Canada's signals, incidents, reports, AND every other CRT client's data. The reverse is also true — Silent Shield analysts see CRT's clients. This is non-negotiable for a paid tenant relationship.

**Second-pass verification:** I can prove the leak by emulating the analyst role. (Deferred — needs an auth context I'd need Aaron to set up.) But the policy text itself is unambiguous — `qual: has_role(...,'analyst')` with no scope filter is mathematically a wildcard for any analyst.

**Fix scope:** M-L.
1. Drop every role-only `SELECT` policy on the affected tables (keep DELETE/UPDATE/INSERT role checks — those don't leak read access).
2. Drop wildcard `auth.uid() IS NOT NULL` policies.
3. Drop the `current_setting('app.current_client_id')` policies — they're a different (single-active-client) model and conflict with multi-tenant.
4. Keep ONLY `tenant_scoped_*_select` + the super_admin bypass policies on each table.
5. See F-008 for tables that need new tenant_id/client_id columns first.

This is essentially a multi-day RLS rewrite. It is the precondition for CRT onboarding — onboarding before this fix will leak data.

---

## F-008 — Multiple tenant-sensitive tables lack tenant_id and client_id

**Severity:** BLOCKER
**Category:** tenancy / schema
**Discovered:** Phase 5 (companion to F-007)

**Claim:** The following tables hold tenant-sensitive content but have **neither** `tenant_id` NOR `client_id` columns — they cannot be tenant-scoped without schema changes:

| Table | Holds | Tenant-sensitive? |
|---|---|---|
| `signal_agent_analyses` | Agent reasoning on each signal | YES — leaks the platform's interpretation |
| `signal_correlation_groups` | Signals grouped into a story | YES — leaks the connections |
| `agent_debate_records` | Multi-agent debate transcripts | YES — leaks the analytical depth |
| `reports` | Executive reports (the actual output product) | YES — these ARE the deliverable |
| `agent_actions` | Agent proposed actions on signals | YES — leaks agent reasoning |
| `poi_investigations` | POI deep-scan results | YES — extremely sensitive |
| `bug_reports` | User-submitted bugs with conversation logs | YES — may contain tenant data in screenshots/quotes |

**Why this is a BLOCKER:**
Even if the F-007 RLS rewrite ships, these tables have no column to filter on. The fix requires either (a) adding `tenant_id` derived from joined `signals.tenant_id`/`signals.client_id`, or (b) writing RLS policies that JOIN to `signals` and then to the accessible-clients function.

Option (b) is the cheaper path but creates RLS join-heavy queries that may regress performance.
Option (a) requires backfill on existing rows.

**Fix scope:** L. Schema migration + backfill + RLS policy rewrite + verification.

---

## F-009 — 88% of specialist analyses have no usable confidence score

**Severity:** BLOCKER
**Category:** AI behavior / learning loop
**Discovered:** Phase 6 (AI behavior audit)

**Claim:** The calibration loop architecture (`score-agent-calibration-daily`, `decay-beliefs-from-calibration-daily`, the `agent_calibration_scores` table) depends on agents emitting a `CONFIDENCE: 0.X` line that is parsed into `signal_agent_analyses.confidence_score`. **Across 7 days of specialist output (627 rows, 31 distinct agents):**
- **56% (351 rows)** have `confidence_score = 0`
- **32% (202 rows)** have `confidence_score = NULL`
- **Only 12% (74 rows)** have a meaningful (0,1) confidence value

The Brier-scoring calibration logic treats `0` as a real prediction ("definitely not"), which is systematically wrong — it's the parse fallback when the agent omitted the CONFIDENCE line. Every "0" prediction that resolves true gets the maximum penalty in calibration. This poisons `agent_calibration_scores` and the resulting `attenuateConfidence` adjustments.

**Evidence:**
```sql
SELECT
  COUNT(*) AS total_7d,
  COUNT(*) FILTER (WHERE confidence_score = 0) AS conf_zero,        -- 351
  COUNT(*) FILTER (WHERE confidence_score > 0 AND confidence_score < 1) AS conf_meaningful, -- 74
  COUNT(*) FILTER (WHERE confidence_score IS NULL) AS conf_null,    -- 202
  ROUND(100.0 * COUNT(*) FILTER (WHERE confidence_score = 0) / NULLIF(COUNT(*), 0), 1) AS pct_zero -- 56%
FROM signal_agent_analyses
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND agent_call_sign NOT IN ('AI-DECISION-ENGINE', 'TIER2-REVIEW');
```

The prompt template in `supabase/functions/activate-dormant-specialists/index.ts:180-183` requires:
```
END YOUR RESPONSE WITH A LINE EXACTLY IN THIS FORMAT:
CONFIDENCE: 0.X
where 0.X is your probability estimate (0.0–1.0)...
Without this line your analysis cannot be graded by calibration —
your confidence is the input the learning loop uses to improve you.
```
But the agents ignore or under-emit this. The parser then either fails to find the line (NULL) or finds `CONFIDENCE: 0` (literal zero — the default-cautious LLM response).

**Why this is a BLOCKER for CRT:**
The "Calibration loop closed" memory entry (May 10) claims the prediction→grade→update cycle is real. The output of that cycle drives the **Calibration pill** in `AgentListPanel` shown to operators. Today the pill is showing a dishonest number — it represents calibration on a near-empty sample. CRT will reasonably point at agents marked "well-calibrated" and ask which predictions backed that. The answer is: most predictions were zeros that nobody truly intended.

**Second-pass verification (now done):** `agent_calibration_scores` rows queried directly:
```
call_sign        total  correct  brier  calib
CERBERUS           4      3      0.271  0.750
VERIDIAN-TANGO     4      4      0.000  1.000   ← "perfect calibration"
LEX-MAGNA          4      4      0.000  1.000   ← also "perfect"
WILDFIRE           4      4      0.000  1.000   ← also "perfect"
CHAIN-WATCH        1      1      0.000  1.000
NARCO-INTEL        1      1      0.000  1.000
```
Total predictions per agent: 1–4. Five agents at calibration=1.000 (perfect). This is what the UI's Calibration pill displays to operators. It is statistically meaningless (n=1–4) AND mathematically wrong (brier=0 implies unanimous correctness at 100% confidence — but confidences are zeros/nulls). The pill is dishonest.

**Fix scope:** M. Two-step:
1. Strengthen the parser: when `CONFIDENCE: 0` is parsed, treat it as ambiguous (re-prompt with a one-shot retry asking for an explicit 0.0–1.0 value), or store it as NULL and exclude from calibration.
2. Strengthen the prompt: include a clear example showing 0.5 means "uncertain" not "definitely not". Most LLMs default to 0 because they read the prompt as wanting probability of "definitely false".

---

## F-010 — Specialist agents analyze hallucinated signals as if real

**Severity:** SERIOUS (borderline BLOCKER for CRT brand)
**Category:** AI behavior / hallucination
**Discovered:** Phase 6 (AI behavior audit)

**Claim:** The benchmark contains fabricated stories ("All 20 First Nations have signed a Coastal GasLink agreement", "A section of CGL near Fort St. John has been shut down due to suspected sabotage"). The AI gate admits them (per the F-001 over-permissiveness fix). Downstream specialist agents (`VERIDIAN-TANGO`, `WILDFIRE`, `CHAIN-WATCH`) then produce serious-toned threat analyses treating these stories as real events.

**Evidence (signal_agent_analyses rows from 2026-05-13 17:51-17:52, during the audit's benchmark run):**

On SIG-2026-001605 ("A section of the Coastal GasLink pipeline near Fort St. John has been shut down due to a suspected sabotage attempt by unknown actors"):

- VERIDIAN-TANGO: *"The reported shutdown of a section of the Coastal GasLink pipeline near Fort St. John due to a suspected sabotage attempt indicates a significant threat to energy infrastructure in the region. The potential involvement of unknown actors suggests a high-risk scenario..."*
- WILDFIRE: *"The reported shutdown of a section of the Coastal GasLink pipeline near Fort St. John due to a suspected sabotage attempt raises significant security concerns..."*
- CHAIN-WATCH: *"A section of the Coastal GasLink pipeline near Fort St. John has been shut down due to a suspected sabotage attempt, indicating a significant threat to operational integrity..."*

No specialist flagged this as unverified, asked for corroborating sources, or expressed epistemic caution. None of them are wrong to take the input at face value — they're trained to analyze the content they receive. The failure is upstream: there is no fact-check / source-verification layer between the AI gate and the specialist agents.

**Why this is a CRT brand concern:**
The reasoning trail is your pitch to CRT (memory `project_critical_risk_team.md`). When CRT clicks through a "sabotage" incident in a brief and the underlying signal turns out to be a fabricated CSE result that was admitted because keywords matched, the trail visibly amplifies a hallucination. Three specialist agents authoritatively confirming a fake event is *worse* than no specialists at all — it converts an unverified rumor into an institutional consensus.

**Fix scope:** L. Add a fact-verification pass between AI gate admit and specialist dispatch:
- Cross-reference the claim against `agent_world_predictions`, `knowledge_graph_entities`
- Require ≥2 distinct corroborating source domains for high-claim signals ("X has been shut down", "X has signed")
- Add `signals.verification_status` enum: `unverified`, `corroborated`, `disputed`. Display in UI.

This is a research project, not a quick fix. Minimum mitigation: tag signals from `Google News API` with `verification_status=unverified` and have specialists prefix analyses with "If verified:".

---

## F-011 — Specialist agents drift outside their declared specialty

**Severity:** SERIOUS
**Category:** AI behavior / persona consistency
**Discovered:** Phase 6 (AI behavior audit)

**Claim:** Sampled specialist analyses today show drift — agents producing content outside their declared `specialty`. This violates the operator's stated guidance in memory `feedback_drift_vs_applied_expertise.md`: drift (off-lane volunteering) is distinct from applied lens (invited interpretation).

**Evidence (sampled from `signal_agent_analyses` 2026-05-13):**

- **WILDFIRE** (specialty: "Wildfire Intelligence, Natural Disaster Monitoring, FWI Analysis, CWFIS Data, Flaring vs. Wildfire Classification, Evacuation Intelligence") analyzing SIG-2026-001611 ("Wet'suwet'en land defenders established a new blockade on the Coastal GasLink access road"):
  > *"The establishment of a blockade by Wet'suwet'en land defenders on the Coastal GasLink access road near Houston, BC, indicates a significant escalation in local protest activity. The presence of approximately 30 individuals suggests organized resistance..."*

  This is not WILDFIRE territory. There is no fire angle in the source text. Yet the WILDFIRE agent produces a general protest-assessment.

This pattern means the agent-router is dispatching WILDFIRE to signals where it has nothing distinctive to add, and WILDFIRE complies rather than declining. Memory `project_dormant_agent_learning_loop.md` says the system prompt template (line 178-179 of `activate-dormant-specialists/index.ts`) explicitly allows agents to say "no direct nexus" — but they don't.

**Fix scope:** M. Two reinforcements:
1. Stronger prompt: ANY analysis that doesn't cite specialty terminology from the agent's own description gets rejected at the storage step.
2. Specialty-fit scoring: before storing, ask a separate verifier "did this analysis apply [agent.specialty]?" If no, drop. Costs a verification LLM call but kills drift completely.

---

## F-012 — Benchmark is never auto-run on deploy

**Severity:** BLOCKER (root cause of every regression in this session)
**Category:** monitoring / regression detection
**Discovered:** Phase 7

**Claim:** The repo has a fully wired `run-benchmark` edge function that scores 39 labeled examples against the live pipeline. **It is never invoked by any GitHub Actions workflow.** Grep across `.github/workflows/*.yml` shows zero references to `run-benchmark`. The only watchdog-related job (`loop-diagnostics.yml`) is `workflow_dispatch` — manual-only. As a result:
- A function deploy that breaks AI gate behavior (today's hallucination/cyber/wildfire regressions in `monitor-social-unified`) lands without any regression signal.
- The benchmark ran 76 hours before today's audit, then once during the audit because I triggered it.
- `platform_findings` accumulates rows. Nothing reads them. Operators only see them when they open Monitor Health.

**Evidence:**
```
$ grep -rn "run-benchmark" .github/workflows/*.yml
(no matches)
```

`.github/workflows/loop-diagnostics.yml:2`:
```yaml
on:
  workflow_dispatch:   # manual only
```

**Why this is a BLOCKER for CRT:**
The entire stabilization argument from earlier today rests on this being fixed. Without automatic regression detection on every deploy, the cycle that produced today's findings (each fix exposing two more regressions) will repeat indefinitely. CRT will see fresh regressions every day. The pattern memory entry `feedback_correctness_over_easy.md` captures — "Easy bypasses keep becoming silent regressions in this codebase" — has no detection mechanism. This is also the lever I called out in chat earlier ("Wire the benchmark into deploy-functions.yml") that hasn't been built yet.

**Fix scope:** S. Append a job to `deploy-functions.yml`:
1. After all function deploys land, invoke `run-benchmark`
2. Wait for completion, read latest `benchmark_runs` row
3. Compare against the previous green run's `signal_creation_accuracy`
4. Fail the workflow if drop >5% (configurable)

Companion: push every new `severity='critical'` `platform_findings` row to a notification channel (Slack/email). One-line change to `system-watchdog`.

---

## F-013 — Bug reports have no tenant attribution

**Severity:** SERIOUS
**Category:** support path / tenancy
**Discovered:** Phase 8

**Claim:** The `bug_reports` table has `user_id`, `reporter_email`, `page_url`, `browser_info`, `conversation_log` — but no `tenant_id`. When CRT analysts use the support chat (just shipped today) to file bugs, the resulting row carries no tenant context. The operator inbox `/bug-reports` shows a flat global list.

**Evidence (schema):**
```sql
-- supabase/migrations/20251122002200_*.sql
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  ...
  -- no tenant_id, no client_id
);
```

**Why this is a SERIOUS concern for CRT:**
- Multiple tenants will file similar bugs. Without tenant attribution, the operator can't prioritize, can't reproduce in the right tenant context, can't route the fix or notification back to the right team.
- Crucially: `conversation_log` (the JSON-serialized chat history) MAY contain tenant-specific signal IDs, source URLs, and screenshots. With no tenant_id, that content is also unscoped — meaning if RLS is later added to bug_reports, the join boundary will need to be derived from conversation content, which is fragile.

**Fix scope:** S. Add `tenant_id` and `client_id` columns to `bug_reports`. Populate from caller context (the support-chat function has access to `auth.uid()` and can resolve tenant via `tenant_users`). Add a tenant-scoped RLS policy.

---

## F-014 — Heartbeat counter drift (acknowledged, partial fix shipped)

**Severity:** NICE (partial fix already in pipeline)
**Category:** observability
**Discovered:** Pre-audit (earlier today, commit `b9ce0e31`)

**Claim:** `monitor-news-google` and other monitors that exceed the 150s edge runtime budget never reach their final `recordHeartbeat('completed')` call, leaving the heartbeat row in `running` state with `signals_created=0` indefinitely. Today's fix (`b9ce0e31`) switched monitor-news-google to start/complete pattern with mid-loop progress checkpoints. Other monitors not yet audited for the same pattern.

**Fix scope:** S. Audit all `recordHeartbeat` callers for the running→completed timeout failure pattern. Convert to start/complete with per-iteration checkpoint where the work loop is long.

---

## Summary

### Findings ranking for CRT onboarding

**BLOCKERS — must fix before CRT logs in (in order of leverage):**

1. **F-007 — Cross-tenant RLS leak.** Single biggest issue. Until the role-only and wildcard policies are dropped, CRT cannot be safely given any role. Largest fix (L) but highest impact.
2. **F-008 — Tenant-sensitive tables without scoping columns.** Companion to F-007. Schema migration + RLS rewrite (L).
3. **F-015 — Frontend ProtectedRoute has no role check.** Companion to F-007 — even if RLS is fixed, the UI lets analysts hit operator pages by URL. Fix this same window as F-007. Small fix (S) but security-relevant.
4. **F-012 — Benchmark not in CI.** Smallest of the blockers (S). Prevents future regressions from being silent. **Do this first** — it shrinks the risk of every subsequent fix.
5. **F-006 — Production signals leaking to inactive sandbox clients.** Easy fix (S) but data integrity precondition.
6. **F-001 — AI gate admit ratio chronically low.** Today's tuning helped (16% → 28% on May 12) but still under target. M.
7. **F-004 — Filtered_signals source_name still 19% null.** Observability requirement (S).
8. **F-002 / F-005 — 12 active agents have never fired; dormancy loop dispatches 0.** Routing rewrite (M).
9. **F-009 — Calibration loop poisoned by zero confidences.** Parser + prompt fix (M).

**SERIOUS — fix soon after onboard:**

9. **F-010 — Specialists analyze hallucinated signals as real.** Verification layer (L).
10. **F-011 — Specialist drift outside lane.** Reinforcement (M).
11. **F-013 — Bug reports have no tenant attribution.** Schema + RLS (S).
12. **F-003 — Some agents went silent after burst-event firing.** May be intentional; needs verification.

**NICE — improve over time:**

13. **F-014 — Heartbeat counter drift on other monitors.** Audit (S).

### Recommended fix sequencing

| Order | Finding(s) | Why first | Effort |
|---|---|---|---|
| 1 | F-012 | Catches every regression introduced by subsequent fixes — prevents the audit findings from re-appearing | S (~half day) |
| 2 | F-006 | Tiny fix, immediately stops the leak | S (~1 hour) |
| 3 | F-004 | Visibility precondition for all later AI-gate tuning | S (~2 hours) |
| 4 | F-009 | Calibration must report honest numbers before any other learning-loop fix | M (~1 day) |
| 5 | F-001 + F-002 + F-005 | Pipeline correctness — these are intertwined | M-L (2-3 days) |
| 6 | F-007 + F-008 | The big one. Done last because it requires extensive testing under multiple auth contexts | L (3-5 days) |
| 7 | F-010 + F-011 | AI behavior quality — once the pipeline is stable | M-L (2-4 days) |
| 8 | F-013 + F-014 | Cleanup | S |

**Total realistic effort:** ~2-3 weeks of focused work to clear the BLOCKER list. The L items can't be parallelized cleanly because they touch the same code paths.

### What "stable enough for CRT" actually means after this list

After steps 1-6 above are shipped and verified:
- Every deploy is regression-checked against 39 labeled cases. Drops >5% block the workflow.
- AI gate operates within 25-30% admit band. Operators can see WHY any rejection happened (source_name + filter_reason).
- All 42 active specialists actually fire. Calibration scores reflect real predictions.
- A CRT analyst with `role=analyst` sees ONLY their tenant's clients, signals, incidents, reports, entity intelligence, agent analyses. Cross-tenant queries return empty.
- The support-chat / bug-report path includes tenant attribution.

Until that bar is met, every CRT-visible regression is one curious analyst away from being a brand event.

### Things the audit did NOT cover (deferred or out of scope)

- `aegis.silentshieldsecurity.com` frontend stability — deferred per operator instruction.
- External API health (Twitter, Google CSE, NAAD). Heartbeats prove the calls fired; not that the upstream feeds are healthy.

These remain open. The deferred items from the first pass (LLM cost, prompt accuracy, route guards, DR, secret rotation, deactivated agents) are now covered as F-015 through F-021 in the second-pass section below.

---

# Second-pass investigation (deferred items)

## F-015 — Frontend `ProtectedRoute` has NO role check

**Severity:** BLOCKER (equal to F-007 — same security domain)
**Category:** security / frontend
**Discovered:** Phase 2-extension (second-pass)

**Claim:** `src/components/ProtectedRoute.tsx` is **27 lines total** and contains exactly one access check: `if (!user) redirect to /auth`. It does **not** check role. Every protected route in `App.tsx` — including the most sensitive operator-only routes — wraps the page in just `<ProtectedRoute>`, no role parameter.

**Evidence (code):**

`src/components/ProtectedRoute.tsx`:
```tsx
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/auth" replace state={{ from: intended }} />;
  return <>{children}</>;
};
```

`src/App.tsx` route definitions (selected):
```tsx
<Route path="/super-admin" element={<ProtectedRoute><SuperAdminDashboard /></ProtectedRoute>} />
<Route path="/tenant-admin" element={<ProtectedRoute><TenantAdmin /></ProtectedRoute>} />
<Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
<Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
<Route path="/rule-approvals" element={<ProtectedRoute><RuleApprovals /></ProtectedRoute>} />
<Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
<Route path="/agent-actions" element={<ProtectedRoute><AgentActions /></ProtectedRoute>} />
<Route path="/bug-reports" element={<ProtectedRoute><BugReports /></ProtectedRoute>} />
<Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
```

When a CRT analyst logs in and gets `role=analyst`, they can paste `/super-admin` into the URL bar and the route renders. Whatever the underlying page does is the only defense — and Supabase RLS (already broken per F-007) is supposed to be that defense. The frontend itself does not gate.

**Why this is a BLOCKER for CRT:**
The `/super-admin` page shows operator-only telemetry. `/user-management` lets the user invite new users and set roles. `/integrations` configures API keys. `/rule-approvals` mutates rule thresholds. All currently reachable by any signed-in user via URL. Combined with F-007 (the RLS leak), the surface for a CRT analyst to discover and exploit is wide.

**Fix scope:** S. Extend `ProtectedRoute` with `requireRole?: AppRole | AppRole[]` prop. Update App.tsx route definitions for sensitive routes. Pattern:
```tsx
<Route path="/super-admin" element={
  <ProtectedRoute requireRole="super_admin"><SuperAdminDashboard /></ProtectedRoute>
} />
```

---

## F-016 — No LLM cost alerting or budget cap

**Severity:** SERIOUS
**Category:** observability / cost
**Discovered:** Second-pass

**Claim:** `function_telemetry` correctly records `tokens_in`, `tokens_out`, `ai_model` per call. The plumbing is there. **There is no cost-aggregation job, no daily/weekly cost summary, no alert when a function spikes, no budget cap.** A runaway loop or a buggy prompt that 10x's token consumption would only become visible after the LLM provider bill arrives.

**Evidence (DB query — 14-day cost trend):**
```sql
-- Approximated using model pricing ($/1M tokens):
--   gpt-4o-mini  in=$0.15 out=$0.60
--   gpt-5.2      in=$3.00 out=$9.00
--   gemini-2.5-flash in=$0.075 out=$0.30
```

| Day | Estimated USD | Tokens in | Tokens out |
|---|---|---|---|
| 2026-05-13 | $16.95 | 18.1M | 0.87M |
| 2026-05-12 | $11.33 | 14.6M | 0.86M |
| 2026-05-11 | $10.55 | 10.3M | 0.54M |
| 2026-05-10 | $9.02 | 9.7M | 0.66M |
| 2026-05-09 | $2.18 | 2.5M | 0.13M |
| 2026-05-08 | $16.91 | 14.5M | 0.65M |
| ...earlier days $2–6/day... | | | |
| 2026-04-30 | $0.10 | minimal | (telemetry just starting) |

Top spend by function (7 days):
- `ingest-signal` gpt-4o-mini — 13,227 calls, 21.8M tokens in → ~$3.27/wk
- `agent-chat` gpt-4o-mini — 1,043 calls, 18.6M tokens in (avg ~18K tokens/call — large context) → ~$2.79/wk
- `ai-decision-engine:investigation` gpt-5.2 — 1,409 calls, 7.7M tokens → **~$23/wk** (most expensive line item)
- `review-signal-agent:investigation` gpt-5.2 — 1,255 calls, 7.5M tokens → **~$22.50/wk**
- `monitor-social-unified` gpt-4o-mini — 6,703 calls, 5.5M tokens

**Rough monthly burn at current load: ~$300–450/mo.** Linear scaling with tenants → $1,500–2,500/mo at 5 paying tenants.

**Why SERIOUS for CRT:**
A regression in a tight loop (e.g. agent-chat sending its 18K-token context to every chat message in an infinite retry) would silently 10–50x the daily bill before the operator notices. The platform self-improves and self-tunes — those loops can easily go runaway.

**Fix scope:** S-M.
1. Daily cron: `compute-llm-daily-cost` summarizes `function_telemetry` into a small table.
2. Alert if daily cost > $X (configurable per environment).
3. Hard cap at $Y/day — if breached, switch all AI calls to a hard-fail path. Prevents bill blow-up.
4. Cost-attribution by tenant (when F-007/F-008 land) so per-tenant invoicing is possible.

---

## F-017 — LLM provider API keys not rotated in 69+ days

**Severity:** SERIOUS
**Category:** security / secrets
**Discovered:** Second-pass

**Claim:** The four LLM provider keys in `vault.secrets` are 69 days old (unchanged since 2026-03-05). No rotation cadence, no alert.

**Evidence:**
```sql
SELECT name, created_at, updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 AS days_since_rotation
FROM vault.secrets ORDER BY updated_at DESC;
```

```
service_role_key    rotated 4 days ago (May 9 — per memory)
SUPABASE_URL        13 days (URL, not a secret)
ANTHROPIC_API_KEY   69 days   ← stale
GEMINI_API_KEY      69 days   ← stale
OPENAI_API_KEY      69 days   ← stale
PERPLEXITY_API_KEY  69 days   ← stale
```

Standard security practice for production keys with elevated billing access is 90-day max rotation. These are within tolerance but rapidly approaching it. There's no automated tracking — if Aaron forgets, they'll silently stale-out.

**Why SERIOUS:**
Before onboarding CRT, secret hygiene needs to be visible/auditable. CRT-equivalent security teams will ask "when were the keys last rotated and how do you know?" The honest answer today is "we have to check the vault manually each time."

**Fix scope:** S.
1. Add a `secret_age_alert` view: `SELECT name, days_old FROM vault.secrets WHERE updated_at < NOW() - INTERVAL '60 days'`.
2. Wire into watchdog: any row in that view → `platform_findings` entry with severity=`medium`.
3. Document rotation procedure in `docs/runbook-secret-rotation.md`.

---

## F-018 — `is_active=false` on ai_agents not enforced consistently

**Severity:** SERIOUS
**Category:** data-integrity / agent-network
**Discovered:** Second-pass

**Claim:** Agent `Scout` (codename EMBER, wildfire specialty) was deactivated `2026-05-10 14:16:52`. **It then produced 2 `signal_agent_analyses` rows AFTER deactivation**, last on `2026-05-12 01:38:08`. Some dispatch path ignores the `is_active` flag.

**Evidence:**
```sql
SELECT a.call_sign, a.is_active, a.updated_at AS deactivated_at,
  (SELECT COUNT(*) FROM signal_agent_analyses WHERE agent_call_sign = a.call_sign AND created_at > a.updated_at) AS analyses_after_deactivation,
  (SELECT MAX(created_at) FROM signal_agent_analyses WHERE agent_call_sign = a.call_sign) AS last_fired
FROM ai_agents a WHERE a.is_active = false
  AND EXISTS (SELECT 1 FROM signal_agent_analyses s WHERE s.agent_call_sign = a.call_sign AND s.created_at > a.updated_at);

-- Result:
-- Scout | false | 2026-05-10 14:16:52 | analyses_after_deactivation=2 | last_fired=2026-05-12 01:38
```

**Why SERIOUS:**
The operator cannot reliably take an agent out of service. Deactivation is supposed to be an "off switch" — currently it's a "hint". For CRT tenancy, an analyst who deactivates a specialist (because they don't want that lens applied) must be able to trust it stays off. Multi-tenant context makes this worse: a deactivation in one tenant should scope to that tenant, but `is_active` is global today.

**Fix scope:** S. Audit all agent-dispatch call sites for `is_active` filtering: `multi-agent-debate`, `agent-router`, `auto-trigger-debates`, `activate-dormant-specialists`, `review-signal-agent`. Find the path that ignores the flag and fix.

---

## F-019 — 17 deactivated agents (not 6), includes literal test agent

**Severity:** SERIOUS
**Category:** data-integrity
**Discovered:** Second-pass (corrected from initial audit)

**Claim:** The initial audit reported "6 deactivated agents" — wrong. Actual count is **17**, including:
- **`WATCH-ALPHA-2`** (codename `Sentinel-2`) — `specialty='test specialty'`, `persona='test persona'`. Literal test row left in production.
- **Codename collisions** (multiple agents per codename, one active + one deactivated):
  - `VICODIN/House` (deactivated) ↔ `DR-HOUSE` (active)
  - `0DAY/Wraith` ↔ `WRAITH`
  - `ARGUS/The Sentinel` ↔ `THE-SENTINEL`
  - `WARDEN/The Guardian` ↔ `GUARDIAN`
  - `GLOBE-SAGE/Oracle` ↔ `ORACLE`
  - `ECHO-ALPHA/Spartan` ↔ `JOCKO` (similar persona)
- **Bulk-deactivated on 2026-05-10 14:16:52** — matches memory entry `project_agent_alignment_audit_pending.md` ("Fixed 7 broken prompts, 5 codename collisions, 6 deactivations.")
- **6 client-facing agents are deactivated**: SIM-COMMAND, ECHO-ALPHA, GLOBE-SAGE, MERIDIAN (geopolitical), VERITAS (disinformation), SENT-CON (client onboarding — CRT-relevant!), 0DAY.

**Why SERIOUS:**
- `WATCH-ALPHA-2` test agent in production is a data-hygiene cleanup miss.
- SENT-CON specifically — its purpose was "Client Onboarding, Task and Progress Tracking, Configuration Guidance, Platform Orientation" — exactly what CRT analysts will need on day one. It was deactivated April 25. Either someone needs to reactivate it, or there's a replacement (none obvious in the active set).

**Fix scope:** S.
1. DELETE `WATCH-ALPHA-2` row entirely. Verify no foreign keys point to it.
2. Decide on SENT-CON: reactivate, or formally delete (and document the replacement).
3. Audit the other 16 deactivated rows: archive vs. delete vs. reactivate decision per row.

---

## F-020 — Backup retention and PITR unverified

**Severity:** UNVERIFIED (cannot confirm via MCP)
**Category:** DR / backup
**Discovered:** Second-pass

**Claim:** The Supabase MCP `get_project` call returns project status, region, Postgres version (17.6.1.063) — but **does not expose backup retention, PITR enablement, or restore procedure**. The repo contains no DR runbook (`grep -rn 'backup\|restore\|disaster' docs/` returns nothing relevant).

**Operator action required:**
1. Open Supabase Dashboard → Project Settings → Database → Backups. Confirm:
   - Backup retention period (Free: 7d, Pro: 14d, Team: 28d w/ PITR, Enterprise: configurable)
   - PITR enablement status
   - Latest backup timestamp
2. Document in `docs/runbook-dr.md`:
   - Backup schedule
   - Restore procedure (with the exact command/dashboard path)
   - RTO target / RPO target
3. **Test a restore.** Untested restore procedures are not restore procedures. Spin up a development branch via `mcp__plugin_supabase_supabase__create_branch`, apply a known migration, restore to a prior point, verify the migration's effect was rolled back.

**Why SERIOUS-when-confirmed for CRT:**
A paying tenant will reasonably ask about backup retention and DR. "We're on Supabase Pro with 14d backups" is acceptable; "we're not sure" is not.

**Fix scope:** S (verification + documentation). Possibly M if the current tier lacks PITR and an upgrade is decided.

---

## F-021 — POSITIVE: Agent system_prompts are high-quality and domain-accurate

**Severity:** POSITIVE (no fix needed)
**Category:** AI behavior / prompt quality
**Discovered:** Second-pass

**Claim:** Sampled 7 active agents (VERIDIAN-TANGO, WILDFIRE, CHAIN-WATCH, PEARSON, INSIDE-EYE, WRAITH, JARVIS). All system_prompts cite **correct, real domain frameworks**:

| Agent | Domain | Frameworks cited (all real and accurate) |
|---|---|---|
| VERIDIAN-TANGO | Counterterrorism, energy infra | CSIS Threat Assessment (Capability+Intent+Targeting), RCMP INSET radicalization pathway, CARVER, Charter caveat distinguishing lawful activism from criminal extremism |
| WILDFIRE | Wildfire | CFFDRS (FFMC/DMC/DC/ISI/BUI/FWI), BCWS classification, CWFIS (VIIRS/MODIS hotspot, m3 polygons, lightning), 5/15/30km risk rings |
| PEARSON | Legal | OSFI, PIPEDA/Bill C-27, NEB Act, Criminal Code, Charter, "but for" causation test, Regulatory Risk Mapping |
| INSIDE-EYE | Insider threat / CI | FBI Counterintelligence Division Behavioral Indicators, MICE+TES motivational diagnostic, CI Red Flag Matrix |
| CHAIN-WATCH | Supply chain | NIST SP 800-161, C-TPAT, CISA Supply Chain RMF, TPRM tiering |
| JARVIS | Tech infra | TOGAF, OWASP Top 10, Zero-Trust principles, ICS/SCADA security, MITRE ATT&CK |
| WRAITH | Offensive security | PTES phases, CPTED reverse, MITRE ATT&CK (Enterprise + ICS + Physical) |

These are senior-analyst-level domain references. Lengths range 4144–4632 chars — substantive, not boilerplate. The "TOOL DIRECTIVES" sections in each prompt route to real Fortress tools (`query_fortress_data`, `cross_reference_entities`, `trigger_osint_scan`, `perform_external_web_search`).

**Implication:** The poor AI behavior findings (F-009, F-010, F-011) are NOT caused by bad prompts. The prompts give specialists the right framework. The failures are at the structural layer:
- F-009 (confidence parsing) — the prompts don't enforce the `CONFIDENCE: 0.X` format strongly enough
- F-010 (hallucination acceptance) — no fact-verification layer between gate and specialist
- F-011 (drift) — prompts allow "no direct nexus" responses but specialists don't use that escape hatch

Fixing F-009/F-010/F-011 means strengthening the framing around the prompts, not rewriting them.

---



</content>
