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
- **I-2 (the agent is itself a watched control):** the agent's own decisions are spot-checked by the operator on a bounded cadence — else the agent becomes the 8th instance of the unchecked-control pattern. An agent whose rejections nobody samples is a queue nobody opens. **The spot-check rides the same daily digest (one of the 7 slots) — not a separate surface**, so watching the agent depends only on the single floor the operator already reads (§3).

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

## 3. How escalation reaches the operator (operator ruling 2026-08-10 — the DIGEST is the floor)
Governed by the attention doctrine's four tiers ([[feedback_protect_attention_like_critical_infrastructure]]): most agent work is LOG; the daily digest is the single NOTIFICATION surface; SMS is INTERRUPTION and stays reserved.

- **The floor is the DIGEST, not the SMS** (operator ruling). **SMS stays exactly what it is** — near-zero volume, **security-exposure only**, the thing that wakes the operator. **Governance escalation does NOT go to SMS** — put it there and it stops being rare, the operator mutes it, and that is precisely the prior failure. The one exception is §read-liveness below.
- **ONE daily digest, hard cap 7, carrying EVERYTHING** — escalations + the agent-audit sample (I-2) + containment reviews due ([[containment_stale_check]]) + anything else governance needs the operator to see. A single bounded surface, not one-per-subsystem.
- **Overflow is the top item.** If more than 7 things qualify, the digest does not grow — **the overflow itself is item #1** ("N items over cap — thresholds miscalibrated / surge in progress"), and the remainder waits for a batch-review session. Never a silent spill.
- **Read-liveness — the one place governance failure becomes an alert.** If the digest goes **unread 3 consecutive days, that is a finding; on the 4th day it escalates to SMS.** The SMS does **not** carry the content — it carries the *fact that the operator stopped reading.* This is a dead-man's-switch on the human, not on the queue: the failure mode being guarded is "the operator drifted away from the floor," which no amount of content-routing detects.
- **The cap is immutable by rule.** **Nothing may be added to the digest later without removing something.** A cap that grows is a cap that fails — the moment "just one more section" is allowed, the digest becomes the unread queue it replaced. Any future governance output competes for one of the 7 slots or does not appear.
- **Batch escalation:** many similar items → ONE digest item with a batch action (reuse `entity_suggestion_batches()` / `approve_entity_suggestion_batch()`), not N — "38 CGL-adjacent persons: review as a batch" is one slot.
- **Volume is a measured invariant** ([[feedback_measurability_is_part_of_the_feature]]): escalations/day, cap-breaches, unread-streak, and agent-decided:escalated ratio are tracked; a rising escalation rate means the agent is deciding too little (or a real surge) — a tuning signal, never a silent backlog.

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

## The digest ALREADY EXISTS — it is `send-daily-briefing`. It needs three fixes, not a build (operator 2026-08-10)
The daily briefing IS the digest this WO describes. It does not need building — it needs the cap, the escalation content, and a reader it is actually written for. Three diagnosed defects:

### Defect 1 — it tasks roles that do not exist (write it for the actual reader: one operator)
`send-daily-briefing/index.ts:253` **instructs the model to task an org chart:** *"every recommendation must include a named owner role (e.g., Security Operations, Physical Security Lead, Intelligence Analyst) and a specific timeframe."* There is no analyst and no operations lead — the RECOMMENDED POSTURE section issues orders to seats nobody occupies, so nobody does any of it and the section is decoration.
- **Fix:** rewrite the prompt for **one operator**. Every recommendation must be **something the operator can do himself**, or the section must **say plainly that no action is possible with current staffing** — never a task to a phantom role. Honest "no action available" beats a decorative order ([[feedback_no_fake_success]] / receipts-not-"Done").

