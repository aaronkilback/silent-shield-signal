# WO-OUTPERFORM-3SI — Master Specification
**The unifying objective for the coverage, quality, and evaluation workstreams**
Drafted 2026-07-11. Status: spec for review, not in build queue until operator GO per section 8.

---

## 1. The objective, stated once

Fortress's commercial thesis, made precise: **AEGIS must produce protective intelligence that beats what a chatbot gives the client (the Gemini floor) and rivals-then-exceeds what professional human analysts give them (the 3Si ceiling) — sourced, calibrated, continuously updated, at a fraction of the cost of either.**

The operator's honest gap assessment, which this spec treats as ground truth:
- **Detection gap (we lose today):** Fortress would not find the source material 3Si finds. The 3Si weekly report is substantially a social-media intelligence product (Instagram, X, follower-network analysis, protest imagery). Fortress social coverage has been dead since 2026-05-26.
- **Context gap (we win today):** 3Si structurally lacks operational context. It would not surface a police event in Fort St. John, a wildfire bearing on a corridor, a court filing, or a weather event, and explain the risk in client-asset terms. Fortress has the infrastructure 3Si lacks: NAAD, BCWS wildfire, court registry, PostGIS assets/corridors, continuous cadence vs. weekly.

Strategy: **fight two fronts in order.** Win the context front now (articulation work, infrastructure exists). Close the detection front second (social restoration, already queued in WO-COVERAGE). The harness measures both fronts continuously.

**Relationship to canonical documents:** this spec is the current operational campaign in service of FORTRESS_VISION_UPDATE and FORTRESS_INTELLIGENCE_ARCHITECTURE — it operationalizes reportable reasoning (the sourcing dimension), the operational-memory moat (the fusion win-axis), and the Phase 3 outcome feedback loop (the grader-calibration mechanic), and it constructs the evaluation harness that the architecture doc's Phase 3.5 explicitly requires as its referee. The vision documents define Fortress's identity; this spec defines the current, measurable, benchmarked campaign in pursuit of it. Campaigns end; the vision does not. **Where this spec and the vision documents conflict, the vision documents govern and the conflict is surfaced to the operator** — no scorecard optimization may quietly redefine a founding principle (e.g., trading away the interpretability tax to win a speed dimension).

## 2. The benchmark anatomy — what 3Si-grade means

Derived from the PECL Weekly Security Awareness Report (2026-04-24 exemplar). These are the quality dimensions AEGIS output is graded against:

1. **Collection-plan discipline** — scoped to the client's stated requirements, not everything ingested.
2. **Evidence-in-report sourcing** — every claim carries a link, named source, or screenshot. No unsourced allegations.
3. **Judgment separation** — analyst opinion explicitly labeled (DEDUCTIONS / ANALYST COMMENT blocks), distinct from observed fact.
4. **Source-credibility assessment** — the report evaluates the *reporter's* agenda, not just the content (e.g., 3Si backgrounding the Point Source journalists).
5. **Calibrated ratings** — defined risk matrix (their Annex A pattern), honest in both directions, including explicit de-escalation ("scale and impact remain relatively limited"). No alarmism.
6. **Network tradecraft** — relational analysis (e.g., an account "followed by known BC-based anti-LNG activists" as an ideological-diffusion indicator).
7. **Honest scope disclaimer** — states what the report is and is not.

Plus the operator's own success-criteria document ("What Excellent Looks Like," authored at Fortress inception), which supplies the platform-side rubric: only meaningful items become signals; P1/P2 rare but always valid; every signal carries "why this is a signal"; noise decreases over time under feedback.

## 3. The win-axis 3Si cannot contest

**Operational-context fusion**: physical-world events (police, fire, weather, courts, road/infrastructure) correlated to named client assets with distance/exposure specificity, delivered continuously. 3Si scores zero on this axis by construction — their disclaimer scopes them to online open-source review, weekly cadence, no geospatial layer. Fortress's existing sensors (NAAD, BCWS, court registry, wildfire, PostGIS corridors) already produce the raw material; the deficiency is articulation quality (addressed by the briefing-quality WO), not capability.

Every AEGIS product must exercise this axis explicitly: name the asset, the distance, the exposure, the recommended posture. This is the differentiator this month, before the detection gap closes.

## 4. The harness — design

