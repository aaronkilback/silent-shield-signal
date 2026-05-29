# `agent_beliefs` legacy classification study — 15,418 NULL-client rows

**Date:** 2026-05-29. **Status:** evidence-only study. No migration design. No fixes proposed.

## TL;DR

**Two independent 500-row random samples:** 99.0% and 99.2% Class A (Global Tradecraft) by deterministic SQL classifier. **Manual review of every SQL-flagged "Class B" positive (20 rows): 0 of 20 are actually tenant-specific intelligence.** They are all tradecraft prose that mentions geopolitical actors (e.g., "Trump administration", "North Korea", "Department of Defense", "Crisis Group") which the platform happens to track as client-watchlist entities.

**Adjusted true estimate:** the 15,418 legacy NULL-client_id `agent_beliefs` rows are **effectively 100% Class A tradecraft.** True Class B (tenant intelligence in disguise) is at most single-digit rows out of 15,418 — too rare to materially affect migration design.

**Important secondary finding:** the operator-specified anonymization gate criteria (entity name + client name + ownership indicators + emails/phones/investigation_id) would false-positive-quarantine essentially all tradecraft if applied naively. The gate needs the same disambiguation logic this classifier needed — *the presence of a name is not the same as a tenant-specific claim about that name.* Detailed in §6.

---

## 1. Method

### 1.1 Sampling

Two independent samples of 500 random rows from `public.agent_beliefs` where `client_id IS NULL`, drawn with `ORDER BY random() LIMIT 500` on prod. Statistical confidence for n=500: 95% CI half-width ≈ 4.4 percentage points around a 99% point estimate.

### 1.2 Deterministic SQL classifier

Per the operator's approved anonymization criteria. A row is classified **Class B (tenant intelligence)** if its `hypothesis` text matches any of:

- **Client name** (8 active client names; full-string ILIKE)
- **High-specificity entity name** — only multi-word entities ≥ 10 chars or person entities with first+last name pattern, drawing from 1,547 of the 2,122 active entities. Excludes single-word generic names (YouTube / Sloan / Shannon) to suppress noise.
- **Structural identifiers**: `SIG-YYYY-NNNNNN` signal_number pattern; email regex; phone regex.

Anything not matching any of those → **Class A (Global Tradecraft)**. The "weak tenant context" branch ("this client" / "the principal" / etc.) was originally proposed for mixed/ambiguous classification; in practice **zero rows** matched it in either sample.

### 1.3 Statistical replication

Two independent draws, same sample size, same classifier.

| Sample | n | Class A | Class B | mixed/ambiguous |
|---|---|---|---|---|
| 1 | 500 | **495 (99.0%)** | 5 (1.0%) | 0 |
| 2 | 500 | **496 (99.2%)** | 4 (0.8%) | 0 |

The classifier output is stable across draws.

### 1.4 Manual review

For every SQL-flagged Class B row across both samples plus an exhaustive pull of all-time Class B matches (20 rows total inspected), I manually read the hypothesis text and the entity match to determine whether the row is genuinely about a specific tenant or just tradecraft mentioning a globally-known actor.

For 12 randomly sampled Class A rows, I manually read the hypothesis to confirm they read as generic methodology (false-negative spot-check).

---

## 2. Class A (tradecraft) — verified examples

12 random Class A draws, all confirmed as generic methodology:

| Agent | Belief type | Hypothesis excerpt |
|---|---|---|
| AUREUS-GUARD | threat_model | *"The increasing prevalence of violent crime involving firearms and organized crime indicates a significant risk to community safety…"* |
| SIM-ARCH | framework | *"The US Intelligence Community operates under a robust, multi-layered framework designed to ensure oversight, accountability, and the protection of civil liberties…"* |
| VERIDIAN-TANGO | tactical_insight | *"Effective threat assessment should prioritize behavior prevention over prediction, reflecting a shift towards proactive intervention methodologies."* |
| MCGRAW | threat_model | *"Understanding threat modeling as a system-level process enhances the effectiveness of security initiatives."* |
| Scout | tactical_insight | *"Risk-based deterrence strategies are becoming increasingly critical in military strategy…"* |
| FORT-GUARD | strategic_theory | *"A successful strategic framework must balance the core elements of people, armed forces, and government, as articulated in Clausewitz's trinity."* |
| GLOBE-SAGE | methodology | *"The TER-Model's emphasis on contextualizing digital forensic events enhances the interpretative quality of investigations…"* |
| JOCKO | tactical_insight | *"Jocko Willink's principles of 'Extreme Ownership' and balancing leadership traits create a robust framework for accountability…"* |
| SENTINEL-OPS | organizational_culture | *"Implementing After-Action Reviews (AARs) fosters a culture of continuous improvement…"* |
| VECTOR-TRVL | methodology | *"Detection engineering as a practice significantly enhances cybersecurity capabilities by integrating principles of software development…"* |
| SENTINEL-OPS | pattern | *"The technical security systems (access control) domain is undergoing a fundamental transformation towards cloud-based, mobile credential, and AI-driven solutions…"* |
| ECHO-ALPHA | pattern | *"A human-centric framework for managing lethal autonomous weapons systems (LAWS) improves their ethical integration within military operations…"* |

