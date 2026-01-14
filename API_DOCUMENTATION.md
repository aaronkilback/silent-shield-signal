# Fortress API Documentation

Complete documentation for all Edge Functions (serverless API endpoints).

## Table of Contents

1. [Authentication](#authentication)
2. [Monitoring Functions](#monitoring-functions)
3. [Document Processing](#document-processing)
4. [AI Functions](#ai-functions)
5. [Entity & Correlation](#entity--correlation)
6. [Workflow & Integration](#workflow--integration)
7. [Notification Functions](#notification-functions)
8. [Travel Management](#travel-management)

## Authentication

All edge functions use Supabase authentication. Include the JWT token in requests:

```typescript
const { data, error } = await supabase.functions.invoke('function-name', {
  body: { param1: 'value1' }
});
```

For authenticated edge functions, the JWT is automatically included by the Supabase client.

## Common Response Format

```typescript
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "error": "Error message",
  "details": { ... }
}
```

---

## Monitoring Functions

### monitor-news

Monitors news sources for security, business, and reputational risks.

**Endpoint:** `POST /monitor-news`

**Authentication:** Service role (scheduled function)

**Request Body:** None (triggered by cron)

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 12,
  "documents_ingested": 8,
  "source": "news"
}
```

**Schedule:** Every 2 hours

**What it does:**
- Fetches active news sources from database
- Searches Google News for client-related articles
- Creates signals for matches
- Ingests documents for AI analysis
- Updates monitoring history

---

### monitor-facebook

Monitors Facebook for mentions related to clients via Google search.

**Endpoint:** `POST /monitor-facebook`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 3,
  "source": "facebook"
}
```

**Rate Limiting:** 5-8 second delay between clients to avoid Google rate limits

---

### monitor-instagram

Monitors Instagram for mentions via Google search.

**Endpoint:** `POST /monitor-instagram`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 2,
  "source": "instagram"
}
```

---

### monitor-linkedin

Monitors LinkedIn for professional mentions via Google search.

**Endpoint:** `POST /monitor-linkedin`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 4,
  "source": "linkedin"
}
```

---

### monitor-github

Monitors GitHub for code exposures and sensitive data leaks.

**Endpoint:** `POST /monitor-github`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 1,
  "source": "github"
}
```

**Keywords monitored:**
- API keys
- Passwords
- Database credentials
- Private keys
- Tokens

---

### monitor-pastebin

Monitors Pastebin for data leaks.

**Endpoint:** `POST /monitor-pastebin`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 2,
  "source": "pastebin"
}
```

**Leak keywords:**
- breach, leak, dump, exposed, hacked, stolen, database, passwords, credentials

---

### monitor-darkweb

Monitors dark web breaches via Have I Been Pwned API.

**Endpoint:** `POST /monitor-darkweb`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 3,
  "source": "darkweb"
}
```

**External API:** haveibeenpwned.com

---

### monitor-domains

Monitors for typosquatting and phishing domains.

**Endpoint:** `POST /monitor-domains`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 7,
  "suspicious_domains_found": 7,
  "source": "domains"
}
```

**Detection methods:**
- Character swapping
- Homoglyph substitution
- TLD variations
- Common typos

---

### monitor-earthquakes

Monitors significant earthquakes from USGS.

**Endpoint:** `POST /monitor-earthquakes`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 4,
  "source": "earthquakes"
}
```

**Threshold:** Magnitude >= 4.5

**External API:** earthquake.usgs.gov

---

### monitor-wildfires

Monitors active wildfires.

**Endpoint:** `POST /monitor-wildfires`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 3,
  "source": "wildfires"
}
```

---

### monitor-weather

Monitors severe weather alerts.

**Endpoint:** `POST /monitor-weather`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 6,
  "source": "weather"
}
```

---

### monitor-csis

Monitors Canadian Security Intelligence Service feeds.

**Endpoint:** `POST /monitor-csis`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 8,
  "sources_monitored": 3,
  "source": "csis"
}
```

**Sources:**
- CSIS Public Reports
- Canadian Centre for Cyber Security
- Public Safety Canada

---

### monitor-court-registry

Monitors court registries for legal/regulatory information.

**Endpoint:** `POST /monitor-court-registry`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "entities_scanned": 20,
  "signals_created": 4,
  "sources_scanned": 2,
  "source": "court_registry"
}
```

**Sources:**
- BC Court Services
- Supreme Court of Canada

---

### monitor-canadian-sources

Monitors various Canadian public data sources.

**Endpoint:** `POST /monitor-canadian-sources`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "clients_scanned": 5,
  "signals_created": 10,
  "sources_monitored": 4,
  "source": "canadian_sources"
}
```

**Sources:**
- RCMP Gazette
- DriveBC Alerts
- BC Energy Regulator
- Peace River Regional District

---

### monitor-entity-proximity

Monitors entities for proximity to threats.

**Endpoint:** `POST /monitor-entity-proximity`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "entities_scanned": 15,
  "signals_created": 5,
  "incidents_created": 2,
  "notifications_sent": 10,
  "source": "entity_proximity"
}
```

**Requires:**
- Entity has `active_monitoring_enabled: true`
- Entity has `current_location` set

---

### monitor-travel-risks

Monitors travel risks for active itineraries.

**Endpoint:** `POST /monitor-travel-risks`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "itineraries_monitored": 8,
  "alerts_created": 3,
  "source": "travel_risks"
}
```

