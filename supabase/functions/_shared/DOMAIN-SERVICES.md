# Fortress Domain Service Architecture

## Overview

Fortress consolidates ~82 individual edge functions into **7 domain service routers**.
Each router acts as a single entry point for a functional domain, dispatching requests
to the appropriate logic via an `action` field in the request body.

This architecture reduces connection overhead, simplifies deployment, and provides a
consistent contract for all callers (auto-orchestrator, watchdog, dashboard-ai-assistant, frontend).

## Domain Services

### 1. `system-ops` — Platform Operations (8 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `health-check` | `system-health-check` | Full system health probe |
| `data-integrity-fix` | `data-integrity-fix` | Fix orphaned/broken data |
| `retry-dead-letters` | `retry-dead-letters` | Retry failed async tasks |
| `data-quality` | `data-quality-monitor` | Data quality analysis |
| `orchestrate` | `auto-orchestrator` | Trigger full orchestration cycle |
| `ooda-loop` | `autonomous-operations-loop` | OODA decision engine |
| `pipeline-tests` | `scheduled-pipeline-tests` | Run pipeline E2E tests |
| `watchdog` | `system-watchdog` | Self-healing watchdog |

### 2. `signal-processor` — Signal Lifecycle (9 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `ingest` | `ingest-signal` | Ingest raw signals |
| `deduplicate` | `detect-duplicates` | Find/mark duplicate signals |
| `correlate` | `correlate-signals` | Cross-signal correlation |
| `merge` | `propose-signal-merge` | Propose signal merges |
| `consolidate` | `consolidate-signals` | Cross-source consolidation |
| `extract-insights` | `extract-signal-insights` | AI insight extraction |
| `backfill-media` | `backfill-signal-media` | Backfill media/images |
| `detect-near-duplicates` | `detect-near-duplicate-signals` | Fuzzy duplicate detection |
| `execute-merge` | `execute-signal-merge` | Execute approved merges |

### 3. `entity-manager` — Entity Lifecycle (12 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `create` | `create-entity` | Create new entities |
| `enrich` | `enrich-entity` | AI entity enrichment |
| `deep-scan` | `entity-deep-scan` | Deep OSINT entity scan |
| `correlate` | `correlate-entities` | Entity correlation |
| `cross-reference` | `cross-reference-entities` | Cross-reference analysis |
| `configure-monitoring` | `configure-entity-monitoring` | Set monitoring params |
| `scan-content` | `scan-entity-content` | Scan entity web content |
| `scan-photos` | `scan-entity-photos` | Scan entity photos |
| `proximity-monitor` | `monitor-entity-proximity` | Geofence proximity alerts |
| `osint-scan` | `osint-entity-scan` | Full OSINT entity scan |
| `web-search` | `osint-web-search` | OSINT web search |
| `auto-enrich` | `auto-enrich-entities` | Batch auto-enrichment |

### 4. `incident-manager` — Incident Lifecycle (10 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `action` | `incident-action` | Status/assignment changes |
| `check-escalation` | `check-incident-escalation` | Auto-escalation check |
| `summarize` | `auto-summarize-incident` | AI incident summary |
| `agent-orchestrate` | `incident-agent-orchestrator` | Multi-agent orchestration |
| `alert-delivery` | `alert-delivery` | Standard alert delivery |
| `alert-delivery-secure` | `alert-delivery-secure` | Secure alert delivery |
| `manage-ticket` | `manage-incident-ticket` | Ticket management |
| `watch` | `incident-watch` | Incident watch/monitoring |
| `threat-escalation` | `analyze-threat-escalation` | Threat escalation analysis |
| `generate-briefing` | `generate-incident-briefing` | Generate incident briefings |

### 5. `intelligence-engine` — AI Analysis (12 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `sentiment-drift` | `analyze-sentiment-drift` | Sentiment trend analysis |
| `multi-model-consensus` | `multi-model-consensus` | Multi-model verification |
| `multi-agent-debate` | `multi-agent-debate` | Multi-agent debate protocol |
| `decision-engine` | `ai-decision-engine` | AI decision/categorization |
| `predictive-forecast` | `predictive-forecast` | Predictive threat forecasting |
| `impact-analysis` | `perform-impact-analysis` | Impact analysis |
| `threat-radar` | `threat-radar-analysis` | Threat landscape radar |
| `threat-cluster` | `threat-cluster-detector` | Pre-incident pattern detection |
| `predictive-scorer` | `predictive-incident-scorer` | Escalation probability |
| `anticipation-index` | `calculate-anticipation-index` | Anticipation index calc |
| `precursor-indicators` | `identify-precursor-indicators` | Precursor threat indicators |
| `critical-failure-points` | `identify-critical-failure-points` | Critical failure analysis |

