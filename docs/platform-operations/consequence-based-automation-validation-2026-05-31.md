# Consequence-Based Automation Validation — O3, O4, O5

**Operator-directed 2026-05-31 (Task #122).** Empirical historical-replay validation against last-90-days prod data. No implementation. The recommendation reverses parts of the Approval Queue Overload Assessment's automation proposal — the validation surfaced problems with all three boundaries.

Tied to Fortress doctrine:
1. *"Preserve decision space by shortening Signal → Decision → Action."*
2. *"Operator attention is critical infrastructure."*
3. *"In Peace Time, Improve Your Fighting Position."*

---

## §0 — Verdict Summary

| Boundary | Original proposal | Verdict | Reason |
|---|---|---|---|
| **O3** | Auto-execute `add_keyword` at conf ≥ 0.85 | **NO-GO** | Operator rejects ~37% of historical proposals at ≥0.85 band; rejection driver is **duplication**, not relevance — confidence score is the wrong signal entirely |
| **O4** | Auto-reject `entity_suggestion` auto_enrichment at conf < 0.5 | **CONDITIONAL GO** | Auto-reject (vs auto-approve) is reversible; data shows zero historical approvals at <0.5; but the sample is sparse (60 pending, 0 reviewed) |
| **O5** | Auto-execute severity corrections at conf ≥ 0.85 | **NO-GO (BLOCKED)** | The `confidence` field does not exist on `agent_actions.action_payload` for `propose_severity_correction`. Cannot implement as proposed. |

**Net verdict:** The original Approval Queue Overload Assessment's automation proposal is partially wrong. The validation prevented shipping a doctrine that would have **increased** operator attention cost in two of three cases.

This is exactly why the validation step exists.

---

## §1 — O3 Validation: `add_keyword` Auto-Execute

### A — Historical Replay

Last 90 days, `monitoring_proposals` where `proposal_type = 'add_keyword'`:

| Confidence band | Pending | Applied | Rejected | Total decisions | Applied rate | Reject rate |
|---|---:|---:|---:|---:|---:|---:|
| **≥0.90** | 12 | 17 | **8** | 25 | 68% | **32%** |
| **0.85-0.90** | 6 | 2 | **3** | 5 | 40% | **60%** |
| 0.80-0.85 | 85 | 24 | 8 | 32 | 75% | 25% |
| 0.75-0.80 | 6 | 3 | 0 | 3 | 100% | 0% |
| 0.70-0.75 | 156 | 23 | 6 | 29 | 79% | 21% |

**At the proposed ≥0.85 threshold:** combined 19 applied + 11 rejected = **36.7% false-approval rate if auto-executed.**

### B — Why the Reject Rate Is So High (Content Analysis)

Reviewed every rejected and applied keyword at conf ≥ 0.7. The reject pattern is **not "wrong keyword."** The reject pattern is **near-duplicate of an already-approved keyword.**

Examples of REJECTED at ≥0.85:
- "Fort St. John pipeline sabotage attempt" (0.9)
- "Coastal GasLink pipeline sabotage" (0.9)
- "Coastal GasLink pipeline sabotage attempt" (0.9)
- "Coastal GasLink Fort St. active threats" (0.9)
- "Coastal GasLink pipeline sabotage threats" (0.9)
- "Wet'suwet'en protest Coastal GasLink" (0.9)
- "Wet'suwet'en land defenders blockade" (0.85)
- "Wet'suwet'en pipeline protest updates" (0.85)

Compare to APPLIED at ≥0.85:
- "Wet'suwet'en land defenders blockade Houston" (0.9) — *applied*
- "Coastal GasLink access road blockade Houston" (0.9) — *applied*
- "Houston BC blockade" (0.9) — *applied*

The agent (CRUCIBLE) generates many near-paraphrases of the same concept. The operator approves the canonical phrasing once and rejects the variations. The AI's confidence score reflects "is this thematically relevant?" — which is the wrong question. The operator's real test is "is this **new coverage** vs **already covered**?"

### C — Consequence of False Approvals

If auto-executed at ≥0.85:
- **Outcome:** ~37% of keywords in CRT would be near-duplicate variants polluting the keyword set
- **Downstream impact:** the monitor functions would search for redundant terms, increasing API costs and noise in the signal feed
- **Customer impact:** Petronas Canada client would have a keyword set bloated with paraphrases like "Wet'suwet'en blockade Coastal GasLink" + "Wet'suwet'en land defenders blockade" + "Coastal GasLink access road blockade" — same coverage, 3× the cost
- **Recovery effort:** EACH duplicate requires operator review and `remove_keyword` execution. **Net operator attention cost INCREASES** under this automation.

### D — Rollback Design

If auto-execute were active and a duplicate landed:
- Detection: notify-only digest would surface "added: <keyword>" — operator notices similarity to existing
- Reversal: `remove_keyword` proposal at operator's discretion
- Time: <1 minute per item — but at scale, **the rollback queue replaces the approval queue**
- Notification: operator-facing digest only; no customer notification needed

### E — Trust Impact

**Trust DECREASES.** The operator would observe Fortress auto-approving keywords they would have rejected. Trust in automation breaks the first time the operator sees a redundant keyword they didn't ask for. Confidence-based gating cannot recover this because the operator's decision criterion is not confidence-correlated.

### O3 GO/NO-GO

**NO-GO as proposed.**

### Alternative path (RECOMMEND for future scoping)

**O3-alt: Auto-deduplicate before queue insertion.** Replace the confidence threshold with semantic similarity check against:
- Existing applied keywords for the same client
- Previously-rejected proposals (do not re-propose)
- Other pending proposals (collapse duplicates before operator sees them)

Estimated impact: removes ~67% of inflow at the source. Operator never sees the duplicates. This addresses the actual cause without false-approval risk. Requires implementation work (similarity algorithm, normalization) — needs separate scoping.

---

## §2 — O4 Validation: `entity_suggestion` Auto-Reject

### A — Historical Replay

Last 90 days, `entity_suggestions` from `source_type = 'auto_enrichment'`:

| Suggested type | Conf band | Pending | Approved | Rejected | Reviewed total |
|---|---|---:|---:|---:|---:|
| person | <0.30 | 24 | 0 | 0 | **0** |
| person | 0.30-0.40 | (none) | 0 | 0 | 0 |
| person | 0.50-0.60 | 22 | 0 | 0 | **0** |
| person | 0.60-0.80 | 4 | 0 | 0 | 0 |
| person | ≥0.80 | 10 | 0 | 0 | 0 |
| organization | 0.50-0.60 | 3 | 0 | 0 | 0 |
| organization | 0.60-0.80 | 1 | 0 | 0 | 0 |
| organization | ≥0.80 | 4 | 0 | 0 | 0 |
| location | 0.50-0.60 | 4 | 0 | 0 | 0 |
| infrastructure | various | 5 | 0 | 0 | 0 |

**Critical empirical gap:** ZERO `auto_enrichment` entity_suggestions have been approved OR rejected in the last 90 days. The operator has not reviewed any of them. The sample for measuring "what would the operator do" is empty.

### Inference from adjacent sources (for context only)

Non-auto_enrichment sources at high confidence:

| Source | Band | Approved | Rejected | Reject rate |
|---|---|---:|---:|---:|
| ai_assistant | ≥0.85 | 42 | 1 | **2.3%** |
| archival_document | ≥0.85 | 1 | 14 | **93%** |
| archival_document | 0.70-0.85 | 7 | 4 | 36% |

**Confidence is not predictive of operator decision in this surface either.** Source type matters more. The operator clearly distrusts `archival_document` extractions even at very high confidence (93% rejected at ≥0.85). This is consistent with the O3 pattern — confidence ≠ operator approval.

### B — Accuracy Estimate

Cannot compute true accuracy. The operator has not reviewed any auto_enrichment items in 90 days. **Inferred** estimates only:

| Auto-reject threshold | Items affected (last 90d) | Estimated false-rejects |
|---|---:|---:|
| <0.30 | 24 | ~0 (these look like extraction noise; 0.36 avg confidence is sub-baseline) |
| <0.50 | 46 | ~0-2 (probably safe; reversible) |
| <0.70 | 68 | ~5-10 (some legitimate medium-confidence entities) |

These are educated guesses, not measurements. The honest position is: *we don't know empirically because no review has happened.*

### C — Consequence of False Rejection

If `<0.5 auto_enrichment` were rejected and a legitimate entity was missed:
- **Outcome:** real entity is not added to tenant graph
- **Downstream impact:** entity does not appear in correlation, mentions tracking, or scheduled rescans
- **Customer impact:** if it was an operationally-important entity (e.g., a new threat actor), the system would not flag related signals
- **Recovery effort:** if the entity surfaces in future signals or ai_assistant proposals, it gets re-suggested with higher confidence → re-enters the queue. **Self-healing in most cases.**
- **Reversible?** Yes — auto-rejected items remain in DB with `status='rejected'`; operator could re-approve. New auto_enrichment cycles would re-propose if signal evidence increases.

### D — Rollback Design

If an auto-rejected entity proves to be legitimate:
- Detection: surfaces in later signals or via ai_assistant pathway (higher confidence sources)
- Reversal: re-suggest via natural pipeline OR operator manually creates entity
- Time: <2 minutes if operator catches it; days-to-weeks if discovered organically
- Notification: included in "last 24h auto-rejected" digest by suggested_type + count

### E — Trust Impact

**Trust likely NEUTRAL to slightly POSITIVE.** Auto-rejecting noise at <0.5 confidence (avg 0.36) matches what the operator would do anyway. The auto-rejected items are mostly extraction noise (low-confidence speculative names from unstructured text). The operator never had bandwidth to review them — the queue was permanent noise.

Trust risk is asymmetric:
- If operator notices auto-reject of items they would have approved → trust decrease
- If operator notices the queue is cleaner and items are higher signal → trust increase
- Most likely operator never notices the digest in detail unless something feels wrong

### O4 GO/NO-GO

**CONDITIONAL GO** with caveats:
1. Threshold should be `<0.50` not `<0.40` (matches the empirical confidence floor; minimal risk of catching legitimate entities)
2. Source restriction: ONLY `auto_enrichment` (other sources have different operator-trust profiles)
3. Type restriction: applies to all suggested_types from auto_enrichment
4. Digest required: "last 24h auto-rejected: N items by type" surfaced daily
5. Pilot duration: 2 weeks observation; operator reviews 5 random samples from the auto-reject pool to validate

### Alternative path (BETTER long-term)

**O4-alt: Run dormant `ai_threat_score` pipeline BEFORE queue insertion.** The schema already has `ai_assessment`, `ai_assessed_at`, `ai_risk_level`, `ai_threat_score` columns — all NULL for 334/334 rows. If this pipeline ran:
- Items with `ai_risk_level = 'noise'` would be filtered before reaching the queue
- Items with `ai_risk_level ≥ 'moderate'` would surface with pre-context for the operator
- The "auto-reject at <0.5" becomes a secondary filter, not the primary one

This is a better path because it uses the existing schema design. The reason it's dormant is a separate diagnosis (Task #122 didn't probe whether the pipeline is disabled vs broken). Requires scoping.

