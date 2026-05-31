# Decision Frame Doctrine Refinement

**Operator-directed 2026-05-31.** Response to hostile Codex findings on the Decision Frame Convergence Plan (Task #116). Planning only. No implementation, code, branches, deployments.

Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."* The Codex critique is correct: forcing performative decisions DEFEATS Commander's Intent by manufacturing noise where decision space should be preserved.

---

## §1 — The Codex critique, validated

> *"The daily briefing may become a second briefing inside the briefing."*

This is structurally correct. The naïve six-element convergence — every report begins with all 6 elements — has a failure mode the Codex review correctly identified:

1. On a quiet day, the AI has no genuine decision to surface. It will fabricate one to fill the template.
2. Fabricated decisions violate three ratified doctrines:
   - **Decision Layer I1 invariant** — *statistical noise without commitment impact ≠ Decision Frame.*
   - **Anti-fabrication discipline** — never claim a decision or recommendation that isn't grounded.
   - **Grounding-State Doctrine** — *no provenance → no recommendation.*
3. A daily briefing with a manufactured "decision" header is *longer than the original*, *less truthful*, and *more cognitively expensive* to read. **It actively works against Commander's Intent.**

The Codex finding is not a stylistic objection — it is a doctrinal incompatibility between the naïve convergence plan and three already-ratified doctrines. The convergence plan must be refined.

---

## §2 — Answers to the operator's four questions

### Q1: Should every report contain a full six-element frame?

**No.** Forcing a full frame on every report is performative on quiet days and contradicts Decision Layer I1. The six-element *structure* is the doctrine; the *content of every element* on every report is not.

### Q2: Should Fortress introduce a Decision Check gate (REQUIRED / MONITOR / NONE) before Elements 4 and 5?

**Yes.** A first-class Decision Check classifier upstream of Elements 4 and 5 is the structurally correct answer. It honors I1, it stays honest about commitment-impact, and it preserves the six-element frame as a *capability* without making it a *forced ritual*.

### Q3: Should Decision Required + Consequence be conditional rather than mandatory?

**Yes — gated by the Decision Check.** Elements 4 + 5 fire IFF Decision Check = REQUIRED. On MONITOR or NONE, they are suppressed; the report doesn't pretend a decision exists.

### Q4: Codex concern — "second briefing inside the briefing"

**Codex is correct for the naïve convergence; the refined doctrine resolves it.** With Decision Check + conditional Elements, a quiet-day daily briefing's "decision frame" is *3 lines + a NONE classifier* — not a fabricated mini-briefing. On a REQUIRED day, the full frame is exactly what the operator needs.

---

## §3 — Recommended Doctrine

### The refined Decision Frame structure

**Always-present elements:**

1. **What changed** — single line. On quiet days = *"No material change; situational continuity."* Never empty.
2. **Why it matters** — single line. On quiet days = *"Low operational impact; awareness-only."* Never empty.
3. **Who should care** — single line. Always a named role + tenant scope. On quiet days = *"All readers (situational)."*

**The Decision Check classifier (NEW; sits between Elements 3 and 4):**

| Classification | Meaning | When it fires |
|---|---|---|
| **REQUIRED** | A specific decision must be made by a specific stakeholder by a specific time | Commitment-impacting events; deadlines approaching; escalation criteria met; live customer/operator action required |
| **MONITOR** | No decision yet, but specific signals require attention; escalation criteria may fire soon | Situations actively developing but pre-decision; tripwires watching specific thresholds |
| **NONE** | Nothing requires decision or active monitoring; situational awareness only | Quiet periods; routine cadence; no escalation candidates |

**Conditional elements (suppressed unless their Decision Check warrants them):**

4. **Decision required** — fires IFF Decision Check = REQUIRED. Must be a specific question or specific choice. Banned: "review the situation."
5. **Consequence** — fires IFF Decision Check = REQUIRED. Must include timeframe + specific outcome. Banned: "if not addressed."
6. **Recommended action** — fires IFF Decision Check ∈ {REQUIRED, MONITOR}. For REQUIRED: named owner + specific timeframe + specific action. For MONITOR: continue-monitoring directive with specific escalation triggers. Suppressed on NONE.

### Anti-performative discipline (the I1 enforcement layer)

The Decision Check classifier must NOT default to REQUIRED. Defaults are conservative:

- Daily briefings default to **NONE**; upgrade to MONITOR or REQUIRED only with grounded justification.
- POI reports default to **REQUIRED** (a POI report exists because a decision about a person is needed).
- Wildfire reports default by **season** (off-season NONE, shoulder MONITOR, active fire REQUIRED).
- Executive briefings default to **MONITOR** (high-stake audience expects orientation; promotes to REQUIRED on commitment-impacting events).

**Prose-lint rule (new R8):** the Decision Check classifier must be backed by an explicit grounded justification. When REQUIRED, the lint requires that the report names: (a) the specific decision-required event, (b) the affected commitment, (c) the named stakeholder, (d) the deadline. Reports that promote to REQUIRED without all four are downgraded to MONITOR at lint time.

**Prose-lint rule (new R9):** Elements 4 + 5 may not be emitted when Decision Check is MONITOR or NONE. Any AI output that emits Elements 4 or 5 outside REQUIRED triggers a rejection-and-regenerate cycle.

**Prose-lint rule (new R10):** Element 1 (What changed) and Element 2 (Why it matters) are required to be specific. On quiet days they may use the canonical phrasings above (*"No material change; situational continuity"* / *"Low operational impact; awareness-only"*) without lint violation. AI must not pad these elements with synthetic specificity.

### Operator override

Operator may downgrade an AI-emitted REQUIRED to MONITOR or NONE after generation. Upgrades require justification entered into the report. The downgrade path acknowledges that AI may over-classify; the upgrade path requires evidence.

---

## §4 — Recommended Canonical Template

### Markdown rendering (the source-of-truth shape)

```
═══════════════════════════════════════════════════════════════════
DECISION FRAME
───────────────────────────────────────────────────────────────────

What changed:    <single-line; "No material change" acceptable>
Why it matters:  <single-line; "Awareness-only" acceptable>
Who should care: <single-line; named role + tenant scope>

Decision check:  REQUIRED   ◯ MONITOR   ◯ NONE
                 (one classification; specific justification required for REQUIRED)

─── IF Decision Check = REQUIRED ───
Decision required:   <specific question or choice>
Consequence:         <timeframe + specific outcome of inaction>
Recommended action:  <named owner + timeframe + specific action>
────────────────────────────────────

─── IF Decision Check = MONITOR ────
Recommended action:  Continue monitoring; specific triggers to escalate
                     to REQUIRED: <specific tripwire conditions>
────────────────────────────────────

─── IF Decision Check = NONE ───────
(no further frame block; report proceeds)
────────────────────────────────────

═══════════════════════════════════════════════════════════════════

[report body — discipline-specific content unchanged]
```

### HTML rendering (operator-facing)

The classification renders with visual prominence:
- **REQUIRED** — amber/red left-border accent + bold heading
- **MONITOR** — yellow left-border accent + standard heading
- **NONE** — muted gray left-border accent; collapsed by default (click to expand the 3 always-present elements)

The visual hierarchy mirrors the cognitive hierarchy: REQUIRED demands attention, NONE doesn't.

### Audio rendering (downstream)

`generate-briefing-audio` reads:
- REQUIRED: full frame
- MONITOR: 3 always-present + "Monitor classification: continue watching for…"
- NONE: skip the frame entirely; report proceeds

This eliminates the "audio reads a 6-line fabricated frame on a quiet day" failure mode.

---

## §5 — Per-Report-Class Assessment

| Report class | Default Decision Check | Typical distribution | Notes |
|---|---|---|---|
| **Daily Briefing** | **NONE** | 70% NONE, 20% MONITOR, 10% REQUIRED | Codex critique applies most directly here. NONE default is the doctrinally correct posture; AI may not promote without grounded justification |
| **Executive Briefing** | **MONITOR** | 30% MONITOR, 60% REQUIRED, 10% NONE | High-stake audience expects orientation. REQUIRED frequency is genuinely higher than daily because executive cadence implies commitment-relevant events |
| **POI Report** | **REQUIRED** | 90% REQUIRED, 10% MONITOR | POI report exists because someone needs a decision about a person. NONE is structurally rare. Operator may downgrade to MONITOR for "stay aware of this person; no decision today." |
| **Wildfire Report** | **Seasonal:** NONE in off-season (Nov-Mar), MONITOR in shoulder (Apr, Oct), REQUIRED in active fire (May-Sep) | Seasonal | Off-season "FOR AWARENESS ONLY" is a *fact* about NE BC, not a workaround. REQUIRED upgrade triggered by FWI/HFI/proximity-to-facility thresholds. |
| **Travel Briefing** | **Risk-driven:** NONE for routine low-risk, MONITOR for medium, REQUIRED for high or active threat | Risk-driven | Per-itinerary risk score determines default. Active threat anywhere on the route → REQUIRED. |
| **SRA Report** | **REQUIRED** | 95% REQUIRED, 5% MONITOR | SRA is fundamentally a decision artifact (operator authorization for a risk posture). NONE is structurally invalid. |
| **Security Bulletin** | **MONITOR** | 60% MONITOR, 30% REQUIRED, 10% NONE | Advisory by default; promotes to REQUIRED when a customer is materially affected |
| **Incident Briefing** | **REQUIRED** | 95% REQUIRED | Active incident = decision artifact by definition |
| **Consortium Briefing** | **MONITOR** | 70% MONITOR, 20% REQUIRED, 10% NONE | Cross-tenant trend reporting; rarely a single-stakeholder decision |
| **Audio Briefing** | **Inherits** from upstream text | inherits | Frame is read aloud only when upstream REQUIRED or MONITOR |

**The pattern:** the Decision Check default is *per-class*; the actual classification is *per-instance*; the doctrinal commitment is *honest classification, never fabricated promotion*.

---

## §6 — Recommended Exceptions

Some surfaces should NOT carry a Decision Frame at all:

1. **`generate-briefing-audio`** — derivative surface; inherits frame from upstream. Adds nothing of its own.
2. **`generate-academy-course`** — training content; not a decision artifact. Already out of scope.
3. **`process-bug-report`** — internal bug intake; not a decision artifact. Out of scope.
4. **`generate-sra-report`'s existing Executive Summary block** — the SRA format already has an Executive Summary that functions as a Decision Frame instance. **Doctrinal collision avoidance:** the SRA report DOES emit a Decision Frame at the top, but treats its existing Executive Summary as the body's restated frame; no double-header. The shared module is invoked once; the SRA template adapts to consume it.
5. **Aegis chat tool responses** — already covered by Decision Layer Doctrine PR #58 at the Aegis-level. Tool responses (`lookup_ioc_indicator`, `update_risk_profile`, etc.) are not reports; they are tool-call results consumed by Aegis. The downstream Aegis response *itself* may emit a Decision Frame; that's a `dashboard-ai-assistant` prompt question, not a report-generator question.

These exceptions are doctrinally honest. The Decision Frame is *the* canonical reporting doctrine — but only for surfaces that emit reports.

---

## §7 — Choice: A vs B vs C

The operator framed three options. Each evaluated:

| Option | Description | Verdict |
|---|---|---|
| **A — Full six-element frame remains correct** | Every report emits all 6 elements; AI fabricates content for Elements 4 + 5 on quiet days | **REJECTED.** Defeats Commander's Intent. Codex is correct. Violates Decision Layer I1, anti-fabrication, Grounding-State. |
| **B — Decision Check + conditional elements** | Six-element structure preserved; classifier gates Elements 4-5-6; defaults vary by report class | **RECOMMENDED.** Preserves the doctrine; honors I1; eliminates performative decisions; allows class-specific defaults; per-instance classification respects operator override. |
| **C — Different report classes use different frame variants** | Each report class defines its own variant of the frame | **PARTIAL.** Structurally messier than B. Per-class differences become invisible variation across surfaces. B with per-class *defaults* (not per-class variants) is the cleaner equivalent. |

**B is the recommended doctrine.** It preserves the six-element capability without forcing six-element ritual. It enforces I1 structurally. It honors operator-led classification override. It eliminates "second briefing inside the briefing" as a failure mode.

---

## §8 — Implementation impact on the Convergence Plan (Task #116)

Phases F.0 through F.8 from the original convergence plan remain valid, with these refinements:

1. **F.0 (shared module)** — `aegis-decision-frame.ts` exports:
   - `DecisionCheck = "REQUIRED" | "MONITOR" | "NONE"` type
   - `composeDecisionFrame()` accepts a `decisionCheck` field; conditional Element 4 + 5 + 6 emission based on classification
   - `renderDecisionFrameMarkdown()` / `renderDecisionFrameHtml()` honor the conditional shape
   - `defaultDecisionCheckFor(reportClass)` returns the class-specific default per §5 table
2. **Prose-lint module** — adds R8 (REQUIRED justification grounded), R9 (Elements 4-5 suppressed unless REQUIRED), R10 (Elements 1-2 specificity discipline with canonical quiet-day phrasings allowed)
3. **F.1 (send-daily-briefing pilot)** — daily briefing emits Decision Check = NONE by default; 7-day post-deploy observation establishes the distribution
4. **F.2 (POI report)** — POI default = REQUIRED; lit alongside Workstream D claim-frame activation per Task #115
5. **F.3 (wildfire + SRA)** — wildfire seasonal default; SRA REQUIRED-default (with Executive Summary absorbing the frame body — see §6 exception)
6. **F.4 onwards** — class-specific defaults per §5

**Net effect:** the convergence plan's effort estimate (~70 hours) does NOT increase materially. The Decision Check classifier is a one-field addition to the shared module; per-class defaults are a small enum-driven configuration. The doctrinal refinement is a *clarification* of the convergence plan, not a re-plan.

---

## §9 — Recommended Doctrine Statement (canonical form for memory + ADR)

### Fortress Decision Frame Doctrine v2 (2026-05-31)

**Every Fortress report emits a Decision Frame at its head.** The Decision Frame is the canonical decision-orientation protocol across all report generators.

**The Decision Frame has six elements:**

1. **What changed** (always present)
2. **Why it matters** (always present)
3. **Who should care** (always present)
4. **Decision required** (conditional on Decision Check = REQUIRED)
5. **Consequence** (conditional on Decision Check = REQUIRED)
6. **Recommended action** (conditional on Decision Check ∈ {REQUIRED, MONITOR})

**A first-class classifier — Decision Check ∈ {REQUIRED, MONITOR, NONE} — gates the conditional elements.** The classifier is:

- **REQUIRED** when an explicit commitment-impacting event, deadline, stakeholder action, or escalation criterion fires. Elements 4, 5, 6 emit with grounded content.
- **MONITOR** when situational developments are pre-decision but specific tripwires warrant attention. Element 6 emits as a watch-directive. Elements 4 and 5 are suppressed.
- **NONE** when nothing requires decision or active monitoring. Elements 4, 5, 6 are suppressed.

**Defaults vary by report class** (per §5 table); per-instance classification respects grounded justification; operator override is honored.

**Anti-performative discipline applies:**
- AI may not promote a report to REQUIRED without grounded justification (R8 lint).
- AI may not emit Elements 4 or 5 outside REQUIRED (R9 lint).
- Elements 1 and 2 may use canonical quiet-day phrasings without lint violation; AI may not pad with synthetic specificity (R10 lint).

**This doctrine supersedes the naïve "all six elements on every report" interpretation** of the Decision Frame Convergence Plan (Task #116) and resolves the hostile Codex critique without weakening the underlying Decision Layer Doctrine (PR #58).

**Commander's Intent alignment:** *"Preserve decision space by shortening Signal → Decision → Action."* The Decision Check is itself the decision-space preservation primitive. By classifying honestly whether a decision is REQUIRED, the doctrine eliminates noise on quiet days while making genuine decisions unmissable when they arise. Manufactured decisions ARE noise. The doctrine refuses to manufacture them.

---

## §10 — Held

- No implementation
- No code, branch, migration, deploy
- Convergence Plan F.0–F.8 remains valid; absorbs this refinement via classifier addition + lint rule extension
- Per-class defaults are RECOMMENDATIONS; operator may adjust before F.0 ratification
- Existing prose-lint R1-R7 unchanged; new rules R8-R10 extend the family
- Decision Layer Doctrine PR #58 (six-element frame) is UNCHANGED — this is a refinement of *how* the frame is emitted, not *what* the frame contains

🤖 Generated with [Claude Code](https://claude.com/claude-code)
