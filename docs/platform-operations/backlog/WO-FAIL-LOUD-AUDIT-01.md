# WO-FAIL-LOUD-AUDIT-01 — sweep for swallowed-error → silent-empty-default

**Logged:** 2026-08-02. **Status:** item 1 DONE; gateway-model sweep DONE; broader code sweep OPEN. Enforces `architecture-decisions/fail-loud-doctrine.md`.

## Item 1 — `analyze_signal_threat_dna` (DONE — was fabricating)
**Finding: all 840 threat-DNA rows were fabricated `clean` defaults.** The function sets a default `{ai_generated:0, synthetic:0, adversarial:0, verdict:'clean', confidence:0.5}`, called `claude-haiku-4-5-20251001` (unmapped in the AI gateway → OpenAI → **404**), and on the swallowed 404 stored the default. Query proof: **all 840 rows byte-identical** (`0/0/0/clean/0.5`). The scorer never analyzed anything; its adversarial-signal block (soft-delete at `adversarial ≥ 0.85`) **never fired**. Same class as entity-deep-scan's fabricated sanctions screening — model non-output recorded under "AI threat analysis" authority.
- **Fixed 2026-08-02:** model → `gpt-4o-mini`; **throws** on gateway error / null content / unparseable (no fabricated row; job-worker retries). Deleted the 840 fabricated rows.
- **Twin fixed same commit:** `detect_prompt_injection` used the same 404 model → always `allowed`, `confidence 0` → never logged (the 4-month silence) → never blocked. Now `gpt-4o-mini` + returns `analysis_ok:false, action:'error'` on failure. **Proven:** a blatant injection now returns `blocked:true, confidence:1, analysis_ok:true`.

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
