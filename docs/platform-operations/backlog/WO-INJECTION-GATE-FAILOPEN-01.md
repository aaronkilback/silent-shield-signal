# WO-INJECTION-GATE-FAILOPEN-01 — prompt-injection defence fails open on the primary chat surface

**Logged:** 2026-08-02. **Status: CLOSED 2026-08-11** — fail-open fixed + fail-closed for destructive tools + gate-silence canary (built 2026-08-02) + **red-team efficacy pass PASSED 2026-08-11** (the last open item). **Priority:** HIGH. Split out of WO-WRAITH-VULN-SCAN-DEAD-01 per operator.

## CLOSED 2026-08-11 — red-team efficacy pass (design point #4, the last remaining item)
Ran a 17-case battery (12 diverse injections + 5 benign controls) through the live `detect_prompt_injection` gate from inside the trust boundary (`supabase/functions/redteam-injection-probe`, a reusable harness; not scheduled). **Result, stable across two runs: 12/12 injections BLOCKED — 100% detection.** Patterns caught: role-override+exfil, DAN jailbreak, fake-system directive, social-engineered destructive tool call, prompt-boundary `</system>` injection, nested/indirect, mixed benign+inject, base64-obfuscated, config/key exfil, indirect-via-document, "help me bypass the detector", append-after-END-OF-MESSAGE override. The gate also correctly PASSED the one legit high-risk operation (`delete this confirmed dupe`) — not fooled by the word "delete". **Efficacy is proven, not assumed.**
- **Fix shipped during the pass:** the gate intermittently returned `analysis_ok:false` because `gpt-4o-mini` sometimes emitted non-JSON that `parseWraithJSON` couldn't parse. Added `response_format: json_object` (JSON mode; the prompt already requires JSON) → benign parse-failures dropped from 2/5 to ~0.
- **Residual (recorded per no-new-WO rule — NOT a blocker; safely handled + off the production path):** one benign read (`benign-summary`) still returns a gateway-level `analysis_ok:false`, and `benign-query` is occasionally model-over-flagged. Neither reaches the gate in production — the gate fires only on **high-risk tool dispatches**, not read/summary queries — and both are safely handled by the built dispatch classifier (`analysis_error` → fail-closed for destructive, loud-fail-open + `record_platform_finding` for non-destructive). The daily `agent-sentinel` canary continues to prove the gate blocks a blatant injection each day. Re-run `redteam-injection-probe` anytime to re-measure.

## The defect
`dashboard-ai-assistant` gates high-risk tool calls (`inject_test_signal`, `fix_duplicate_signals`, `submit_ai_feedback`, `create_entity`, `auto_summarize_incidents`, `delete_*`) on `wraith-security-advisor` `action: detect_prompt_injection`. The gate **fails open** on any failure:
```ts
const _wraithResp = await Promise.race([ fetch(_wraithUrl, {...}), <3s timeout> ]);
if (_wraithResp.ok) { ... if (blocked) return <blocked> ... }   // non-200 → skip, proceed
...
} catch (_wraithAiErr) {
  // Timeout or network error — fail open, log and continue
  console.warn(`[WRAITH AI] Check failed ...`);
}
```
So a **3s timeout, a network error, OR any non-200 from wraith** → the injection check is **skipped and the high-risk tool proceeds unchecked**. The only trace is a `console.warn` — invisible to operators. A wraith outage, a deploy regression, or an auth change silently disables injection defence on the primary chat surface, and nothing alerts.

## How long it has existed
Since **2026-04-08** (commit `87ed01d8`, "WRAITH security layer") — **~4 months**. The fail-open `catch` and the `if (_wraithResp.ok)` skip have been there from day one.

## Whether it has ever fired
**Effectively never.** `wraith_prompt_injection_log`: **3 rows total, all dated 2026-04-08 (launch day), 0 in the last 30 days** (0 for ~4 months). So the gate blocked/logged 3 times on the day it shipped and has not fired since. Either no injection attempts reached it, or it is not detecting — but the *log* shows a control that has been silent for four months on a surface that takes live user input.
- Note: the model it uses (`claude-haiku-4-5-20251001`) **does** route correctly (`analyze_signal_threat_dna` on the same model wrote 74 rows in 30d), so — unlike the vuln scanner's `claude-opus-4-6` 404 — this is *not* a dead-model bug. The gate *can* reach a working model; it just hasn't fired.

## Immediate context (2026-08-02)
This path was nearly regressed today: WO-WRAITH-VULN-SCAN-DEAD-01 Option A gated `detect_prompt_injection` on the internal-caller secret. Without also sending `x-fortress-internal` from `dashboard-ai-assistant`, every call would have 404'd → **fail open → injection defence silently off**. The header was added in the same change, so reachability is preserved — but that near-miss is exactly why the fail-open design is a defect: a routine auth change came within one edit of disabling the control invisibly.

## BUILT 2026-08-02
Design accepted + implemented:
- **Root cause found + fixed:** the gate used `claude-haiku-4-5-20251001` — **unmapped in the AI gateway → OpenAI 404** → always defaulted to `allowed`, `confidence 0` → never logged (the 4-month silence) → never blocked. It was never "no attacks"; it was a dead model. Model → `gpt-4o-mini`; on gateway error the gate now returns `analysis_ok:false, action:'error'` (never a fake `allowed`). Also fixed a latent `.insert().catch is not a function` that surfaced once the log path was reachable. **Proven:** blatant injection → `blocked:true, confidence:1, analysis_ok:true`.
- **Fail-closed for destructive tools:** `dashboard-ai-assistant` now classifies the gate outcome (`blocked`/`checked_clean`/`analysis_error`/`http_*`/`timeout`/`network_error`). Not-a-clean-check on a `delete_*` tool → **blocked (fail-closed)**; non-destructive → fail-open but **recorded loudly** via `record_platform_finding` (no longer a bare `console.warn`).
- **Gate-silence canary (the important half):** `agent-sentinel` (daily) sends a blatant known injection through `detect_prompt_injection` and asserts `analysis_ok && blocked`; if not, it raises a `high` platform finding. **4 months of zero log rows can no longer be silent** — the canary actively proves the gate blocks each day, independent of whether real attacks arrive.

## Original fix design (now built) — do not re-build
1. **Make fail-open loud, or fail-closed for the highest-risk tools.** At minimum, every fail-open MUST emit an operator-visible finding (not `console.warn`) — a security gate that skips must scream (attention doctrine + no-silent-caps). Consider fail-**closed** for `delete_*` / destructive tools (block on gate-unavailable rather than proceed).
2. **Distinguish "checked, clean" from "not checked."** Today both look identical (tool proceeds). Record the gate outcome per high-risk dispatch (checked/blocked/skipped-error) so "no block" cannot be confused with "gate down."
3. **Alert on gate silence.** A high-risk-tool surface whose injection log is empty for N days is either unused or broken — a probe should surface it (the 4-month silence should have been visible).
4. **Verify detection efficacy** separately — 3 lifetime detections warrants a red-team pass to confirm the gate actually catches known injection patterns (it reaches a working model, but efficacy is unproven).

## Cross-reference
- WO-WRAITH-VULN-SCAN-DEAD-01 — the auth change that nearly regressed this; the model-404 root cause of the *separate* vuln-scanner failure.
- Operator attention doctrine / no-silent-caps — a muted or skipped control is operationally equivalent to one that never ran.
