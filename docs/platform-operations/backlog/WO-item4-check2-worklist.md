# WO item 4 — check-2 triage worklist (service-role + request-derived scope, no membership check)

Generated once from the security-gate check-2 baseline (WO-CI-SECURITY-GATE-01), 2026-07-31. 61 functions.

For each: confirm whether the request-supplied client/tenant/entity id is validated against the CALLER+s tenant_users membership. If not, add the gate (or restrict). Then remove from baseline via `npm run security-gate:baseline` (count must only decrease).

| # | function | branch/symbol | line |
|---|---|---|---|
| 1 | admin-feed-cleanup | <function> | 104 |
| 2 | aegis-chat | <function> | 44 |
| 3 | agent-mesh-dispatcher | <function> | 78 |
| 4 | alert-delivery | <function> | 85 |
| 5 | analyze-sentiment-drift | <function> | 66 |
| 6 | api-key-management | <function> | 89 |
| 7 | api-v1-signals | <function> | 263 |
| 8 | assess-entity | <function> | 11 |
| 9 | audit-compliance-status | <function> | 17 |
| 10 | auto-enrich-entities | <function> | 36 |
| 11 | auto-summarize-incident | <function> | 88 |
| 12 | autonomous-source-discovery | <function> | 72 |
| 13 | calculate-anticipation-index | <function> | 25 |
| 14 | check-incident-escalation | <function> | 91 |
| 15 | configure-entity-monitoring | <function> | 56 |
| 16 | correlate-entities | <function> | 198 |
| 17 | create-archival-record | <function> | 18 |
| 18 | create-entity | <function> | 86 |
| 19 | data-quality-monitor | <function> | 189 |
| 20 | detect-duplicates | <function> | 130 |
| 21 | detect-threat-patterns | <function> | 53 |
| 22 | entity-deep-scan | <function> | 96 |
| 23 | fuse-geospatial-intelligence | <function> | 28 |
| 24 | generate-monitoring-proposals | <function> | 79 |
| 25 | generate-poi-report | <function> | 251 |
| 26 | guardian-check | <function> | 39 |
| 27 | identify-precursor-indicators | <function> | 10 |
| 28 | ingest-ioc-csv | <function> | 186 |
| 29 | investigate-poi | <function> | 245 |
| 30 | knowledge-synthesizer | <function> | 423 |
| 31 | learn-from-investigations | <function> | 12 |
| 32 | map-policy-to-controls | <function> | 10 |
| 33 | monitor-community-outreach | <function> | 807 |
| 34 | monitor-court-registry | <function> | 47 |
| 35 | monitor-wildfire-comprehensive | <function> | 255 |
| 36 | oauth-token | <function> | 101 |
| 37 | optimize-defense-strategies | <function> | 9 |
| 38 | osint-entity-scan | <function> | 41 |
| 39 | osint-web-search | <function> | 110 |
| 40 | parse-document | <function> | 29 |
| 41 | persist-report | <function> | 19 |
| 42 | predictive-forecast | <function> | 46 |
| 43 | process-archival-documents | <function> | 8 |
| 44 | process-stored-document | <function> | 1354 |
| 45 | propose-new-monitoring-keywords | <function> | 10 |
| 46 | propose-security-investments | <function> | 10 |
| 47 | recommend-compliance-remediation | <function> | 9 |
| 48 | recommend-policy-adjustments | <function> | 10 |
| 49 | red-team-analyst | <function> | 69 |
| 50 | review-client-policy | <function> | 19 |
| 51 | run-what-if-scenario | <function> | 158 |
| 52 | scan-client-staff | <function> | 40 |
| 53 | scan-entity-content | <function> | 8 |
| 54 | scan-entity-photos | <function> | 9 |
| 55 | score-signal-anomaly | <function> | 23 |
| 56 | send-orientation-email | <function> | 65 |
| 57 | speculative-dispatch | <function> | 19 |
| 58 | system-watchdog | case fix_orphaned_entities | 1955 |
| 59 | thread-weaver | <function> | 255 |
| 60 | trajectory-positioner | <function> | 157 |
| 61 | webhook-dispatcher | <function> | 40 |
