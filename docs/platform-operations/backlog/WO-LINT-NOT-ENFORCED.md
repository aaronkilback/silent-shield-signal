# WO-LINT-NOT-ENFORCED — a three-month production crash shipped past a linter that saw it

**Status:** OPEN — report only, later (do NOT mass-fix warnings). Headline finding, not a footnote.

## What happened
`no-use-before-define` would have caught the `monitoring_proposals` TDZ (`Cannot access 'clientIds'
before initialization`, `MonitoringProposals.fetchProposals`) **at commit time in June 2026** (`c83d38965`,
2026-06-07). It didn't, because CI runs ESLint with **`--max-warnings 999`** (`.github/workflows/ci.yml`
job `lint`: `npx eslint src/ --max-warnings 999`), so warnings never fail the build. **A ~3-month
production crash shipped past a linter that saw it** — `MonitoringProposals` threw on every load from June
until the false-zero deploy (2026-08-31 / shipped 2026-09-07) made the crash visible.

## The pattern — the THIRD gate this week that exists and does not enforce
1. **Playwright E2E** never ran on the deploy path (`pull_request`-only; deploys shipped with E2E skipped) —
   `WO-E2E-DEPLOY-GATE-EVIDENCE`.
2. **security-gate ratchet** runs **red on main and blocks nothing** (main unprotected + direct-push;
   +124 over baseline) — `WO-SECURITY-GATE-RED-BURNDOWN`.
3. **ESLint** warns into a void (`--max-warnings 999`) — this WO.

A gate that runs but cannot fail is theater. Same class across all three: the control exists, the
enforcement doesn't. (Enforcement for 1 & 3 both ultimately need main to stop accepting un-gated direct
pushes — see `WO-E2E-BRANCH-PROTECTION-DECISION`.)

## Report to produce (later, report only)
1. **How many warnings does `npx eslint src/` currently emit**, in total.
2. **Which rules** produce them (count per rule), so the high-signal ones (`no-use-before-define`,
   `no-undef`, exhaustive-deps, etc.) are visible separately from stylistic noise.
3. **What it would take to ratchet `--max-warnings` DOWN** rather than fixing everything at once.

## Do NOT propose fixing all warnings
The pattern that works here is the **ratchet**, same shape as the security-gate baseline, done properly
this time: **freeze the current warning count as the ceiling, refuse any increase, burn down over time.**
- Set `--max-warnings <current_count>` (not 0, not 999). Any new warning pushes over the ceiling → build
  fails → the author fixes their own new warning. The count only ever decreases.
- Optionally split: promote the highest-signal correctness rules (e.g. `no-use-before-define`) to `error`
  immediately (small, bounded fix set) while the long tail stays under the ratchet.
- Lesson carried from `WO-SECURITY-GATE-RED-BURNDOWN`: never regenerate/raise the ceiling to make red go
  green; the ceiling is a promise that only tightens.

## Cross-refs
`WO-EMPTY-STATE-LINT` (the lint that would flag list surfaces not using `AsyncListState`),
`WO-SECURITY-GATE-RED-BURNDOWN`, `WO-E2E-DEPLOY-GATE-EVIDENCE`, `WO-E2E-BRANCH-PROTECTION-DECISION`.
Trigger: the `MonitoringProposals` TDZ (fixed 2026-09-07, rename local `clientIds` → `proposalClientIds`).