---

## §3 — O5 Validation: `propose_severity_correction` Auto-Execute

### A — Historical Replay

Last 90 days, `agent_actions` where `action_type = 'propose_severity_correction'`:

| Status | Count | Avg payload confidence |
|---|---:|---:|
| executed | 62 | **NULL** |
| awaiting_approval | 22 | **NULL** |
| rejected | 0 | n/a |
| **Total** | 84 | |

### B — BLOCKED: No Confidence Field

Sampled action_payload structure from 5 most-recent severity corrections:

```json
{
  "evidence": "<rationale text>",
  "signal_id": "<uuid>",
  "proposed_severity": "low|medium|high"
}
```

**There is no `confidence` field in `action_payload` for `propose_severity_correction`.** The proposed O5 boundary cannot be implemented without first adding this field. The agent_actions table does not store confidence at the row level either.

### Implication

The original Approval Queue Overload Assessment §12 (Boundary B3 / O5) assumed a confidence threshold existed. It does not. Either:
- The proposing agent (CRUCIBLE) doesn't compute confidence for severity corrections
- It computes confidence but discards it before persistence
- The action_type was designed without consequence-gated automation in mind

Without a per-action confidence signal, "auto-execute at conf ≥ X" is undefined.

### C — Suspicious 0% Rejection Rate

