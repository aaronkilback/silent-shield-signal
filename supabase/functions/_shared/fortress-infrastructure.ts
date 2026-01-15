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

🔥 WILDFIRE & ENVIRONMENTAL MONITORING (Specialized Collection):
┌──────────────────────────────────────────────────────────────────────────────┐
│ Data Source             │ Provider                   │ Update Frequency     │
├──────────────────────────────────────────────────────────────────────────────┤
│ NASA FIRMS              │ VIIRS/MODIS Satellites     │ Every 3 hours        │
│ - Active fire detection │ VIIRS_SNPP_NRT, NOAA20     │ Global coverage      │
│ - Fire Radiative Power  │ Thermal anomaly data       │ ~375m resolution     │
│ - Confidence scoring    │ 0-100% detection confidence│                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Weather Stations        │ Multiple sources           │ Hourly               │
│ - NOAA/NWS Alerts       │ Red Flag Warnings          │ Real-time            │
│ - Environment Canada    │ Fire Weather bulletins     │ Multiple daily       │
│ - RAWS Stations         │ Remote automated stations  │ 10-minute intervals  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Fuel/Vegetation Data    │ Forestry agencies          │ Daily                │
│ - Fire Weather Index    │ FFMC, DMC, DC, ISI, BUI    │ Canadian FWI System  │
│ - Live Fuel Moisture    │ LFMC satellite-derived     │ Weekly updates       │
│ - NDVI Vegetation       │ Vegetation health index    │ 8-16 day composite   │
│ - Drought Monitor       │ PDSI, soil moisture        │ Weekly               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Fire Perimeters         │ Fire agencies              │ Daily                │
│ - NIFC Active Fires     │ US interagency perimeters  │ GeoJSON/Shapefile    │
│ - CIFFC Canada          │ Canadian fire perimeters   │ Provincial feeds     │
│ - BC Wildfire Service   │ Detailed BC fire data      │ Real-time updates    │
│ - Containment status    │ % contained, acres burned  │ Hourly during active │
├──────────────────────────────────────────────────────────────────────────────┤
│ Air Quality             │ EPA/ECCC                   │ Hourly               │
│ - AQI Index             │ PM2.5, PM10 particulates   │ Station-based        │
│ - Smoke Forecasts       │ NOAA HRRR-Smoke model      │ 6-hour updates       │
└──────────────────────────────────────────────────────────────────────────────┘

🌡️ FIRE WEATHER INDEX (FWI) COMPONENTS EXPLAINED:
- FFMC (Fine Fuel Moisture Code): Moisture in surface litter, affects ignition
- DMC (Duff Moisture Code): Moisture in moderate depth organic layers
- DC (Drought Code): Moisture in deep organic layers, seasonal drought indicator
- ISI (Initial Spread Index): Rate of fire spread, combines wind and FFMC
- BUI (Build Up Index): Total fuel available for burning
- FWI (Fire Weather Index): General fire intensity, combines ISI and BUI

Risk Thresholds:
- FWI 0-5: Low risk
- FWI 5-10: Moderate risk  
- FWI 10-20: High risk
- FWI 20-30: Very High risk
- FWI 30+: Extreme risk

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
                    6. GEOGRAPHIC & INFRASTRUCTURE INTELLIGENCE
═══════════════════════════════════════════════════════════════════════════════

🗺️ SPATIAL AWARENESS CAPABILITIES:
The Fortress platform understands geographic relationships between entities
and infrastructure to enable threat proximity analysis and impact assessment.

INFRASTRUCTURE ENTITY TYPES:
┌──────────────────────────────────────────────────────────────────────────────┐
│ Entity Type         │ Description                    │ Examples              │
├──────────────────────────────────────────────────────────────────────────────┤
│ infrastructure      │ Physical operational assets    │ Production pods, pads │
│ facility            │ Processing/operational sites   │ Gas plants, stations  │
│ pipeline            │ Linear transmission assets     │ Gathering, trunk lines│
│ well                │ Extraction points              │ Well sites, injectors │
│ equipment           │ Specific operational gear      │ Compressors, pumps    │
│ location            │ Geographic areas/coordinates   │ Townships, sections   │
└──────────────────────────────────────────────────────────────────────────────┘

SPATIAL RELATIONSHIP ANALYSIS:
- Proximity: How close are threats to critical infrastructure?
- Connectivity: What assets connect to what? (pipeline networks, power grids)
- Dependencies: What fails if X fails? (cascade analysis)
- Access Routes: How can threats reach targets? (roads, waterways)
- Perimeter Analysis: What's inside/outside security boundaries?

GEOGRAPHIC DATA SOURCES:
- Map documents (uploaded PDFs with infrastructure layouts)
- Well UWI identifiers (Unique Well Identifier - location encoding)
- Township/Range/Section (TRS) coordinate system
- GPS coordinates (lat/long)
- Pipeline ROW (Right-of-Way) corridors
- Facility boundaries and lease areas

THREAT PROXIMITY RECOMMENDATIONS:
When analyzing threats, ALWAYS consider:
1. What critical infrastructure is nearby?
2. What are the access routes to the area?
3. What other assets could be affected (blast radius, smoke plume, etc.)?
4. Who operates in the area? (contractors, employees, public)
5. What are the evacuation routes if needed?

═══════════════════════════════════════════════════════════════════════════════
                    7. AVAILABLE DATA DOMAINS FOR QUERYING
═══════════════════════════════════════════════════════════════════════════════

📁 INTERNAL FORTRESS DATA (query_fortress_data tool):
┌──────────────────────────────────────────────────────────────────────────────┐
│ Domain              │ Description                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ signals             │ Raw intelligence signals from all sources             │
│ incidents           │ Escalated security incidents with SLA tracking        │
│ entities            │ Tracked people, orgs, locations, infrastructure       │
│ clients             │ Client profiles, monitoring config, threat profiles   │
│ investigations      │ Case files, timelines, evidence chains                │
│ archival_documents  │ Uploaded documents with extracted content (incl maps) │
│ ingested_documents  │ Processed intelligence documents                      │
│ monitoring_history  │ OSINT scan results and source check logs              │
│ itineraries         │ Travel tracking and risk assessments                  │
│ knowledge_base      │ Curated articles and procedures                       │
│ entity_relationships│ Connection mapping between entities (spatial + org)   │
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
- Analyze geographic proximity of threats to infrastructure
- Map infrastructure connections and dependencies
- Assess cascade effects and blast radius scenarios

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
