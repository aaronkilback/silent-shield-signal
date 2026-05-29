# ADR — Aegis Decision Layer Doctrine ("Signal → **Decision** → Action")

**Status:** PROPOSED 2026-05-29 — design-only ADR for operator ratification. No code, no prompt changes, no implementation work authorized by this document. Implementation roadmap (phased) is sketched in §11 as a post-ratification artifact, not a commitment. **Locked principle when ratified:** Aegis emits a Decision Frame — not a checklist — for any output that exists to support a principal's decision.

## Problem (formalized — Commander's Intent gap audit 2026-05-29)

The ratified Commander's Intent for Fortress is:

> *"Preserve decision space by shortening Signal → Decision → Action."*

The 2026-05-29 prompt-architecture audit (Task #73) showed the current Aegis assembly is structured as **Signal → Action**, not **Signal → Decision → Action**. The middle phase — the one the active verb of Commander's Intent points at — has zero enforced elements. Per-element scorecard:

| Commander's Intent element | Phase | Enforcement in current prompt |
|---|---|---|
| What changed? | Signal | **ABSENT** (closest: "state the signal clearly" — static, not delta) |
| Why it matters? | Signal | ENFORCED (FORTRESS_CORE_DIRECTIVE Step 3 — "state consequence if ignored") |
| Who should care? | **Decision** | **ABSENT** |
| What decision deserves attention now? | **Decision** | **ABSENT** |
| Recommended action | Action | ENFORCED (FORTRESS_CORE_DIRECTIVE Step 4 — "recommend next action") |

Fulfillment of Commander's Intent under the current prompt: **~37.5%**. The two enforced elements (Why it matters + Recommended action) are precisely what an LLM produces by default from any decent query without retrieval — the prompt enforces what training already gives and is silent on what training does not give. The Q1 prod validation response (2026-05-29, exec-protection scenario) is exactly what this prompt is engineered to produce: a state-the-signal-generically + state-generic-consequence + recommend-tactical-checklist answer, indistinguishable from a generic LLM response without any retrieval at all.

This is now the primary architectural bottleneck. Fixing retrieval relevance (Class A N+1, deployed 2026-05-29) without fixing the Decision Layer yields better-targeted methodology that the model still ignores in favour of its training-data checklist, because the prompt has no decision-articulation requirement for the retrieved methodology to feed into.

The N+1 retrieval cutover validated cleanly on infrastructure axes (items_returned, retrieval_strategy, threshold, Flight Recorder provenance, 0-items-is-valid) but failed on the utilization axis: relevant tradecraft reached the model without changing the response. The decision the validation surfaced is not "improve retrieval again" — it is "define how Fortress transforms information into decisions, then have the retrieval system feed that."

This ADR defines that operating model. It does not implement it.

## Principle (PROPOSED)

Aegis emits a **Decision Frame** for any output whose purpose is to support a principal's decision. The Decision Frame is a five-element artifact, in order:

1. **What changed** — a delta against the principal's working model, not a static signal restatement.
2. **Why it matters** — consequence, exposure, decision-relevance, stakeholder-impact (four sub-questions).
3. **Who should care** — the named **decision owner** + supporting stakeholders + escalation owners. "Human review" is not ownership.
4. **What decision deserves attention now** — a named decision (not an action), with owner, option set (≥2 incompatible options), deadline, commitment cost, and decision-relevant grounded evidence. **The load-bearing element.**
5. **Recommended action** — decision-conditional action sets, one per option in the option set. Actions follow the decision; they do not substitute for it.

**Decision ≠ Action.** This distinction is the load-bearing invariant of this ADR; §7 makes it explicit and operational.

The Decision Frame is the **default output shape** for substantive Aegis responses. Sub-threshold queries (chit-chat, status checks, single-tool result presentation) may bypass the frame; the framework defines a deliberate threshold (§9).

## §1 — What changed?

### Definition

A **change** is a delta in the tenant's threat/operational picture that the principal's prior commitments, posture choices, or working assumptions did not account for. It is the difference between *the world the principal made decisions about* and *the world they are now operating in*.

### Three classes of change

| Class | Definition | Example |
|---|---|---|
| **Status change** | Something true is no longer true (or vice versa). | A previously-monitored entity escalates from `latent` → `active`. A previously-shipped product becomes part of a contested protest target list. |
| **Trend change** | Momentum direction reverses or accelerates beyond the prior baseline. | A monitored group's posting cadence on the principal's company triples in 72h. Crowd-density forecasts for the venue jump from "moderate" to "saturated." |
| **Frame change** | The *meaning* of an existing signal shifts because of new context (here or elsewhere). | A long-tracked activist group's posts re-classify after a connected named-incident in another jurisdiction. A previously-routine protest signature reads differently after a peer organization's recent direct-action event. |

### How Aegis should think about change

Against the **principal's working model**. The principal's working model is what they believed and committed to yesterday. Aegis's job is to identify the *smallest delta* that materially breaks that working model. If nothing materially breaks the working model, surfacing a signal is checklist-mode noise and should be suppressed (or routed to the supporting-stakeholder tier per §3, not the principal).

The threshold for "material" is:
- The delta would, on its own, justify the principal reconsidering at least one prior commitment, **or**
- The delta would, on its own, change which option in the prior option set the principal should now prefer.

If neither is true, the change is not Decision-Layer-relevant. It is monitoring noise.

### Signal vs change (operative distinction)

- **A SIGNAL** is an observation. *"There's a protest planned in Vancouver on Sept 18."*
- **A CHANGE** is a delta. *"As of 72h ago, the protest organizers' messaging shifted from informational to mobilizing, and a peer group ran a direct-action event in Toronto last weekend. Aegis was not aware of either fact when the principal committed to attending in person."*

The signal can be true and still not a change. The change is the delta between *what the signal means now* and *what the principal assumed when they last decided*.

### Examples

| Signal (not enough) | Corresponding change (Decision-Layer-relevant) |
|---|---|
| "Stand.earth posted about Coastal GasLink today." | "Stand.earth's posting cadence on CGL has tripled in 72h, and the framing shifted from informational to mobilization-language." |
| "The CEO is scheduled to attend the September event." | "The September event venue now sits within 200m of the activist coalition's stated assembly point, which was not the case when attendance was committed." |
| "Three high-priority signals near Fort St. John." | "Two of three Fort St. John high-priority signals correlate to the same group's escalation pattern, which previously was attributed to three independent sources." |

## §2 — Why it matters?

### Definition

**Why-it-matters** is the four-axis framing of the change's significance to the principal's decision space.

### Four sub-questions

1. **Consequence** — *What happens if no one acts on this change?* The default outcome, the trajectory, the irreversibility window.
2. **Exposure** — *Which of the principal's assets, people, positions, or planned actions become more reachable / more vulnerable / more contested because of this change?*
3. **Decision relevance** — *Which of the principal's prior commitments or planned actions become reconsider-able in light of this change?* Identify the now-stale decisions.
4. **Stakeholder impact** — *Which roles' duties are triggered by this change?* Duty-of-care, disclosure obligation, posture authority, etc.

### How Aegis should think about it

The four sub-questions are not interchangeable bullet points. Each one feeds a different downstream Decision-Frame slot:

- **Consequence** feeds the *deadline* of the decision in §4.
- **Exposure** feeds the *commitment cost* of the decision in §4.
- **Decision relevance** is what makes a change Decision-Layer-relevant at all (per §1); this is what surfaces the stale decision(s).
- **Stakeholder impact** feeds the *decision owner / supporting stakeholders* identification in §3.

If a change has only consequence but no exposure / decision-relevance / stakeholder-impact, it is informational and may bypass the Decision Frame (it has no live decision to support).

### Examples (using the exec-protection scenario)

| Sub-question | Worked example |
|---|---|
| Consequence | "If unaddressed, the principal's exposure window during the Sept event widens — the protest assembly point and the principal's venue arrival window now overlap, where they did not before." |
| Exposure | "The CEO's planned venue arrival route runs within 200m of the protest's stated assembly point. Family-residence routine and the principal's public schedule are now contested-area-adjacent." |
| Decision relevance | "The decision to attend in person was made under the assumption of peaceful-protest signature. That assumption no longer holds. The decision to publicly pre-announce attendance was made on the same now-stale assumption." |
| Stakeholder impact | "Triggers a duty-of-care question for the board; a messaging-prep question for corporate communications; a posture-authority decision for the security lead; a legal disclosure consideration for general counsel." |

## §3 — Who should care?

### Definition

**Who-should-care** identifies the named human roles whose authority, attention, or duty is triggered by this change. It is **not** the same as "human review" — that is a binary trigger ("a human will look at this"). Ownership identifies *which* human, *what they can decide*, *by when*.

### Three tiers

| Tier | Definition | Cardinality |
|---|---|---|
| **DECISION OWNER** | The one human (or one role) who can change the outcome by choosing among the options. The buck stops here. | **Singular.** No committees. If multiple people must agree, name the chair. |
| **SUPPORTING STAKEHOLDERS** | Those whose work is affected by the decision and who must be informed before / during / after — but who do not own the decision. | One to many. |
| **ESCALATION OWNERS** | Those who must be brought in if (a) the decision is above the decision owner's authority, or (b) the consequence threshold is exceeded. | Zero to many. |

### "Human review" ≠ ownership

The current Aegis prompt and FORTRESS_CORE_DIRECTIVE both reference "flag for human review" (e.g., P1 escalation logic). That is a *trigger*; it does not identify *which human*, *what they can decide*, or *by when*. The Decision Layer requires all three.

Aegis names the decision owner; the operator (or org chart) confirms or overrides. Aegis does not *decide* who decides; Aegis *proposes* based on the nature of the decision and the doctrine in this section.

### Role-tier examples

| Role | Typical position in a Decision Frame | When triggered |
|---|---|---|
| **Principal / Executive** | DECISION OWNER (for posture, attendance, public stance, attendance-with-modifications) | Whenever the decision is about the principal's personal action, exposure, or visibility. |
| **Security Lead (in-house)** | DECISION OWNER (for tactics, posture-given-attendance, route/venue) + SUPPORTING (for posture itself) | The security lead decides *how* once the principal decides *whether*. |
| **Corporate Affairs / Communications** | SUPPORTING (always when public-facing) + DECISION OWNER (for messaging) | Triggered when stakeholder impact includes public framing or media exposure. |
| **Legal / General Counsel** | SUPPORTING (always) + ESCALATION OWNER (for duty-of-care exposure, disclosure obligation, regulatory framing) | Triggered when the decision changes legal posture or creates a disclosure consideration. |
| **CRT Watch Floor** | SUPPORTING (always) — they own continuity-of-watch. **Never DECISION OWNER** — analyst tier, not principal tier. | Notified for any change that crosses pre-set thresholds; they hold the watch, they don't make the principal's decisions. |
| **Family Office** | SUPPORTING (when family is collateral surface) + DECISION OWNER (for family-only protective measures, residence posture, family travel) | Triggered when threat assessment includes the family in the target set. |
| **Operations / COO** | SUPPORTING (always) + DECISION OWNER (for non-security operational responses — site closures, schedule changes, vendor pauses) | Triggered when operational continuity is implicated by the decision. |

Critically: the **Decision Owner is named by role, not by individual**. Aegis does not say "Jane Doe should decide"; Aegis says "the CEO is the decision owner, the security lead supports, legal escalates if X." The operator's org chart maps role → individual.

### Examples (exec-protection scenario)

| Role | Frame appearance |
|---|---|
| Principal (CEO) | DECISION OWNER for attendance / posture / public-announcement decisions |
| Security Lead | DECISION OWNER for tactics-given-attendance; SUPPORTING for the attendance decision itself |
| Corporate Comms | SUPPORTING (any attendance decision changes the announcement plan); DECISION OWNER for the messaging frame |
| Legal / GC | SUPPORTING; ESCALATION OWNER if attendance posture creates a duty-of-care disclosure or shareholder-communications question |
| CRT Watch | SUPPORTING (they will watch the change as it evolves); they do not own the principal's decision |
| Family Office | SUPPORTING (the family's routine is in the contested area); DECISION OWNER for family-only posture decisions |
| Operations | SUPPORTING (no operational decision is the gating one here); could become DECISION OWNER if the principal's option set narrows to "cancel and reschedule the event" |

## §4 — What decision deserves attention now?

**The load-bearing section of this ADR.**

### Definition

A **decision** is a choice between two or more incompatible options that the decision owner has the authority to make, where the difference in outcome between the options is material.

A decision has five attributes:

| Attribute | Description |
|---|---|
| **Owner** | Singular, named by role (§3). |
| **Option set** | ≥2 incompatible options, named explicitly. |
| **Deadline** | Real (event date, public announcement window) or constructed (cost-of-delay threshold). After the deadline, the option set narrows — some options drop. |
| **Commitment cost** | How hard the decision is to reverse once made. High commitment cost = the decision deserves more attention before being made. |
| **Decision-relevant evidence** | The grounded inputs that change which option is correct. (Per Provenance Doctrine, all such evidence carries provenance.) |

### Decision ≠ Action — the operative invariant

This is the most important distinction in this ADR. The current Aegis prompt fails Commander's Intent precisely because it collapses decisions into actions, presenting actions as if they were decisions.

| Decision | Action |
|---|---|
| Belongs to the decision owner | Belongs to the execution chain |
| About **selecting among options** | About **implementing the selected option** |
| Commitment cost is typically high | Commitment cost varies; often lower |
| Frames the principal's exposure | Reduces (or doesn't reduce) the principal's exposure |
| A bad decision can't be fixed by good actions | A bad action can sometimes be redone |
| **Hidden by collapsing to action** | **Revealed by naming the decision it implements** |

#### Worked example (the load-bearing illustration)

| Frame | Output |
|---|---|
| **Action-collapsed (Bad)** | "Increase executive protection for the September event." |
| **Decision-articulated (Better)** | "The decision is **whether the CEO attends the September event in person**. Owner: the CEO. Options: (a) attend in person as planned, (b) attend in person with publicly-unannounced timing/route changes, (c) send a designate and address remotely, (d) cancel attendance. Deadline: ~4 weeks before the event (after which option (c) and (d) cost more to communicate, and option (b)'s preparation window narrows). Commitment cost: high — once attendance is publicly announced, retracting itself becomes a signal." |

The action-collapsed frame presupposes (a) — attendance in person — and reduces the entire decision to a tactical knob ("how much protection"). The decision-articulated frame keeps all four options on the table for the decision owner. **Same change. Same evidence. Completely different decision space.**

This is what "preserve decision space" means operationally: name the decision so the option set stays visible, and the decision owner can choose with the deadline and commitment cost on the table.

### How Aegis identifies the decision

Operating model (not algorithm; not code):

1. **What changed** → identify the delta (§1).
2. **What does that delta invalidate** in the principal's prior commitments? Each invalidated commitment is now a **stale decision** — a decision the principal made that no longer accounts for the world. Each stale decision is a live decision again.
3. **Among the stale decisions, which has the earliest deadline AND the highest commitment cost?** That one is **the decision deserving attention**. (When deadline and commitment cost rank differently across stale decisions, surface both and name the trade-off — but do not pre-collapse.)
4. **Who owns it?** Identify the decision owner from §3.
5. **What is the option set?** Name ≥2 incompatible options explicitly. Aegis does NOT pre-collapse to one.

### How Aegis preserves decision space

The load-bearing principles of this section:

| Principle | Operationalization |
|---|---|
| **Never pre-collapse the option set.** | If two options are still materially live, name both. Even if one is much more likely to be chosen, the decision owner is the one who closes the option set, not Aegis. |
| **Never pre-select on the operator's behalf.** | Aegis may rank options by tradecraft-informed reasoning and provenance-grounded evidence. Aegis does not eliminate options. Ranking ≠ deciding. |
| **Always state the decision deadline explicitly.** | After the deadline, the option set narrows. Bringing attention to the decision *before* the deadline is what preserves the space. A decision frame with no deadline is a frame without preservation. |
| **Always state the commitment cost.** | The principal needs to know what's irreversible. A decision with a low commitment cost can be made and remade; a decision with a high commitment cost deserves the full Decision Frame's attention. |
| **Route below-threshold decisions to the supporting tier, not the principal.** | If a decision is below the principal's attention threshold but above an actionable threshold, surface it to the supporting stakeholder. This **also** preserves the principal's decision space — by not flooding them with sub-threshold decisions. |
| **Make decision space visibility independent of confidence.** | Even when Aegis has high confidence in which option is best, the option set is presented intact. Confidence informs ranking; it does not eliminate options. |

### Examples (exec-protection scenario)

**Stale decisions surfaced by the change:**

1. *Decision to attend in person* — made under peaceful-protest assumption; now stale.
2. *Decision to publicly pre-announce attendance* — made under the same assumption; now stale.
3. *Decision to route the principal's arrival through the standard venue access* — made under the assumption that the assembly point would not overlap; now stale.

**Among these, the earliest-deadline + highest-commitment-cost decision is #1 (attendance posture).** The other two are downstream of #1 and may not even survive if (c) or (d) is chosen.

**Decision Frame for #1:**

| Slot | Value |
|---|---|
| Decision | Whether the CEO attends the September event in person. |
| Owner | The CEO (decision owner); security lead (supporting); corporate comms (supporting + decision-owner for messaging); legal (supporting + escalation if disclosure-triggering); family office (supporting). |
| Options | (a) Attend in person as planned; (b) Attend in person with publicly-unannounced timing / route changes; (c) Send a designate; principal addresses remotely; (d) Cancel attendance. |
| Deadline | ~4 weeks before event (announcement window for (c)/(d) closes; preparation window for (b) narrows). |
| Commitment cost | High — once publicly announced, retracting becomes a signal in itself. (b) is partly reversible until the public timing is fixed. |
| Decision-relevant evidence | [grounded change per §1, with provenance tags] |
| Status | LIVE — deadline approaching, awaits CEO decision. |

## §5 — Recommended action

### Principle

**Actions FLOW FROM decisions. They never substitute for them.**

For each option in the decision's option set, Aegis may surface the **action-set that would follow IF that option is chosen**. These are *decision-conditional action sets* — one action set per option, not one action set for the whole decision.

### Why this matters

Conditional action sets do three things:

1. They let the decision owner see the cost of each option in concrete tactical terms.
2. They avoid the trap of recommending tactics that only apply to one option (which presupposes that option and silently collapses the option set).
3. They keep the decision space open until the decision owner closes it.

### How recommendations support decisions

A recommendation supports a decision when it:

| Supports | Replaces |
|---|---|
| Surfaces the full option set | Pre-collapses to one action |
| Ranks options on grounded evidence (provenance-attached) | Hides the option set behind "the next step is …" |
| Names each option's action-set consequence | Embeds the decision invisibly inside the action |
| Calls out the deadline and commitment cost | Treats the decision as already made |
| Never takes the decision | Takes the decision implicitly |

### Example (exec-protection scenario)

| Option | Decision-conditional action set |
|---|---|
| (a) Attend in person as planned | Crowd-management plan refresh; venue route harden; on-site detail uplift; pre-event coordination with venue security. (Note: this set is the standard EP playbook the model already produces by default. Producing it without naming the decision is exactly the failure mode this ADR closes.) |
| (b) Attend in person, modify announcement | Detail uplift (as in (a)); revised public-announcement plan (corporate comms decision-owner); decoupled timing for arrival; family-routine posture review; pre-event communications-team brief. |
| (c) Send a designate; principal addresses remotely | Designate selection and prep; remote-attendance technical readiness; communications brief for the designate; principal-side residence/family posture review (the principal's known absence from the event creates a different family-attention pattern). |
| (d) Cancel attendance | Cancellation communications plan (corporate comms decision-owner); post-cancellation message control (legal supporting); calendar reuse / event-postponement consideration. |

**The decision owner picks the option. The action set drops automatically from that choice.** Aegis presents all four conditional sets in the Decision Frame; Aegis does not pick.

## §6 — Intelligence Officer Test (worked side-by-side)

Using the actual exec-protection scenario from the prod validation run (2026-05-29).

### Current Aegis answer (verbatim from prod, ai_assistant_messages id `c07152d5-7513-4a75-a498-38afca7c3398`)

> For a CEO attending a high-profile public event in a city with an active protest movement targeting their company, consider the following key factors for executive protection:
>
> 1. **Threat Assessment**: Evaluate the scale and nature of the protest. Determine the sentiment towards the company and the specific risks posed to the CEO.
> 2. **Site Security Assessment**: Conduct a thorough assessment of the event venue …
> 3. **Coordination with Local Law Enforcement** …
> 4. **Advance Planning and Rehearsals** …
> 5. **Crowd Management Strategies** …
> 6. **Personal Security Details** …
> 7. **Contingency Plans** …
> 8. **Situational Awareness and Anomaly Detection** …
>
> Ultimately, the approach should balance proactive measures with flexibility, ensuring the CEO's safety while allowing them to fulfill their public engagement.

**Commander's Intent grade:** ❌ Checklist of execution categories. No what-changed, no who-should-care, no decision identified, no option set, no deadline, no commitment cost. Indistinguishable from a generic LLM response to the same query without retrieval. The decision is *invisible* — the response presupposes (a) "attendance happens" and reduces the entire frame to a tactical-knob set.

### Decision-Layer Aegis answer (hypothetical, structured per this ADR)

> **What changed.** The September event's threat picture has shifted in two material ways since the principal committed to attending: (1) the activist coalition's posting cadence on the company has tripled in 72 hours with messaging moving from informational to mobilization-language, and (2) the coalition's stated assembly point now overlaps the venue's standard arrival corridor within ~200m. *[grounded: signal:…, signal:…]*
>
> **Why it matters.** The decision to attend in person was made under the assumption of a peaceful-protest signature and a separated assembly point. Both of those assumptions are now stale. The exposure delta concentrates in the principal's arrival window. The decision-relevant question is no longer "how do we protect the CEO at the event" — it is whether the prior posture commitment still stands.
>
> **Who should care.** **Decision owner: the CEO** (attendance, posture, public stance). Supporting: security lead (tactics-given-attendance), corporate comms (messaging — and decision-owner for the messaging frame), legal (duty-of-care assessment, escalation owner if the change implicates disclosure obligation). Family office (family-routine posture). CRT watch (continuity, threshold-triggered notification).
>
> **The decision deserving attention now: whether the CEO attends in person.**
>
> | Slot | Value |
> | --- | --- |
> | Owner | The CEO. |
> | Options | (a) Attend in person as planned; (b) Attend in person, modified announcement / arrival timing; (c) Send a designate and address remotely; (d) Cancel. |
> | Deadline | ~4 weeks pre-event — after which (c) and (d) carry rising communications cost and (b)'s preparation window narrows. |
> | Commitment cost | High. Public announcement once made is itself a signal; retraction is itself a signal. |
> | Status | LIVE; awaits CEO decision. |
>
> **What actions become available** *(decision-conditional)*:
> - (a) → standard EP playbook (crowd management, venue route harden, detail uplift, LE coordination).
> - (b) → above, plus revised announcement plan with corp comms, decoupled arrival timing, family-routine posture review.
> - (c) → designate selection + prep, remote-attendance tech readiness, principal/family residence posture (the known absence pattern is its own signal).
> - (d) → cancellation communications plan, message control, event-postponement consideration.
>
> The decision frames the tactical set, not the other way around.

**Commander's Intent grade:** ✅ What changed, why it matters, who should care, decision named with option set and deadline and commitment cost, decision-conditional actions surfaced without pre-collapsing the option set. The principal can decide; Aegis does not decide for them.

### Side-by-side delta — what changes when the Decision phase exists

| Dimension | Current (Signal → Action) | Decision-Layer (Signal → Decision → Action) |
|---|---|---|
| Decision visibility | Hidden inside the recommended action | Named explicitly with owner, options, deadline |
| Option set | Implicitly collapsed to (a) | All four options surfaced; principal closes the set |
| Who decides | Undifferentiated "human" | CEO named as decision owner; supporting/escalation roles named |
| What changed | Restated as static signal | Delta against principal's prior commitments |
| Actions | Recommended as if decision is made | Conditional on each option |
| Information → Decision flow | Information collapses to action | Information frames the decision; decision frames the action |
| Commander's Intent fulfillment | ~37.5% | ≥95% (structurally — modulo grounded evidence quality, which is a separate Provenance/Grounding concern) |

## §7 — Design constraints (preservation contracts)

The Decision Layer must preserve every ratified Fortress doctrine. For each, the contract is named explicitly:

| Doctrine | Preservation contract |
|---|---|
| **Tenant isolation** | All decision-relevant evidence must come from this tenant's certified retrieval surfaces (`CERTIFIED_TENANT_SURFACES`). Cross-tenant evidence flows only through the audited Aegis Ops retrieval seam, never tenant-side. The Decision Frame inherits tenant scope from its evidence; if no grounded tenant evidence is available, the frame collapses to "we don't have a grounded view to support a decision here" (honest absence) — never a fabricated frame. |
| **Provenance Doctrine** | Every claim that informs the decision carries owner/actor provenance per `provenance-contract.md`. The Decision Frame is itself an artifact and must carry provenance (tenant_id, actor, evidence row ids). No bare ownerless decision frames. |
| **Anti-Fabrication Doctrine** | Every factual claim in the decision frame is grounded and cited (`[signal:UUID]`/`[incident:UUID]`/`[entity:UUID]`/`[doc:UUID]`/`[tool:tool_name]`). Option sets that depend on parametric/world knowledge are framed as general method (per Tradecraft separation), not tenant fact. The decision owner identification is role-not-individual, derived from the change's stakeholder impact, not from training. |
| **Grounding-State Doctrine** | The Decision Frame's "What changed" and "Why it matters" sections may contain only grounded claims. "Who should care" and "What decision deserves attention" are *analytical inferences from grounded changes* and inherit the grounding state of the changes they reason from — and must cite. The conditional action sets are general method (allowed as framed-general) unless they reference specific tenant assets, in which case they must ground. |
| **Tradecraft separation (Class A doctrine)** | Tradecraft items are methodology, never evidence. They may inform option-set generation (e.g., "tradecraft pattern: high-profile-exec exposure-windows are typically the publicly-known arrival ones") but cannot substitute for grounded evidence. Tradecraft framing appears in conditional action sets (with the `[TRADECRAFT REFERENCE — methodology, not observation]` label) but never in the decision frame's evidence slots. |
| **Recommendation → Approval → Execution separation (AR / Authority doctrine)** | The Decision Layer sits *before* recommendation. It produces a decision frame; recommendations follow conditional on the decision; approval and execution layers are downstream and unchanged. Naming the decision is NOT taking the decision. Aegis emits frames; the decision owner approves; the execution chain executes. |
| **Flight Recorder observability** | Every decision frame is traceable. A new flight-recorder surface (proposed name: `aegis_decision_frame`) holds frame_id, tenant_id, debug_trace_id, decision_label, owner_role, option_set, deadline, commitment_cost, evidence_row_ids (jsonb), confidence per axis, grounding_state, created_at. Empty frames (honest-absence cases) are recorded too — they are how we measure decision-frame skip rate over time. |
| **Aegis Authority Modes (tenant vs Ops)** | The Decision Frame is a tenant-mode artifact when produced for a tenant principal's decision. An operator-mode (Aegis Ops) Decision Frame is a separate surface — operators decide about platform/cross-tenant questions, not on behalf of a tenant principal. The two never mix. |
| **Commander's Intent itself** | This ADR is the implementation-as-doctrine of Commander's Intent, not a divergence from it. Adopting this ADR raises Commander's Intent fulfillment from ~37.5% (current) toward ≥95% (structurally). Commander's Intent does not change; how Fortress executes it does. |

## §8 — Non-goals

For ratification clarity, the Decision Layer ADR explicitly does NOT do the following:

| Non-goal | Why |
|---|---|
| Take any decision on the principal's behalf. | The decision owner is always a human role; Aegis names the frame, does not close the option set. |
| Replace, change, or subsume any existing doctrine. | All preservation contracts in §7 are additive. The Decision Layer sits between Signal (existing retrieval) and Action (existing recommendation/approval/execution). |
| Define agent dispatch / orchestration / multi-agent behaviour. | This ADR is the **output shape** doctrine, not the **agent-coordination** doctrine. Coordination is governed by other ADRs (`aegis-operational-state-integrity.md`, `aegis-ops-control-plane.md`). |
| Mandate that *every* Aegis output is a Decision Frame. | Sub-threshold queries (chit-chat, simple tool-result presentation, status checks) bypass the frame. The threshold is defined operationally in §9. |
| Specify the prompt design that implements this. | Prompt design is an implementation question, post-ratification, and lives outside this ADR. |
| Specify the UI / surface design for displaying Decision Frames. | UI design is post-ratification, separate artifact. |
| Commit to an implementation timeline. | This ADR is design only; implementation is gated on ratification and a separate roadmap (sketched §11 without commitment). |
| Compete with FORTRESS_CORE_DIRECTIVE's Response Format Discipline. | The Decision Frame *replaces* the Response Format Discipline's 5-step format for substantive principal-facing outputs. The 5-step format then becomes the sub-Decision-Frame default (the "signal + consequence + action" shape) for sub-threshold outputs. This is a layered improvement, not a contradiction. |

## §9 — When does Aegis produce a Decision Frame? (Threshold)

Aegis produces a Decision Frame when **all three** of the following are true:

| Condition | Description |
|---|---|
| **C1 — Change is present** | The query/event implicates a delta against the principal's working model per §1. (Not just a signal; a change.) If the query is "what's the weather Tuesday," there is no change — no frame. |
| **C2 — Stake is principal-level** | The change implicates the principal's commitments, posture, exposure, or duty-of-care position. If the change is purely tactical and below the principal's attention threshold, the frame routes to the supporting stakeholder (not the principal). |
| **C3 — A live decision exists** | At least one prior commitment has been invalidated by the change *and* the deadline has not yet passed. If the deadline has passed, the frame is retrospective (post-mortem); the live-decision path skipped. |

Outputs that fail any of C1/C2/C3 fall back to the **sub-Decision-Frame default**: the FORTRESS_CORE_DIRECTIVE 5-step Response Format Discipline (signal → confidence → consequence → action → outcome). That format is preserved for sub-threshold outputs.

This threshold is also what makes the Decision Layer additive rather than disruptive: trivial outputs are unchanged; only substantive principal-facing outputs change shape.

## §10 — Open questions for ratification

These are intentionally open and require operator ratification before implementation. They are not blockers to ratifying the ADR's principles; they are scoped questions to resolve in the post-ratification phase.

| # | Open question |
|---|---|
| Q1 | Should the Decision Frame be the **default** for tenant-mode Aegis outputs, with sub-threshold queries opting *out* — or the **opt-in** shape with substantive queries opting *in*? (Recommendation: default + threshold-driven opt-out, per §9 — but operator confirms.) |
| Q2 | Does the operator want a **distinct Decision Frame surface in the UI** (a structured artifact the user interacts with — accept option, reject option, defer), or is the Decision Frame rendered as prose within the chat surface? (UI design is post-ratification but the answer here gates the next layer.) |
| Q3 | When the change is below the principal's threshold but actionable, **how is "route to supporting stakeholder" implemented**? Today: out-of-scope (no in-band routing surface). Likely: a separate Aegis-Ops-style stakeholder channel — but this is a real new surface to design. |
| Q4 | Should the Decision Frame **propose** the decision owner, or **require operator/org-chart configuration** to confirm? (Recommendation: propose-by-role per §3; org-chart maps role → individual; operator can override the role-mapping. But this needs ratification.) |
| Q5 | **How is decision-frame state managed across turns?** A decision frame produced in turn 1 — does Aegis remember it in turn 3? Does the principal's decision in turn 5 update the frame's `status`? (This is the meta-decision state ADR — separate, follows ratification of this one.) |
| Q6 | **What is the relationship between Decision Frames and incidents?** A decision frame can be (a) standalone, (b) attached to an incident, (c) generated *by* an incident. Each has different lifecycle implications. |
| Q7 | **What's the explicit refusal posture when Aegis has no grounded tenant evidence to support a Decision Frame?** Likely answer per Grounding Doctrine: refuse with honest absence — "Insufficient grounded tenant evidence to support a decision frame for this question." But the refusal language deserves design. |

## §11 — Post-ratification implementation roadmap (sketch, non-commitment)

If and only if this ADR is ratified, implementation work would follow this phased sequence. **Nothing in this section is authorized by this ADR.** This is included so the operator can see the implementation surface before deciding whether to ratify.

| Phase | Scope | Gate |
|---|---|---|
| **R1 — Threshold detection layer** | Implement C1/C2/C3 detection at the prompt-assembly seam (does this query/turn produce a Decision Frame?). Falls back to current FORTRESS_CORE_DIRECTIVE for sub-threshold. | Ratification + Q1 resolved. |
| **R2 — Decision Frame prompt-assembly** | New prompt block that the model fills in as a structured artifact. Tradecraft retrieval feeds option-set generation; tenant retrieval feeds evidence slots; provenance is attached. | R1 green; Q4 resolved. |
| **R3 — Flight Recorder `aegis_decision_frame` surface** | New table + insert at frame-emit. Observability for "frames produced," "frames empty," "frames overridden by operator." | R2 green. |
| **R4 — UI surface (separate ADR)** | If Q2 → "structured artifact," design the interactive frame component. If Q2 → "prose," skip. | R3 green; Q2 resolved. |
| **R5 — Decision-frame state across turns (separate ADR)** | The meta-decision-state ADR (Q5). | R3/R4 green. |
| **R6 — Stakeholder routing channel (separate ADR)** | The "route to supporting stakeholder" surface (Q3). | R5 green. |

Each phase is its own ratifiable ADR. R1–R3 are the irreducible core of the Decision Layer. R4–R6 are extensions.

## Success criterion (operator-stated, copied here for the locked criterion)

**Aegis should help the right decision owner understand:**

1. What changed
2. Why it matters
3. Who should care
4. What decision deserves attention now
5. What actions become available

**before any implementation work begins.**

This ADR defines what those five elements *are* and how they operate. Implementation follows ratification. Until ratified, the current Signal → Action prompt continues to produce ~37.5%-Commander's-Intent-fulfillment outputs. That is the operating baseline this ADR is designed to replace.

## Held

- P5 / P6 / Class B / PR #36 — all explicitly held per standing operator directive.
- This ADR does not unblock or modify any of the above.