---

## Document Processing

### parse-document

Generic document parsing function (PDF, DOCX, TXT).

**Endpoint:** `POST /parse-document`

**Request Body:**
```json
{
  "storagePath": "documents/file.pdf",
  "filename": "file.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "textContent": "Extracted text...",
  "pageCount": 10,
  "wordCount": 5000
}
```

**Supported formats:** PDF, DOCX, DOC, TXT

---

### process-stored-document

Processes archival documents for entity extraction.

**Endpoint:** `POST /process-stored-document`

**Request Body:**
```json
{
  "documentId": "uuid",
  "storagePath": "archival-documents/doc.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "documentId": "uuid",
  "entitiesExtracted": 15,
  "contentLength": 5000,
  "processingTime": 2500
}
```

**What it does:**
1. Extracts text from document
2. Saves `content_text` to database
3. Runs AI entity extraction
4. Creates entity suggestions
5. Links to existing entities
6. Updates document metadata

---

### parse-entities-document

AI-powered entity extraction from documents.

**Endpoint:** `POST /parse-entities-document`

**Request Body:**
```json
{
  "documentId": "uuid",
  "textContent": "Full document text...",
  "clientId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "entitiesFound": 12,
  "suggestionsCreated": 8,
  "matchedExisting": 4
}
```

**Entity types extracted:**
- Person
- Organization
- Location
- Threat
- Event

---

### process-intelligence-document

Processes intelligence documents ingested from monitoring.

**Endpoint:** `POST /process-intelligence-document`

**Request Body:**
```json
{
  "documentId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "signalsCreated": 3,
  "relevanceScore": 0.85
}
```

---

### process-documents-batch

Batch processes multiple documents.

**Endpoint:** `POST /process-documents-batch`

