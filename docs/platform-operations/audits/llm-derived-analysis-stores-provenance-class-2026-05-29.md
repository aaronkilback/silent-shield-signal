# Class-level inventory — LLM-derived analysis stores and Provenance Doctrine coverage

**Date:** 2026-05-29. **Status:** documentation only — no fixes proposed. This reframes a recurring pattern as a class rather than a per-table bug.

## TL;DR

The Trent Reznor narrative contamination (PR #44), the methodology injection (PR #42), the daily-briefing cross-tenant leak (PR #47), and INC-OMCR (`agent_investigation_memory` fixed earlier) are all symptoms of **one structural pattern**:

> A store of LLM-derived analytical content where (a) ownership columns are nullable or absent, (b) RLS is enabled but not forced so service-role bypasses it, (c) writers omit ownership and rely on the parent FK, and (d) at least one service-role reader queries the store without joining to derive ownership.

This pattern is present in **at least 18 tables** on prod. None has RLS forced. Most have either nullable or absent client/tenant columns. Most lack the Provenance Doctrine trigger backstop. Four are actively injected into LLM report/briefing prompts; the rest are not currently in the injection path but the structural risk is identical.

---

## Class definition

An "LLM-derived analysis store" for this inventory satisfies all three:

1. **Content is AI-authored prose, embeddings, or LLM-derived structured output** (not curated reference material, not raw observations).
2. **Per-row scope is intended to be tenant- or client-bounded** (not globally-shared methodology like `expert_knowledge`).
3. **At least one service-role reader exists in the codebase** (cron-driven jobs, edge functions invoked by triggers, etc.).

Out of scope for this class (different containment rules apply):
- `expert_knowledge`, `global_learning_insights` — globally-shared by design; INC-LEARN-CONTAM containment applies.
- `incident_classification_rationale` — derived but tightly bound to a single incident via FK; not currently injected.
- `world_knowledge_sources`, `knowledge_base_*` — curated reference.

---

## The 18 stores — Provenance Doctrine coverage matrix

| Store | client_id col | tenant_id col | Has owner FK | RLS forced | Trigger backstop | NULL client_id (prod) | Read by report fn? |
|---|---|---|---|---|---|---|---|
| **agent_beliefs** | yes (nullable) | no | no | **NO** | 1 trigger | **15,418 / 15,533 (99.3%)** | gen-daily · dash-ai · agent-chat |
| **agent_debate_records** | yes (nullable) | yes (nullable) | yes (incident_id) | **NO** | 0 | **705 / 779 (90.5%)** | gen-exec · gen-daily · agent-chat |
| **signal_agent_analyses** ⬅ Layer 1 fixed | yes (nullable) | yes (nullable) | yes (signal_id) | **NO** | 0 | 1,192 / 3,060 (38.9%) | gen-daily (now scoped) · gen-poi |
| agent_memory | no | yes (nullable) | no | **NO** | 1 | n/a | dash-ai · agent-chat |
| agent_investigation_memory ⬅ INC-OMCR fixed | yes (nullable) | yes (nullable) | yes (incident_id) | **NO** | 1 (trg_aim_require_tenant — fail-closed) | (controlled by trigger) | (post-fix retrieval is gated) |
| agent_chat_beliefs | no | no | no | **NO** | 0 | n/a | (none currently) |
| agent_conversation_memory | yes (nullable) | no | no | **NO** | 0 | 7 / 7 (100%) | (none currently) |
| attribution_hypotheses | yes (nullable) | yes (nullable) | no | **NO** | 1 | 0 / 5 (0%) ✓ | (none currently) |
| audit_stage_analyses | no | no | no | **NO** | 0 | n/a | (none currently) |
| conversation_memory | yes (nullable) | yes (nullable) | no | **NO** | 1 | 1 / 1 (100%) | (none currently) |
| debate_predictions | no | no | no | **NO** | 0 | n/a | (none currently) |
| episode_embeddings | no | no | no | **NO** | 0 | n/a | (used in retrieval seam — review needed) |
| hypothesis_branches | no | no | no | **NO** | 0 | n/a | (none currently) |
| hypothesis_trees | no | no | yes | **NO** | 0 | n/a | (none currently) |
| red_team_assessments | yes (nullable) | no | yes | **NO** | 0 | 0 / 0 (empty) | (none currently) |
| speculative_analyses | no | no | yes | **NO** | 0 | n/a | (none currently) |
| structured_debate_arguments | no | no | no | **NO** | 0 | n/a | (none currently) |
| agent_beliefs_m1_snapshot | yes (nullable) | no | no | **NO** | 0 | n/a (snapshot) | (none currently) |

**Universal observations:**
- **0 / 18 tables have RLS forced.** Every service-role reader bypasses every policy on every one of these stores.
- **5 / 18 tables have any trigger.** Only `agent_investigation_memory` has a fail-closed provenance trigger (`trg_aim_require_tenant`, installed by INC-OMCR).
- **9 / 18 tables lack a `client_id` column entirely.** Of those, several lack `tenant_id` too. Ownership is then either purely transitive (via owner FK) or absent.

---

## Operator's five axes — per-store classification

### Axis 1 — Nullable `client_id` / `tenant_id`

| Risk level | Stores |
|---|---|
| 🔴 High (≥1 ownership col nullable AND high NULL prevalence ≥50%) | `agent_beliefs` (99.3%), `agent_debate_records` (90.5%), `agent_conversation_memory` (100%), `conversation_memory` (100%), `agent_memory` (100% tenant-null) |
| 🟡 Medium (nullable but low NULL prevalence today) | `signal_agent_analyses` (38.9%; transitive FK present), `attribution_hypotheses` (0% today — empirical, not structural) |
| 🟠 Absent (no ownership column — relies entirely on transitive FK or row-level state) | `agent_chat_beliefs`, `audit_stage_analyses`, `debate_predictions`, `episode_embeddings`, `hypothesis_branches`, `hypothesis_trees`, `speculative_analyses`, `structured_debate_arguments` |

### Axis 2 — Service-role read paths

Service-role readers of these stores (functions that instantiate `createServiceClient()` and SELECT from one of the 18 stores):

| Store | Service-role readers |
|---|---|
| `agent_beliefs` | `generate-daily-briefing:78`, `generate-daily-briefing:87` (client-scoped via `.eq("client_id", clientId)`), `dashboard-ai-assistant` (INC-LEARN-CONTAM containment), `agent-chat` (containment status not re-audited in this thread) |
| `agent_debate_records` | `generate-executive-report:225` (transitively client-scoped via incident_id), `generate-daily-briefing:108` (client-scoped via `incidents!inner.client_id`), `agent-chat` (status not re-audited) |
| `signal_agent_analyses` | `generate-daily-briefing:95` (**Layer 1 fix landed: now client-scoped via `signals!inner.client_id`**), `generate-poi-report:476` (entity-scoped via signal_id list) |
| `agent_memory` | `dashboard-ai-assistant`, `agent-chat` (status not re-audited) |
| `agent_investigation_memory` | (post-INC-OMCR) `match_agent_memories` RPC + retrieval seams — all gated |
| Other 13 stores | Various utility functions; not currently injected into report prompts |

### Axis 3 — RLS bypass exposure

**Universal: every store has RLS enabled but not forced.** Service-role bypasses every policy. Authenticated-user readers are typically properly scoped — the gap is exclusively on service-role-instantiated callers. The same gap that INC-OMCR named in March 2026 is unaddressed for the 17 other tables.

### Axis 4 — Writer omissions

Sampled writers across 6 inserts to `signal_agent_analyses` showed **none set `client_id` or `tenant_id`**. The same writer-discipline pattern is suspected across most stores but not exhaustively grepped in this audit. Detailed write-site audit (analogous to INC-OMCR's write-fix) is needed per store before any `NOT NULL` migration.

### Axis 5 — Report / briefing injection usage

**Currently injected into LLM prompts:**

| Store | Function(s) | Scoping at retrieval | Status |
|---|---|---|---|
| `agent_beliefs` | `generate-daily-briefing` | `.eq("client_id", clientId)` ✓ | clean by SQL filter; risk if writers ever bypass and write client_id=NULL (today 99.3% of rows are NULL, so the `.eq` filter excludes nearly the entire table — which may itself be a different bug worth understanding) |
| `agent_debate_records` | `generate-executive-report`, `generate-daily-briefing` | transitive (`incident_id`) ✓ | clean — both readers JOIN through incidents |
| `agent_memory` | `dashboard-ai-assistant`, `agent-chat` | needs re-audit | unknown — operator may want focused audit |
| `signal_agent_analyses` | `generate-daily-briefing` (Layer 1 fixed), `generate-poi-report` (entity-scoped) | post-Layer-1: clean | fix landed |

**Not currently injected** (lower priority but same structural risk if any future surface starts consuming them): the other 14 stores. Worth a one-time discipline policy that any new LLM-prompt injection from one of these 18 stores **requires explicit ownership scoping in code review**.

---

## Risk grading (synthesis)

| Store | Population risk (NULL %) | RLS bypass | Triggers | Injected? | **Overall** |
|---|---|---|---|---|---|
| `agent_beliefs` | 🔴 99.3% | 🔴 | 1 (purpose unknown) | ✓ injected | **🟡 mitigated by read-side filter; very brittle** |
| `agent_debate_records` | 🔴 90.5% | 🔴 | 0 | ✓ injected | **🟡 mitigated by transitive JOIN at every reader; brittle** |
| `signal_agent_analyses` | 🟡 38.9% | 🔴 | 0 | ✓ (post Layer 1, scoped) | **🟢 fixed read-side; write-side hold** |
| `agent_memory` | 🔴 100% tenant-null | 🔴 | 1 | ✓ injected | **🟡 needs focused audit** |
| `agent_investigation_memory` | n/a | 🔴 but trigger fail-closes | 1 (INC-OMCR) | (gated) | **🟢 fixed (INC-OMCR)** |
| `agent_conversation_memory` | 🔴 100% | 🔴 | 0 | not injected | 🟡 dormant |
| `conversation_memory` | 🔴 100% | 🔴 | 1 | not injected | 🟡 dormant |
| 11 stores without ownership columns | 🟠 transitive only | 🔴 | 0 | not injected | 🟡 dormant |

**Mitigated** means a defense-in-depth read-side scope is in place but the underlying Provenance Doctrine gap (nullable ownership + RLS bypass + writer omission) remains. **Brittle** means a single future code path that retrieves without scoping reintroduces the leak.

---

## Recommended remediation classes (no fixes started)

The Provenance Doctrine coverage gap is a class problem. Three remediation patterns are now established:

### Class A — read-side scoping (Layer 1 of every fix)

Patch every service-role reader to JOIN-derive or directly filter on `client_id`/`tenant_id`. PR #47 demonstrates the pattern for `signal_agent_analyses` in `generate-daily-briefing`. Repeatable for every other reader.

Candidates queued for Class A:
1. `agent_memory` readers in `dashboard-ai-assistant` and `agent-chat` — scope needs re-audit (INC-LEARN-CONTAM containment may already cover the dash-ai path but not the agent-chat path).
2. Any future injection of any of the 14 not-currently-injected stores.

### Class B — write-side ownership enforcement (Layer 2; schema work)

The INC-OMCR pattern: trigger `trg_<table>_require_tenant` derives ownership from parent FK if NULL on INSERT, raises exception if still NULL. Plus backfill from parent FK plus writer updates plus `NOT NULL` constraint. PR #36-class schema work; **held per standing directive**.

Candidates queued for Class B:
- `signal_agent_analyses` (already in plan as Layer 2 of the PR #47 thread)
- `agent_beliefs` — 99.3% NULL means a backfill effort would be substantial; needs careful planning
- `agent_debate_records` — 90.5% NULL; same
- `agent_memory`, `agent_conversation_memory`, `conversation_memory` — small enough for trivial backfill but the source of NULL needs to be understood

### Class C — RLS force toggle (universal structural fix)

For every store in this class, consider `ALTER TABLE … FORCE ROW LEVEL SECURITY`. This blocks service-role bypass at the table level. Side effect: every service-role reader must JOIN or filter correctly *and* the existing policies must continue to permit the legitimate read patterns. This is the highest-impact structural change but the highest blast-radius — flipping it without auditing every reader will break legitimate cron-driven jobs.

This needs to be considered per-store, not universally, but the **discipline question** is whether the platform's posture should be "service-role can read anything by design" (current) or "service-role must scope like every other role." The Provenance Doctrine implies the latter.

### Class D — write-time policy (defensive)

Add a static-grep CI guard that any `.insert()` or `.from(<store>).insert(...)` for a store in this inventory must include `client_id` or `tenant_id` or be on an explicit allowlist of "internally-derived, no ownership needed" cases. Catches new writers that omit ownership before they merge.

---

## What this inventory does NOT do

- Does not apply any fixes.
- Does not re-audit `agent_memory` retrieval in `dashboard-ai-assistant` and `agent-chat` — flagged as needing focused audit.
- Does not investigate why `agent_beliefs` has 99.3% NULL `client_id` while INC-LEARN-CONTAM's read containment in `dashboard-ai-assistant` restricts to "the caller-tenant's own client beliefs (client-null branch suppressed)" — if 99.3% are client-null, that containment effectively returns near-zero rows. Either the containment is over-restrictive, or the write-discipline gap is the primary issue. Both warrant a follow-up.
- Does not propose Class B (schema work) or Class C (RLS force) — both honor the PR #36 hold.
- Does not address the 14 stores not currently injected into reports. They are dormant risk; same structural pattern.

## Suggested triage order (your call, not mine to start)

By blast radius if any future code path begins retrieving:

1. **`agent_beliefs`** — already injected into `generate-daily-briefing` (currently safe via `.eq("client_id", clientId)`) and historically into `dashboard-ai-assistant` (INC-LEARN-CONTAM containment). The 99.3% NULL rate makes the existing containment effectively block almost everything; understand whether this is intentional or a different bug.
2. **`agent_memory`** in `dashboard-ai-assistant` + `agent-chat` — last audited per INC-LEARN-CONTAM but the table has 100% NULL tenant_id; needs verification.
3. **`agent_debate_records`** — well-scoped today at every known reader, but 90.5% NULL means any future un-joined reader would leak across tenants.
4. **Class D CI guard** — relatively cheap structural prevention.
5. Per-store Class A audits for the 14 dormant stores — only when one starts getting injected.
6. Class B (schema work) — held alongside PR #36.
7. Class C (RLS force) — strategic question deserving its own ADR.