**Purpose:** a fixed measurement instrument that grades AEGIS weekly output against the 3Si benchmark on the section-2 dimensions plus the section-3 win-axis, producing a per-dimension gap score tracked over time. The harness measures; it never trains (the eventual Phase 3.5 synthetic loop trains, and uses this harness as its referee — see the architecture doc's Phase 3.5 constraints).

**Benchmark set:** the 3Si weekly reports uploaded under Petronas Canada (the archival set dispositioned during WO-DATA-INTEGRITY: the four Security Awareness Reports plus subsequent uploads).

**THE HELD-OUT RULE (non-negotiable):** the 3Si reports live inside Fortress and are retrievable by AEGIS. Grading AEGIS output against a report it can read is an open-book exam measuring paraphrase, not capability. Therefore: **time-separated, retrieval-quarantined grading.** When AEGIS generates its weekly product for week N, the 3Si report covering week N (and its derived entities/signals, if any were extracted at ingestion) must be excluded from AEGIS's retrieval context for that generation run. The comparison happens after generation. Implementation: a quarantine flag on benchmark documents honored by the retrieval layer during harness-mode generation, verified per run (rule 6: show the retrieval log proving the benchmark doc was not consumed). This mirrors the canary is_canary exclusion pattern already ratified.

**Grading dimensions and initial weights** (operator-tunable; these encode the operator's assessment of what matters to the client):
- Detection coverage — did AEGIS surface the same underlying events the 3Si report covers for that week? (weight: high; expected to score LOW until social restoration lands — that low score is honest and is the metric for front two's progress)
- Sourcing quality — every claim linked/evidenced; unsourced claims counted as violations (high)
- Operational-context fusion — the win-axis; physical events tied to named assets with specificity; 3Si baseline = 0 (high)
- Judgment separation — deductions labeled vs. blended (medium)
- Calibration honesty — ratings defensible from the evidence, including downward calls (medium)
- Source-credibility assessment — reporter/account agenda evaluated (medium)
- Canonical discipline — one versioned artifact, no duplicates (low; the Gemini floor dimension)

**Grader:** initial grading is a rubric-guided model pass producing per-dimension scores WITH cited justification for each score, followed by operator spot-review of a sample. The operator's overrides become the calibration set for the grader itself (the grader is also subject to the consumer test — if its scores are never reviewed, they drift). Scores and justifications ledgered per run.

**Cadence:** weekly, aligned to the 3Si report rhythm, so every 3Si delivery generates a fresh comparison point. Output: a one-page gap scorecard per week — dimension scores, delta vs. prior week, and the single largest gap with its root cause (sensor vs. synthesis vs. configuration).

**Gemini floor check:** a one-time (then per-major-change) comparison against the Calvin/Gemini due-diligence reports on the failure dimensions already identified (empty citations, missing network deliverable, duplicate versions). Pass criterion: AEGIS demonstrably clears all three. This is the CRT demo artifact's internal gate.

## 4b. Comparative instruments — the living floor and the benchmark library

**The LLM baseline panel (the living floor).** On each weekly harness run, the same reporting task is issued via API to a panel of frontier models (drawn from the providers the routing layer already supports), with the same *public* inputs AEGIS had for the week — explicitly excluding Fortress's proprietary signals, client taxonomies, and the benchmark corpus. Panel outputs are graded on the identical rubric alongside AEGIS's output. Purpose: the "better than LLM research" floor is a moving target as models improve; the panel makes the floor track reality weekly instead of freezing at three static Gemini reports. The input asymmetry (panel gets public info; AEGIS gets its infrastructure) is the honest commercial comparison — what a client gets from a chatbot vs. from the platform — and MUST be stated on the scorecard face so the comparison is never mistaken for, or accusable of being, a rigged same-inputs test. Side benefit: the weekly panel result IS the standing sales artifact for the "why not just use Gemini/ChatGPT" conversation — no bespoke demo assembly required.

**The professional benchmark library (the ceiling, multi-vendor).** The 3Si weekly reports seed the library; operator-uploaded reports from other professional vendors (Control Risks, International SOS, and future additions) extend it. Each vendor benchmarks a different professional capability — 3Si: social/narrative intelligence and analyst tradecraft; Control Risks: geopolitical depth and country-risk framing; ISOS: travel security and duty-of-care articulation (directly relevant to the executive-travel work already delivered for Petronas). The gap scorecard reports per-vendor, per-dimension distance, turning the benchmark library into a measurement-driven product roadmap: which professional capability AEGIS is closest to matching, and which is furthest. Uploading additional vendor reports is standing operator work — every report added sharpens the scorecard's meaning.

**Held-out discipline, doubled.** Every professional report is simultaneously training-adjacent material (style, tradecraft, structure AEGIS may learn from) and test material (what it is graded against) — and the same document may never be both for the same run. Split rules: (a) periodic reports (3Si weeklies) — TIME separation: AEGIS generates for week N before the vendor's week-N report enters its retrieval; (b) one-off reports (a Control Risks country assessment) — SUBJECT separation: AEGIS produces its own assessment of the same subject with the vendor report retrieval-quarantined, then compare. The per-run quarantine verification (section 4) covers both cases; no comparison counts without it.

**Epistemic limit, stated on the scorecard face.** Comparative grading measures RELATIVE quality, not truth — AEGIS, the panel, and the vendors can all be fluently wrong together, and LLM graders share blind spots with LLM generators. Two guards: (1) the grader scores verifiable rubric dimensions (claim sourcing, rating-derivable-from-evidence), never "which reads better" — fluency preference is the bias to design out; (2) only the Phase 3 outcome feedback loop grades truth (did assessed risks materialize; were de-escalation calls right). The panel and library are the best available proxy until outcomes accumulate, and the scorecard says so explicitly.

**Phase 3.5 role separation (restated for this section).** When the synthetic loop eventually runs, the same model APIs serve as adversary and sparring source (scenario generation, red-team evasions, counter-analyses); the harness with its benchmark library remains the frozen referee. Same plumbing, opposite roles — the referee never trains, the trainer never grades.

## 5. Dependency map — how the open workstreams serve this objective

- **WO-COVERAGE (social restoration, per-path allowlists, source health registry)** → feeds Detection coverage. Until social is live, that dimension scores honestly low; the scorecard makes the cost of the dead pipe visible weekly, which is the correct pressure.
- **Briefing-quality WO (posture reconciliation, ranking, specificity)** → feeds Operational-context fusion and Calibration honesty. The redesigned briefing is the first AEGIS product the harness grades.
- **WO-SIGNAL-TO-NOISE (consumer test, decision-gate, decay models)** → feeds "only meaningful items become signals" (the operator's own rubric) and protects the attention budget the products are delivered into.
- **Client configuration worklist (taxonomies, keywords, tech_stack)** → feeds everything; the ranking and fusion axes grade against what the platform knows the client cares about, and thin taxonomies cap every downstream score. Remains the highest-leverage operator input.
- **AEGIS operator channel (deferred feature)** → the delivery layer for the products once they grade well. Sequenced after content quality per standing decision.
- **Model routing WO (from the PRIORITY1 egress inventory)** → supplies the API plumbing the LLM baseline panel (4b) rides on; panel provider selection follows the routing layer's task-class model map.
- **Operator benchmark uploads (standing)** → Control Risks, International SOS, and future vendor reports extend the benchmark library (4b); each upload is tagged benchmark-class at ingestion and enters the quarantine regime before any grading run touches its subject or period.
- **Phase 3.5 synthetic loop (north star)** → consumes this harness as its referee. The harness must exist and be trusted before any training loop runs.

## 6. What this yields commercially

- **The Petronas renewal / proof story:** weekly side-by-side vs. 3Si, with the fusion axis 3Si cannot contest and the detection gap visibly closing. The eventual sentence: "3Si tells you what the internet says about you, weekly. Fortress tells you that, plus what is physically happening around your assets, continuously, at a fraction of the cost."
- **The CRT demo:** the Yuan investigation re-run through the improved pipeline, side-by-side with Calvin's own Gemini version — every allegation sourced, one canonical artifact, Maltego-importable network file. His own output as the "before."
- **The trust artifact:** the weekly gap scorecard itself, shown to a sophisticated buyer, is evidence of a vendor that measures itself against the best human alternative and publishes the gap. No competitor does this.

## 7. Explicitly out of scope for this WO

- Building the Phase 3.5 training loop (harness is its prerequisite, not its start).
- Multi-client harness generalization (Petronas/3Si first; BC Place lacks a comparable benchmark set).
- Any archival/deletion of benchmark documents (they are reference material, held under the user-owned/reference ruling from WO-DATA-INTEGRITY where applicable).
- The AEGIS messaging channel (sequenced behind content quality per standing decision).

## 8. Sequencing and gates

1. Survey first (read-only): confirm which 3Si reports are in the platform, their document IDs, whether ingestion derived entities/signals from them, and what a retrieval-quarantine flag requires. Deliver the quarantine design for operator review.
2. Rubric encoding: translate sections 2–4 into the grading rubric; operator reviews and tunes weights BEFORE first run (the weights are the operator's judgment, not the model's).
3. First harness run: current AEGIS weekly output vs. the most recent 3Si report, quarantine verified per rule 6. Deliver the first gap scorecard to the operator.
4. Weekly cadence thereafter; scorecard becomes a standing operator artifact.
5. LLM baseline panel (4b) joins the weekly run once the first two solo harness runs are stable — panel provider list drawn from the routing layer, input asymmetry stated on every scorecard.
6. Benchmark library extension: operator uploads Control Risks / ISOS reports as available; each is benchmark-tagged at ingestion and quarantined per the 4b split rules before its first grading use.
7. Gemini floor check runs once the investigation-report improvements (sourcing layer, Maltego export) land.

Standing rules apply throughout. No harness run counts without the quarantine verification attached. The operator grades the grader on the first three runs.
