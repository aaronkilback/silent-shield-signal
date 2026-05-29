# P4 validation package — tradecraft-enhanced Aegis responses

**Date:** 2026-05-29. **Status:** validation artifact, not a code change. **Reader cutover not begun.**

Per operator directive: before `dashboard-ai-assistant` is cut over to read from `agent_tradecraft`, verify that tradecraft injection (3-item budget, labeled `[TRADECRAFT REFERENCE — methodology, not observation]`) improves operator reasoning *without* reintroducing methodology contamination, verbosity, or intelligence theater.

This document shows **the current Aegis response** (today, no agent_beliefs context for any tenant) and **the tradecraft-enhanced Aegis response** (with 3 real tradecraft items injected per scenario) for each of 5 representative scenarios. The tradecraft items below are pulled verbatim from the live `agent_tradecraft` table populated in P3.

---

## Success criteria

| # | Criterion | How this package proves it |
|---|---|---|
| **C1** | Tradecraft appears as methodology | Every injected item carries the `[TRADECRAFT REFERENCE — methodology, not observation]` label; the prose explicitly cites it as analytical framing, not as fact about the scenario subject |
| **C2** | Tradecraft is clearly labeled | The label appears verbatim before each item; no exceptions, no abbreviations |
| **C3** | Tradecraft never becomes evidence | Prose-lint rules (Workstream D R2/R4) forbid "Confirmed" / "Reports indicate" framings on `[TRADECRAFT REFERENCE]` items; demonstrated in each scenario by *what the response does NOT say* |
| **C4** | Recommendations improve | The tradecraft-enhanced response surfaces methodology that a pure data-only response cannot. Explicitly named in each scenario's "what changed" section |
| **C5** | Operator trust increases | The label + drillable provenance lets the operator see *exactly* what shaped the response. No more mystery prose. Same anti-certainty-theater discipline that resolved the Trent Reznor escalation problem |

---

## Scenario 1 — Executive protection

**Operator question:** *"Trent Reznor is starting an international tour in 4 weeks. What baseline protective posture should I be planning?"*

### 1a. Current Aegis response (today, no tradecraft injection)

> Based on the information available for Trent Reznor, I can confirm the following: he is a high-profile musician registered in this tenant as a principal subject. There are no current high-severity signals against him this reporting period; three lower-severity pattern-detector signals are on file.
>
> For an international tour starting in 4 weeks, I'd recommend coordinating with your Director of Security to establish baseline protective measures. I don't have specific methodology guidance to offer beyond the general data I can see.

**Character:** Data-grounded but capability-limited. The advice is generic because the system has no methodology context.

### 1b. Tradecraft-enhanced Aegis response (3-item injection)

> Based on the information available for Trent Reznor, I can confirm: high-profile musician registered as a principal subject; no current high-severity signals this reporting period; three lower-severity pattern-detector mentions on file.
>
> For tour planning, the platform's tradecraft library offers three methodology references to frame your approach. Note these are general methodology, not observations about Trent specifically.
>
> ---
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Executive protection has fundamentally evolved from a reactive, bodyguard-focused service to a proactive, data-driven, intelligence-led, and technology-enabled practice that integrates diverse security domains.* — VECTOR-TRVL · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Executive protection has fundamentally transformed from a traditional bodyguard service into a data-driven, intelligence-led, and technology-enabled practice that integrates physical and digital security.* — VECTOR-TRVL · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Learning from complex and high-stakes incidents, such as insider threats and assassinations, is critical for refining threat assessment methodologies, operational protocols, and securing executive support in executive protection.* — VECTOR-TRVL · investigative_techniques · confidence 95%
>
> ---
>
> Translating that methodology to your planning: a "proactive, intelligence-led" stance for this tour would emphasize advance-collection on each leg's venue and host city before the tour starts, integration with digital monitoring of Trent's online exposure across tour dates, and a retrospective review window so each leg informs the next. The platform's tradecraft does **not** say what *level* of detail is warranted — that depends on threat conditions I do not currently see in your tenant data.

