# WO-ATTRIBUTION-AUTHORITY-DEFAULT-01 — `is_authoritative` absence renders as a usable value

**Status:** RULED 2026-08-16 — **Option 2 primary + partial-unique index from Option 3.** Sequence gated: (1) inventory writers → (2) set flag explicitly in each → (3) verify → (4) flip column NOT NULL + add index in a SEPARATE pass. Writers first; a loud failure must be the bug surfacing, not new breakage. Currently at step (1).

**Ruling record (2026-08-16):**
- **Option 2 (NOT NULL, no default) accepted as primary** — omitting writer fails at insert.
- **Partial-unique `(signal_id, client_id) WHERE is_authoritative` accepted** — enforces one authoritative row per signal-client pair, the invariant the whole supersede mechanism assumes and nothing currently guarantees.
- **Option 1 (default true) REJECTED** — defaulting true means an omitting writer mints rows that read as **verified truth**, which is **worse than the current failure mode** (today an omission reads as *non*-authoritative and is at least excludable; a true-default omission would render a fabricated/unreviewed attribution as confirmed). An absence must never resolve toward "verified."
- **Do NOT flip the column in the same pass as the writer fixes.** Writers → verify → then constraint.
**Class:** absence-rendering-as-value (same shape as the 0.5 relevance default, WO/ledger 2026-08-16 "LARGEST FINDING"). An omitted judgement is silently substituted with a plausible one that a consumer then reads as truth.

## The finding
`signal_client_attributions.is_authoritative`:
- column **DEFAULT = false**
- **writer-set** — the only trigger (`trg_sca_append_only`) blocks UPDATE/DELETE; **nothing promotes a row to authoritative**
- so a writer that **omits** the flag mints rows the ledger does **not** consider true, while a consumer reads them anyway.

Observed failure (INC — PECL, reconciled 2026-08-16): the 2026-08-12 writers set `is_authoritative=true` correctly (BC Place 167 direct; PECL 271 none). The **2026-08-14 PECL re-attribution omitted the flag** → 288 positives (276 direct + 12 sector) defaulted to `false`. `generate-executive-report`'s positive read (L308) did **not** filter on the flag, so the brief rendered PRGT action items on rows the ledger did not consider authoritative. Write wrong + read wrong, cancelled out. Fixed case-by-case (promote-via-supersede + read now requires the flag), but the **column contract still guesses on omission** — the next omitting writer reintroduces it.

This is the attribution twin of `signals.relevance_score DEFAULT 0.5`: absence → usable value. Target discipline is the one already in-repo — `ingest_decisions.relevance_score`: *"NULL = never scored. 0 = scored zero. Never coalesce."* Force the decision; never substitute one.

## Writer inventory (step 1 — 2026-08-16, reported before any schema change)
**There are ZERO code writers.** No edge function, no RPC/SECURITY-DEFINER function, no committed script, no frontend (`src/`) path inserts into `signal_client_attributions`. Confirmed by repo-wide grep (only the DDL migration + `generate-executive-report` READS reference it) and `pg_proc` scan (the only function touching the table is `tg_sca_append_only`, which does not insert).

**Every row was written by ad-hoc/manual SQL** (MCP `execute_sql` / operator-run). Provenance from the ledger:
| When | What | is_authoritative | Notes |
|---|---|---|---|
| 2026-08-12 16:04 | PECL 271 `none` (Option C corrections) | **true** (set) | ad-hoc SQL |
| 2026-08-12 19:54 | BC Place 167 `direct` | **true** (set) | ad-hoc SQL — clean |
| 2026-08-14 17:54 | PECL 276 `direct` + 12 `sector` + 1182 `none` | **false** (OMITTED) | the defective re-attribution run |
| 2026-08-16 | PECL 288 supersede→authoritative | **true** (set) | the ITEM 1 fix |

**Implication for "writers first."** There is no persistent code to edit. The "set the flag in each writer" step reduces to: **establish a corrected re-attribution SQL template/procedure that always sets `is_authoritative` explicitly** (the 08-14 run used one that omitted it). Critically, the NOT NULL flip's real job is FUTURE writers: (a) manual re-attribution runs now — an omission fails at insert, surfaced to the person running it; (b) the PLANNED code writers ([[WO-HONEST-ATTRIBUTION]] items 3/4, [[WO-CLIENT-THREAT-RELEVANCE-01]]) when built — the constraint forces them to declare authority. Because nothing writes it today, the flip cannot break a live writer — its entire value is catching the writers that don't exist yet.

**Pre-flip data checks (run 2026-08-16, must re-run at flip time):** `is_authoritative IS NULL` rows = **0** (NOT NULL applies cleanly); `(signal_id, client_id)` pairs with >1 authoritative row = **0** (partial-unique index builds cleanly; invariant already holds in data). Totals: 2196 rows, 726 authoritative.

**Remaining before the constraint pass:** correct the documented re-attribution template to set the flag + re-verify these two counts immediately before flipping. Then, SEPARATE pass: `ALTER … SET NOT NULL` (drop default) + `CREATE UNIQUE INDEX … (signal_id, client_id) WHERE is_authoritative`. Not done — awaiting go.

## Options (operator wants the one that FAILS LOUD, not the one that guesses)

### Option 1 — DEFAULT true, writers demote explicitly
Omitting writer silently mints **authoritative** rows (over-authoritative — the inverse of today's bug, arguably worse: a fabricated attribution would read as truth by default).
- **Guesses `true` on omission. REJECT** — fails the operator's stated principle.

### Option 2 — NOT NULL, NO default  ← FAILS LOUD (recommended)
An omitting writer **errors at INSERT** (null violates NOT NULL). The writer is forced to make an explicit `true`/`false` authority decision or the write fails. The 2026-08-14 write would have errored immediately instead of silently minting 288 non-authoritative rows.
- **Direct analog of the ingest_decisions never-coalesce discipline** — absence is an error, not a value.
- **Prerequisite:** audit every writer of `signal_client_attributions` to set the flag explicitly before flipping the column, or those writers start erroring (that IS the point, but sequence it — inventory writers first, same as an audit-before-blocking guard).

### Option 3 — promote-on-supersede trigger
On INSERT of a superseding row, auto-manage authority (promote the new, demote the superseded).
- Addresses the **single-authoritative-per-(signal,client) invariant** and the supersede lifecycle, but does **NOT** force declaration at insert — a bare INSERT with no supersede still guesses. **Complementary, not the loud-fail.** Best paired WITH Option 2, and with a partial-unique index `(signal_id, client_id) WHERE is_authoritative` to enforce the invariant it automates.

## Recommendation (for ruling)
**Option 2 as the primary (fail-loud contract), optionally paired with the partial-unique index from Option 3 to enforce one-authoritative-per-(signal,client).** Sequence: inventory writers → set the flag explicitly in each → flip column to NOT NULL no-default → (optional) add the partial-unique index. Do NOT build until ruled.
