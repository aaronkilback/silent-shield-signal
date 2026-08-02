# WO-WRAITH-SCOPE-01 — wraith vuln-scan: fix detection, then widen scope 1.4% → 100%

**Logged:** 2026-08-02. **Status:** SCOPE + cost recorded; do not build. **Priority:** HIGH. Follows WO-WRAITH-VULN-SCAN-DEAD-01 (auth fixed Option A) — but the detection proof failed, which re-orders this WO.

## Two problems, in order
### 0. DETECTION IS BROKEN — ROOT CAUSE FOUND: the model call 404s (fix first)
Proven 2026-08-02 via a raw pre-parse diagnostic (`__diag_scan_raw`, since reverted): the scan's `callAiGateway({ model: 'claude-opus-4-6' })` returns:
```
content_is_null: true
gateway_error: "OPENAI_API_KEY 404: The model `claude-opus-4-6` does not exist or you do not have access to it"
```
**The vuln scanner requests `claude-opus-4-6`, which the gateway routes to the OpenAI endpoint (`OPENAI_API_KEY`) → 404.** Every model call fails, `content` is null, `parseWraithJSON('')` → null → 0 findings, and the error is *returned* (not thrown) so the per-file `catch` never fires — it silently records 0. **It is NOT a parser bug, NOT a prompt/guardrails issue, NOT truncation — the model invocation has never succeeded.** The 21.5s runtime was 6 failing calls.
- **Scoped, clean root cause:** `claude-haiku-4-5-20251001` (used by `analyze_signal_threat_dna`) routes correctly and wrote 74 rows in 30d — so the gateway recognizes dated model IDs but not the undated `claude-opus-4-6`, defaulting it to OpenAI. **Fix = give the scan a gateway-routable model ID** (a properly-dated Opus ID the gateway maps to Anthropic, or whatever the gateway's model map expects). Verify the gateway's model→provider table.
- **Second, separate latent bug (fix at the same time):** line 690 caps each file at `substring(0, 8000)` — even once the model works, the 5 real files (ingest-signal is 77 KB) are scanned at ~10% (imports/boilerplate only). Chunk the file (or raise the cap with chunking) so the vulnerable code is actually sent.
- **Then** validate: with a routable model + the adce9554 fixture in scope, confirm it flags the `ilike` injection + unscoped reads (non-zero recall) before trusting any output. Build a small labeled corpus (known-vuln + known-clean), measure precision/recall — do not tune to pass one case.

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
