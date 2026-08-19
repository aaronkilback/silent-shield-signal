# WO-CHILD-SAFETY-SECTION6 — Family & Child Safety (Section 6)

**Scope:** family & child-safety ADVISORY + household-exposure. **NOT scanning of minors** — the minor-scan
block is absolute and unaffected. Operator-directed 2026-08-19.

## Phase 1 — BUILT (steps 1–6), paused at the review gate
1. Migration `20260819180000` — `child_safety_guidance` (RLS deny-by-default) + `child_safety_guidance_stale()` RPC (DRAFT is stale by definition; escalation rows 3-month interval).
2. Seed `20260819181000` — 19 rows (framing 2 · platform 4 · cross_platform 3 · protocol 5 · escalation 5), ALL `reviewed_by='DRAFT — pending professional review'`.
3. `edit-child-safety-guidance` — super_admin only; upsert/review/deactivate; bumps version + stamps reviewer (never edited/signed anonymously).
4. `agent-sentinel` Probe 2h — staleness/draft → aggregated finding; HIGH if an escalation contact is past its 3-month review (out-of-date emergency contact is directly harmful), else MEDIUM.
5. Intake — `childPlatforms` (VIP wizard checkbox group; names only) → stored `entities.attributes.child_platforms` (no child data/accounts).
6. Report Section 6 in `generate-subject-exposure-report` — framing + 6B (platforms filtered to selected + cross-platform) + 6C (protocols + escalation), with **operator additions**: (1) visible DRAFT tag per unreviewed block + a report-level DRAFT banner; (2) staleness probe fires on DRAFT regardless of age; (3) escalation 3-month interval. Plus a **delivery HARD BLOCK** (`deliver-subject-exposure-report` refuses `CONTAINS_DRAFT_CHILD_SAFETY`) — cannot be delivered even if issuable is flipped. PROVEN: report 468d6098 rendered Section 6, DRAFT banner + 18 DRAFT tags, only selected platforms, sextortion emergency, Cybertip number, framing-as-wrong-model.

## NAMED REVIEW DEPENDENCY — the gate (operator: not abstract "pending review")
**Section-6 content (especially 6C protocols) is AI-drafted from public guidance + operator experience — enough to draft, NOT enough to sign.** It is BLOCKED on:
- **A named child-safety professional — NOT yet engaged.** A specific person must be identified and engaged; this is not a self-review by the operator. Operator (ak) is EXPLICITLY NOT the final reviewer for 6C.
- **The counsel thread already handling Q1 and Q2** — likely the same review pass.
Until a real name signs each block via `edit-child-safety-guidance` (action=review), every row stays DRAFT → renders with the banner → the delivery hard block holds → nothing reaches a family. **Action owner: operator, to name + engage the professional.**

## Phase 2 — HELD (6A household-exposure detection)
`detect-household-exposure` — analyse the PRINCIPAL's own self-published items for child-identifying leakage (school mention, stated routine, home/cabin geotag, household-minor name). **Redact-in-STORAGE and in-render:** `subject_exposure_items category='household_exposure'` carries leak class + count + post locations ONLY — never the child's name/school/address string (matched in-memory, discarded). "A household minor's first name appears in 4 public posts", not the name. Held until Phase-1 content is professionally reviewed.

## NOT in scope / not assumed
- **Image/face tier** (child's face/uniform in a background) — its own design pass, near the line the operator has held; may not be buildable at all. NOT queued as an assumed follow-on.
- Frontend: the `childPlatforms` intake UI is built + build-verified but the Worker was NOT redeployed (held at the gate); backend defaults to empty so it fails safe.