Even setting aside the confidence problem, the empirical record is suspicious. 84 propose_severity_correction actions in 90 days, ZERO rejected. Three possibilities:

1. **AI is genuinely perfect at severity correction.** Unlikely; AIs are rarely 100% accurate at anything.
2. **Operator approves blindly.** Plausible given the queue-overload picture. Severity corrections are easy to skim and approve without deep review.
3. **Only obvious cases get reviewed; harder ones sit in awaiting_approval indefinitely.** 22 currently awaiting (avg age 7.5 days, oldest 8.1 days) — consistent with this.

In all three cases, the data does not support an "AI accuracy" claim. **The 0% rejection rate is uninformative.**

### D — Sample Rationale Quality

Looking at sample executed corrections:
- "No active BCWS fire G90285 was found near Prince George, BC, where the fire danger rating is Low and no evacuations are in place. The reported 1-hectare size is small, and without a precise location, the immediate threat is unconfirmed." → demote to medium ✓
- "BCWS reports active evacuation ALERTS for the Old Fort Landslide, not an ORDER, affecting 146 people. An 'Alert' is less severe than an 'Order', though the situation remains significant." → demote to high ✓
- "This signal is a re-reporting of a low-severity business agreement already captured in a signal from 2026-05-02. It does not represent new or escalating information warranting a new incident creation." → demote to low ✓

