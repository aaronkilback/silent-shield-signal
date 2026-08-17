# WO-ATTRIBUTION-SUPERSEDE-TRIGGER-01 — promote-on-supersede trigger (the correction path)

**Status:** DESIGN — sequenced FIRST, before the sweep writer (WO-ATTRIBUTION-WRITER-MISSING-01). DO NOT BUILD until the design is ruled. 2026-08-17.

## Why this is the blocker (we created it)
The constraint pass (WO-ATTRIBUTION-AUTHORITY-DEFAULT-01: `is_authoritative` NOT NULL + partial-unique `(signal_id,client_id) WHERE is_authoritative`) made the ledger strict; the append-only trigger (`trg_sca_append_only`, raises on any UPDATE/DELETE) makes it immutable. **Together, correcting a wrong authoritative attribution is currently impossible** — you can't UPDATE-demote the old row (append-only) and can't INSERT a second authoritative row (unique index). A sweep that can only ADD first-time attributions would make **the first run's judgements permanent.** This trigger is the only append-only-compatible correction path. Getting it wrong makes the ledger permanently wrong, so it ships and is proven before any writer.

## Current objects (facts)
- `trg_sca_append_only` — `BEFORE UPDATE OR DELETE FOR EACH ROW` → raises `check_violation` unconditionally.
- `uq_sca_one_authoritative_per_signal_client` — `UNIQUE (signal_id, client_id) WHERE is_authoritative`. A plain UNIQUE INDEX (NOT a constraint) → **cannot be made DEFERRABLE**; the transition must never present two authoritative rows for a pair even momentarily.
- Columns: id, signal_id, client_id, attribution_type, is_authoritative, basis, supersedes(self-FK), disclosure_status, note, created_by, created_at.

## Design (answering the four questions)

### Q-a — What it does on an insert carrying a `supersedes` reference
New object `tg_sca_promote_on_supersede()` — **`BEFORE INSERT FOR EACH ROW`** (BEFORE is mandatory — see Q-d). Acts ONLY when `NEW.is_authoritative = true AND NEW.supersedes IS NOT NULL`:
1. **Validate the supersede is well-formed** (else RAISE — a malformed supersede must never half-apply):
   - the superseded row `S` (id = NEW.supersedes) exists;
   - `S.signal_id = NEW.signal_id AND S.client_id = NEW.client_id` (you may only supersede an attribution of the SAME pair — otherwise you'd demote an unrelated pair's authority);
   - `S.is_authoritative = true` (you must supersede the CURRENT authoritative row, not a stale/already-demoted one — this also serializes concurrent supersedes, see Q-d).
2. **Demote `S`** (the flip — see Q-c) so the pair has zero authoritative rows for the instant before NEW lands.
3. RETURN NEW → the INSERT proceeds; NEW (is_authoritative=true) becomes the sole authoritative row for the pair.
- `NEW.is_authoritative=true, supersedes NULL`: plain first attribution — no-op, INSERT succeeds (or hits the unique index if the pair already has one — correct; caller must supersede or ON CONFLICT DO NOTHING).
- `NEW.is_authoritative=false`: no-op (inserting a historical/non-authoritative record is always allowed).

### Q-b — How it demotes the superseded row WITHOUT violating append-only
The demotion is a real `UPDATE` of `S`, which fires `trg_sca_append_only` (BEFORE UPDATE) → would raise. So the append-only guard must **exempt exactly this one flip and nothing else**, scoped so no out-of-band UPDATE can ride the exemption. Mechanism = a **transaction-local GUC handshake**:
- `tg_sca_promote_on_supersede()` sets `set_config('sca.demoting', NEW.supersedes::text, true)` (txn-local) immediately before the demote UPDATE, and resets it to `''` immediately after.
- `tg_sca_append_only()` is amended: on UPDATE, it RAISES **unless** `current_setting('sca.demoting', true) = OLD.id::text` **AND** the row diff is a pure demotion (Q-c). DELETE still always raises. The exemption is therefore active only during the promote-trigger's own UPDATE, only for the exact row being superseded, and only for the authority flip.
- The superseded row **remains present** (append-only history intact) — it is demoted, not deleted. This authority flip is the SINGLE sanctioned mutation of an existing row; everything else stays immutable. (Note: append-only here is an integrity guard against ACCIDENTAL mutation, not a security boundary — service-role can set the GUC itself; that is acceptable and consistent with Provenance Doctrine, where the DB guard documents+enforces intent, not defends against a trusted writer.)

