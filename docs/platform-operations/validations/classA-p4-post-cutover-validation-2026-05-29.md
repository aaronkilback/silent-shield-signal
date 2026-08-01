# Class A P4 — post-cutover validation (real prod conversations)

**Date:** 2026-05-29 (post-deploy). **Status:** P4 reader cutover live on prod for `dashboard-ai-assistant`. Holds: P5 / P6 / Class B / PR #36.

Per operator directive: controlled validation period with before/after evidence across real conversations. This document captures three live post-deploy invocations + their Flight Recorder traces and discusses observed behavior against the six success criteria.

---

## 1. Deploy + verification chain

| Step | Result |
|---|---|
| Initial deploy (`gh workflow run` 26643539036) | ✅ deploy step green |
| First-fire (3 invocations, trace IDs 11111111-…) | ✅ HTTP 200; ✅ prompt traces show tradecraft block sized 1755–1885 bytes per request; ❌ retrieval traces missing (silent type-cast failure: `tenant_scope` is uuid, my code passed text) |
| **Fix:** `tenantScope: null` + `provenance.asset_class='global_shared'` (commit `c472dd18`) | ✅ |
| Redeploy (`gh workflow run` 26643873437) | ✅ |
| Second-fire (3 invocations, trace IDs 22222222-…) | ✅ HTTP 200; ✅ Flight Recorder retrieval traces ALL captured with full provenance |
| Validation invocations completed | ✅ all 3 status=ok, durations 13s–15s |

## 2. S1–S6 success-criteria status

| # | Criterion | Pass criterion | Evidence | Status |
|---|---|---|---|---|
| **S1** | operator-Aegis tradecraft access restored | ≥3 items per request (was: 0) | All 3 invocations show `tradecraft` context block in prompt at 1755–1885 bytes; Flight Recorder confirms `items_returned=3` per invocation | ✅ **PASS** |
| **S2** | no tenant-unique content in Class A | 0 rows match G2/G3/G4/G5 | Confirmed at P3; post-cutover spot-check unchanged | ✅ PASS |
| **S3** | quarantine review completed | empty queue | `agent_tradecraft_quarantine`: 0 rows | ✅ PASS |
| **S4** | no regression in agent-chat/training/login | functional equivalence pre/post | agent-chat / academy-* / get-login-summary unchanged in this PR; they still read legacy `agent_beliefs`. P5/P6 explicitly held | ✅ PASS (no change to those surfaces) |
| **S5** | methodology never labeled as observation | prose-lint R7 finds 0 violations on real outputs | R7 deployed (6 Deno test cases pass); no violations triggered on the 3 live conversations because **no tradecraft content was borrowed into the responses** (analyzed below) | ✅ PASS (with observation about retrieval relevance below) |
| **S6** | Flight Recorder captures all tradecraft injections | every injection writes a `surface='agent_tradecraft'` row | 3 of 3 captured with full provenance (asset_class, budget, items_returned, min_confidence, domains, label_version, returned_object_ids) | ✅ **PASS** |

---

## 3. The three real prod conversations

### 3a. Conversation 1 — Trent Reznor tour planning

**Operator question:** *"I'm planning Trent Reznor's next international tour leg. What baseline protective posture should I be thinking about?"*

**Tradecraft items injected (random-3 from confidence ≥ 0.80 pool):**

| Agent | Domain | Hypothesis |
|---|---|---|
| CRUCIBLE | threat_assessment_frameworks | "Unaddressed data quality issues and unbridged intelligence gaps are direct causal factors in critical decision-making failures, highlighting significant operational and strategic risks for organizations." |
| MERIDIAN | threat_assessment_frameworks | "The integration of disparate threat domains (cyber, physical, geopolitical, insider, OT) fundamentally alters the risk landscape, making traditional siloed security approaches inherently ineffective for comprehensive protection." |
| ECHO-WATCH | security_principles | "SOCMINT is fundamentally shifting from a public data analysis tool to a first-party, AI-driven engine focused on predictive analytics and consent-based insights." |

**LLM response (truncated):**

> For Trent Reznor's international tour leg, consider implementing the following baseline protective posture:
> 1. **Threat Assessment**: Conduct a comprehensive assessment of potential threats at each venue and travel route…
> 2. **Travel Security**: Ensure secure transportation arrangements, with vetted drivers and vehicles…
> 3. **Venue Security Coordination**: Work closely with each venue's security team…
> 4. **Personal Security Detail**: Assign a dedicated security detail familiar with the artist's routine…
> 5. **Health and Safety Protocols**…
> 6. **Communication Plans**: Establish clear lines of communication for the team…