**Request Body:**
```json
{
  "documentIds": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:**
```json
{
  "success": true,
  "processed": 3,
  "failed": 0,
  "totalEntities": 45
}
```

---

## AI Functions

### dashboard-ai-assistant

Natural language assistant for querying intelligence data.

**Endpoint:** `POST /dashboard-ai-assistant`

**Request Body:**
```json
{
  "message": "Show me all critical incidents from last week",
  "conversationHistory": []
}
```

**Response:**
```json
{
  "message": "I found 5 critical incidents from last week...",
  "toolResults": [
    {
      "toolName": "get_recent_signals",
      "result": { ... }
    }
  ]
}
```

**Available tools:**
- `search_signals` - Search signals by keyword
- `get_recent_signals` - Get recent signals
- `get_active_incidents` - Get active incidents
- `search_entities` - Search entities
- `get_entity_details` - Get entity details
- `search_archival_documents` - Search documents
- `get_document_content` - Get full document content
- `search_investigations` - Search investigation files
- `get_monitoring_stats` - Get monitoring statistics
- `trigger_manual_scan` - Trigger OSINT scan

---

### ai-decision-engine

AI-driven decision making for incident classification.

**Endpoint:** `POST /ai-decision-engine`

**Request Body:**
```json
{
  "signalId": "uuid",
  "context": { ... }
}
```

**Response:**
```json
{
  "decision": "escalate",
  "confidence": 0.92,
  "reasoning": "High severity threat detected...",
  "recommendedActions": ["Create incident", "Notify SOC"]
}
```

---

### generate-learning-context

Generates learning context for ML model improvements.

**Endpoint:** `POST /generate-learning-context`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "patterns": { ... },
  "improvements": [ ... ]
}
```

---

### adaptive-confidence-adjuster

Adjusts confidence thresholds based on feedback.

**Endpoint:** `POST /adaptive-confidence-adjuster`

**Request Body:** None

**Response:**
```json
{
  "recommended_threshold": 0.75,
  "accuracy_by_bucket": { ... },
  "false_positive_patterns": [ ... ],
  "learning_guidance": "..."
}
```

---

### investigation-ai-assist

AI assistance for investigation workflows.

**Endpoint:** `POST /investigation-ai-assist`

**Request Body:**
```json
{
  "investigationId": "uuid",
  "query": "Summarize key findings"
}
```

**Response:**
```json
{
  "summary": "Investigation reveals...",
  "keyFindings": [ ... ],
  "recommendations": [ ... ]
}
```

---

## Entity & Correlation

### correlate-signals

Correlates related signals into groups.

**Endpoint:** `POST /correlate-signals`

**Request Body:**
```json
{
  "signalId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "correlationGroupId": "uuid",
  "relatedSignals": 5,
  "confidence": 0.88
}
```

---

### correlate-entities

Detects relationships between entities.

**Endpoint:** `POST /correlate-entities`

**Request Body:** None

**Response:**
```json
{
  "success": true,
  "relationshipsFound": 12,
  "relationshipsCreated": 8
}
```

---

### cross-reference-entities

Cross-references entities across different data sources.

**Endpoint:** `POST /cross-reference-entities`

**Request Body:**
```json
{
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "crossReferences": [
    {
      "source": "signals",
      "count": 5
    },
    {
      "source": "documents",
      "count": 3
    }
  ]
}
```

---

### enrich-entity

Enriches entity with additional data from external sources.

**Endpoint:** `POST /enrich-entity`

**Request Body:**
```json
{
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "dataAdded": {
    "addresses": 2,
    "aliases": 3,
    "associations": 5
  }
}
```

---

### detect-duplicates

Detects duplicate entities, signals, or documents.

**Endpoint:** `POST /detect-duplicates`

**Request Body:**
```json
{
  "type": "entity",
  "threshold": 0.85
}
```

**Response:**
```json
{
  "success": true,
  "duplicatesFound": 8,
  "duplicateGroups": [
    {
      "sourceId": "uuid",
      "duplicateId": "uuid",
      "similarityScore": 0.92
    }
  ]
}
```

---

### osint-entity-scan

Performs OSINT scan for an entity.

**Endpoint:** `POST /osint-entity-scan`

**Request Body:**
```json
{
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "contentFound": 15,
  "photosFound": 8,
  "relatedEntities": 5
}
```

---

### osint-web-search

Performs web search for entity information.

**Endpoint:** `POST /osint-web-search`

**Request Body:**
```json
{
  "query": "John Doe Vancouver",
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "..."
    }
  ],
  "totalResults": 25
}
```

