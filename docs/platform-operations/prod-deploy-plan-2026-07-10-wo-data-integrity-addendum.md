# Prod Deploy Plan — WO-DATA-INTEGRITY Addendum + Controlled Frontend Unfreeze

**Date:** 2026-07-10
**Release type:** Controlled — one governed pass. Not a hotfix.
**Ships together:** A (DB trigger) + B (edge fn tenant-enum) + Silent-context fix (frontend) + 5 frozen-queue frontend commits.
**Merged SHA:** to be captured after PR merge (`origin/main` HEAD post-merge).
**Prior prod state (rollback baseline):**
- Worker version: `8693a651-0374-4d7a-9a19-8c16a80d28a8` (deployed 2026-07-08T17:08:41Z)
- Main bundle: `main-Dux10mCG.js`
- Edge fn `dashboard-ai-assistant`: version prior to this release (capture at Phase 2 start)
- DB: no `enforce_ai_chat_archival_client_scope` trigger

**Staging evidence backing this release (four-for-four PASS at the glass):**
1. Original guard toast — witnessed in Test 1
2. Silent-context guard toast — witnessed in incognito retest
3. Ambiguous AEGIS org prompt with only real tenants — witnessed after temp CRT membership (rolled back cleanly)
4. Deliberate client select → upload succeeds (trigger carve-out) — witnessed

**Test that cannot be exercised on prod (deliberate limitation):**
- Ambiguous-org branch. Operator's prod identity has a single tenant membership, so the code takes the auto-pick branch, not the ambiguous branch. **Staging's temp-membership evidence stands in for this validation.** Do not skip this note in the ledger — it's the reason the prod rule-3 pass has 2 tests instead of 3.

**Recording this release as WO-PRR lane-shape template:** the sequence below is a working example of a governed prod release under current frozen-lane conditions (manual, CLI-direct, worktree-isolated, evidence-recorded per phase). Fold into WO-PRR when the lane-shape decision is made — this or something structurally equivalent is what the future automated lane should reproduce.

---

## Preconditions checklist (all must be ✅ before Phase 1)

- [ ] PR merged to `main` via GitHub UI, merge SHA captured
- [ ] `git fetch origin main` from operator's machine — confirm HEAD advances to the merge SHA
- [ ] Prod Supabase auth verified (`supabase projects list` shows Fortress `kpuqukppbmwebiptqmog` reachable)
- [ ] Wrangler auth verified (`wrangler deployments list --name silent-shield-signal | head -3` returns current v8693a651)
- [ ] Operator has hard-refreshable browser session ready for rule-3 pass

## Phase 1 — Apply migration A to prod DB

**What:** create `enforce_ai_chat_archival_client_scope` function + BEFORE INSERT trigger on `archival_documents`.
**Where:** prod Supabase SQL editor (`kpuqukppbmwebiptqmog`).
**Mechanism:** paste migration content directly. Same idempotent shape used on staging (verified working there).

**SQL to paste:**

```sql
CREATE OR REPLACE FUNCTION enforce_ai_chat_archival_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS NULL
     AND (
       COALESCE(NEW.metadata->>'source', '') = 'ai-chat'
       OR NEW.tags @> ARRAY['ai-chat-upload']::text[]
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'AI-chat archival uploads must be client-scoped (client_id required)',
      DETAIL  = format(
        'WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE | metadata_source=%L | tags=%L | uploaded_by=%L',
        NEW.metadata->>'source', NEW.tags, NEW.uploaded_by
      ),
      HINT    = 'Select a client in the AEGIS chat before uploading, or route non-client-scoped reference docs through create-archival-record with explicit user-owned intent (no ai-chat tag/source).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ai_chat_archival_client_scope ON archival_documents;
CREATE TRIGGER trg_enforce_ai_chat_archival_client_scope
  BEFORE INSERT ON archival_documents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_chat_archival_client_scope();

COMMENT ON FUNCTION enforce_ai_chat_archival_client_scope() IS
  'WO-DATA-INTEGRITY addendum 2026-07-10: server-side backstop preventing NULL-client archival inserts on the AI-chat path (source=ai-chat or tag=ai-chat-upload). Complements the frontend guard in DashboardAIAssistant.tsx and the DB provenance CHECK. Rejects with check_violation. Enforcement token: WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE.';

SELECT
  proname AS function_name,
  tgname AS trigger_name,
  tgenabled AS trigger_enabled
FROM pg_proc p
JOIN pg_trigger t ON t.tgfoid = p.oid
WHERE p.proname = 'enforce_ai_chat_archival_client_scope';
```

