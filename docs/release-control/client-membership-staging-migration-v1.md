# Client Membership Substrate Staging Migration Control Packet

This packet prepares one future staging-only migration application:

`supabase/migrations/20260701090000_client_membership_substrate_v1.sql`

It does not apply the migration, create credentials, change GitHub settings, deploy code, or contact Supabase by itself.

## Target Identity

The staging target is source-controlled in `docs/PROD_BASELINE.md`:

- Environment: `staging`
- Project name: `fortress-staging`
- Project ref: `lkvyrvuakzguszbpwnfz`

Production project ref `kpuqukppbmwebiptqmog` is explicitly disallowed.

## Source-Controlled Manifest

Manifest:

`release-control/staging-db/client-membership-substrate-v1.manifest.json`

The manifest binds:

- fixed staging project ref;
- exact migration path;
- exact migration version;
- exact migration SHA-256;
- expected preflight state: the migration is absent remotely and exactly one local migration is pending;
- only permitted mutation command: `supabase migration up --linked`.

## Runner

Runner:

`scripts/release-control/staging-migration-control.mjs`

Commands:

```bash
node scripts/release-control/staging-migration-control.mjs validate
node scripts/release-control/staging-migration-control.mjs preflight
node scripts/release-control/staging-migration-control.mjs apply <reviewed-preflight-receipt-path>
```

The runner fails closed unless:

1. The manifest target is the exact staging project ref.
2. The migration file exists and its SHA-256 matches the manifest.
3. Supabase CLI linked project state is exactly `lkvyrvuakzguszbpwnfz`.
4. Remote migration history shows the target migration absent before apply.
5. Local-versus-remote history shows exactly one pending migration, `20260701090000`.
6. The only mutation command executed is `supabase migration up --linked`.
7. `preflight` writes a local JSON preflight receipt under `release-control/staging-db/receipts/`.
8. The remote migration-history read is supervised with a fixed `60000` ms primary deadline and a fixed grace period.
9. `preflight` writes a `staging_migration_preflight_attempt` receipt on success and failure.
10. On timeout, the runner requests termination, escalates once after the grace period, and returns a failed preflight-attempt receipt without waiting forever for child close.
11. Timeout receipts distinguish termination confirmed from termination unconfirmed. They do not claim that the external process was successfully terminated unless close was observed.
12. Migration-history stdout and stderr capture is capped at `65536` bytes per stream. Output beyond that cap is not retained.
13. If stdout or stderr exceeds the cap, the runner fails closed, requests termination, and writes a failed preflight-attempt receipt before any migration-history parsing or apply path.
14. Timeout, output-limit overflow, non-zero exit, signal interruption, or unrecognized migration-history output records only safe command metadata: operation, timeout, attempted signals, termination confirmation, output-limit state, exit status, signal, and capped stdout/stderr presence, length, and truncation state.
15. `apply` is given the reviewed preflight receipt path and re-runs preflight before mutation.
16. Current source commit, clean-worktree proof, manifest hash, migration hash, target ref, and remote preflight history must match the reviewed preflight receipt.
17. After apply, remote version-state includes `20260701090000` and no unexpected migration version moved.
18. Every apply attempt writes a local JSON apply-attempt receipt, including failed attempts and any available before/after history.

Remote migration history proves version-state only. The manifest proves reviewed local file-byte binding only. This packet does not prove remote historical SQL byte equivalence, full schema equivalence, or live data integrity.

## Migration History Input Contract

The runner accepts only this explicit remote-history JSON structure from `supabase migration list --linked --output json`:

```json
{
  "local_versions": ["20260701090000"],
  "remote_versions": []
}
```

Unknown, ambiguous, filename-based, row-based, or generic `version` / `name` output blocks before mutation. The runner does not infer a safe state from unrecognized CLI output.

## Future Approval Gates

Before any staging apply, Aaron must explicitly approve:

1. Use of the staging-only Supabase CLI session linked to `lkvyrvuakzguszbpwnfz`.
2. Running `preflight` against staging.
3. Reviewing the generated preflight receipt.
4. Running `apply <reviewed-preflight-receipt-path>` only if preflight proves exactly one expected pending migration.
5. Capturing and reviewing the generated apply-attempt receipt.

No production approval is implied. Production remains disallowed by this packet.

## Prohibited Paths

This packet does not permit:

- `supabase db push`;
- `supabase db query --file`;
- raw SQL-file execution;
- `supabase migration repair`;
- manual migration-history edits;
- GitHub Actions execution on `push`;
- deployment or Edge Function changes.
