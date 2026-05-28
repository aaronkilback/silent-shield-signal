# ADR — Workstream D: Confidence and Provenance Layers (Design)

**Status:** DRAFT (proposed 2026-05-28) — pending operator ratification.
**Parent ADR:** `aegis-operational-intelligence-phase.md` (ratified 2026-05-28, PR #37).
**Scope:** the *what* and *how-it-surfaces* for D. Specific numeric weights, decay half-lives, and threshold values are flagged as **operator-tunable** and are not committed by this ADR — they are surfaced as named parameters whose final values the operator chooses at the end of ratification.
**Out of scope:** any mutating action; any execution; any autonomous scoring of an action's *worth*. D scores **what we know about a claim**, not what to do about it.

---

## 1. Anchoring principle: avoid AI certainty theater

Aegis must communicate **confidence, ambiguity, corroboration, uncertainty, provenance quality, and validation state** as **first-class operational concepts** — not subordinated to a single composite "score" that papers over weak evidence with the appearance of authority.

The certainty-theater anti-patterns this ADR explicitly bans:

1. **Single-score collapse** — reducing all the axes below to one "0.84" number that the operator cannot drill into.
2. **Confidence-by-presence** — treating "we have a record" as evidence; the presence of a row in `agent_investigation_memory` says nothing about the claim's truth, only that some pipeline wrote it.
3. **Restated-source as corroboration** — three signals that all derive from the same upstream RSS post are not three sources; the corroboration counter must dedupe by upstream provenance lineage, not by row id.
4. **AI hypothesis displayed as fact** — an inference Aegis produced from context must never visually equal a retrieved-and-validated record.
5. **Stale confidence** — a score computed last quarter that is still displayed today without freshness decay.
6. **Certainty without grounding** — if grounding is `unknown_unavailable`, no confidence may be displayed for that segment; the UI shows "ungrounded" instead.

Every design decision below traces to one of these bans.

## 2. Claim-type taxonomy (mandatory four-way distinction)

Every claim Aegis surfaces is exactly one of these four types. The taxonomy is the **primary axis of communication** — operators see the type label before any numeric score.

| Type | Definition | Examples | Display contract |
|---|---|---|---|
| **`retrieved_fact`** | Direct read of a record that originated outside Aegis. The record exists in the platform; Aegis is reporting it verbatim or near-verbatim. | A signal row, an entity row, a `poi_investigation` finding, a `case_investigation` entry. | Default visual; the source row is drillable in one click. |
| **`inferred_relationship`** | Aegis (or an upstream pipeline) joined two or more retrieved facts to assert a connection. The connection itself is not a stored fact. | "Entity E appears in signal S **because** S's narrative mentions E's normalized name." | Distinct visual treatment (dashed-line / "inferred"). The inputs that produced the inference are drillable. |
| **`analyst_confirmed_assessment`** | An operator (human) has explicitly reviewed and accepted (or annotated) a retrieved fact or inferred relationship. The operator's identity + timestamp + optional note are recorded. | Operator marks an `unresolved_conflict` cluster as resolved with a chosen canonical. | Visual treatment that distinguishes from un-reviewed (e.g., checkmark + reviewer attribution). |
| **`ai_generated_hypothesis`** | Aegis produced this from context using model reasoning without a direct stored fact. Must be visually distinct from every other type. | "Entity E's relationship growth pattern resembles cluster-expansion seen with activist coordination" (no stored evidence; pattern-match output). | Strong visual distinction (e.g., italic + "AI hypothesis" badge). Cannot be displayed alongside `retrieved_fact` without the type label. **May never appear without a grounding trace.** |

**Hard rules:**

- The type label is **not optional** on any displayed claim. UI without a type label is a defect.
- Up-casting is operator-only: an `ai_generated_hypothesis` becomes an `analyst_confirmed_assessment` *only* when an operator explicitly accepts it. No silent up-cast based on score.
- Down-casting is automatic when state changes: an `analyst_confirmed_assessment` whose underlying retrieved fact disappears becomes `inferred_relationship` (with the operator's prior acceptance noted as historical) until reviewed again.
- A `retrieved_fact` whose source row's tenant_id is `NULL` (per Provenance Doctrine) cannot be displayed at all — fail-closed.

## 3. Scoring axes (six, never collapsed)

Each axis is a 0–1 normalized value with a defined input set. They are **displayed alongside each other**, never combined into a single number for any operator-facing surface. (A composite *may* exist internally for sort order — see §3.7 — but is itself drillable to the six values.)

### 3.1 Corroboration

**Question:** How many *independent* lines of evidence support this claim?

**Definition:** Distinct upstream-provenance lineages that support the claim. Two signals citing the same RSS post count as **one** lineage. A signal + a tenant-uploaded document + a `poi_investigation` finding count as **three**.

**Inputs:**
- Source records linked to the claim.
- For each source: its upstream-provenance fingerprint (URL host + canonical path; document hash; investigation id; signal `source_url` host).
- A **lineage de-duplication** function over the fingerprints (defined in the implementation slice — proposed: `(host, path)` for URLs; `sha256(content)` for docs; investigation id otherwise).

**Score shape:** `0` for none, `1.0` capped (operator-tunable cap; proposed: capped at 5 distinct lineages → `1.0`, with the curve `score = min(1.0, distinct_lineages / CORROB_CAP)`).

**Display:** "Corroboration: 3 independent sources" (numeric count is shown; the score is the secondary expression).

### 3.2 Provenance quality

**Question:** How trustworthy are the source surfaces?

**Definition:** Per-source-type weighting. A claim's provenance-quality is the **maximum** weight among its sources (not the average — adding low-quality sources to a high-quality one should not *lower* the score).

**Source-type weights (operator-tunable; proposed defaults):**

| Source surface | Weight | Rationale |
|---|---|---|
| `analyst_confirmed_assessment` source | 1.00 | Operator explicitly validated. |
| Audited monitor (`monitor-news-google`, `monitor-rss-sources`, etc.) — first-party allowlist | 0.85 | Provenance-strict pipeline; deterministic. |
| Tenant-uploaded document | 0.80 | Tenant attested. |
| `poi_investigation` / `case_investigation` finding | 0.75 | Aegis-investigated but pipeline-bounded. |
| Audited monitor — open-web (non-allowlist) | 0.55 | Less-trusted source surface. |
| Quarantined or ownerless source | 0.00 | Per Provenance Doctrine — never used as evidence. |
| AI-only inference with no stored source | 0.00 | Required to flip to `ai_generated_hypothesis` type. |

**Display:** "Provenance: high (audited monitor)" — the *label* matters more than the number. Numeric backing is drillable.

### 3.3 Freshness

**Question:** How recent is the evidence behind this claim?

**Definition:** A monotonically-decreasing function of the **most recent** supporting evidence's age. Older corroborating evidence does **not** lower freshness (the question is "do we know this is still true," not "how long have we believed it").

**Decay shape (operator-tunable; proposed default):**
Exponential decay with **type-specific half-lives**:

| Claim class | Half-life | Why |
|---|---|---|
| Operational / threat / monitoring | 14 days | Real-world conditions change fast; 2-week-old monitoring data is materially less current. |
| Entity attributes (name, role, org) | 180 days | These move slowly. |
| Relationship existence | 365 days | Even slower. |
| Document content | infinite (no decay) | The doc said what it said; freshness measures whether the underlying *condition* still holds, not whether the document still exists. |

`freshness = 0.5^(age_days / half_life)`, clamped `[0, 1]`.

**Display:** "Freshness: stale (most recent evidence 47 days old; 14-day half-life)" — the operator sees the *raw inputs* to the score.

### 3.4 Validation state

**Question:** Has an operator reviewed and signed off on this claim?

**Definition:** A small state machine, stored per-claim:

```
        ┌─────────────────┐
        │ not_yet_reviewed│ ◄─── default for everything Aegis surfaces
        └────────┬────────┘
                 │ operator review
        ┌────────▼────────┐
        │    in_review    │
        └────────┬────────┘
        ┌───┬───┼───┬───┐
        │   │   │   │   │
        ▼   ▼   ▼   ▼   ▼
   accepted  rejected  needs_more_info  withdrawn  superseded
```

`accepted` is the only state that upgrades claim type to `analyst_confirmed_assessment`. `rejected` and `withdrawn` both *suppress* the claim from default Aegis surfaces (still drillable in audit). `needs_more_info` is a holding state — Aegis must surface "what's missing" alongside.

**Score shape:** 0 (not_yet_reviewed / in_review / needs_more_info) | 1 (accepted) | 0 (rejected / withdrawn / superseded).

**Display:** "Validation: not yet reviewed" / "Validated by Aaron on 2026-05-28" / "Rejected by Aaron on …" — the operator identity is the display, never just a number.

### 3.5 Trajectory confidence (claim-stability subscore)

**Question:** How stable is the trend that this claim is part of?

**Definition:** *Only applicable* to time-series claims (e.g., "entity X's signal density is rising"). For static claims (e.g., "entity X has email Y"), trajectory confidence is **undefined** and the UI shows "n/a" — not a fake 0.

**Inputs:**
- The time series the claim summarizes.
- A statistical stability measure (proposed: coefficient of variation over the relevant window; lower = more stable; ratified-only after first-cut ships).

**Score shape:** 0 (highly volatile, claim could flip next observation) → 1 (stable trend over multiple observation windows).

**Display:** "Trajectory: stable (3 weeks consistent)" / "Trajectory: noisy (single-day spike)".

### 3.6 Grounding sufficiency

**Question:** Does Aegis have a recorded retrieval/reasoning trace that justifies emitting this claim *at all*?

**Definition:** Binary in the slim slice (and possibly forever): `grounded` (trace exists in Flight Recorder linking the claim to certified retrieval surfaces) vs `ungrounded` (no such trace).

**Hard rule:** `ungrounded` blocks display. The operator does not see a "weak grounding" claim — they see no claim. The Flight Recorder grounding fail-closed default (`unknown_unavailable`) is carried forward to D as an absolute filter. (This is *not* the same as a low score across other axes; low corroboration + high grounding = "we know, weakly"; ungrounded = "we have no basis to emit at all".)

### 3.7 Internal composite (for sort order only; **not** an operator-facing score)

Sort order in queues is allowed to use a deterministic composite *so long as*:

- The composite formula is **fixed, documented, and operator-overridable** (operator may sort by any individual axis instead).
- The composite **never appears as a number** on the surfaced claim — it is only an ORDER BY argument.
- Drilling into a row reveals the six axis values, not the composite.

Proposed composite (subject to operator ratification):
```
composite = grounding · (0.35·corroboration + 0.30·provenance + 0.20·freshness + 0.15·validation_state) · (0.7 + 0.3·trajectory_or_1)
```
The `grounding` multiplier means `ungrounded → composite = 0` (claim doesn't surface). `trajectory_or_1` = 1.0 when trajectory is `n/a`.

## 4. Storage model

**Principle:** confidence is **derived-on-read by default**; persisted snapshots are introduced only where trajectory analysis or audit replay require them. This preserves drill-down (operator always sees current inputs, not a stale cache) and lets D be additive.

### 4.1 Derived-on-read primitives (no schema change)

A new TS module `_shared/aegis-confidence.ts` exposes pure-function evaluators:

- `scoreClaim(claim, sources, opts): ClaimConfidence` — given a claim and its source records, returns the six-axis value object.
- `dedupeProvenanceLineages(sources): string[]` — implements §3.1's lineage dedup.
- `provenanceWeight(sourceType, opts): number` — looks up §3.2's table.
- `freshnessFromAge(ageDays, claimClass, opts): number` — implements §3.3.

Callers (B's visualization, C's reasoning, the future Aegis chat) compute on-demand. No DB write happens for "we displayed a confidence."

### 4.2 Persisted snapshots (audit + trajectory)

One additive table:

```sql
create table public.aegis_claim_confidence (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,                      -- Provenance Doctrine
  claim_type            text not null check (claim_type in (
                          'retrieved_fact','inferred_relationship',
                          'analyst_confirmed_assessment','ai_generated_hypothesis')),
  claim_subject_kind    text not null,                      -- 'entity'|'relationship'|'signal'|'investigation'|...
  claim_subject_id      uuid,                               -- nullable for inferred/aggregated claims
  claim_payload         jsonb not null,                     -- the specific claim text/structure
  corroboration         numeric(4,3) not null,
  provenance_quality    numeric(4,3) not null,
  freshness             numeric(4,3) not null,
  validation_state      text not null default 'not_yet_reviewed',
  trajectory_confidence numeric(4,3),                       -- nullable: n/a allowed
  grounded              boolean not null default false,
  sources_jsonb         jsonb not null,                     -- the source set used; drillable
  scored_at             timestamptz not null default now(),
  debug_trace_id        uuid                                -- Flight Recorder linkage
);
```

- **Trigger** `trg_claim_conf_require_tenant` rejects null tenant_id (Provenance Doctrine).
- **RLS** identical to other Aegis tables: tenant SELECT scoped to own tenant; service-role writes; operator-only audit reads.
- **Snapshot policy:** scored on every operator review action, on every trajectory checkpoint, and on-demand for audit replay. The table is **append-only** in the slim slice (no UPDATE; new state = new row). This is non-negotiable for audit trail.

### 4.3 Validation-state storage

Validation transitions are **events**, not column-overwrites. They land in `aegis_claim_confidence` as new snapshots whose `validation_state` reflects the operator action and whose `sources_jsonb` carries `{actor, action, prior_state, note}`. The current state is the latest snapshot's `validation_state` for `(tenant_id, claim_subject_kind, claim_subject_id, claim_payload_hash)`.

A small view `aegis_claim_current_state` exposes the latest snapshot per (claim-identity) for query convenience without removing the audit trail.

## 5. Display contract (consumed by B and C)

Any UI or Aegis response that surfaces a claim **must**:

1. Show the **type label** (retrieved fact / inferred relationship / analyst-confirmed / AI hypothesis) prominently.
2. Show **at least three of the six axes** alongside the claim (the choice depends on context; recommended defaults: corroboration count, provenance label, freshness label).
3. Allow **one-click drill** into the source records that produced the scores.
4. Use language matched to the score — banned constructions are listed below in §6.
5. Carry a `debug_trace_id` linkage for forensic replay.

UI helpers ship as React components in a new `src/components/aegis-confidence/` directory in the implementation slice — design is locked here so all consumers render the same primitives.

## 6. Anti-certainty-theater language rules (Aegis prose)

When Aegis composes prose answers, the language must reflect the scores. Specifically:

| Score profile | Required phrasing class | Banned phrasing |
|---|---|---|
| Validation `accepted` + high corroboration + fresh | "Confirmed: …" / "Validated: …" | (no constraint) |
| Validation `not_yet_reviewed` + high corroboration + fresh | "Multiple sources report: …" | "Confirmed", "Verified" |
| `inferred_relationship` + any score | "Inferred from …" / "Suggested by …" | "Confirmed", "We know" |
| `ai_generated_hypothesis` | "Aegis-generated hypothesis (not corroborated): …" | "Confirmed", "Verified", "Reports indicate", "Sources say" |
| Stale freshness | "Most recent evidence is N days old: …" | Present-tense without the age qualifier |
| Low corroboration | "Single-source claim: …" | "Multiple sources", "Widely reported" |
| Ungrounded | (claim is suppressed entirely) | n/a |

These rules are enforced by a **prose-lint pass** on Aegis output before it returns to the user. The lint is part of the implementation slice and ships with a regression suite of negative test cases.

## 7. Slim-slice scope (first implementation PR after this ADR ratifies)

This ADR ratifies the contract; the **first** implementation PR should be deliberately small and additive:

**In slim slice:**
- `_shared/aegis-confidence.ts` evaluator module (pure functions; no DB writes yet).
- `aegis_claim_confidence` table + trigger + RLS + view (additive migration; **staging first**).
- Wiring: B's first visualization slice + C's first surfaced meta-condition both call the evaluator; no operator-facing surface ships without it.
- Prose-lint pass scaffolded with the §6 rule table; activated for one Aegis surface (`dashboard-ai-assistant`) and behind a feature flag for the others.

**Explicitly NOT in slim slice:**
- Trajectory confidence (§3.5) is **scaffolded but not yet computed** — column nullable, all rows `null` initially. Activated under a separate PR once B's time-series visualization is up.
- Validation state UI workflows (the elect/accept/reject UIs) are part of Workstream A, not D. D ships the storage + scoring; A consumes it.
- Confidence decay over time (§3.3 with multiple half-lives) ships with **one** half-life initially (operational/threat = 14 days); other classes use the same value until B's per-claim-class display surfaces.

## 8. Operator-tunable parameters (consolidated)

These are the values the operator ratifies at the end of this ADR; they live as constants in `_shared/aegis-confidence.ts` and require a code change to alter (auditable):

| Parameter | Proposed default | Tunable later? |
|---|---|---|
| `CORROB_CAP` (lineages at which corroboration = 1.0) | 5 | yes |
| `PROVENANCE_WEIGHTS` (per §3.2 table) | as listed | yes |
| `FRESHNESS_HALF_LIFE_OPERATIONAL_DAYS` | 14 | yes |
| `FRESHNESS_HALF_LIFE_ATTRIBUTE_DAYS` | 180 | yes |
| `FRESHNESS_HALF_LIFE_RELATIONSHIP_DAYS` | 365 | yes |
| `COMPOSITE_WEIGHTS` (§3.7) | as listed | yes |
| `STALE_THRESHOLD` (freshness below which prose uses "stale" qualifier) | 0.4 | yes |

## 9. What D does NOT do (explicit out-of-scope)

- D does **not** mutate retrieved facts. It scores them.
- D does **not** decide what to *do* about a low-confidence claim. It surfaces the low confidence; an operator decides.
- D does **not** suppress claims based on score — only based on **grounding** (binary) and explicit operator validation states (rejected/withdrawn).
- D does **not** introduce cross-tenant comparison or scoring. Confidence is tenant-bounded.
- D does **not** introduce autonomous up-casting of `ai_generated_hypothesis` → `analyst_confirmed_assessment`. Operator action required.
- D does **not** ship a composite "trust score" exposed to operators. The composite is for sort order, drillable, and is not the primary display.

## 10. Verification (post-implementation, before prod)

1. **Unit:** pure-function evaluator regression suite — known input → known six-axis output.
2. **Integration:** apply slim-slice schema to staging; confirm trigger rejects null tenant_id; confirm append-only behavior.
3. **Prose-lint suite:** for each row in §6, a negative test that Aegis prose containing the banned phrasing under the stated profile is **rejected**.
4. **End-to-end (one Aegis surface):** `dashboard-ai-assistant` returns a claim with type label + three axes + drill-down; Flight Recorder captures the `debug_trace_id` linkage; `aegis_trace_replay()` shows the confidence-score event.
5. **No autonomous execution check:** static grep + CI gate confirms no code path mutates user-visible state based on score crossing a threshold.

---

## Ratification block (operator)

- [ ] Anchoring principle (§1) and the six anti-patterns are binding.
- [ ] Claim-type taxonomy (§2 — 4 types, hard rules) approved.
- [ ] Scoring axes (§3.1–§3.6) approved as defined, with the proposed defaults in §8 as the *starting* values.
- [ ] Internal composite (§3.7) approved as the only allowed combination, sort-order use only, never displayed.
- [ ] Storage model (§4 — derived-on-read by default; `aegis_claim_confidence` append-only).
- [ ] Display contract (§5) approved as binding on B and C.
- [ ] Prose-lint language rules (§6) approved.
- [ ] Slim-slice scope (§7) approved as the first implementation PR after ratification.
- [ ] Operator-tunable defaults (§8) approved as starting values.
- [ ] Out-of-scope items (§9) approved as binding.
- [ ] Verification gates (§10) approved as the prod-apply checklist.

Once ratified, the next artifact is the **slim-slice implementation PR** (staging first; prod apply held).

---

## Amendment A1 — Operational usefulness over academic scoring (2026-05-28, RATIFIED)

Operator clarification at ratification time. The substrate of §3 (six axes) and §6 (prose-lint) remains binding **but is not the primary surface**. The primary surface is **decision quality**, not score generation.

### The four operator questions (display frame)

Every operator-facing output from Aegis that surfaces a claim must answer, in this order, in this prominence:

1. **What do we know?** — the claim itself, with type label (§2). Plain language, no jargon, no axis numbers.
2. **How do we know it?** — source surface label + corroboration count + drill link. Plain language ("3 audited monitors over 9 days") not a 0.85 number on first read.
3. **How confident are we?** — a qualitative summary (one of: `confirmed` · `well-attested` · `single-source` · `inferred` · `hypothesis` · `stale` · `ungrounded`) backed by the §3 axes, drillable. The summary is generated from the axes by the table in §A1.1 — it is not a free-form composite.
4. **What action, if any, should be considered?** — a recommendation (or `none`). Always recommendation-only per parent ADR; never executed; always carries the operator-validation state needed to upgrade it.

The axes (§3) and the composite (§3.7) are the **substrate** that produces these four answers — drillable from any of them, but never the headline.

### A1.1 — Confidence summary derivation (binding mapping)

| Claim type | Grounded? | Validation | Corroboration ≥ | Provenance ≥ | Freshness | → Summary |
|---|---|---|---|---|---|---|
| any | false | any | any | any | any | `ungrounded` (suppress) |
| `ai_generated_hypothesis` | true | any | any | any | any | `hypothesis` |
| `inferred_relationship` | true | not accepted | any | any | any | `inferred` |
| `retrieved_fact` / `inferred_relationship` | true | not accepted | < 0.4 | any | any | `single-source` |
| `retrieved_fact` | true | not accepted | ≥ 0.4 | any | < `STALE_THRESHOLD` | `stale` |
| `retrieved_fact` | true | not accepted | ≥ 0.4 | ≥ 0.7 | ≥ `STALE_THRESHOLD` | `well-attested` |
| `retrieved_fact` | true | not accepted | ≥ 0.7 | ≥ 0.7 | ≥ `STALE_THRESHOLD` | `well-attested` |
| `analyst_confirmed_assessment` | true | accepted | any | any | ≥ `STALE_THRESHOLD` | `confirmed` |
| `analyst_confirmed_assessment` | true | accepted | any | any | < `STALE_THRESHOLD` | `stale` (with prior validation noted) |

Rules:
- Summary is **derived**, not stored as a separate column — recomputed from the persisted axes on read.
- The summary is the **headline label**; the underlying axes are always one drill away.
- The mapping table is operator-tunable (lives in `_shared/aegis-confidence.ts` constants); changes are auditable PRs.

### A1.2 — Banned operator-facing surfaces

In addition to §6 prose bans, the following **UI surfaces** are prohibited because they tilt toward intelligence theater rather than decision quality:

- A standalone "confidence dashboard" displaying axes without any associated claim or action.
- Aggregate scores across many claims rolled into one tenant-level "confidence index".
- Trend lines on confidence scores divorced from the underlying claim trajectory.
- Visual hierarchies that make a high-numerical-axis claim *look more important* than a confirmed-by-operator claim with lower axes.

### A1.3 — Action consideration field

The fourth question — *what action, if any, should be considered?* — requires a structured field, not free text. Each Aegis claim that proposes action carries:

```ts
consideration: {
  recommended_action: ActionKey | null,     // enumerated registry; null = no action recommended
  rationale: string,                        // one short sentence; required when action ≠ null
  requires_operator_approval: true,         // BINDING — never false in this phase
  approval_state: 'not_yet_reviewed' | 'queued' | 'approved' | 'rejected',
  executed: false,                          // BINDING — never true in this phase
}
```

The `executed: false` and `requires_operator_approval: true` invariants are enforced at the type level (TS literal `true`/`false`) so a future code change cannot quietly remove them without an explicit type-system override. The CI gate (§10.5) checks the literal source.

### A1.4 — Slim-slice scope addendum

The slim-slice implementation PR adds to §7:

- Frame helper `frameClaim()` returning `{ what, how, confidence, consideration }` — the four-question structure consumed by display layers.
- Confidence-summary derivation as a pure function in `_shared/aegis-confidence.ts`.
- One end-to-end demonstration: `dashboard-ai-assistant` returns at least one framed claim per response (when a retrieved fact / inference is in play), and the response payload includes the framed structure (not just axes).
- The `consideration` shape is scaffolded in the evaluator — initial `recommended_action` values are `null` until Workstream C wires action recommendation logic.

Ratified by operator at ADR ratification time (2026-05-28).

