> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #75. Consumed by PR #76 (commit 1b19885d, 'all 10 §8 items signed'); the C.4 UI slice shipped.

---

# Decision Layer C.4 — Authorization Package (workflow-focused review)

**Status:** PROPOSED 2026-05-30 — signable authorization artifact for C.4. **This document does not authorize implementation.** Operator review of §1–§6 (operator-specified workflow questions) + §7 (frank adoption assessment) + sign-off on §8 converts the plan into the binding pre-implementation contract for **C.4 only**. R1.1 still locked behind §11 inventory-rerun gate.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md` (G2 ADR — RATIFIED, this package is its C.4 phase)
- `decision-layer-c3-authorization-package-2026-05-30.md` (C.3 package — APPLIED)
- C.3 validation report (PR #74, deployed prod, accepted) — established the schema half is now solved; adoption is the remaining gap

**Operator-stated framing (this package's North Star):**

> *"I am less interested in the UI implementation details and more interested in whether C.4 will generate meaningful commitment data."*

The package is organized around six operator-specified workflow questions (§1–§6), followed by an honest answer to the implicit seventh question (§7: will this actually work?). Implementation details appear only insofar as they affect the workflow answer — and live in §A as a brief appendix, not the main body.

---

## §1 — How will operators enter `next_review_at`?

C.4 surfaces the field at exactly one place: **the investigation editor at `src/pages/InvestigationDetail.tsx`** — the page that already governs synopsis, recommendations, file_status, persons, locations, cross-references, and entries. The page is where investigation engagement already happens. Adding `next_review_at` here piggybacks on existing engagement rather than creating a new surface to discover.

The field is a `<DatePicker>` (or native `<input type="date">`) bound to the editor's form state, written to `public.investigations.next_review_at` on save via the existing `.from('investigations').update(...)` path. The edge function `investigation-ai-assist` is **not** in the write path (it handles AI-assisted content generation, not the bare save); no edge-function change is required for the minimum-friction implementation.

**No other entry points are added:**
- No Investigations list-page bulk-set
- No agent/AI auto-set
- No tenant-level default
- No CLI / admin tool
- No watchdog auto-population

The single-entry-point design ensures operator intent is captured. If `next_review_at` gets populated, it's because an operator manually decided "yes, this investigation needs a review by this date."

---

## §2 — What is the minimum-friction workflow?

The workflow C.4 ships is **three keystrokes / three clicks past the existing editor flow**:

1. Operator opens an investigation (existing flow — no change)
2. Operator clicks a "Next review date" field — empty by default
3. Operator types or picks a date
4. Operator clicks Save (existing flow — no change)

**Friction-reducing decisions encoded:**

| Decision | Choice | Why |
|---|---|---|
| Default value on new investigations | **NULL** | The C.3 column ships nullable; defaulting to a specific value (e.g., "+30 days") would force every investigation to carry a review date whether operators intend one or not. NULL means "no review tracked"; populated means "operator stated a date." Distinguishability is load-bearing for §11 adoption measurement. |
| Required at save time | **No** | Saving a partially-populated investigation must continue to work. Forcing the field would either block legitimate "no review needed" saves or train operators to type bogus dates. Either outcome corrupts the inventory signal. |
| Validation on input | **Permissive** | A `date >= today` UI hint is fine; rejecting past dates as invalid is too strict — operators may legitimately set a past date to flag overdue review. The C.3 schema has no CHECK constraint; the UI should not impose one beyond a soft "looks past-due" affordance. |
| Date-only vs date-time | **Date-only** (DatePicker), persisted as timestamptz with `00:00:00` local | Reviews are scheduled to days, not minutes. Adding a time picker is friction without benefit. The DB column is timestamptz; UI normalizes. |
| Visible in list view | **Yes (read-only)** | The Investigations list page already shows `file_status`, `file_number`, etc. Adding `next_review_at` as a sortable read-only column gives operators feedback that the field is real. List entry is read-only — set/clear happens only in the detail page. |
| Quick-set presets | **Optional, low priority** | "Set 7 days / 30 days / 90 days" buttons are convenient but add UI surface. Ship without them in C.4; add later if operator feedback wants them. |

**Friction-creating choices explicitly avoided:**
- No multi-step wizard
- No required field on save
- No confirmation modal
- No hidden settings menu
- No save-time prompt (e.g., "do you want to set a review date?")
- No save-time blocker for past-due reviews

---

## §3 — What prevents BC-Place-style shell investigations from remaining empty?

**Honest answer: C.4 does not prevent this. C.4 cannot prevent it.**

The C.3 validation surfaced a bimodal pattern:
- Petronas (2/2 = 100% synopsis populated) — content-rich engagement
- BC Place + Trent Reznor (0/3 synopsis populated, open for 10+ days) — shell engagement

Adding a `next_review_at` field to the editor reduces friction for the engaged-operator path (Petronas-class). It does nothing for the disengaged-operator path (BC-Place-class). If an operator never opens the investigation after creating it, the editor's affordances are unreachable. If an operator opens it but doesn't fill out synopsis, they're unlikely to fill out `next_review_at` either — both fields require the same kind of engagement.

**What C.4 explicitly does NOT do:**

| Option NOT shipped in C.4 | Why excluded |
|---|---|
| Modal-on-create prompt for review date | Adds friction at high-energy moment; if operators are creating shell investigations, the modal becomes friction they dismiss without engaging |
| Default `next_review_at = created_at + 30 days` | Would make every investigation carry a date by default. Operator-stated intent becomes indistinguishable from system-default. Corrupts §11 adoption measurement. |
| Stale-investigation watchdog (e.g., notification at 7 days open + no synopsis) | Out of C.4 scope. May make sense as a future C.5/C.6 if §11 re-run shows shell-investigation rate is the dominant problem. Notification surface is separately gated. |
| Required-field on creation | Forces operators to type bogus dates; trains the inverse behavior of what we want. |
| AI-suggested review dates | Out of C.4 scope. Requires `investigation-ai-assist` change + a prompt for "given this investigation, suggest a review interval." Could be a future enhancement. |
| Force-archival of stale investigations | Destroys operator agency. Out of scope. |

**The framing C.4 ships under:** *operator engagement is the load-bearing input; C.4 lowers friction so engaged operators can populate the field; disengaged operators remain disengaged and the §11 re-run measures it honestly.*

If §11 re-run finds the shell-investigation rate is the dominant problem, the operator-stated rule is to pivot to Option B (`principal_commitments` table) or Option E (conversation-extraction) rather than building more nudges on top of the current investigations surface.

---

## §4 — How will we measure adoption after deployment?

Five measurement axes, queryable via SQL. **No new audit infrastructure ships in C.4.** Adoption is measured by the operator running queries against staging + prod when the §11 re-run window opens.

### Measurement query (canonical form)

```sql
-- Adoption measurement queries — to run against staging + prod
-- starting at C.4-deploy + 2 weeks, weekly thereafter

