# Fortress Capability Registry — Design

**Status:** DRAFT PROPOSAL — uncommitted, for operator review. No tables created, no migration run.
**Governs itself:** subject to the Aegis Capability Integrity Doctrine. This registry's own maturity is
**PRESENT (proposed)** — not PROVEN, not adopted — until it is built, seeded only from real evidence,
and shown in practice to resist inflation.

> **The registry is not a new source of truth. It is a derived view of the existing one.**
> Roadmap = destination (intent). Assessments = evidence of record (immutable). Registry = the computed
> "you are here" pin — authoritative for *current location* precisely because it is re-derivable from
> the evidence trail, and holds **no fact not traceable to an assessment artifact.**

---

## 0 · Why the registry is authoritative — and what it is authoritative *for*

The question "why the registry instead of the roadmap or the assessments themselves?" has a precise answer,
and the precision is the safeguard:

- **The roadmap cannot be authoritative for current state.** It is intent. Treating intent as state is
  the exact inflation the whole doctrine exists to prevent. The roadmap is authoritative for *destination
  and for the readiness criteria* a capability must meet — nothing about *now*.
- **Assessments are the source of truth, but cannot be *directly* queried as "now".** They are point-in-time,
  immutable, and plural (001, 002, 003…). No single assessment is "the present"; capabilities advance and
  regress across them; different assessments cover different subsets. To know current state you must
  *reduce the entire assessment history to the latest qualifying evidence per capability.* **That reduction
  is the registry.**
- **Therefore the registry is authoritative as a *projection*, not a *source*.** It is the deterministic
  function `registry = reduce(all assessments)`. The instant it contains a value not produced by that
  reduction, it has stopped being authoritative and become fiction. This is why (§1) current state is
  implemented as a **VIEW over an append-only evidence ledger**, with no hand-editable current-state table
  to inflate.

Authority chain: **evidence → (append-only ledger) → registry view → Mark/Level computation → Aegis report.**
Each arrow is a pure derivation. Nothing flows backward; nothing is hand-set downstream.

---

## 0b · Foundational rule (strengthened — binding) + the delete test

"Derived, not writable" is necessary but **not sufficient**: it stops manual inflation but not
detached-label trust-transfer, gamed derivation rules, stale-green, or ignored contradiction.
The complete, binding rule has five clauses. A valid registry object is **never a bare status** — it
is always `{status + supporting evidence + contradictory evidence + as-of + derivation-rule-version}`:

1. **Derived, not writable** — current state/Mark status are views over append-only evidence.
2. **Non-detachable** — no status may exist or be displayed apart from its evidence lineage.
3. **Conservative-by-derivation** — contradiction *lowers* status (most-skeptical-wins); dissent is
   priced in, not merely shown.
4. **Staleness-honest** — expired evidence downgrades to UNKNOWN/stale; never stale-green; `as_of`
   always carried.
5. **Owns no truth** — passes the **delete test**: *delete the registry's derived outputs and nothing
   is lost (they recompute); delete the assessments and everything is lost.* The registry's only
   persistent authoritative footprint is **configuration** — the capability catalog, the derivation
   rules, and the Mark requirements (intent) — never conclusions, never original evidence.

Materialization for performance is allowed **only as a cache with a recompute guarantee** — never
hand-editable, never outliving its evidence. A cache is a fast read of a derivation, not authority.

**Contradiction is a first-class field, not an omission.** "Why is X TRUSTED?" must return the five
trust-dimension evidence refs *and* any dissent; if it cannot, the registry must refuse the label.

**Residual risk that architecture cannot remove:** the sociological pull to trust the convenient pane
over the evidence, and the fact that machine-checks confirm an artifact *exists*, not that it is
*valid*. Independent/adversarial audit and the habit of reading through to evidence stay load-bearing.

## 1 · Architecture (the anti-inflation core)

Five objects, three of them **append-only or read-only by construction**:

