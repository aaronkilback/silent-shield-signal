# Maintenance Automation Diagnosis

**Operator-directed 2026-05-31 (Task #132).** Read-only diagnosis. Four maintenance-automation questions. No implementation.

Operator framing: *The dominant problem is not approval workload. The dominant problem is unresolved maintenance automation.*

Doctrine ratified this turn: *Maintenance debt is operational risk. A queue that cannot self-maintain eventually conceals the signals that matter.*

---

## §0 — Verdict Table

| Item | Classification | Evidence |
|---|---|---|
| 1. Credential-exposure Slack alert | **Stale data + broken provenance** | Originating signal exists (age 18 days); agent_action has NULL `context_signal_id` / `tenant_id` / `client_id` — provenance completely absent |
| 2. monitoring_proposals expiry | **MISSING** | No cron, no function, no migration; `'expired'` status value exists in CHECK but no automation populates it |
| 3. entity_suggestions match-existing auto-resolve | **PARTIALLY MISSING** | Schema design exists; 2 of 7 writers populate `matched_entity_id`; no backfill job for existing pending; QR2 design ratified but not yet implemented |
| 4. entity_suggestions pending duplicate collapse | **MISSING** | No unique constraint, no dedup job, no in-queue reconciliation |
| Bonus: `auto_approve_safe_actions()` cron | **BROKEN** | Runs hourly but uses INNER JOIN on `context_signal_id`, excluding NULL-context actions — most candidates are unreachable |

The dominant pattern is **schema designed for automation that was never wired** (items 2, 3, 4). One job that IS wired (`auto_approve_safe_actions`) has a join predicate that excludes the real-world data shape.

---

## §1 — Item 1: Credential Exposure Slack Alert

### A — The originating signal exists

```
signal_id:    8195bd5b-4a12-4fe7-8208-ea74d6746a83
created_at:   2026-05-13 17:28:31 UTC
age:          ~18 days
title text:   "A potential credential exposure was identified in the GitHub
              repository booluckgmie/malaysia-mobility-dashboard, which may
              reference credentials related to Petronas."
```

### B — The agent_action has BROKEN provenance

```
agent_action_id:    8d6b2178-ea1f-4d76-88be-11ce21373268
agent_call_sign:    AEGIS-CMD
action_type:        notify_oncall_via_slack
permission_tier:    propose
status:             awaiting_approval
created_at:         2026-05-23 20:04:22 UTC (10 days AFTER originating signal)
context_signal_id:  NULL    ← should link to 8195bd5b-... but doesn't
context_incident_id:NULL
tenant_id:          NULL    ← Provenance Doctrine violation
client_id:          NULL    ← Provenance Doctrine violation
```

The action was created without tenant/client/signal provenance. This is a separate defect (writer-side; agent-chat or similar created the action without supplying provenance). It is also why the `auto_approve_safe_actions()` job — which requires `context_signal_id` to be non-null via INNER JOIN — couldn't process this even if it were eligible.

### C — Status of the credential exposure itself

- Originating signal is 18 days old
- I cannot verify externally whether the GitHub repository `booluckgmie/malaysia-mobility-dashboard` still contains exposed credentials referencing Petronas
- The Slack ping never fired (queue stalled)
- Whether Petronas was notified through other channels is unknown from this codebase

**Classification:** the data exists; the alert pipeline never delivered. The threat may be resolved out-of-band or may still be live — **requires external verification by the operator**.

### D — Why the action sat 8+ days

Two compounding reasons:
1. **`notify_oncall_via_slack` is in the `propose` permission tier** — designed to require operator approval (correct doctrine)
2. **NULL provenance** — the action cannot be auto-approved by `auto_approve_safe_actions()` even if it were eligible, because that function INNER JOINs on `context_signal_id`

The system worked as designed (operator-only approval for external comms), but operator capacity ran out and there was no second-tier fallback (escalation timer, second channel, dashboard alert).

---

## §2 — Item 2: monitoring_proposals Expiry

### Classification: **MISSING**

The expiry mechanism was designed in schema but never wired to any job.

### Evidence

**Schema design intent (in repo):**
- `monitoring_proposals.expires_at` column set at INSERT time to `now() + 7 days` (migration `20260214223800_*.sql:16`)
- `monitoring_proposals_status_check` CHECK includes `'expired'` value
- Documentation in CLAUDE.md mentions "(7-day expiry)" for monitoring proposals

**What does NOT exist:**
- No pg_cron job touches monitoring_proposals (76 active cron jobs inspected; zero match)
- No edge function with names like `expire-monitoring-proposals`, `monitoring-proposal-cleanup`, `cleanup-stale-proposals`
- No migration with `cron.schedule(...)` referencing monitoring_proposals expiry
- No cron_job_registry entry for expiry maintenance
- No SQL trigger
- No system-watchdog check for expired-pending count
- The `expires_at` field is set on INSERT and never read by any function

**Empirical state:**
- 126 of 312 pending rows (40%) are past their `expires_at` deadline
- Oldest expired ≈ 2026-05-26 (5 days past expiry)
- None more than 7 days past expiry (recent accumulation; the cron-job absence only started biting in late May with the inflow surge)

### Fix shape (not implementation; description only)

Either:
- Add a pg_cron entry: `UPDATE monitoring_proposals SET status='expired' WHERE status='pending' AND expires_at < NOW()` (single SQL, no edge function needed)
- Or extend `system-ops` to handle this and schedule it

The simpler form (SQL-only cron) is consistent with how `frontend-errors-cleanup-daily`, `heartbeat-cleanup-daily`, and `stuck-document-recovery-15min` are wired today (pure SQL in the cron command).

---

## §3 — Item 3: entity_suggestions Match-Existing Auto-Resolve

### Classification: **PARTIALLY MISSING**

The design intent is documented and partially implemented; the existing-pending backfill is missing.

### Evidence

**Schema design intent (in repo):**
- `entity_suggestions.matched_entity_id` column references existing `entities.id`
- `entity_suggestions.status='merged'` semantic for "linked to existing entity"
- `silentFailureDetector.ts:268` asserts approved rows MUST have non-null matched_entity_id
- QR2 demonstration doc (Task #124) explicitly states: *"The `matched_entity_id` column + `status='merged'` semantic was DESIGNED to express this"*

**What DOES exist:**
- 2 of 7 production writers pre-compute matched_entity_id at write time:
  - `process-stored-document/index.ts:1320`
  - `process-security-report/index.ts:722`
- UI surface (`EntitySuggestionsPanel.tsx:287`) supports operator-driven merge action
- Merge-duplicate-entities function redirects matched_entity_id when entities are merged

**What does NOT exist:**
- 5 of 7 production writers (correlate-entities, agent-chat, parse-entities-document, extract-signal-insights, auto-enrich-entities) insert with `matched_entity_id=NULL`
- No background reconciliation job to backfill matched_entity_id for existing pending rows
- No cron job that re-scans pending entity_suggestions against entities
- No SQL trigger on entity_suggestions or entities to maintain the link

**Empirical state:**
- 107 of 260 pending entity_suggestions (41.2%) match an existing `entities.name` for the same tenant — they could be auto-resolved to `matched_entity_id=<existing>` + `status='auto_merged'`

### Status of fix

- **Write-time fix:** Task #124 (QR2 pre-implementation demonstration) — completed; awaiting implementation authorization
- **Backfill of existing 107 rows:** not yet scoped; would be a separate one-time SQL pass

### Verdict refinement

This isn't a missing-by-oversight case — it's a partially-implemented-and-scheduled case. The QR2 work plan exists. The diagnostic finding is that 5 of 7 writers don't honor the schema's design intent, and there's no backfill for the existing surplus.

---

## §4 — Item 4: entity_suggestions Pending Duplicate Collapse

### Classification: **MISSING**

### Evidence

**Schema design intent (in repo):**
- None explicitly. Unlike `monitoring_proposals`, there is no `expires_at` or dedup-oriented field on `entity_suggestions`
- No CHECK constraint preventing dupes
- No unique constraint on (tenant_id, suggested_type, normalized_name)

**What does NOT exist:**
- No unique index (unlike QR1's `monitoring_proposals_dedup_idx`)
- No pre-INSERT trigger
- No cron job for dedup
- No `_shared/dedup-entity-suggestions.ts` or similar helper
- No reference to `duplicate_detections` table for entity_suggestions

**Empirical state:**
- 124 of 260 pending entity_suggestions (47.7%) are exact-dupes within the pending set
- They could collapse to ~136 unique rows via the same deterministic-ranking pattern QR1 used

**Note on QR2:**
The QR2 architecture (Task #124) proposes a write-time pre-check against `entities.name` — that addresses match-existing (Item 3). It does NOT propose a unique-index on entity_suggestions analogous to QR1. The "QR2-equivalent for dedup" would be a separate intervention (call it QR2-dedup or a sister index).

### Verdict refinement

Even after QR2 lands, the within-pending dedup remains uncovered unless a separate intervention is designed. The current QR2 demonstration is focused on match-existing, not in-queue dedup.

---

## §5 — Bonus Finding: `auto_approve_safe_actions()` is BROKEN

### Classification: **BROKEN**

The cron `agent-action-auto-approve-hourly` runs every hour at `:23` and calls `public.auto_approve_safe_actions()`. The function exists and is well-formed. But its INNER JOIN excludes the real-world data shape.

### The function definition (verified)

```sql
FOR action_id IN
  SELECT aa.id
  FROM agent_actions aa
  JOIN signals s ON s.id = aa.context_signal_id::uuid    -- INNER JOIN
  WHERE aa.status = 'awaiting_approval'
    AND aa.action_type = 'propose_severity_correction'
    AND aa.created_at < NOW() - interval '24 hours'
    AND public.severity_rank(aa.action_payload->>'proposed_severity')
        < public.severity_rank(s.severity)
LOOP
  PERFORM public.apply_agent_action(action_id, 'auto-stale-downgrade');
```

### Why it's broken

The INNER JOIN on `context_signal_id::uuid` requires:
1. `context_signal_id` is non-null
2. The referenced signal still exists
3. The signal hasn't been quarantined or deleted

From the earlier sample (Task #121 §2):
- Action 1 (executed): `context_signal_id: 'df7b2250-...'` — passes
- Action 2 (awaiting_approval): `context_signal_id: NULL` — excluded
- Action 3 (awaiting_approval): `context_signal_id: NULL` — excluded
- Action 4 (awaiting_approval): `context_signal_id: NULL` — excluded
- Action 5 (awaiting_approval): `context_signal_id: NULL` — excluded

Most propose_severity_correction actions appear to have NULL `context_signal_id` (the action_payload contains `signal_id` but the column is not populated). The auto-approve job sees ~zero candidates.

### Compound failure with item 1

The Slack notify action also has NULL `context_signal_id` (§1.B). Even if `notify_oncall_via_slack` were in the auto-approve eligibility list (it isn't, by design), the JOIN would have excluded it.

The pattern: **writers don't populate `context_signal_id`** even though the schema and maintenance job both depend on it. This is a writer-side defect compounding the maintenance-job design.

### Verdict refinement

`auto_approve_safe_actions()` is the only maintenance job for any of these three queues that exists AND is scheduled. It fires hourly and writes a heartbeat. But its predicate excludes the actual queue contents — invisible failure mode where the job runs successfully and approves zero rows because the data doesn't match the join condition.

---

## §6 — The Larger Pattern

Fortress has 76 active pg_cron jobs. The maintenance pattern is well-established:

- `frontend-errors-cleanup-daily` — SQL DELETE
- `heartbeat-cleanup-daily` — SQL DELETE
- `stuck-document-recovery-15min` — SQL UPDATE
- `auto-archive-stale-entities` — function call
- `purge-aegis-traces-daily` — function call
- `agent-action-auto-approve-hourly` — function call (but broken predicate)

The infrastructure exists. The doctrine is established. The specific maintenance jobs for the three operator-facing queues:

1. **monitoring_proposals expiry** — never written
2. **entity_suggestions match-existing backfill** — never written (write-time is scheduled via QR2)
3. **entity_suggestions dedup** — never written
4. **`context_signal_id` provenance enforcement** — never written; data shape doesn't match `auto_approve_safe_actions` predicate

These are not edge-case oversights. They are gaps in the operator-facing review surfaces specifically — the rest of the system has its maintenance covered.

---

## §7 — The Doctrine This Confirms

> *Maintenance debt is operational risk. A queue that cannot self-maintain eventually conceals the signals that matter.*

The credential-exposure Slack ping is the textbook case. The system worked exactly as designed at every step:

1. Signal ingested correctly (2026-05-13)
2. Agent identified it as worth escalating (2026-05-23)
3. `notify_oncall_via_slack` action created
4. Permission tier `propose` (correct — external comms need approval)
5. **Cron `agent-action-auto-approve-hourly` runs hourly** — but its predicate excludes this action
6. Operator capacity ran out — action sat 8 days

Result: an 18-day-old credential exposure has an 8-day-old unfired Slack ping waiting for human approval that never arrived.

If the queue had self-maintained — by either auto-expiring (item 2), auto-resolving matches (item 3), auto-collapsing dupes (item 4), or escalating via second channel — the operator-attention burn rate would have been low enough that the Slack ping wouldn't have been buried.

The fix is not approval automation. It is maintenance automation.

---

## §8 — What Each Fix Would Look Like (Description Only)

| Item | Fix shape | Effort estimate |
|---|---|---|
| 1. Credential ping verification | Operator-side: check `booluckgmie/malaysia-mobility-dashboard` for live exposure; approve or reject the action | 10 min operator review |
| 1. Provenance enforcement | Writer-side: agent-chat / agent-tools must populate `context_signal_id` + `tenant_id` + `client_id` on action creation; CHECK constraint to enforce | 2-4h writer changes + migration |
| 2. monitoring_proposals expiry | Single SQL cron: `UPDATE ... SET status='expired' WHERE expires_at < NOW() AND status='pending'`; daily schedule | 30 min |
| 3. entity_suggestions match-existing backfill | One-time SQL pass + QR2 write-time fix (already designed) | 1h backfill + 2-4h QR2 (already scheduled) |
| 3. entity_suggestions match-existing ongoing | QR2 helper + writer integration | already scoped as Task #124 |
| 4. entity_suggestions in-queue dedup | Sister to QR1: partial unique index on (tenant_id, suggested_type, normalized_name) WHERE status='pending' + 23505-aware writers | 2-4h (mirrors QR1 pattern) |
| 5. `auto_approve_safe_actions` fix | Change INNER JOIN to LEFT JOIN, handle NULL signal cases; OR fix writers so context_signal_id is always populated | 1-2h |

None of these are implemented now. Each is operator-authorization-gated.

---

## §9 — Held / Constraints Honored

- No implementation
- No QR3 / EX-1 / Campaign 1 work begun
- QR1 observation continues on schedule
- Each fix in §8 is a separate operator-decision surface — not a recommendation, just a description of shape

---

## §10 — Most Operationally Relevant Finding

**The credential-exposure Slack ping (Item 1) has an unfired action 8 days old, no provenance to source signal, and an 18-day-old originating signal whose external exposure status is unknown from this codebase.**

If only one thing gets attention from this diagnosis, that's it. The maintenance gaps (Items 2–4) are operator-attention debt; the Slack ping may be a real-world incident.

Everything else in this diagnosis is foundation for future maintenance-automation work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
