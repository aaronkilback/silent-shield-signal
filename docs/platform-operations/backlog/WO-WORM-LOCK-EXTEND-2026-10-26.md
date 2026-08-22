# WO-WORM-LOCK-EXTEND — extend the ss-fortress-dr WORM lock before it lapses

**Opened:** 2026-08-22 (promoted from ephemeral task #19 + a buried line in WO-DR-CADENCE-REBUILD — it was
never a standalone dated WO, which is why it kept being re-asked).
**Status:** OPEN — **HARD DEADLINE.**
**ACT BY: 2026-10-26** (T-14). **Lock expires: 2026-11-09.**

## What
The DR bucket `ss-fortress-dr` has a fixed-date R2 Object-Lock (WORM) rule **`snapshot-worm-90d`**,
`--retention-date 2026-11-09`. It makes all 522 backup objects immutable (no overwrite/delete) — the real
control that stops even the DR function's own Object-R/W token (and accidental non-admin deletes) from
destroying the backup. It is a **fixed date, not indefinite**, so it **must be extended before it lapses.**

## Consequence of missing the date (why this is load-bearing)
After **2026-11-09** the lock lapses → all 522 objects become **deletable/overwritable again** → the DR
function's own credential (and any admin token) can destroy the backup → **DR protection silently gone.**
R2 lock retention can be **lengthened, never shortened**, so extending early is safe and cannot cut current
protection.

## Action (on or before 2026-10-26)
1. Check current: `wrangler r2 bucket lock list ss-fortress-dr` → confirm rule `snapshot-worm-90d`, condition `on 2026-11-09`.
2. Extend: add/replace with a later fixed date (next quarter, ~2027-02-09) —
   `wrangler r2 bucket lock add ss-fortress-dr snapshot-worm-<next> "" --retention-date <YYYY-MM-DD> -y`
   (choose the new date ≥ the current one; retention can only lengthen).
3. **Verify:** `wrangler r2 bucket lock list ss-fortress-dr` shows the new later retention-date on all prefixes.
4. Re-file the next extension WO with the new T-14 date, so the reminder never lives only as an ephemeral task again.

## Notes
- Prereq/adjacent risk (WO-DR-CADENCE-REBUILD §"Admin-token exposure"): an **Admin** Cloudflare token can
  remove a bucket-lock rule → the lock is only as strong as the least-privilege of the tokens that exist.
  Cutting admin-all tokens to least privilege is the real control; the lock is secondary. Track there.
- Source of record: `WO-DR-CADENCE-REBUILD.md:180` (lock applied 2026-08-07). This WO supersedes the
  ephemeral task #19 as the durable, dated tracker.
