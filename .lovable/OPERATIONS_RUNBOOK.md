# Fortress Operations Runbook

## Quick Reference

### System Health Check
```bash
POST /system-health-check
Body: {}
```
Verifies: Database, Auth, Storage, AI Gateway, Weather.gov, NASA FIRMS

### Critical Pipelines

#### 1. Signal Ingestion
```bash
POST /ingest-signal
Body: { "text": "...", "source": "...", "category": "...", "severity": "low|medium|high|critical" }
```
- Signals are enqueued for batch processing
- Deduplication via SHA-256 content hashing (24h lookback)
- Auto-correlation with entities

#### 2. AI Decision Engine
```bash
POST /ai-decision-engine
Body: { "signal_id": "uuid" }
```
- Rule-based classification for low-severity signals
- AI-powered analysis for high/critical signals
- Returns: threat_level, should_create_incident, containment_actions

#### 3. Alert Delivery
```bash
POST /alert-delivery
Body: {}
```
- Processes pending alerts in queue
- Supports: in_app, email, SMS channels
- Respects principal alert preferences (quiet hours, thresholds)

#### 4. VIP Deep Scan
```bash
POST /vip-deep-scan
Body: { "intakeData": { "clientId": "uuid", "fullLegalName": "...", ... } }
```
- Creates VIP entity with relationships
- Initiates OSINT discovery
- Sets up active monitoring

---

## Monitoring Functions

| Function | Purpose | Schedule |
|----------|---------|----------|
| `monitor-news` | Google News scraping | Every 15 min |
| `monitor-rss-sources` | RSS feed ingestion | Every 10 min |
| `monitor-social` | Social media monitoring | Every 30 min |
| `monitor-weather` | Severe weather alerts | Every 5 min |
| `monitor-wildfires` | NASA FIRMS + NIFC data | Every 15 min |
| `monitor-earthquakes` | USGS earthquake data | Every 10 min |
| `monitor-threat-intel` | Threat intelligence feeds | Every 1 hour |
| `monitor-darkweb` | HIBP breach monitoring | Every 6 hours |
| `monitor-domains` | Typosquatting detection | Every 24 hours |

---

## Troubleshooting

### Signal Not Appearing in UI
1. Check `signals` table: `SELECT * FROM signals WHERE id = 'uuid'`
2. Verify `status` is not 'archived' or 'resolved'
3. Check `client_id` matches selected client in UI
4. Review deduplication: content_hash collision in last 24h?

### AI Decision Engine Not Responding
1. Check `LOVABLE_API_KEY` secret is set
2. Verify AI Gateway health via `/system-health-check`
3. Check edge function logs for rate limiting

### RLS Permission Denied
1. Verify user has correct role in `user_roles` table
2. Check `profiles.client_id` matches resource's `client_id`
3. Super admins bypass RLS via `is_super_admin()` function

### VIP Scan Fails
1. Ensure `clientId` is a valid UUID
2. Verify `intakeData` wrapper is present
3. Check consent flags are boolean

---

## Security Notes

### RLS Architecture
- All client-scoped data filtered via `profiles.client_id`
- Session variables NOT used (unreliable across requests)
- Super admin bypass via `is_super_admin(auth.uid())`

### Role Hierarchy
| Role | Access |
|------|--------|
| `super_admin` | Full platform access |
| `admin` | Tenant-scoped management |
| `analyst` | Tenant-scoped operations |
| `viewer` | Read-only access |

### Known Linter Warnings (Acceptable)
- **Extensions in Public**: UUID/vector extensions in public schema (standard pattern)
- **RLS Policy Always True on SELECT**: Intentional for public-read tables (knowledge_base, tone_rules)
- **Leaked Password Protection**: Requires Supabase dashboard configuration

---

## Edge Function Inventory

**Total Functions**: ~140

### Core Categories
- **Monitoring**: 25+ functions for OSINT data acquisition
- **AI/ML**: Decision engine, sentiment analysis, threat modeling
- **Entity Management**: Deep scans, correlation, relationship mapping
- **Incident Response**: Classification, escalation, ticket management
- **Travel Security**: Itinerary parsing, risk assessment, wildfire alerts
- **Reporting**: Executive briefings, compliance reports, consortium sharing

### Shared Modules (`_shared/`)
- `supabase-client.ts` - Standardized client initialization
- `correlate-signal-entities.ts` - Entity correlation logic
- `media-capture.ts` - Media download and storage
- `social-media-parser.ts` - Social post parsing utilities

---

## Emergency Procedures

### High-Volume Signal Flood
1. Check `monitoring_history` for source issues
2. Pause problematic source via `update-osint-source-config`
3. Run `cleanup-duplicate-signals` to dedupe

### Database Performance
1. Check for missing indexes on frequently queried columns
2. Review slow query logs via Supabase dashboard
3. Consider archiving old signals (>90 days)

### AI Gateway Outage
1. System automatically falls back to rule-based classification
2. Monitor `processing_method` in decision responses
3. High-severity signals still processed via heuristics

---

*Last Updated: 2026-02-05*
*Version: 1.0.0*
