# WO-AIGATEWAY-PROPAGATION — propagate the ai-gateway fail-closed fix to the fleet

**Opened:** 2026-08-31 (from WO-SCANNER-AI-GATEWAY-STALE Step 1).
**Pace:** normal. **NOT an emergency** (see "Why not urgent").
**Hard dependency:** sequence AFTER **WO-SCANNER-DEPLOY-DRIFT** remediation — do not start before.

## The fix that needs propagating
Commit **6a7f3f7a** (2026-08-30T16:13:45Z), `_shared/ai-gateway.ts`: the sonar path no longer
silently falls back to an ungrounded model (gpt-4o-mini/Gemini) when `PERPLEXITY_API_KEY` is empty.
It now routes sonar → Perplexity always, and **fails closed** with no key rather than fabricating from
training data ("model-as-live-data" doctrine).

Because `_shared` is bundled into each function **at deploy time**, the fix only reaches a function the
next time that function is itself redeployed. As of 2026-08-31 it has NOT propagated.

## Scope (measured 2026-08-31, from live deployed metadata + bundle byte-diff)
- **105** repo-source functions import `ai-gateway` transitively; **103** are deployed.
- **~101 deployed functions run the pre-fix build** (deployed before the fix commit). Deploy dates span
  2026-06-12 → 2026-08-26. Plus **subject-retrieval** (orphan, verified pre-fix) → ~102 known pre-fix.
- **2** carry the fix (deployed after the commit): `generate-security-briefing`, `generate-subject-exposure-report`.
- **Orphans that bundle the pre-fix ai-gateway** (no repo source — see dependency): `subject-retrieval`,
  `subject-exposure`, `cipher-analyze-investigation`. (subject-breach-check, the rest of cipher-*,
  analyze-doctrine-image, agent-interview-session do NOT bundle ai-gateway — verified by bundle fetch.)

### Sonar callers — where the fallback is actually reachable (FINAL, not approximate)
Of the pre-fix importers, only **8 request a `sonar` model** (the rest bundle the fallback as dead code).
Complete list (repo-source; **0 orphans** request sonar):

| function | deploy | gateway build |
|---|---|---|
| agent-chat | 2026-08-25 | PRE-fix |
| agent-knowledge-seeker | 2026-07-29 | PRE-fix |
| dashboard-ai-assistant | 2026-08-22 | PRE-fix |
| ingest-expert-media | 2026-08-11 | PRE-fix |
| monitor-travel-risks | 2026-08-30 (pre-commit) | PRE-fix |
| query-expert-knowledge | 2026-06-12 | PRE-fix |
| tech-radar-scanner | 2026-06-12 | PRE-fix |
| generate-security-briefing | 2026-08-30 (post-commit) | **fixed** |

→ **7 sonar callers on the pre-fix build.** (An earlier pass under-counted these as 6 because it scanned
only the pre-fix subset and missed `monitor-travel-risks`; recorded here so the number is not re-derived wrong.)

## Why not urgent
1. **The fabrication precondition is an EMPTY key.** Present-but-invalid routes to Perplexity and gets an
   error; the pre-fix gateway does NOT downgrade a rejected sonar call to ungrounded (fail-closed — the
   OpenAI-429→Gemini fallback is gated `aiProvider==='openai'`, not Perplexity). So present-invalid =
   errors, not fabrication.
2. **The trigger is now monitored.** `agent-sentinel` Probe 2j (WO-SCANNER-AI-GATEWAY-STALE) fires HIGH if
   `PERPLEXITY_API_KEY` is absent/empty, and does a live sonar auth call firing HIGH on 401/403.
3. **Live state as of 2026-08-31:** `PERPLEXITY_API_KEY` is present but returns **HTTP 401
   `insufficient_quota`** (Perplexity account billing — consistent with the 2026-04 drop). So the 7 pre-fix
   sonar callers' sonar calls are currently **erroring (fail-closed), not fabricating**. Separate decision:
   renew Perplexity billing vs. migrate those 7 off sonar. That is NOT this WO.

## Dependency detail (why it waits on WO-SCANNER-DEPLOY-DRIFT)
Propagation = redeploy ~103 importers. But an unknown number of importers are **orphans with no repo
`index.ts`** (subject-retrieval, subject-exposure, cipher-analyze-investigation among the ai-gateway
importers) — they **cannot be redeployed through CI at all** until their source is restored to the repo,
which is exactly WO-SCANNER-DEPLOY-DRIFT's job. Redeploying only the repo-backed subset would leave the
orphans stale and give a false "propagated" signal. Do the drift remediation first, then a single
redeploy-all (deploy-functions.yml `target: all`) propagates the fix fleet-wide in one pass.

## Done when
- All ai-gateway importers (repo-backed AND ex-orphan, post-WO-SCANNER-DEPLOY-DRIFT) redeployed on a build
  whose bundled `_shared/ai-gateway.ts` contains the fail-closed marker.
- A re-run of the bundle byte-diff shows 0 importers on the pre-fix build.
- Probe 2j stays green (or the Perplexity-billing decision is made and recorded separately).

## Cross-references
- WO-SCANNER-AI-GATEWAY-STALE (parent; the guard + this scope) · WO-SCANNER-DEPLOY-DRIFT (hard dependency)
- `[[feedback_never_substitute_model_for_live_data]]` — the doctrine the fix enforces.
- SRC_RANK / subject-retrieval redeploy / corroboration gate stay UNRULED and OUT of this WO.
