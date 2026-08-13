# WO-PROMPT-ROSTER-01 — Static client roster in shared prompt (INC-CTX-CONTAM Class C)

**Status:** CLOSED 2026-08-12 (operator: "WO-PROMPT-ROSTER-01 closes on it" — the bundle proof).
**Class:** live cross-tenant disclosure on the chat path.

## Problem
`_shared/fortress-operational-prompt.ts` (`FORTRESS_PLATFORM_OVERVIEW`, always-on system prompt for `dashboard-ai-assistant`) hardcoded an `ACTIVE CLIENTS` roster naming **Petronas Canada (PECL)** and **BC Children's Hospital Gender Clinic (BCCH)**, shipped 2026-05-03 (`a2295744`). Every dashboard-ai-assistant session for every tenant carried both clients' identities. Exposure: ~1,823 turns across 4 tenant groups; one external cross-tenant tenant (Critical Risk Team — neither PECL nor BCCH); still live until fix. This is the definitive root cause of INC-CTX-CONTAM (record §9 corrected — Class B parametric attribution withdrawn). #5 (companion): `client-mandate.ts:38` AFFILIATED-INFORM verb hardcoded `PECL-operated assets`, injected into every client's exec brief via `renderMandateGuidance`.

## Fix (shipped, commit `5ac1a272`)
- Removed the static roster from `FORTRESS_PLATFORM_OVERVIEW`; `dashboard-ai-assistant` now builds a per-session `THIS TENANT'S CLIENTS` block from the tenant's own client rows (tenant-scoped, non-inactive, `_`-prefixed dropped). No tenant / no clients → empty; never a fallback naming another tenant's clients.
- #5: verb neutralized to `assess indirect impact on the client's own operated assets`.

## Acceptance evidence (bundle proof — load-bearing)
`dashboard-ai-assistant` **v238**, deployed 2026-08-12T20:41:32Z. Deployed bundle: **0** `Petronas Canada (PECL) — energy/LNG` roster lines, **0** `BC Children's Hospital Gender Clinic`, **1** `THIS TENANT'S CLIENTS` dynamic block, **0** `PECL-operated assets`. Per-tenant blocks computed from live client rows: Critical Risk Team → `BC Place` only (no PECL, no BCCH); Silent Shield Operations → its own clients only. `generate-executive-report` redeployed for #5.

**Live flight-recorder verification was inconclusive (not a failure):** the recorder truncates stored fields at 16 KB and the roster region is past the cap, so the tail was never stored → separate order [[WO-RECORDER-TRUNCATION-01]]. Closed on the deployed-bundle proof, which governs every session rather than one sample.

## Out of scope (parked, tracked elsewhere)
Report-leak order (#2–#4, #6–#11 — hardcoded PECL/LNG examples in other generation prompts); the client-proper-noun CI check (audit-then-blocking, denylist seeded from the sweep, tests/fixtures/wildfire excluded); wildfire product allowlisted as Petronas-exclusive by design.
