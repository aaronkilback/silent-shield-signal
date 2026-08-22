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

## Item 1 (FIRST) — multi-model-consensus: fabricated consensus_score 1.0

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

## Item 3 — fallback needs its own threshold + this outage window needs re-scan (Proof 2)

The Gemini fallback silently inherits the OpenAI gate's threshold. Aggregate admit-rate proxy over the
outage window vs a comparable prior baseline (provider is only recorded on the gate *call*, never joined to
the admit/reject outcome — so this is a window proxy, not a per-call join):

| Window | Provider (dominant) | Admits | Gate-rejects | Admit rate |
|---|---|---|---|---|
| Baseline 2026-08-14 16:55→08-15 14:00 | OpenAI | 4 | 34 | **10.5%** |
| Outage   2026-08-21 16:55→08-22 14:00 | Gemini | 6 | 4  | **60%** |

Material divergence in the direction of concern (Gemini ~6× more permissive), though small/confounded
samples (different content windows). Per operator ruling, this trips **"diverge materially → re-scan, not
sign-off."** All 6 outage-window admits (cheap to re-scan now OpenAI is restored):

- SIG-2026-032548 Petronas — pipeline release near Pouce Coupe (LEGIT, high)
- SIG-2026-032549 BC Place — "Whitecaps player criticizes BC Place turf" (QUESTIONABLE — gate prompt excludes sports/recreational at 0.0)
- SIG-2026-032550 Petronas — "Imperial Oil shuts Norman Wells NWT" (QUESTIONABLE — wrong company/region)
- SIG-2026-032551 BC Place — "Whitecaps may operate BC Place" (BORDERLINE — asset business news, no security nexus)
- SIG-2026-032552 BC Place — [PATTERN] geo cluster derived from the two Whitecaps items (bypasses gate)
- SIG-2026-032553 Petronas — BCWS fire G51735 0.003 ha (wildfire proximity path, separate)

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
Item 1 (multi-model-consensus) → Item 3 backfill query → Item 2 (ingest-signal) → Item 3 fallback threshold
+ provider-on-outcome telemetry. Do NOT fold into the leak-sweep session (operator ruling 2026-08-22).
