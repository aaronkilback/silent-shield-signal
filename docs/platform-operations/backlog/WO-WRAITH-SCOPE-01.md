# WO-WRAITH-SCOPE-01 — wraith vuln-scan: fix detection, then widen scope 1.4% → 100%

**Logged:** 2026-08-02. **Status:** SCOPE + cost recorded; do not build. **Priority:** HIGH. Follows WO-WRAITH-VULN-SCAN-DEAD-01 (auth fixed Option A) — but the detection proof failed, which re-orders this WO.

## Two problems, in order
### 0. DETECTION IS BROKEN (gating — fix first)
Proven 2026-08-02: with auth fixed, a scan over 5 real files **and** an injected verbatim `ai-tools-query@adce9554` excerpt (unscoped cross-tenant reads + `.or(\`…ilike.%${query}%\`)` filter injection) returned **`total_findings: 0`** — the scanner flagged **none** of the textbook instances of its own prompt's classes #1/#2. The model was invoked (21.5s), so it ran; it returned/parsed nothing. **Widening scope over a scanner that detects nothing just scans more files and still finds nothing.** Fix detection before scaling.
- Candidate root causes to investigate: single-shot `claude-opus-4-6` call with a broad 7-class prompt under-detects (needs per-class focused passes, few-shot exemplars of each CWE, or a smaller-chunk sliding window); OR findings are produced but silently dropped in JSON parse (`try/catch` swallows per-file). Instrument the per-file model output first (measurability), then tune with a labeled corpus (the adce9554 excerpt is a ready positive fixture). No "tune the prompt to pass a single case" — build a small labeled set (known-vuln + known-clean) and measure precision/recall.

### 1. SCOPE — 5 of 321 is 1.4%
`scanTargets` is hardcoded to 5 files; **the snapshot is as narrow as the scan** — `wraith-snapshot-codebase` `SCAN_TARGETS` holds the *same* 5 hardcoded paths, and `codebase_snapshots` contains exactly those 5 rows. So the diff source is 1.4% too. **Widening the snapshot to all 321 is step one and is nearly free** (the storage bucket + `scripts/upload-codebase-snapshot.py` already run per deploy; the function just loops a list). Do this before/with detection tuning so there is material to scan.

## Cost (recorded) — model `claude-opus-4-6`
- **Full surface:** 321 `index.ts`, ~5.14 MB ≈ **~1.5M input + ~0.4M output tokens/run** → Opus (~$15/M in, ~$75/M out) ≈ **~$50 one-time full pass** (range ~$35–65). Nightly-full ≈ ~$1.5K/mo — not viable.
- **Runtime:** infeasible in one edge call — 321 Opus calls (~3.5s+ each ⇒ >18 min best case, realistically far more), past the 150s ceiling; largest file (`dashboard-ai-assistant`, 538 KB ≈ ~145K tok) needs chunking. Full pass must be spread across runs (budget/cursor) or a job queue.
- **Incremental:** `codebase_snapshots.sha256` is the diff source. Add `last_scanned_sha` per file; scan only files whose sha changed since last scan. Steady-state nightly ≈ **~$0.10–$2/night**. First full pass = the ~$50, amortized across nights via cursor.

## Shape (do not build)
1. **Fix detection** (gating): instrument per-file model output; build a labeled corpus; tune (focused passes / few-shot / chunking) to non-zero recall on known-vuln, low false-positive on known-clean. Measure precision/recall — a scanner is not done until it detects a planted bug.
2. **Widen snapshot** to all 321 (SCAN_TARGETS → full inventory; nearly free).
3. **DB-driven `scanTargets`** (drop the hardcoded 5) + `last_scanned_sha` per file.
4. **Incremental scan:** diff by sha, scan delta within a per-run file budget + cursor; dedup findings by `(file, sha, cwe)`.
5. Register + heartbeat (Registry-is-a-Promise) + a probe reading `cron.job_run_details` failures.

## Test tooling note (for whoever builds this)
The full 40 KB `ai-tools-query@adce9554` blob could not be injected into prod `codebase_snapshots` via available tooling (MCP `execute_sql` truncates large inline data; `supabase storage` CLI is linked to **staging** `lkvyrvuakzguszbpwnfz`, which has no `codebase-source` bucket). The 2026-08-02 detection test used a verbatim ~1.3 KB excerpt containing the injection + unscoped reads. A proper detection-quality harness needs a repeatable way to load labeled fixtures into `codebase_snapshots` (e.g. a small seed script run in the deploy env).