---

### scan-entity-content

Scans web content related to an entity.

**Endpoint:** `POST /scan-entity-content`

**Request Body:**
```json
{
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "contentScanned": 20,
  "relevantContent": 12
}
```

---

### scan-entity-photos

Scans and collects photos of an entity.

**Endpoint:** `POST /scan-entity-photos`

**Request Body:**
```json
{
  "entityId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "photosFound": 15,
  "photosStored": 12
}
```

---

## Workflow & Integration

### auto-orchestrator

Orchestrates automated workflows based on triggers.

**Endpoint:** `POST /auto-orchestrator`

**Request Body:**
```json
{
  "trigger": "high_severity_signal",
  "context": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "actionsExecuted": [
    "create_incident",
    "send_notifications",
    "assign_analyst"
  ]
}
```

---

### manual-scan-trigger

Manually triggers OSINT scans.

**Endpoint:** `POST /manual-scan-trigger`

**Request Body:**
```json
{
  "scanType": "news",
  "clientIds": ["uuid1", "uuid2"]
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "uuid",
  "status": "queued"
}
```

---

### ingest-signal

Manually ingest a signal.

**Endpoint:** `POST /ingest-signal`

**Request Body:**
```json
{
  "title": "Security Alert",
  "description": "...",
  "source": "manual",
  "category": "cybersecurity",
  "severity": "high",
  "clientId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "signalId": "uuid"
}
```

---

### incident-action

Performs actions on incidents.

**Endpoint:** `POST /incident-action`

**Request Body:**
```json
{
  "incidentId": "uuid",
  "action": "acknowledge",
  "notes": "SOC team notified"
}
```

**Response:**
```json
{
  "success": true,
  "incidentId": "uuid",
  "newStatus": "acknowledged"
}
```

**Available actions:**
- `acknowledge` - Acknowledge incident
- `contain` - Mark as contained
- `resolve` - Resolve incident
- `escalate` - Escalate priority

---

### process-feedback

Processes user feedback for ML improvement.

**Endpoint:** `POST /process-feedback`

**Request Body:**
```json
{
  "objectId": "uuid",
  "objectType": "signal",
  "feedback": "false_positive",
  "notes": "Not relevant to our client"
}
```

**Response:**
```json
{
  "success": true,
  "feedbackId": "uuid"
}
```

---

### generate-report

Generates intelligence reports.

**Endpoint:** `POST /generate-report`

**Request Body:**
```json
{
  "reportType": "weekly_summary",
  "clientId": "uuid",
  "startDate": "2024-01-01",
  "endDate": "2024-01-07"
}
```

**Response:**
```json
{
  "success": true,
  "reportId": "uuid",
  "storageUrl": "reports/weekly-2024-01-07.pdf"
}
```

---

### generate-executive-report

Generates executive-level summary reports.

**Endpoint:** `POST /generate-executive-report`

**Request Body:**
```json
{
  "clientId": "uuid",
  "period": "monthly"
}
```

**Response:**
```json
{
  "success": true,
  "reportId": "uuid",
  "summary": "...",
  "keyMetrics": { ... }
}
```

---

## Notification Functions

### alert-delivery

Delivers alerts via multiple channels.

**Endpoint:** `POST /alert-delivery`

**Request Body:**
```json
{
  "incidentId": "uuid",
  "channels": ["email", "slack"],
  "priority": "high"
}
```

**Response:**
```json
{
  "success": true,
  "delivered": {
    "email": 5,
    "slack": 1
  }
}
```

---

### send-notification-email

Sends notification emails.

**Endpoint:** `POST /send-notification-email`

**Request Body:**
```json
{
  "to": "analyst@company.com",
  "type": "incident",
  "data": {
    "priority": "p1",
    "title": "Critical Security Alert"
  }
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "resend-message-id"
}
```

**Uses:** Resend API for email delivery

---