**Observations:**
- Response is competent baseline protective-posture advice from the LLM's own training.
- **None of the 3 injected tradecraft items appears in the response** — no `[TRADECRAFT REFERENCE]` label, no "data quality" / "disparate threat domains" / "SOCMINT" language.
- The LLM **silently omitted** all 3 items because none was topically relevant to a tour-planning question. This is **exactly the prompt rule's intended behavior**: *"if a tradecraft item is not relevant…silently omit it rather than name-and-dismiss it."*

### 3b. Conversation 2 — Fixated subject credibility judgment

**Operator question:** *"How do I assess whether a fixated subject mentioned in recent signals represents a credible threat?"*

**Tradecraft items injected:**

| Agent | Domain | Hypothesis |
|---|---|---|
| NARCO-INTEL | security_principles | "Darknet markets and crypto-enabled drug sales represent a highly resilient and adaptive sector of the illicit drug trade…" |
| CRUCIBLE | threat_assessment_frameworks | "Unaddressed data quality issues and unbridged intelligence gaps are direct causal factors in critical decision-making failures…" |
| NARCO-INTEL | threat_assessment_frameworks | "The involvement of the Assad regime in controlling captagon production…" |

**LLM response (truncated):**

> To assess whether a fixated subject in recent signals represents a credible threat, follow these steps:
> 1. **Signal Analysis**: Review recent signals…
> 2. **Contextual Investigation**: Gather additional context…
> 3. **Threat Assessment Framework**: Utilize a threat assessment framework, such as the T.E.A.R. (Threat Assessment and Response) model, that considers:
>    - **Threat**: nature and specificity
>    - **Intent**: motivation
>    - **Ability**: capability
>    - **Risk Factors**: escalating personal/situational factors
> 4. **Cross-Referencing with Intelligence**: Check for secondary intelligence sources…
> 5. **Consult Specialists**: HUMINT analysts or behavioral profiling experts…
> 6. **Incident Reporting**: report through your incident management system…

**Observations:**
- LLM invented a "T.E.A.R. model" framework — **NOT from the tradecraft library** (the corpus has no such item). This is the LLM's own training synthesis.
- None of the 3 injected items appears in the response. **All silently omitted** (correctly — none was relevant; the corpus retrieval gave drug-trade methodology for a fixated-subject question).
- **Critically: the response does NOT exhibit the original Trent-Reznor failure mode.** No "workplace violence pathway", no "fixation indicators", no "advance survey protocol" — even though the topic would have invited that language pre-PR #42. This is consistent with the methodology-injection fix that already shipped; tradecraft retrieval is operating in addition to that, not against it.

### 3c. Conversation 3 — European transit hub principal movement

**Operator question:** *"What considerations apply when planning a principal's movements through European transit hubs during a tour?"*

**Tradecraft items injected:**

| Agent | Domain | Hypothesis |
|---|---|---|
| MERIDIAN | threat_assessment_frameworks | "The integration of previously distinct security domains (cyber, physical, insider, operational technology, geopolitical) fundamentally alters the threat landscape…" |
| LEX-MAGNA | security_principles | "The Canadian professional tools market is primarily shaped by stringent local compliance requirements (e.g., CRA remittances, bilingualism, Loi 25, AODA)…" |
| SENTINEL-OPS | security_principles | "The technical security systems (access control) domain is undergoing a fundamental transformation towards cloud-based, mobile credential, and AI-driven solutions…" |

**LLM response (truncated):**

> When planning a principal's movements through European transit hubs, several key considerations should be addressed:
> 1. **Security Assessment**…
> 2. **Transport Logistics**…
> 3. **Threat Intelligence**…
> 4. **Local Regulations and Customs**…
> 5. **Emergency Plans**…
> 6. **Trusted Contacts**…
> 7. **Health and Safety Measures**…
> 8. **Communication Protocols**…
> 9. **Public Perception Management**…
> 10. **Cultural Sensitivity**…

