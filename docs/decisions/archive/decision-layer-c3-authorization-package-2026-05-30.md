> **ARCHIVED — superseded, retained for the immutable decision chain (nothing deleted, everything traceable).**
> PR #73. C.3 slice prod-applied (migration 20260530160000, salvaged in this PR).

---

# Decision Layer C.3 — Authorization Package (pre-implementation review)

**Status:** PROPOSED 2026-05-30 — signable authorization artifact for C.3. **This document does not, by itself, authorize implementation.** Operator review of §1–§7 + sign-off on §8 converts the plan into the binding pre-implementation contract for **C.3 only** (the schema-only column add). C.4 (the editor plumb that activates the column) remains separately gated. R1.1 still locked behind §11 inventory-rerun gate.

**Companion artifacts:**
- `architecture-decisions/decision-layer-option-c-G2-architecture-2026-05-30.md` (G2 ADR — RATIFIED, this package is its C.3 phase)
- `decision-layer-c1-authorization-package-2026-05-30.md` and `decision-layer-c2-authorization-package-2026-05-30.md` (the C.1 / C.2 packages this one mirrors)
- `supabase/migrations/20260530120000_decision_layer_c0_*.sql` (C.0 — APPLIED prod)
- `supabase/migrations/20260530140000_decision_layer_c1_*.sql` (C.1 — APPLIED prod)
- C.2 retrofit + RC4 CI guard (PR #72 — staging-deployed, validation accepted)
- `decision-layer-r1-commitment-inventory-study-2026-05-29.md` (the inventory study that surfaced this gap)
- `decision-layer-option-c-G2-authorization-sheet-2026-05-30.md` (operator-locked §10 + §11 carried verbatim)

---

## §1 — Plain-English objective

Add a single `next_review_at timestamptz` (nullable) column to the `public.investigations` table. This column records the date by which an open investigation needs to be re-reviewed. It is **metadata only at deploy time** — no code reads or writes it yet, no UI exposes it yet, no detector touches it. C.4 (a separate phase, separate operator GO) will add the investigation-editor form field and the edge-function payload field that lets operators populate the column. The R1.1 detector (locked behind §11) will eventually treat populated values as the deadline for the C3 "live decision" axis on the investigation-commitment class.

**What C.3 is, in one sentence:** the precondition column that turns an open investigation from "an open investigation" into "an open investigation with a stated deadline."

**What C.3 is NOT:**
- Not a behavioral change (deploy day is fully silent)
- Not a UI change (C.4's job)
- Not a detector change (R1.1's job, locked behind §11)
- Not a tenant-isolation change (column is metadata on an already-tenant-scoped row, via `investigations.client_id → clients.tenant_id`)
- Not a Provenance-Doctrine-bearing column (the column does not encode tenant ownership; the row's existing `client_id` does)

---

## §2 — Exact commitment-inventory benefit

The 2026-05-29 commitment inventory study identified investigation-hypothesis commitments as a load-bearing missing class. Specifics for the investigations surface (refreshed against prod 2026-05-30):

| Property | Prod state (2026-05-30) |
|---|---|
| Total `investigations` rows | 7 |
| Rows with `file_status IN ('open','active','in_progress')` | 5 |
| Rows with non-NULL `synopsis` | 4 |
| Rows with both open + non-NULL synopsis | **2** |
| Rows with non-NULL `next_review_at` | **0 — column does not exist** |

**The §13 success-criterion threshold #2** (carried from the original Option C ADR + auth sheet):

> *"≥3 real-tenant `investigations` rows have `next_review_at` populated AND `synopsis` non-NULL"*

Today this threshold is **structurally unmeasurable** because the column doesn't exist. The numerator can never exceed 0. The re-run of the inventory study (operator-locked §11 gate) would evaluate threshold #2 against an artificially narrower success metric, conflating "data exists" with "data structure exists."

**After C.3 (schema only, before C.4):**
- Threshold #2 becomes **structurally measurable** — there's a column to look at
- The numerator remains 0 until operators populate it (C.4 ships, operator-authorized, real-tenant adoption follows)
- The denominator stays at 5 open investigations (or whatever's open by re-run time)
- Re-run can record "0/5 populated → behavioral adoption gap" honestly rather than "no place to even put the data"

**After C.3 + C.4 + operator adoption (separately gated):**
- Threshold #2 becomes empirically achievable
- The §11 inventory re-run can produce an honest result against the threshold

C.3 ALONE does not move the inventory needle. It moves the threshold from "structurally unmeasurable" to "behaviorally measurable." That is the load-bearing distinction the operator's §11 gate depends on.

**One updated number worth flagging:** the 2026-05-29 inventory study found 0 open investigations with synopsis populated. Today (2026-05-30) that's 2 — a small operator-driven improvement to the underlying data shape during the brief Option C window. With C.3 in place, the inventory re-run could find the same 2 rows have `next_review_at` set if operators populate it during the next phase. The synopsis gap is closing on its own; the column gap requires C.3 to close.

---

## §3 — Schema impact

### Single column add

```sql
ALTER TABLE public.investigations
  ADD COLUMN IF NOT EXISTS next_review_at timestamptz;

COMMENT ON COLUMN public.investigations.next_review_at IS
  'Date by which this investigation needs to be re-reviewed. Operator-set via '
  'the investigation editor (C.4). When set on an open investigation, this '
  'becomes the deadline anchor for the R1.1 C3 axis (live-decision detection). '
  'NULL = no review deadline tracked. See decision-layer-c3-authorization-package-2026-05-30.md.';
```

### What is NOT added (deliberate non-decisions)

| Element | Decision | Reason |
|---|---|---|
| NOT NULL constraint | **Excluded.** Column ships as nullable. | Operators decide per-investigation whether a review deadline applies. Many legitimate investigations may not have one. The R1.1 detector treats NULL as "no deadline → no live decision on this branch" per the R1 ADR Q7 resolution. |
| Named Provenance CHECK constraint | **Excluded.** | The Provenance Doctrine invariant for `investigations` is already enforced via `client_id NOT NULL → clients.tenant_id NOT NULL`. The `next_review_at` column is **metadata on an already-tenant-scoped row**, not tenant scope itself. Adding a CHECK here would not preserve any doctrine that isn't already preserved. |
| Sanity CHECK (e.g., `next_review_at >= created_at`) | **Excluded for now.** Could be added later if operator practice surfaces bogus past-dates. | Adding the CHECK now is speculative; the column has no rows. If C.4 surfaces back-dating problems in UI testing, a follow-on adds the CHECK. Reversible. |
| Index on `next_review_at` | **Excluded.** | The R1.1 detector that queries by this column is locked behind §11. Speculative indexing on a column with current cardinality of 7 rows total has zero performance benefit. Add when R1.1 ships and read patterns are known. |
| Trigger | **Excluded.** | The column is metadata, not enforcement-bearing. Triggers on `investigations` would be a separate doctrine concern not covered by Option C. |
| Backfill UPDATE | **Excluded.** | Column is nullable; new rows naturally get NULL; existing rows get NULL implicitly. No backfill required. |
| RLS policy changes | **Excluded.** | The column inherits the table's existing RLS. No new policy needed. Investigations' existing RLS already correctly governs read/write. |

### Schema diff summary

| Before C.3 | After C.3 |
|---|---|
| 17 columns on `public.investigations` | **18 columns** (last column: `next_review_at timestamptz NULL`) |
| 0 indexes touching `next_review_at` | 0 indexes touching `next_review_at` |
| 0 CHECK constraints on `next_review_at` | 0 CHECK constraints on `next_review_at` |
| 0 triggers reading/writing `next_review_at` | 0 triggers reading/writing `next_review_at` |
| 0 RLS policies on `investigations` change | 0 RLS policies change |

The schema diff is **one ADD COLUMN statement and one COMMENT statement.** Nothing else.

---

## §4 — Behavioral impact

### Deploy-day behavioral impact: zero

| Surface | C.3 behavioral effect |
|---|---|
| Frontend (existing investigation pages, list views, detail views) | **None.** No frontend code reads `next_review_at` until C.4. |
| Edge functions (e.g., `investigation-ai-assist`, `generate-poi-report`) | **None.** None read `next_review_at` until C.4. |
| Aegis dashboard chat | **None.** No retrieval path reads it. |
| R1.0 Flight Recorder (`aegis_decision_threshold_trace`) | **None.** R1.0 is the audit sink only; no detector code is wired. |
| R1.1 detector | **None.** R1.1 is locked behind §11. |
| Drift audit (`audit_cop_timeline_events_tenant_drift`) | **None.** Different surface. |
| Cron jobs | **None.** No cron references `next_review_at`. |
| RLS policies | **None.** Existing investigations RLS unchanged. |
| `investigations` table writers | **None semantically.** A writer that INSERTs a new investigation gets NULL `next_review_at` automatically (column default = NULL). UPDATE paths that don't touch `next_review_at` continue working identically. |

C.3 ships with **zero observable behavior change** at deploy time. The column exists, is queryable as `SELECT next_review_at FROM investigations` (always NULL), is settable as `UPDATE investigations SET next_review_at = $1` (would succeed but nothing writes to it yet).

### Eventual behavioral impact (gated separately by C.4 + R1.1)

| Phase | What changes |
|---|---|
| C.4 (separate gate) | Investigation editor UI exposes a date input bound to `next_review_at`. Operators can set/clear it. Edge function `investigation-ai-assist` accepts it on save. |
| Real-tenant adoption (after C.4) | Operators populate `next_review_at` on open investigations they actively manage. The §11 inventory re-run measures this. |
| R1.1 detector (locked behind §11, post-inventory-re-run) | C3 axis treats `now() < next_review_at` as the "deadline not yet passed" condition; pre-deadline non-NULL value plus a recent change = candidate live decision. |

None of these eventual changes ship in C.3. They are listed only to clarify why C.3 must precede them.

---

## §5 — Rollback plan

### Single statement

```sql
ALTER TABLE public.investigations DROP COLUMN IF EXISTS next_review_at;
```

### Rollback safety properties

| Property | Status |
|---|---|
| Reversible | **Yes** — single `DROP COLUMN` |
| Data loss on rollback | **Zero at C.3-only window** — the column starts with NULL on all 7 rows. No writer populates it (C.4 hasn't shipped yet). DROP COLUMN at this window destroys nothing operationally meaningful. |
| Data loss after C.4 ships and operators populate values | NULLs are zero data. Non-NULL values entered via C.4 UI would be lost. **Recommendation:** if C.4 has shipped and operators have populated values, do a `SELECT id, next_review_at FROM investigations WHERE next_review_at IS NOT NULL` snapshot first; export to JSON for forensic recovery. **But this is a C.4-window concern, not a C.3-window concern.** |
| Cascading effects | **None.** No FK references this column. No view depends on it. No trigger reads it. No RLS policy filters on it. |
| Lock acquisition | `DROP COLUMN` acquires `ACCESS EXCLUSIVE` on `investigations` briefly. The table has 7 rows; lock duration is sub-millisecond. |
| Reversibility direction | Roll forward: just re-apply the C.3 migration. Roll back: just drop. Round-trip is clean. |

### Rollback validation post-revert

After rollback, the table returns to its pre-C.3 state:
- 17 columns
- No `next_review_at` references in schema
- Investigations writers (frontend + edge functions) unaffected; none touched `next_review_at` to begin with

---

## §6 — Verification plan

### §6.1 Pre-flight (must pass before staging apply)

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations' AND column_name='next_review_at') AS column_already_present,  -- expect 0
  (SELECT count(*) FROM public.investigations) AS row_count,                                                                   -- expect 7 (current prod)
  (SELECT count(*) FROM public.investigations WHERE file_status IN ('open','active','in_progress')) AS open_rows,              -- expect 5
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations') AS current_col_count;                                        -- expect 17
```

### §6.2 Post-apply schema verification (staging + prod parity-exact)

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations') AS col_count_post,                                           -- expect 18 (was 17, +next_review_at)
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations' AND column_name='next_review_at') AS column_present,           -- expect 1
  (SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations' AND column_name='next_review_at') AS column_type,              -- expect 'timestamp with time zone'
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='investigations' AND column_name='next_review_at') AS column_nullability,       -- expect 'YES'
  (SELECT count(*) FROM public.investigations) AS row_count_post,                                                              -- expect same as pre-flight (7)
  (SELECT count(*) FROM public.investigations WHERE next_review_at IS NOT NULL) AS populated_post                              -- expect 0
;
```

### §6.3 Functional verification (5 cases, staging-then-prod)

| # | Test | Setup | Action | Expected |
|---|---|---|---|---|
| 1 | INSERT with `next_review_at` set | Test investigation fixtures | `INSERT … VALUES (…, next_review_at = now() + interval '7 days')` | Row inserts; column reflects value |
| 2 | INSERT without `next_review_at` (default behavior) | Same | `INSERT … VALUES (…)` without next_review_at | Row inserts with `next_review_at = NULL` |
| 3 | UPDATE existing investigation to set `next_review_at` | Existing test row | `UPDATE … SET next_review_at = '2026-12-01'` | Succeeds; column reflects new value |
| 4 | UPDATE existing investigation to clear `next_review_at` | Row with value | `UPDATE … SET next_review_at = NULL` | Succeeds; column returns to NULL |
| 5 | SELECT investigations filtering by `next_review_at < now()` | Mixed rows | Query syntax valid; correct subset returned | Returns only past-due rows |

Cleanup deletes all fixture rows; residue check confirms no leftover.

### §6.4 Staging-first protocol (same as C.0 / C.1)

1. Apply migration to staging via Supabase MCP `apply_migration`
2. §6.2 schema verification on staging
3. §6.3 functional tests on staging (all 5 pass)
4. Residue check (test rows cleaned up; no leftover)
5. Apply same migration to prod
6. §6.2 schema verification on prod (parity-exact match with staging)
7. §6.3 functional tests on prod (all 5 pass)
8. Residue check on prod
9. Commit migration file to repo, push, open PR with validation report

### §6.5 What C.3 verification does NOT cover

- **No frontend verification** — no frontend reads the column yet; nothing to test. C.4's verification covers UI.
- **No edge-function verification** — no edge function reads the column yet. C.4 covers `investigation-ai-assist` payload field.
- **No drift audit changes** — C.3 doesn't extend `audit_cop_timeline_events_tenant_drift()` or add a new audit for this column. (A future `audit_investigations_review_consistency` could be added later if R1.1's needs surface one; out of C.3 scope.)
- **No R1.1 detector verification** — locked behind §11.

---

## §7 — Why C.3 is necessary before the inventory re-run

The operator-locked §11 clause from the G2 authorization sheet (carried verbatim from the original Option C authorization sheet):

> *"After Option C is complete, I want the commitment inventory study re-run before any Decision Layer detector work is authorized."*

The original commitment inventory study (`decision-layer-r1-commitment-inventory-study-2026-05-29.md`) established three §13 success-criterion thresholds:

| # | Threshold | Surface |
|---|---|---|
| 1 | ≥10 real-tenant `cop_timeline_events` rows | covered by C.1 + C.2 — both deployed |
| 2 | **≥3 real-tenant `investigations` rows have `next_review_at` populated AND `synopsis` non-NULL** | **Requires C.3 (column) + C.4 (UI) + operator adoption** |
| 3 | ≥5 real-tenant `incidents` rows have `principal_tier_deadline_at` populated | G2 of v2-era — operator-deferred |

**Without C.3, threshold #2 is structurally unmeasurable.** The numerator cannot exceed 0 because the column doesn't exist. The re-run would record "0/threshold" for an indistinct reason — either no inventory exists (the true situation today) or no infrastructure exists (the corrected situation). The re-run's job is to disambiguate. C.3 makes that disambiguation possible.

**The §11 gate is a measurement gate.** It exists to give the operator empirical evidence about commitment-inventory maturity before authorizing detector work. A measurement gate operating on a structurally-unmeasurable metric produces evidence that's correct-by-construction-empty — which is to say, no evidence at all.

**Three honest re-run outcomes are possible after C.3 + C.4:**

| Re-run outcome | Operator interpretation |
|---|---|
| ≥3 investigations have `next_review_at` AND synopsis | **Threshold met.** Investigation-class is empirically active. Detector reasoning over this class is viable. |
| 0–2 investigations have `next_review_at` AND synopsis after a meaningful window | **Threshold not met empirically.** Investigation-class is structurally available but operators haven't adopted. The inventory problem is **behavioral**; pivot to Option B or E rather than R1.1. |
| Schema present, threshold not yet met, but operator-direct seeding is reasonable | **Threshold deferrable.** Operator can seed values to test detector behavior. |

**Without C.3, the operator cannot reach any of these three.** The re-run is forced to record "no infrastructure" indefinitely. The operator's §11 gate becomes a wait-loop with no information advantage.

C.3 is the schema precondition that turns the §11 gate from "waiting for nothing measurable" into "waiting for measurable evidence."

---

## §8 — Authorization sheet (for sign-off after operator review)

| # | Item | Default | Operator action |
|---|---|---|---|
| §8.1 | Single nullable `next_review_at timestamptz` column add per §3 | Per §3 (no NOT NULL, no CHECK, no index, no trigger, no backfill) | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.2 | Column comment per §3 | Per §3 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.3 | Verification plan (§6) | All 5 sub-sections, staging-then-prod | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.4 | Rollback plan (§5) | Single `DROP COLUMN`; zero data loss at C.3-only window | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.5 | C.3 stays schema-only (zero behavioral effect at deploy time) | Per §4 | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.6 | C.4 (editor plumb) remains separately gated | C.4 requires its own authorization package + GO | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.7 | Option C is NOT R1.1 authorization (locked, carried from G2 §10) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.8 | Re-run inventory study before any detector work (locked, carried from G2 §11) | Locked | ☐ CONFIRM ☐ OVERRIDE: ______________ |
| §8.9 | Held items remain held (per §9 below) | Per §9 | ☐ CONFIRM ☐ OVERRIDE: ______________ |

Operator signal in chat to authorize: *"Authorize C.3"* (or equivalent unambiguous wording) with item-by-item decisions.

---

## §9 — Held (unchanged)

- P5 · P6 · Class B · PR #36 — unchanged
- C.0 (deployed prod, accepted) — unaffected
- C.1 (deployed prod, accepted) — unaffected
- C.2 (PR #72, deployed staging, validation accepted) — unaffected by this package; prod-promote is a separate scheduling decision
- **C.4** (investigation editor form field + edge function payload) — separately gated; NOT authorized by this package; requires its own authorization package
- G2 of v2-era (deferred) — unchanged
- **R1.1 — locked behind §11 inventory-rerun gate** (carried from G2)
- R1.2 / R1.3 / R1.4 / R1.5 / R1.6 / R1.7 — separately gated
- R2 / R3 / R4 / R5 / R6 — separately gated
- Decision Layer Doctrine — unchanged
- R1 ADR — unchanged
- I1 / I2 operator-locked invariants — unchanged
- R1 §B watchlist — unchanged
- Operator-locked CQ1 strictness — preserved (C.3 doesn't touch tenant scope)
- Options A / F — remain rejected
- Options B / D / E — unchanged

## Changelog

- **2026-05-30 v1** — initial C.3 authorization package. Single-column schema add, zero behavioral effect at deploy. Pre-flight refresh confirmed prod has 7 investigations / 5 open / 2 open-with-synopsis / 0 with `next_review_at` (column absent). Answers the operator's 7-question format directly: plain-English objective, exact commitment-inventory benefit (structurally unblocks threshold #2 measurability), schema impact (one ADD COLUMN + COMMENT, nothing else), behavioral impact (zero at deploy time), rollback (single DROP COLUMN, zero data loss at C.3-only window), verification (5-case functional + staging-then-prod parity), why it's necessary before inventory re-run (the §11 gate is a measurement gate; without C.3 it's measuring against a structurally-unmeasurable threshold). 9-item sign-off block (smaller than C.1/C.2 because the scope itself is smaller — no triggers, no RLS, no audit infrastructure). Held items unchanged.