The reasoning quality looks good in the samples. BUT — the sample is non-random (5 most recent only) and zero have been rejected for comparison.

### E — Consequence of False Severity Correction

If AI proposes "low" for a signal that should be "high" and auto-executes:
- **Outcome:** signal de-prioritized in feeds, dashboards, alerts
- **Downstream impact:** other agents may skip enrichment on it; daily briefing may omit it; tier-2 review may not flag it
- **Customer impact:** **HIGH risk** if a real threat is missed — Petronas could be in operational risk while Fortress shows green
- **Recovery effort:** operator must re-correct severity; downstream agents must re-process
- **Reversible?** Yes mechanically (severity is just a label), but the **window of operator blindness** while severity is wrong is the harm

This is the consequence-class problem: severity corrections feel LOW (just a label) but their downstream propagation is MEDIUM-HIGH (affects what the operator sees).

### Rollback Design

Not applicable until the confidence field exists.

### Trust Impact

**Trust uncertainty.** Without a confidence signal, the operator cannot interpret "why did Fortress demote this signal to low?" — every auto-correction is opaque. This is worse than the current state (operator at least sees AI rationale + can reject).

### O5 GO/NO-GO

**NO-GO. Structurally blocked.**

### Alternative path (PREREQUISITE for any future O5)

**O5-prerequisite: Add `confidence` field to action_payload schema.**

The `agent_actions` row could either:
- Add a top-level `confidence numeric` column (schema change; lightweight migration)
- Standardize that all action_payload jsonb objects include `confidence` (writer-side change; documented contract)

Until either lands, O5 cannot be evaluated. After landing, a 30-90 day observation window with confidence captured would generate the data needed to make this decision empirically.

---

## §4 — Most Important Question

