# FORTRESS VISION UPDATE — July 9, 2026

Status: Strategic context for Claude Code. Read alongside FORTRESS_INTELLIGENCE_ARCHITECTURE.md and FORTRESS_ACCEPTANCE_CRITERIA.md. This document sets priorities and rationale. It does not override the standing rules. All standing rules remain in force, including one fix at a time, simplify by default, and nothing marked done without pasted proof.

## Why this update exists

The July 2026 market environment validated the Fortress thesis from three directions. The US government's conditions for returning Claude Fable 5 to service (targeted classifiers, 24/7 monitoring, duty to report, privileged early access) mirror the posture Fortress already provides principals. Industry consensus is forming that governance must be real-time, adaptive, and data-driven, which is what Fortress is. And enterprise buyers are being actively taught (Palantir's public positioning) to interrogate AI vendors on data ownership, prompt security, and learning loop ownership. Buyers, channel partners, and eventual acquirers will now ask questions Fortress must be able to answer in writing.

## Vision statement, restated

Fortress is exponential governance for principals. Static governance is the annual review and the compliance binder. Fortress is a live intelligence loop: continuous signal ingestion, adaptive client-aware relevance scoring, real-time escalation, and reportable reasoning. The durable moat is accumulated operational memory, the signal-to-decision-to-outcome flywheel, owned structurally by Silent Shield and the client because the feedback loop writes to our schema, not to any model provider's weights.

Two named principles now formalized:

1. **Reportable reasoning.** AEGIS never delivers a conclusion without the signal trail that produced it. Mandatory citations, reasoning_log, confidence scores. This is a differentiator, not overhead.
2. **The interpretability tax is paid deliberately.** Output that is slower and costlier in exchange for verifiability is the correct trade. Principals buy trust, not compression.

## Priority sequence

### Priority 1 — Governance and data handling one-pager (new)

A single client-facing document answering:

- What data leaves Fortress in model API calls, by workflow. Inventory every edge function that sends client data to an external model API. Classify what is sent (raw signal text, investigation content, client asset data, PII).
- Retention and training terms for each model provider currently in use. Verify current terms, do not assume.
- Learning loop ownership. The accumulated intelligence (client_risk_categories, source reliability history, outcome data) lives in the Fortress database. State this precisely.
- Model provider failover. Which functions call which model, and the fallback routing if a provider goes offline for an extended period. The Fable 5 outage (June 12 to July 1) is the proof case that this risk is real. The GEMINI_API_KEY legacy bug is the internal proof case.
- Duty-to-report posture. Define in writing what Silent Shield does if AEGIS detects malicious activity in a client environment. Feed this into the Silent Shield TOS and the CRT terms alongside data handling and the AI disclaimer.

Deliverable: one markdown source document in the repo, exportable to client-facing format. This is a sales and due-diligence asset, and it is prerequisite material for counsel review of the CRT terms.

### Priority 2 — WO-DATA-INTEGRITY (existing, elevated)

Investigation and tenant files lacking resolvable tenant links in the DB is an attribution and access control failure, the same failure class the industry is wrestling with at the identity layer. It blocks the CRT investigations pilot and undermines any claim made in the Priority 1 document about controlled data flows. You cannot control what leaves the building if linkage is broken inside it. Fix and verify per standing rules before pilot work proceeds.

### Priority 3 — Model failover map (new, small)

An explicit routing document: function to model to fallback. Likely mostly documentation of what exists plus deliberate fallback choices for the highest-value workflows (executive report, Gate 3 scoring, AEGIS chat). Output feeds Priority 1.

## Validated by outside events, no action required

- **Separate axes over wide buffers.** Frontier labs are defending against jailbreaks by widening semantic buffers, causing over-suppression of legitimate queries. Gate 3's design keeping quality and relevance as separate scoring axes, validated by the shadow-validation catches (activism over-suppression, Wet'suwet'en silent-drop), is the correct architecture. Do not consolidate the axes.
- **Models policing models.** WRAITH's architecture matches the industry's emerging answer to AI oversight. The parked WRAITH improvement list stands, with the injection-log-to-source-credibility feedback loop as the first item when capacity allows.

## Roadmap notes, parked

- **Private-cloud AEGIS tier.** Open-weight models (Nemotron class) make a locally hosted or private-cloud inference tier plausible for buyers who will not tolerate prompts leaving their perimeter. Not a current build. Record as a Phase 5 option in the architecture doc. Model-agnostic intelligence layer also strengthens the exit story.
- **Trust score surfacing.** The market vocabulary for AI trust metrics is forming. The ingredients exist (Bayesian confidence, source reliability, reasoning_log). Surfacing a single visible confidence indicator on AEGIS conclusions is a candidate feature after Phases 2 and 3 of the architecture plan, not before.
- **Threat taxonomy evolution.** East-West AI divergence implies supply chain, IP theft, and state-adjacent signals gain weight for energy clients. Gate 3's client_risk_categories schema absorbs this as category updates when client needs surface it.

## Explicitly not doing

- No on-prem inference build at current scale (25 principal cap).
- No new features ahead of Priorities 1 through 3. Simplify by default stands.
- No architecture changes motivated by this document. It sets context and sequence, not design.
