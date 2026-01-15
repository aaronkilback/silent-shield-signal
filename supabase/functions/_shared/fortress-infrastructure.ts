// Fortress Data Infrastructure Documentation
// This documentation is available to all AI agents and the dashboard assistant

export const FORTRESS_DATA_INFRASTRUCTURE = `
═══════════════════════════════════════════════════════════════════════════════
                    FORTRESS DATA INFRASTRUCTURE & CAPABILITIES
═══════════════════════════════════════════════════════════════════════════════

This document defines the operational parameters, data requirements, and integration 
architecture that underpins the Fortress Security Intelligence Platform.

═══════════════════════════════════════════════════════════════════════════════
                    1. DEFINED DATA REQUIREMENTS & INTEGRATIONS
═══════════════════════════════════════════════════════════════════════════════

📡 SENSOR & SOURCE MAPPING (Collection Plan):
┌──────────────────────────────────────────────────────────────────────────────┐
│ Data Type               │ Sources                    │ Update Frequency     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Satellite Imagery       │ Commercial providers       │ Daily/On-demand      │
│ Weather Data            │ Meteorological services    │ Hourly               │
│ Social Media            │ Twitter/X, Facebook, etc   │ Real-time streaming  │
│ News Feeds              │ RSS, APIs, Scrapers        │ 15-minute intervals  │
│ Government Bulletins    │ CSIS, DHS, RCMP feeds      │ As published         │
│ Dark Web Monitoring     │ Specialized OSINT tools    │ Continuous           │
│ Court Records           │ Registry scrapers          │ Daily                │
│ Corporate Filings       │ SEDAR, SEC, registries     │ Daily                │
│ Incident Reports        │ Client submissions         │ Real-time            │
│ Travel Advisories       │ GAC, State Dept, etc       │ As updated           │
└──────────────────────────────────────────────────────────────────────────────┘

🔌 API & CONNECTOR ARCHITECTURE:
- Dedicated engineering teams develop and maintain robust connectors
- Integrations with: meteorological services, government agencies, satellite providers,
  public incident reporting systems, social media APIs, news aggregators
- RESTful APIs and webhook receivers for external data providers
- OAuth2 and API key authentication for secure data access

🔒 SECURE PIPELINES:
- All data ingress points secured with TLS 1.3 encryption
- API key rotation and secrets management via vault
- Role-based access controls (RBAC) on all data endpoints
- Audit logging for all data access and modifications
- Network segmentation for sensitive data streams

═══════════════════════════════════════════════════════════════════════════════
                    2. AUTOMATED DATA INGESTION & VALIDATION
═══════════════════════════════════════════════════════════════════════════════

⚙️ CONTINUOUS ETL/ELT PROCESSES:
- Automated pipelines run continuously (24/7/365)
- Extract data from configured sources → Transform to standard schema → Load to data lake
- Edge functions handle real-time signal processing
- Batch processes handle large document ingestion
- Queue-based processing with priority handling (P1 incidents processed first)

✅ SCHEMA VALIDATION:
- All ingested data validated against predefined JSON schemas
- Automatic type coercion where safe
- Alerts triggered for: missing required fields, incorrect data types, schema violations
- Invalid records quarantined for human review

🔍 INTEGRITY CHECKS:
- SHA256 checksums for document deduplication
- Data profiling to detect anomalies (statistical outliers, unexpected patterns)
- Referential integrity validation (e.g., signal → client relationships)
- Content hash matching to prevent duplicate signal ingestion

⏱️ FRESHNESS & COMPLETENESS MONITORING:
- Automated monitors track last-received timestamps per source
- Expected volume thresholds configured per data type
- Anomaly detection for: missing data, delayed arrivals, volume drops
- Automatic alerts to operations team for intervention
- Source health dashboard with real-time status

═══════════════════════════════════════════════════════════════════════════════
                    3. REDUNDANCY & RESILIENCE
═══════════════════════════════════════════════════════════════════════════════

🔄 MULTIPLE DATA SOURCES:
- Critical data types sourced from multiple independent providers:
  • Weather: Environment Canada, NOAA, private forecasters
  • Geopolitical: Multiple news agencies, government sources
  • Social Media: Direct API access + third-party aggregators
- Failover logic switches to backup sources automatically
- No single point of failure for mission-critical intelligence

💾 BACKUP & RECOVERY:
- Point-in-time recovery (PITR) enabled for all databases
- Daily automated backups with 30-day retention
- Cross-region backup replication for disaster recovery
- Recovery Time Objective (RTO): < 4 hours
- Recovery Point Objective (RPO): < 1 hour
- Tested recovery procedures with quarterly drills

═══════════════════════════════════════════════════════════════════════════════
                    4. HUMAN-IN-THE-LOOP OVERSIGHT & CURATION
═══════════════════════════════════════════════════════════════════════════════

👥 DATA STEWARDS:
- Dedicated teams oversee data quality across all domains
- Responsibilities: ingestion failure resolution, metadata management, quality assurance
- Regular data quality audits and remediation campaigns
- Act as guardians ensuring AI systems receive accurate data

🕵️ INTELLIGENCE ANALYSTS:
- Monitor effectiveness of data collection continuously
- Identify emerging data needs based on evolving threats
- Curate datasets: refine entity profiles, add monitoring keywords
- Validate AI-generated insights before client dissemination
- Cross-reference automated findings with human expertise

🔁 FEEDBACK LOOPS:
- AI systems flag data anomalies and perceived gaps automatically
- Underperforming predictive models trigger data requirement reviews
- Analyst feedback incorporated into model retraining
- Continuous improvement cycle between human and AI systems
- Signals marked as false positives improve future classification

═══════════════════════════════════════════════════════════════════════════════
                    5. REAL-TIME MONITORING & ALERTING
═══════════════════════════════════════════════════════════════════════════════

📊 DASHBOARDS & KPIs:
- Operations dashboards display real-time metrics:
  • Signal ingestion rate (per minute/hour)
  • Processing latency (P50, P95, P99)
  • Source health status (green/yellow/red)
  • Error rates by category
  • AI model performance metrics
- Historical trend analysis for capacity planning

🚨 AUTOMATED ALERTS:
Immediate alerts triggered for:
- Critical pipeline failures (data ingestion stopped)
- Source connectivity issues (>5 minute timeout)
- Data quality threshold breaches (>5% validation errors)
- Processing backlogs (queue depth > threshold)
- AI model confidence drops (below acceptable thresholds)

Alert routing:
- P1: Immediate page to on-call engineer + Slack channel
- P2: Slack channel + email to team
- P3: Daily digest email

═══════════════════════════════════════════════════════════════════════════════
                    6. AVAILABLE DATA DOMAINS FOR QUERYING
═══════════════════════════════════════════════════════════════════════════════

📁 INTERNAL FORTRESS DATA (query_fortress_data tool):
┌──────────────────────────────────────────────────────────────────────────────┐
│ Domain              │ Description                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ signals             │ Raw intelligence signals from all sources             │
│ incidents           │ Escalated security incidents with SLA tracking        │
│ entities            │ Tracked people, organizations, locations, assets      │
│ clients             │ Client profiles, monitoring config, threat profiles   │
│ investigations      │ Case files, timelines, evidence chains                │
│ archival_documents  │ Uploaded documents with extracted content             │
│ ingested_documents  │ Processed intelligence documents                      │
│ monitoring_history  │ OSINT scan results and source check logs              │
│ itineraries         │ Travel tracking and risk assessments                  │
│ knowledge_base      │ Curated articles and procedures                       │
│ entity_relationships│ Connection mapping between entities                   │
│ entity_mentions     │ Signal/incident references to entities                │
└──────────────────────────────────────────────────────────────────────────────┘

🌐 EXTERNAL DATA SOURCES (perform_external_web_search tool):
- Real-time web search for events not in Fortress database
- News articles, press releases, social media posts
- Government announcements and regulatory filings
- Academic and research publications

═══════════════════════════════════════════════════════════════════════════════
                    OPERATIONAL GUARANTEE
═══════════════════════════════════════════════════════════════════════════════

By implementing these layers of technical infrastructure, automated processes, 
and human oversight, the Fortress platform ensures that AI agents receive:

✓ PRECISE data - validated, deduplicated, and schema-compliant
✓ TIMELY data - real-time ingestion with freshness monitoring  
✓ ACTIONABLE data - enriched with context and cross-references
✓ RELIABLE data - redundant sources with failover mechanisms
✓ SECURE data - encrypted, access-controlled, and audit-logged

This infrastructure enables confident, data-driven security intelligence operations.
`;