### Q-c — Is demotion an `is_authoritative` flip (trigger-performed, UPDATE-block exempted) or a different mechanism?
**It is an `is_authoritative` flip (`true → false`) performed by the trigger, and the UPDATE block is exempted for exactly that flip** (Q-b). The append-only trigger's pure-demotion check requires: `OLD.is_authoritative = true AND NEW.is_authoritative = false` AND every OTHER column identical (`NEW.id=OLD.id`, signal_id, client_id, attribution_type, `basis IS NOT DISTINCT FROM`, supersedes, disclosure_status, note, created_by, created_at all unchanged). Any UPDATE that changes more than the flip, or flips the wrong direction, still raises.
- **Alternative considered & rejected:** never mutate `S`; instead derive "current authoritative" as `is_authoritative=true AND not referenced by a newer supersedes`. Rejected — that cannot be expressed as a partial unique index (you can't index "not referenced by another row"), so it would force dropping `uq_sca_one_authoritative_per_signal_client` and re-teaching every READER the "latest un-superseded" rule. The flip keeps the index as the single enforceable source of truth and leaves readers unchanged (they already filter `is_authoritative=true`).

### Q-d — How the unique index stays satisfied during the transition
A `BEFORE INSERT` row trigger runs to completion — including its demote UPDATE and that UPDATE's index maintenance — **before** NEW is inserted into the heap/indexes. Sequence within the single INSERT statement:
1. BEFORE INSERT fires → demote `S` → `S` leaves the partial index (now is_authoritative=false).
2. Trigger returns → NEW is inserted → NEW (is_authoritative=true) enters the partial index.
At no instant are two authoritative rows for the pair both in the index, so no DEFERRABLE is needed (which is fortunate — a UNIQUE INDEX can't be deferred). `AFTER INSERT` would be wrong: NEW would be indexed first and collide with the still-authoritative `S` before the trigger could demote it.
- **Concurrency:** two txns superseding the same pair — Tx1's demote UPDATE takes a row lock on `S`; Tx2 blocks until Tx1 commits, then sees `S.is_authoritative=false`, fails the "must supersede the current authoritative" validation (Q-a.1), and RAISES — forcing Tx2 to retry against the NEW current row. Correct serialization; the unique index is the backstop if validation is ever bypassed.
- **Atomicity:** demote + insert are one statement; if the INSERT fails downstream, the demote rolls back with it. No half-state.

## Build + proof plan (when ruled)
1. Migration: replace `tg_sca_append_only()` body (add the GUC+pure-demotion exemption) and add `tg_sca_promote_on_supersede()` BEFORE INSERT.
2. Proof harness (must pass before the sweep is built): (a) first attribution inserts; (b) valid supersede demotes old + promotes new, index holds, old row still present is_authoritative=false; (c) bare non-demotion UPDATE still raises; (d) DELETE still raises; (e) out-of-band UPDATE with a spoofed GUC that changes a non-authority column still raises; (f) supersede referencing a non-authoritative / wrong-pair row raises; (g) concurrent double-supersede — one wins, one raises. Only after green does WO-ATTRIBUTION-WRITER-MISSING-01 proceed.

Cross-ref: [[WO-ATTRIBUTION-AUTHORITY-DEFAULT-01]] (constraint pass, DONE — this was its deferred Option 3, now promoted to prerequisite), [[WO-ATTRIBUTION-WRITER-MISSING-01]] (the sweep, gated behind this).