| Object | Kind | Writable? | Role |
|---|---|---|---|
| `capability_definitions` | table | governed inserts only | the stable catalog of *what capabilities exist to track* (claim-granularity) |
| `capability_evidence_ledger` | table | **APPEND-ONLY** (insert-only; no update/delete) | every status determination, one row per (capability × assessment). The heart. |
| `capability_registry_current` | **VIEW** | **not writable** | current state = the latest-assessment row per capability + computed freshness/trend |
| `mark_requirements` | table | governed inserts only | maps each Mark/Level → required capabilities + required status threshold (the readiness criteria; roadmap-owned intent) |
| `mark_status_current` | **VIEW** | **not writable** | each Mark/Level's *earned* status, COMPUTED as the min over its requirements against the registry view |

The single most important property: **there is no writable "current Mark" or "current status" cell anywhere.**
Current state exists only as a view. The only thing a human/assessor can write is an *evidence ledger row*,
and only through a published assessment that cites an artifact. You cannot inflate a view.

Enforcement: ledger is insert-only (revoke UPDATE/DELETE; a trigger rejects mutation); inserts require a
non-null `assessment_id` + at least one `evidence_ref` for any status above UNKNOWN.

---

## 2 · Schema (illustrative — design, not migration)

```
capability_definitions
  capability_id        text PK            -- stable key, e.g. 'er.verdict_engine'
  name                 text
  description          text
  domain               text               -- collection | correlation | trajectory | decision | aegis | platform
  mapped_mark          text null          -- 'II' (which Fortress Mark this capability supports)
  mapped_aegis_level   text null          -- 'II'
  registered_assessment_id text           -- when first catalogued
  decommissioned       bool default false -- soft-retire only; never delete

capability_evidence_ledger            -- APPEND-ONLY
  id                   uuid PK
  capability_id        text  FK
  assessment_id        text  FK  not null -- which published assessment set this
  layer                text             -- Implemented | Proven | Trusted   (product layers only)
  status               text             -- NOT_PRESENT | PRESENT | PROVEN | TRUSTED | UNKNOWN
  environment          text             -- prod | staging | local
  evidence_refs        jsonb            -- [{type, citation, env, date}]  (>=1 required if status>UNKNOWN)
  trust_dimensions     jsonb            -- {reliability, explainability, repeatability, grounding,
                                        --  false_certainty_resistance} each: {met:bool, evidence_ref|null}
  assessor_id          text
  assessor_type        text             -- claude | codex | human | third_party
  verified_on          date
  reverify_by          date null        -- freshness horizon (esp. for TRUSTED)
  note                 text
  recorded_at          timestamptz default now()
  -- NO updated_at: rows are immutable. Corrections = a new row in a new assessment.

capability_registry_current  (VIEW)
  -- for each capability_id: the row from MAX(assessment ordinal), plus:
  --   freshness    = fresh | aging | expired   (from reverify_by vs today)
  --   effective_status = status, auto-downgraded one step if freshness=expired & status in {PROVEN,TRUSTED}
  --   trend        = improving | stable | regressed   (vs the prior assessment's row)
  --   as_of        = the assessment date  (NEVER presented as "today")

mark_requirements
  mark_or_level        text             -- 'Mark II' | 'Aegis L II'
  required_capability_id text FK
  required_status      text             -- threshold, e.g. 'PROVEN'
  requires_prior_mark  text null        -- enforces the trust chain (Mark II requires Mark I earned)

mark_status_current  (VIEW)
  -- per mark_or_level: earned_status = MIN(effective_status of required capabilities),
  --   gated by requires_prior_mark; plus open_gaps = requirements below threshold,
  --   plus weakest_links + as_of (oldest contributing assessment date).
```

---

## 3 · Capability lifecycle

1. **Register** — a capability is catalogued in `capability_definitions` at claim granularity. On
   registration with no evidence yet, its registry status is **UNKNOWN** (never silently PRESENT).
2. **Evidence accrues** — each published assessment appends a ledger row reflecting that assessment's
   finding. Status is always *the lowest the cited evidence justifies.*
3. **Advance / regress** — strictly via new ledger rows (§4). Never by editing.
4. **Decay** — `reverify_by` lapses → registry shows `expired` and auto-downgrades effective status;
   forces re-earning.
5. **Decommission** — soft-retire (`decommissioned=true` via a final ledger row); history is preserved.

---

## 4 · Status transitions (evidence-gated)

Statuses: **NOT PRESENT · PRESENT · PROVEN · TRUSTED · UNKNOWN** (challenged in §5 — kept, with two
*orthogonal* dimensions added rather than new statuses).