### check-incident-escalation

Checks incidents for SLA escalation.

**Endpoint:** `POST /check-incident-escalation`

**Request Body:** None (scheduled function)

**Response:**
```json
{
  "success": true,
  "incidentsChecked": 50,
  "incidentsEscalated": 3
}
```

**Schedule:** Every 15 minutes

---

## Travel Management

### parse-travel-itinerary

Parses uploaded travel itinerary documents.

**Endpoint:** `POST /parse-travel-itinerary`

**Request Body:**
```json
{
  "documentPath": "travel-documents/itinerary.pdf",
  "travelerId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "itinerary": {
    "tripName": "Vancouver Business Trip",
    "originCity": "Toronto",
    "destinationCity": "Vancouver",
    "departureDate": "2024-03-15",
    "returnDate": "2024-03-20",
    "flights": ["AC123", "AC456"],
    "hotel": "Hotel Name"
  }
}
```

---

### archive-completed-itineraries

Archives completed travel itineraries.

**Endpoint:** `POST /archive-completed-itineraries`

**Request Body:** None (scheduled function)

**Response:**
```json
{
  "success": true,
  "itinerariesArchived": 5
}
```

**Schedule:** Daily

---

## Error Handling

All functions return consistent error responses:

```json
{
  "error": "Error message",
  "details": {
    "code": "ERROR_CODE",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

Common error codes:
- `AUTHENTICATION_REQUIRED` - Missing or invalid auth token
- `INVALID_INPUT` - Invalid request parameters
- `NOT_FOUND` - Resource not found
- `PERMISSION_DENIED` - Insufficient permissions
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `EXTERNAL_API_ERROR` - External service failure
- `INTERNAL_ERROR` - Unexpected server error

## Rate Limiting

Most monitoring functions implement rate limiting:
- **Google Search**: 5-8 second delay between requests
- **External APIs**: Varies by service
- **Database operations**: No artificial limits (PostgreSQL handles connection pooling)

## Scheduling

Many functions run on schedules via Supabase cron:

```toml
# Example from config.toml
[functions.monitor-news]
schedule = "0 */2 * * *"  # Every 2 hours

[functions.check-incident-escalation]
schedule = "*/15 * * * *"  # Every 15 minutes

