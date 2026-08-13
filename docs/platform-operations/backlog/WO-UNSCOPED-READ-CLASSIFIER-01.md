# WO-UNSCOPED-READ-CLASSIFIER-01 — Classify unscoped shared reads before gating

**Status:** LOGGED, not started. Awaiting operator prioritization.
**Class:** the count has no meaning without a classifier — a raw candidate list is not a gate.
**Provenance:** prompt-hygiene check (report-leak order, 2026-08-13). Detector 2 flags `.from(<tenant/client table>)` reads with no `tenant_id`/`client_id` filter, in prompt-bearing/client-facing edge functions. First run: **341 candidates** over a 16-line-window heuristic — dominated by false positives (id-list fetches like `resolvers.ts:33 .in("id", signalIds)`, point-lookups, service-role internal tools like `voice-tool-core`). Detector 2 is **audit-only** in the script and never affects CI exit; it stays that way until this WO runs.

## Why not gate now
Ruled by the operator: "341 candidates with no classifier is not a gate. Do not wire it into CI in any form until the count means something." Same lesson as the Q2 incident/signal sweep — a raw regex sweep is a triage input, not a defect list.

## Scope — apply the Q2 classifier pattern
Classify every Detector-2 candidate as:
- **FP:** write, count-only, id-list fetch (`.in('id', ...)`), or point-lookup (`.eq('id'/'signal_id', ...).single()`).
- **Guarded-outside-window:** scoped by `tenant_id`/`client_id` beyond the 16-line window, or via a shared helper.
- **Service-role internal:** a trusted internal tool that legitimately reads broadly (annotate, like the quarantine `@qa-allow` operator surfaces).
- **Real defect:** an unscoped read that reaches a prompt or client-facing answer. Rank by client-facing reachability (the Q2 rubric).

## Acceptance criterion (single)
A classified list with the count of REAL defects only, ranked by reach. Only then may Detector 2 be promoted from audit-only to blocking (and only for the real-defect class). The classifier logic can then be folded back into `scripts/check-prompt-hygiene.mjs` so Detector 2's printed count reflects defects, not raw candidates.

## Related
- `scripts/check-prompt-hygiene.mjs` Detector 2 (the audit source).
- Q2 sweep classifier (the pattern to reuse) · `excludeTestAndDeleted` (the Q2 fix).
- INC-CTX-CONTAM §4 amendment + WO-FORENSIC-SURFACE-COMPLETENESS-01 ("carries no tenant facts" is a claim requiring proof) — the doctrine this detector enforces once it can distinguish a real unscoped read from noise.
