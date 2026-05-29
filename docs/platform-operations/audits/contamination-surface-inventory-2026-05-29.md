# Contamination-surface inventory — pattern signals · methodology-derived language · Flash contradiction

**Date:** 2026-05-29. **Scope:** all narrative-emitting report generators in `supabase/functions/*`. **Status:** documentation only — no fix work started, per operator directive.

## Axes

For each surface this maps three orthogonal failure modes:

- **Q1 — Pattern-signal influence:** does the surface allow `signal_type='pattern'` rows to enter the LLM prompt as if they were external threat observations?
- **Q2 — Methodology-derived language:** does the surface inject LLM-derived prose (expert_knowledge, agent_beliefs, signal_agent_analyses, agent_debate_records, etc.) into a new LLM prompt as if it were ground truth?
- **Q3 — Flash contradiction:** can the section independently produce a trajectory / risk / urgency assessment that contradicts the authoritative deterministic Flash (or equivalent quiet-period gate)?

Grades:
- 🟢 fixed / not present
- 🟡 present but bounded (client-scoped, time-bounded, or otherwise constrained)
- 🔴 present and unbounded (the contamination pattern the operator already named on the Trent Reznor report)

---

## A. `generate-executive-report` — per-section map

This is the function that already had two fixes land (PR #42 methodology injection · PR #44 narrative signal-vs-threat). Remaining sections audited below.

### A.0 Reference table — every LLM call

| Section | Prompt line | LLM call line | Input data | Q1 | Q2 | Q3 |
|---|---|---|---|---|---|---|
| `executive_flash` | 485 | 560 | criticalSignals · highSignals · newIncidentsLast24h · top-3 critical signals | 🟡 *(pattern signals still counted)* | 🟢 *(methodology injection removed PR #42)* | 🟢 *(deterministic `isQuietPeriod` short-circuit when quiet)* |
| `impact_ladders` | 575 | 594 | criticalSignals top 5 | 🟢 *(pattern signals are medium severity; never reach `criticalSignals`)* | 🟢 *(injection removed)* | 🔴 *(no quiet-period gate; LLM can fabricate worst-case "physical attack" / "stalking" scenarios even on a 0-critical report — observed on Trent Reznor `bd7eae69`)* |
| `executive_summary` | 608 | 670 | freshSignals top 5 + agent_debate_records syntheses + incidents | 🔴 *(uses `freshSignals` — includes patterns; observed: "four medium severity active threats reported this week vs zero last week" in `bd7eae69`)* | 🟡 *(injects `agent_debate_records.final_assessment` — client-scoped via incident IDs, so bounded — but still LLM-derived prose framed as authoritative analyst output)* | 🔴 *(no quiet-period gate; LLM is explicitly told to "state threat trajectory ESCALATING/STABLE/DE-ESCALATING" — same trajectory-vs-Flash divergence path as narratives had)* |
| `action_items` | 702 | 738 | `actionSignalContext` = tier1 (critical+high) widened to `reportableSignals` if <3 | 🔴 *(widens to `reportableSignals` — includes patterns; observed: action items "[SIG-2026-002919] Monitor and investigate the recent spike in signal frequency…" on the regenerated Trent Reznor report)* | 🟢 *(no methodology injection)* | 🔴 *(no quiet-period gate; will emit "high priority" recommendations on a 0-critical period when pattern signals trigger the widen-fallback)* |
| `deductions` | 786 | 847 | tier1 (critical+high) widened to `reportableSignals` if <3 | 🔴 *(same widen-fallback as action_items — pattern signals reach the prompt when tier1 is sparse)* | 🟢 *(`knowledgeContext` and `agentContext` are now empty strings post PR #42)* | 🟡 *(has its own "Zero signals = zero deductions" rule and emits "Insufficient signal data for strategic deductions this period." on quiet — partially gated, but the rule is prose-level not structural)* |
| `narratives` | 942 | 969 | `narrativeSignalsByCategory` (pattern signals excluded post PR #44) | 🟢 *(structural exclusion + defensive prompt label)* | 🟢 *(methodology injection removed PR #42)* | 🟢 *(`isNarrativeQuietPeriod` short-circuit PR #44)* |

### A.1 Section-by-section details (the surfaces still affected)

#### `executive_summary` — **highest residual risk**

- **Inputs to the prompt:** `freshSignals.slice(0, 5)` (line 636), `(periodDebates ?? []).slice(0, 8)` final_assessments, `client.organization/industry/locations/high_value_assets`, incident lists, count summaries.
- **Q1 — pattern influence:** YES. `freshSignals` is upstream of `reportableSignals` and includes pattern signals. The post-PR#44 Trent Reznor report `bd7eae69` reads: *"there has been an increase in signal frequency, indicating heightened attention to active threats… a noticeable spike in signal activity, with four medium severity active threats reported this week compared to zero last week."* That language is the same shape the narrative section had pre-PR#44.
- **Q2 — methodology language:** PARTIAL. `agent_debate_records.final_assessment` text is injected as "MULTI-AGENT DEBATE SYNTHESES" with the explicit instruction *"Use them as the interpretive backbone of the executive summary — distill their judgments into the BLUF and summary paragraphs."* These records are client-scoped via inner-join on `incidents.client_id`, so this isn't a cross-tenant leak — but the instruction *promotes prior LLM-generated debate prose to be the "interpretive backbone."* That is the methodology-applied-as-evidence pattern in a different form.
- **Q3 — Flash contradiction:** YES. The prompt instructs *"State the threat trajectory explicitly: is overall risk ESCALATING, STABLE, or DE-ESCALATING"* (line 653) without any anchor to the deterministic Flash trajectory. The Flash quiet-period gate does not apply here. Same mechanism that produced the original narrative contradiction.

#### `action_items` — high residual risk

- **Inputs to the prompt:** `actionSignalContext` = `[...criticalSignals, ...highSignals]` widened to `reportableSignals.filter(s => !['critical','high'].includes(s.severity))` when tier1 has <3 items (lines 689–700). On a quiet client like Trent Reznor (0 critical + 0 high), this fallback kicks in immediately and the prompt is filled with medium pattern signals.
- **Q1 — pattern influence:** YES. Already observed on the regenerated `bd7eae69` report: three action items reference the three pattern signal IDs with concerning language ("Monitor and investigate the recent spike in signal frequency related to <entity>…").
- **Q2 — methodology language:** NO (clean — no methodology context blocks injected here).
- **Q3 — Flash contradiction:** YES. The Flash on the Trent Reznor report says *"No immediate action required. Continue routine monitoring; reassess at next scheduled report."* The action_items section emits 3 high/medium-priority recommendations with deadlines (1–7 days). Direct contradiction.

#### `deductions` — partially mitigated

- **Inputs to the prompt:** Same tier1+widen-to-reportableSignals pattern as action_items (lines 808–827). Plus `${knowledgeContext}${agentContext}` insertions on lines 787–788 — **now empty strings** since PR #42.
- **Q1 — pattern influence:** YES. Same widen-to-reportableSignals path.
- **Q2 — methodology language:** NO (methodology injection cleared in PR #42).
- **Q3 — Flash contradiction:** PARTIAL. The prompt has an explicit rule (line 806): *"Zero signals = zero deductions. Write 'Insufficient signal data for strategic deductions this period.' instead."* This is a prose-level safeguard that DID fire correctly on Trent Reznor (the top-level `deductions` field on `bd7eae69` is *"Insufficient signal data for strategic deductions this period."*). But the safeguard is at the prompt-instruction level, not structural — it relies on the LLM honoring the rule on edge cases. Today it works; in some future state where pattern signals become tier1 (e.g., reclassified as high severity by upstream changes), the safeguard would not fire and contamination would resume.

#### `impact_ladders` — low pattern-signal risk, high abstract-language risk

- **Inputs:** `criticalSignals.slice(0, 5)` (line 578). Pattern signals are severity=medium so they do not appear here.
- **Q1 — pattern influence:** NO direct path. Pattern signals never reach this prompt under current scoring.
- **Q2 — methodology language:** NO.
- **Q3 — Flash contradiction:** YES. Even when `criticalSignals.length === 0` (Trent Reznor case), the prompt unconditionally asks for **"impact ladders for the top 3 threats facing ${client.name}"**. The LLM has no signals to ground against, so it fabricates worst-case scenarios from general knowledge ("Potential threats from overzealous fans or stalkers"). Observed on `bd7eae69`. This isn't pattern-signal-driven contamination — it's **promptscape-asks-for-three-ladders-always** contamination. Section emits speculative-threat content on a quiet period regardless of input.

---

## B. Other report-generation functions

### `generate-daily-briefing` (B-grade — multiple findings)

| Surface | Lines | Q1 | Q2 | Q3 |
|---|---|---|---|---|
| Signals retrieval | 63–71 | 🟡 *(no `signal_type` filter — pattern signals pass through; client-scoped + 24h)* | n/a | n/a |
| `agent_beliefs` retrieval | 78–84 | n/a | 🟡 *(client-scoped via `.eq("client_id", clientId)` — bounded; but agent_beliefs hypotheses are LLM-derived language that gets injected into the briefing prompt)* | n/a |
| `agent_beliefs` entity_narrative | 87–93 | n/a | 🟡 *(same as above)* | n/a |
| **`signal_agent_analyses`** | 95–100 | n/a | 🔴 ***(NO `client_id` filter — only `trigger_reason ilike 'entity_mention:%'` + 24h time bound. Service-role bypasses RLS. Pulls cross-tenant LLM-derived analyses if `signal_agent_analyses` lacks a robust RLS policy that overrides service-role.)*** | n/a |
| `agent_debate_records` | 108–123 | n/a | 🟢 *(client-scoped via inner-join `incidents!inner` + `.eq("incidents.client_id", clientId)` — clean)* | n/a |
| LLM briefing prompt | 228 | 🔴 *(signals pass through pattern signals)* | 🔴 *(injects agent_beliefs hypotheses + signal_agent_analyses + agent_debate_records syntheses into the prompt — three LLM-derived prose sources promoted to authoritative input)* | 🔴 *(no quiet-period gate; LLM produces a free-form daily briefing with its own trajectory call)* |

**Note on `signal_agent_analyses`:** the filter `.ilike("trigger_reason", "entity_mention:%")` returns signal-agent analyses across all signals regardless of client ownership. Service-role bypasses RLS. This needs a deliberate audit — is the row's `signal_id` join sufficient to keep it tenant-scoped through some other gate, or does this function inject cross-tenant analysis prose into a client briefing? Either way it is **not visibly client-scoped** at the SQL level.

### `generate-poi-report` (single LLM call, mixed)

| Surface | Lines | Q1 | Q2 | Q3 |
|---|---|---|---|---|
| Signals retrieval | 463–469 | 🟡 *(signal_type INCLUDED in select; uses `quality_status='active'` and `entity_name` matching — entity-scoped; pattern signals may pass through if they reference the entity)* | n/a | n/a |
| `signal_agent_analyses` retrieval | 476–485 | n/a | 🟡 *(scoped by `.in('signal_id', signals.map(s=>s.id))` — transitively entity-scoped, not cross-tenant; but pulls LLM-derived analysis prose for injection)* | n/a |
| `entity_relationships` retrieval | 487–490 | n/a | n/a | n/a (data, not LLM prose) |
| LLM report prompt | 787 | 🟡 *(pattern signals could surface if they reference the entity; less likely than executive-report path since entity-mention filtering is tighter)* | 🟡 *(signal_agent_analyses + relationships fed in; entity-scoped; bounded methodology-language risk)* | 🟡 *(this report has no Flash equivalent — the report itself IS the executive summary; less risk of internal contradiction within the same artifact, but could contradict the simultaneous executive_intelligence report on the same client if both exist)* |

Workstream D's slim-slice wire-up (PR #41 from yesterday) added claim-framing to this function but is shipped dark behind `D_SLIM_SLICE_ENABLED`. When activated, it appends a CONFIDENCE & PROVENANCE section but does not alter the upstream prompt-contamination paths.

### `generate-consortium-briefing` (low residual risk — narrow scope)

- Single LLM call at line 178. Reads `incidents` filtered by `consortium_id` (line 67) — not by client. **Cross-client by design** (a consortium briefing aggregates across consortium members). Q1 / Q2 / Q3 — the function is structurally a cross-client artifact, so "client-relevance boundary" does not apply in the same way. Pattern-signal handling not audited in depth — the function reads incidents not signals, so pattern signals don't reach it. **Out of scope for this inventory** unless you redirect.

### `auto-summarize-incident` (low residual risk)

- Single LLM call at line 105. Reads signals scoped by `incident_id` via `signal_id` linkage. Q1: limited (only signals attached to the incident; pattern signals could appear if linked, which is unusual). Q2: no methodology injection. Q3: produces an incident summary, not a client-wide trajectory — different scope; cannot contradict a client-wide Flash structurally.

### `generate-incident-briefing`, `generate-wildfire-daily-report`, `respond-as-agent`

- Either no LLM call or out of scope for this inventory. `generate-wildfire-daily-report` does not use LLM (the function builds HTML deterministically from CWFIS data).

---

## C. Three-axis summary across all surfaces

### Q1 — Pattern-signal influence (signal-volume contamination)

| Surface | Status |
|---|---|
| `generate-executive-report` · narratives | 🟢 fixed PR #44 |
| `generate-executive-report` · executive_summary | 🔴 *active* — same root cause |
| `generate-executive-report` · action_items | 🔴 *active* — same root cause |
| `generate-executive-report` · deductions | 🔴 *active* — same root cause (prose-level safeguard only) |
| `generate-executive-report` · impact_ladders | 🟢 not affected by pattern signals (severity gate) |
| `generate-executive-report` · executive_flash | 🟡 counts include patterns but Flash language is gated |
| `generate-daily-briefing` · main prompt | 🔴 *active* — signals retrieved without `signal_type` filter |
| `generate-poi-report` · main prompt | 🟡 entity-scoped; lower risk |
| `generate-consortium-briefing` | n/a — consortium-scoped by design |
| `auto-summarize-incident` | 🟢 incident-scoped, signals from linked attachments |

### Q2 — Methodology-derived language

| Surface | Status |
|---|---|
| `generate-executive-report` · all sections | 🟢 expert_knowledge + agent_beliefs injection removed PR #42 |
| `generate-executive-report` · executive_summary | 🟡 `agent_debate_records.final_assessment` still injected as "interpretive backbone" (client-scoped, but is itself LLM-derived prose) |
| `generate-daily-briefing` | 🔴 *active* — injects `agent_beliefs` hypotheses + `signal_agent_analyses` analysis + `agent_debate_records` syntheses, with `signal_agent_analyses` **not visibly client-scoped at SQL level** |
| `generate-poi-report` | 🟡 `signal_agent_analyses` injected — transitively entity-scoped |
| `generate-consortium-briefing` | unaudited |

### Q3 — Flash / authoritative-summary contradiction

| Surface | Status |
|---|---|
| `generate-executive-report` · narratives | 🟢 fixed PR #44 |
| `generate-executive-report` · executive_summary | 🔴 *active* — LLM independently asked to state trajectory |
| `generate-executive-report` · action_items | 🔴 *active* — emits priorities + deadlines regardless of Flash |
| `generate-executive-report` · deductions | 🟡 prose-level safeguard ("Zero signals = zero deductions") works today but not structural |
| `generate-executive-report` · impact_ladders | 🔴 *active* — always asks for 3 ladders even on quiet period (fabricates from training data) |
| `generate-daily-briefing` | 🔴 *active* — no equivalent of `isQuietPeriod` |
| `generate-poi-report` | 🟡 single-artifact report; no internal Flash to contradict; could contradict same-client executive report |
| `auto-summarize-incident` | 🟢 incident-scope, not client-trajectory scope |

---

## D. Headline findings

1. **The narrative fix (PR #44) addressed only one of five contaminated sections in `generate-executive-report`.** Four other sections (`executive_summary`, `action_items`, `deductions`, `impact_ladders`) still violate at least one of the three axes — and three of them (executive_summary, action_items, impact_ladders) can independently contradict the Executive Flash on the same report. The Trent Reznor regenerated report `bd7eae69` already exhibits all three.

2. **`generate-daily-briefing` is more exposed than the executive report was pre-PR #42.** It injects three LLM-derived prose sources into the briefing prompt (`agent_beliefs` hypotheses, `signal_agent_analyses` analysis, `agent_debate_records` syntheses), and `signal_agent_analyses` is **not visibly client-scoped at the SQL level** — the filter is `trigger_reason ilike 'entity_mention:%'` + 24h time bound. Whether this leaks cross-tenant depends on whether RLS on `signal_agent_analyses` holds against service-role (unverified). This is a candidate next forensic.

3. **`signal_agent_analyses` is a previously-unnamed contamination surface** in this thread. It is a per-signal LLM-derived speculative analysis store. Two reporting functions inject it into prompts. Scope discipline varies between the two (one entity-scoped, one not visibly client-scoped). Needs a focused audit similar to what `agent_beliefs` got.

4. **The `impact_ladders` failure mode is structurally different** from pattern-signal contamination. It's *"the prompt always asks for 3 ladders, regardless of whether evidence supports them."* This fires on every quiet-period client — Trent Reznor's `bd7eae69` shows "overzealous fans or stalkers," "physical attack," etc. The fix shape is different: not pattern exclusion, but **conditional generation gated on `criticalSignals.length > 0`**.

5. **The methodology-injection containment is incomplete across the platform.** PR #42 closed it in `generate-executive-report` only. `generate-daily-briefing` and `generate-poi-report` retain the same pattern with different (and in one case potentially worse) client-scoping discipline. Memory `project_inc_learn_contam` already noted this on 2026-05-29 ("READ containment GAP — other report-generation surfaces are NOT covered"). This inventory confirms which.

---

## E. What this inventory does NOT do

- Does not propose fixes. Per operator directive 2026-05-29: *"Do not start fixing them yet. First produce a map."*
- Does not verify whether `signal_agent_analyses` has functioning RLS that survives service-role bypass — a focused audit is needed.
- Does not test whether `generate-daily-briefing` actually exhibits cross-tenant contamination in production — only flags the SQL-shape that would permit it.
- Does not catalog Aegis-chat surfaces (`dashboard-ai-assistant`, `agent-chat`) for the same axes — those have separate INC-LEARN-CONTAM containment (see memory note). If you want them in scope, redirect.
- Does not address `generate-consortium-briefing` — that function is cross-client by design and the same axes don't apply identically.

## F. Suggested triage order if/when fixes resume (your call, not mine to start)

Highest blast-radius first:

1. **`generate-daily-briefing` — `signal_agent_analyses` scoping audit.** If this is truly tenant-blind under service-role, it's the highest-risk surface in the system (it runs daily, cross-tenant exposure is operator-visible).
2. **`generate-executive-report` · `executive_summary`** — same fix shape as PR #44: derive from `narrativeSignals`, add quiet-period gate.
3. **`generate-executive-report` · `action_items`** — same fix shape: derive from `narrativeSignals`, add quiet-period suppression of recommendations.
4. **`generate-executive-report` · `impact_ladders`** — different shape: conditional generation gated on `criticalSignals.length > 0`; on quiet period emit "No critical threats identified this period."
5. **`generate-executive-report` · `deductions`** — promote prose-level safeguard to structural.
6. **`generate-daily-briefing` · main prompt** — same shape as the executive-report narrative fix, applied to the daily briefing.
7. **`generate-poi-report` · `signal_agent_analyses`** — assess whether entity-scoping is sufficient.

PR #36 (G3 schema) remains held per standing directive. No schema work proposed here.
