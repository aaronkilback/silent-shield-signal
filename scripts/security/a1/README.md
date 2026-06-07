# A1 — Tier-1 Retrieval-Boundary Guard Pack (warn-only)

Prevents the highest-frequency cross-tenant retrieval regressions from reaching prod.
Deterministic, sub-minute, no LLMs / no realtime / no fixtures.

## Checks
| ID | Name | Modality | Catches |
|----|------|----------|---------|
| A1.1 | null-tenant invariant | DB (read-only) | broken derive-trigger / writer that forgot to stamp `tenant_id` |
| A1.2 | service-role + request-id gate | static | new edge fn using service-role + a request id with no caller gate (generate-poi-report class) |
| A1.5 | verify_jwt drift | static | `verify_jwt` flipping vs the declared allowlist |
| A1.6 | retrieval RPC purity | DB (read-only) | `match_*` / `find_similar*` (and SECURITY DEFINER) RPCs losing the fail-closed tenant predicate |

## Run locally
```bash
# static checks only (no DB):
node scripts/security/a1/run.mjs

# include DB checks (read-only role):
STAGING_DB_URL_RO='postgresql://readonly:…@db.lkvyrvuakzguszbpwnfz.supabase.co:5432/postgres' \
PROD_DB_URL_RO='postgresql://readonly:…@db.kpuqukppbmwebiptqmog.supabase.co:5432/postgres' \
node scripts/security/a1/run.mjs

# gate mode (CI later):
node scripts/security/a1/run.mjs --enforce   # exit 1 on blocking findings
```

## Escape hatch
- Inline: `// @tenant-safe: <reason>` in the offending file.
- Or add a reviewed entry to `security/a1-allowlist.json` / `security/verify-jwt-allowlist.json`.
Every exception must carry a reason; prefer fixing over allowlisting.

## CI
`.github/workflows/a1-guard.yml` runs on every PR + push to `main`, **warn-only**
(job stays green, posts findings, uploads `a1-report.json`). Requires repo secrets
`STAGING_DB_URL_RO` / `PROD_DB_URL_RO` (read-only) for A1.1/A1.6; static checks run without them.

## Day-1 baseline → enforcement
1. Land warn-only. Run it; triage every finding to a fix or a reasoned allowlist entry until the baseline is clean.
2. Populate `security/verify-jwt-allowlist.json` from the real `config.toml` (resolve all A1.5 WARNs).
3. Add inject-bad canaries; confirm each check catches them.
4. Flip to a gate by adding `--enforce` to the workflow run step.