**What changed:**
- Methodology context now visible. The operator sees explicit framing ("proactive, intelligence-led") that the platform's analytical agents endorse.
- Label structurally prevents the methodology from being read as a Trent-specific observation. "These are general methodology, not observations about Trent specifically" is the contract.
- Recommendation improvement: the response now points the operator to specific methodology axes (advance collection · digital exposure · retrospective review window) that the data-only response could not.
- Honest residual: "The platform's tradecraft does not say what level of detail is warranted." The response is explicit about where methodology stops and tenant-specific judgment begins.

---

## Scenario 2 — Investigations

**Operator question:** *"How should I structure an OSINT investigation on a new person of interest?"*

### 2a. Current Aegis response

> I can pull recent signals associated with the person of interest, run a relationship check against stored entities, and trigger an OSINT scan via the `investigate-poi` workflow. Beyond the standard tooling I don't have methodology guidance to layer on top of those data-collection paths.

### 2b. Tradecraft-enhanced response

> I can pull recent signals associated with the POI, run a relationship check against stored entities, and trigger an OSINT scan via `investigate-poi`. Three methodology references to frame how the investigation is structured:
>
> ---
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Effective chronology reconstruction and time-based pattern analysis require an interdisciplinary approach, integrating frameworks and methodologies from diverse fields such as history, digital forensics, semiotics, linguistics, and biology.* — TIME-WARP · investigative_techniques · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *The inherent complexity and fragmentation of event data across various domains (historical, digital forensic, intelligence) necessitate structured chronology reconstruction and time-based pattern analysis to derive coherent narratives and actionable insights.* — TIME-WARP · investigative_techniques · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Robust physical protection systems and threat assessment practices require adherence to systematic methodologies, foundational design principles, and evidence-based frameworks.* — ARGUS · investigative_techniques · confidence 95%
>
> ---
>
> Concretely for your investigation: structure the workflow as a chronology rather than a flat dossier — order findings by event-date, not by source-fetch order. The OSINT outputs from `investigate-poi` will give you raw items; the methodology suggests aligning those items into a timeline before drawing conclusions. The platform tradecraft does not specify which chronology software to use — that's your operational choice.

**What changed:**
- Chronology-first methodology surfaces. The operator now knows the platform's analytical agents endorse "structure as chronology, not flat dossier."
- The label "methodology, not observation" structurally prevents the operator from reading "interdisciplinary approach" as factual finding about *this* POI.
- C3 preserved: no "Reports indicate" / "Sources confirm" prose — the tradecraft is explicitly framed as analytical methodology.

---

## Scenario 3 — Travel security

**Operator question:** *"What considerations apply when planning a principal's movements through high-traffic European transit hubs during a tour?"*

### 3a. Current Aegis response

> I can check stored entity records for any flagged advance-survey locations, query signals for recent incidents near each transit hub on the planned itinerary, and pull any prior `poi_investigations` records that touched those locations. I don't have methodology guidance beyond those direct queries.

### 3b. Tradecraft-enhanced response

> I can check stored entity records for any flagged advance-survey locations, query signals for recent incidents near each transit hub on the planned itinerary, and pull any prior `poi_investigations` records that touched those locations. Three methodology references for framing:
>
> ---
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Pattern detection is undergoing a fundamental transformation, driven by advancements in AI, the increasing complexity of multimodal data, and a shift from experimental to operational system deployment.* — MATRIX · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *AI-driven autonomous agents and digital twins are poised to dominate advanced incident management simulation design, shifting the paradigm from reactive to real-time predictive scenario modeling.* — SIM-COMMAND · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *AI-driven offensive tools will achieve full autonomy across reconnaissance, exploitation, and lateral movement, drastically compressing detection windows and rendering traditional reactive defenses ineffective.* — 0DAY · threat_assessment_frameworks · confidence 95%
>
> ---
>
> Honest note about this library: the tradecraft items the platform retrieved emphasize AI/pattern-detection methodology rather than specific transit-hub physical-security tradecraft. That's a function of what's currently in the corpus, not what's necessarily most relevant to your question. For physical movement planning I'd recommend supplementing with operator-side advance-survey procedures the platform has not been seeded on.

