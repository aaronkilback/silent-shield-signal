# WO-AGENT-FIRST-GOVERNANCE — an agent works the queues; a human decides what a client is (SCOPE, do not build)

**The finding underneath the whole 2026-08-10 session:** every control Fortress built assumes a human opens a queue, and nobody does.
- Entity review gate (`entity_suggestions` + EntitySuggestionsPanel): **55 approvals ever, dormant since 2026-06-15**; 5,831 pending at session start.
- `entity_watch_list`: **0 rows** (purpose-built, never used).
- `containment_registry`: 29 rows, **no review dates**; the legal hold wasn't even in it.
- **971 rules pending**; suggestion queue re-inflating faster than review.

A queue is a promise that a human will look. Unopened, it is the [[feedback_no_unauditable_gates]] / [[feedback_untracked_containment_becomes_permanent]] pattern at scale — controls that exist on paper and are absent in practice ([[feedback_cheap_proxy_for_expensive_correct_signal]], instances 6–7). **The missing component is the CONSUMER.** AEGIS-first supplies it: an agent works the queues and escalates only what needs a human decision.

## The trap this scope exists to design around
**An agent that auto-approves is the same defect as extraction writing directly to `entities` — a machine deciding what a client IS, with no human in the path.** Replacing a queue nobody checks with an agent nobody checks is not an improvement; it just moves the unchecked control. Two invariants fall out, and everything below serves them:

