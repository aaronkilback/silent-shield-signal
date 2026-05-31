# Decision Frame F.0 — Detailed Implementation Plan

**Operator-directed 2026-05-31 (Task #120).** F.0 GO authorized; Path α for F.2; Policies A/B/C approved; manual A.6 review approved.

## §0 — Success Criterion (operator-recorded, load-bearing)

> NOT: *"Decision Frame deployed."*
> IS: *"Decision owners reach the correct conclusion faster with less noise."*

Every implementation choice in this plan is evaluated against that criterion. Choices that ship the artifact but degrade signal-to-noise are rejected, regardless of how they score on completeness or elegance. F.0 sets the substrate that determines whether F.1/F.2/F.6 can hit this criterion — defaults, lint thresholds, prompt language, and renderer visual hierarchy are *load-bearing* signal-to-noise levers, not stylistic details.

Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

---

## §1 — Pre-Implementation Codebase Reconnaissance

Confirmed during execution-package authoring:

| Reference precedent | Location | Pattern to mirror |
|---|---|---|
| `aegis-claim-frame.ts` | `supabase/functions/_shared/` (170 LOC) | Single-file shared module; typed inputs; discriminated-union returns |
| `aegis-prose-lint.ts` | `supabase/functions/_shared/` (156 LOC) | Lint rule registry; rule-id constants; structured error output |
| `aegis-confidence.test.ts` | `supabase/functions/_shared/` | Vitest harness conventions for shared-module unit tests |
| `cop-timeline-writer.ts` (C.2) | `supabase/functions/_shared/` | Discriminated-union return shape (`{ok: true, ...}` / `{ok: false, ...}`); never partial |
| `flight-recorder.ts` | `supabase/functions/_shared/` | `aegis_request_trace` shape; `debug_trace_id` field name (the linkage target) |

Adjacent modules to NOT touch in F.0 (anti-scope-creep guardrail):
- `aegis-tool-definitions.ts` — tool registry, unrelated
- `aegis-recommendations.ts` — different doctrine surface
- `lint-rules.ts` — referenced by various AI surfaces, NOT the prose lint
- Any generator file (F.0 is module-only)

---

## §2 — Sequencing Within F.0

Subtask order matters — each step blocks the next. Five subtasks; ~7-9 hours total.

| # | Subtask | Estimated | Blocks |
|---|---|---|---|
| **F.0.A** | Create file skeleton + type definitions + per-class defaults table | 1h | all below |
| **F.0.B** | Implement composition + lint API (R8/R9/R10) | 2h | F.0.D, F.0.E |
| **F.0.C** | Implement AI prompt-fragment + parser + strip | 1.5h | F.0.E |
| **F.0.D** | Implement render API (markdown / HTML / JSON) | 2h | F.0.E |
| **F.0.E** | Unit tests covering all 11 test classes; iterate to green | 2h | F.0.F |
| **F.0.F** | No-op audit stub + module-reference docs + PR | 0.5h | F.0 acceptance |

The order is *inside-out from the type contract* — types first because they're the API surface that downstream phases (F.1/F.2/F.6) lock against. Tests come after the four implementation subtasks because the harness needs the real exports to import.

---

## §3 — File Skeleton (F.0.A)

`supabase/functions/_shared/aegis-decision-frame.ts`

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// Aegis Decision Frame — shared module for canonical Decision Layer reporting
//
// Doctrine: docs/platform-operations/decision-frame-doctrine-refinement-2026-05-31.md
// Architecture: docs/platform-operations/decision-frame-shared-module-architecture-2026-05-31.md
// Execution: docs/platform-operations/decision-frame-f0-f1-f2-f6-execution-package-2026-05-31.md
//
// Success criterion: "Decision owners reach the correct conclusion faster with
// less noise." This module enforces that criterion by:
//   - rejecting frames that violate the Decision Check classifier discipline
//   - refusing to manufacture decisions on quiet days (NONE is the default for
//     report classes that don't routinely produce decisions)
//   - keeping the frame visually distinct from report body so the operator's
//     eye lands on the conclusion first
//
// F.0 ships under deferred-persistence scope (operator decision 2026-05-31):
//   - recordDecisionFrameAudit() is a no-op stub preserving the API contract
//   - no migration, no CHECK constraints, no RLS — all DEFERRED per §6 of
//     the architecture doc until a named consumer + operational use case is
//     authorized
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// §A — Type definitions ───────────────────────────────────────────────────────

export type DecisionCheck = "REQUIRED" | "MONITOR" | "NONE";

export type ReportClass =
  | "daily_briefing"
  | "executive_briefing"
  | "poi_report"
  | "incident_briefing"
  | "sra_report"
  | "wildfire_daily"
  | "security_bulletin"
  | "security_briefing"
  | "consortium_briefing"
  | "travel_briefing";

export interface DecisionFrame { /* fields per architecture §2 */ }
export interface ComposeDecisionFrameInput { /* fields per architecture §2 */ }
export interface ComposeResult { ok: boolean; frame?: DecisionFrame; errors?: DecisionFrameLintError[]; }
export interface DecisionFrameLintError { rule: string; element: string; message: string; }
export interface ReportClassDefault { default_check: DecisionCheck; expected_distribution: { required: number; monitor: number; none: number }; }
export interface DecisionFrameRenderJson { /* fields per architecture §2 */ }

// §B — Per-report-class defaults table ────────────────────────────────────────

const REPORT_CLASS_DEFAULTS: Record<ReportClass, ReportClassDefault> = {
  daily_briefing:      { default_check: "NONE",     expected_distribution: { required: 10, monitor: 20, none: 70 } },
  executive_briefing:  { default_check: "MONITOR",  expected_distribution: { required: 60, monitor: 30, none: 10 } },
  poi_report:          { default_check: "REQUIRED", expected_distribution: { required: 90, monitor: 10, none: 0  } },
  incident_briefing:   { default_check: "REQUIRED", expected_distribution: { required: 95, monitor: 5,  none: 0  } },
  sra_report:          { default_check: "REQUIRED", expected_distribution: { required: 95, monitor: 5,  none: 0  } },
  wildfire_daily:      { default_check: "NONE",     expected_distribution: { required: 20, monitor: 30, none: 50 } },
  security_bulletin:   { default_check: "MONITOR",  expected_distribution: { required: 30, monitor: 60, none: 10 } },
  security_briefing:   { default_check: "MONITOR",  expected_distribution: { required: 30, monitor: 60, none: 10 } },
  consortium_briefing: { default_check: "MONITOR",  expected_distribution: { required: 20, monitor: 70, none: 10 } },
  travel_briefing:     { default_check: "NONE",     expected_distribution: { required: 30, monitor: 40, none: 30 } },
};

export function defaultDecisionCheckFor(report_class: ReportClass): ReportClassDefault { /* … */ }

// §C — Composition API (F.0.B) ────────────────────────────────────────────────
export function composeDecisionFrame(input: ComposeDecisionFrameInput): ComposeResult { /* … */ }

// §D — Validation / prose-lint API (F.0.B) ────────────────────────────────────
export function lintDecisionFrame(frame: DecisionFrame): DecisionFrameLintError[] { /* … */ }

// §E — AI prompt-fragment + parser (F.0.C) ────────────────────────────────────
export function decisionFrameSystemPromptFragment(report_class: ReportClass): string { /* … */ }
export function parseDecisionFramePrefix(text: string, ctx: { report_class: ReportClass; tenant_id: string; source_trace_id?: string }): ComposeResult { /* … */ }
export function stripDecisionFramePrefix(text: string): string { /* … */ }

// §F — Render API (F.0.D) ─────────────────────────────────────────────────────
export function renderDecisionFrameMarkdown(frame: DecisionFrame): string { /* … */ }
export function renderDecisionFrameHtml(frame: DecisionFrame): string { /* … */ }
export function renderDecisionFrameJson(frame: DecisionFrame): DecisionFrameRenderJson { /* … */ }

// §G — Audit no-op stub (F.0.F; deferred persistence per architecture §6) ─────
export async function recordDecisionFrameAudit(
  _supabase: SupabaseClient,
  frame: DecisionFrame,
): Promise<{ ok: boolean; error?: string }> {
  console.debug(
    "[aegis-decision-frame] audit persistence deferred",
    { report_class: frame.report_class, decision_check: frame.decision_check, tenant_id: frame.tenant_id },
  );
  return { ok: false, error: "audit-persistence-deferred" };
}

// §H — Helper utilities (internal) ────────────────────────────────────────────
// (UUID validation, ISO timestamp, marker constants, HTML-escape helper)
```

---

## §4 — Composition & Lint Detail (F.0.B)

### Lint rules (the load-bearing signal-to-noise levers)

| Rule | What it enforces | Failure mode if missing |
|---|---|---|
| **R8** | REQUIRED requires `decision_check_justification` that names *event + commitment + stakeholder + deadline* (heuristic: justification ≥ 40 chars AND mentions a verb/noun-rich phrase) | AI fabricates REQUIRED on quiet days — defeats §0 success criterion |
| **R9** | Conditional-element discipline: REQUIRED ⇒ Elements 4+5+6 present; MONITOR ⇒ Element 6 present + 4+5 absent; NONE ⇒ 4+5+6 all absent | Performative frames bleed noise into NONE-day briefings |
| **R10** | Elements 1-3 are non-empty strings | Renderer emits blank sections — operator confusion |

R8's heuristic is intentionally lenient at composition time (the AI prompt does most of the enforcement). Refinement of R8 is a known F.x revisit point if A.6 quiet-day review surfaces false REQUIRED frames slipping through.

### `composeDecisionFrame()` algorithm

1. Validate `tenant_id` (UUID format check)
2. Stamp `generated_at = new Date().toISOString()`
3. Synthesize a candidate `DecisionFrame` from the input
4. Run `lintDecisionFrame()` on the candidate
5. If lint returns any error → return `{ok: false, errors: [...]}` — never partial
6. If lint clean → return `{ok: true, frame: candidate}`

Result: a generator can never emit a malformed Decision Frame even by accident. This is the application-layer enforcement that compensates for the deferred DB-layer CHECK constraints.

---

## §5 — AI Prompt-Fragment & Parser Detail (F.0.C)

### Marker format (LOAD-BEARING — F.1 and F.2 lock against this)

```
=== DECISION FRAME START ===
DECISION_CHECK: <REQUIRED|MONITOR|NONE>
DECISION_CHECK_JUSTIFICATION: <single line; required for REQUIRED and MONITOR; empty for NONE>
WHAT_CHANGED: <single line>
WHY_IT_MATTERS: <single line>
WHO_SHOULD_CARE: <single line>
DECISION_REQUIRED: <single line; REQUIRED only>
CONSEQUENCE: <single line; REQUIRED only>
RECOMMENDED_ACTION: <single line; REQUIRED and MONITOR only>
=== DECISION FRAME END ===
```

Single-line constraint per element keeps parsing trivial (line-by-line regex). Multi-line element content gets rejected at parse — forcing the AI to compress to a clear sentence.

### Prompt fragment shape

```
=== DECISION FRAME INSTRUCTIONS ===

Begin your response with a Decision Frame block in the exact format below.

DEFAULT FOR THIS REPORT CLASS (${report_class}): ${default_check}.

The Decision Check classifier tells the operator whether this report
contains a decision they must make.

  - REQUIRED: a specific commitment-relevant event with a stakeholder,
    deadline, and consequence-of-inaction. Use this ONLY when all four
    are grounded in the report content.
  - MONITOR: no decision today, but defined tripwires would elevate to
    REQUIRED. Name the tripwires in the justification.
  - NONE: no commitment-relevant change; awareness-only.

Do NOT promote to REQUIRED without grounded justification. Manufactured
decisions are noise. Refuse to manufacture them — the operator will
trust this signal LESS if it fires falsely. Quiet days are healthy;
NONE is not a failure mode.

[Marker format follows — exact format above]

=== DECISION FRAME INSTRUCTIONS END ===
```

The anti-promotion language ("Manufactured decisions are noise. … the operator will trust this signal LESS if it fires falsely.") is deliberately phrased in the AI's own consequence-frame — it gives the AI a reason to refuse promotion, not just a rule.

### Parser failure modes (all return `{ok: false}`)

| Failure | Detection |
|---|---|
| Missing START marker | Regex scan returns no match |
| Missing END marker | START found but no closing marker |
| START after END | Order check |
| Multiple START blocks | Count check (>1 = malformed) |
| Required element missing | After extraction, lint catches |
| Wrong DECISION_CHECK value | Enum check |
| Element 4/5 present on MONITOR or NONE | Lint R9 catches |
| Element 4/5/6 absent on REQUIRED | Lint R9 catches |

`stripDecisionFramePrefix()` removes everything from `=== DECISION FRAME START ===` through `=== DECISION FRAME END ===` inclusive plus any leading/trailing whitespace. Idempotent on stripped input.

---

## §6 — Render API Detail (F.0.D)

### Visual hierarchy is a signal-to-noise lever

| Decision Check | Color band | Headline text |
|---|---|---|
| REQUIRED | Red `#c62828` | "🔴 DECISION REQUIRED" |
| MONITOR | Amber `#ef6c00` | "🟡 MONITOR" |
| NONE | Green `#2e7d32` | "✓ Awareness Only" |

A NONE frame must be visually CALM — it should communicate "nothing to act on" without competing for attention. A REQUIRED frame must be visually URGENT — operator's eye lands on it before anything else in the email.

If the visual hierarchy fails (operator scans past a REQUIRED, or feels noise from a NONE), the §0 success criterion is at risk. This is a known operator-feedback collection point during A.6 review.

### `renderDecisionFrameHtml()` structure (email-safe)

Inline-style `<table>` with:
- Header row: color band + headline text
- Element rows: WHAT CHANGED / WHY IT MATTERS / WHO SHOULD CARE always
- Conditional rows: DECISION REQUIRED / CONSEQUENCE / RECOMMENDED ACTION when applicable
- Footer caption (small/muted): `Generated YYYY-MM-DD HH:MM UTC` + optional `Trace: <source_trace_id>` link

XSS-safe: every user-content insertion runs through an HTML-escape helper (defined in §H).

### `renderDecisionFrameMarkdown()` structure

Heading-anchored:
```
## 🔴 DECISION REQUIRED

**What changed:** …
**Why it matters:** …
**Who should care:** …

**Decision required:** …
**Consequence:** …
**Recommended action:** …
```

NONE frames render WITHOUT Elements 4-5-6 sections — empty space communicates the quiet day.

### `renderDecisionFrameJson()` shape

Per architecture §2; no markup; structured for future React consumption (F.8 phase, not in this package).

---

## §7 — Test Coverage Enumeration (F.0.E)

The test file `aegis-decision-frame.test.ts` ships approximately 35–40 named test cases across 11 classes. Test names use Given/When/Then phrasing for self-documentation.

### Test cases

```
Class 1 — defaultDecisionCheckFor()
  - returns_NONE_for_daily_briefing
  - returns_REQUIRED_for_poi_report
  - returns_MONITOR_for_executive_briefing
  - returns_NONE_for_wildfire_daily
  - expected_distributions_sum_to_100_for_all_classes

Class 2 — composeDecisionFrame() happy path
  - composes_REQUIRED_frame_with_all_six_elements
  - composes_MONITOR_frame_with_element_6_only
  - composes_NONE_frame_with_elements_1_to_3_only
  - stamps_generated_at_timestamp
  - preserves_source_trace_id_when_provided

Class 3 — composeDecisionFrame() rejection
  - rejects_REQUIRED_without_justification
  - rejects_REQUIRED_with_short_justification (under 40 chars)
  - rejects_REQUIRED_missing_decision_required
  - rejects_REQUIRED_missing_consequence
  - rejects_REQUIRED_missing_recommended_action
  - rejects_MONITOR_with_decision_required
  - rejects_MONITOR_with_consequence
  - rejects_MONITOR_missing_recommended_action
  - rejects_NONE_with_decision_required
  - rejects_NONE_with_recommended_action
  - rejects_empty_what_changed
  - rejects_empty_why_it_matters
  - rejects_empty_who_should_care
  - rejects_invalid_tenant_id

Class 4 — lintDecisionFrame()
  - R8_flags_REQUIRED_with_thin_justification
  - R9_flags_MONITOR_with_decision_required
  - R9_flags_NONE_with_recommended_action
  - R10_flags_empty_element_1

Class 5 — decisionFrameSystemPromptFragment()
  - includes_default_check_for_daily_briefing
  - includes_marker_block_format
  - includes_anti_promotion_language

Class 6 — parseDecisionFramePrefix() happy path
  - extracts_REQUIRED_frame_from_AI_output
  - extracts_MONITOR_frame_from_AI_output
  - extracts_NONE_frame_from_AI_output

Class 7 — parseDecisionFramePrefix() malformed
  - rejects_missing_start_marker
  - rejects_missing_end_marker
  - rejects_multiple_start_markers
  - rejects_inverted_marker_order
  - rejects_invalid_decision_check_value
  - rejects_multi_line_element_content

Class 8 — stripDecisionFramePrefix()
  - removes_marker_block_and_trailing_whitespace
  - idempotent_on_already_stripped_text
  - preserves_body_when_no_marker_block_present

Class 9 — renderDecisionFrameMarkdown()
  - REQUIRED_renders_with_all_six_sections
  - MONITOR_renders_without_elements_4_5
  - NONE_renders_without_elements_4_5_6
  - color_emoji_matches_decision_check

Class 10 — renderDecisionFrameHtml()
  - REQUIRED_renders_with_red_color_band
  - MONITOR_renders_with_amber_color_band
  - NONE_renders_with_green_color_band
  - escapes_html_in_user_content (XSS guard test)
  - includes_source_trace_id_footer_when_present

Class 11 — renderDecisionFrameJson()
  - REQUIRED_includes_all_conditional_fields
  - NONE_nulls_all_conditional_fields
  - classification_check_matches_decision_check

Class 12 — recordDecisionFrameAudit() (stub)
  - returns_ok_false_with_documented_error_string
  - emits_console_debug_with_frame_metadata
  - never_throws_on_any_input
```

### Test harness conventions

- Vitest precedent from `aegis-confidence.test.ts`
- One `describe` block per class; nested `it` blocks per case
- Test data fixtures inline (no separate fixture file for F.0; module is small enough)
- HTML output tests use snapshot matching for visual hierarchy regressions
- No mocking of Supabase client (audit stub doesn't need it)

### Build gate

Run `npm run test` for the test pass. Run `npm run build` for the TypeScript build pass (must succeed for F.0.6 acceptance).

---

## §8 — Documentation (F.0.F)

### New doc: `docs/platform-operations/decision-frame-module-reference.md`

One-page operator-facing reference (~150 lines). Sections:

1. **What this module is** (3 sentences; doctrinal pointer)
2. **Per-class defaults table** (the same `REPORT_CLASS_DEFAULTS` content rendered as a markdown table)
3. **Generator import pattern** (one Mode 1 example + one Mode 2 example, condensed)
4. **Marker format reference** (the exact format AI generators must emit)
5. **Failure mode summary** (table of parse-failure → recommended generator policy)
6. **How to add a new ReportClass** (3 steps: enum + defaults table + prompt fragment line)
7. **Pointer to architecture + execution package + this F.0 plan**

### Existing doc update

Append a line to the architecture doc's revision history (§0): `- 2026-05-31 v3 — F.0 implementation merged in PR-F.0; module-reference doc added at decision-frame-module-reference.md`.

---

## §9 — Verification Commands (Operator-Reviewable)

Each command produces a result the operator can sanity-check without code-reading. Run from repo root.

```bash
# F.0.1 — Module exists with all exports
grep -c "^export" supabase/functions/_shared/aegis-decision-frame.ts
# Expected: 11 (one per public export)

# F.0.2 — Unit tests pass
npm run test -- supabase/functions/_shared/aegis-decision-frame.test.ts
# Expected: all 35-40 named cases pass

# F.0.3 — TypeScript build green
npm run build
# Expected: clean exit, no errors

# F.0.4 — Zero generators consume the module (F.0 is module-only)
grep -rE "from.*aegis-decision-frame" supabase/functions/ --include="*.ts" | grep -v "aegis-decision-frame\.ts\|\.test\.ts"
# Expected: no output (no generator imports)

# F.0.5 — Audit stub returns documented payload
node -e "import('./supabase/functions/_shared/aegis-decision-frame.ts').then(m => m.recordDecisionFrameAudit(null, { report_class: 'daily_briefing', decision_check: 'NONE', tenant_id: '00000000-0000-0000-0000-000000000000', generated_at: new Date().toISOString(), what_changed: 'x', why_it_matters: 'x', who_should_care: 'x', decision_check_justification: '' }).then(r => console.log(JSON.stringify(r))))"
# Expected: {"ok":false,"error":"audit-persistence-deferred"}

# F.0.6 — Module reference doc exists
test -f docs/platform-operations/decision-frame-module-reference.md && echo OK || echo MISSING
# Expected: OK

# F.0.7 — Zero runtime impact (no edge function changed)
git diff main...HEAD -- supabase/functions/ | grep "^diff --git" | grep -v "_shared/aegis-decision-frame"
# Expected: no output

# F.0.8 — No migration shipped
git diff main...HEAD -- supabase/migrations/ | head -1
# Expected: no output
```

---

## §10 — PR Shape

| Field | Value |
|---|---|
| Branch | `feat/aegis-decision-frame-module` |
| Commits | Single squash-merged commit OR three logical commits (skeleton+types / impl / tests+docs) — author choice |
| Files added | `supabase/functions/_shared/aegis-decision-frame.ts` (~500 LOC), `supabase/functions/_shared/aegis-decision-frame.test.ts` (~600 LOC), `docs/platform-operations/decision-frame-module-reference.md` (~150 LOC) |
| Files modified | `docs/platform-operations/decision-frame-shared-module-architecture-2026-05-31.md` (single-line revision-history append) |
| Migration | NONE (deferred-persistence scope) |
| Edge function changes | NONE (F.0 is module-only) |
| Tests | Vitest run green per §9 F.0.2 |
| Reviewer focus areas | Marker format (locks F.1/F.2 contract); R8/R9/R10 lint rules; HTML escape coverage in renderDecisionFrameHtml; expected_distribution table consistency |

### PR description template

```
## F.0 — Decision Frame Shared Module

**Doctrine:** docs/platform-operations/decision-frame-doctrine-refinement-2026-05-31.md
**Architecture (v2 deferred-persistence):** docs/platform-operations/decision-frame-shared-module-architecture-2026-05-31.md
**Execution package:** docs/platform-operations/decision-frame-f0-f1-f2-f6-execution-package-2026-05-31.md
**This phase plan:** docs/platform-operations/decision-frame-f0-implementation-plan-2026-05-31.md

**Success criterion (operator-recorded 2026-05-31):** Decision owners reach the correct conclusion faster with less noise — NOT "Decision Frame deployed."

**Scope:** module + tests + reference doc.
**Out-of-scope (DEFERRED):** audit table, migration, CHECK constraints, RLS.
**Out-of-scope (later phases):** generator wiring (F.1/F.2/F.6).

**Verification:** §9 of the F.0 plan; 8 commands.

**Risk:** zero runtime impact — no edge function consumes the module yet.

**Rollback:** git revert <sha>; no DB state.

Held: F.1, F.2, F.6 each require independent operator GO post-F.0 merge.
```

---

## §11 — Anti-Scope-Creep Guardrails

Items explicitly NOT to do during F.0 implementation, no matter how tempting:

| Anti-pattern | Why it's banned |
|---|---|
| "Let me also fix this adjacent thing in `_shared/aegis-prose-lint.ts`" | Different doctrine surface; mixes review concerns; risks F.0 rejection over unrelated change |
| "Let me add a helper to `aegis-claim-frame.ts` while I'm here" | Same — opportunistic refactor; violates operator preference |
| "Let me sneak the migration in behind a feature flag" | Operator explicitly deferred persistence; violates the operator-recorded doctrine in MEMORY |
| "Let me wire F.1 in the same PR" | F.0 is module-only; F.1 is a separate operator-authorized PR; bundle review burden multiplies |
| "Let me add a new ReportClass for 'osint_report' since I noticed one exists" | New report classes require operator approval; the 10 in the enum are the authorized set |
| "Let me promote `aegis-decision-frame` to a published npm-style package" | Single-file shared-module precedent stands; F.0 is the substrate, not infrastructure |
| "Let me add OpenTelemetry traces to composeDecisionFrame" | No observability infrastructure committed; same "no persistence without named consumer" doctrine |
| "Let me make the AI prompt fragment configurable via an env var" | Configurability ≠ correctness; default behavior is the doctrine; env-var surface accumulates ops debt |

Stick to the §3 file skeleton + §7 test cases. Anything beyond is its own task.

---

## §12 — Acceptance Evidence Checklist

Single checklist the operator reviews to GO/NO-GO the merge. Each item maps to a §9 command or §11 guardrail.

```
[ ] §9 F.0.1  Module exports = 11 (one per public function/type)
[ ] §9 F.0.2  Unit tests pass (35-40 named cases green)
[ ] §9 F.0.3  npm run build green
[ ] §9 F.0.4  Zero generator imports of the module
[ ] §9 F.0.5  Audit stub returns documented payload
[ ] §9 F.0.6  decision-frame-module-reference.md exists
[ ] §9 F.0.7  Zero edge-function changes
[ ] §9 F.0.8  Zero migrations
[ ] §11      No opportunistic refactors of unrelated _shared modules
[ ] §11      No new ReportClass values beyond the authorized 10
[ ] §10      PR description references doctrine + architecture + this plan
```

All 11 boxes ticked → F.0 merge GO. Any box unchecked → fix or hold.

---

## §13 — Post-F.0 Telemetry (Pre-F.1 Baseline)

Before F.1 wiring lands, capture a baseline forensic measurement so we can compare post-F.1 behavior honestly:

| Baseline metric | Pre-F.0 source | Why |
|---|---|---|
| Average daily-briefing read latency (operator opens → operator acts) | Anecdotal / operator self-report | To later test "faster" in the success criterion |
| Daily-briefing "noise complaints" frequency | Operator-tracked | To later test "less noise" |
| Operator confidence: "I trust the daily briefing's signal" | Operator self-report on 1-5 scale | Same |

These are not gated metrics. They are honest baselines the operator and I capture jointly so post-F.1 review against §0 success criterion isn't done from amnesia. Capture happens during the operator's pre-F.1 visual review session.

---

## §14 — Held / Authorization Gates

- F.0 implementation now authorized to commence under this plan
- Single PR shape (§10) recommended; operator may diverge if smaller commits aid review
- Visual-review samples (D3 from execution-package decisions) — quiet-day NONE / MONITOR / REQUIRED — are pre-prod F.1/F.6/F.2 gates, NOT F.0 gates (F.0 has no rendered output without a wired generator); samples will be generated against staging during F.1 phase
- A.6 quiet-day NONE manual review (D5) — applies to F.1 onward; F.0 only ships the lint that empirically enables A.6
- 30-day persistence-revisit trigger from execution-package §14 stands
- Anti-scope-creep guardrails (§11) are doctrinal — operator pre-authorization required to violate any one of them

**Success criterion reminder:** *"Decision owners reach the correct conclusion faster with less noise."* — every choice in §3–§11 of this plan is downstream of that line.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
