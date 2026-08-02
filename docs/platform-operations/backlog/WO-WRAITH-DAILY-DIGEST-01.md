# WO-WRAITH-DAILY-DIGEST-01 — operator digest of wraith vuln findings

**Logged:** 2026-08-02. **Status:** BLOCKED on WO-WRAITH-SCOPE-01 (detection). Do not build yet.

## Intent
A daily operator-facing digest of `wraith_vulnerability_findings` (new/changed critical+high, by file, with CWE + recommendation), so the nightly code vuln scan produces an operator signal instead of silently filling a table nobody reads.

## BLOCKED — precision + fresh-source not yet established
**The precision-validation argument, in one line:** the scanner's *first* production output was a **false critical** (CWE-306 auth bypass on `ingest-signal`, authenticated since F-026) — caused by **stale source** (WO-SNAPSHOT-STALENESS-01). A digest that had emitted that would have paged a fixed vulnerability as a live platform critical. The digest stays blocked until (a) snapshots are fresh + git_sha-verified and the scanner refuses stale source, and (b) precision is validated on the known-bad fixture. Coverage-explicit reporting (below) is necessary but not sufficient; **source-freshness is a second denominator** — a scan of stale code is not a scan of the platform.

## BLOCKED — do not build until detection works
The 2026-08-02 proof showed the scanner returns **0 findings on known-vulnerable code** (WO-WRAITH-SCOPE-01 §0). A digest over a scanner that detects nothing is worse than nothing: it manufactures **false assurance** — a daily "0 vulnerabilities" email that reads as "the platform is clean" when the truth is "the scanner is blind." Detection must be fixed and validated (non-zero recall on planted bugs) before this digest is allowed to emit.

## HARD REQUIREMENT when built — coverage must be stated explicitly
**The digest MUST state coverage: files scanned vs files deployed.** A clean report over 1.4% of the surface (5 of 321) must not be able to read as a clean platform. Every digest states, prominently, e.g.:

> Scanned **N of 321 deployed functions** (X%). Files not in scope are **not** asserted clean.

- "0 findings" is only meaningful against a denominator — always show it (denominator doctrine).
- If scope is partial, say which files were *not* scanned (or that the list is available), so "no findings" never implies "no vulnerabilities on the platform."
- Pair with a freshness line: newest `codebase_snapshots.snapshotted_at` and `last_scanned_sha` coverage, so a stale/partial scan cannot masquerade as current+complete.

## Prerequisites (all from WO-WRAITH-SCOPE-01)
1. Detection fixed + validated (non-zero recall). **Gating.**
2. Scope widened toward 100% (or coverage honestly reported if still partial).
3. `wraith_vulnerability_findings` actually populating with real findings.

Then: a digest generator (or a section in the existing daily briefing) that reads new/changed findings, dedups by `(file, sha, cwe)`, and leads with the coverage denominator.
