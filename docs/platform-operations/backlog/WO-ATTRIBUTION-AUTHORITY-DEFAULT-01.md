# WO-ATTRIBUTION-AUTHORITY-DEFAULT-01 — `is_authoritative` absence renders as a usable value

**Status:** OPEN — options only, DO NOT BUILD (operator ruling pending 2026-08-16).
**Class:** absence-rendering-as-value (same shape as the 0.5 relevance default, WO/ledger 2026-08-16 "LARGEST FINDING"). An omitted judgement is silently substituted with a plausible one that a consumer then reads as truth.

## The finding
`signal_client_attributions.is_authoritative`:
- column **DEFAULT = false**
- **writer-set** — the only trigger (`trg_sca_append_only`) blocks UPDATE/DELETE; **nothing promotes a row to authoritative**
- so a writer that **omits** the flag mints rows the ledger does **not** consider true, while a consumer reads them anyway.

Observed failure (INC — PECL, reconciled 2026-08-16): the 2026-08-12 writers set `is_authoritative=true` correctly (BC Place 167 direct; PECL 271 none). The **2026-08-14 PECL re-attribution omitted the flag** → 288 positives (276 direct + 12 sector) defaulted to `false`. `generate-executive-report`'s positive read (L308) did **not** filter on the flag, so the brief rendered PRGT action items on rows the ledger did not consider authoritative. Write wrong + read wrong, cancelled out. Fixed case-by-case (promote-via-supersede + read now requires the flag), but the **column contract still guesses on omission** — the next omitting writer reintroduces it.

This is the attribution twin of `signals.relevance_score DEFAULT 0.5`: absence → usable value. Target discipline is the one already in-repo — `ingest_decisions.relevance_score`: *"NULL = never scored. 0 = scored zero. Never coalesce."* Force the decision; never substitute one.

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