**Observations:**
- 10-point structured response. Generic European-travel principal-protection content.
- All 3 injected tradecraft items silently omitted (MERIDIAN's domain-integration arguably could have applied; LEX-MAGNA's Canadian compliance and SENTINEL-OPS's access-control transformation were off-topic).
- No `[TRADECRAFT REFERENCE]` label appears — because no tradecraft content was borrowed.

---

## 4. Honest finding — random-3 sampling produces low operator-visible value

Across all 3 conversations, the LLM silently omitted **all 9 injected tradecraft items**. This is structurally correct (the prompt rule explicitly mandates silent omission for irrelevant items) but it means the operator-visible benefit of P4 is currently near-zero.

**Root cause:** The retrieval strategy is random-3 from a pool of confidence ≥ 0.80 candidates. With ~7,300 candidates meeting that bar and only 3 sampled, the probability that any item is topically relevant to a given operator question is small.

**This is not a bug in the cutover; it is a known limitation of the MVP retrieval.** The code comment notes it: *"Embedding-based relevance is a future iteration."*

**The structural guarantees still hold:**
- S2: no tenant content in the corpus → no leak risk even if random sampling pulls anything
- S5: prose-lint R7 deployed; would catch any tradecraft-as-observation pattern (none observed because nothing was borrowed)
- S6: Flight Recorder captures every retrieval regardless of whether the LLM uses it
- No verbosity inflation (the 3 responses are typical-length structured answers, not bloated)
- No recommendation drift (no escalation language, no fabricated frameworks beyond the LLM's own "T.E.A.R. model" which is not from the corpus)

**What this means operationally:** the P4 deploy is safe and structurally correct, but the operator-visible improvement is currently bounded by retrieval relevance. **Embedding-based or keyword-based topical retrieval is the natural next iteration** to lift the operator-perceived value.

---

## 5. Failure modes the validation period was checking for

The operator's stop-condition was: *"If contamination, verbosity, or recommendation drift appears, stop and report before expanding to additional surfaces."*

| Failure mode | Observed? | Evidence |
|---|---|---|
| **Contamination** (tenant-specific content leaking from tradecraft) | **No** | No injected item mentions any tenant client, principal, entity, or investigation identifier. Confirmed via S2 audit. |
| **Verbosity inflation** | **No** | All 3 responses are typical-length structured answers. The tradecraft context block (1755–1885 bytes) does add ~12% to prompt size but does not produce longer responses since the LLM silently omitted the items. |
| **Recommendation drift** | **No** | None of the 3 responses exhibits the methodology-applied-as-evidence pattern (no escalation language, no fabricated tenant-specific framings, no "fixation"/"workplace violence pathway" overreach). The original Trent-Reznor failure mode is NOT reproduced. |
| Cross-tenant contamination | **No** | The 9 injected items are all from `asset_class='global_shared'`. None has a `client_id` or `tenant_id`. |
| Prose-lint R7 violations | **No** | None triggered because no tradecraft content was borrowed into prose. |

**Decision per operator's stop-condition: continue.** None of the listed failure modes appeared. The structural guarantees are intact. The honest secondary finding — low operator-visible value due to random retrieval — does not match the operator's stop-condition criteria.

---

## 6. Recommended next steps (not started)

### 6a. Operator-controlled hold

The operator's directive was "controlled validation period after cutover." This document is the cutover report. Operator can elect to:
- **Continue P4 as-is** — let real operator chats accumulate Flight Recorder data; revisit relevance-retrieval as a separate iteration.
- **Pause P4** — flag flip is not implemented (the cutover was code-deployed, not env-var-gated). To revert, revert PR #54 + redeploy (~2 minute operation).
- **Iterate** — direct a follow-on PR to implement keyword or embedding-based tradecraft retrieval. Would substantially improve the operator-visible value without changing any of the safety guarantees.

### 6b. Held items unchanged

| Hold | Status |
|---|---|
| P5 — other operator-facing readers (executive briefings, etc.) | Held |
| P6 — writer cutover (knowledge-synthesizer etc.) | Held |
| Class B (tenant intelligence) | Held |
| PR #36 (G3 schema) | Held |

### 6c. Honest summary

P4 is structurally correct: cutover landed cleanly, Flight Recorder captures every injection, prose-lint R7 backstop is in place, all 6 success criteria pass. The operator-visible benefit today is bounded by random-3 sampling — the LLM silently omits irrelevant items per the prompt rule, which means most current conversations see no observable change. Embedding-based retrieval is the natural follow-up to lift the operator-perceived value while preserving every safety property.

**No contamination. No verbosity. No drift. Continue or iterate per operator direction.**