- **I-1 (subtract, don't assert):** the agent's authority is bounded by **consequence and reversibility, not confidence.** It may SUBTRACT noise (reject / dedupe / merge) and ROUTE decisions (escalate). It may **never ADD a client-defining assertion** (approve a person, change client identity/config). Confidence never buys more authority ([[feedback_confidence_is_not_correctness]]).
- **I-2 (the agent is itself a watched control):** the agent's own decisions are spot-checked by the operator on a bounded cadence — else the agent becomes the 8th instance of the unchecked-control pattern. An agent whose rejections nobody samples is a queue nobody opens.

## 1. What the agent MAY decide alone (SUBTRACTION + deterministic only)
Deterministic rules first; LLM used only to *route* (§decide-vs-escalate), never to *decide* an action here.
- **Auto-reject obvious non-entities** — the shipped deterministic guard (domains/URLs/files/handles), extended with: type-mismatch (a place/org/event mislabelled `type='person'` via gazetteer / known-org / event-pattern), generic-noun fragments ("rail company", "cooking group", "Being Held"), and known-noise lists (national politicians, sports figures/teams) — the 763 `signal`-sourced person noise this session characterized.
- **Deterministic dedupe** — collapse duplicate pending suggestions by `(normalized_name, type, client)` (shipped).
- **Deterministic merges** — merge clearly-fragmented duplicate *entities* only on exact/normalized-name + same-type + same-client (e.g. LNG Canada ×5). **Any fuzzy merge escalates.**
- **Hard rule:** every agent-alone action is **reversible** (status flip + agent attribution, never a destructive delete) and **non-client-defining**. If an action would assert or alter what a client is, it is not in this set.

## 2. What MUST always escalate (never agent-decided, in EITHER direction)
- **Any person-entity APPROVAL** — a named individual becoming a client subject. (Approval is always human. The agent may propose, never confirm.)
- **Anything touching client identity or configuration** — keywords, competitor list, high-value assets, locations, monitoring config, `is_internal`, tenant scope.
- **Sensitive class — escalate regardless of direction (approve OR reject):** activists, journalists, Indigenous leaders, investigation subjects, minors, special-category data (ethnicity/nationality), legal-hold-adjacent. Rejecting a sensitive subject is also a consequential decision — the agent flags and routes, it does not quietly drop them. (This session's 38 `auto_enrichment` persons — Wet'suwet'en chiefs, Gidimt'en coordinators — are the archetype; ties to [[WO-SUBJECT-GATE-01]] and the INC-AITOOLS legal-hold class.)
- **Anything under a legal hold or in a contained state.**
- **Anything the agent is not confident about** — low confidence is a *necessary* escalation trigger; high confidence is *not sufficient* to authorize action beyond §1. Uncertain ⇒ escalate (fail toward the human).
- **Suspected-but-unclassified sensitivity** — if the agent thinks something *might* be sensitive, it escalates. False-escalation is cheap; false-auto-action on a sensitive subject is not.

## 3. How escalation reaches the operator (attention-first — NOT another queue)
Governed by the attention doctrine's four tiers ([[feedback_protect_attention_like_critical_infrastructure]]): most agent work is LOG; escalations are NOTIFICATION or INTERRUPTION, nothing in between silently accrues.
- **Arrives where the operator already looks** — the existing critical **SMS** channel and the existing **daily digest** (the ones the operator did NOT mute). No new surface, no new queue.
- **INTERRUPTION (SMS):** only genuinely time-sensitive/high-consequence — a sensitive subject about to surface client-facing, a proposed client-config change, a legal-hold interaction. Rare by design.
- **NOTIFICATION (daily digest):** a **HARD CAP of a handful (≤7) decision items**, ranked by consequence. **The cap is load-bearing:** "if escalation volume exceeds what I will actually read, the threshold is wrong." Exceeding the cap is itself a **surfaced finding** ("N items over cap — thresholds may be miscalibrated"), never a silent overflow; the overflow stays for a batch-review session, never dropped.
- **Batch escalation:** where many similar items need one decision, escalate as ONE digest item with a batch action (reuse `entity_suggestion_batches()` / `approve_entity_suggestion_batch()`), not N items — "38 CGL-adjacent persons: review as a batch."
- **Volume is a measured invariant** ([[feedback_measurability_is_part_of_the_feature]]): escalations/day, cap-breaches/week, and agent-decided:escalated ratio are tracked; a rising escalation rate means the agent is deciding too little (or a real surge) and is a tuning signal, not a silent backlog.

## 4. Auditability (every agent decision recorded — and the agent itself watched)
- **Append-only decision log** — every agent action (reject/dedupe/merge/escalate) records: subject, action, **basis** (the exact rule or the escalation reason), inputs, confidence, `actor='aegis-governance-agent'`, `decided_by` (agent vs the human who resolved an escalation), timestamp, and outcome. Same shape as the `signal_client_attributions` append-only ledger; nothing destructive ([[feedback_no_unauditable_gates]]).
- **Reversible by construction** — an agent auto-reject is a status flip with attribution; an operator can resurrect any agent decision. The agent never deletes.
- **I-2 made concrete — the agent-audit spot-check:** on a bounded cadence (e.g. weekly) a small **sampled** set of the agent's *auto-decisions* is surfaced in the digest ("agent rejected 800 this week; here are 10 sampled rejects — any wrong?"). Measured false-reject rate feeds threshold tuning. This is the consumer of the agent, the point where the recursion of "who checks the checker" terminates in a capped human spot-check.
- **Historical validation before trust** ([[feedback_automation_requires_historical_validation]], [[feedback_measure_before_and_after]]): before any auto-action ships, replay the agent's decisions against a labelled sample — this session's batch analysis is ready ground truth (763 reject / 58 review). Prove reject precision + false-reject rate first.

## Sequencing (gated — do not skip)
1. **Shadow mode** — agent decides, decisions are LOGGED not applied; operator reviews the shadow log. (Same shadow-first discipline as the semantic leg.)
2. **Historical validation** — replay vs the labelled batches; measure false-reject rate; set thresholds.
3. **Enable SUBTRACTION** — auto-reject/dedupe/merge go live (reversible, audited).
4. **Wire ESCALATION** — SMS + capped digest + batch items.
5. **Agent-audit spot-check live** — the weekly sample (I-2). Only now is the agent a *watched* control.
- **Never in scope:** agent approval of persons, agent client-config changes, agent lifting holds, agent auto-action on the sensitive class, gating any action on confidence alone.

## Success criterion (not "queues cleared")
Per [[feedback_decision_frame_success_criterion]]: success is **"the operator reaches the correct decisions faster, with less noise, and no client-defining assertion is ever made without a human."** A version that empties the queue by auto-approving persons is a *regression*, not a win — it is the exact defect this WO exists to prevent. The agent's job is to make the ≤7 things that reach the operator be the *right* 7.

## Ready-made pieces to compose (already shipped this session)
Propose-time non-entity guard · dedupe-collapse + `entity_suggestion_batches()`/`approve_entity_suggestion_batch()` · `signal_client_attributions` append-only ledger + `attribution_type` · `containment_registry` + `containment_stale_check()` + agent-sentinel Probe 2g · the deterministic matcher (`shadow-matcher`) · the batch ground-truth labels. The agent orchestrates these deterministic tools; the LLM only routes decide-vs-escalate.

**SCOPE only. Do not build.** Recorded 2026-08-10. Capstone of the entity-governance thread ([[WO-ENTITY-EXTRACTION-POLLUTION]], [[WO-SUBJECT-GATE-01]]).