-- Q1: Raw adoption rate
SELECT
  count(*) FILTER (WHERE next_review_at IS NOT NULL) AS populated,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE next_review_at IS NOT NULL) / nullif(count(*), 0), 1) AS pct
FROM public.investigations
WHERE file_status IN ('open','active','in_progress');

-- Q2: Per-tenant adoption breakdown — is the bimodal pattern persisting?
SELECT
  c.tenant_id::text AS tenant,
  c.name AS client,
  count(i.*) AS open_count,
  count(i.*) FILTER (WHERE i.next_review_at IS NOT NULL) AS populated_count,
  count(i.*) FILTER (WHERE i.synopsis IS NOT NULL AND length(i.synopsis) > 50) AS synopsis_count,
  count(i.*) FILTER (WHERE i.next_review_at IS NOT NULL AND i.synopsis IS NOT NULL AND length(i.synopsis) > 50) AS both_count
FROM public.clients c
JOIN public.investigations i ON i.client_id = c.id
WHERE i.file_status IN ('open','active','in_progress')
  AND c.name NOT LIKE '_qa%' AND c.name NOT LIKE '_pilot%' AND c.name NOT LIKE '_invariant%'
GROUP BY c.tenant_id, c.name
ORDER BY both_count DESC;

-- Q3: Time-to-populate — how quickly do operators set the field after creation?
SELECT
  i.id, i.file_number, i.created_at,
  i.next_review_at,
  i.updated_at,
  i.updated_at - i.created_at AS time_to_first_save,
  -- next_review_at populated within 7 days of creation = engaged
  (i.next_review_at IS NOT NULL AND i.updated_at <= i.created_at + interval '7 days') AS engaged_within_7d
