# WO-INJECTION-GATE-FAILOPEN-01 — prompt-injection defence fails open on the primary chat surface

**Logged:** 2026-08-02. **Status:** SCOPE — defect confirmed, fix HELD. **Priority:** HIGH (security control that silently disables itself). Split out of WO-WRAITH-VULN-SCAN-DEAD-01 per operator — it is its own defect, not a wraith-scanner issue.

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

## Fix (when authorized — do not build)
1. **Make fail-open loud, or fail-closed for the highest-risk tools.** At minimum, every fail-open MUST emit an operator-visible finding (not `console.warn`) — a security gate that skips must scream (attention doctrine + no-silent-caps). Consider fail-**closed** for `delete_*` / destructive tools (block on gate-unavailable rather than proceed).
2. **Distinguish "checked, clean" from "not checked."** Today both look identical (tool proceeds). Record the gate outcome per high-risk dispatch (checked/blocked/skipped-error) so "no block" cannot be confused with "gate down."
3. **Alert on gate silence.** A high-risk-tool surface whose injection log is empty for N days is either unused or broken — a probe should surface it (the 4-month silence should have been visible).
4. **Verify detection efficacy** separately — 3 lifetime detections warrants a red-team pass to confirm the gate actually catches known injection patterns (it reaches a working model, but efficacy is unproven).

## Cross-reference
- WO-WRAITH-VULN-SCAN-DEAD-01 — the auth change that nearly regressed this; the model-404 root cause of the *separate* vuln-scanner failure.
- Operator attention doctrine / no-silent-caps — a muted or skipped control is operationally equivalent to one that never ran.