[functions.monitor-travel-risks]
schedule = "0 * * * *"  # Every hour
```

## Best Practices

1. **Always handle errors** - Check for `error` in response
2. **Use appropriate timeouts** - Long-running functions may timeout
3. **Batch operations** - Use batch functions for multiple items
4. **Check rate limits** - Respect external API rate limits
5. **Validate input** - Always validate request parameters
6. **Log appropriately** - Use console.log for debugging
7. **Use service role carefully** - Only in edge functions, never client-side

## Support

For issues with edge functions:
1. Check Supabase Dashboard → Edge Functions → Logs
2. Review error messages and stack traces
3. Check external API status (Google, Resend, etc.)
4. Verify secrets are configured correctly
5. Test with smaller datasets first

---

## AI Agent Management Functions

### create-agent

Creates a new AI agent with specified configuration.

**Endpoint:** `POST /create-agent`

**Request Body:**
```json
{
  "codename": "Phoenix",
  "call_sign": "PHOENIX-1",
  "header_name": "Phoenix",
  "persona": "Strategic intelligence advisor with expertise in threat analysis",
  "specialty": "Threat Intelligence, Pattern Analysis, Risk Assessment",
  "mission_scope": "Analyze threats and provide actionable intelligence recommendations",
  "interaction_style": "chat",
  "input_sources": ["signals", "incidents", "entities", "clients"],
  "output_types": ["analysis", "recommendations", "briefings"],
  "is_client_facing": false,
  "is_active": true,
  "avatar_color": "#3B82F6",
  "system_prompt": "You are Phoenix, a strategic intelligence advisor...",
  "requested_by": "user_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent \"Phoenix\" (PHOENIX-1) created successfully",
  "agent": {
    "id": "uuid",
    "codename": "Phoenix",
    "call_sign": "PHOENIX-1",
    ...
  },
  "audit_key": "agent_creation_uuid_timestamp"
}
```

**Features:**
- Auto-generates system prompt if not provided
- Includes real-world operational context (NOT simulation)
- Creates audit trail in intelligence_config table
- Validates required fields (codename, call_sign, persona, specialty, mission_scope)

---

### update-agent-configuration

Updates an existing AI agent's configuration.

**Endpoint:** `POST /update-agent-configuration`

**Request Body:**
```json
{
  "agent_id": "uuid",
  "updates": {
    "persona": "Updated persona description",
    "specialty": "New specialty areas",
    "system_prompt": "Updated system prompt",
    "is_active": true
  },
  "reason": "Configuration update for enhanced capabilities",
  "requested_by": "user_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent \"Phoenix\" configuration updated successfully",
  "agent": { ... },
  "changes": {
    "persona": {
      "from": "Old persona",
      "to": "Updated persona"
    }
  },
  "audit_key": "agent_config_audit_uuid_timestamp"
}
```

**Allowed update fields:**
- `codename`, `call_sign`, `header_name`
- `persona`, `specialty`, `mission_scope`
- `interaction_style`, `input_sources`, `output_types`
- `is_client_facing`, `is_active`, `avatar_color`
- `system_prompt`

---

### agent-chat

Sends a message to an AI agent for analysis and response.

**Endpoint:** `POST /agent-chat`

**Request Body:**
```json
{
  "agent_id": "uuid",
  "message": "Analyze the threat landscape for our financial sector clients",
  "conversation_history": [
    { "role": "user", "content": "Previous message" },
    { "role": "assistant", "content": "Previous response" }
  ]
}
```

**Response:**
```json
{
  "response": "Based on my analysis of recent signals and incidents...",
  "agent": {
    "id": "uuid",
    "codename": "Phoenix",
    "call_sign": "PHOENIX-1"
  }
}
```

**Context Gathered (based on agent's input_sources):**
- Recent signals (last 50)
- Active incidents
- Entities with high threat scores
- Client information
- Escalation rules
- Recent documents

---

### generate-agent-avatar

Generates an AI avatar image for an agent.

**Endpoint:** `POST /generate-agent-avatar`

**Request Body:**
```json
{
  "agent_id": "uuid",
  "agent_name": "Phoenix",
  "persona": "Strategic intelligence advisor",
  "specialty": "Threat Intelligence"
}
```

**Response:**
```json
{
  "success": true,
  "avatar_url": "https://storage.supabase.co/agent-avatars/uuid.png"
}
```

---

## AI Task Force Functions

### incident-agent-orchestrator

Orchestrates AI agents to investigate incidents as a coordinated task force.

**Endpoint:** `POST /incident-agent-orchestrator`

**Request Body:**
```json
{
  "incident_id": "uuid",
  "agent_call_sign": "LOCUS-INTEL",  // Optional - auto-selects if not provided
  "prompt": "Custom investigation prompt"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "agent": "LOCUS-INTEL",
  "analysis": "Full agent analysis text...",
  "investigation_focus": ["location analysis", "geographic patterns"],
  "incident_id": "uuid",
  "log_entry_count": 3
}
```

**Available Agents:**
| Call Sign | Specialty |
|-----------|-----------|
| `LOCUS-INTEL` | Location-based threat monitoring and geographic intelligence |
| `LEX-MAGNA` | Legal analysis and regulatory compliance |
| `GLOBE-SAGE` | Geopolitical analysis and strategic forecasting |
| `BIRD-DOG` | Pattern detection and behavioral analysis |
| `TIME-WARP` | Chronology reconstruction and temporal analysis |
| `PATTERN-SEEKER` | Pattern detection and investigative correlation |
| `AEGIS-CMD` | Incident response and protocol execution |

**Task Force Naming:**
When multiple agents are assigned (2+), the system automatically generates a task force name:
- Prefixes: "Task Force", "Operation", "Project", "Initiative", "Response Team"
- Examples: "Task Force Iron Shield", "Operation Phantom Storm", "Task Force Vigilant Eagle"

**What it does:**
1. Fetches incident with related signal and client data
2. Auto-selects appropriate agent based on incident characteristics (or uses specified agent)
3. Builds comprehensive investigation context
4. Calls AI with specialized system prompt for agent's focus area
5. Updates incident with:
   - `ai_analysis_log` (append analysis entry)
   - `timeline_json` (append investigation event)
   - `assigned_agent_ids` (add agent to list)
   - `task_force_name` (generated when 2+ agents assigned)
   - `investigation_status` (set to "in_progress")

---

### ai-decision-engine (Enhanced)

Enhanced AI decision engine with automatic incident creation and agent assignment.

**Endpoint:** `POST /ai-decision-engine`

**Request Body:**
```json
{
  "signalId": "uuid"
}
```

**Response:**
```json
{
  "decision": "escalate",
  "confidence": 0.92,
  "reasoning": "High severity threat detected...",
  "incident_created": true,
  "incident_id": "uuid",
  "initial_agent": "LOCUS-INTEL",
  "initial_agent_prompt": "Investigate location-based threats..."
}
```

**Enhanced Features:**
- Automatically creates incidents for high-severity signals
- Selects initial AI agent based on signal characteristics:
  - Location keywords → LOCUS-INTEL
  - Legal keywords → LEX-MAGNA
  - Geopolitical keywords → GLOBE-SAGE
  - Pattern keywords → BIRD-DOG
- Populates incident with:
  - AI-generated title and summary
  - Severity level assessment
  - Initial agent assignment
  - Investigation prompt
  - Initial `ai_analysis_log` entry

---

## Agent Database Schema

### ai_agents Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `codename` | TEXT | Unique agent codename (e.g., "Phoenix") |
| `call_sign` | TEXT | Unique tactical identifier (e.g., "PHOENIX-1") |
| `header_name` | TEXT | Display name in UI |
| `persona` | TEXT | Agent personality/character description |
| `specialty` | TEXT | Areas of expertise |
| `mission_scope` | TEXT | Operational mission parameters |
| `interaction_style` | TEXT | How agent communicates ("chat", "formal", etc.) |
| `input_sources` | TEXT[] | Data sources agent can access |
| `output_types` | TEXT[] | Types of output agent produces |
| `is_client_facing` | BOOLEAN | Whether agent interacts with external clients |
| `is_active` | BOOLEAN | Whether agent is operational |
| `avatar_color` | TEXT | Hex color for avatar |
| `avatar_image` | TEXT | URL to generated avatar image |
| `system_prompt` | TEXT | Full system prompt for AI model |
| `roe_id` | UUID | Link to Rules of Engagement |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |
| `created_by` | UUID | User who created agent |

### incidents Table (Task Force Fields)

| Column | Type | Description |
|--------|------|-------------|
| `task_force_name` | TEXT | Auto-generated task force name (e.g., "Task Force Iron Shield") |
| `investigation_status` | TEXT | Status: pending, in_progress, completed, escalated |
| `assigned_agent_ids` | UUID[] | Array of agent IDs investigating this incident |
| `ai_analysis_log` | JSONB | Chronological log of agent analyses |
| `initial_agent_prompt` | TEXT | Initial prompt used to dispatch first agent |

### ai_analysis_log Entry Structure

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "agent_id": "uuid",
  "agent_call_sign": "LOCUS-INTEL",
  "agent_specialty": "Location-based threat monitoring",
  "analysis": "Full analysis text from agent...",
  "investigation_focus": ["location analysis", "geographic patterns"],
  "prompt_used": "Truncated prompt..."
}
```