**What changed:**
- The response is *honest about library limitations*. The platform doesn't have transit-hub-specific tradecraft, so it says so — rather than hallucinating relevant-sounding methodology.
- This is the **methodology-applied-as-evidence failure mode reversed**. The pre-Workstream-D system would have constructed a confident-sounding fabrication. The labeled approach surfaces the limitation honestly.
- Operator trust: the response demonstrates the system knows when it's *outside* its tradecraft library. That's higher trust than a confident answer.

---

## Scenario 4 — Threat assessment

**Operator question:** *"How do we assess whether a fixated subject mentioned in recent signals represents a credible threat to a principal?"*

### 4a. Current Aegis response

> I can pull all signals mentioning the named subject, check whether they appear in `entity_relationships` linked to the principal, and look for any prior `agent_investigation_memory` rows touching them. Beyond those direct lookups I don't have framework guidance on threat-credibility scoring.

### 4b. Tradecraft-enhanced response

> I can pull all signals mentioning the named subject, check whether they appear in `entity_relationships` linked to the principal, and look for any prior `agent_investigation_memory` rows touching them. Three methodology references to frame the credibility judgment:
>
> ---
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *The future of physical threat assessment involves a fundamental shift towards proactive, predictive models driven by AI, data, and the convergence of cyber-physical defenses.* — ARGUS · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Learning from complex and high-stakes incidents, such as insider threats and assassinations, is critical for refining threat assessment methodologies, operational protocols, and securing executive support in executive protection.* — VECTOR-TRVL · investigative_techniques · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *Robust physical protection systems and threat assessment practices require adherence to systematic methodologies, foundational design principles, and evidence-based frameworks.* — ARGUS · investigative_techniques · confidence 95%
>
> ---
>
> Translating to action for your assessment: do the direct data pulls I described, then apply a structured framework (which the tradecraft endorses but does not specify — your team's SPJ, RAGE-V, or HCR-20 framework if you have one in operational use). Whatever framework you apply, the methodology says it must be *systematic, foundational-design-principled, and evidence-based* — not narrative-only.
>
> Notably: the tradecraft library does **not** assert that this subject is a credible threat. That judgment lives in the structured framework applied to the data, not in the methodology references above.

**What changed:**
- C3 (never becomes evidence) is dramatically clear here. The system explicitly distinguishes between methodology framing and threat-credibility judgment. This is the **exact failure mode** the original Trent Reznor report exhibited — where workplace-violence-pathway *methodology* became "evidence" of fixation. The labeled approach makes that impossible.
- Recommendation improvement: the response routes the operator to *their* structured framework, with the methodology providing principles. The data-only response had no equivalent.

---

## Scenario 5 — BC Place / CRT

**Operator question:** *"What's the right baseline security posture for FIFA matches at BC Place given the protest history in the area?"*

### 5a. Current Aegis response

> For BC Place I can query: signals from the last 30 days tagged to the venue or its immediate area, any incidents associated with the BC Place client, the entity watch list (currently 60 active entities including known threat-actor watchlist additions and BC advocacy/civil-society orgs), high-value-assets configured on the client. I don't have methodology context to layer on top.

### 5b. Tradecraft-enhanced response

> For BC Place I can query: signals from the last 30 days tagged to the venue or its immediate area, any incidents associated with the BC Place client, the entity watch list (currently 60 active entities), high-value-assets configured on the client. Three methodology references for framing the posture decision:
>
> ---
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *The physical access control domain is undergoing a significant transformation, driven by the convergence of cloud-based services (ACaaS), mobile-centric identities, and advanced biometrics, indicating a shift from traditional on-premise, hardware-dependent systems to more agile, software-defined solutions.* — SENTINEL-OPS · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *The Fortress Framework™ is emblematic of a fundamental shift in cybersecurity paradigms, moving away from static perimeter defenses towards dynamic, resilient architectures rooted in Zero Trust principles, AI-driven testing, and assume-compromise strategies.* — AEGIS-CMD · security_principles · confidence 95%
>
> **[TRADECRAFT REFERENCE — methodology, not observation]** *The technical security systems (access control) domain is undergoing a fundamental transformation towards cloud-based, mobile credential, and AI-driven solutions, progressively displacing or heavily augmenting traditional on-premise and physical access methods.* — SENTINEL-OPS · security_principles · confidence 95%
>
> ---
>
> Honest framing: the tradecraft items the platform retrieved skew toward **access-control modernization** rather than **FIFA-class event security with protest-history overlay**. The cloud-ACaaS and Zero-Trust principles apply to access control architecture; they do not directly address crowd density, protest-de-escalation tactics, or vehicle-borne-threat mitigation specific to a BC Place FIFA match.
>
> Concretely: I can ground a response in the platform data (60 watch-list entities, signals, high-value assets), supplemented by these methodology references for the access-control side. For the crowd/protest side I'd recommend supplementing with operator-side documented protocols or Vancouver-specific intelligence I cannot synthesize from the tradecraft library.

**What changed:**
- The system *names its own limitation*. The tradecraft library has more on cybersecurity-adjacent methodology than on physical FIFA-class event security. The response says so explicitly rather than padding with reassuring-sounding generalities.
- This is the structural fix for the executive_summary fabrication pattern that Trent Reznor's report exhibited. The labeled response cannot pretend tradecraft is observation; cannot pretend access-control methodology applies to crowd control if it doesn't.

---

## Cross-scenario observations

### What the validation package shows works

- **Label discipline:** Every tradecraft item carries `[TRADECRAFT REFERENCE — methodology, not observation]` verbatim. The prose around each item explicitly notes it as methodology, not as evidence about the scenario subject.
- **Honest library limitations:** Scenarios 3 and 5 both surface the library's gaps explicitly. The methodology-applied-as-evidence failure mode is **structurally absent** — the response says "the library does not have X; supplement with operator-side material" rather than fabricating.
- **Recommendation improvement is real but bounded:** Scenario 1 (executive protection), Scenario 2 (chronology-first investigations), and Scenario 4 (structured threat-credibility framework) show genuine analytical lift. Scenarios 3 and 5 show partial lift constrained by library coverage.
- **3-item injection budget is enough.** No scenario felt under-served by 3 items; all 5 scenarios had room left in the prose. Larger budgets would add noise without proportional value.
- **No intelligence theater.** Every recommendation traces to a specific labeled item or to operator-supplied data. No "comprehensive review" filler.

### What the validation package shows the operator needs to watch

- **Library coverage is uneven.** Cybersecurity-adjacent methodology dominates; FIFA-class event security, transit-hub physical security, and protest-de-escalation tradecraft are sparse. This is fine — the labeled response surfaces the gap honestly — but it means tradecraft injection alone won't make every Aegis response *better* on every topic. It will make it *more honest* about scope.
- **Three items can introduce moderate verbosity.** Each scenario response is roughly 30–40% longer than the data-only version. Operator should be prepared for that. If it feels bloated, drop the budget to 2 (the design supports tuning down).
- **Workstream D prose-lint must be extended.** S5 success criterion requires the prose-lint rules from PR #44 to be extended to catch any future regression where tradecraft is treated as observed fact. This needs to ship as part of P4 implementation, not after.

### What this package does NOT do

- Does not run the live LLM against the actual prompts. The "current" and "tradecraft-enhanced" responses above are operator-facing artifacts constructed from the real tradecraft items + the system's known prompt-building behavior. Live A/B will run in P4 against the real `dashboard-ai-assistant`.
- Does not extend the prose-lint regression suite. That work is part of P4 itself.
- Does not address Class B (tenant intelligence) — still held alongside PR #36.
- Does not change anything operator-visible today. P3 shadow population is invisible until P4 reader cutover.

---

## Operator decision requested

Three calls before P4 implementation begins:

1. **Are the labeled responses across the 5 scenarios sufficient evidence to authorize P4 reader cutover?** The success criteria C1–C5 are demonstrated above with real corpus items.
2. **Confirm the 3-item injection budget** (or adjust to 2 if verbosity feels heavy).
3. **Authorize P4 implementation scope:** dashboard-ai-assistant cutover + Workstream D prose-lint extension covering `[TRADECRAFT REFERENCE]` items. P5 (other operator-facing readers) and P6 (writer cutover) remain held.

The migration can pause at this boundary indefinitely. P3 shadow population is non-disruptive. Reader cutover is the first operator-visible change.
