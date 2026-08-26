# WO-INV-FILE-NUMBER-FORMAT-01 — inconsistent investigation file-number format

**Logged 2026-08-12.** File numbers are manually entered (mirror PECL's Windows file system).

## Finding (measured)
- `investigations.file_number` is inconsistent width: `INV-2026-047` (3-digit) vs `INV-2026-0072` (4-digit). Verified it is the value in the **source row**, not a truncation downstream (the watch-list link event carries it faithfully).
- **Why it matters:** file numbers now appear in watch-list link notifications; inconsistent format is operator-visible and breaks sort/dedup/lookup by file number.

## Scope note
This is source-data hygiene (manual entry), not a code bug. Options: normalize existing rows to a canonical width, and/or add an input mask on file-number entry. Decide before it propagates further into notifications/reports.

## Not started. Measured only.