export const FORTRESS_AGENT_CAPABILITIES = `
═══════════════════════════════════════════════════════════════════════════════
                    FORTRESS AGENT OPERATIONAL CAPABILITIES
═══════════════════════════════════════════════════════════════════════════════

As a Fortress AI agent, you have access to the following operational capabilities:

🔍 DATA ACCESS:
- Query all internal Fortress data domains (signals, incidents, entities, etc.)
- Perform external web searches for information not in the database
- Access archival and ingested intelligence documents
- View entity relationships and cross-references
- Query monitoring history and source health

📝 DATA CREATION:
- Create new entities (people, organizations, locations, assets)
- Inject test signals for verification
- Create and update incident tickets
- Propose signal merges for deduplication
- Create investigation case files

🛡️ ANALYSIS:
- Run threat radar analysis with predictions
- Perform impact analysis on threats
- Trigger OSINT scans on entities
- Cross-reference entities across data sources
- Query internal asset and vulnerability context

⚙️ SYSTEM MANAGEMENT:
- Check monitoring source health
- Diagnose system issues
- View automation metrics
- Access escalation rule configurations
- Update agent configurations (for authorized agents)

🔄 COLLABORATION:
- Communicate with other Fortress agents
- Escalate queries to human analysts
- Access briefing query system for mission coordination
- Share findings across investigation teams

All operations are logged for audit purposes and subject to role-based access controls.
`;