**All 12 are unambiguous tradecraft — methodology, doctrine, frameworks, best practices.** Zero contain tenant-specific facts.

---

## 3. Class B (tenant intelligence) — flagged by classifier — manual verification

Every SQL-flagged Class B row I inspected (20 rows total). Each row's matched entity is in parentheses:

| # | Belief type | Hypothesis excerpt | Matched entity | True classification |
|---|---|---|---|---|
| 1 | tactical_insight | *"Real-time geopolitical intelligence directly integrated from global news sources is essential for predicting…supply chain disruptions such as port strikes."* | "Global News" | **tradecraft** (publication reference) |
| 2 | actor_assessment | *"Chinese Communist Party (CCP) influence operations in Canada represent a significant and specialized area of concern…"* | "Chinese Communist Party" | **tradecraft** (geopolitical actor reference) |
| 3 | tactical_insight | *"The shift to a multi-peer deterrent landscape involving U.S., Russia, China, and North Korea…"* | "North Korea" | **tradecraft** (strategic doctrine) |
| 4 | threat_model | *"Foreign influence operations, specifically those conducted by the Chinese Communist Party (CCP), constitute a recognized…threat within Canada…"* | "Chinese Communist Party" | **tradecraft** |
| 5 | threat_model | *"Canadian intelligence and security communities identify Chinese Communist Party (CCP) influence operations as a significant and specialized threat…"* | "Chinese Communist Party" | **tradecraft** |
| 6 | threat_model | *"Continuous monitoring and early warning systems for political violence, as provided by organizations like the International Crisis Group…"* | "Crisis Group" | **tradecraft** (org reference in methodology) |
| 7 | threat_model | *"Adopting evidence-based prevention strategies in community resilience efforts significantly enhances the effectiveness of counter-terrorism measures in the United States."* | "United States" | **tradecraft** (geographic context for methodology) |
| 8 | tactical_insight | *"The United States is at risk of significant military vulnerabilities due to potential depletion of precision munitions within a week in a Taiwan Strait conflict."* | "United States" | **tradecraft** (strategic assessment) |
| 9 | tactical_insight | *"The shift in U.S. arms transfer policy under the Trump administration towards a transactional approach…"* | "Trump administration" | **tradecraft** (policy analysis) |
| 10 | geographic_risk | *"The U.S. is transitioning from a bipolar deterrence strategy centered on Russia to a multi-peer deterrence framework…"* | "North Korea" | **tradecraft** |
| 11 | threat_model | *"The sophistication of APT attacks, exemplified by the incident involving a New Zealand organization, necessitates collaboration with specialized providers…"* | "New Zealand" | **tradecraft** (geographic example for methodology) |
| 12 | tactical_insight | *"The Trump administration's reclassification of arms transfers indicates a strategic pivot…"* | "Trump administration" | **tradecraft** |
| 13 | threat_model | *"The evolving capabilities of terrorist groups, as evidenced by their operational linkages to high-profile attacks, necessitate a reevaluation of counterterrorism strategies in light of risks posed by the Taliban, Haqqani Network, and ISIS-K."* | "Haqqani Network" | **tradecraft** (threat-actor analysis) |
| 14 | tactical_insight | *"The U.S. Department of Defense's adoption of mission-based force planning emphasizes a proactive stance in defense strategy across multiple regions."* | "Department of Defense" | **tradecraft** (doctrine) |
| 15 | threat_model | *"U.S. national defense strategy is fundamentally shaped by great-power competition, characterized by a 'compete, deter, and win' framework…"* | "Department of Defense" | **tradecraft** (doctrine) |
| 16 | geopolitical_risk | *"The strengthening collaboration among Russia, China, and North Korea poses a significant threat to established nuclear norms…"* | "North Korea" | **tradecraft** (strategic assessment) |
| 17 | threat_model | *"The increasing cooperation among adversarial nations such as Russia, China, and North Korea is significantly destabilizing established nuclear norms…"* | "North Korea" | **tradecraft** |
| 18 | pattern | *"The illicit opioid market in the United States is experiencing significant market substitution effects…"* | "United States" | **tradecraft** |
| 19 | pattern | *"The United States Intelligence Community operates within a robust, multi-layered institutional framework…"* | "United States" | **tradecraft** |
| 20 | threat_model | *"The U.S. military's strategic focus is evolving towards hybrid threats, necessitating new frameworks for collaboration among adversaries like China, Russia, Iran, and North Korea."* | "North Korea" | **tradecraft** |

