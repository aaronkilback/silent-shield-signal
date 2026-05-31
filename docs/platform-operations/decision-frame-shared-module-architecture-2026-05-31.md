# Decision Frame Shared Module — Architecture Assessment

**Operator-directed 2026-05-31 (Task #118).** R1 Phase F.0 architecture assessment per Doctrine v2. Architecture only. No implementation. No code. No branches. No behavioral changes.

Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."* The shared module is the substrate that makes the Doctrine operational across N report generators while remaining honest about quiet periods.

---

## §1 — Proposed Module Interface

### File layout

For F.0 the module ships as **one file** initially with logical sections; split into adjacent files later only if the file exceeds ~600 lines. This mirrors the `aegis-claim-frame.ts` precedent — single file, clean exports.

```
supabase/functions/_shared/aegis-decision-frame.ts
  ├── §A — Type definitions
  ├── §B — Per-report-class defaults table
  ├── §C — Composition API (composeDecisionFrame)
  ├── §D — Validation / prose-lint API (R8-R10)
  ├── §E — AI prompt-fragment + parser API
  ├── §F — Render API (markdown / HTML / React-data JSON)
  ├── §G — Audit persistence API (gated on table existence)
  └── §H — Helper utilities
supabase/functions/_shared/aegis-decision-frame.test.ts  // unit tests
```

### Public API surface (the only things generators import)

```typescript
// ─── Types ──────────────────────────────────────────────────────────
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

export interface DecisionFrame { … }              // §2 data contract below
export interface ComposeDecisionFrameInput { … }
export interface ComposeResult { ok, frame?, errors? }
export interface DecisionFrameLintError { rule, element, message }
export interface ReportClassDefault { default_check, expected_distribution }

// ─── Composition ────────────────────────────────────────────────────
export function defaultDecisionCheckFor(report_class: ReportClass): ReportClassDefault;
export function composeDecisionFrame(input: ComposeDecisionFrameInput): ComposeResult;

// ─── Validation ─────────────────────────────────────────────────────
export function lintDecisionFrame(frame: DecisionFrame): DecisionFrameLintError[];

// ─── AI emission + parsing ──────────────────────────────────────────
export function decisionFrameSystemPromptFragment(report_class: ReportClass): string;
export function parseDecisionFramePrefix(
  text: string,
  ctx: { report_class: ReportClass; tenant_id: string; source_trace_id?: string },
): ComposeResult;
export function stripDecisionFramePrefix(text: string): string;

// ─── Rendering ──────────────────────────────────────────────────────
export function renderDecisionFrameMarkdown(frame: DecisionFrame): string;
export function renderDecisionFrameHtml(frame: DecisionFrame): string;
export function renderDecisionFrameJson(frame: DecisionFrame): DecisionFrameRenderJson;

// ─── Audit persistence (optional; gated on table existence) ─────────
export async function recordDecisionFrameAudit(
  supabase: SupabaseClient,
  frame: DecisionFrame,
): Promise<{ ok: boolean; row_id?: string; error?: string }>;
```

**Discipline notes:**
- Pure functions wherever possible — only `recordDecisionFrameAudit()` performs IO.
- No globals; no module-scoped mutable state.
- All exports are tree-shakeable for generators that need only a subset.
- All functions accept typed inputs; return typed outputs. No `any`.
- Error path returns discriminated unions (`{ok: true, ...}` / `{ok: false, ...}`), mirroring `cop-timeline-writer.ts` pattern from C.2.

---

## §2 — Data Contract

### `DecisionFrame` — the canonical typed shape

```typescript
export interface DecisionFrame {
  // ─── Metadata ──────────────────────────────────────────────
  report_class: ReportClass;
  tenant_id: string;
  generated_at: string;       // ISO-8601 timestamp (UTC)
  source_trace_id?: string;   // optional FK to aegis_request_trace.debug_trace_id

  // ─── Elements 1-3 (ALWAYS PRESENT) ─────────────────────────
  what_changed: string;       // never empty; quiet-day canonical phrasings permitted
  why_it_matters: string;     // never empty
  who_should_care: string;    // named role + tenant scope; never empty

  // ─── Decision Check classifier ─────────────────────────────
  decision_check: DecisionCheck;
  decision_check_justification: string;
    // REQUIRED: must name event + commitment + stakeholder + deadline
    // MONITOR: must name specific tripwires
    // NONE: empty string

  // ─── Elements 4-5 (CONDITIONAL on REQUIRED) ────────────────
  decision_required?: string;   // present iff decision_check === "REQUIRED"
  consequence?: string;         // present iff decision_check === "REQUIRED"

  // ─── Element 6 (CONDITIONAL on REQUIRED or MONITOR) ────────
  recommended_action?: string;  // present iff decision_check !== "NONE"
}
```

### `ComposeDecisionFrameInput` — what generators pass in

```typescript
export interface ComposeDecisionFrameInput {
  report_class: ReportClass;
  tenant_id: string;
  source_trace_id?: string;

  decision_check: DecisionCheck;
  decision_check_justification?: string;

  what_changed: string;
  why_it_matters: string;
  who_should_care: string;

  decision_required?: string;
  consequence?: string;
  recommended_action?: string;
}
```

### Invariants enforced by `composeDecisionFrame()`

| Invariant | Enforcement |
|---|---|
| Elements 1-3 are non-empty strings | Throws via lint R10 on empty |
| `decision_check === "REQUIRED"` ⇒ Elements 4 + 5 + 6 + justification are non-empty | R8 + R9 lint; rejects ComposeResult |
| `decision_check === "MONITOR"` ⇒ Element 6 + justification (tripwire list) are non-empty; Elements 4 + 5 are NOT present | R9 lint |
| `decision_check === "NONE"` ⇒ Elements 4 + 5 + 6 are NOT present; justification empty | R9 lint |
| `tenant_id` is a valid UUID | Format check |
| `generated_at` is set by the function (not caller) | Internal |

If any invariant fails, `composeDecisionFrame()` returns `{ ok: false, errors: [...] }` — never returns a partial frame. This matches the `cop-timeline-writer` discriminated-union pattern from C.2.

### Render-target JSON shape

```typescript
export interface DecisionFrameRenderJson {
  classification: { check: DecisionCheck; justification: string };
  always_present: {
    what_changed: string;
    why_it_matters: string;
    who_should_care: string;
  };
  conditional: {
    decision_required: string | null;
    consequence: string | null;
    recommended_action: string | null;
  };
  metadata: {
    report_class: ReportClass;
    tenant_id: string;
    generated_at: string;
    source_trace_id: string | null;
  };
}
```

The React-side `<DecisionFrame />` component (future F.8) consumes this JSON shape directly. Structured for easy conditional rendering — frontend checks `classification.check` and renders only the relevant blocks.

---

## §3 — How Generators Consume the Module

### Two consumption modes, one module

**Mode 1 — Programmatic generators** (wildfire, SRA): compute the six elements from typed input data; pass to `composeDecisionFrame()`; render via `renderDecisionFrameHtml()`; prepend to existing report HTML.

```typescript
// In generate-wildfire-daily-report (illustrative, not authorized):
import {
  composeDecisionFrame,
  renderDecisionFrameHtml,
  recordDecisionFrameAudit,
  type DecisionCheck,
} from "../_shared/aegis-decision-frame.ts";

const season = getFireSeason();
const proximityHotspots = hotspots.filter(h => h.distance_km < 4);

const decisionCheck: DecisionCheck =
  season === "active" && proximityHotspots.length > 0 ? "REQUIRED" :
  season === "shoulder" || (season === "active" && proximityHotspots.length === 0) ? "MONITOR" :
  "NONE";

const result = composeDecisionFrame({
  report_class: "wildfire_daily",
  tenant_id: tenantId,
  decision_check: decisionCheck,
  what_changed: decisionCheck === "NONE"
    ? "No material change; situational continuity"
    : `${hotspots.length} hotspots detected; ${proximityHotspots.length} within facility proximity`,
  why_it_matters: decisionCheck === "NONE"
    ? "Low operational impact; awareness-only"
    : `FWI ${maxFwiRating}; proximate hotspots active`,
  who_should_care: "Petronas Security Operations Lead",
  decision_check_justification: decisionCheck === "REQUIRED"
    ? `Hotspot at ${nearestKm}km from facility; HFI ${maxHfi}; fire season active`
    : decisionCheck === "MONITOR"
      ? "Watching: facility-proximity (<4km), HFI escalation (>2000), lightning correlation"
      : "",
  decision_required: decisionCheck === "REQUIRED" ? "Pre-position fire-watch team by 14:00 local?" : undefined,
  consequence: decisionCheck === "REQUIRED" ? "Without pre-positioning, response time +45min if escalation occurs" : undefined,
  recommended_action: decisionCheck === "REQUIRED"
    ? "Security Operations Lead: dispatch fire-watch by 14:00 local"
    : decisionCheck === "MONITOR"
      ? "Continue monitoring; escalate to REQUIRED if any hotspot enters <2km proximity"
      : undefined,
});

if (!result.ok) {
  console.warn("[wildfire-daily] Decision frame validation failed", result.errors);
  // Fall back to non-frame rendering (or operator-policy retry); doctrine choice
}

const frameHtml = result.frame ? renderDecisionFrameHtml(result.frame) : "";
const reportHtml = `${frameHtml}\n\n${existingWildfireReportHtml}`;

// Best-effort audit (non-fatal)
if (result.frame) {
  await recordDecisionFrameAudit(supabaseClient, result.frame).catch(err =>
    console.warn("[wildfire-daily] Decision frame audit persist failed:", err.message)
  );
}
```

**Mode 2 — AI generators** (daily briefing, POI, executive, consortium, incident, bulletins, security briefing): augment system prompt with `decisionFrameSystemPromptFragment()`; parse the AI output via `parseDecisionFramePrefix()`; strip markers from body; render frame separately.

```typescript
// In send-daily-briefing (illustrative, not authorized):
import {
  decisionFrameSystemPromptFragment,
  parseDecisionFramePrefix,
  stripDecisionFramePrefix,
  renderDecisionFrameHtml,
  recordDecisionFrameAudit,
} from "../_shared/aegis-decision-frame.ts";

const augmentedSystemPrompt = `${existingSystemPrompt}\n\n${decisionFrameSystemPromptFragment("daily_briefing")}`;

const aiOutput = await callAiGateway({
  messages: [
    { role: "system", content: augmentedSystemPrompt },
    { role: "user", content: existingUserPrompt },
  ],
  // ...
});

const parseResult = parseDecisionFramePrefix(aiOutput.content, {
  report_class: "daily_briefing",
  tenant_id: clientTenantId,
  source_trace_id: aiOutput.trace_id,
});

let frameHtml = "";
let reportBody = aiOutput.content;

if (parseResult.ok && parseResult.frame) {
  frameHtml = renderDecisionFrameHtml(parseResult.frame);
  reportBody = stripDecisionFramePrefix(aiOutput.content);
  await recordDecisionFrameAudit(supabaseClient, parseResult.frame).catch(noop);
} else {
  // AI failed to emit a valid frame — log + fall back
  console.warn("[send-daily-briefing] AI Decision Frame parse failed", parseResult.errors);
  // Operator policy: fall back to programmatic NONE OR retry once
}

const finalHtml = `${frameHtml}\n\n${formatBriefingLines(reportBody)}`;
```

### Why two modes work cleanly

- **Same `DecisionFrame` output type** regardless of mode → render functions don't care about source
- **Same lint surface** runs against both → AI-emitted and programmatic-emitted frames are both gated by R8/R9/R10
- **Same audit surface** → forensic timeline (Campaign 3) sees both alongside Aegis traces
- **No mode-specific render branches** → markdown/HTML/JSON renderers are pure functions over `DecisionFrame`

---

## §4 — How Per-Report Defaults Work

### Static configuration table

The shared module ships a constant `REPORT_CLASS_DEFAULTS` lookup, exposed via `defaultDecisionCheckFor()`:

```typescript
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
```

### Default ≠ runtime decision

The `default_check` is the **baseline expectation for an arbitrary instance**, NOT a runtime forcing function. Generators ALWAYS pass `decision_check` explicitly to `composeDecisionFrame()` — the default is informational, used:

1. **As an input to the AI prompt fragment** — `decisionFrameSystemPromptFragment(report_class)` tells the AI "this report class typically defaults to X; promote to a higher tier only with grounded justification."
2. **As an observability hint for the audit table** — to detect drift (e.g., daily briefings firing REQUIRED at 50% rate is anomalous; the expected distribution flags it).
3. **As a fallback** if a generator can't determine its own classification.

Generators that have domain context (seasonal for wildfire, risk-driven for travel, incident-active for incident briefing) **always override** the default at composition time. The shared module never makes that call.

### Why this separation matters

- **Domain logic stays in generators** — the shared module never knows what "fire season" means.
- **Per-class defaults stay testable** — static lookup, deterministic.
- **Drift detection** — observed distribution vs expected distribution surfaces drift cheaply.
- **Operator override** — generator can pass any `decision_check` at any time; shared module enforces validity, not policy.

### Doctrinal protection against AI promotion

The system prompt fragment includes an explicit anti-promotion guardrail:

> *DEFAULT FOR THIS REPORT CLASS (`${report_class}`): `${default_check}`.*
> *Do NOT promote to REQUIRED without grounded justification (named event + commitment + stakeholder + deadline).*
> *Manufactured decisions are noise. Refuse to manufacture them.*

Combined with R8 lint (server-side rejection of REQUIRED without justification), the AI cannot quietly drift the daily briefing to REQUIRED by default.

---

## §5 — How Auditability Works

### Three levels of audit

**Level 1 — Lint surface (always-on, no IO).** Every `composeDecisionFrame()` call runs R8 + R9 + R10 lint and returns errors inline. Generators check `result.ok` before rendering. Lint surface is the *immediate* auditability — frames that violate doctrine never reach the renderer.

**Level 2 — Persistence (optional table; see §6).** Every emitted frame can persist to `aegis_decision_frame_audit`. Append-only. Tenant-scoped. CHECK constraints at the DB level enforce conditional-element invariants. This is the *durable* auditability — every Decision Frame Fortress has ever emitted is queryable.

**Level 3 — Flight Recorder linkage.** `DecisionFrame.source_trace_id` ties to `aegis_request_trace.debug_trace_id` when the frame is AI-emitted. This means every Decision Frame can be replayed alongside the full Aegis trace that produced it (`aegis_trace_replay(<source_trace_id>)`). Forensic reconstructionability inherits from existing infrastructure.

### What this enables

| Capability | Without audit table | With audit table |
|---|---|---|
| Real-time doctrine compliance | ✓ (lint surface) | ✓ |
| Per-tenant trend ("CRT daily briefings REQUIRED rate last month") | ✗ | ✓ |
| Drift detection ("daily briefings firing REQUIRED 50% — anomalous") | ✗ | ✓ |
| Forensic reconstruction ("what frame fired during INC-X?") | partial (Flight Recorder only) | ✓ (frame + trace) |
| Watchdog Campaign 1 W.5 doctrine-compliance sweeps | ✗ (no substrate) | ✓ |
| Post-Mortem Campaign 3 forensic timelines | partial | ✓ |
| Per-class distribution observability | ✗ | ✓ |
| Operator review of all REQUIRED frames last week | ✗ | ✓ (one SQL query) |

### Append-only discipline

Mirrors `aegis_request_trace` + `aegis_decision_threshold_trace` + `aegis_claim_confidence`. No `UPDATE`, no `DELETE` (except a 30-day retention purge if needed). The audit table is the *system of record* for what Decision Frames Fortress emitted; rewriting it is doctrinally forbidden.

---

## §6 — Is the Audit Table Worth Implementing?

### Verdict: **YES — include in F.0**

### Cost (small, bounded)

| Item | Effort |
|---|---|
| Migration drafting + CHECK constraints + RLS policies | ~1 hour |
| `recordDecisionFrameAudit()` implementation + tests | ~1 hour |
| Schema review + ratification | per-operator cycle |
| Per-write overhead at runtime | <50ms per report (single INSERT) |
| Per-write IO cost | negligible (~1KB per row) |
| Storage growth | ~1MB/month at projected report volume (estimated 100 reports/day × ~1KB) |

### Benefit (compounds across campaigns)

1. **Watchdog Campaign 1 W.5 substrate** — already identified in Campaign 1 plan as gated on this audit table. Without it, W.5 is impossible to build cleanly.
2. **Post-Mortem Campaign 3 forensic timelines** — already identified as a key evidence source. Without it, post-mortems lose visibility into "what Decision Frame fired when."
3. **Drift detection** — observed distribution vs expected distribution surfaces AI calibration issues (over-classifying as REQUIRED, under-classifying as NONE).
4. **DB-layer doctrine backstop** — CHECK constraints enforce conditional-element rules non-bypassably. A future generator can't accidentally emit a malformed frame even if the application-layer lint is bypassed.
5. **Operator trend review** — "show me all REQUIRED frames in CRT this week" is one SQL query.
6. **Decision Layer R1.x integration** — when R1.1+ ships, decision-frame audit rows align with `aegis_decision_threshold_trace` rows; joint analysis becomes possible.

### Schema sketch (illustrative, not authorized)

```sql
CREATE TABLE public.aegis_decision_frame_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  report_class text NOT NULL CHECK (report_class IN (
    'daily_briefing','executive_briefing','poi_report','incident_briefing',
    'sra_report','wildfire_daily','security_bulletin','security_briefing',
    'consortium_briefing','travel_briefing'
  )),

  decision_check text NOT NULL CHECK (decision_check IN ('REQUIRED','MONITOR','NONE')),
  decision_check_justification text NOT NULL DEFAULT '',

  what_changed    text NOT NULL,
  why_it_matters  text NOT NULL,
  who_should_care text NOT NULL,

  decision_required  text,
  consequence        text,
  recommended_action text,

  source_trace_id uuid,    -- optional FK to aegis_request_trace
  lint_errors jsonb DEFAULT '[]'::jsonb,
  emitted_at timestamptz NOT NULL DEFAULT now(),

  -- Provenance Doctrine backstop
  CONSTRAINT aegis_decision_frame_audit_provenance_ck CHECK (tenant_id IS NOT NULL),

  -- Conditional-element discipline (non-bypassable)
  CONSTRAINT aegis_decision_frame_audit_required_complete_ck CHECK (
    decision_check != 'REQUIRED' OR (
      decision_required IS NOT NULL
      AND consequence IS NOT NULL
      AND recommended_action IS NOT NULL
      AND decision_check_justification != ''
    )
  ),
  CONSTRAINT aegis_decision_frame_audit_monitor_complete_ck CHECK (
    decision_check != 'MONITOR' OR (
      recommended_action IS NOT NULL
      AND decision_check_justification != ''
    )
  ),
  CONSTRAINT aegis_decision_frame_audit_none_clean_ck CHECK (
    decision_check != 'NONE' OR (
      decision_required IS NULL
      AND consequence IS NULL
      AND recommended_action IS NULL
    )
  )
);

CREATE INDEX idx_aegis_dfa_tenant_emitted ON public.aegis_decision_frame_audit (tenant_id, emitted_at DESC);
CREATE INDEX idx_aegis_dfa_class_emitted  ON public.aegis_decision_frame_audit (report_class, emitted_at DESC);
CREATE INDEX idx_aegis_dfa_required       ON public.aegis_decision_frame_audit (decision_check, emitted_at DESC)
  WHERE decision_check = 'REQUIRED';
CREATE INDEX idx_aegis_dfa_trace          ON public.aegis_decision_frame_audit (source_trace_id)
  WHERE source_trace_id IS NOT NULL;

-- RLS
ALTER TABLE public.aegis_decision_frame_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_frame_audit_super_admin_read"
  ON public.aegis_decision_frame_audit FOR SELECT
  USING (is_super_admin(auth.uid()));

CREATE POLICY "decision_frame_audit_service_role"
  ON public.aegis_decision_frame_audit TO service_role
  USING (true) WITH CHECK (true);

-- Retention purge (consistent with aegis_request_trace 30-day pattern)
-- Implemented via cron job; not in this migration
```

The DB-layer CHECK constraints make the doctrine non-bypassable. A generator that tries to emit a REQUIRED frame without justification fails at the DB layer even if application-layer lint is skipped or buggy. This is the Provenance Doctrine "service-role untrusted by default" pattern applied to Decision Frame discipline.

### Why "optional" framing is misleading

The audit table was framed as optional in the Convergence Plan (Task #116) because the operator might defer the migration cost. But after detailed analysis:

- The migration cost is ~1 hour.
- The benefit compounds across Campaigns 1, 3, and operator observability.
- The DB-layer CHECK backstop is a meaningful additional layer of doctrine enforcement.
- Without it, Watchdog W.5 has no clean substrate.

**Recommendation: include the audit table in F.0 as a NON-optional component.** The "optional" framing was a budget hedge; the actual cost is below the threshold where deferring is wise.

---

## §7 — Failure Modes + Graceful Degradation

### When `parseDecisionFramePrefix()` fails

AI failed to emit the markers OR emitted malformed content.

**Behavior:** `parseResult.ok === false`. Generator chooses:
- **Policy A (recommended):** fall back to programmatic NONE composition with quiet-day canonical phrasings. Doctrine is honored; report still emits.
- **Policy B:** retry the AI call once. Risk: same failure pattern.
- **Policy C:** abort the report. Risk: report doesn't emit at all.

Operator-policy choice. Recommended default: Policy A for daily briefing (don't lose the briefing); Policy B+A for executive briefing (try harder; fall back if needed); Policy C for SRA (formal artifact; better to fail than emit a degraded one).

### When `composeDecisionFrame()` validation fails

Generator passed invalid input (e.g., REQUIRED without justification).

**Behavior:** `result.ok === false`. Generator logs the errors and either:
- Recomposes with corrected inputs
- Falls back to lower classification (REQUIRED → MONITOR → NONE)
- Aborts the report

Doctrine compliance is non-negotiable; the function never returns a partial frame.

### When `recordDecisionFrameAudit()` fails

Persistence error (network, DB constraint, RLS).

**Behavior:** logs warning; report still emits. Audit miss is non-fatal. Consistent with `aegis_claim_confidence` and `universal_learning_log` patterns.

### When the AI emits Elements 4 + 5 outside REQUIRED

R9 lint catches it. `parseDecisionFramePrefix()` returns `ok: false` with R9 violations listed. Generator falls back per policy above.

### When the AI promotes to REQUIRED without justification

R8 lint catches it. Same path as R9.

### When the audit table doesn't exist (early F.0 deploy without migration)

`recordDecisionFrameAudit()` catches the table-doesn't-exist error and returns `{ok: false, error: ...}`. Non-fatal. Same fall-through as persistence errors. Allows the shared module to deploy *before* the migration if needed for staged rollout.

---

## §8 — Test Coverage

Unit tests (`aegis-decision-frame.test.ts`) cover:

| Test class | Cases |
|---|---|
| `defaultDecisionCheckFor()` | Returns correct enum for each of 10 report classes; expected distributions sum to 100 |
| `composeDecisionFrame()` happy path | Each Decision Check tier with valid input → returns `{ok: true, frame: …}` |
| `composeDecisionFrame()` rejection | REQUIRED without justification rejected; MONITOR with Elements 4+5 rejected; NONE with any conditional element rejected; empty Elements 1-3 rejected |
| `lintDecisionFrame()` | R8/R9/R10 fire correctly on synthetic violations |
| `parseDecisionFramePrefix()` happy path | Well-formed AI output extracts cleanly |
| `parseDecisionFramePrefix()` malformed | Missing markers / partial content / wrong tier / element order swap — all return `ok: false` |
| `stripDecisionFramePrefix()` | Removes markers + content cleanly; idempotent on stripped text |
| `renderDecisionFrameMarkdown()` | Each Decision Check tier produces correct shape; conditional sections suppressed correctly |
| `renderDecisionFrameHtml()` | HTML safe (no unescaped user input); correct visual hierarchy per tier |
| `renderDecisionFrameJson()` | Structured for React consumption |
| `recordDecisionFrameAudit()` | Happy path; CHECK constraint violation; RLS rejection; table-missing graceful failure |

Integration tests deferred to F.1+ (end-to-end with a synthetic report; AI parse-on-real-output).

---

## §9 — Out of Scope for F.0

Items explicitly NOT in F.0:

- **No generator modifications** — F.1+ phases wire generators to the module
- **No prompt rewrites** — except `decisionFrameSystemPromptFragment()` which is a *fragment*, not a full prompt
- **No HTML email template changes** — F.1 modifies `send-daily-briefing/buildBriefingEmail()` separately
- **No POI report template changes** — F.2 wires the POI report separately
- **No frontend changes** — F.8 ships the React component separately
- **No Watchdog tripwire** — Campaign 1 W.5 consumes the audit table; not built here
- **No Post-Mortem integration** — Campaign 3 forensic timelines consume the audit table; not built here
- **No retention cron** — 30-day purge is added later if needed (consistent with `aegis_request_trace` deferred-purge pattern)
- **No backfill** — first row inserted at first emit post-deploy; no historical data to migrate

---

## §10 — F.0 Acceptance Criteria

Operator-reviewable evidence that F.0 is complete:

| # | Criterion |
|---|---|
| F.0.1 | `_shared/aegis-decision-frame.ts` exists with all exports listed in §1 |
| F.0.2 | Unit tests pass (`npm run test` or equivalent harness; vitest precedent from C.2) |
| F.0.3 | TypeScript build green (`npm run build`) |
| F.0.4 | `_shared/aegis-decision-frame.ts` is imported by ZERO generators (F.0 is module-only) |
| F.0.5 | Migration draft for `aegis_decision_frame_audit` exists at `supabase/migrations/<timestamp>_aegis_decision_frame_audit.sql` |
| F.0.6 | Migration applies cleanly on staging via `apply_migration` (parity-exact verification) |
| F.0.7 | Migration applies cleanly on prod (parity-exact); CHECK constraints proven non-bypassable via negative tests (mirrors C.x verification pattern) |
| F.0.8 | `recordDecisionFrameAudit()` integration test passes against staging fixture |
| F.0.9 | Documentation updated in `docs/platform-operations/` with module reference + per-class default table |
| F.0.10 | Zero runtime impact verified — no generator currently calls the module; existing reports unchanged |

All criteria must pass before operator GO on R2 (F.1 + F.2 + F.6 bundle).

---

## §11 — F.0 Estimated Effort

| Item | Effort |
|---|---|
| Module file (~500 LOC) | 6–8 hours |
| Unit tests | 2–3 hours |
| Migration drafting + ratification | 1 hour |
| Staging apply + parity verification | 30 min |
| Prod apply + parity-exact verification | 30 min |
| Documentation update | 1 hour |
| **Total F.0** | **11–14 hours** |

Consistent with Convergence Plan Task #116 §4 estimate (~6–10 hours for F.0); refined estimate includes test coverage + migration discipline.

Rollback path: `git revert` of the module file + migration (`DROP TABLE aegis_decision_frame_audit`). No generator depends on it yet, so rollback is clean.

---

## §12 — Doctrinal Alignment Check

Final tie-back to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

| Doctrinal commitment | Module-level enforcement |
|---|---|
| Six-element Decision Frame (Decision Layer Doctrine PR #58) | Type definition + composition API + render API |
| I1 invariant (statistical noise ≠ Decision Frame) | Decision Check classifier + per-class defaults + R8 lint |
| Anti-fabrication (Aegis Authority Doctrine) | R8/R9/R10 lint surface; AI prompt fragment with anti-promotion language |
| Grounding-State Doctrine (no provenance → no recommendation) | REQUIRED requires grounded justification; recommendation suppressed on NONE |
| Provenance Doctrine (service-role untrusted) | DB-layer CHECK constraints non-bypassable; RLS policies |
| Tenant isolation (CQ1) | `tenant_id` is mandatory at composition; never NULL |
| Append-only audit (Aegis Flight Recorder pattern) | `aegis_decision_frame_audit` append-only; no UPDATE/DELETE |

The shared module IS the architectural commitment to operationalize Doctrine v2.

---

## §13 — Held

- No implementation
- No code, branch, migration, deploy
- F.0 ratification requires operator GO on this architecture
- Module file + unit tests + migration + persistence helper = single bundled PR shape recommended for F.0
- Audit table recommended NON-optional (§6); operator may still defer if budget-driven
- F.1 + F.2 + F.6 bundle (R2 in convergence plan) is the *next* gate after F.0 acceptance
- This document supersedes the "optional audit table" framing in Task #116 §F.0; the refined recommendation is: include it

🤖 Generated with [Claude Code](https://claude.com/claude-code)