FROM public.investigations i
WHERE i.created_at >= '<C.4-deploy-date>'::timestamptz
ORDER BY i.created_at DESC;

-- Q4: Shell-investigation rate — open + no synopsis + no review date
SELECT
  count(*) AS shell_investigations,
  count(*) FILTER (WHERE i.created_at < now() - interval '7 days') AS shell_stale_7d,
  count(*) FILTER (WHERE i.created_at < now() - interval '14 days') AS shell_stale_14d
FROM public.investigations i
WHERE i.file_status IN ('open','active','in_progress')
  AND (i.synopsis IS NULL OR length(i.synopsis) < 50)
  AND i.next_review_at IS NULL;

-- Q5: Threshold #2 progress vs §13 target
SELECT
  count(*) AS qualifying_investigations,
  -- §13 threshold: ≥3 real-tenant rows with next_review_at AND synopsis
  count(*) >= 3 AS threshold_met
FROM public.investigations i
JOIN public.clients c ON c.id = i.client_id
WHERE i.next_review_at IS NOT NULL
  AND i.synopsis IS NOT NULL AND length(i.synopsis) > 50
  AND c.name NOT LIKE '_qa%' AND c.name NOT LIKE '_pilot%' AND c.name NOT LIKE '_invariant%';
```

The queries above will be canonicalized into a single audit RPC `audit_investigations_adoption()` only if the operator wants ongoing telemetry without manual SQL — out of C.4 scope by default.

### What this measurement tells us (and what it doesn't)

| Signal | Interpretation |
|---|---|
| Q5 returns `threshold_met=true` | §13 threshold #2 met. Investigation-class is empirically active. |
| Q5 returns `threshold_met=false` AND Q1 `pct=0` | Schema present, no operator engagement. Shell-investigation problem dominates. |
| Q5 returns `threshold_met=false` AND Q1 `pct>0` but distributed across many tenants with low per-tenant counts | Threshold #2 is too narrow; consider tenant-weighted re-calibration |
| Q2 shows Petronas-style 100% adoption AND BC-Place-style 0% adoption | Bimodal pattern persists post-C.4. C.4 worked for engaged operators; cannot fix disengaged operators. |
| Q3 shows `time_to_first_save > 7 days` for most rows | Operators create-then-abandon. Same shell pattern. |
| Q4 shows `shell_stale_14d > 0` for new investigations created post-C.4 | C.4 did not change shell-investigation creation behavior. |

---

## §5 — What constitutes success versus failure?

Sharp thresholds, tied to the §11 inventory-re-run gate.

### Success — three tiers

| Tier | Definition | What it means |
|---|---|---|
| **S1 (strong)** | ≥3 newly-created real-tenant investigations post-C.4 have BOTH `next_review_at` AND `synopsis` populated, within 4 weeks | §13 threshold #2 met organically. Investigation-class is a viable commitment source for R1.1. |
| **S2 (moderate)** | At least 1 real tenant achieves ≥3 populated rows (tenant-weighted threshold), within 4 weeks | Bimodal pattern persists but engaged tenants ARE generating data. The operator may reasonably authorize R1.1 with the understanding that it'll fire mainly on engaged tenants. |
| **S3 (weak / seeded)** | Operator-direct seeding produces ≥3 populated rows specifically for inventory measurement | Confirms schema + workflow are functional. Tells us nothing about organic adoption. Acceptable bridge to the §11 re-run only if the operator decides organic measurement isn't feasible at current volume. |

### Failure — two modes

| Mode | Definition | What it means |
|---|---|---|
| **F1 (mild — low-volume failure)** | 0–2 investigations populated after 4 weeks, but ALSO no new investigations were created in the window | Adoption rate is unknowable because the denominator is too small. Not a C.4 defect; a volume problem. Pivot guidance: extend the window OR seed directly OR pivot to Option B/E. |
| **F2 (severe — shell-investigation failure)** | 0–2 populated after 4 weeks, AND new investigations WERE created in the window but stayed in shell form | C.4 did not change behavior. The bimodal pattern is structural; this surface isn't going to produce commitments organically. **Pivot to Option B (principal_commitments) or Option E (conversation-extraction).** R1.1 cannot rely on investigation-class commitments. |

### Distinguishing F1 vs F2 (load-bearing for the §11 re-run)

The Q3 / Q4 queries (§4 above) directly distinguish:
- F1: Q3 returns near-empty (no new investigations); Q4 unchanged
- F2: Q3 returns rows with `engaged_within_7d=false`; Q4 shows new shell investigations

**This distinction is the load-bearing decision the §11 gate needs.** F1 vs F2 changes the next-phase recommendation.

---

## §6 — How long after deployment should adoption be evaluated?

| Window | Use |
|---|---|
| **24 hours** | C.4 sanity check — schema accepts writes, UI renders, save persists, no behavioral regression. Operator-direct seeding test. Not adoption measurement; deployment-correctness only. |
| **2 weeks** | **Minimum-viable adoption window.** Matches the original §13 criterion. Sufficient if the per-tenant investigation volume is what it was during C.3 measurement (small bursts of activity). Insufficient if volume drops further. |
| **4 weeks** | **Recommended evaluation window** for C.4 adoption. The bimodal pattern needs more observation than 2 weeks to be confidently characterized. New investigations created in weeks 1–4 are the load-bearing data; week-to-week trend matters. |
| **6 weeks +** | Diminishing returns. If the data doesn't show signal by week 4, additional time mostly accumulates noise. Switch to a pivot (Option B/E) or operator-direct seeding. |

**Recommendation:** evaluate at **2 weeks** for a first-pass read, **4 weeks** for the canonical §11 re-run measurement. If between 2 and 4 weeks the data is unambiguous (clearly S1 or clearly F2), the operator can accelerate the §11 re-run.

**Operator-stated note from C.3 validation:** *"Investigation volume remains extremely small."* The 4-week window is appropriate for low-volume measurement, but it does NOT solve the volume problem. If the §11 re-run finds zero new investigations created in 4 weeks, the adoption signal is unmeasurable regardless of C.4's correctness.

---

## §7 — Will C.4 generate meaningful commitment data?

**Honest answer: partially, conditionally, depending on operator workflow change C.4 alone cannot cause.**

### Three realistic outcome scenarios

**Best case (S1 outcome — probability: low-to-moderate):**
- Petronas-class operators populate `next_review_at` on new investigations as part of their existing content-rich engagement pattern. Both fields filled → threshold #2 met.
- Petronas hasn't created a new investigation since 2026-05-04 — 26 days at the time of writing. If the same cadence persists (1-2 investigations per month), 1-2 new investigations in the 4-week window could meet the threshold for one tenant.
- This is S2 (moderate), not S1 (strong) — single-tenant signal, not multi-tenant.

**Likely case (mixed outcome — probability: moderate):**
- Some new investigations get populated; some don't. Adoption mirrors current synopsis-population rates (~40% across the 5 real-tenant rows today).
- Q5 returns `threshold_met=false` but Q1 returns `pct>0`. The operator faces a calibration decision: re-tune threshold #2 vs pivot to Option B/E.

**Worst case (F2 outcome — probability: moderate):**
- No new real-tenant investigations are created in the 4-week window. OR: new investigations are created but stay in shell form.
- Q3 returns mostly-empty; Q4 shows new shell investigations.
- The §11 re-run records "F2 — C.4 shipped, adoption did not follow." Pivot to Option B / E is operator-authorized at that point.

### What would have to be true for C.4 to generate meaningful data?

C.4 generates meaningful commitment data **only if** at least one of the following holds:

1. **Petronas (or another engaged tenant) creates ≥3 investigations in the 4-week window, each fully populated.** This requires investigation volume to increase, which C.4 cannot cause directly.
2. **The operator deliberately seeds investigations** to test the workflow. This is S3 (weak); it confirms infrastructure works but doesn't measure organic adoption.
3. **An incident occurs in the window that spawns investigation work** (organic growth driver). Outside C.4's control.

C.4 by itself does not move volume. C.4 reduces friction on the populate-the-field step **once an operator has decided to engage with an investigation.** The decision-to-engage is the upstream input; C.4 is downstream.

### What this means for the §11 re-run

The §11 re-run should be timed to **after C.4 has been deployed for at least 4 weeks** so the evaluation has data to work with. The re-run will distinguish:
- "Investigation-class is empirically viable" → consider R1.1 authorization
- "Investigation-class is structurally available but adoption is too low" → pivot to Option B/E

**The §11 gate's job is to make this evaluation possible.** C.4 makes the evaluation honest by ensuring the schema isn't the bottleneck. The remaining question — operator engagement — is what the gate measures.

### Honest one-line answer

**C.4 will generate meaningful data only if at least one engaged tenant creates new investigations during the 4-week window. If the volume problem is the actual problem (not the schema or the workflow), C.4 alone will not move the §13 threshold and the §11 re-run will document that outcome as the basis for pivoting.**

The operator should authorize C.4 with that expectation, not with an expectation that adoption will follow.

---

## §A — Brief implementation summary (intentionally minimized)

Per operator framing ("less interested in UI implementation details"), this section is short.

| Surface | Change |
|---|---|
| `src/pages/InvestigationDetail.tsx` | Add one `<DatePicker>` or `<input type="date">` bound to a new `next_review_at` form-state slot. Wire to existing save handler (the page already calls `.from('investigations').update(...)`); add `next_review_at: form.next_review_at || null` to the update payload. |
| `src/pages/Investigations.tsx` (list view) | Optional, recommended: add `next_review_at` as a sortable read-only column. |
| `supabase/functions/investigation-ai-assist/index.ts` | **No change.** The save path doesn't go through this function. |
| TypeScript types | Regenerated `src/integrations/supabase/types.ts` will reflect the C.3 column automatically (already done as part of C.3 deploy if `DB Types Drift Check` was run; if not, regenerate before C.4 PR). |
| Tests | Vitest unit test on the editor's save handler if one exists; otherwise rely on the existing investigation save tests (none today). |
| RC4 CI guard | **Not affected.** The cop_timeline_events guard is scoped to that table; investigations have no equivalent guard (and don't need one — they're not the tenant-scope-carrying surface). |
| Rollback | Revert the frontend changes. The C.3 column stays in place (rolling back only reverts the UI affordance, not the schema). Zero data loss. |

---

## §8 — Authorization sheet (for sign-off after operator review)

| # | Item | Default | Operator action |
|---|---|---|---|
| §8.1 | Single-entry-point workflow per §1 (editor only) | Per §1 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.2 | Minimum-friction workflow per §2 (no required field, no default value, no modal) | Per §2 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.3 | Acknowledge C.4 does NOT prevent shell-investigation pattern per §3 | Per §3 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.4 | Adoption measurement via SQL queries per §4 (no new audit infrastructure in C.4) | Per §4 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.5 | S1/S2/S3/F1/F2 success-vs-failure framing per §5 | Per §5 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.6 | Evaluation window: 4 weeks recommended; 2 weeks minimum-viable | Per §6 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.7 | Acknowledge "C.4 will generate meaningful data only if at least one engaged tenant creates new investigations during the window" per §7 | Per §7 — honest expectation, not an optimistic one | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.8 | Option C is NOT R1.1 authorization (locked) | Carried from G2 §10 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.9 | Re-run inventory study before any detector work (locked) | Carried from G2 §11 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.10 | Held items remain held (per §9) | Per §9 | ☐ CONFIRM ☐ OVERRIDE: ______________ |

Operator signal in chat to authorize: *"Authorize C.4"* (or equivalent unambiguous wording) with item-by-item decisions.

---

## §9 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- C.0 (deployed prod, accepted) — unaffected
- C.1 (deployed prod, accepted) — unaffected
- C.2 (PR #72, deployed staging, validation accepted) — unaffected
- C.3 (PR #74, deployed prod, accepted) — column exists, no writer yet (C.4 is the writer)
- **R1.1 — locked behind §11 inventory-rerun gate** (carried from G2)
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged
- Operator-locked CQ1 strictness — preserved (C.4 doesn't touch tenant scope)
- Options A / F — remain rejected
- Options B / D / E — unchanged; remain available as pivot paths if C.4's adoption window produces F2

## Changelog

- **2026-05-30 v1** — initial C.4 authorization package, operator-directed workflow-focused shape. Six operator-specified workflow questions answered directly. §7 contains the load-bearing honest assessment: C.4 generates meaningful data only if at least one engaged tenant creates new investigations during the window — adoption is upstream of C.4, not caused by C.4. 10-item sign-off block, with §8.7 explicitly requiring the operator to confirm this honest framing. Held items unchanged. UI implementation details intentionally minimized per operator framing.
