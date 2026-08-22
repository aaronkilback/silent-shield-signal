# WO-FAILCLOSED-DEFAULTS — LLM-unavailable defaults must fail CLOSED, not open

**Opened:** 2026-08-22
**Trigger:** OpenAI credit outage 2026-08-21 16:55 UTC → 2026-08-22 ~13:57 UTC (~21h). During the
429-fallback audit, two callers were found to substitute a *permissive* default value when the LLM
returns null, then persist/emit as if assessed. The `_shared/ai-gateway.ts` cross-provider fallback
(OpenAI 429 → Gemini) absorbed the outage (848 fallbacks succeeded, 1 failed), so material impact this
window was ~nil — but the defaults are latent fail-open bugs that bite on a full outage (both providers
down/dry, as nearly happened at 18:34:09 when OpenAI 429'd AND Gemini returned 503).

**Doctrine:** this is the same substitution-defect family the leak sweep and Provenance Doctrine close.
"No LLM answer" must fail closed (quarantine / skip / mark-unavailable), never silently admit or fabricate
agreement. Sibling of the fail-closed catch that already exists in `ingest-signal` at line ~1752 — the bug
is that `callAiGatewayJson` does NOT throw on failure (returns `{data:null}`), so that catch never fires.

---

## Item 0 (AHEAD OF BOTH FAIL-CLOSED ITEMS) — persist gate provenance, joined to outcome

**Rationale:** Proof 1 (below) showed the ingest relevance gate leaves NO trace on an admitted signal —
score, provider, model, and reason are all discarded, so a defaulted/degraded admit is
indistinguishable from a genuine one and per-provider behavior is unmeasurable (Proof 2 could only
build a crude window proxy). Every fail-closed fix in this WO is un-auditable until the decision is
persisted. This item lands FIRST so Items 1–2 can be verified and any future outage re-scanned.

**Scope:** on EVERY gate/consensus evaluation — both ADMIT and REJECT — persist, joined to the outcome
row (signal / filtered_signals / agent_debate_records):
- `gate_score` (the LLM score, distinct from the deterministic `scoreSignalRelevance` value)
- `gate_provider` (`openai` | `gemini` | …) and `gate_model` (the model that actually served it —
  read from `result.raw.model`, NOT the requested model, so a 429→Gemini fallback is visible)
- `gate_reason` (the one-sentence justification) and `gate_outcome` (`admit` | `reject` | `default_admit` | `unavailable`)
- `gate_evaluated_at`
Store on the admitted `signals` row (new columns or `raw_json.relevance_gate`), on `filtered_signals`
(already has score/reason — add provider/model/outcome), and on `agent_debate_records` (already has
`individual_analyses` — add provider/model per participant). This satisfies the no-unauditable-gates
doctrine and makes per-provider admission rate a direct query instead of a proxy.

**Acceptance:** after this ships, "which provider served this admit, and was it a default?" is answerable
by SELECT on a single row — no telemetry-time correlation, no fingerprint guessing.

## Item 1 (FIRST fail-closed) — multi-model-consensus: fabricated consensus_score 1.0

`supabase/functions/multi-model-consensus/index.ts`. On total model failure, `parseToolCallResult(null)`
returns `{assessment:'unknown', confidence:0.5}` for BOTH models →
`assessmentsMatch(0.5) + prioritiesMatch(0.3) + confidenceDelta<0.2(0.2)` = **consensus_score 1.0**,
`disagreement=false`, and it **inserts an `agent_debate_records` row asserting perfect agreement** — when
in reality neither model answered.

**Fix:** detect the both-null / both-default case explicitly and fail closed — do NOT write a
consensus row claiming agreement. Either skip the insert and return an honest "assessment unavailable
(models unreachable)", or write a row with `disagreement=true` / `consensus_score=0` /
`final_assessment='unavailable'` so it is never mistaken for a confirmed high-consensus assessment.
Prefer refusing over persisting a fabricated agreement.

## Item 2 (SECOND) — ingest-signal relevance gate: 0.7 admit default

`supabase/functions/ingest-signal/index.ts:1671`:
```ts
const gateScore = gateResult.data?.score ?? (gateResult.data?.relevant === false ? 0.1 : 0.7);
```
On gateway null (both providers failed, OR a successful Gemini fallback returned non-JSON → `data:null`),
`gateScore = 0.7` — above the ~0.30 admit floor → the signal is **ADMITTED as relevant without
assessment**. The gate leaves **no marker** on the admitted signal row (see Proof 1 below), so a defaulted
admit is indistinguishable from a genuine one at the data layer.

**Fix:** when `gateResult.data` is null (or `gateResult.error` is set), fail closed — route the signal to
quarantine (`quality_status='quarantined'`, a new `quarantine_reason='relevance_gate_unavailable'`) or
reject to `filtered_signals` with `filter_reason='ai_relevance_gate_unavailable'`, rather than admit at
0.7. Add an explicit `if (gateResult.error || !gateResult.data)` branch BEFORE the `?? 0.7` default. QA-test
signals keep their existing bypass.

---

## Item 3 — fallback needs its own threshold + this outage window needs re-scan

**PRIMARY EVIDENCE — prompt-rule violations (deterministic, not statistical).** During the Gemini-served
window the relevance gate ADMITTED three signals its own system prompt explicitly says to score 0.0
("Sports leagues, tryouts, tournaments, recreational activities" / "local lifestyle news with no
client/asset/threat nexus"):

- **SIG-2026-032549** BC Place — "Vancouver Whitecaps player criticizes BC Place turf" — a sports story; **prompt-rule VIOLATION** (should be 0.0).
- **SIG-2026-032551** BC Place — "Report Indicates Vancouver Whitecaps May Operate BC Place" — asset business news, no security nexus; **prompt-rule VIOLATION**.
- **SIG-2026-032552** BC Place — "[PATTERN] Geographic cluster: 2 signals near BC Place" — a derived pattern built ON the two Whitecaps items (bypasses the gate), so the junk propagated into an `active_threat`-category signal.

These are categorical rule violations, not close calls — the gate admitted content it is explicitly told to
reject. **That is the finding.**

**CONTEXT ONLY (statistical, weak — do not lead with this):** aggregate admit-rate proxy — baseline/OpenAI
**10.5% (n=38)** vs outage/Gemini **60% (n=10)**. Directionally consistent with a more-permissive fallback,
but **small samples (n=10 vs n=38), across different content windows, provider not joined to outcome** —
treat as a hint, not a measurement (Item 0 makes it measurable). It does not carry the case; the three
prompt-rule violations do.

**IMPACT SCOPE (INC check, 2026-08-22):** none of the 6 reached a client — 0 incidents, 0
reports/alerts/audio/webhook/SMS, the only daily briefing is operator-only (`ak@`), and BC Place has **zero
client-side users**. Operator-facing only → quality WO item, **not an INC**.

The other 3 admits (context): SIG-032548 Petronas pipeline release (LEGIT, high), SIG-032550 Imperial Oil
Norman Wells NWT (questionable — wrong company/region), SIG-032553 BCWS fire (separate wildfire proximity path).

**Action:** re-run the relevance gate on these 6 (now on OpenAI); demote/quarantine any that fail. Then
give the Gemini fallback its own (stricter) admit threshold, or record the serving provider on the outcome
so per-provider admission rate becomes measurable (no-unauditable-gates doctrine).

---

## Backfill query — existing fabricated-consensus rows

`multi-model-consensus` persists `individual_analyses: {model_1, model_2}` as JSONB, so the both-null rows
ARE detectable (unlike the ingest gate). Identify `agent_debate_records` asserting consensus 1.0 where both
model outputs were the null-default (`assessment='unknown'`, `confidence=0.5`):

```sql
SELECT id, created_at, consensus_score, final_assessment,
       individual_analyses->'model_1'->>'assessment'  AS m1_assessment,
       individual_analyses->'model_2'->>'assessment'  AS m2_assessment,
       (individual_analyses->'model_1'->>'confidence')::numeric AS m1_conf,
       (individual_analyses->'model_2'->>'confidence')::numeric AS m2_conf
FROM public.agent_debate_records
WHERE debate_type = 'multi_model_consensus_v2'
  AND consensus_score = 1.0
  AND individual_analyses->'model_1'->>'assessment' = 'unknown'
  AND individual_analyses->'model_2'->>'assessment' = 'unknown'
  AND (individual_analyses->'model_1'->>'confidence')::numeric = 0.5
  AND (individual_analyses->'model_2'->>'confidence')::numeric = 0.5
ORDER BY created_at DESC;
```

Caveat (Proof-1 discipline): the fingerprint is strong but not perfect — a genuine both-`unknown`,
both-`0.5` result is theoretically possible. Treat matches as candidates to void/re-run, not confirmed
fabrications. Remediation: set these rows' `consensus_score=0` / mark `final_assessment='void_models_unavailable'`
(or delete) so no downstream consumer trusts the fabricated agreement, and re-run consensus on the underlying
signals once Item 1 ships.

---

## Proof 1 (recorded here so it isn't re-litigated) — the ingest gate default is NOT retro-distinguishable

The admitted signal's `relevance_score` comes from the **deterministic** `scoreSignalRelevance`
(`_shared/signal-relevance-scorer.ts`, starts at 0.5), NOT from the LLM gate. The gate's `0.7` default is a
pass/reject decision input only and is **never persisted** on an admitted row (no gate score, provider,
model, or reason in `signals.raw_json`). So an admit via `gateScore=0.7` (LLM down) is byte-identical to a
genuine admit. Any retro "0.7 fingerprint" query on `signals.relevance_score` is meaningless. The only
retro levers are (a) `function_telemetry` gate-call failures by timestamp (undercounts — non-JSON fallback
successes also yield the default and aren't individually logged), and (b) small admit volume (only 6 signals
in the whole window). Item 2's fix must therefore also ADD a persisted marker on any gate-unavailable
admit/quarantine so future outages ARE auditable.

## Sequencing
**Item 0 (persist gate provenance, joined to outcome) FIRST** — everything below is un-auditable without it →
Item 1 (multi-model-consensus fail-closed) → Item 1 backfill query → Item 2 (ingest-signal fail-closed) →
Item 3 (fallback threshold; provider-on-outcome telemetry, largely delivered by Item 0) → re-scan the 6
outage-window admits. Do NOT fold into the leak-sweep session (operator ruling 2026-08-22).
