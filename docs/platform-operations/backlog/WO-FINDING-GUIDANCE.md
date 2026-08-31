# WO-FINDING-GUIDANCE — per-finding significance + analyst worksheet (deterministic, not generated prose)

**Status:** LOGGED (scope only, do not build). **Opened:** 2026-08-31 (end-to-end client read).

## The gap
Section 2 (Remediation) is "pending analyst review" and Section 4 (Breach Exposure) renders **25 breaches
identically**. A 2025 stealer-log and a 2012 LinkedIn hash dump look the same on the page; the report's own
note says "differentiated remediation guidance is in development." A reader cannot tell which breach means
*act now* from which means *rotate if you reused it*.

## The line (non-negotiable)
**Deterministic significance derived from STORED data is safe. Generated narrative about what a finding means
for someone's life is NOT.** Section 2 stays **human-authored**. This WO builds the deterministic scaffold the
analyst works from — it never writes prose about consequences.

## Scope

### Part A — deterministic significance rule table
A fixed table keyed on **data classes** (already stored: `DataClasses` / summary "Data exposed: …") and
**breach date** (`first_seen_date` / "Breach date"), producing a per-finding **significance** — NOT prose.
Illustrative rules (final table to be enumerated, then frozen):

| Signal (from stored data) | Significance (deterministic) |
|---|---|
| Breach title matches stealer/combolist/credential-stuffing/synthient | **Credentials may be live now** — the log is actively traded |
| Passwords exposed, breach date old, not a stealer log | **Rotate if reused** — historical hash dump |
| Data class ∈ {SSN, credit card, bank, government ID, passport} | **Sensitive identity data** — highest handling tier |
| Broker listing (`anchor_type=data_broker`) | **Opt-out exists** — removable at source |
| Physical address in a breach | **Address in a leaked record** — may be a past address |

Every row is a lookup on values already in the DB — no model, no interpretation, template-only (same
discipline as synthesis-primitives.ts). Output is a `significance` label + a mechanical action, both from the
table, attached per finding.

### Part B — analyst worksheet
Order the findings by **what needs doing first** (significance tier), with the **mechanical action
pre-filled** from Part A (rotate / opt-out / monitor / escalate). Leaves the **judgment to the analyst** —
the worksheet proposes the order and the rote step; the analyst writes Section 2. Ordering + pre-fill are
deterministic; the consequence narrative is not produced.

## Boundaries (do NOT cross)
- No generated prose about what a breach means for the subject's life, safety, or relationships.
- Section 2 (Remediation) remains authored by the analyst and is never machine-written.
- Significance is a LOOKUP on stored data classes + dates, frozen once enumerated — not an LLM judgment.
- Measured vs analyst-assessment tiers stay separate (the week's anti-fabrication discipline).

## Report / do not build
Scope only. Enumerate + freeze the full rule table, and design the worksheet ordering, when picked up.
Relates to Section 2's standing "authored, never machine-generated" rule.
