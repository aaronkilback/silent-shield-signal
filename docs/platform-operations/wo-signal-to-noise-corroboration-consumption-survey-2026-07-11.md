# Task #221 — Corroboration-Consumption Survey (read-only)

**Status:** read-only survey deliverable, 2026-07-11. No build. Sibling to and higher priority than Task #217 (decision-candidate over-creation gate). Doctrine: `feedback_generators_must_consume_adjacent_evidence.md` ratified 2026-07-11.

The doctrine: **any generator that self-assesses `confidence` / `corroboration` / `severity` / `certainty` / `unknowns` / `evidence` must first read the tenant's adjacent evidence — otherwise its self-assessment is structurally wrong and downstream gates operate on invalid input.**

Adjacent evidence = one or more of:
- `entity_mentions` for the client/entity in a recency window
- `agent_actions_awaiting_approval` on same client/entity (prior severity corrections)
- `incidents` on same entity (open incident context)
- related signals in a recency window (corroborating events)

## Survey — six generators audited

| Generator | Emits | Reads adjacent evidence? | Evidence types read | Gap |
|---|---|---|---|---|
| **`ai-decision-engine`** (`supabase/functions/ai-decision-engine/index.ts` L351–982) | confidence, threat_level, incident_priority, reasoning, strategic_context | PARTIAL | recent_signals (30-day, same client), entity contradictions. Investigation phase (tool-based) reads historical via AEGIS-CMD. | Investigation phase is optional / fire-and-forget. Composite score computed AFTER AI decision. Does NOT query `agent_actions_awaiting_approval` (prior severity corrections) or `entity_mentions` recency before the confidence assignment. |
| **`review-signal-agent`** (TIER2-REVIEW, L108–350) | confidence_delta, verdict, reasoning | YES (best in class) | context_signals (30-day same client + entity), active_incidents (same client). Investigation phase awaited (not fire-and-forget) with historical_signals + entity_relationships + prior_reasoning + specialist_consult. | Investigation phase is conditionally guarded by confidence thresholds — agent CAN reach verdict on `signal_agent_analyses` context alone without ever calling tools. Verdicts on that fast-path miss `agent_actions_awaiting_approval` and `entity_mentions` reads. |
| **`generate-executive-report`** (L39–850) | confidence (aggregate), evidence per source, reasoning | PARTIAL | signals (severity/recency filtered), incidents (with classification_rationale), `agent_beliefs` (confidence ≥ 0.60). | Does NOT read `agent_actions_awaiting_approval` (operator-approved severity corrections on same client). Operator directive 2026-05-29 disabled several context injections to prevent methodology-as-evidence; that fix disabled the wrong thing — belief/knowledge stores were the risk, not adjacent-action reads. |
| **`generate-poi-report`** (L464–880) | confidence_score (via `scoreClaim`/`aegis-confidence.ts`), threat_level, reasoning | PARTIAL | signals mentioning entity, `signal_agent_analyses`, incident_mentions (via `entity_mentions` + incidents join), entity watch list. Claim-frame confidence per Workstream D. | Does NOT read `agent_actions_awaiting_approval` for the same entity (prior operator severity decisions). Confidence delegated to `aegis-confidence.ts` scoreClaim helper, which wraps validation_state, not signal-corroboration. |
| **`generate-daily-briefing`** (L70–260) | confidence (implicit in ranking), reasoning | PARTIAL | recent signals (N-day same client), active incidents, `agent_beliefs` (confidence ≥ 0.70), `multi_agent_debate_syntheses`. | Does NOT read `agent_actions_awaiting_approval` (operator-approved severity corrections). Signals displayed as-is; no confidence re-assessment from adjacent evidence. |
| **`agent-chat` create paths** (`create_signal`, `create_entity`, `suggest_entity` L1851–1909) | severity (default 'medium' or arg), confidence (hardcoded 0.75 for suggest_entity), risk_level | **NO** | none | **CRITICAL GAP.** No reads of `entity_mentions`, `agent_actions_awaiting_approval`, incidents, or related signals before write. `suggest_entity` writes `confidence=0.75` regardless of entity history. Severity is pass-through user input, not grounded. HIGHEST-VOLUME REMEDIATION TARGET. |

## Remediation punch list — priority ordered

### P1 (highest volume + impact) — agent-chat create paths
The path emits severity/confidence/risk_level with zero adjacent-evidence reads on three artifact types (signal, entity, entity-suggestion). Estimated footprint: ~1,500 signals/quarter created via agent-chat at default 'medium', many for high-value entities already under investigation. Fix: before write, query `agent_actions_awaiting_approval` for same client + entity, `entity_mentions` recency, open `incidents` on the entity, related signals in the last 30d. Set severity/confidence based on the retrieved corroboration. Doctrine memory: `feedback_generators_must_consume_adjacent_evidence.md`.