| Transition | Requires |
|---|---|
| → PRESENT | a code-reference artifact (resolvable path@commit) |
| → PROVEN | observed-correct evidence on real/representative data in the **claimed environment** (test/validation/telemetry + date). Red or absent tests **cap at PRESENT**. |
| → TRUSTED | PROVEN **+ all five trust dimensions met with evidence + fresh** + operational-history or independent validation |
| any → lower (regress) | an incident record, a now-red test, lost environment, or expiry. Regressions are **mandatory to record**, never dropped. |
| → UNKNOWN | default on registration; or when prior evidence is invalidated and none replaces it |

**Iron rules:** a promotion row MUST cite a *new* evidence artifact; the system rejects a status increase
with no new `evidence_ref`. **Time, effort, code volume, and roadmap intent are not evidence** and cannot
appear as `evidence_refs`. On assessor disagreement within the same period, **the lowest status holds**
until a named assessment reconciles it.

---

## 5 · Challenging the status model

The 5-status ladder is **kept** — adding statuses multiplies ambiguity and creates new inflation surfaces.
But a flat ladder cannot express two things the doctrine requires, so I add them as **orthogonal
dimensions on the ledger, not new statuses:**

1. **Environment** (prod/staging/local) — because "PROVEN on staging" must never read as "PROVEN in prod."
   Status without environment is meaningless for deployment decisions.
2. **Freshness** (fresh/aging/expired via `reverify_by`) — because **TRUSTED is a maintained state, not a
   permanent award.** Stale trust auto-downgrades. This operationalizes trust-decay.

Plus a **derived trend** (improving/stable/regressed) so regressions are visible at a glance without
re-reading history. Net: same 5 statuses, but each is qualified by *where*, *how fresh*, and *which way
it's moving*. That is a strictly more honest model, justified by the doctrine's own trust-decay and
regression-tracking requirements — not by a desire for more granularity.

---

## 6 · Trustworthiness tracking

TRUSTED is gated on **all five dimensions** carrying standing, fresh evidence:
reliability · explainability · repeatability · grounding · false-certainty-resistance (the last = demonstrated
that it *refuses/stubs rather than fabricates* — e.g. the kind of negative-control evidence a correlation
capability would need). Missing or stale any dimension → caps at PROVEN. The registry exposes the per-dimension
evidence so "TRUSTED" is never an opaque badge.

---

## 7 · Assessment integration (historical integrity)

- Every ledger row FKs to the **immutable** assessment that produced it. The registry view is simply the
  per-capability reduction over those rows.
- **Assessment 001 seeds the ledger** via the framework's §6.3 crosswalk — as a *new* set of rows
  *attributed to 001*, never by editing 001. Expect most seeded rows to land **PRESENT or UNKNOWN**, a few
  PROVEN, almost none TRUSTED — and that honesty is the point, not a defect.
- Assessments 002, 003… append more rows. Nothing is rewritten. The registry "moves" only because new
  immutable evidence was appended. Full lineage of any status is reconstructable.

**This is why standing up the registry does NOT require a new assessment** (you flagged this): it is an
*indexing* of evidence that already exists (001 + the existing validation docs), not an occasion to assert
new capability. Building it must surface UNKNOWNs and gaps, not manufacture greens.

---

## 8 · Mark / Level integration (intent never becomes evidence)

- `mark_requirements` encodes the **readiness criteria**: each Mark/Level lists the capabilities it needs
  and the threshold each must reach. This is roadmap-owned *intent* — it defines *what would earn* the Mark.
- `mark_status_current` **computes** earned status = `MIN(effective_status of required capabilities)`, gated
  by `requires_prior_mark` (so Mark III cannot compute as earned while Mark II is below threshold — the
  trust chain enforced mechanically).
- Consequently **"what Mark are we?" is a query result, not a stored or remembered claim.** A Mark is earned
  only when its supporting capabilities reach the required trustworthiness in the *current registry view*.
  Defining a Mark does not earn it; no cell anywhere lets you assert a Mark earned.
- **Changing a threshold is a governed, logged act.** Lowering a requirement to "earn" a Mark is visible in
  the diff and auditable — the doctrine's defense against moving the goalposts.

---

## 9 · Aegis reporting model