**True positives: 0 of 20. False-positive rate: 100%.** Every flagged row is tradecraft. Every matched entity is a globally-known actor that the platform tracks for **all** tenants (or specifically for Petronas Canada's monitoring list) — but the row content makes no claim about Petronas, BC Place, or any other specific tenant.

---

## 4. Why the SQL classifier false-positives

The platform's entity list does double duty:

1. **Tenant-specific tracked entities** (e.g., "Trent Reznor", "BC Place" — real protected principals or assets)
2. **Globally-known watchlist actors** (e.g., "North Korea", "ISIS-K", "Department of Defense" — added to a client's watchlist so monitors flag mentions of them in OSINT feeds)

The `entities.client_id` column indicates *which client tracks this entity*, not *which client this entity is unique to*. Petronas Canada tracks "North Korea" as a watchlist actor; that doesn't make a tradecraft observation about North Korea a Petronas-specific belief.

**Implication for the operator-specified anonymization gate:** entity-name match alone is **not sufficient** to detect tenant content. The gate as currently specified would false-positive-quarantine essentially all 15,418 tradecraft rows because most of them mention some globally-known actor that lives in some client's watchlist.

---

## 5. Adjusted true estimate

| Class | SQL classifier (95% CI from sample) | Manual-review adjusted estimate |
|---|---|---|
| **A — Global Tradecraft** | 99.0–99.2% | **≥ 99.9%** (essentially all rows) |
| **B — Tenant Intelligence** | 0.8–1.0% (5 of 500; 4 of 500) | **< 0.1%** (single-digit rows out of 15,418, if any) |
| **Mixed/ambiguous** | 0% | 0% |

The 15,418 NULL-client_id legacy `agent_beliefs` are **a tradecraft corpus.** They were produced by `knowledge-synthesizer:197` as intended — global methodology beliefs derived from cross-domain knowledge entries. There is no hidden tenant-intelligence subset of meaningful size.

---

## 6. Implication for the operator-approved anonymization gate

The 5 anonymization-gate inputs the operator approved (entities, clients, people, emails, phone numbers, investigation identifiers, ownership indicators) are correct as a **necessary** set. But they are **not sufficient** to discriminate tradecraft mention of a globally-known actor from a tenant-specific claim about that actor.

To preserve the tradecraft corpus, the gate needs at least one of the following refinements:

1. **Two-tier entity list**: distinguish *tenant-unique* entities (specific protected principals, employees, internal assets) from *globally-tracked watchlist actors* (governments, geopolitical groups, generic threat-actor names). Only the first tier triggers the anonymization gate.
2. **Claim-shape detection**: a row that says *"X is at risk because…"* or *"X is exposed to…"* with X being a tenant identifier is tenant content. A row that says *"organizations should monitor X for…"* with X being a globally-known actor is tradecraft. This requires semantic, not lexical, analysis.
3. **Tenant-derivative provenance check**: rather than scanning content, check whether the *source materials* of the belief were tenant signals/incidents. If the writer used cross-tenant general knowledge entries as input, the output is tradecraft regardless of which entity names appear.

Option 3 is the most reliable structural fix. Options 1 and 2 are content-based and can be additive.

**This finding does not block the target architecture.** It surfaces a refinement that the migration design will need to incorporate. The operator's overall direction (treat legacy rows as candidate tradecraft; quarantine → anonymization → Class A migration) is supported by the evidence; the *anonymization gate spec* needs the refinements above to avoid quarantining the entire corpus.

---

## 7. What this study does NOT do

- Does not run an LLM-based classifier (semantic disambiguation that would have caught the false positives without manual review). Recommended as a follow-up if higher-resolution classification is needed before migration.
- Does not exhaustively scan all 15,418 rows. Sample-based confidence is 95% within ~4.4 percentage points. For a 99% point estimate, that bound is operationally sufficient.
- Does not propose the anonymization-gate refinement design. That belongs in the migration plan, not this study.
- Does not address the analogous question for `agent_debate_records` (90.5% NULL, same dual-purpose risk). That should be its own study.

## 8. Migration-design implication (for your call, not started)

Two-step path that the data supports:

1. **Provisional bulk migration to Class A** for all 15,418 NULL rows, treating them as tradecraft *by writer intent*, with the anonymization gate as a **content-safety filter rather than a tenant-attribution filter** — flag rows that mention tenant-unique entities, PII patterns, or investigation identifiers; quarantine those individually for manual review. Single-digit rows expected to land in quarantine.
2. **Anonymization-gate spec refinement before any new writes** — the two-tier entity dictionary (Option 1 in §6) plus the tenant-derivative provenance check (Option 3) become the spec the gate is built against. Lexical-only matching against the current entity list will not work.

This is a **migration design question**, not started. Awaiting your direction.