### Defect 2 — it missed the two things that mattered (ranking-by-relevance, and no governance channel)
Two misses on 2026-08-10, both structural:
- **The household evacuation Order (4.3 km from the operator's children's school) did NOT surface — and it was NOT a scoping miss.** Kilbacks IS an active client and IS in the digest's `activeClientIds`; the signal exists, is `active`, and is `severity=critical` (*"An evacuation order is active within 30 km of Kilbacks"*). **It was buried by RANKING.** The briefing filters on `relevance_score ≥ 0.4` / `quality_score ≥ 0.4` (L100–102) and selects the top slice **by relevance, not severity**. The critical Order scored `relevance_score = 0.4` (geo/proximity signals score low on *keyword* relevance) — it sat at the filter floor and was outranked by a higher-relevance provincewide state-of-emergency. Compounding: the highest-relevance Kilbacks wildfire framings (0.9, 0.6) were `quarantined` and dropped. **Net: a critical, proximity-verified, life-safety Order was deprioritized by a keyword-relevance proxy while generic provincewide news surfaced.** This is the recurring cheap-proxy defect again — *relevance-as-proxy-for-urgency*, severity/proximity not the selection key ([[feedback_cheap_proxy_for_expensive_correct_signal]]; sibling of the ingest-signal severity downgrade). **Fix: severity + authoritative-source + proximity must outrank relevance in selection — a `critical` proximity/authoritative signal is never filtered out or outranked by a higher-relevance news item. Relevance breaks ties; it does not gate life-safety.**
- **The legal hold (805 records, unreviewed 11 days) was absent because the briefing has NO governance channel.** `send-daily-briefing` reads only `signals`/`incidents`/`beliefs`/`agent_actions` — grep for `platform_findings`/`containment`/`legal_hold` returns nothing. Governance state (legal hold, stale containments via `containment_stale_check()`, the 971 pending rules, the agent-audit sample) is structurally not in the digest. **This is the "escalation content" §3 requires: the digest must carry governance items, not only signal intelligence.** They compete for the same 7 slots.

### Defect 3 — keep the trajectory caveat exactly as it is
`send-daily-briefing:196` — *"303 → 11 … part of the drop may be a coverage gap rather than real de-escalation"* — is the most honest line in the email and is [[feedback_default_to_historical_when_unknown]] / measurement-honesty working. **Do not touch it.** It is the model of how every claim in the digest should be hedged.

### So the digest work is: cap it (§3), fill it (governance content + severity-first selection, Defect 2), and aim it (one operator, Defect 1). All three are edits to `send-daily-briefing`, gated behind the roadmap position below.

## The honest limit (operator ruling 2026-08-10 — record it plainly)
**No design removes the human floor.** This architecture can make the floor **small, bounded, and hard to ignore** — one daily digest, 7 items, a read-liveness alarm on the fourth unread day. It **cannot make it zero.** If the operator stops reading the 7-item digest, the system will drift: the agent's subtraction goes unaudited, escalations go undecided, containments ossify. **When that happens the correct response is to SAY SO PLAINLY — "the floor is not being read; governance is drifting" — not to build another layer.** Another layer is another queue nobody opens; it moves the floor, it does not remove it. The read-liveness SMS is the last honest signal, and after it there is no further automation to add — only the truth that a human stopped looking. This WO is designed to make ignoring the floor loud; it does not pretend the floor can be abolished.

## Position in the roadmap (operator sequencing 2026-08-10)
**Build toward this, not today.** It sits BEHIND, in order: **(1) Phase 3 cutover completion · (2) the semantic recall layer ([[project_geo_anchoring_evidence_found_on_ourselves]] / the shadow semantic leg) · (3) the PECL geo rollout.** Sequence it after those three; leave it scoped until then. The pieces it composes keep accruing in the meantime (each shipped control is a tool this agent will orchestrate), so the interim is not idle — but the agent itself waits its turn.

**SCOPE only. Do not build.** Recorded 2026-08-10. Capstone of the entity-governance thread ([[WO-ENTITY-EXTRACTION-POLLUTION]], [[WO-SUBJECT-GATE-01]]).