### P2 (structural upstream gate) — ai-decision-engine
Composite confidence is computed AFTER the AI call, not before. Investigation phase is optional. Fix shape: **move `recent_signals + entity_mentions + open_incidents` reads BEFORE the AI call**; construct explicit corroboration_evidence frame; pass to AI as gate input, not context-only reference. Make investigation phase awaited/required for pageable outputs.

### P3 (workstream D integration) — generate-poi-report
`scoreClaim` and `aegis-confidence.ts` compute confidence from validation_state alone. Fix: include `agent_actions_awaiting_approval` for same entity as a confidence contributor. Rule: prior open severity correction on entity → boost; dismissed / downgraded → penalize.

### P4 — review-signal-agent (TIER2-REVIEW)
Investigation phase is awaited (good) but conditionally guarded. Fix: for Tier 2 verdicts on pageable-tier signals (interruption / notification per four-tier doctrine), make investigation tools MANDATORY — no shortcut through analyses-only context.

### P5 — report generators (executive + daily briefing)
Both read signals + incidents but miss `agent_actions_awaiting_approval`. Fix: inject "known operator corrections" anchor into report context (action_type='propose_severity_correction' AND status='approved' AND client_id=this-client-id AND created_at within report window).

## Case studies validated during the audit

Five instances of this defect class documented during Task #215 disposition:

1. **Petronas Malaysian-brand FPs** — GitHub credential matcher does substring on "petronas" without discrimination. HIGHEST-VOLUME future FP generator. Fix: require PECL-context corroboration (Petronas Canada / PECL / North Montney / LNG Canada / progress energy) or geographic relevance.
2. **easylist "lack of corroboration + default to critical"** — agent self-declared no corroboration and escalated to critical anyway. Verbatim defect.
3. **Coastal GasLink 4x-minting** — one positive-news event produced 4 signal rows + 4 correction actions. No dedup at write-side.
4. **`0bfb95d6` "Conflicting historical + lack of corroboration → default medium"** — agent explicitly noted uncertainty but proposed medium anyway.
5. **Fixture-generator bypass** — propose_severity_correction fired on `_benchmark_petronas` (is_test=true, status=inactive) despite fixture flag at client level. **Pattern statement (operator ratified 2026-07-11):** *the is_test flag is only as good as the generators that read it — every generator needs the same exclusion check the retrieval layer got.*

## Structural root cause

Every audited generator was built BEFORE the doctrine was ratified (2026-07-11). Generators emit confidence/severity as a proxy for "are we sure this matters?" but **without reading what the operator already told Fortress via prior corrections or incident context**. The doctrine names the pattern; each remediation is a specific application of the pattern to a specific writer.

## Open questions for operator ruling before any build

1. **P1 (agent-chat) — bundle with existing Task #18 hardening** (which already covered `create_signal` / `create_entity` / `suggest_entity` under WO-DATA-INTEGRITY), or new PR that layers adjacent-evidence reads on top?
2. **P2 (ai-decision-engine) — shape of the corroboration_evidence frame.** Named JSONB block passed into the AI prompt with structured `{prior_corrections:[...], recent_signals:[...], open_incidents:[...], related_entity_events:[...]}`, or a natural-language block synthesized before the AI call?
3. **Sequencing** — P1 first (highest customer-facing impact) with P2/P3/P4/P5 to follow as separate PRs? Or bundle P1+P5 (agent-chat + report generators) as the "operator-visible" tier and hold P2/P3 (upstream/embedded) for structural work?
4. **is_test enumeration follow-up** — which of the six generators listed here HONOR the is_test flag on client vs are the ones that MISSED it (case study 5)? Additional audit pass to name each? Recommendation: yes, do this as a §5 addendum to this doc before any P1 work.

## Related

- [[three-resources-doctrine]] — mis-classified output = attention spent on the wrong thing.
- [[consumer-test-bidirectional]] — this doctrine is the inward-facing application.
- [[cleanup-method-rulings]] ruling 6 — "does anything consume this?" — internal analog.
- Task #217 (decision-candidate over-creation gate) — waits behind this survey; the gate operates on trustworthy input only after generators consume adjacent evidence.
- Task #223 (INC-ALERTS-BRIDGE) — the pageable-undispatched probe is the mirror-image externally-facing catch.
