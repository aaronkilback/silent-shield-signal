# WO-FAIL-LOUD-AUDIT-01 — sweep for swallowed-error → silent-empty-default

**Logged:** 2026-08-02. **Status (2026-08-11):** item 1 DONE; gateway-model sweep DONE; **broader code sweep RAN — 2 real decision-feeding hits found + fixed + deployed prod (`2ac00308`)**; residual `.error`-ignored surface bounded + PARKED (see below). Enforces `architecture-decisions/fail-loud-doctrine.md`.

## Broader sweep — RAN 2026-08-11 (this IS the acceptance; not a rubber-stamp close)

Ran the P1–P4 grep priorities. **Two genuine violations in decision-feeding code, both fixed to fail loud (`2ac00308`, deployed prod across 6 functions):**
- **`predictive-incident-scorer`** batch fetch — a failed `signals` query read as `scored:0, "No signals to score"`; a DB failure silently disabled predictive scoring, indistinguishable from a clean empty batch.
- **`countCorroboration` (`_shared/incident-creation-gate.ts`)** — a failed `entity_mentions` query read as zero corroboration → could suppress a real incident. (Consumers redeployed: predictive-incident-scorer, incident-lifecycle-sweep, check-incident-escalation, generate-executive-report, ingest-signal, ai-decision-engine.)
- Canonical example of the shape recorded in KB (`feedback_failed_query_reading_as_zero`).

**Scope bound (do NOT carry as an unbounded open item):** the remaining surface is ~180 `callAiGateway` call sites + the P3 `data ?? []` candidates. That is **open-ended and NOT a single acceptance test** — enumerating it wholesale is exactly the anti-pattern this WO exists to avoid. **This WO is PARKED here, not left "OPEN" against an unbounded sweep.** Future fail-loud work is per-surface and demand-driven: when a specific monitor/scorer/gate is touched or misbehaves, apply the discriminator (*"does a failure here look identical to a successful empty result?"*) to that surface. The doctrine (`fail-loud-doctrine.md`) is the standing enforcement; a repo-wide grep is not a closeable acceptance criterion.

## Item 1 — `analyze_signal_threat_dna` (DONE — was fabricating)
**Finding: all 840 threat-DNA rows were fabricated `clean` defaults.** The function sets a default `{ai_generated:0, synthetic:0, adversarial:0, verdict:'clean', confidence:0.5}`, called `claude-haiku-4-5-20251001` (unmapped in the AI gateway → OpenAI → **404**), and on the swallowed 404 stored the default. Query proof: **all 840 rows byte-identical** (`0/0/0/clean/0.5`). The scorer never analyzed anything; its adversarial-signal block (soft-delete at `adversarial ≥ 0.85`) **never fired**. Same class as entity-deep-scan's fabricated sanctions screening — model non-output recorded under "AI threat analysis" authority.
- **Fixed 2026-08-02:** model → `gpt-4o-mini`; **throws** on gateway error / null content / unparseable (no fabricated row; job-worker retries). Deleted the 840 fabricated rows.
- **Twin fixed same commit:** `detect_prompt_injection` used the same 404 model → always `allowed`, `confidence 0` → never logged (the 4-month silence) → never blocked. Now `gpt-4o-mini` + returns `analysis_ok:false, action:'error'` on failure. **Proven:** a blatant injection now returns `blocked:true, confidence:1, analysis_ok:true`.

### Cross-reference: fabricated-findings class (WO-FABRICATED-FINDINGS-01)
This is **not just a fail-loud bug — it is the fabricated-findings class.** On the same day, **two independent
systems were storing model-shaped defaults as analysis**: `analyze_signal_threat_dna` (840 default rows) and
`entity-deep-scan` (sanctions/criminal/property "screening"). Recorded in WO-FABRICATED-FINDINGS-01 as the
**fourth confirmed instance** of that class — a cross-reference, **not a separate incident**. The two doctrines
meet here: fail-loud (don't swallow the error) + fabricated-findings (don't store non-verified data under
analysis authority).

