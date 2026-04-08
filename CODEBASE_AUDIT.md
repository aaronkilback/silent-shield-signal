# Codebase Audit — Aegis Source Access

Aegis can read the live source code of deployed Edge Functions and shared modules before making recommendations. This prevents hallucinated suggestions about code that doesn't match the actual implementation.

---

## How it works

1. A local sync script (`scripts/sync-codebase-snapshot.ts`) reads all Edge Function source files, shared modules, config files, and key docs from disk and upserts them into the `codebase_snapshot` Supabase table.
2. The Aegis system prompt instructs it to call `list_source_files` before making architectural or pipeline recommendations.
3. Aegis calls `get_source_file` to read specific files when it needs to audit the implementation.

---

## Syncing the snapshot

Run this after deploying new or modified Edge Functions:

```bash
node scripts/sync-codebase-snapshot.mjs
```

Prerequisites: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set in `.env` (auto-loaded) or the environment. Requires Node 18+.

**What gets synced:**
- `supabase/functions/*/index.ts` — all Edge Functions (tagged `edge_function`)
- `supabase/functions/_shared/*.ts` — all shared modules (tagged `shared`)
- `supabase/config.toml` — Supabase config (tagged `config`)
- `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `CRITICAL_WORKFLOWS.md`, `CODEBASE_AUDIT.md`, `README.md` — docs (tagged `doc`)

The script also prunes stale entries for files that no longer exist on disk.

---

## Aegis tools

| Tool | Description |
|------|-------------|
| `list_source_files` | Returns a manifest of all files (path, type, size, updated_at) — no content |
| `get_source_file` | Returns the full source of a specific file by `file_path` |

Aegis will call these autonomously before making recommendations. You can also ask it directly:

> "Audit the monitor-news function before suggesting changes."
> "Read ingest-signal and explain how deduplication works."
> "List all shared modules and tell me which ones handle AI calls."

---

## Database table

```sql
codebase_snapshot (
  id            uuid primary key,
  file_path     text unique,      -- e.g. 'supabase/functions/ingest-signal/index.ts'
  file_type     text,             -- 'edge_function' | 'shared' | 'config' | 'doc'
  function_name text,             -- Edge Function name if applicable
  content       text,             -- full source
  byte_size     integer,          -- computed from content
  updated_at    timestamptz
)
```

Row-level security is enabled; only the service role can read/write.

---

## Keeping it current

The snapshot is a point-in-time mirror — it does not auto-update. Run the sync script whenever you:
- Deploy new Edge Functions
- Modify existing functions
- Add or change shared modules
- Update key documentation

A good practice is to run the sync as part of your deploy workflow:

```bash
# Deploy functions
npx supabase functions deploy <function-name> --project-ref kpuqukppbmwebiptqmog

# Sync snapshot so Aegis sees the change
node scripts/sync-codebase-snapshot.mjs
```
