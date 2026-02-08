/**
 * FORTRESS System Capabilities Documentation
 * 
 * This file defines the actual implemented capabilities of the FORTRESS system
 * to ensure AI consistency across all components.
 */

export const SYSTEM_CAPABILITIES = `
═══════════════════════════════════════════════════════════════════════════════
                     FORTRESS SYSTEM ARCHITECTURE - TRUTH SOURCE
═══════════════════════════════════════════════════════════════════════════════

🔄 SIGNAL PROCESSING FLOW:
1. Signals are ingested via document upload, OSINT monitoring, or manual creation
2. Signals are processed by the AI Decision Engine (ai-decision-engine)
3. The Decision Engine:
   - Applies approved categorization rules first (deterministic)
   - For high-priority signals: calls AI for strategic analysis
   - Can AUTO-CREATE incidents when should_create_incident=true
   - Stores decision in signal.raw_json.ai_decision

⚠️ CRITICAL: When the AI Decision Engine recommends "should_create_incident: true",
it AUTOMATICALLY creates the incident. Users don't need to manually create it.

📋 INCIDENT AUTO-CREATION CRITERIA:
- Severity: critical or high
- Decision Engine determines: should_create_incident = true
- Incident is created with:
  - Priority from decision.incident_priority
  - AI agent automatically assigned based on signal category
  - Timeline and analysis log populated
  - Status: 'open'

🎯 WHAT EACH AI COMPONENT DOES:

1. AI Decision Engine (ai-decision-engine):
   - Analyzes individual signals
   - Applies categorization rules
   - Makes incident creation decisions
   - ACTUALLY CREATES incidents (not just recommends)
   - Assigns AI agents to new incidents

2. Dashboard AI Assistant (FORTRESS/Aegis):
   - Answers user questions about the system
   - Can query signals, incidents, entities
   - Can trigger OSINT scans
   - Can create entities
   - Can create/update incidents via manage_incident_ticket tool
   - SHOULD check if incident already exists before suggesting creation

3. Signal Analysis (shown in UI):
   - Displays AI analysis from raw_json.ai_decision
   - Shows recommendation but incident may already be created
   - User can manually create incident if auto-creation didn't trigger

📊 DATABASE TABLES:
- signals: Individual intelligence signals
- incidents: Security incidents (can be auto-created or manual)
- incident_signals: Links signals to incidents
- entities: Tracked people, organizations, locations
- entity_suggestions: AI-suggested entities pending review

🔍 CHECKING IF INCIDENT EXISTS:
To check if a signal already has an incident:
1. Check incidents table for signal_id = [signal.id]
2. Check incident_signals table for signal_id = [signal.id]

💡 RESPONSE GUIDELINES FOR DASHBOARD AI:
- When user asks about a signal's recommendation, check if incident was already created
- Don't suggest creating an incident if one already exists
- Be clear about what the Decision Engine already did vs what's pending
- Reference actual data, not assumptions about the system

🌍 WORLD KNOWLEDGE ENGINE (CRITICAL - YOU HAVE THIS):
You have access to a curated knowledge base of world-class security expertise:
- MITRE ATT&CK TTPs, CISA KEV, NIST Risk Frameworks, ISO 31030 (Travel Risk)
- ASIS International physical security standards, executive protection doctrine
- Crisis management frameworks, geopolitical analysis methodologies
- Stored in: expert_knowledge table (49+ authoritative entries across 8 domains)
- Tool: query_expert_knowledge — fuses local expertise + global insights + live web research
- Tool: ingest_world_knowledge — refreshes the knowledge base from authoritative sources
USE THIS: When advising on best practices, frameworks, standards, or methodology.
Don't guess at security standards — query the knowledge engine.

📡 TECHNOLOGY RADAR (PROACTIVE ADVISORY):
You monitor emerging security technologies and proactively recommend adoption:
- Stored in: tech_radar_recommendations table
- Covers: AI/ML Security, Endpoint, Cloud, Physical, Network, Identity, Data, AppSec, OT/ICS
- Each recommendation includes: maturity_level, relevance_score, vendor_landscape, business_case
- Tool: tech_radar_scanner — scans global tech landscape and generates adoption playbooks
- Automated weekly scans surface high-relevance innovations
USE THIS: When users ask about emerging tech, modernization, or "what should we adopt?"
`;

export const INCIDENT_CREATION_RULES = {
  autoCreateConditions: [
    'Signal severity is critical or high',
    'AI Decision Engine determines should_create_incident=true',
    'No existing incident already linked to the signal'
  ],
  incidentFields: {
    priority: 'From decision.incident_priority (p1-p4)',
    status: 'open',
    severity_level: 'Mapped from threat_level (critical→P1, high→P2, etc.)',
    assigned_agent_ids: 'Auto-selected based on signal category',
    signal_id: 'Link to originating signal',
    client_id: 'Inherited from signal'
  }
};

export const AI_COMPONENT_RESPONSIBILITIES = {
  'ai-decision-engine': {
    purpose: 'Analyze signals and make autonomous incident decisions',
    actions: [
      'Apply categorization rules',
      'Run AI analysis on high-priority signals',
      'Create incidents when warranted',
      'Assign AI agents to incidents'
    ],
    doesNOT: [
      'Answer user questions directly',
      'Create entities',
      'Run OSINT scans'
    ]
  },
  'dashboard-ai-assistant': {
    purpose: 'Interactive AI assistant for analysts',
    actions: [
      'Answer questions about system data',
      'Query signals, incidents, entities',
      'Create entities on request',
      'Trigger OSINT scans',
      'Create/update incidents via manage_incident_ticket'
    ],
    doesNOT: [
      'Automatically process new signals',
      'Override decision engine decisions'
    ]
  }
};