**"Would the attention recovered be greater than the risk introduced?"**

| Boundary | Attention recovered (was estimated) | Risk introduced | Verdict |
|---|---|---|---|
| O3 | ~80 min/week (claimed) | Duplicate-keyword cleanup likely INCREASES net attention cost | **Net NEGATIVE — do not ship** |
| O4 | ~30 min/week (claimed) | Bounded; reversible; sparse data | **Net POSITIVE but small** — conditional GO |
| O5 | ~5 min/week (claimed) | Cannot evaluate; field missing | **MOOT — structurally blocked** |

The original assessment estimated **~115 min/week recovered** from O3+O4+O5 combined. Reality: ~20-30 min/week from O4 only, with no recovery from O3 (would likely *cost* more attention) or O5 (cannot execute).

---

## §5 — What This Reveals About the Larger Doctrine

The Approval Queue Overload Assessment correctly identified the bottleneck and the consequence-framework structure. But three of the specific automation proposals would have failed under validation. **The validation step is load-bearing.**

This pattern should be doctrinal:

> **Any consequence-banded automation boundary must be validated against historical replay before authorization. The proposal-to-execution gap is where doctrine fails.**

The original assessment's §10 framework (LOW + high-conf → AUTO; LOW + med-conf → notify-only; etc.) is still correct in principle. But the **mapping of specific action types to confidence thresholds requires empirical validation per type.** What worked for `file_followup_task` (already AUTO, no issues) does NOT generalize to `add_keyword` (duplication problem) or `propose_severity_correction` (missing confidence field).

---

## §6 — Revised Operator Decision Surface

Replacing the original O3/O4/O5 GO recommendations in the Approval Queue Overload Assessment §16:

| # | Original | Revised |
|---|---|---|
| O3 (add_keyword auto-execute at ≥0.85) | proceed | **WITHDRAW** — would increase attention cost via duplicates |
| O3-alt (dedup-before-queue) | not proposed | **NEW: scope separately** — addresses actual cause; needs similarity algorithm design |
| O4 (auto-reject auto_enrichment <0.5) | proceed | **CONDITIONAL GO** — proceed with: (1) 2-week pilot, (2) daily digest of rejections, (3) operator spot-check of 5 random rejected items, (4) immediate rollback if any false-reject discovered |
| O4-alt (run dormant ai_threat_score) | not proposed | **NEW: scope separately** — better long-term path; uses existing schema |
| O5 (severity correction auto-execute at ≥0.85) | proceed | **STRUCTURALLY BLOCKED** — confidence field doesn't exist; needs prerequisite work |
| O5-prerequisite (add confidence to action_payload) | not proposed | **NEW: scope separately** — small schema/writer change to enable future O5 validation |
| O7 (fix monitoring_proposals 7-day expiry) | proceed | **GO unchanged** — trivial cron fix, low risk, immediate value |

### Recommended sequence (revised)

1. **O7 first** (unchanged) — fix the expiry job. Trivial, immediate, no policy implications.
2. **O4 pilot** (revised) — 2-week conditional with digest + spot-check. Reversible, narrow scope, measurable.
3. **Scope O3-alt + O4-alt + O5-prerequisite** as three separate scoping tasks. Each is implementation work, not policy ratification. Each requires its own GO cycle.
4. **Re-rank against F.0 Decision Frame and Campaign 1 Watchdog** after the above land.

The expected attention recovery shrinks from ~115 min/week to ~20-30 min/week (O4 only) + the O7 cleanup. The remainder is deferred until prerequisite work lands.

---

## §7 — What Did NOT Validate (Honest Limits)