### 6. `osint-collector` — OSINT Monitoring (31 actions)

| Action | Delegates To | Purpose |
|--------|-------------|---------|
| `monitor-news` | `monitor-news` | News monitoring |
| `monitor-news-google` | `monitor-news-google` | Google News emergency |
| `monitor-social` | `monitor-social` | Social media aggregated |
| `monitor-social-unified` | `monitor-social-unified` | Unified social monitoring |
| `monitor-linkedin` | `monitor-linkedin` | LinkedIn monitoring |
| `monitor-github` | `monitor-github` | GitHub code exposure |
| `monitor-darkweb` | `monitor-darkweb` | Dark web monitoring |
| `monitor-rss` | `monitor-rss-sources` | RSS feed monitoring |
| `monitor-weather` | `monitor-weather` | Weather alerts |
| `monitor-wildfires` | `monitor-wildfires` | Wildfire monitoring |
| `monitor-wildfire-comprehensive` | `monitor-wildfire-comprehensive` | Comprehensive wildfire |
| `monitor-earthquakes` | `monitor-earthquakes` | Earthquake monitoring |
| `monitor-domains` | `monitor-domains` | Domain monitoring |
| `monitor-threat-intel` | `monitor-threat-intel` | Threat intel feeds |
| `monitor-travel-risks` | `monitor-travel-risks` | Travel risk monitoring |
| `monitor-regulatory` | `monitor-regulatory-changes` | Regulatory changes |
| `monitor-pastebin` | `monitor-pastebin` | Pastebin leak monitoring |
| `monitor-naad` | `monitor-naad-alerts` | NAAD alerts |
| `monitor-csis` | `monitor-csis` | CSIS monitoring |
| `monitor-court` | `monitor-court-registry` | Court registry |
| `monitor-canadian` | `monitor-canadian-sources` | Canadian sources |
| `monitor-community` | `monitor-community-outreach` | Community outreach |
| `monitor-regional-apac` | `monitor-regional-apac` | APAC regional |
| `monitor-emergency-google` | `monitor-emergency-google` | Emergency Google |
| `monitor-entity-proximity` | `monitor-entity-proximity` | Entity proximity |
| `web-search` | `osint-web-search` | OSINT web search |
| `manual-scan` | `manual-scan-trigger` | Manual scan trigger |
| `entity-scan` | `osint-entity-scan` | OSINT entity scan |
| `test-connectivity` | `test-osint-source-connectivity` | Source connectivity test |

### 7. `wraith-security-advisor` — Personal Security (10 actions)

| Action | Handler | Purpose |
|--------|---------|---------|
| `analyze_url` | Inlined | AI-powered URL phishing/malware analysis |
| `analyze_email` | Inlined | AI-powered email social engineering detection |
| `check_breaches` | Inlined | HIBP breach lookup |
| `full_security_audit` | Inlined | Comprehensive security posture audit |
| `get_threat_feed` | Inlined | CISA KEV vulnerability feed |
| `get_security_score` | Inlined | Retrieve latest security score |
| `scan_ip_exposure` | Inlined | Public IP reputation & exposure analysis |
| `check_dns_leaks` | Inlined | DNS leak detection (VPN validation) |
| `check_ssl` | Inlined | SSL/TLS certificate & header analysis |
| `check_webrtc` | Inlined | WebRTC leak guidance (client-side execution) |

## Request Format

All domain services use the same envelope:

```json
POST /functions/v1/{domain-service}
{
  "action": "action-name",
  ...additional fields specific to the action
}
```

## Callers Updated

| Caller | Routes Through |
|--------|---------------|
| `auto-orchestrator` | `osint-collector`, `signal-processor`, `intelligence-engine` |
| `system-watchdog` | `osint-collector` (stale source remediation) |
| `dashboard-ai-assistant` | All 7 domain services |
| `SecurityAdvisor.tsx` | `wraith-security-advisor` |

## Non-Regression Guarantee

All original micro-functions remain deployed and functional. The domain services
use a **delegation pattern** — they forward requests to the original functions via
internal HTTP calls. This means:

1. Zero breaking changes to existing functionality
2. Original functions can still be called directly if needed
3. Incremental migration path: logic can be inlined into domain services over time
4. Circuit breakers, timeouts, and resilience patterns are preserved
