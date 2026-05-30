# Decision Layer R1 — Commitment Inventory Study (pre-R1.1 observation)

**Status:** OBSERVATION 2026-05-29 — read-only inventory of commitment-shaped data in Fortress prod, conducted per operator directive before R1.1 authorization. No implementation, no detector code, no schema changes. **Goal:** determine whether commitment derivation is mature enough for a useful C1 detector before R1.1 is authorized.

**Companion artifacts:**
- `architecture-decisions/decision-layer-doctrine-2026-05-29.md` (v2, RATIFIED)
- `architecture-decisions/decision-layer-r1-threshold-detection-2026-05-29.md` (RATIFIED in principle)
- `decision-layer-r1-q-recommendations-2026-05-29.md` (v2 — Q5 clarification, I1/I2 invariants)
- `decision-layer-r1-authorization-sheet-2026-05-29.md` (SIGNED 2026-05-29)
- R1.0 schema deployed staging + prod 2026-05-29 (PR #61, zero behavioral effect)

**TL;DR — Headline finding:**

> The commitment derivation surface in Fortress prod today is **structurally insufficient for a meaningful C1 detector.** The R1 ADR §1 working-model surface listed 8 source classes; 6 are either empty, missing the assumed deadline columns, or shape-mismatched. Only 2 surfaces have non-trivial content (incidents and reports), and both have significant limitations. Authorizing R1.1 against the current inventory would yield a detector that **fires on essentially nothing** for ~6 of 8 classes — the §B.1 watchlist would fill not because the gate-design is wrong, but because the inventory is empty. **Recommend HOLD on R1.1 until the inventory is remediated** (options in §H).

---

## §A — Commitment classes the doctrine assumes exist

From the R1 ADR §3 (deadline-derivation rules) and the operator's stated framing, eight commitment classes are referenced in the ratified doctrine. Mapped here against actual Fortress prod state:

| # | Class (per R1 ADR §3) | Storage type | Prod state |
|---|---|---|---|
| 1 | Scheduled event the principal will attend | Implied (no dedicated surface) | **Absent** — no calendar/events table; `cop_timeline_events` schema exists but **0 rows**; `episode_arc_appearances` is investigation case-file, not principal calendar |
| 2 | Scheduled public statement / press release | Implied | **Absent** — no surface |
| 3 | Strategic posture commitment ("we always attend the AGM") | Implied | **Absent** — no surface |
| 4 | Open `autonomous_actions_log` entries with stated due date | Receipt log | **Shape mismatch** — 3,384 rows all system actions (proactive_intelligence_push, monitoring_proposal_applied, watchdog_report, daily_email_briefing); no `due_at` column; status='succeeded' = 0 |
| 5 | Investigation hypothesis under test | Explicit table | **Schema gap** — `investigations` has no deadline column; Q7's assumed `next_review_at` does NOT exist |
| 6 | Travel plan (operational + personal) | Explicit table | **Empirically dormant** — schema clean (`itineraries.departure_date`, `personal_trips.departure_date`) but 0 future itineraries, 0 future personal trips |
| 7 | Regulated disclosure deadline | Implied | **Absent** — no surface |
| 8 | Open incident response posture | Explicit + SLA jsonb | **Partially viable** — 60 incidents, 44 open, with SLA jsonb (mttd/mttr in minutes); but 26 are ownerless and 32 are in `_qa_test_client` (test fixture); real-tenant active incidents ≈ 0 |

**Six of eight classes (75%) are absent or shape-mismatched in prod today.**

---

## §B — Explicit vs implicit storage

**Q2 (explicit storage):** which commitment classes have a dedicated structured column for the underlying commitment + a deadline?

| Class | Explicit storage? |
|---|---|
| Travel commitments | ✅ explicit (`itineraries.departure_date`, `personal_trips.departure_date`) — but no rows |
| Incident response postures | ⚠️ partial (`incidents.opened_at + sla_targets_json.mttr` derivable, but mttr is a class default 5/30 min not an absolute deadline) |
| Investigation hypotheses | ❌ no deadline column (Q7's `next_review_at` does not exist) |
| Scheduled events | ❌ no table |
| Press/statements | ❌ no table |
| Strategic postures | ❌ no table |
| Regulated disclosures | ❌ no table |
| Action receipts | ⚠️ table exists but shape is wrong (system actions, not principal commitments) |

**Q3 (implicit storage):** which commitment classes are inferable from existing surfaces but not labeled?

| Class | Implicit derivation source |
|---|---|
| Scheduled events | **None viable today.** `cop_timeline_events.event_time` exists but the table is empty. No other source. |
| Public statements | **None viable today.** Possibly extractable from `ai_assistant_messages` prose if the principal stated one — but only 1.4% of user turns contain commitment-shape language. |
| Strategic postures | **None viable today.** Possibly in `agent_chat_beliefs` (31 total rows) — but no deadline shape. |
| Regulated disclosures | **None viable today.** Possibly in `archival_documents` if a regulatory letter has been uploaded, but no structured deadline extraction exists. |
| Reports cycle (next-report-due) | ⚠️ `generated_reports.period_end` + `reports.period_end` implicitly define next-cycle boundary; but this is a system cadence, not a principal commitment. |

---

## §D — Surfaces containing commitment data today

Concrete row counts from prod (2026-05-29):

| Surface | Total | Active/open | Recent (30d) | Future-dated | Verdict |
|---|---|---|---|---|---|
| `incidents` | 60 | 44 open | 60 | n/a | **Only viable surface with material content**, but 26 ownerless + 32 test fixture leaves ~2 real-tenant rows |
| `investigations` | 7 | 5 open | 7 | n/a (no deadline col) | **Schema-blocked** — no deadline column to derive from |
| `itineraries` | 0 | 0 | 0 | 0 | **Empirically dormant** |
| `personal_trips` | 2 | n/a | n/a | 0 | **Empirically dormant** |
| `autonomous_actions_log` | 3,384 | n/a | 3,077 | n/a | **Shape mismatch** — system receipts, not commitments |
| `generated_reports` | 3 | n/a | 3 | n/a | Reporting windows, not commitments |
| `reports` | 254 | n/a | 144 | n/a | Same |
| `ai_assistant_messages` (user) | 148 last 30d | n/a | 148 | n/a | **2 (1.4%) carry commitment-shape language** in user turns |
| `briefing_chat_messages` | 0 last 30d | n/a | 0 | n/a | Empty |
| `agent_chat_beliefs` | 31 | n/a | n/a | n/a | No deadline shape |
| `conversation_memory` | 0 last 30d | n/a | 0 | n/a | Empty |
| `cop_timeline_events` | 0 | n/a | 0 | 0 | **Schema designed for this; table empty** |
| `scheduled_briefings` | n/a | 1 | n/a | 0 (no future runs) | System schedule, not principal |
| `report_schedules` | n/a | 1 | n/a | n/a | System schedule, not principal |

---

## §E — Derivation coverage per source surface

**Q5: what percentage of commitments can be derived from each source?** Per-class assessment, given the prod state above:

| Source | Travel | Incident | Investigation | Event | Press | Posture | Disclosure | Action |
|---|---|---|---|---|---|---|---|---|
| `incidents` | 0% | **~100% (where rows exist)** | 0% | 0% | 0% | 0% | 0% | 0% |
| `investigations` | 0% | 0% | **0%** (no deadline column) | 0% | 0% | 0% | 0% | 0% |
| `itineraries` / `personal_trips` | **100% (empirically: 0 rows)** | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| `generated_reports` / `reports` | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% (these are publication windows, not actions) |
| `cop_timeline_events` | 0% | 0% | 0% | **100% schema viable / 0% empirical** | 0% | 0% | 0% | 0% |
| `ai_assistant_messages` | low | low | low | low | low | low | low | low (semantic extraction only; 1.4% prevalence) |
| `autonomous_actions_log` | 0% | 0% | 0% | 0% | 0% | 0% | 0% | **0% (shape mismatch — system actions)** |
| `briefing_chat_messages` | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% (empty) |
| `conversation_memory` / `agent_chat_beliefs` | 0% | 0% | 0% | 0% | 0% | 0% | 0% | 0% (no deadline shape) |

**Aggregate derivation coverage of any kind: incidents partial (limited to ~2 real-tenant rows), everything else 0%.**

---

## §F — 10 real commitment examples that would be visible to R1.1

The brief asked for 10. Here are 10 — drawn from real prod data, with the caveat that several are from the only surface that has material rows (incidents), and several illustrate the gaps rather than the strengths.

### From `incidents` (the only viable surface)

| # | Class | Ref | Detail | Derived deadline |
|---|---|---|---|---|
| EX1 | incident posture | `5f179de4-1f7a-43b8-9f65-cd55dbcd6048` | P1 open: "Critical Wildfire — Skeena/Kitimat corridor" (opened 2026-05-18, SLA mttr=30min) | `opened_at + 30 minutes` (~5 days ago — **already past**) |
| EX2 | incident posture | `8e42a8b2-b860-4aa9-a9bf-7f8f52263d93` | P1 open: same wildfire (opened 2026-05-17) | past |
| EX3 | incident posture | `5097f7fd-7b2b-4861-a8ed-790b051ad40a` | P1 open: same wildfire (opened 2026-05-17) | past |
| EX4 | incident posture | `3a3e07d0-6f34-48dc-b61e-9148143cba86` | P1 open: "Other — Progress Energy Canada, Papua New Guinea" (opened 2026-05-16, no SLA jsonb) | **No derivable deadline** |
| EX5 | incident posture | `b1ce7b57-7c96-4014-ba35-ee58a770f7b2` | P1 open: "Critical Other — Petronas Canada" (opened 2026-05-16, SLA mttr=30min) | past |

**Observation on EX1–EX5:** SLA mttr=30min for a P1 incident is an alerting-tier SLA, not a principal-tier decision deadline. All deadlines are technically past — these are stale-decision/retrospective cases per C3. None would fire C3 today.

### From `investigations` (schema-blocked)

| # | Class | Ref | Detail | Derived deadline |
|---|---|---|---|---|
| EX6 | investigation hypothesis | `9525b53b-cfea-4f38-88f5-9f191cdc385a` | file_status=open, synopsis=NULL | **No deadline column on the table; synopsis empty** |
| EX7 | investigation hypothesis | `cb3e1439-3b66-4dbc-8e54-928ed986d3f5` | file_status=open, synopsis=NULL | same |
| EX8 | investigation hypothesis | `708d03b8-ed5f-4bf9-8a8e-eb7d7fc06019` | file_status=open, synopsis=NULL | same |

**Observation on EX6–EX8:** Q7 resolution was built on `investigations.next_review_at` — column does not exist. Under the Q7 fallback ("if NULL, treat as expired"), all 3 evaluate C3=false. No frames from investigations under current schema.

### From `ai_assistant_messages` (sparse)

| # | Class | Ref | Detail | Derived deadline |
|---|---|---|---|---|
| EX9 | conversation-stated | `71a87644-a83d-4e91-b754-0f4e39982260` | User: *"ok I am going to some petronas sites today. someone has taken a sight glass from a chemical pump. I heard these are used to make drug paraphernalia. is that true"* | Implied today; **no structured extraction; tenant_id=NULL** |
| EX10 | conversation-stated | `b8c033ee-5c15-424d-b1a3-80ffa7d89aad` | User: *"How should I think about executive protection for a CEO who has to attend a high-profile public event in a city where there's an active protest movement targeting the company?"* (the validation query that drove the entire Decision Layer arc) | Implied "some future date"; **no structured extraction; tenant_id=NULL** |

**Observation on EX9–EX10:** Both are tenant-NULL (the operator's testing turns). Both contain commitment-shape language but neither could be structurally derived without prose extraction — and ironically EX10 is the exact query whose lack-of-decision-layer-response triggered this entire workstream.

---

## §G — Commitment classes that are currently invisible

A commitment class is "invisible" to R1.1 if there is no structured surface that contains it AND there is no reliable prose-extraction path. From the matrix above, **these classes are invisible today:**

| Invisible class | Why |
|---|---|
| **Scheduled events / public appearances** | No dedicated surface. `cop_timeline_events` schema fits but is empty. The exec-protection scenario that drove the Decision Layer doctrine has **no place to be stored**. |
| **Strategic posture commitments** ("we always attend AGMs in person") | No surface. Possibly extractable from chat history but prevalence is 1.4% and there is no labeling. |
| **Public statements / press releases / messaging** | No surface. The R1 ADR's "Why it matters" stakeholder impact framing assumes communications-team commitments exist as data — they don't. |
| **Regulated disclosure obligations** | No surface. Some may be in `archival_documents` (regulatory letters) but no structured deadline. |
| **Family routines / family-office commitments** | No surface. Family-office stakeholder (§3 of the Decision Layer Doctrine) has zero corresponding data shape. |
| **Board / shareholder communications postures** | No surface. |
| **Vendor / supplier commitments** | No surface. |
| **Investigation review deadlines** | Schema-blocked (no `next_review_at` column). |
| **Long-running operational commitments** ("we will maintain X security posture for Y duration") | No surface; would require a new structured commitments table. |

**Invisible classes outnumber visible ones roughly 9:1 across the doctrine's referenced surface.**

---

## §H — Verdict + path-forward options (no implementation proposed)

### Verdict on R1.1 readiness

**Commitment derivation is NOT mature enough for a useful C1 detector today.**

If R1.1 is authorized against the current inventory:

| Expected outcome | Mechanism |
|---|---|
| Detector fires on near-zero queries | 6 of 8 commitment classes are absent/empty; the 2 viable surfaces have <5 real-tenant rows total |
| §B.1 watchlist (`c1_significant_no_commitment`) fills heavily | Not because the gate-design is wrong, but because the **inventory** is empty — every materially-anomalous signal lands in this bucket |
| 7-day audit measures inventory shape, not detector quality | The detector becomes a passive measurement of the data gap; we don't learn whether the C1 design works |
| R1.7 promotion gate cannot be evaluated honestly | FP rate ~0 (nothing fires); FN rate could be high but indistinguishable from "no inventory to detect against" |

This is the dormancy-by-empty-input failure mode — distinct from the dormancy-by-conservative-threshold mode the §B.1 watchlist was designed to measure. **The §B.1 watchlist measures gating discipline; what's failing today is upstream of gating — the data the gate needs doesn't exist.**

### Path-forward options (operator decides)

These are **options**, not recommendations to implement. Each has a different cost / coverage / time profile.

| Option | What it does | Trade-off |
|---|---|---|
| **A — Authorize R1.1 anyway** | Ship the detector. Accept that audit data will measure inventory rather than gate design. | Cheapest; risk = 7 days of low-signal audit + ambiguous R1.7 promotion decision |
| **B — Hold R1.1; build the `principal_commitments` table first** | Reopen Q3. Design and ship a dedicated commitments inventory (writers from incidents + investigations + itineraries + a new direct-entry surface). | Adds 1 schema ADR + writer cutover; biggest single coverage lift |
| **C — Hold R1.1; ship the schema patches first** | Add `investigations.next_review_at` (Q7 fix). Backfill SLA-based deadlines into a normalized incident.deadline_at column. Light-touch additive schema. | Closes 2 specific gaps; doesn't address invisible classes |
| **D — Hold R1.1; build the missing surfaces** | Calendar / events / press / posture / disclosure surfaces. ADR-level work. Pre-existing ADR backlog includes [[aegis-canonical-entity-and-unified-graph]] which touches some of this. | Largest scope; most coverage; longest time |
| **E — Hold R1.1; bootstrap conversation-extraction first** | Add a structured-extraction step on ai_assistant_messages turns: when a user states a commitment, write it to a (new) commitments inventory. Same Q3 dedicated-table outcome via conversation seeding. | Mid-scope; piggybacks on user activity but depends on actual conversation prevalence (currently 1.4%) |
| **F — Hold R1.1; redefine C1 with a softer gate for the cold-start** | Doctrine-level amendment. Move from "commitment-linkage required" to "commitment-linkage OR strong materiality" for the first iteration. | **Doctrine amendment — requires re-ratification.** Conflicts with operator-locked I1 invariant if "strong materiality" leans on statistics. |

### What this study does NOT do

- Propose any single option as the recommendation
- Authorize any implementation
- Modify the doctrine or any ADR
- Modify any held item

### What this study DOES surface for operator decision

The R1.1 authorization question is now informed by inventory ground-truth. The operator can:
1. Authorize R1.1 against the current inventory (Option A) with the eyes-open expectation that the audit measures inventory, not gate
2. Pause R1.1 pending one of options B–F (with a separate scoping artifact per option)
3. Pursue a hybrid (e.g., C + E in parallel; cheap schema patches now, conversation-extraction as a longer track)

The §B.4 watchlist (I1 invariant) is unaffected by any of these — that audit ships with R1.1 whenever R1.1 ships.

---

## §I — Specific schema/data gaps identified by this study

For the record, in case the operator chooses options C / D / E:

1. **`investigations.next_review_at`** — assumed by R1 ADR Q7, does not exist. Schema patch required for any investigation-based C3 derivation.
2. **`incidents.deadline_at`** (or equivalent) — currently derivable as `opened_at + (sla_targets_json->>'mttr')::int`, but the mttr is alerting-tier minutes not principal-tier decision time. A principal-tier deadline would need a separate column.
3. **`cop_timeline_events`** — schema-ready but empty. Either start writing to it (with what writer?) or remove the suggestion that it is a working-model surface.
4. **`autonomous_actions_log.status`** — assumed 'succeeded' value but never set. The R1 ADR's "confirmed actions" interpretation does not match the writers' behavior.
5. **No principal-events / public-appearances surface** — would be a new table; the largest single coverage lift.
6. **No press/statement surface** — same.
7. **No strategic-posture surface** — same.

---

## §J — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- R1.0 — schema deployed, zero behavioral effect; not affected by this study
- R1.1 — **NOT authorized by this study.** Authorization gate awaits operator decision among options A–F.
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR itself — unchanged per standing operator directive

## Changelog

- **2026-05-29 v1** — initial commitment inventory study. Read-only observation of prod data; no implementation. Headline finding: commitment derivation is NOT mature enough for a useful C1 detector; 6 of 8 commitment classes absent/empty in prod. Operator decision required among options A–F before R1.1 authorization.
