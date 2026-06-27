# Containment: staging `voice-tool-executor-v2` (Guard B, source pin)

**Staging only. Production untouched.** Applied 2026-06-27 to the `staging` branch / staging project (`lkvyrvuakzguszbpwnfz`).

## Why
Routine CI (`deploy-functions-staging.yml`) deploys the `staging` branch source. That source was the
UNHARDENED `voice-tool-executor-v2` (no `resolveScope`, service-role, unscoped) — the implementation
behind the cross-tenant exposure incident. Any ordinary redeploy would restore the leak. Guard B pins the
deployed staging source to an explicit deny-all so CI reproduces containment until the approved Model-A
restoration + acceptance gates are complete.

## Hashes / provenance
- Hardened implementation (preserved): branch `main` @ `56d57007b108e5318625a8b1d036dd07bc68adab`, path `supabase/functions/voice-tool-executor-v2/index.ts`, **SHA256 `8f2d748f5c5bdee1c8c82442d2f2d414be75e0e402b5a11cba14f2227c53398a`** (contains `resolveScope`). This is the restoration baseline — DO NOT deploy to staging without the gates.
- Replaced staging source (unhardened, removed by this change): **SHA256 `8bd86ac8506d1c99e10027ea594966068a161866525c7f2bedf10ad159008a3f`** (no `resolveScope`, uses service-role).
- Committed deny-all (this change): **SHA256 `1d6e1b4be9b7d15dceacb4077de7c6b5347e02daa432b55db18ab0a597258d9c`** — no DB client, no service-role, no external calls.

## Restoration is gated
Do not restore the hardened source to staging until: Model-A (`verify_jwt=true` + handler `resolveScope`)
ratified; authenticated two-tenant isolation matrix green; table/RPC/join/mutation no-side-effect proofs;
downstream `manage-incident-ticket` / `generate-report` scope proven; paid-endpoint abuse contracts.