### Downstream-consumption check of the 840 deleted defaults (DONE — inert, no residual effect)
Deleting the rows only undoes the effect if nothing consumed them. Verified:
- **No code reads `wraith_signal_threat_scores`** outside its writer (grep, edge functions) — no severity/incident derived from them.
- **`signals.raw_json.wraith_threat_dna` = 0 rows** — the in-function warning-write (`ai_generated ≥ 0.76`) never fired (defaults were 0), so no signal was flagged.
- **0 signals soft-deleted by WRAITH** — the adversarial soft-delete (`adversarial ≥ 0.85`) never fired (defaults were 0).
- **Conclusion: the defaults were inert** — below every action threshold, read by nothing. Deletion is clean; no residual score/severity/incident to unwind. (The only "effect" was the fabricated rows themselves, now gone.)

## Gateway-model sweep (DONE) — every `callAiGateway` model ID vs the gateway's routing
Gateway routes `google/*`/`gemini-*` → Gemini, `sonar*` → Perplexity, **everything else → OpenAI**; a `MODEL_NORMALIZATION` map rewrites a few. Any non-gpt / non-gemini / non-sonar model not in the map → OpenAI → 404.
- **BROKEN (unmapped claude → 404):** `claude-haiku-4-5-20251001` (wraith detect_prompt_injection + analyze_signal_threat_dna) — **fixed**. `claude-opus-4-6` (wraith vuln scan) — fixed earlier (→ `openai/gpt-5.2`).
- **False positive:** `fbp_ellipse` (monitor-wildfires) — a Fire-Behaviour-Prediction ellipse model, **not an LLM / not callAiGateway**.
- **Verify-but-likely-fine (different endpoints):** `google/gemini-2.5-flash-image-preview` / `gemini-2.5-flash-image-preview` (image generation — generate-agent-avatar, generate-vehicle-image, fortress-document-converter) route to Gemini's image path; `gpt-realtime-2025-08-28` (openai-realtime-token — Realtime API session token, not chat completions). Neither is a chat-completions 404 like claude; confirm they succeed but not urgent.
- **All other call sites** use `gpt-4o-mini`, `gpt-4o`, `openai/gpt-5.2`, `gemini-2.5-flash`, `sonar-pro`, `openai/gpt-4o-mini` — all routable. **No other broken LLM model IDs.**

## Broader code sweep (OPEN) — the *shape*, beyond model IDs
The doctrine target is any `catch`/error-return that yields a plausible empty/default. Grep priorities:
1. **`.error` ignored:** every `callAiGateway(...)` / `supabase.rpc(...)` / `fetch(...)` caller that uses the result without checking `.error` / null / `.ok` (the vuln-scan + threat-DNA shape). Highest value.
2. **`catch { return [] / 0 / null / continue }`** without re-surfacing — especially in monitors, scorers, and gates whose output feeds severity/decisions.
3. **Swallowed query errors** like the health-manager (`sourcesError` logged not thrown) — any `{ data, error }` destructure that proceeds with `data ?? []` and ignores `error`.
4. **Fire-and-forget writes** whose failure is invisible (`.then(()=>{}, ()=>{})` on a write that *matters*).
Each hit: decide throw vs explicit `status:'failed'`/finding. Not all defaults are wrong (a genuine empty result is fine) — the test is *"does a failure here look identical to a successful empty result?"*

## Related fixes shipped 2026-08-02
- Vuln scan: model 404 + `substring(0,8000)` + swallowed error → all fail-loud (WO-WRAITH-SCOPE-01 §0).
- Injection gate: model + fail-loud + fail-closed-for-destructive + daily canary (WO-INJECTION-GATE-FAILOPEN-01).
- Doctrine: `architecture-decisions/fail-loud-doctrine.md`.
