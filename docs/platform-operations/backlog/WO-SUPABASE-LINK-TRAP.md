# WO-SUPABASE-LINK-TRAP — a bare deploy silently targets the wrong project (2026-09-09)

**Status:** LOGGED / report-only. Do not fix. This document is the finding; the remediation choice (relink / wrapper / guard) is to be decided, not built.

## The trap

The local Supabase CLI link (`supabase/.temp/project-ref`) points at **staging `lkvyrvuakzguszbpwnfz`**, while this repo's prod project is **`kpuqukppbmwebiptqmog`** (`config.toml` `project_id` = prod). A CLI command that omits `--project-ref` uses the **linked** project — so a bare:

```
supabase functions deploy <name>
```

deploys to **staging**, not prod, while *looking* like a prod deploy and reporting success. Same hazard for any link-driven CLI verb (`db push`, `functions deploy`, `secrets set`, `migration up`), though `db push` is already separately prohibited (WO-LEDGER-RECONCILE / Migration-Apply Prohibition).

## Evidence (2026-09-09)

During the WO-ENTITY-MENTION-CONTAMINATION redeploy of `review-signal-agent`:
- `cat supabase/.temp/project-ref` → `lkvyrvuakzguszbpwnfz` (staging).
- `config.toml:1` → `project_id = "kpuqukppbmwebiptqmog"` (prod).
- The two disagree. A bare `functions deploy review-signal-agent` would have shipped the seam fix to **staging** and left the prod live-defect (contaminated mention counts) in place — while the deploy log said "Deployed."
- Caught only because the deploy was issued with an explicit `--project-ref kpuqukppbmwebiptqmog` (per the standing "explicit --project-ref" discipline in memory: *verify_jwt deploy flag is per-function*). The catch was discipline, not a guardrail — the next operator without that habit ships to the wrong project.

## Blast radius

- **Silent wrong-target deploy:** prod fix lands on staging; prod stays broken; the green deploy log manufactures false confidence. This is the exact false-pass shape Population-Before-Check / Deployed-Not-Committed exist to kill, one layer up (wrong *project*, not wrong *bundle*).
- **Cross-project confusion twin:** compounds the known `feedback_env_specific_ids_no_cross_project` hazard (UUIDs are per-project). A staging deploy of prod-derived config is a parity/DR gap.
- **Not limited to deploys:** any link-driven verb inherits the trap.

## Candidate remediations (evaluate later — DO NOT build now)

1. **Relink to prod** — `supabase link --project-ref kpuqukppbmwebiptqmog`. Simplest; makes the bare command correct-by-default. Risk: flips the default the *other* way — a bare command intended for staging now hits prod (arguably worse; prod-by-default is a different loaded gun). Staging work would then always need `--project-ref`.
2. **Wrapper script** — `scripts/deploy-fn.sh <name> [prod|staging]` that requires an explicit target and refuses to run bare; all deploys go through it. Removes the default entirely (no silent target). Cost: discipline to always use the wrapper; a bare `supabase` call still bypasses it.
3. **Pre-deploy guard / hook** — a check that compares the linked `project-ref` against an explicitly-stated intended target (env var or arg) and fails loud on mismatch (same shape as `check-staging-load-fixture.mjs`). Catches the mismatch mechanically regardless of habit. Cost: only fires if wired into the deploy path.

**Recommendation to decide between:** (2)+(3) together — a wrapper that names the target AND a guard that fails on link/intent mismatch — most closely matches the "no silent default; fail loud on ambiguity" doctrine. (1) alone just relocates the loaded gun.

## Companion doctrines
Deployed-Not-Committed / Merged-And-Running (running-state + branch truth — this adds *right-project* truth), `feedback_env_specific_ids_no_cross_project`, `reference_supabase_project_refs` (prod `kpuqukppbmwebiptqmog` / staging `lkvyrvuakzguszbpwnfz`). Sibling of the "prefer direct probe over proxy" discipline: a green deploy log is a proxy; the served prod artifact is ground truth.
