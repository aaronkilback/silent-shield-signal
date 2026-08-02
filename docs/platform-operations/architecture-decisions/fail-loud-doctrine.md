# Fail-Loud Doctrine — no silent-empty-default (2026-08-02)

**Status:** RATIFIED in principle (operator, 2026-08-02, after three instances surfaced in one day). Candidate for CLAUDE.md promotion.

## The rule
**Any operation that can fail must fail loudly.** A caught error that returns a valid-looking empty or default result is **indistinguishable from success** and will run broken indefinitely — nobody looks at a green light. The dangerous shape is:

```
try { ...work... } catch (e) { /* log + return [] / return 0 / continue */ }
```
or, worse, an error that is *returned as data* (not thrown) and then treated as an empty success:
```
const r = await call();        // r.error is set, r.content is null
const parsed = parse(r.content || '');   // parse('') -> null
if (!parsed) return;           // recorded as "0 findings" — a 404 now reads as "clean"
```

**A failure must be observable as a failure** — throw, or return an explicit `status: 'failed'` / error field that the caller, a heartbeat, or a probe can see. "0 results" and "the operation failed" must never be the same value.

## The three instances (one day, 2026-08-02)
1. **`autonomous-source-health-manager`** — queried non-existent columns (`source_type`/`is_active`); `sourcesError` was logged, not thrown, so it "healed" **0 sources for ~8 months** (~1,490 no-op runs) and looked healthy. (WO-SOURCE-HEALTH-MANAGER-BROKEN-01)
2. **Undispatched-alerts watchdog probe** — a PostgREST **1000-row cap** was read back as if it were the true count; the cap value was reported as data, masking the real magnitude. (watchdog probe fix)
3. **WRAITH vuln scan** — `callAiGateway` returned a **model 404** in `aiResult.error` (not thrown); `content` was null → `parseWraithJSON('')` → null → **0 findings recorded as a clean scan** for months. A dead security scanner reported "no vulnerabilities." (WO-WRAITH-VULN-SCAN-DEAD-01)

All three share one signature: **an error was caught (or returned-as-data) and converted into a plausible empty/default result.** None threw. None were visible. Each ran broken until someone manually looked.

## Enforcement
1. **Throw or flag — never swallow into a default.** If an operation can fail, the failure path must produce an observable failure (throw, non-200, `status:'failed'`, a finding), not a value that looks like a successful empty result.
2. **Returned errors are errors.** If a helper returns `{ content, error }` (not throwing), the caller MUST check `error`/null-content and fail — treating `content || ''` as empty success is the trap.
3. **Distinguish "zero" from "didn't run."** Any count/result that could be a cap, a timeout, or an error must carry that state (denominator, `partial`/`failed` status, cap-hit flag). See also the denominator doctrine.
4. **Standing audit — WO-FAIL-LOUD-AUDIT-01:** sweep the codebase for the shape *"error caught (or returned) → default/empty returned."* Priority targets: every `catch` that returns `[]`/`0`/`null`/`continue` without re-surfacing; every `callAiGateway`/RPC/fetch caller that uses the result without checking `.error`/null. Suspected next instance: **`analyze_signal_threat_dna`** writes to `wraith_signal_threat_scores` (840 rows) using `claude-haiku-4-5-20251001`, which is **also not in the gateway's model map** — likely 404ing and recording default scores (same shape, unverified). Audit it first.

## Relationship to existing doctrine
This is the mechanical twin of the operator-attention / no-silent-caps principles ("a muted alert is operationally equivalent to one never sent") applied at the **code** layer: a swallowed error is a muted failure. It is also the failure mode the measurability-is-part-of-the-feature gate is meant to catch — an outcome that isn't observable-as-failure will be assumed successful.