Aegis answers Mark/Level/capability questions **only by querying the registry + mark views**, never from
memory or narrative. For every Mark or Level claim Aegis returns, sourced from the views:

- **Current status** (computed earned status + as-of date + freshness)
- **Supporting evidence** (the `evidence_refs` behind the contributing capabilities)
- **Latest assessment** that touched them
- **Open gaps** (required capabilities below threshold)
- **Advancement blockers** (the weakest links + any expired/stale evidence)

If the registry says UNKNOWN, or evidence is stale, **Aegis says exactly that** — "not established; last
assessed <date>; evidence: none/expired." Aegis never upgrades a registry value in narration.

Honest note: **"Aegis answers from the registry" is itself a capability** — and today it is **NOT PRESENT**
(neither the registry nor that query path is built). It belongs in the registry as a tracked, currently-NOT
PRESENT capability. Designing for the outcome ≠ having it.

---

## 10 · Failure modes, gaming, and safeguards (applied aggressively)

| Threat | Vector | Safeguard |
|---|---|---|
| **Hand-edited inflation** | set a "current Mark = PROVEN" cell | No writable current-state cell exists; current state is a VIEW over an append-only ledger |
| **Fake/weak evidence** | cite a non-existent commit/test | Evidence refs must be machine-resolvable (commit/file/test exists); independent audit can invalidate; CI check that refs resolve |
| **Self-grading optimism** | assessor inflates own work | Most-skeptical-status-wins; assessor_type recorded; third-party audits; assessor's *own demonstrations excluded* |
| **Stale trust** | TRUSTED set once, never re-checked | `reverify_by` + auto-downgrade on expiry |
| **Bundling hides weak members** | one row over "Entity Resolution" | Claim-granularity decomposition; Mark status = MIN over requirements |
| **UNKNOWN read as PRESENT** | absence treated as ok | UNKNOWN is explicit and default; Aegis must surface it verbatim |
| **Goalpost-moving** | lower a Mark requirement to "earn" it | Requirement changes are governed + logged + diff-visible |
| **View drift / staleness** | old projection shown as "now" | Every view carries `as_of`; never rendered as today; cadence-stale capabilities flagged |
| **Registry treated as source** | someone trusts the registry over the evidence | Doctrine + architecture: registry holds nothing not traceable to a ledger row → an assessment → an artifact |
| **The registry itself inflates its own status** | "registry is done" | It's in the registry as PRESENT-proposed until built + seeded honestly + shown to resist inflation |

**Residual governance weakness I won't paper over:** machine-resolvability checks the *existence* of an
evidence artifact, not its *validity* (a test can exist and be meaningless; an operator sign-off can be
rubber-stamped). The only real control there is **independent / adversarial assessment** — the registry
reduces inflation surface and makes claims traceable, but it cannot, by itself, guarantee evidence quality.
Human/third-party audit remains load-bearing. Anyone who claims the registry *guarantees* trustworthiness is
committing the very error it's meant to prevent.

---

## 11 · Deliverable summary

1. **Architecture** — evidence → append-only ledger → registry *view* → Mark computation → Aegis report; current state is never a writable cell (§0–1).
2. **Schema** — definitions + append-only ledger + current view + mark_requirements + computed mark view (§2).
3. **Lifecycle** — register(UNKNOWN) → evidence rows → advance/regress → decay → soft-decommission (§3).
4. **Governance** — append-only via published assessment + evidence ref; most-skeptical-wins; logged threshold changes; self-governing (§4, §8, §10).
5. **Mark integration** — requirements = intent; earned status = computed MIN gated by prior Mark; defining ≠ earning (§8).
6. **Assessment integration** — FK to immutable assessments; 001 seeds via crosswalk; append-only history; no new assessment required to stand it up (§7).
7. **Aegis reporting** — answers from views with status + evidence + latest assessment + gaps + blockers; says "unknown/stale" when that's the truth; itself a NOT-PRESENT capability today (§9).

**Why the registry, restated:** it is the only place that answers *"where are we now?"* — but it earns that
authority solely by being a faithful, re-derivable reduction of immutable evidence. It is the index, not the
truth; the pin, not the map. Build it as a view over append-only evidence, and it cannot lie any more than
the evidence does. Build it as an editable table, and it becomes the best inflation machine in the system.
That single architectural choice is the whole design.