**Expected verification row:**
```
function_name                          | trigger_name                              | trigger_enabled
enforce_ai_chat_archival_client_scope  | trg_enforce_ai_chat_archival_client_scope | O
```

**Rollback (if needed):**
```sql
DROP TRIGGER IF EXISTS trg_enforce_ai_chat_archival_client_scope ON archival_documents;
DROP FUNCTION IF EXISTS enforce_ai_chat_archival_client_scope();
```

## Phase 2 — Deploy edge function B to prod

**What:** ship the tenant-enum `is_test` filter in `dashboard-ai-assistant`.
**Where:** prod Supabase project `kpuqukppbmwebiptqmog`.
**Mechanism:** CLI-direct from clean detached worktree at merged SHA. Same pattern the WO-DATA-INTEGRITY series has used all week.

```bash
# Substitute MERGED_SHA with the merge commit SHA captured in preconditions
MERGED_SHA=<merge_sha>

git worktree add /tmp/ss-prod-fn-${MERGED_SHA} --detach ${MERGED_SHA}
cd /tmp/ss-prod-fn-${MERGED_SHA}

# Capture BEFORE version for rollback baseline
supabase functions list --project-ref kpuqukppbmwebiptqmog 2>&1 | grep dashboard-ai-assistant

# Deploy
supabase functions deploy dashboard-ai-assistant \
  --project-ref kpuqukppbmwebiptqmog \
  --no-verify-jwt \
  --use-api
```

**Post-deploy verify:** re-run `supabase functions list` — version number should increment.
**Content-marker verify:** the deployed bundle should contain `tenants.is_test` in the source. Use `get_edge_function` via Supabase Management API if MCP is functional; otherwise skip content-marker verify and rely on runtime rule-3 test (Test 2 substitute — see Phase 5).

**Rollback:** deploy previous version by CLI from a worktree at the pre-merge SHA (any prior main HEAD works).

## Phase 3 — Deploy frontend Worker to prod

