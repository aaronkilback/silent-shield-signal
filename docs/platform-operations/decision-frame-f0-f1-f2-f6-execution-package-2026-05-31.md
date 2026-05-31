# Decision Frame F.0 + F.1 + F.2 + F.6 — Execution Package

**Operator-directed 2026-05-31 (Task #119).** Single execution package covering the F.0 shared module (deferred-persistence scope) plus the three first-wave generator wirings. No implementation in this document; the plan must be operator-authorized before any code lands.

**Commander's Intent:** *"Preserve decision space by shortening Signal → Decision → Action."*

Every step in this package shortens — or refuses to manufacture — a decision loop. No package step manufactures noise. The Decision Check classifier (REQUIRED / MONITOR / NONE) is the anti-performative discipline that keeps the doctrine honest.

---

## §1 — Package Scope

| Phase | What ships | Mode | Generator status today |
|---|---|---|---|
| **F.0** | `_shared/aegis-decision-frame.ts` module + unit tests + docs | n/a | Module-only; zero generators consume it pre-bundle |
| **F.1** | `send-daily-briefing` consumes the module via Mode 2 (AI emission + parse) | AI | 507 LOC; system prompt at line 238; HTML via `buildBriefingEmail()` |
| **F.2** | `generate-poi-report` consumes the module via Mode 2 (AI emission + parse) | AI | 889 LOC; system prompt at line 790 (`REPORT_PROMPT`); Task #48 (claim-frame wiring) currently in-progress on the same surface — coordination required |
| **F.6** | `generate-wildfire-daily-report` consumes the module via Mode 1 (programmatic composition from `classifyHotspot()` outputs) | Programmatic | 1776 LOC; programmatic HTML assembly; uses `getFireSeason()` + facility proximity classifier |

**Deliberately out of scope** (preserved for later phases of the convergence plan):
- F.3 incident-briefing · F.4 SRA · F.5 executive · F.7 security bulletin/briefing · F.8 React frontend component · F.9+ travel-briefing / consortium-briefing
- Audit-table persistence (deferred per §6 of the architecture doc)
- AI prompt rewrites beyond inserting the prompt fragment marker block
- Frontend changes (briefings remain email; POI reports remain HTML view)

---

## §2 — Why These Three Generators First

Three reasons drove the selection:

1. **Mode coverage triangulation.** F.1 + F.2 exercise Mode 2 (AI emission + parse); F.6 exercises Mode 1 (programmatic). A bundle that proves both modes is durable; a bundle of only Mode 2 leaves the programmatic-mode contract unverified.

2. **Decision Check tier coverage triangulation.** F.1 (daily briefing, NONE default), F.2 (POI, REQUIRED default), F.6 (wildfire, seasonal — computed REQUIRED/MONITOR/NONE depending on conditions). Three tiers all proven in one bundle.

3. **Operator-visibility weighting.** Daily briefings and POI reports are the highest-touch artifacts for operator workflow. Wildfire is on-demand but visually distinctive (the seasonal classifier is the clearest demonstration of doctrine v2 working). The bundle ships maximum operator-visible improvement per hour of work.

---

## §3 — F.0 Implementation Plan (Module + Tests + Docs)

### F.0.1 — Create `_shared/aegis-decision-frame.ts`

Single file, sections §A–§H per the architecture doc. Public API as documented in §1 of the architecture. No IO except the no-op audit stub.

Key implementation details:
- **`composeDecisionFrame()`** — validates input via lint pass; returns discriminated union; never returns a partial frame
- **`lintDecisionFrame()`** — R8 (REQUIRED needs justification), R9 (conditional elements respect Decision Check), R10 (Elements 1-3 non-empty)
- **`decisionFrameSystemPromptFragment(report_class)`** — returns the AI prompt fragment with:
  - Per-class default check + anti-promotion guardrail
  - Marker block format: `=== DECISION FRAME START ===` / `=== DECISION FRAME END ===`
  - Element labels: `WHAT_CHANGED:`, `WHY_IT_MATTERS:`, `WHO_SHOULD_CARE:`, `DECISION_CHECK:`, `DECISION_CHECK_JUSTIFICATION:`, `DECISION_REQUIRED:`, `CONSEQUENCE:`, `RECOMMENDED_ACTION:`
  - Explicit anti-fabrication language (no manufactured decisions)
- **`parseDecisionFramePrefix(text, ctx)`** — locates marker block; extracts elements; validates via `composeDecisionFrame()`; returns same discriminated union
- **`stripDecisionFramePrefix(text)`** — removes everything between markers (inclusive); leaves report body
- **`renderDecisionFrameMarkdown()`** — heading-based shape: `## DECISION FRAME (REQUIRED|MONITOR|NONE)` + element blocks
- **`renderDecisionFrameHtml()`** — table-based with tier-coded color band (REQUIRED = red, MONITOR = amber, NONE = green); xss-safe (escape user content)
- **`renderDecisionFrameJson()`** — `DecisionFrameRenderJson` for future React consumption
- **`recordDecisionFrameAudit()`** — no-op stub per §6 of the architecture; never throws

### F.0.2 — Create `_shared/aegis-decision-frame.test.ts`

Unit test coverage per §8 of the architecture doc. Vitest harness (precedent from `aegis-confidence.test.ts`). Approximately 30–40 test cases across 11 test classes.

Key negative-path coverage:
- REQUIRED-without-justification rejection
- MONITOR-with-Elements-4-or-5 rejection
- NONE-with-any-conditional-element rejection
- Empty Elements 1-3 rejection
- AI output missing markers
- AI output malformed inside markers
- HTML escaping (no unescaped angle brackets in rendered output)

### F.0.3 — Documentation

Update `docs/platform-operations/decision-frame-shared-module-architecture-2026-05-31.md` revision footer with "Implementation merged in PR #<n>." Add a one-page operator-facing reference at `docs/platform-operations/decision-frame-module-reference.md` covering:
- How to import and call the module
- Per-class defaults table
- Marker format for AI generators
- Failure modes + recommended generator policy
- "How to add a new report class to the enum"

### F.0.4 — Acceptance evidence (matches §10 of architecture)

| # | Criterion | Verification |
|---|---|---|
| F.0.1 | Module exists with all exports | `grep -r "from.*aegis-decision-frame" supabase/functions/` returns only the test file |
| F.0.2 | Unit tests pass | `npm run test` or vitest run |
| F.0.3 | TypeScript build green | `npm run build` |
| F.0.4 | Zero generators consume it | grep verification (none of F.1/F.2/F.6 land in F.0 phase) |
| F.0.5 | Audit stub returns documented payload | Explicit test |
| F.0.6 | Module reference doc exists | File presence check |
| F.0.7 | Zero runtime impact verified | No edge function changes; existing reports unchanged |
| F.0.8 | No migration shipped | No new files under `supabase/migrations/` |

---

## §4 — F.1 Implementation Plan (send-daily-briefing)

### Surgical change footprint

`supabase/functions/send-daily-briefing/index.ts` — exactly four edit points:

1. **Add import** near line 8 (next to `callAiGateway`):
   ```typescript
   import {
     decisionFrameSystemPromptFragment,
     parseDecisionFramePrefix,
     stripDecisionFramePrefix,
     renderDecisionFrameHtml,
     recordDecisionFrameAudit,
   } from "../_shared/aegis-decision-frame.ts";
   ```

2. **Augment system prompt** at line 238 by concatenating the fragment:
   ```typescript
   {
     role: 'system',
     content: `${existingDailyBriefingSystemPrompt}\n\n${decisionFrameSystemPromptFragment("daily_briefing")}`,
   }
   ```
   The fragment is APPENDED, not interleaved — minimum risk to existing prompt behavior.

3. **Parse + strip** the AI output before passing to `buildBriefingEmail()`:
   ```typescript
   const parseResult = parseDecisionFramePrefix(briefingResult.text, {
     report_class: "daily_briefing",
     tenant_id: clientTenantId,
     source_trace_id: briefingResult.trace_id,
   });

   let decisionFrameHtml = "";
   let briefingText = briefingResult.text;

   if (parseResult.ok && parseResult.frame) {
     decisionFrameHtml = renderDecisionFrameHtml(parseResult.frame);
     briefingText = stripDecisionFramePrefix(briefingResult.text);
     await recordDecisionFrameAudit(supabaseClient, parseResult.frame);
   } else {
     console.warn("[send-daily-briefing] Decision Frame parse failed", parseResult.errors);
     // Policy A fallback: emit briefing without frame (don't lose the briefing)
   }
   ```

4. **Inject the frame HTML** into `buildBriefingEmail()` at line 326 — pass `decisionFrameHtml` as a new optional argument; insert at the top of the email body (above the metrics block).

### Generator policy on parse failure

**Policy A (fall back to no-frame):** the briefing emits without the Decision Frame block but with body content intact. Doctrine choice is "don't lose the briefing — operator continues to receive intelligence even if the frame failed."

### Authorization gate before F.1 commits

Operator must explicitly confirm that AI-emitted Decision Frames are acceptable for daily briefing (it changes the email's visual contract). Recommended: cut a single staging-only test send first, review the rendered output, then GO for prod.

---

## §5 — F.2 Implementation Plan (generate-poi-report)

### Coordination with in-progress Task #48

Task #48 (claim-frame wiring for `generate-poi-report`) is currently in_progress. F.2 wiring would touch the **same file** at adjacent edit points. Two paths:

**Path α (recommended): F.2 lands AFTER Task #48 ships.** Sequencing rationale:
- Task #48 is closer to operator-visible value (claim taxonomy already prod-applied; just needs the POI surface lit up)
- Both surfaces edit `REPORT_PROMPT` (line ~790) and the AI response handling
- Landing Task #48 first means F.2 adds the Decision Frame fragment on top of an already-claim-frame-aware POI report
- No merge conflict cascade

**Path β (not recommended): F.2 + Task #48 bundled into one PR.** Risk: doubles the review surface; mixes two doctrines (claim taxonomy + Decision Frame) into one change. Operator review burden multiplies.

**Operator decision required:** Path α (sequence F.2 after Task #48) or Path β (bundle).

### Surgical change footprint (assuming Path α)

`supabase/functions/generate-poi-report/index.ts` — four edit points mirroring F.1:

1. **Add import** near line 13 (next to `callAiGateway`)
2. **Augment system prompt** at line 790:
   ```typescript
   { role: 'system', content: `${REPORT_PROMPT}\n\n${decisionFrameSystemPromptFragment("poi_report")}` }
   ```
3. **Parse + strip** the AI output before HTML assembly
4. **Inject frame HTML** at the top of the rendered report HTML (above the header, before any sections)

### Default Decision Check for POI

`poi_report` default is **REQUIRED**. The prompt fragment instructs the AI: "POI reports default REQUIRED; you may downgrade to MONITOR for low-risk individuals or NONE for awareness-only refreshes — provide grounded justification for any tier." This preserves the doctrine while allowing the AI honest discretion.

### Generator policy on parse failure

**Policy B (retry once, then Policy C):** if first parse fails, single AI retry with explicit "please format the Decision Frame block per the markers" reminder. If the retry also fails, ABORT the report (POI is a formal artifact — better to fail loudly than emit a degraded one). Operator gets a structured error rather than a malformed report.

---

## §6 — F.6 Implementation Plan (generate-wildfire-daily-report)

### This is Mode 1 — no AI in the loop for frame composition

The wildfire generator is **programmatic**. Decision Check is computed by the generator from `getFireSeason()` + `classifyHotspot()` outputs. The AI prompt fragment is not used; only `composeDecisionFrame()` + `renderDecisionFrameHtml()` are consumed.

### Surgical change footprint

`supabase/functions/generate-wildfire-daily-report/index.ts` — three edit points:

1. **Add import** at the top:
   ```typescript
   import {
     composeDecisionFrame,
     renderDecisionFrameHtml,
     recordDecisionFrameAudit,
     type DecisionCheck,
   } from "../_shared/aegis-decision-frame.ts";
   ```

2. **Add a `computeWildfireDecisionCheck()` helper** near the existing `classifyHotspot()` definition (around line 322). Logic mirrors the architecture doc §3 example:
   ```typescript
   function computeWildfireDecisionCheck(input: {
     season: 'off-season' | 'shoulder' | 'fire-season';
     fires: Array<{distanceKm: number; hfi: number; ...}>;
     hasLightning: boolean;
   }): { check: DecisionCheck; justification: string } {
     const proximityFires = input.fires.filter(f => f.distanceKm < 4);
     const escalatingFires = input.fires.filter(f => f.hfi > 2000);

     if (input.season === 'fire-season' && proximityFires.length > 0) {
       return {
         check: 'REQUIRED',
         justification: `${proximityFires.length} hotspot(s) within facility proximity; fire season active; max HFI ${Math.max(...proximityFires.map(f => f.hfi))}`,
       };
     }
     if (input.season !== 'off-season' || escalatingFires.length > 0 || input.hasLightning) {
       return {
         check: 'MONITOR',
         justification: `Watching: facility proximity (<4km), HFI escalation (>2000), lightning correlation`,
       };
     }
     return { check: 'NONE', justification: '' };
   }
   ```

3. **Compose and inject** at the start of the HTML assembly (around line 767):
   ```typescript
   const dc = computeWildfireDecisionCheck({ season, fires: activeFires, hasLightning: lightning.length > 0 });
   const frameResult = composeDecisionFrame({
     report_class: "wildfire_daily",
     tenant_id: tenantId,
     decision_check: dc.check,
     decision_check_justification: dc.justification,
     what_changed: /* tier-specific phrasing */,
     why_it_matters: /* tier-specific phrasing */,
     who_should_care: "Petronas Security Operations Lead",
     decision_required: dc.check === "REQUIRED" ? /* … */ : undefined,
     consequence:       dc.check === "REQUIRED" ? /* … */ : undefined,
     recommended_action: dc.check !== "NONE"    ? /* … */ : undefined,
   });

   const decisionFrameHtml = frameResult.ok ? renderDecisionFrameHtml(frameResult.frame!) : "";
   if (frameResult.ok) await recordDecisionFrameAudit(supabase, frameResult.frame!);
   ```
   Then prepend `decisionFrameHtml` to the rendered report HTML.

### Generator policy on composition failure

**Policy C (abort the report):** the wildfire report is operator-actionable safety intelligence; emitting it without a Decision Frame after we've committed to the doctrine would be a regression. If `composeDecisionFrame()` rejects (which would indicate a generator bug), the function logs the errors and returns 500 — operator can re-run after the bug is fixed.

### `tenantId` plumbing

Verify `tenantId` is available in the wildfire generator's request context. The function is invoked manually from the Reports page; the calling component already passes a `client_id`. The generator must resolve `tenant_id` from `client_id` BEFORE composing the frame (using the canonical tenant resolution helper). This is a small addition; not a doctrine change.

---

## §7 — Sequencing + Dependencies

```
F.0 (module + tests + docs)
  │
  ├──> F.1 (send-daily-briefing)        ─── ships independently after F.0
  │
  ├──> F.2 (generate-poi-report)         ─── ships AFTER Task #48 (claim-frame
  │                                          wiring on the same file) per Path α
  │
  └──> F.6 (generate-wildfire-daily-report)  ─── ships independently after F.0
```

| Step | Blocks | Blocked by |
|---|---|---|
| F.0 | F.1, F.2, F.6 | nothing |
| F.1 | nothing | F.0 |
| F.2 | nothing | F.0 + Task #48 (Path α) |
| F.6 | nothing | F.0 |

F.1 and F.6 can ship in parallel once F.0 lands. F.2 waits on Task #48.

---

## §8 — PR Shape Recommendation

| PR | Contents | Branch |
|---|---|---|
| **PR-F.0** | Module + tests + docs (zero generator changes) | `feat/aegis-decision-frame-module` |
| **PR-F.1** | `send-daily-briefing` consumption | `feat/decision-frame-daily-briefing` |
| **PR-F.6** | `generate-wildfire-daily-report` consumption | `feat/decision-frame-wildfire-daily` |
| **PR-F.2** | `generate-poi-report` consumption (after Task #48) | `feat/decision-frame-poi-report` |

Each PR is small enough for single-pass review. Operator can review and GO each PR independently. Rollback is per-PR via `git revert`; the module stays intact even if a wiring PR is reverted.

---

## §9 — Acceptance Criteria (Bundle-Level)

The package is "done" when ALL of:

| # | Criterion |
|---|---|
| A.1 | F.0 acceptance criteria all green (§3.4) |
| A.2 | F.1 deploys to prod; one daily briefing emits with the Decision Frame block at the top |
| A.3 | F.6 deploys to prod; one wildfire report emits with the Decision Frame block at the top |
| A.4 | F.2 deploys to prod; one POI report emits with the Decision Frame block at the top |
| A.5 | All four reports operator-verified visually; tier rendering correct; no malformed output |
| A.6 | Negative-path verified: at least one daily briefing where Decision Check = NONE — operator confirms Elements 4-5 are absent (anti-performative discipline working) |
| A.7 | Existing report functionality is unchanged below the Decision Frame block; no regressions in metrics, sources, sections |
| A.8 | Zero new persistence layer shipped; doctrine compliance verified |

A.6 is the most important acceptance criterion. The doctrine v2 refinement was specifically to prevent manufactured decisions. If the daily briefing emits MONITOR or REQUIRED frames every day from the moment it ships, the doctrine has failed in practice and we need to recalibrate the prompt fragment.

---

## §10 — Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | AI fails to emit the marker block consistently | Medium | Medium | Policy A for daily briefing (graceful fallback); Policy B for POI (retry); R10 lint catches malformed output |
| R2 | AI fabricates REQUIRED frames on quiet days (performative noise) | Medium | High — defeats the doctrine | R8 lint server-side rejection; anti-promotion prompt fragment language; A.6 acceptance criterion validates empirically |
| R3 | Wildfire programmatic classifier promotes REQUIRED on routine days | Low | Medium | `computeWildfireDecisionCheck()` thresholds intentionally conservative; operator review pre-deploy |
| R4 | F.2 collides with Task #48 in-flight changes | Medium (Path β) / Low (Path α) | Medium — merge conflicts | Path α sequencing recommendation |
| R5 | HTML rendering breaks email layout | Low | Medium | Render functions use `<table>` cells consistent with existing email-template patterns; operator visual review pre-prod |
| R6 | `tenantId` not available in wildfire request context | Low | Low — function fails clean | Resolve before composeDecisionFrame; fail-closed |
| R7 | Daily-briefing email size exceeds Resend limit due to added block | Very Low | Low | Frame block is ~500 bytes; existing emails are ~40KB; negligible delta |
| R8 | Operator-visible doctrine surprise (frame appears unexpectedly) | High (intended) | None — this is the goal | Pre-deploy briefing to operator showing rendered examples |

---

## §11 — Rollback Path (Per PR)

| PR | Rollback |
|---|---|
| PR-F.0 | `git revert <sha>` — module file disappears; no generator uses it yet; no DB state to roll back |
| PR-F.1 | `git revert <sha>` — `send-daily-briefing` reverts to pre-frame behavior; next briefing emits without the frame block; operator notification recommended |
| PR-F.6 | `git revert <sha>` — same pattern; next manually-triggered wildfire report emits without the frame block |
| PR-F.2 | `git revert <sha>` — same pattern; next POI report emits without the frame block |

No migrations to roll back. No data to backfill. No schema changes. The deferred-persistence scope means rollback is a single revert per PR, with no cascading cleanup.

---

## §12 — Effort Estimate

| Phase | Work | Effort |
|---|---|---|
| **F.0** | Module (~500 LOC) + tests (~300 LOC) + docs | 7–9 hours |
| **F.1** | Edits + parse policy + visual verification on staging | 2–3 hours |
| **F.2** | Edits + parse + retry policy + visual verification (after Task #48) | 3–4 hours |
| **F.6** | Helper + edits + tenantId plumbing + visual verification | 3–4 hours |
| **Operator review + GO cycles** | 4 PRs × 1 cycle each | per-operator |
| **Total** | | **15–20 hours** |

Significantly lower than the v1 architecture estimate (which included audit-table + migration work). Deferred persistence pays off in execution time.

---

## §13 — Acceptance Telemetry (How We Know It Worked)

These are not gates — they are forensic signals to confirm the doctrine is operating as intended. Captured via Flight Recorder + manual review.

| Signal | What healthy looks like |
|---|---|
| Daily briefing Decision Check distribution (30-day rolling) | Roughly: 60–80% NONE, 15–30% MONITOR, 5–15% REQUIRED — matches `expected_distribution` in the per-class defaults |
| POI report Decision Check distribution | ≥80% REQUIRED; <5% NONE — POI reports SHOULD be commitment-relevant |
| Wildfire Decision Check distribution by season | Off-season: ~100% NONE; shoulder: mostly NONE with occasional MONITOR; fire season: MONITOR/REQUIRED dominant |
| AI parse failure rate | <5% on daily briefing; <2% on POI (after retry) |
| Operator feedback | "I act on the briefing differently because of the frame" / "the frame correctly suppresses noise on quiet days" |

A telemetry surface that requires querying historical data would benefit from the audit table — which is exactly what surfaces a *named consumer* for the deferred persistence. If after 30 days operator wants to see distribution charts, that becomes the trigger to revisit §6 of the architecture doc.

---

## §14 — Held / Authorization Gates

- F.0 implementation requires explicit operator GO on this execution package
- F.1, F.2, F.6 each require independent operator GO on their PR before prod merge
- F.2 sequencing decision (Path α vs Path β) requires operator confirmation
- A.6 acceptance criterion (quiet-day NONE verification) is non-negotiable; if early daily briefings emit REQUIRED inappropriately, ship a recalibration commit BEFORE expanding to other generators
- Operator pre-deploy visual briefing on a single staging-rendered example for each report class is recommended before prod GO
- No persistence layer ships as part of this package (operator-recorded doctrine 2026-05-31)

**Trigger to revisit deferred persistence:** if A.6 telemetry questions cannot be answered via Flight Recorder + manual review within 30 days of F.1 prod-deploy, the audit table becomes a named-consumer scenario (operator observability) and §6 of the architecture doc is re-opened.

---

## §15 — Tie-Back to Commander's Intent

*"Preserve decision space by shortening Signal → Decision → Action."*

| Phase | How it shortens Signal → Decision → Action |
|---|---|
| F.0 | Provides the canonical doctrine substrate — every future report inherits the same structure for free; no per-generator reinvention |
| F.1 | Daily briefing surfaces "is there anything I need to *decide* today?" at the top of the email — operator reads one block instead of scanning the full briefing |
| F.2 | POI reports highlight the action that matters at the top — operator doesn't need to read 6+ sections to find the recommendation |
| F.6 | Wildfire reports surface seasonal classification — "fire season + proximity" elevates urgency; off-season noise gets honest NONE framing |

The anti-performative discipline (Decision Check classifier) is what makes this honest. A doctrine that fabricates REQUIRED frames on quiet days *erodes* decision space by training the operator to ignore them. The Decision Check classifier — and acceptance criterion A.6 — ensures the doctrine compounds operator trust rather than burning it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
