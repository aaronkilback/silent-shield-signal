# STANDING RULES

These rules are in force at all times. They are not overridden by any vision, priority, or context document (including FORTRESS_VISION_UPDATE_*.md). When a task and a standing rule conflict, the standing rule wins.

1. **Fix one thing at a time.**

2. **Remove features by default. Simplify is the default.**

3. **Nothing marked done until independently verified in browser against the deployed bundle.** Code merged to `main` is not proof that users see the fix — the frontend deploy lane can be frozen, a browser can serve a stale bundle, or a code path can differ from what static analysis suggests. Every user-facing guard requires rule-3 evidence at the glass (screenshot, verbatim toast text, observed behavior) against the bundle actually being served. Ratified 2026-07-10 after WO-DATA-INTEGRITY addendum found five days of merged frontend guards protecting nobody because the deploy lane was frozen. See: `docs/platform-operations/prod-deploy-plan-2026-07-10-wo-data-integrity-addendum.md`, `reference_fortress_frontend_worker_deploy.md`.

4. **Do not move to the next page until the current page is fully clean.**

5. **Show actual code or output as proof. Summaries are not accepted.**

6. **Nothing marked done, verified, or complete until actual output (SQL result, log line, screenshot, or deploy confirmation) is pasted and checked. No exceptions.**

7. **After every code change, update the system-watchdog knowledge base and self-validation probes, then deploy. Nothing is complete until watchdog and scans reflect current state.**

8. **Every doctrine-mandated DB trigger, function, or guard we add carries a stable UPPERCASE ENFORCEMENT TOKEN in its error DETAIL, prefix-matched to its origin.** The token exists so log analysis / watchdog SQL can count enforcement events per guard without parsing prose. Example: `WO_DATA_INTEGRITY_ADDENDUM_AI_CHAT_CLIENT_SCOPE` in `enforce_ai_chat_archival_client_scope`. Ratified 2026-07-10 during the WO-DATA-INTEGRITY addendum. Applies going forward to every new trigger/guard; retrofit older triggers opportunistically as they're touched.
