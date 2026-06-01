# Entity Resolution v1 — Smallest Viable "Same Actor?" Capability

**Task #178 · 2026-06-01** · Operator-authorized 2026-06-01 (Account Cycling in scope → ER is mandatory foundation per rework test; sequencing Option C with modification — ER design + social acquisition in parallel).

Design objective:
> *"Enable the first customer-visible capability: 'Is this the same actor?'"*
> *"Success is an operator receiving a defensible cluster suggestion with supporting evidence and deciding whether two accounts belong to the same actor."*

Most-important question:
> *"What is the smallest viable Entity Resolution capability that allows Aegis to answer 'Are these two accounts likely the same actor?' without creating future rework for Account Cycling Detection?"*

This is the design document. Implementation begins after operator GO on the design.

---

## §1 — The v1 customer workflow (concrete + visible)

A single operator workflow defines success. Everything else in v1 is the smallest substrate that supports this workflow without forcing Account Cycling rework.

### The workflow

1. **Operator pairs two entities to compare.** Two paths exist:
   - **Operator-initiated**: from the Investigation workspace, the operator selects two entity rows and clicks "Compare actors." (Smallest UX surface; no auto-suggestion in v1.)
   - **Aegis-chat-initiated**: operator asks Aegis *"Are entity X and entity Y the same actor?"* — Aegis triggers a comparison and returns the result inline.

2. **The system computes a comparison.** Three fingerprint axes (defined §3); each axis emits concrete evidence (counts, overlap percentages, sample data) — never an opaque score.

3. **Aegis emits a cluster suggestion** with:
   - **Cluster Confidence**: HIGH / MEDIUM / LOW / UNKNOWN (mirrors Coverage Confidence pattern from §159 doctrine; derived from evidence, not chosen by LLM)
   - **Per-axis evidence** (verbatim — what the operator can audit)
   - **Operator Impact**: *Can confirm now / Can act cautiously / Additional evidence needed / Insufficient evidence to suggest*

4. **Operator decides.** A confirm / reject decision is persisted. Rejected pairs are recorded so the system doesn't re-suggest them.

5. **Confirmed clusters become first-class.** Downstream surfaces (POI reports, KNOWN_ASSOCIATES, Account Cycling Detection when shipped) read confirmed clusters as the canonical actor identity.

### Aegis chat response shape (mirrors the Communication Doctrine output template)

```
Cluster Confidence: MEDIUM
Reason:
- Posting-time fingerprint: 73% overlap (24-hour activity windows)
- Vocabulary overlap: 31% shared distinctive terms (n=18 unique terms)
- Source-class overlap: both observed on news + community (2 of 2 classes)

Known:
- Entity A (id <uuid-short>): 12 signals, first-seen 2026-04-12
- Entity B (id <uuid-short>): 8 signals, first-seen 2026-05-19

Unknown (could collect):
- Cross-platform direct social posts (Reddit/Meta not currently collected)
- Image content matching (not yet operational)

Unknowable:
- Direct identity confirmation (the actor's real-world identity)

Operator Impact: Can act cautiously. MEDIUM cluster confidence — recommend
operator review in Investigation workspace before treating as same actor.
```

This shape: **honors the operator-validated Communication Doctrine output template** (deployed today). No new doctrine, no new framework. ER inherits the trust framing automatically.

### Capability Registry status flip

When v1 ships and meets PARTIAL acceptance criteria (§5):
- `cross-platform-entity-resolution` status moves NOT_OPERATIONAL → PARTIAL
- `required_language` updates to:
  > *"Cross-Platform Entity Resolution is partial. Operator-confirmable cluster suggestions are available based on posting-time, vocabulary, and source overlap. Cross-platform reach is limited by current social collection state. Cluster claims require operator confirmation before being treated as same-actor truth."*

This is the customer-visible signal that the capability has graduated.

---

## §2 — The substrate (smallest set that doesn't force Account Cycling rework)

Per the rework test, ER must ship with the substrate Account Cycling needs from day 1. Without these, Cycling would either duplicate ER logic or require ER rebuild.

