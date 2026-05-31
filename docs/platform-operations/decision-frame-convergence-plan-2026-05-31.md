# Fortress Decision Frame Convergence Plan

**Operator-directed 2026-05-31 (Task #116).** Establish the six-element Decision Frame as Fortress's canonical reporting doctrine across all report generators. Planning only. No implementation, code, branches, or deployments.

**Tied to Commander's Intent:** *"Preserve decision space by shortening Signal → Decision → Action."* Every Fortress report is a Decision Frame artifact first, a report-specific payload second. The reader's first 60 seconds are always the same shape; the body remains discipline-specific.

**Core architectural commitment:** the Decision Frame is a **shared header**, not a structural rewrite. Report-specific payloads remain intact below the frame. One shared module, N generators consume it, N existing payload structures unchanged.

---

## §1 — Report Generator Inventory (current state)

Categorized by purpose; ranked by customer-trust impact within each category.

### Category A — Daily / cadenced operator briefings

| Generator | Surface | Customer-facing? | Current AI/programmatic? | Decision Frame readiness |
|---|---|---|---|---|
| **`send-daily-briefing`** (cron 13:00 UTC) | Email — internal SOC operators | No (internal) | AI-generated (gpt-4o-mini) | 3.5 / 6 elements — BLUF + DEDUCTIONS + named-owner POSTURE; Elements 4 + 5 missing |
| **`generate-daily-briefing`** | On-demand per client (used by send-daily-briefing helper) | Both — client-scoped briefing payload | AI-generated | Same as send-daily-briefing |

### Category B — Investigation outputs (per-target reports)

| Generator | Surface | Customer-facing? | Current AI/programmatic? | Decision Frame readiness |
|---|---|---|---|---|
| **`generate-poi-report`** | HTML — POI investigation output | YES — customer-facing (analyst share) | AI-generated + claim-frame layer (Workstream D dark) | 2 / 6 elements — EXECUTIVE SUMMARY + RECOMMENDED NEXT STEPS; Decision-oriented framing absent |
| **`generate-incident-briefing`** | HTML — incident-specific | YES — both internal + customer | AI-generated | 1 / 6 elements — narrative summary; no decision/consequence framing |
| **`generate-sra-report`** | HTML — Security Risk Assessment (Aaron's documented format) | YES — high-stakes customer artifact | Programmatic (Phase 2F wizard renders structured data) | 0 / 6 elements — formal SRA shape, no decision-frame header |

### Category C — Executive / cross-tenant reports

| Generator | Surface | Customer-facing? | Current AI/programmatic? | Decision Frame readiness |
|---|---|---|---|---|
| **`generate-executive-report`** | HTML/PDF — executive intelligence | YES — highest-stakes customer artifact | AI-generated with reliability gate (`runEvidenceGate`, `getReliabilityFirstPrompt`) | 1 / 6 elements — has evidence-gate but no decision framing |
| **`generate-consortium-briefing`** | HTML — cross-tenant consortium output | Customer-facing (consortium members) | AI-generated | 1 / 6 elements |

### Category D — Specialty reports

| Generator | Surface | Customer-facing? | Current AI/programmatic? | Decision Frame readiness |
|---|---|---|---|---|
| **`generate-wildfire-daily-report`** | HTML — wildfire intel | YES — NE BC operations + tenants | Programmatic (FWI estimates, station ratings, AQHI, restriction matrix) | 0 / 6 elements — informational, no decision frame |
| **`generate-security-bulletin`** | HTML — security advisory | YES — customer-facing | AI-generated | 1 / 6 elements |
| **`generate-security-briefing`** | HTML — generic security brief | Both | AI-generated | 1 / 6 elements |
| **Travel briefing** (`parse-travel-itinerary` + `parse-travel-security-report` + frontend renderer) | HTML — per-itinerary risk brief | YES — customer-facing (travelers) | Mixed (parser + AI synthesis) | 0 / 6 elements |

### Category E — Audio / downstream surfaces

| Generator | Surface | Customer-facing? | Current AI/programmatic? | Decision Frame readiness |
|---|---|---|---|---|
| **`generate-briefing-audio`** | MP3 — TTS of existing briefing text | Both | Programmatic (Buzzsprout/TTS) | n/a — derived from input text. Decision Frame inherits from upstream generator. |

### Category F — Generic / unclear-purpose

| Generator | Status |
|---|---|
| `generate-report` | Generic catch-all endpoint; potentially deprecated. Treated as "audit before convergence" — exclude from initial scope. |
| `generate-academy-course` | Internal training content; not a decision artifact. **Out of scope.** |
| `process-bug-report` | Bug-report intake; internal. **Out of scope.** |
| `view-sra-report` | Read surface for SRA. Not a generator. |
| `process-security-report` | Parser, not generator. |
| `parse-travel-security-report` | Parser. Feeds travel briefing. |

### Category G — Infrastructure (not in convergence scope)

`alert-delivery`, `alert-delivery-secure`, `briefing-chat-response`, `briefing-feedback`, `briefing-query`, `generate-agent-avatar`, `generate-embeddings`, `generate-playbook`, `generate-monitoring-proposals`, `generate-posture-content`, `generate-report-visuals`, `generate-vehicle-image`, `persist-report`, `scheduled-report-delivery`, `predictive-alert-tuning`, `get-login-summary`, `send-*` (non-briefing) — all infrastructure / non-report-artifact surfaces.

### Category H — Aegis ad-hoc outputs (handled by retirement of `ai-tools-query` work)

The Aegis chat surface itself emits report-shaped responses (e.g., `lookup_ioc_indicator` verdict, `update_risk_profile` confirmation). Already covered by Workstream D claim-frame and Decision Layer Doctrine work; not re-listed here.

---

## §2 — Current-State Matrix

Reading: **❌** = element absent, **▴** = partial / implicit, **✅** = present and explicit.

| Generator | 1. What changed | 2. Why it matters | 3. Who should care | 4. Decision required | 5. Consequence | 6. Recommended action | Score |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| send-daily-briefing | ▴ (BLUF) | ▴ (DEDUCTIONS) | ▴ (named-owner POSTURE) | ❌ | ❌ | ✅ (POSTURE with timeframe) | 3.5 |
| generate-daily-briefing | ▴ | ▴ | ▴ | ❌ | ❌ | ✅ | 3.5 |
| generate-poi-report | ▴ (EXECUTIVE SUMMARY) | ❌ | ❌ | ❌ | ❌ | ✅ (RECOMMENDED NEXT STEPS) | 2 |
| generate-incident-briefing | ▴ | ❌ | ❌ | ❌ | ❌ | ▴ | 1 |
| generate-sra-report | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 0 |
| generate-executive-report | ▴ | ❌ | ❌ | ❌ | ❌ | ▴ | 1 |
| generate-consortium-briefing | ▴ | ❌ | ❌ | ❌ | ❌ | ▴ | 1 |
| generate-wildfire-daily-report | ▴ (season banner) | ▴ (restriction matrix) | ❌ | ❌ | ❌ | ❌ | 1 |
| generate-security-bulletin | ▴ | ❌ | ❌ | ❌ | ❌ | ▴ | 1 |
| generate-security-briefing | ▴ | ❌ | ❌ | ❌ | ❌ | ▴ | 1 |
| Travel briefing | ▴ (risk score) | ▴ (per-leg context) | ❌ | ❌ | ❌ | ❌ | 1 |
| **Mean score** | | | | | | | **~1.4** |

**Net diagnosis:** every report has Element 1 (What changed) in some form. Most have Element 6 (Recommended action) in some form. **Elements 4 (Decision required) and 5 (Consequence) are essentially absent across the entire generator fleet.** Element 3 (Who should care) is rarely explicit. This pattern is the gap.

---

## §3 — Gap Analysis

### Gap 1 — No shared composition module

Every generator currently authors its own prompts and rendering inline. There is no shared `_shared/aegis-decision-frame.ts` that composes the six-element frame from typed inputs.

**Why this matters:** without a shared module, 11 generators would each need 6 independent edits. With a shared module, the change is 1 module + 11 thin call sites. Same shape pattern as `_shared/aegis-claim-frame.ts` (Workstream D) which already lives.

### Gap 2 — Mixed AI / programmatic emission

Some generators (daily briefing, POI, executive, consortium, security bulletin, security briefing) are AI-generated. Others (SRA, wildfire daily) are programmatic. The shared module must support **both modes**:

- **AI mode:** prompt the AI to emit the Decision Frame as a structured prefix (e.g., between `=== DECISION FRAME START ===` / `=== DECISION FRAME END ===` markers); generator extracts + renders via shared module.
- **Programmatic mode:** generator computes the six elements from typed data; passes to shared module render function.

The shared module accepts either typed input (programmatic) or parsed prefix (AI). Same output shape.

### Gap 3 — Decision-not-required reports

Many Fortress reports are "for awareness only" — wildfire daily reports during a quiet shoulder season, daily briefings on quiet days, executive reports tracking long-running situations. **The Decision Frame must support an explicit "FOR AWARENESS ONLY" mode** where Elements 4 (Decision required) and 5 (Consequence) are replaced by an `awareness_note` field.

Doctrinal alignment: Decision Layer I1 invariant — *statistical noise without commitment impact ≠ a Decision Frame*. Awareness-only reports honor this by NOT pretending a decision exists.

### Gap 4 — Prose-lint coverage

Workstream D R1-R6 prose-lint applies to claim-frame content but not to Decision Frame content. Each Decision Frame element needs lint rules:

- Element 1 (What changed): must reference a specific delta (entity, signal_id, count, timestamp). Banned: "various," "some," "potentially."
- Element 2 (Why it matters): must reference a named stakeholder, asset, or value. Banned: "could be important."
- Element 3 (Who should care): must name a role + tenant scope. Banned: "stakeholders."
- Element 4 (Decision required): must be a specific question OR "FOR AWARENESS ONLY." Banned: "review the situation."
- Element 5 (Consequence): must include a timeframe and a specific outcome. Banned: "if not addressed."
- Element 6 (Recommended action): must include named owner role + specific timeframe. (Already lint-rule R6 in some form for daily briefing.)

### Gap 5 — Validation surface absent

There is no per-report Decision Frame validation today. Post-convergence, every emitted report should be runtime-validated: did the AI emit all 6 elements? Did each pass prose-lint? Did the report's customer-facing surface render the frame correctly?

This is the audit substrate that Campaign 1 W.5 (doctrine-compliance sweeps) inherits.

### Gap 6 — Operator-facing toggles for awareness mode

Some reports default to decision-required (daily briefing in active week), others default to awareness-only (wildfire report in off-season). The generator must decide *which* mode to emit, OR the operator must override. Default-decision-required + operator-override-to-awareness is the recommended posture.

### Gap 7 — Aegis chat returns are NOT in scope (already covered)

Aegis tool responses (`lookup_ioc_indicator`, `update_risk_profile`, etc.) are NOT report artifacts; they're tool results consumed by a downstream Aegis response. Decision Frame doctrine doesn't apply to tool responses directly. (The downstream Aegis response may itself emit a Decision Frame; that's a `dashboard-ai-assistant` prompt question already partially addressed by the Decision Layer Doctrine.)

### Gap 8 — Audio output

`generate-briefing-audio` consumes upstream text. If the upstream text leads with the Decision Frame, the audio leads with the Decision Frame — automatically. No separate work needed for the audio surface. (Exception: TTS pronunciation of `=== DECISION FRAME ===` markers must be sanitized at the audio-prep step.)

### Gap 9 — Render targets diverge

- send-daily-briefing → HTML email
- generate-poi-report → markdown then HTML via report viewer
- generate-wildfire-daily-report → HTML
- generate-sra-report → HTML (formal SRA format)
- Etc.

The shared module must support markdown + HTML render targets. Same six-element data, two output formats.

---

## §4 — Convergence Sequence (Lowest-Risk Implementation Path)

The convergence sequence is **architecture-first, then per-generator wiring**. Same shape as Workstream D's deployment pattern: shared module + slim slice + dark deploy + lit per surface.

### Phase F.0 — Shared Decision Frame module (the hidden architecture work)

**Scope:** create `_shared/aegis-decision-frame.ts` and adjacent files. Pure modules; no generator changes.

Components:
1. `aegis-decision-frame.ts` — type definitions + `composeDecisionFrame()` + `renderDecisionFrameMarkdown()` + `renderDecisionFrameHtml()` + `parseDecisionFramePrefix()` (for AI-emitted frames)
2. `aegis-decision-frame-prose-lint.ts` — Element-1-through-6 lint rules (new R8-R13 in the existing prose-lint family)
3. `aegis-decision-frame.test.ts` — unit tests for composition + rendering + parsing + lint
4. (Optional) `aegis_decision_frame_audit` table — append-only persistence per emitted frame, indexed by (tenant_id, generator, emitted_at). Same pattern as `aegis_claim_confidence`. Schema migration gated on operator GO.

**No edge function changes in F.0.** No deploy. No runtime effect.

**Effort:** ~6–10 hours engineering + 2–3 hours unit tests.

**Risk:** essentially zero — additive shared module.

### Phase F.1 — Pilot wire-up: ONE generator (recommended: send-daily-briefing)

Why send-daily-briefing first:
- Already 3.5 / 6 elements (smallest delta)
- Internal-only audience (operator + SOC) so calibration mistakes are recoverable without customer impact
- Daily cadence — fast feedback loop on shape correctness
- Existing prompt is already a Decision-Frame-shaped 5-section structure; adoption is template-level, not paradigm-shift-level

Wire-up:
- Prompt rewrite: AI emits Decision Frame in structured prefix before the 5 existing sections
- HTML template prepends rendered frame above existing prose
- Frame audit table records emitted frame (if F.0 §4 includes the audit table)

**Effort:** 3–4 hours (matches Q1 estimate from Task #115 assessment).

**Risk:** low (single file, single function).

### Phase F.2 — Second wire-up: POI report (CUSTOMER-facing)

Why POI second:
- Workstream D claim-frame already wired (dark); flipping `D_SLIM_SLICE_ENABLED` per Task #115 Q2 already in the pipeline
- Customer-facing — first surface where Decision Frame lands externally
- Highest customer-trust delta per LOC
- Bundles cleanly with Workstream D activation (Task #115 Q2 recommendation)

Wire-up:
- Generator emits Decision Frame at top of report markdown
- Claim-frame section continues at the bottom (existing dark layer flipped lit in same release per Task #115)

**Effort:** ~4 hours

**Risk:** low — additive to existing report shape.

### Phase F.3 — Specialty programmatic generators (wildfire daily, SRA)

Why programmatic generators next:
- No AI emission to calibrate — pure typed-input composition
- Per-report determinism eliminates a class of validation risk
- Wildfire daily is operationally important (BC fire season) but easy to test
- SRA is high-stakes customer artifact but structured

Wire-up:
- Generator computes the six elements from existing typed data
- Calls `renderDecisionFrameHtml()` from shared module
- Prepends to existing HTML output

**Effort:** ~3 hours per generator (~6 hours total).

**Risk:** low.

### Phase F.4 — Investigation + executive + consortium + security generators

Wire-up in order of customer-trust impact:
- `generate-executive-report` (highest-stakes customer artifact)
- `generate-consortium-briefing` (cross-tenant)
- `generate-incident-briefing`
- `generate-security-bulletin`
- `generate-security-briefing`
- `generate-poi-report` already covered in F.2

Same shape: AI prompt rewrite to emit Decision Frame prefix; generator parses + renders via shared module.

**Effort:** ~3 hours per generator (~15 hours total).

**Risk:** low per surface; cumulative test surface grows.

### Phase F.5 — Travel briefings (parser-side challenge)

Travel briefings are partially-parsed + AI-synthesized. Requires deciding whether the parser supplies the typed input for the frame OR the AI emits the frame from raw inputs.

**Effort:** ~4–6 hours (depends on decision).

**Risk:** medium — parser/AI seam is the only novel pattern in the convergence.

### Phase F.6 — Audio briefing pre-flight sanitization

`generate-briefing-audio` strips Decision Frame markers from input text before TTS (so the audio doesn't say "equals equals equals decision frame start equals equals equals"). Single-line regex.

**Effort:** ~30 minutes.

**Risk:** trivial.

### Phase F.7 — Runtime audit + Watchdog tripwire integration

Per-report Decision Frame validation runs in a daily watchdog phase:
- Did the report emit all 6 elements?
- Did each element pass prose-lint?
- Were `decision_required = FOR AWARENESS ONLY` reports legitimately awareness-only (not hiding a decision the report should have surfaced)?

Feeds into Campaign 1 W.5 (doctrine-compliance sweeps). NOT executed inside Convergence Plan F; this is the bridge to Watchdog.

**Effort:** out-of-scope for convergence; deferred to Watchdog campaign W.5.

### Phase F.8 — Frontend render surfaces

Customer-facing frontend renderers (POI Report viewer, SRA viewer, Wildfire portal, Security bulletins UI) display the Decision Frame as a visually distinct block at the top — same shape across surfaces. Single shared React component if a sufficiently common rendering target exists.

**Effort:** ~6 hours (one React component + 4 viewer integrations).

**Risk:** low — additive UI.

---

## §5 — Recommended Rollout Order

Operator-stated requirements: lowest-risk path that operationalizes the Decision Frame across all generators. Order is **architecture → fast feedback → customer-trust delta → cumulative coverage**.

| Slot | Phases | Generators landing | Rationale |
|---|---|---|---|
| **R1** | F.0 (shared module) | none yet | Hidden architecture work; zero behavioral risk; gates everything else |
| **R2** | F.1 + F.2 + F.6 (bundled with Task #115 E.0 Q1/Q2 ship) | send-daily-briefing + generate-poi-report (+ audio sanitization) | Highest leverage per hour; operationalizes Decision Layer doctrine on two surfaces simultaneously; one of them customer-facing |
| **R3** | F.3 (wildfire + SRA programmatic) | generate-wildfire-daily-report + generate-sra-report | Programmatic determinism = cleanest second wave; tests the shared module's two render modes |
| **R4** | F.4 (executive + consortium + incident + bulletins) | generate-executive-report → generate-consortium-briefing → generate-incident-briefing → generate-security-bulletin → generate-security-briefing | Wider AI-emission cohort; calibration tested on bigger surface |
| **R5** | F.5 (travel) | parse-travel-security-report + travel surfaces | Hardest seam (parser/AI handoff); last in sequence to benefit from upstream lessons |
| **R6** | F.8 (frontend convergence) | shared React Decision Frame component on POI viewer, SRA viewer, wildfire portal, security bulletins UI | Customer-facing visual consistency lands once all generators emit |
| **R7** | F.7 (Watchdog tripwire) | n/a — bridges to Campaign 1 W.5 | Doctrine compliance becomes auditable |

**Total estimated effort:** ~50–60 hours engineering + ~15 hours validation = ~70 hours = **2–3 weeks of focused work, gated phase-by-phase**.

Per-phase operator GO required. No automatic promotion.

---

## §6 — Quick Wins (within this campaign)

1. **R2 ship matches Task #115 E.0 Q1+Q2.** That bundle (already assessed, awaiting GO) is the **entry point** to the convergence; F.0 + F.1 + F.2 + F.6 bundle.
2. **R3 wildfire activation** before fire season — landing the Decision Frame on the wildfire daily report during quiet shoulder months tests the awareness-only mode (Gap 3) before fire season generates volume.
3. **R3 SRA activation** — SRA reports are formal customer-facing artifacts with low volume; pilot-validation cycle is fast.
4. **Awareness-only mode** — flag reports without a real decision as "FOR AWARENESS ONLY" honestly; eliminates the noise of pretend-decisions.
5. **Audio sanitization (F.6)** — 30-minute fix, zero risk; enables R2's text-to-audio downstream surface.

---

## §7 — Hidden Architecture Work

Items the operator might not flag explicitly but are *required* for the convergence to work:

1. **`_shared/aegis-decision-frame.ts`** + adjacent modules (F.0). Without this, every generator does its own thing — exactly the situation E.1 Convergence Skeleton was meant to prevent (per Campaign 2 long-horizon roadmap). F.0 IS the E.1 skeleton.
2. **Optional `aegis_decision_frame_audit` table** — append-only, tenant_id NOT NULL + CHECK backstop per Provenance Doctrine. Mirrors `aegis_claim_confidence` and `aegis_decision_threshold_trace` patterns. Provides the substrate for Campaign 1 W.5 and Campaign 3 forensic timelines.
3. **Prose-lint extension R8-R13** — Element-specific rules in `aegis-decision-frame-prose-lint.ts`. Reuses the existing Workstream D prose-lint patterns + adds Element-specific banned-phrase lists.
4. **AI prompt-prefix parser** — `parseDecisionFramePrefix()` extracts the structured frame from AI output. Robust against AI omission, partial emission, malformed markers. Same defensive parsing discipline as `aegis-claim-frame.ts:101-150`.
5. **HTML render component** — both edge-function-side (HTML email/PDF generators) and React-side (customer-facing UIs). Two render targets, one data model.
6. **Awareness-mode toggle** — the Decision Frame's `decision_required: "FOR AWARENESS ONLY"` shape is a doctrine commitment that needs to be honored by every generator that emits it. Defaults: daily briefing on quiet days → awareness; wildfire daily off-season → awareness; SRA always decision-required.
7. **Frontend shared `<DecisionFrame />` React component** — when F.8 lands, all customer-facing surfaces render the same way. Without this, frontend convergence stalls at "every surface re-renders the frame slightly differently."

---

## §8 — Dependencies

| Dependency | Status | Impact |
|---|---|---|
| Decision Layer Doctrine PR #58 (six-element frame ratified) | Ratified 2026-05-29 | Provides the structural definition. No further ratification needed. |
| Workstream D claim-frame + prose-lint pattern | Prod-applied 2026-05-28 dark | Provides the implementation template the shared module reuses |
| `_shared/aegis-prose-lint.ts` R1-R6 + R7 (tradecraft) | Operational | Decision Frame prose-lint extends this with R8-R13 |
| `aegis_claim_confidence` table pattern | Operational | Decision Frame audit table mirrors |
| `aegis_request_trace` (Flight Recorder) | Operational | Decision Frame audit ties to trace_id |
| Decision Layer R1.0 schema (`aegis_decision_threshold_trace`) | Deployed 2026-05-29; zero behavioral effect | Decision Frame interacts with R1.x detectors when they ship; not a blocking dependency for R1-R6 of convergence |
| C.4 commitment-data scaffolding | Adoption window active (closes ~2026-06-27) | Decision Frame Element 4 references commitments; observability depends on C.4 adoption |
| Grounding-State Doctrine | Ratified 2026-05-27 | Recommendation block must respect Grounding-State (Element 6 must be grounded per certified retrieval) |
| INC-LEARN-CONTAM containment | Active | Decision Frame body must not inject from frozen stores — Element-by-Element provenance discipline inherits this constraint |

---

## §9 — Blast Radius

Per-phase blast radius assessment:

| Phase | Files touched | Surfaces affected | Reversibility |
|---|---|---|---|
| F.0 | ~4 new shared files (module + lint + test + optional migration) | None (no consumer yet) | `git revert` + (optional) DROP migration |
| F.1 | `send-daily-briefing/index.ts` (1 file) | Daily briefing email | `git revert` + redeploy (~5 min) |
| F.2 | `generate-poi-report/index.ts` (1 file) | POI customer-facing report | `git revert` + redeploy + flag flip |
| F.3 | `generate-wildfire-daily-report/index.ts`, `generate-sra-report/index.ts` | Wildfire + SRA surfaces | `git revert` per file |
| F.4 | 5 generator files | Executive + consortium + incident + bulletins + security briefing | `git revert` per file; can be partial |
| F.5 | 1-2 travel files | Travel briefing | `git revert` |
| F.6 | `generate-briefing-audio/index.ts` | Audio output sanitization | `git revert` |
| F.7 | (out of scope for convergence) | n/a | n/a |
| F.8 | 1 new React component + 4 viewer integrations | Customer-facing UIs | Frontend revert + redeploy |

Cumulative across all phases: 11 generator files + 1 React component + 4 viewer integrations + ~4 shared/migration files = **~20 file changes total**. Distributed across 2–3 weeks. Each phase rollback-safe.

---

## §10 — Doctrinal Tie-back to Commander's Intent

*"Preserve decision space by shortening Signal → Decision → Action."*

Convergence to a single Decision Frame on every Fortress report does three things explicitly:

1. **Shortens *Signal → Decision*.** The reader of any Fortress report now sees the decision (or absence-of-decision) in the first 60 seconds. The 5%-of-readers-who-want-the-evidence drill into the body. The 95% who need to act ACT, in seconds. Today they spend minutes-to-an-hour parsing 5+ formats.
2. **Preserves decision space by *honoring awareness-only*.** A report that pretends a decision exists when none does is a noise generator. The "FOR AWARENESS ONLY" mode lets Fortress signal *"nothing requires you right now"* explicitly — reducing the operator's cognitive load on quiet days, which IS decision space.
3. **Operationalizes ratified doctrine** — Decision Layer Doctrine PR #58 is currently a paper artifact. Convergence is the operational substrate. Every report becomes a Decision Layer instance. Watchdog (Campaign 1 W.5) audits them. Post-Mortem (Campaign 3) reconstructs them. Learning (Path A future) tunes them. The Decision Frame is the common protocol.

Without convergence, the Decision Layer Doctrine remains a doctrine without runtime presence. With convergence, every Fortress decision artifact carries the Doctrine in its bones.

---

## §11 — What this plan is NOT

- Not an authorization to implement F.0–F.8.
- Not a redesign of any report-specific payload below the Decision Frame.
- Not a forcing function for Aegis chat surfaces (those have their own Doctrine integration path).
- Not a removal of any existing report capability — additive only.
- Not a customer-visible UI redesign — F.8 lands the visual convergence on UI surfaces; existing email/PDF paths inherit the markdown / HTML render from the shared module.
- Not a fix for INC-LEARN-CONTAM-LEAK or Class B Provenance gap or ownerless `executive_intelligence` rows (those are E.2-E.4 work per Campaign 2 long-horizon roadmap).

---

## §12 — Recommended next gate

**R1 (Phase F.0) operator GO** — the shared module + (optional) audit table is the load-bearing precondition. Without R1, every subsequent phase is impossible to execute cleanly. R1 is **architecture-only, zero behavioral risk** — the cleanest single-decision GO point in the campaign.

After R1 lands, R2 (F.1 + F.2 + F.6) is the natural next ship — operationalizes the Decision Frame on two surfaces simultaneously, lands customer-trust improvement (POI) in time for BC Place / FIFA delivery window observation.

R3–R7 proceed phase-by-phase with operator GO per phase.

---

## §13 — Held

- No implementation
- No code, branch, migration, deploy
- No prompt rewrites
- No flag flips
- Each phase F.0 through F.8 requires separate operator GO
- Decision Frame audit table is OPTIONAL within F.0 — operator may defer
- Task #115 E.0 Q1+Q2 assessment remains the explicit Q1+Q2 deliverable; this convergence plan is the broader R1-R7 framing that contains it

🤖 Generated with [Claude Code](https://claude.com/claude-code)
