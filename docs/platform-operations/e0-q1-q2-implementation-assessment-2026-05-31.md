# E.0 Q1 + Q2 — Deep Implementation Assessment

**Operator request 2026-05-31 (Task #115).** Planning + execution assessment ONLY. No implementation. No code. No branches. No deployments.

Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

---

## §1 — Q1: Decision Frame in Daily Template

### A. Current State

**Report flow** (`send-daily-briefing/index.ts`, 507 lines):

```
Cron (daily 13:00 UTC)
  └── send-daily-briefing (Deno.serve)
        ├── Resolve per-client scheduled_briefings configurations
        ├── For each client tenant: pull 24h metrics, signals, incidents,
        │     autonomous actions, signal sequences
        ├── Compute trajectory (ESCALATING / STABLE / DE-ESCALATING)
        ├── callAiGateway() with strict 5-section structure prompt
        │     (system role = "senior intelligence officer for SOC")
        ├── buildBriefingEmail(briefingText, metrics, dateContext, ...)
        │     → HTML rendering via inline template (lines 433-507)
        └── Resend → recipient emails
```

**Current template structure** (verbatim from system prompt at `send-daily-briefing:259-265`):

1. **SITUATION OVERVIEW** — 2-3 sentences. Opens with BLUF (Bottom Line Up Front).
2. **KEY METRICS** — bullet-style numbers with context.
3. **PRIORITY SIGNALS** — top 3-5 actionable signals with specifics.
4. **EMERGING PATTERNS** — DEDUCTIONS-labeled trends or clusters.
5. **RECOMMENDED POSTURE** — actions with named owner role + timeframe (Immediate / 24h / 48h / This week).

**Existing Decision Frame components ALREADY present** (mapped against the ratified six-element frame from Decision Layer Doctrine PR #58):

| Six-element frame | Current presence in daily template |
|---|---|
| 1. **What changed** | Partial — BLUF + Priority Signals |
| 2. **Why it matters** | Partial — DEDUCTIONS in Emerging Patterns |
| 3. **Who should care** | Partial — RECOMMENDED POSTURE has named owner roles |
| 4. **What decision deserves attention now** | **MISSING** — implied but never explicit |
| 5. **Decision consequence** | **MISSING** — no "if not acted on, X happens" |
| 6. **Recommended action** | Present — RECOMMENDED POSTURE block, with owner + timeframe |

**Net diagnosis:** the daily briefing already has 3.5 of the 6 elements. The gap is the *decision-orientation header* — the operator currently has to infer "what decision is required?" from prose. Element 4 + Element 5 are the structural gap.

### B. Gap Analysis

**What is missing today:**

1. No "DECISION REQUIRED" or "FOR AWARENESS ONLY" classification at the top — every brief is read the same way.
2. No explicit "Consequence if not acted on" — the reader has to derive consequence from context.
3. The 5-section structure is *information-oriented*, not *decision-oriented*. A reader skimming for "what do I need to do?" must read all 5 sections.
4. HTML email template at `buildBriefingEmail()` `:433-507` renders the AI output as one prose block — no visual hierarchy that surfaces the decision.

**What prevents deployment:**

Nothing structural. The change is a focused prompt rewrite + a focused HTML template change. Both edits are local to `send-daily-briefing/index.ts`.

**Dependencies:**

- Decision Layer Doctrine six-element frame is *ratified*, not yet *operationalized*. Q1 IS the operationalization for one surface.
- No external dependencies. No schema change. No new RPCs. No new edge functions.
- Reuses existing `callAiGateway()` and Resend email pipeline.

**Risks:**

| Risk | Likelihood | Mitigation |
|---|---|---|
| AI mis-emits the new structure on first runs | Medium | Prompt explicitly defines the six-element shape; tested with one synthetic generation before activating |
| Recipients confused by new format | Low–Medium | Recipients are operators (Vince, internal SOC); transition note in first email |
| AI degrades to generic decision-frame templates (e.g., "Decision required: review the situation") | Medium | Prompt rule: every Decision Frame element must reference specific entity/signal/incident — same anti-fabrication discipline already in place |
| Existing recipients' email clients render the new HTML poorly | Low | HTML template change is additive — new block at top, existing prose follows |
| Briefing becomes longer | Low–Medium | Prompt rule: Decision Frame block ≤ 6 lines total; full briefing target ≤ 600 words (current is ~400-500) |

### C. Implementation Plan

**Exact files:**

- `supabase/functions/send-daily-briefing/index.ts` — single file, two surgical edits:
  - Lines 239-266: prompt system content (CRITICAL RULES + Structure block) — augment with Decision Frame instructions + section ordering
  - Lines 433-507: `buildBriefingEmail()` HTML template — prepend a `.decision-frame` block at top with visual distinction

**Exact generators:** `send-daily-briefing` only. Q1 does NOT touch `generate-daily-briefing` (used for ad-hoc client briefings, separate surface).

**Exact templates:** the HTML literal inside `buildBriefingEmail()`. Approximate change shape:

```
<!-- NEW: Decision Frame header (the 60-second block) -->
<div class="decision-frame" style="border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 24px; background: #1e293b;">
  <h2 style="color: #f59e0b; ...">DECISION FRAME</h2>
  <p><strong>What changed:</strong> <!-- AI-emitted --></p>
  <p><strong>Why it matters:</strong> <!-- AI-emitted --></p>
  <p><strong>Who should care:</strong> <!-- AI-emitted --></p>
  <p><strong>Decision required:</strong> <!-- AI-emitted, or "FOR AWARENESS ONLY" --></p>
  <p><strong>Consequence:</strong> <!-- AI-emitted --></p>
  <p><strong>Recommended action:</strong> <!-- AI-emitted; reused from RECOMMENDED POSTURE --></p>
</div>

<!-- EXISTING: full briefing prose below -->
${formatBriefingLines(briefingText)}
```

The AI is asked to emit the Decision Frame as a structured prefix (parseable, e.g., `=== DECISION FRAME ===` markers), the renderer extracts it, and the rest of the briefing renders as before.

**Flags involved:** none. Q1 is a hard ship-now change.

**Estimated blast radius:** single file (`send-daily-briefing/index.ts`); single edge function deploy; affects every daily briefing email going forward. Rollback = `git revert` + redeploy (~5–10 min).

### D. Validation Plan

**How we prove it's better:**

1. **Before snapshot.** Capture the most recent daily briefing email HTML rendered.
2. **After snapshot.** Generate one test daily briefing post-deploy; capture HTML.
3. **The 60-second test.** Place both before-and-after rendered HTML in front of a decision owner (Vince or operator); time how long it takes them to identify *the decision required*. Pass: <60 seconds on after, with >50% reduction vs before.
4. **Structural validation.** Post-deploy, confirm the AI emits all 6 elements in 7 of 7 consecutive briefings.
5. **Length validation.** Post-deploy, confirm total email length does not exceed pre-deploy + 200 words.

**Before / After examples:**

*Before (current shape, illustrative):*
```
SITUATION OVERVIEW: BLUF: Three new high-severity protest signals appeared
overnight near Petronas Canada's Fort St. John facility …
[~400 words of dense prose follows]
RECOMMENDED POSTURE: Security Operations should review the protest signals
within 24 hours.
```

*After (target shape):*
```
═══ DECISION FRAME ═══
What changed:        3 high-severity protest signals near Fort St. John
                     in 24h (was 0/day for prior 7 days).
Why it matters:      Threshold of 2+ in 24h triggered Tier-1B sequence.
Who should care:     Petronas Canada Security Operations Lead.
Decision required:   Authorize on-site presence increase OR continue
                     monitoring posture.
Consequence:         No action within 24h: presence-increase loses
                     pre-positioning advantage if escalation occurs.
Recommended action:  SOC Lead approves +2 patrols by 18:00 UTC.
═════════════════════
[Full briefing prose below — unchanged from current shape]
```

**Customer-facing impact:** zero. The daily briefing recipients are internal operators (Petronas SOC, CRT analyst). Not direct customer-facing.

**Operator-facing impact:** high. The operator's daily decision touchpoint becomes a 60-second-readable artifact.

### E. Success Metrics

| Metric | Target |
|---|---|
| **Q1.M1 — 60-second test pass rate** | ≥ 90% of decision owners identify the decision in <60s on the after rendering |
| **Q1.M2 — Six-element completeness** | 7 consecutive briefings emit all 6 elements (no missing fields) |
| **Q1.M3 — Length envelope** | Total email length ≤ pre-deploy + 200 words |
| **Q1.M4 — Decision specificity** | 100% of "Recommended action" lines reference a named entity/incident/signal (no generic "review the situation") |
| **Q1.M5 — Operator adoption** | Operator reports daily briefing useful for daily decisions (qualitative; checked at 2-week mark) |

---

## §2 — Q2: Workstream D UI Activation for POI Reports

### A. Current State

**Report flow** (`generate-poi-report/index.ts`, 889 lines):

```
investigate-poi finishes scanning a POI
  └── generate-poi-report (Deno.serve)
        ├── Load entity + signals + relationships + watchEntries
        ├── Compose AI prompt with strict sourcing rule + sections
        ├── callAiGateway() → reportMarkdown
        ├── try { emitClaimFramesForReport(...) } catch { warn + continue }
        │     └── if D_SLIM_SLICE_ENABLED → append "CONFIDENCE & PROVENANCE"
        │         section + persist evidence to aegis_claim_confidence table
        ├── Extract confidence JSON; compute threatLevel
        ├── Save to generated_reports + signed URL
        └── Return report HTML + URL
```

**Current template structure** (POI report top-level sections):

```
## SUBJECT PROFILE
## AI KNOWLEDGE CONTRIBUTION
## EXECUTIVE SUMMARY
## LOCATION & ADDRESS INTELLIGENCE
## POSITIVE FINDINGS
## NEGATIVE FINDINGS
## CRIMINAL & LEGAL HISTORY
## SOCIAL MEDIA FOOTPRINT
## ASSOCIATES & NETWORK
## CONTACT INFORMATION
## AGENT INTELLIGENCE FINDINGS
## BREACH DATA
## SIGNAL HISTORY
## CONFIDENCE ASSESSMENT
## RECOMMENDED NEXT STEPS

[BELOW THIS — dark unless D_SLIM_SLICE_ENABLED=1:]
## CONFIDENCE & PROVENANCE
  ### Retrieved facts
  ### Inferred relationships
  ### Analyst-confirmed
  ### AI-generated hypotheses
```

**Existing Workstream D components ALREADY present in `generate-poi-report/index.ts`:**

1. **Lines 16-18:** imports the full claim-frame stack:
   - `scoreClaim` from `_shared/aegis-confidence.ts`
   - `frameClaim`, `noActionConsideration`, `ClaimFrame` from `_shared/aegis-claim-frame.ts`
   - `recordClaimConfidence` from `_shared/aegis-claim-confidence-store.ts`
2. **Line 23:** `D_SLIM_SLICE_ENABLED` env-var flag (defaults `0`).
3. **Lines 25-86:** `renderClaimFrame()` builds operator-readable markdown for each of the 4 claim types (`retrieved_fact` / `inferred_relationship` / `analyst_confirmed_assessment` / `ai_generated_hypothesis`).
4. **Lines 241-...:** `emitClaimFramesForReport()` — fully implemented; early-returns empty section if flag is off.
5. **Lines 295-...:** four section headers already authored (`### Retrieved facts` / etc.).
6. **Lines 808-825:** the integration call site — wraps emission in `try/catch` so frame emission *never breaks the report* even on error.
7. **Persistence layer:** `aegis_claim_confidence` table accepts evidence rows (best-effort, doesn't block report).

**Net diagnosis:** Workstream D for POI reports is **100% built and tested but disabled by environment variable**. Activation is a single env-var change on the prod function deployment. No code changes needed.

### B. Gap Analysis

**What is missing today:**

1. The env var `D_SLIM_SLICE_ENABLED=1` is not set on the `generate-poi-report` prod function. (Same env var also gates the `dashboard-ai-assistant` D layers at `:10698`.)
2. (Implicit) Operator approval to flip the flag.

**What prevents deployment:**

Nothing. The shipping discipline so far has been "dark deploy → observation → activation." The dark deploy happened 2026-05-28 (PR #38/#39/#40). Activation has not yet been authorized.

**Dependencies:**

- `aegis_claim_confidence` table exists in prod (deployed with Workstream D slim slice; append-only)
- `aegis_request_trace` / Flight Recorder operational
- Claim-frame source modules in `_shared/` are referenced — no new files needed

**Risks:**

| Risk | Likelihood | Mitigation |
|---|---|---|
| Claim-frame section bloats POI report length | Low — the renderClaimFrame() function constrains output to ~3 lines per claim; for a typical 15-claim POI report this adds ~45 lines | Length cap in `renderClaimFrame`; observed in dev |
| AI-generated hypothesis claims confuse customers ("AI hypothesis — not corroborated") | Low — explicit labeling is the design intent (anti-fabrication discipline) | Customer-readable labels are operator-reviewed; flag flip preceded by sample regen |
| `recordClaimConfidence()` persistence fails on prod (table missing / RLS / NULL violation) | Low — table was deployed dark with Workstream D; service-role bypass; tenant_id NOT NULL but supplied | try/catch wrapper at `:808-820` swallows errors and warns; report still generates |
| Report consumers (frontend renderers for poi_reports surface) don't yet support the new section | Low — section is plain markdown; existing markdown renderer (DOMPurify + react-markdown) handles `###` headers and bullet lists natively | Verified by reading frontend POI report renderer (out of scope here, but the markdown path is the same) |
| Flag affects `dashboard-ai-assistant` too — flipping the env var lights up the dashboard's claim-frame UI as well | YES — same env var is read by both | Operator decision: scope flag flip per-function OR accept both surfaces lighting simultaneously |

**Critical operator-decision point on the dependency:** the `D_SLIM_SLICE_ENABLED` env var is read by BOTH `generate-poi-report` AND `dashboard-ai-assistant` (per the grep). If the flag is set at the project level, both light up. If the flag is set per-function (Supabase supports per-function secrets), only one lights up. Q2 as stated is "POI reports only" — so per-function activation is the right shape.

### C. Implementation Plan

**Exact files:** none. Q2 is a configuration change, not a code change.

**Exact generators:** `generate-poi-report` only.

**Exact templates:** none modified — the existing `emitClaimFramesForReport()` already produces the section.

**Flags involved:**

- `D_SLIM_SLICE_ENABLED=1` — set as a **per-function secret** on `generate-poi-report` in prod (and staging). Per-function secret keeps `dashboard-ai-assistant` dark.

**Activation steps (sketched; not executed):**

1. `supabase secrets set --project-ref kpuqukppbmwebiptqmog --env-file <(echo "D_SLIM_SLICE_ENABLED=1")` — wait, this is project-wide. Per-function activation requires deploying `generate-poi-report` with the env var set at deploy time via `supabase functions deploy generate-poi-report --env D_SLIM_SLICE_ENABLED=1` if that CLI flag exists, OR a CI workflow that injects the var only for this function.

   **Alternative (cleaner):** introduce a per-function env var name `POI_REPORT_D_SLIM_SLICE_ENABLED=1` checked alongside the existing flag in `generate-poi-report:23`. Single-line code change. Then activate the per-function var without affecting the shared `D_SLIM_SLICE_ENABLED`. (This IS a code change — operator may prefer.)

   **Simpler alternative:** flip the project-level flag and accept that `dashboard-ai-assistant` claim-frame UI also lights up in the same release. If the dashboard's D layer is already production-stable (no operator complaints since 2026-05-28 dark deploy), this is the lowest-effort path.

**Estimated blast radius:**

- Option A (project-level flag): both `dashboard-ai-assistant` D layers + `generate-poi-report` claim-frame section light up simultaneously. Two surfaces, one flag flip.
- Option B (per-function env var, requires code change): only `generate-poi-report` lights up. One-line code change + per-function secret set + deploy. Slightly more work, scoped to POI report only.
- Option C (per-function env at deploy time): only `generate-poi-report` lights up. Adjustment to `deploy-functions.yml` to support per-function env injection. Largest scope.

**Recommended:** Option A is the smallest blast radius if the dashboard claim-frame UI is stable. Option B if the operator wants strict scope.

### D. Validation Plan

**How we prove it's better:**

1. **Before snapshot.** Pull a recent generated POI report (e.g., Trent Reznor or BC Place exec) HTML.
2. **After snapshot.** Regenerate the same POI report post-flag-flip.
3. **Diff comparison.** The new section "## CONFIDENCE & PROVENANCE" appears at the bottom with four sub-headers. Existing report content unchanged above.
4. **Evidence test.** For each claim in the new section, verify a source citation appears (URL, signal ID, or entity ID). Pass: 100% of claims sourced.
5. **No-bloat test.** Post-deploy, confirm POI report total length grew by < 30%.
6. **Persistence test.** `SELECT count(*) FROM aegis_claim_confidence WHERE created_at > <activation>` — confirm rows being written.

**Before / After examples:**

*Before:* POI report ends at `## RECOMMENDED NEXT STEPS`.

*After:* POI report continues:
```
---

## CONFIDENCE & PROVENANCE

### Retrieved facts
**[Retrieved fact]**  Subject Kelly Pietras employed at BC Place
- **Source.** signal:5b8c4d2e <https://example.com/source> · 3 independent sources.
- **Confidence.** Confirmed — observed within 7 days.

### Inferred relationships
**[Inferred relationship]**  Subject likely co-located with BC Place senior security staff
- **Inferred from.** entity:0870d199 (Kelly Pietras) · 2 independent sources.
- **Confidence.** Well-attested — observed within 30 days.

### Analyst-confirmed
**[Analyst-confirmed]**  Subject's monitoring status set to active by Vince Dancho
- **Source.** investigation:e78330da (analyst note) · 1 independent source.
- **Confidence.** Confirmed — observed within 24h.

### AI-generated hypotheses
**[AI hypothesis — not corroborated]**  Subject may have access to BC Place restricted areas
- **Basis.** entity:0870d199 · employment context · 1 independent source.
- **Confidence.** Hypothesis — could be wrong.
```

**Customer-facing impact:** HIGH. The customer (operator viewing the POI report) sees per-claim provenance: what's a fact, what's inferred, what's an AI hypothesis (not a fact). Reduces "where did this come from?" friction; raises trust in the report. Aligns with Grounding-State Doctrine.

**Operator-facing impact:** MEDIUM. Operator gets explicit hypothesis labeling — easier to flag claims that need further investigation. Workstream D operator-demonstration (task #49) already validated qualitative benefit.

### E. Success Metrics

| Metric | Target |
|---|---|
| **Q2.M1 — Section emit rate** | 100% of POI reports include the CONFIDENCE & PROVENANCE section post-activation |
| **Q2.M2 — Source citation completeness** | ≥ 95% of claims have a source reference (URL, signal_id, or entity_id) |
| **Q2.M3 — Length envelope** | POI report total length ≤ pre-flip + 30% |
| **Q2.M4 — Persistence health** | `aegis_claim_confidence` row count > 0 after first 10 generated POI reports |
| **Q2.M5 — No regression in core report** | Existing section structure (Subject Profile through Recommended Next Steps) renders unchanged |
| **Q2.M6 — Customer-trust qualitative** | Operator reviews 3 customer-facing reports post-activation; reports that "this looks more trustworthy" without naming the change |

---

## §3 — Recommendation, Sequencing, Effort, Expected Improvement

### Recommendation

| Quick Win | Recommendation |
|---|---|
| **Q1 Decision Frame in Daily Template** | **Implement now.** Current daily briefing has 3.5/6 elements; the gap is the decision-orientation header. Smallest change that delivers a 60-second-readable artifact. Single file, single function. |
| **Q2 Workstream D POI activation** | **Implement now.** Zero code change required (Option A — project-level flag); or 1-line change (Option B — per-function flag). Workstream D is built, tested, dark-deployed since 2026-05-28. The shipping risk is essentially zero. |

Both should be implemented. Both directly advance Commander's Intent.

### Sequencing

| Order | Justification |
|---|---|
| **Q2 first (or simultaneously)** | Lowest effort, lowest risk; activates an already-built capability. Smallest change that produces immediate customer-facing improvement on the POI surface. |
| **Q1 second (or simultaneously)** | Higher effort (~3-4 hours focused work), higher visual impact, requires prompt engineering + template change. |

**Can both be done in one release?** **Yes.** They touch different surfaces (`send-daily-briefing` vs `generate-poi-report`), no code overlap, no shared state, no shared deploy step (different edge functions). Releasing together has zero technical interaction cost and gives the operator one coherent E.0 ship.

**Recommended bundle shape:**

- Single PR containing:
  - Q1: `send-daily-briefing/index.ts` prompt rewrite + HTML template change
  - Q2: Either project-level flag flip (no code) OR per-function flag (1-line code change in `generate-poi-report/index.ts`)
- Single edge function deploy of `send-daily-briefing` (Q1) + flag flip on `generate-poi-report` (Q2)
- Joint validation: 1 daily briefing email + 1 POI report regeneration

### Estimated Effort

| Item | Implementation | Validation | Total |
|---|---|---|---|
| **Q1 Decision Frame** | 3–4 hours (prompt rewrite + HTML template + smoke test against synthetic input) | 1 hour (one regenerated daily briefing reviewed) | 4–5 hours |
| **Q2 Workstream D POI** | 30 minutes (flag flip — Option A) or 1 hour (1-line code change + secret set — Option B) | 30 minutes (regenerate one POI report) | 1–1.5 hours |
| **Combined as bundle** | 4–6 hours total | 1.5 hours | **6–8 hours**, single PR |

Effort is one-session of focused work. Could be completed within a single operator review cycle.

### Expected Improvement

| Dimension | Q1 alone | Q2 alone | Combined |
|---|---|---|---|
| **Decision quality** | HIGH — operator daily decision touchpoint becomes Decision-Frame-shaped. Element 4 ("Decision required") and Element 5 ("Consequence") finally surface explicitly. | MEDIUM — POI report decisions become provenance-aware. Operator can act on Confirmed-tier facts immediately; treats Hypotheses appropriately. | HIGH — both daily decisions and per-investigation decisions improve simultaneously. |
| **Customer trust** | LOW — daily briefing recipients are internal. | HIGH — customer-facing POI reports show provenance per claim. The "AI hypothesis — not corroborated" label is anti-fabrication discipline made visible. | HIGH — primarily driven by Q2. |
| **Executive adoption** | HIGH — daily briefing is the executive touchpoint; making it Decision-Frame-shaped raises adoption by reducing read time. | LOW — POI report is an analyst surface, not an executive surface. | HIGH — primarily driven by Q1. |
| **Doctrine operationalization** | Decision Layer Doctrine six-element frame operational on one surface for the first time. | Workstream D claim-frame discipline operational on one customer-facing surface for the first time. | Two doctrines operationalized in one ship — proportionally outsized return. |
| **Reversibility** | `git revert` + redeploy (~5–10 min) | Flag flip back to `0` (~30 seconds) | Both rollback paths preserved |

### Why the bundle is high-leverage relative to effort

- 6–8 hours of focused engineering delivers the FIRST operationalization of TWO ratified doctrines (Decision Layer + Workstream D claim-frame) on TWO production surfaces.
- Zero schema changes, zero migrations, zero new edge functions, zero new tables.
- Both surfaces are observable post-deploy (one daily email + one POI regeneration). Validation cycle is <1 hour.
- Customer trust improvement (Q2) lands in time for BC Place / FIFA delivery window observation.
- Decision-Frame proof-of-concept on send-daily-briefing (Q1) establishes the template pattern that E.1 convergence skeleton (per Campaign 2 long-horizon roadmap) inherits.

---

## §4 — Risks of doing this now

| Risk | Likelihood | Severity | Notes |
|---|---|---|---|
| Distracts from Phase 2 ai-tools-query retirement observation | Low | Low | E.0 work is on different surfaces; no contention |
| Concurrent flag flip and template change makes attribution hard if a problem appears | Low–Medium | Low | Both changes are observable independently in the rendered output |
| Operator review bandwidth | Medium | Medium | Bundle requires one operator validation cycle covering both surfaces |
| Daily briefing recipients see a sudden format change | Low | Low | Transition note in first email; recipients are internal |
| `D_SLIM_SLICE_ENABLED` flag flip affects dashboard surface unintentionally (Option A) | Medium | Low–Medium | Mitigated by Option B (per-function flag), or accepted if dashboard D layer is stable since 2026-05-28 |

None of these are blocking. None require new infrastructure.

---

## §5 — What this assessment is NOT

- Not an authorization to implement.
- Not a PR or branch.
- Not a plan for E.1 convergence skeleton (different scope).
- Not a fix for INC-LEARN-CONTAM-LEAK / Class B Provenance / ownerless executive_intelligence rows — those are E.3/E.4 work.
- Not a redesign of generate-fortress-report, generate-wildfire-daily-report, send-daily-briefing recipient logic, audio briefings, or travel briefings.

---

## §6 — Held

- No implementation
- No code, branch, migration, deploy
- No flag flips
- Operator decides between Option A (project flag) and Option B (per-function flag) for Q2
- Operator authorizes bundled release or splits Q1/Q2 across releases at their discretion

🤖 Generated with [Claude Code](https://claude.com/claude-code)