**What:** ship silent-context fix + 5 unshipped frontend commits (#116 auth-gated env badge, #125 env badge residual, #127 env badge from VITE_SUPABASE_URL, #132 upload UI required-client, #135 AI-chat client-scope guard).
**Where:** prod Cloudflare Worker `silent-shield-signal` (route `fortress.silentshieldsecurity.com/*`).
**Mechanism:** `wrangler deploy` from clean detached worktree at merged SHA. `wrangler.toml` is the source of truth for the Worker config.

```bash
MERGED_SHA=<merge_sha>

# Reuse the same worktree from Phase 2, or create fresh
cd /tmp/ss-prod-fn-${MERGED_SHA}   # OR: git worktree add /tmp/ss-prod-frontend-${MERGED_SHA} --detach ${MERGED_SHA} && cd $_

npm ci --no-audit --no-fund
npm run build

# Capture BEFORE Worker version for rollback baseline
wrangler deployments list --name silent-shield-signal | head -14

wrangler deploy
```

**Post-deploy: capture AFTER Worker version:**
```bash
wrangler deployments list --name silent-shield-signal | head -8
```

**Rollback:**
```bash
wrangler rollback --name silent-shield-signal --version-id 8693a651-0374-4d7a-9a19-8c16a80d28a8
```
(That's the current prod version being replaced. Rolling back reverts to today-pre-release state — the same bundle that let dab4a5fb + 75fd5b9e land as orphans.)

## Phase 4 — Bundle verification via grep

**What:** confirm the served prod bundle contains the release's markers. All markers were **0** in the pre-release prod bundle (`main-Dux10mCG.js`); all should be **nonzero** post-release.

```bash
# 1. Get new bundle URL
NEW_MAIN=$(curl -sL "https://fortress.silentshieldsecurity.com/" | grep -oE 'assets/main-[A-Za-z0-9_-]+\.js' | head -1)
echo "prod main bundle: $NEW_MAIN"
[ "$NEW_MAIN" != "assets/main-Dux10mCG.js" ] && echo "✓ hash changed" || echo "✗ hash UNCHANGED — deploy did not ship new content"

# 2. Fetch main bundle
curl -sL "https://fortress.silentshieldsecurity.com/$NEW_MAIN" -o /tmp/prod-main-post-release.js
echo "main bytes: $(wc -c < /tmp/prod-main-post-release.js)"

# 3. Fetch Index chunk (the AEGIS route bundle where DashboardAIAssistant is code-split)
INDEX_CHUNK=$(grep -oE '"assets/Index-[a-zA-Z0-9_-]+\.js"' /tmp/prod-main-post-release.js | head -1 | tr -d '"')
echo "prod Index chunk: $INDEX_CHUNK"
curl -sL "https://fortress.silentshieldsecurity.com/$INDEX_CHUNK" -o /tmp/prod-index-post-release.js
echo "Index bytes: $(wc -c < /tmp/prod-index-post-release.js)"

# 4. Grep the four release markers — all were 0 pre-release
echo ""
echo "=== Release markers on PROD (all 0 pre-release, expect all nonzero now) ==="
echo "GUARD  'Select a client for the assistant':                          $(grep -c 'Select a client for the assistant' /tmp/prod-index-post-release.js)"
echo "SILENT 'No active tenant context. Open the Client Filter':           $(grep -c 'No active tenant context. Open the Client Filter' /tmp/prod-index-post-release.js)"
echo "UPLOAD 'Select a client before uploading':                           $(grep -rc 'Select a client before uploading' /tmp/prod-*post-release.js /tmp/prod-chunks-post-release/ 2>/dev/null | awk -F: '{s+=$2}END{print s}')"
echo "ai-chat-upload tag (should be 1 in Index chunk):                     $(grep -c 'ai-chat-upload' /tmp/prod-index-post-release.js)"
```

**Pass criteria:**
- Main bundle hash CHANGED from `main-Dux10mCG.js`
- GUARD ≥ 1
- SILENT ≥ 1
- ai-chat-upload = 1 (Index chunk)
- UPLOAD marker ≥ 1 (may be in a separate ArchivalDocumentUpload chunk — sweep-check if not in Index)

**Fail path:** if any pass criterion fails, execute Phase 3 rollback (`wrangler rollback`) and diagnose before re-attempting.

## Phase 5 — Rule-3 prod pass (operator, hard-refreshed)

**Two tests on prod. Ambiguous-org branch DELIBERATELY SKIPPED — see next line.**

**IMPORTANT SUBSTITUTION NOTE:** operator's prod identity has single tenant membership → ambiguous-org branch cannot fire on prod without engineering a temp membership, which would carry customer-tenant blast radius that we deliberately want to avoid. **Staging temp-membership evidence stands in for this validation** — staging showed the disambiguation prompt listed exactly two real tenants with no test/legacy/smoke entries. Ledger this substitution explicitly under Phase E.

### Prod Test 1 — silent-context guard at the glass
1. Hard-refresh browser at `fortress.silentshieldsecurity.com` (Cmd-Shift-R) OR open incognito.
2. Log in as operator.
3. Do NOT navigate to Signals or pick a client. Confirm banner shows "No active context. Select a tenant to begin."
4. Attempt to attach a PDF → send.
5. **Expected toast (verbatim):** "No active tenant context. Open the Client Filter (Signals page) and select a client before uploading."
6. Screenshot for the ledger.

### Prod Test 2 — success path (deliberate client select)
1. Navigate to Signals page → Client Filter → deliberately select a real client (Petronas Canada or equivalent).
2. Return to AEGIS chat.
3. Attach a PDF → send.
4. **Expected:** upload succeeds, doc lands under selected client. Verify via SQL:
```sql
SELECT id, client_id, uploaded_by, tags, metadata->>'source' AS metadata_source, created_at
  FROM archival_documents
 WHERE uploaded_by = <operator's prod uuid>
 ORDER BY created_at DESC
 LIMIT 3;
```
5. Confirm the row has `client_id` = the deliberately-selected client.

**Fail path:** if either test fails, execute Phase 3 rollback and diagnose.

## Phase 6 — Fixture disposition (C step)

**What:** flag the two prod orphans that triggered this addendum as fixtures. Rows retained (no delete), tagged so future audits distinguish them from real Petronas uploads.

```sql
UPDATE public.archival_documents
   SET tags = array_append(tags, 'wo-data-integrity-addendum-fixture-2026-07-10')
 WHERE id IN (
   'dab4a5fb-cc4a-4ab2-84da-369c65a635fe',
   '75fd5b9e-c3b7-4211-98ac-2fc67899cec3'
 )
   AND NOT (tags @> ARRAY['wo-data-integrity-addendum-fixture-2026-07-10']::text[])
RETURNING id, client_id, tags;
```

**Expected:** 2 rows returned. `client_id` remains NULL. `tags` now includes the fixture marker. Both rows stand as preserved evidence of the pre-release bleed.

## Phase 7 — Doctrine (D step) — already applied

The rule-3 browser-check doctrine and enforcement-token convention are already saved to memory:
- `feedback_env_specific_ids_no_cross_project.md`
- `project_silent_context_defect.md`
- `reference_fortress_frontend_worker_deploy.md`

No prod action here — completed in-flight during the addendum work. Ledger step E will formalize as durable text.

## Phase 8 — Ledger + branch swap (E step)

**What:** the durable record. Comprehensive block covering every finding, cross-linked, permanently in `ops/ledger/WORK-ORDERS.md`.

Contents (drafted; final prose written after prod pass):

1. **WO-DATA-INTEGRITY addendum — CLOSED (2026-07-10):** the three findings + their fixes:
   - A (DB trigger): shipped, enforcement-token convention established
   - B (tenant-enum second site): shipped, verified in staging ambiguous-org branch
   - Silent-context defect: elevated out of backlog, minimal fix shipped, three follow-ons ledgered

2. **Staging evidence — four-for-four at the glass:** original guard, silent-context guard, ambiguous-org (temp-membership), success-with-client. Screenshots archived in the release doc.

3. **Prod evidence — two-for-two at the glass** (with explicit note on ambiguous-org substitution — staging temp-membership evidence stands in for prod's single-scope identity).

4. **Meta-findings (WO-PRR scope):**
   - Three delivery lanes uniformly disabled: `deploy-frontend.yml` (preflight-only), `deploy-frontend-staging.yml` (was disabled in UI, re-enabled during this addendum, worked when triggered), `deploy-functions.yml` (dead pipeline). Add `loop-diagnostics.yml` disabled — noted.
   - Frozen frontend queue cost: 5 merged frontend PRs (#116, #125, #127, #132, #135) never shipped to users for ~54 hours before this addendum forced the unfreeze. Concrete cost line documented.
   - Staging schema drift: migrations #137 + #138 landed on prod all week without symmetric staging application; nearly produced a false-negative on B's validation.
   - Cross-database identity discipline: prod UUID `5f48f826` was accidentally used in a staging INSERT plan; caught by operator before running. Doctrine saved.
   - Name-heuristic escapee count: **6 documented iterations** (`__platform_security__`, `_invariant_*`, `_dryrun_crt_smoketenant`, `crt_smoke_tenant_A_archived` + client A, `crt_smoke_tenant_B` + client B). Evidence rule reinforced.
   - Staging credential-hygiene gap: operator's staging password undocumented; recovered via SQL reset.
   - Node.js 20 → 24 forced upgrade in staging workflow — non-blocking backlog item for a `setup-node@v4` pin bump.

5. **WO-PRR lane-shape template:** this release is recorded as the working example of a governed prod deploy under current frozen-lane conditions. The sequence (merge → migration → edge fn from worktree → wrangler deploy from worktree → bundle grep → operator rule-3 pass → SQL disposition → ledger) is the concrete artifact for the WO-PRR lane-shape decision to be evaluated against.

6. **Branch swap:** move off `fix/wo-data-integrity-reports-tenant-guard` (long-merged); update local main to post-merge SHA.

**Commands for branch swap:**
```bash
git checkout main
git pull origin main
git worktree remove /tmp/ss-prod-fn-<MERGED_SHA> 2>/dev/null
git worktree remove /tmp/ss-staging-addendum-571ab048 2>/dev/null
```

## Final abort criteria

If any phase fails and can't be diagnosed in-window, execute rollback for the affected layer:
- Phase 1 rollback: DROP trigger + function
- Phase 2 rollback: redeploy previous edge fn version
- Phase 3 rollback: `wrangler rollback --version-id 8693a651-...`

Rollback restores prod to its pre-release state exactly. The two orphan docs stay as historical evidence — not touched by any rollback.

If rollback is executed, ledger the abort with root cause under a distinct WO-DATA-INTEGRITY-addendum-abort block. Do not silently retry.