### Required substrate shapes (data model)

| Shape | Why required for Account Cycling no-rework |
|---|---|
| **N-way clusters (not pairwise-only)** | Cycling detects when N+ new accounts cluster to one prior actor. If v1 only supports pairwise comparison, the cluster data model can't represent the cycling shape. v1 may EXPOSE only pairwise UX, but the underlying cluster shape must hold N members. |
| **Time-axis on cluster members** | Cycling needs `first_seen_at` per member (when the account was first observed) to detect "new account cycling from older one." This must be stored at cluster-member granularity, not just at entity granularity. |
| **Per-axis evidence storage** | Cycling's downstream detection relies on the evidence axes that match. Without persisted per-axis evidence, Cycling would need to recompute everything. |
| **Operator confirmation state** | Cycling needs to know which clusters are operator-confirmed vs suggested. Without this state, Cycling can't safely auto-promote a detection. |
| **Tenant ownership** | Per Aegis Authority + Memory doctrine, cross-tenant clusters are forbidden (outside the Aegis Ops seam which doesn't exist). Tenant-owned from day 1. |
| **Provenance Doctrine compliance** | Per ratified doctrine: cluster records have non-NULL `tenant_id` + `assertProvenance` at write seam + CHECK constraint enforcing ownership. |

### Conceptual data model (high-level — not schema-first)

Two new persistence surfaces are required. Naming illustrative; final names per operator review:

- **`actor_clusters`**: one row per logical cluster. Carries: `id`, `tenant_id` (non-NULL owner per Provenance Doctrine), `status` (`suggested` / `confirmed` / `rejected` / `superseded`), `created_at`, `resolved_at`, operator-decision metadata.

- **`actor_cluster_members`**: many-to-one with `actor_clusters`. Carries: `cluster_id`, `entity_id` (link to existing `entities`), `role` (anchor / candidate), `first_seen_at` (denormalized from entity for cycling time-filtering), `axes_evidence` (jsonb — per-axis scores + supporting data for audit), `added_at`.

Both tables: tenant-scoped via existing tenant-isolation pattern; RLS + CHECK constraint per Provenance Doctrine; named-consumer per `feedback_no_persistence_without_named_consumer` (consumer = Aegis chat + Investigation workspace + future Account Cycling Detection).

### What this enables for Account Cycling without rework

When Account Cycling Detection MVP eventually ships, it consumes the same substrate:
- Reads `actor_clusters` for confirmed clusters
- Detects when an existing confirmed cluster gets a new candidate member with `first_seen_at` within the recent window (cycling event)
- Promotes the candidate to the cluster + emits the cycling-finding signal

**No ER substrate changes are required for Cycling to ship.** That's the rework-test PASS.

---

## §3 — The v1 fingerprint axes (smallest set)

Three axes for v1. Each is computable from existing prod data; each emits concrete evidence (not opaque scores).

### Axis 1: Posting-Time Fingerprint
- **What it measures**: Hourly activity distribution across UTC clock. Compares two actors' 168-hour-week activity patterns.
- **Evidence emitted**: Pearson correlation coefficient + sample sizes + most-active-hour overlap (concrete claim like "both actors active 14:00-22:00 UTC on weekdays")
- **Why included**: Behavioral; survives platform changes; resistant to deliberate fingerprint manipulation if the actor doesn't deliberately re-schedule.
- **Data needed**: `signals.created_at` (per entity) — already in prod. No new data required.
- **Stub when sparse**: <10 signals per actor → axis emits "insufficient samples for posting-time comparison" and does not contribute to confidence

### Axis 2: Vocabulary Overlap
- **What it measures**: Distinctive-term overlap between actors. Uses standard term-frequency / inverse-document-frequency to identify each actor's distinctive vocabulary, then computes intersection.
- **Evidence emitted**: Top-N shared distinctive terms (verbatim — operator can read them) + overlap ratio
- **Why included**: Vocabulary is a behavioral fingerprint with strong signal when actors share unusual phrases / proper nouns / topics.
- **Data needed**: `signals.normalized_text` + `signals.title` — already in prod.
- **Stub when sparse**: <100 words per actor → emits "insufficient text corpus"

### Axis 3: Source-Class Overlap
- **What it measures**: Which source classes (news / community / government / RSS / social-where-collected) each actor appears on. Tighter overlap = more likely same observable footprint.
- **Evidence emitted**: Source-class list per actor + overlap ratio
- **Why included**: Cross-platform reach indicator. Two actors appearing on the same set of platforms is corroborative.
- **Data needed**: `raw_json->>'source'` from signals (normalized per existing `aegis-coverage-confidence.ts::normalizeSourceClass`) — module already in prod.
- **Stub when sparse**: <2 source classes per actor → emits "insufficient source diversity"

### Cluster Confidence derivation (predicate-based; no opaque weighting)

Mirrors the Coverage Confidence Measurement Model (Task #164) — predicate aggregation, not weighted score:

```
UNKNOWN := any axis returns "insufficient samples" for both candidates
LOW     := all three axes computable AND no axis exceeds operator-tunable
           "moderate-overlap" threshold
MEDIUM  := at least 2 of 3 axes exceed moderate-overlap threshold
HIGH    := all 3 axes exceed strong-overlap threshold AND at least one
           axis emits high-confidence evidence (e.g., posting-time
           correlation ≥0.7 OR shared distinctive-term count ≥10)
```

Thresholds are operator-tunable constants (per the Workstream D convention: changes via PR + operator sign-off, never silent tuning).

**At PARTIAL: HIGH cluster suggestions still require operator confirmation.** The OPERATIONAL-state autopromotion of HIGH clusters comes later.

---

## §4 — Integration with existing prod doctrine surfaces (no new doctrine)

ER inherits the customer-trust layer that shipped today:

| Existing surface | How ER uses it |
|---|---|
| **Coverage Confidence Measurement Model** (Task #164; prod) | Cluster suggestions emit `Cluster Confidence` using the same predicate-based pattern. Same contributors substrate. |
| **Aegis Communication Doctrine** (Task #159; prod) | Cluster output uses the mandatory SHORT/EXPANDED template (Reason + Known + Unknown/Unknowable + Operator Impact). |
| **Capability Registry** (Task #175; prod) | `cross-platform-entity-resolution` status updates NOT_OPERATIONAL → PARTIAL when v1 ships. `required_language` updates accordingly. Tenant-boundary regression tests protect new strings. |
| **Provenance Doctrine** (ratified) | Both new tables have non-NULL `tenant_id` + CHECK constraint + `assertProvenance` at write seam. |
| **Aegis Authority + Memory** (ratified) | Cross-tenant clustering is forbidden. v1 is single-tenant-scoped. |
| **Quarantine Doctrine** (ratified) | Quarantined signals excluded from posting-time + vocabulary axes (already enforced by analyst-side filter helpers). |
| **Workstream D claim-frames** (prod, dark) | Cluster suggestions are `[Inferred relationship]` claim type. When `D_SLIM_SLICE_ENABLED` activates broadly, ER inherits the four-question frame automatically. |
| **HONEST_LIMIT amendment** (prod, in #159) | "Direct identity confirmation" (real-world identity verification) is Unknowable; v1 always emits this in the Unknowable section. |
| **Flight Recorder** (prod) | Each comparison run logs a retrieval trace (`surface='ER_compare'`, returnedObjectIds=cluster member ids, provenance=axes+evidence). Audit trail for every cluster suggestion. |

**ER does not introduce any new doctrine.** It composes the existing trust layer with two new persistence surfaces + three fingerprint axes + one operator workflow.

---

## §5 — PARTIAL acceptance criteria (operator usefulness gate)

Same gate pattern as the Communication Doctrine slim slice. Validated on staging before prod.

### Capability acceptance (technical)
- Two new tables exist with Provenance-compliant ownership; CHECK constraint enforced
- Comparison job computes 3 axes deterministically from prod data
- Aegis chat handles "are X and Y the same actor?" → emits cluster suggestion using Communication Doctrine template
- Investigation workspace surfaces a "Suggested Clusters" panel with confirm/reject affordance
- Operator decision persists; rejected pairs are not re-suggested
- Capability Registry status updates from NOT_OPERATIONAL to PARTIAL

### Operator usefulness gate (the real test)
- ≥3 sample cluster suggestions run by operator on staging; ≥2 deemed decision-useful
- Operator confirms: cluster suggestion is **evidence-derived, not arbitrary** — the operator can read why
- Cluster Confidence class **feels honest** (LOW means thin; MEDIUM means there's something; HIGH is rare and reserved for strong evidence)
- Aegis chat behavior: capability-targeted "same actor?" questions now receive cluster suggestions instead of Capability Registry NOT_OPERATIONAL refusal
- Operator self-report: cluster suggestion + operator-confirm workflow is a real-world useful path

### What is NOT in PARTIAL (deferred to OPERATIONAL or beyond)
- **Auto-suggestion** — v1 is operator-initiated only. Aegis does not proactively suggest clusters.
- **Auto-promotion of HIGH clusters** — even HIGH requires operator confirm at PARTIAL.
- **Cross-tenant clustering** — forbidden by doctrine; will not ship at any phase without Aegis Ops seam.
- **N-way comparison UX** — substrate supports N-way; v1 UX is pairwise. Surface expansion is incremental.
- **Image-content axis** — separate capability (Image Recognition); deferred.
- **Network-of-followers axis** — graph-based axis; deferred.
- **ML-assisted cluster proposal** — rule-based for v1.
- **Real-time clustering** — comparison runs on-demand or batch; not streaming.
- **Re-cluster on new evidence** — manual operator-triggered comparison only.

---

## §6 — The rework test (re-applied at design level)

For each item in the v1 design: does omitting it force Account Cycling rebuild?

| Design element | Forced rework if omitted from v1? | Verdict |
|---|---|---|
| Two-table substrate (`actor_clusters` + `actor_cluster_members`) | YES — Cycling needs the cluster shape | MANDATORY in v1 |
| N-way member shape (even if v1 UX is pairwise) | YES — Cycling is N-way by definition | MANDATORY in v1 |
| Time-axis (`first_seen_at` per cluster member) | YES — Cycling time-filter needs it | MANDATORY in v1 |
| Per-axis evidence storage (jsonb on cluster_members) | YES — Cycling cites the cluster's evidence in its own findings | MANDATORY in v1 |
| Operator confirmation state | YES — Cycling needs to know confirmed vs suggested | MANDATORY in v1 |
| Tenant ownership + Provenance compliance | YES — every Fortress surface | MANDATORY in v1 |
| 3 specific axes (posting-time + vocabulary + source-class) | NO — axes are pluggable; adding axes later doesn't force Cycling rebuild | v1 specific; not foundation |
| Pairwise UX | NO — UX expansion is incremental | v1 specific |
| Investigation workspace integration | NO — Aegis chat is sufficient minimum; workspace surface is operator-experience enhancement | v1 specific (but recommended) |
| Capability Registry status update | NO — separate surface | v1 specific |

**The substrate decisions are foundational** (no rework if not omitted from v1). **Everything else is v1-specific** and can change in v2 without forcing rebuild.

This is the right architecture: foundation invariants are locked from day 1; surface details are mutable.

---

## §7 — What the design does NOT decide

Per the operator's prior constraint to keep design phase focused on customer-visible capability:

- Exact SQL schema (table column lists, indexes, RLS policy text) — design-implementation step after this is approved
- Exact prompt-template wording for Aegis chat cluster-suggestion responses — engineering detail
- Comparison job scheduling (synchronous vs background queue) — engineering detail
- UI/UX of the Suggested Clusters panel — frontend design detail
- Specific operator-tunable threshold values (axis match thresholds, cluster confidence cutoffs) — operator-calibrated post-deploy
- Migration ordering (which tables first, which RLS policies, which Provenance triggers) — substrate-first per C-0/T-0 pattern; specifics in implementation auth

These are downstream of operator approval of the conceptual design above.

---

## §8 — Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Sparse data → low-confidence clusters** (especially given current social collection PARTIAL state) | HIGH | Stub-out per axis when sample-size <threshold; emit UNKNOWN Cluster Confidence rather than fabricate. Document this in `required_language` for PARTIAL state. |
| **False-positive clusters** (rejected at operator review) | MEDIUM | PARTIAL state requires operator confirmation for every cluster. Rejected pairs persist so they're not re-suggested. Operator rejection rate is the primary tuning signal. |
| **Vocabulary axis over-weighting common terms** | MEDIUM | TF-IDF on distinctive terms; thresholds tunable per PR. Evidence emitted verbatim so operator can sanity-check. |
| **Posting-time axis fooled by deliberate fingerprint manipulation** | LOW (sophisticated adversary required) | Multi-axis design — single-axis manipulation doesn't promote a cluster to HIGH alone. |
| **Cross-tenant linking attempt** | DOCTRINAL VIOLATION | RLS + CHECK constraint at substrate; comparison job tenant-scoped; LLM prompted to refuse via Aegis Authority doctrine; defense-in-depth at every layer. |
| **Operator confirmation friction → workflow abandonment** | MEDIUM | Suggested Clusters panel surfaces in Investigation workspace where operator is already engaged; cluster suggestions emit small batches not floods; operator-rejection rate tracked. |
| **Substrate misdesign forces Cycling rebuild later** | LOW (per §6 rework test) | N-way member shape + time-axis + per-axis evidence storage are all foundation invariants in v1. |

---

## §9 — Operator decision surface for design approval

**Decisions required before implementation begins:**

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Approve §1 customer workflow (operator-initiated pairwise comparison + cluster suggestion + operator confirm/reject + persistence) | Recommend APPROVE — directly answers the operator's stated success criterion |
| **D2** | Approve §2 substrate shape (two tables: `actor_clusters` + `actor_cluster_members`; N-way; time-axis; per-axis evidence; tenant-owned; Provenance-compliant) | Recommend APPROVE — passes rework test for Account Cycling |
| **D3** | Approve §3 axes set (posting-time + vocabulary + source-class) as v1 — other axes deferred | Recommend APPROVE — smallest viable set computable from current prod data |
| **D4** | Approve §4 integration via existing doctrine surfaces (no new doctrine) | Recommend APPROVE — composes Communication Doctrine + Capability Registry + Provenance Doctrine + others (all in prod) |
| **D5** | Approve §5 PARTIAL acceptance gate (3 operator-validated cluster suggestions; ≥2 decision-useful) | Recommend APPROVE — mirrors the Communication Doctrine slim-slice validation gate that just succeeded |
| **D6** | Confirm §7 deferred items are correctly excluded from v1 scope | Recommend CONFIRM — auto-suggestion, image axis, ML, network axis, real-time all deferred |

On all six APPROVE/CONFIRM → implementation begins with substrate migration first (mirrors C-0 + T-0 pattern: pure-DDL substrate before any writer/reader code).

If any decision is NOT approved → revise design before any code is written.

---

## §10 — What I will NOT do without explicit GO

- Write the migration SQL
- Write the comparison job edge function
- Write the cluster-suggestion Aegis chat integration
- Write the Investigation workspace panel
- Modify the Capability Registry status update logic
- Touch any table in prod or staging

**This is design only.** Implementation requires the §9 D1-D6 approvals.

---

## §11 — Active state

| Item | Status |
|---|---|
| **T-0 prod T+1h watch (`bxr8kv75a`)** | In flight; fires ~`2026-06-01T13:45Z` |
| **Task #178 (this design)** | DRAFTED; awaiting operator approval per §9 |
| All Communication Doctrine quartet items + T-0 | PRODUCTION ✓ (closed per operator 2026-06-01) |
| Social acquisition restoration (parallel track per operator sequencing decision) | Not started by me; operator-initiated when Meta Graph token reactivation proceeds |
| Other capability work (Account Cycling, Image Recognition, etc.) | HELD per Capability Registry NOT_OPERATIONAL state |

Standing by for §9 decisions before any implementation work begins. The design is the gate; the substrate is the no-rework guarantee.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