| Limit | What I don't know |
|---|---|
| O4 sample size | 60 pending items with zero historical reviewed — inference based on confidence floor, not measurement |
| O5 confidence-quality | If the field were added, the AI's confidence calibration is unknown |
| Operator's actual veto patterns | Why specifically the operator approved one keyword variant and rejected paraphrases (the data shows the pattern but not the rule) |
| Source of agent over-generation | CRUCIBLE is producing 5+ near-duplicates per concept — root cause unknown (prompt design? lack of context?) |
| Whether `ai_threat_score` is dormant by design or by bug | O4-alt depends on this; not probed |
| Whether the 7-day expiry never fired or fired incorrectly | O7 trivial fix; assumes cron schedule is the bug, not the function logic |

These are not gates. They are honest acknowledgments that the validation has measurable margin.

---

## §8 — Doctrinal Implications

### New doctrinal rule (proposed for ratification)

> **No consequence-banded automation boundary ships without historical replay validation.**

This is a peacetime fighting-position investment per the operator's recorded doctrine. Validation is the load-bearing discipline that prevents the doctrine from manufacturing more attention cost than it removes.

### Validation as part of the standard automation lifecycle

```
Proposal → Historical replay → Threshold calibration → Pilot (notify-only) → Auto-execute
              ↑                                            ↑
           (this task)                                  (operator-verified)
```

The original Approval Queue Overload Assessment proposed jumping from Proposal directly to Auto-execute for O3/O5. Validation catches that gap.

### Tie back to Commander's Intent

"*Preserve decision space by shortening Signal → Decision → Action.*"

Shipping O3 unvalidated would have *consumed* decision space by adding duplicate-cleanup overhead. Shipping O5 unvalidated would have been impossible (field missing) — the appearance of action without the substrate.

Validation IS preserving decision space — by refusing to ship work that would erode it.

---

## §9 — Held / Operator Decisions

### Decisions required (each separate)

| # | Decision | Recommendation |
|---|---|---|
| V1 | Accept the validation findings; withdraw O3 + O5 as originally proposed | ACCEPT |
| V2 | Authorize O4 conditional pilot (2-week, with digest, spot-check, rollback) | proceed pending GO |
| V3 | Authorize O7 cron-expiry fix (unchanged from original assessment) | proceed pending GO |
| V4 | Scope O3-alt (dedup-before-queue) as separate task | recommended |
| V5 | Scope O4-alt (revive `ai_threat_score` pipeline) as separate task | recommended |
| V6 | Scope O5-prerequisite (add confidence field to action_payload) as separate task | recommended |
| V7 | Ratify the new doctrinal rule: "no consequence-banded automation without historical-replay validation" | recommended |
| V8 | Re-rank F.0 vs Campaign 1 Watchdog against revised attention recovery picture | recommended after V2/V3 land |

### What does NOT change

- Approval Queue Overload Assessment §10 framework (consequence-banded approval) stands
- §13 doctrine additions (peacetime + operator-attention-as-infrastructure) stand
- Operator hypothesis (operator attention IS the primary bottleneck) confirmed
- The 89%-LOW pattern in pending queues stands

What changes is the **specific tactical proposals** — not the strategic diagnosis.

---

## §10 — Final Verdict

The operator's instinct to validate before authorization was correct.

- O3 was a doctrine-shaped error: a confidence-based gate on a decision where confidence is not the operator's actual decision criterion. **Withdraw.**
- O4 has bounded risk and likely positive value, but is empirically thin. **Conditional GO with disciplined pilot.**
- O5 is structurally blocked. **Prerequisite work first.**

Combined with O7 (trivial), the immediate path forward is:
- **Ship O7** — fixes one operator-facing irritation
- **Pilot O4** — narrow, reversible, measurable
- **Scope O3-alt + O4-alt + O5-prerequisite** — prepare the substrate for the next validation cycle

Net expected attention recovery in the near term: **~20-30 min/week** (was ~115 min/week claimed). Real but smaller. **Honest is better than optimistic.**

The doctrine rule (V7) — *no consequence-banded automation without historical replay* — is the durable output of this validation. It makes the failure mode (shipping a confidence-based gate on a non-confidence-correlated decision) repeatable to catch in future automation proposals.

Held. No implementation. No code. Awaiting operator GO per §9.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
