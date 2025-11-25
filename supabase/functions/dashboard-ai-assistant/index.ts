import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Enhanced system prompt for Phase 4: Intent Recognition & Contextual Understanding
const ENHANCED_SYSTEM_PROMPT = `You are an advanced AI security co-pilot for Fortress, a threat intelligence platform. You have sophisticated natural language understanding and can handle complex, multi-part queries with context awareness.

CRITICAL CAPABILITIES - PHASE 4 ENHANCEMENTS:

1. INTENT RECOGNITION & CONTEXTUAL UNDERSTANDING:
   - Parse complex, ambiguous, or multi-step requests intelligently
   - Maintain conversation context across multiple turns
   - Proactively ask clarifying questions when user intent is unclear
   - Handle implicit requests and infer missing information from context
   - Support natural follow-ups like "What about that other client?" or "Do the same for critical signals"

2. AUTOMATED IMPACT ANALYSIS:
   - Use perform_impact_analysis tool to quantify threat impact
   - Provide probabilistic financial cost ranges based on client context
   - Calculate dynamic risk scores considering asset criticality
   - Analyze cascading effects across interconnected systems
   - Update entity risk profiles with update_risk_profile tool

3. PLAYBOOK INTEGRATION & ACTIONABLE RESPONSE:
   - Recommend appropriate security playbooks using recommend_playbook
   - Generate specific response tasks with draft_response_tasks
   - Integrate with incident management using integrate_incident_management
   - Create or update incidents with pre-populated tasks and priorities

INTERACTION GUIDELINES:
- If a query is ambiguous, ask targeted follow-up questions rather than stating inability
- Build on previous conversation context without requiring users to repeat information
- Offer proactive suggestions based on analysis results
- When presenting risk scores, always explain contributing factors
- For high-risk scenarios, automatically suggest playbooks and response tasks
- Present impact analysis in business terms (P.R.A.: People, Reputation, Assets)

EXAMPLE MULTI-TURN CONVERSATIONS:
User: "What's the impact of that critical cyber signal from yesterday?"
AI: [Searches recent critical cyber signals, performs impact analysis, presents risk score with breakdown]

User: "Should we create an incident for it?"
AI: [Uses signal from previous context, recommends playbook, drafts response tasks, asks for approval to create incident]

User: "Yes, make it high priority"
AI: [Creates incident with high priority, pre-populated tasks, confirms creation]

Always prioritize clarity, actionability, and security posture improvement.`;

// Tool definitions for querying the database
const tools = [
  {
    type: "function",
    function: {
      name: "get_recent_signals",
      description: "Get recent security signals from the system. Use this when users ask about signals, threats, or recent activity.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of signals to return (default 10)",
          },
          client_id: {
            type: "string",
            description: "Filter by client - can be either a UUID or client name (will search by name)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_entities",
      description: "Search for entities (people, organizations, locations). Use this when users ask to find a specific person or entity.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for entity name",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inject_test_signal",
      description: "Inject a test signal into the system for verification purposes. This creates a signal that will be processed through the full ingestion pipeline including rule application.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The signal text content (e.g., 'BREAKING: Energy pipeline faces protest blockade')",
          },
          client_id: {
            type: "string",
            description: "Client UUID to associate this signal with",
          },
          severity: {
            type: "string",
            description: "Severity level: critical, high, medium, or low (default: medium)",
            enum: ["critical", "high", "medium", "low"],
          },
          category: {
            type: "string",
            description: "Initial category (will be overridden by rules if they match)",
          },
        },
        required: ["text", "client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_incidents",
      description: "Get currently active security incidents. Use this when users ask about ongoing incidents or incident status.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of incidents to return (default 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_investigations",
      description: "Search investigation files. Use this when users ask about investigations or case files.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for investigation file number or content",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clients",
      description: "Search for client accounts. Use this when users ask about clients or organizations.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for client name",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_client_details",
      description: "Get detailed client information including monitoring keywords, tracked entities, high-value assets, and risk profile. Use this to understand what a client is monitoring and to inform OSINT scans.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Client UUID or name to search for",
          },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monitoring_status",
      description: "Check monitoring scan status and history. Use this when users ask if monitors are working, about scan failures, or system health.",
      parameters: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "Number of hours to look back (default 24)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_health",
      description: "Get overall system health metrics including automation performance, error rates, and throughput. Use when troubleshooting system issues.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to analyze (default 7)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_issues",
      description: "Analyze recent errors and failed scans to identify problems. Use when troubleshooting or when users report issues.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent errors to analyze (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_signals_by_entity",
      description: "Search for signals related to a specific entity or person. Use this when users ask about threats, hazards, or signals related to a person or organization.",
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Name of the entity or person to search for",
          },
          limit: {
            type: "number",
            description: "Number of signals to return (default 20)",
          },
        },
        required: ["entity_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_osint_scan",
      description: "Trigger an OSINT (Open Source Intelligence) scan for a specific entity. This searches the web for information about the entity and creates intelligence content. Use this when users want to gather intelligence or perform research on a person or organization.",
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Name of the entity to scan",
          },
        },
        required: ["entity_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_database_issues",
      description: "Analyze the database for common issues like duplicate signals, orphaned records, and data quality problems. Use this when users ask about database issues, duplicates, or system data integrity.",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            enum: ["duplicates", "orphaned_records", "data_quality", "all"],
            description: "Type of issue to analyze for (default: all)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fix_duplicate_signals",
      description: "Merge or remove duplicate signals identified in the system. Use after analyzing duplicates.",
      parameters: {
        type: "object",
        properties: {
          signal_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of duplicate signal IDs to fix",
          },
          action: {
            type: "string",
            enum: ["merge", "mark_as_duplicate", "delete_duplicates"],
            description: "Action to take on duplicates",
          },
          keep_signal_id: {
            type: "string",
            description: "ID of the signal to keep when merging (optional, uses first if not specified)",
          },
        },
        required: ["signal_ids", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_signal_quality",
      description: "Analyze signal quality metrics and identify low-quality or potentially false positive signals. Use for data quality reviews.",
      parameters: {
        type: "object",
        properties: {
          days_back: {
            type: "number",
            description: "Number of days to analyze (default 7)",
          },
          min_confidence: {
            type: "number",
            description: "Minimum confidence threshold 0-1 (default 0.5)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the knowledge base for articles, procedures, best practices, and documentation. Use this when users ask questions about how to do something, need guidance, or want to reference documentation.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for article title, content, or tags",
          },
          category_id: {
            type: "string",
            description: "Optional: Filter by specific category UUID",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_knowledge_base_categories",
      description: "Get all knowledge base categories to understand available topics and organization. Use when users want to browse or understand what documentation is available.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_database_schema",
      description: "Get information about database tables, columns, relationships, and their purposes. Use when users ask about data structure, how features are implemented, or what data is stored.",
      parameters: {
        type: "object",
        properties: {
          table_name: {
            type: "string",
            description: "Optional: specific table name to get detailed column info for",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_edge_functions",
      description: "List all available edge functions and their purposes. Use when users ask about backend functionality, automation, or how specific features work.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_feature",
      description: "Explain how a specific platform feature works, its components, data flow, and implementation. Use when users ask how features are designed or implemented.",
      parameters: {
        type: "object",
        properties: {
          feature_name: {
            type: "string",
            description: "Name of the feature (e.g., 'signals', 'incidents', 'entities', 'travel', 'investigations', 'monitoring')",
          },
        },
        required: ["feature_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_architecture",
      description: "Get overview of the platform's architecture, technology stack, and how components interact. Use when users ask about the overall system design or technical implementation.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_security_reports",
      description: "Get security reports including executive intelligence summaries and 72-hour snapshots. Use this when users ask about security reports, summaries, or generated intelligence reports.",
      parameters: {
        type: "object",
        properties: {
          report_type: {
            type: "string",
            description: "Type of report to retrieve (e.g., 'executive_intelligence', '72h-snapshot', or omit for all types)",
          },
          limit: {
            type: "number",
            description: "Number of reports to return (default 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_report_content",
      description: "Get the full content of a specific security report by ID. Use this to read the detailed content of a report.",
      parameters: {
        type: "object",
        properties: {
          report_id: {
            type: "string",
            description: "The UUID of the report to retrieve",
          },
        },
        required: ["report_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_report_images",
      description: "Import images from a security report into Fortress storage. Use this when users want to save report images for reference or analysis.",
      parameters: {
        type: "object",
        properties: {
          report_id: {
            type: "string",
            description: "The UUID of the report containing images",
          },
          image_indices: {
            type: "array",
            items: { type: "number" },
            description: "Array of image indices to import (0-based). Omit to import all images.",
          },
        },
        required: ["report_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_archival_documents",
      description: "Search uploaded intelligence documents and reports (e.g., from 3Si, client reports, threat assessments). Use this when users ask about uploaded documents, intelligence reports they've shared, or want to find specific document content.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for filename or content",
          },
          client_id: {
            type: "string",
            description: "Optional: Filter by client UUID",
          },
          limit: {
            type: "number",
            description: "Number of documents to return (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_document_content",
      description: "Get the full text content of an uploaded archival document. Use this to read and analyze the content of intelligence reports, threat assessments, and other uploaded documents.",
      parameters: {
        type: "object",
        properties: {
          document_id: {
            type: "string",
            description: "The UUID of the document to retrieve",
          },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_entity",
      description: "Create a new entity (person, organization, location) in the system. Use this when users mention entities that don't exist yet, or before triggering OSINT scans on new entities.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Entity name",
          },
          type: {
            type: "string",
            enum: ["person", "organization", "location", "vehicle", "ip_address", "domain", "phone", "email", "cryptocurrency_wallet"],
            description: "Type of entity",
          },
          description: {
            type: "string",
            description: "Optional description of the entity",
          },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Optional alternative names or aliases",
          },
        },
        required: ["name", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_intelligence_documents",
      description: "Read and analyze newly created or existing OSINT intelligence documents. Use this to summarize intelligence items, extract key entities, and correlate new information with existing signals. CRITICAL: Use this immediately after triggering OSINT scans or when users ask about recent intelligence.",
      parameters: {
        type: "object",
        properties: {
          document_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of document IDs to read (optional - if omitted, reads recent documents)",
          },
          entity_id: {
            type: "string",
            description: "Filter by entity ID to read intelligence for a specific entity",
          },
          limit: {
            type: "number",
            description: "Number of documents to read (default 10, max 50)",
          },
          hours_back: {
            type: "number",
            description: "How many hours back to look for recent documents (default 24)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_signal_duplicates",
      description: "Detect duplicate or near-duplicate signals using content hashing and AI-powered similarity scoring. Use this to identify and analyze signals that may be duplicates before taking action.",
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "Specific signal ID to check for duplicates",
          },
          threshold: {
            type: "number",
            description: "Similarity threshold 0-1 (default 0.85 = 85% similar)",
          },
          limit: {
            type: "number",
            description: "Number of potential duplicates to return (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_feed_errors",
      description: "Diagnose RSS feed errors with detailed HTTP diagnostics, connectivity tests, and configuration suggestions. Use this when troubleshooting monitoring source failures.",
      parameters: {
        type: "object",
        properties: {
          source_name: {
            type: "string",
            description: "Specific RSS source name to diagnose (optional)",
          },
          include_successful: {
            type: "boolean",
            description: "Include successfully working feeds for comparison (default false)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_ai_feedback",
      description: "Record structured feedback to help improve AI accuracy and relevance. Use when users correct AI outputs, rate results, or provide guidance on signal/entity relevance.",
      parameters: {
        type: "object",
        properties: {
          object_id: {
            type: "string",
            description: "ID of the object being rated (signal, entity, content, etc)",
          },
          object_type: {
            type: "string",
            enum: ["signal", "entity", "entity_content", "osint_result", "classification"],
            description: "Type of object being rated",
          },
          feedback: {
            type: "string",
            enum: ["positive", "negative", "neutral"],
            description: "Feedback rating",
          },
          notes: {
            type: "string",
            description: "Detailed feedback notes explaining the rating",
          },
          correction: {
            type: "string",
            description: "If negative feedback, what the correct result should be",
          },
        },
        required: ["object_id", "object_type", "feedback"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_improvements",
      description: "Analyze the platform and suggest improvements for security, performance, features, or code quality. Use this when users ask how to improve the platform or want suggestions.",
      parameters: {
        type: "object",
        properties: {
          area: {
            type: "string",
            enum: ["security", "performance", "features", "monitoring", "ui", "all"],
            description: "Area to focus improvements on (default: all)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_client_monitoring_config",
      description: "Read client monitoring configurations including keywords, RSS sources, competitor names, and source health status. Use this to understand current monitoring setup and identify optimization opportunities.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Client UUID or name to read config for",
          },
          include_sources: {
            type: "boolean",
            description: "Include detailed RSS/OSINT source information (default true)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_monitoring_adjustments",
      description: "Proactively suggest optimizations to client monitoring configurations: add/modify/remove keywords, adjust sources, prioritize feeds. Suggestions require human approval. Use this to reduce noise and improve signal relevance.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Client UUID to suggest adjustments for",
          },
          analysis_summary: {
            type: "string",
            description: "Summary of why these adjustments are recommended",
          },
          keyword_changes: {
            type: "object",
            description: "Suggested keyword modifications",
            properties: {
              add: { type: "array", items: { type: "string" } },
              remove: { type: "array", items: { type: "string" } },
              modify: { type: "array", items: { 
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" }
                }
              }},
            },
          },
          source_changes: {
            type: "object",
            description: "Suggested source modifications",
            properties: {
              disable: { type: "array", items: { type: "string" } },
              prioritize: { type: "array", items: { type: "string" } },
            },
          },
        },
        required: ["client_id", "analysis_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_signal_patterns",
      description: "Analyze historical signal data to identify patterns for automated categorization and routing. Examines signal sources, keywords, classifications, and analyst actions to find automation opportunities.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Optional: Focus analysis on specific client",
          },
          days_back: {
            type: "number",
            description: "Number of days of history to analyze (default 30)",
          },
          min_confidence: {
            type: "number",
            description: "Minimum pattern confidence threshold 0-1 (default 0.75)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_categorization_rules",
      description: "Propose automated signal categorization and routing rules based on historical patterns. Rules can auto-categorize signals, apply tags, or route to teams. Requires human review before deployment.",
      parameters: {
        type: "object",
        properties: {
          rule_type: {
            type: "string",
            enum: ["categorization", "tagging", "routing", "all"],
            description: "Type of rules to suggest (default: all)",
          },
          pattern_source: {
            type: "string",
            description: "Source of patterns (e.g., 'RSS Feed X always contains Y category')",
          },
          confidence_threshold: {
            type: "number",
            description: "Minimum confidence for rule suggestions 0-1 (default 0.8)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_rule_proposal",
      description: "Submit a fully pre-defined signal categorization/routing rule for human review and approval. Use this when you have formulated a specific rule that should be implemented (e.g., based on client requirements, threat patterns, or operational needs). The rule will be stored in pending status until approved by a human.",
      parameters: {
        type: "object",
        properties: {
          rule_name: {
            type: "string",
            description: "Unique identifier for the rule (e.g., 'RULE_PhysicalSecurity_Protest_Energy')",
          },
          description: {
            type: "string",
            description: "Clear description of what the rule does and why it's needed",
          },
          conditions: {
            type: "object",
            description: "Trigger conditions as JSON (e.g., {keywords: ['protest', 'demonstration'], client_industry: 'energy', source_type: 'news'})",
          },
          actions: {
            type: "object",
            description: "Actions to perform when triggered (e.g., {set_category: 'physical_security', add_tags: ['protest', 'alert'], route_to_team: 'security_ops', set_priority: 'high'})",
          },
          rationale: {
            type: "string",
            description: "Why this rule is important and the business/security justification",
          },
          estimated_impact: {
            type: "string",
            description: "Expected impact on operations (e.g., 'Will auto-categorize ~50 signals/month, reducing manual triage time by 30%')",
          },
          confidence_threshold: {
            type: "number",
            description: "Confidence level for this rule 0-1 (default 0.85)",
          },
        },
        required: ["rule_name", "description", "conditions", "actions", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_cross_client_threats",
      description: "Detect emerging threat patterns that span multiple clients. Identifies recurring themes, TTPs, IOCs, and threat actor focus shifts across the entire signal repository for early warning.",
      parameters: {
        type: "object",
        properties: {
          time_window_days: {
            type: "number",
            description: "Days of data to analyze (default 14)",
          },
          min_client_count: {
            type: "number",
            description: "Minimum number of clients affected to flag pattern (default 2)",
          },
          threat_categories: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Focus on specific threat categories",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_signal_anomalies",
      description: "Identify anomalous signal clusters: unusual spikes in activity, mentions of new vulnerabilities, or sudden shifts in threat actor focus. Flags patterns that deviate from baseline.",
      parameters: {
        type: "object",
        properties: {
          detection_type: {
            type: "string",
            enum: ["volume_spike", "new_keywords", "geographic_shift", "all"],
            description: "Type of anomaly to detect (default: all)",
          },
          baseline_days: {
            type: "number",
            description: "Days to use for baseline comparison (default 30)",
          },
          sensitivity: {
            type: "number",
            description: "Detection sensitivity 1-10, higher=more sensitive (default 7)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_edge_function_template",
      description: "Generate a template for a new Supabase edge function. Use this when users want to add new monitoring sources or backend functionality.",
      parameters: {
        type: "object",
        properties: {
          function_name: {
            type: "string",
            description: "Name of the function (e.g., 'monitor-reddit')",
          },
          purpose: {
            type: "string",
            description: "What the function should do (e.g., 'Monitor Reddit for mentions of client keywords')",
          },
        },
        required: ["function_name", "purpose"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_platform_capabilities",
      description: "Analyze what the platform can and cannot do, and suggest new capabilities. Use when users ask about platform limitations or potential features.",
      parameters: {
        type: "object",
        properties: {
          capability_type: {
            type: "string",
            enum: ["monitoring", "analysis", "automation", "reporting", "integration", "all"],
            description: "Type of capability to analyze (default: all)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_bug_reports",
      description: "Search bug reports submitted by users. Use this to find known issues, track bug status, or investigate reported problems.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for bug title or description",
          },
          status: {
            type: "string",
            enum: ["open", "in_progress", "resolved", "closed"],
            description: "Filter by bug status",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Filter by severity level",
          },
          limit: {
            type: "number",
            description: "Number of results to return (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bug_report_details",
      description: "Get detailed information about a specific bug report including description, screenshots, browser info, and resolution status.",
      parameters: {
        type: "object",
        properties: {
          bug_id: {
            type: "string",
            description: "The UUID of the bug report",
          },
        },
        required: ["bug_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_edge_function_errors",
      description: "Analyze edge function logs to identify errors, failures, and potential issues. Use this to debug backend problems.",
      parameters: {
        type: "object",
        properties: {
          function_name: {
            type: "string",
            description: "Specific edge function to analyze (optional, analyzes all if not specified)",
          },
          hours_back: {
            type: "number",
            description: "How many hours of logs to analyze (default 24)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_bug",
      description: "Perform comprehensive bug diagnosis by analyzing symptoms, logs, related code, and suggesting root causes. Use when investigating a reported issue.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Description of the bug or issue",
          },
          error_message: {
            type: "string",
            description: "Any error messages or stack traces (optional)",
          },
          affected_area: {
            type: "string",
            description: "Which part of the app is affected (e.g., 'signals page', 'monitoring', 'entity scan')",
          },
        },
        required: ["description", "affected_area"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_code_fix",
      description: "Analyze a bug and provide detailed code fix suggestions with explanations. Use after diagnosing the issue.",
      parameters: {
        type: "object",
        properties: {
          bug_description: {
            type: "string",
            description: "Description of the bug to fix",
          },
          root_cause: {
            type: "string",
            description: "Identified root cause of the issue",
          },
          affected_files: {
            type: "array",
            items: { type: "string" },
            description: "List of files that need changes",
          },
        },
        required: ["bug_description", "root_cause"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_fix_proposal",
      description: "Create a fix proposal for a bug and store it in the database. Include detailed fix strategy, code changes, and implementation steps. Use this after diagnosing a bug to propose a solution for user approval.",
      parameters: {
        type: "object",
        properties: {
          bug_id: {
            type: "string",
            description: "The UUID of the bug report (optional - if not provided, creates new bug report)",
          },
          title: {
            type: "string",
            description: "Title of the bug if creating new report",
          },
          description: {
            type: "string",
            description: "Description of the bug if creating new report",
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Severity level if creating new report",
          },
          root_cause: {
            type: "string",
            description: "Identified root cause of the issue",
          },
          fix_strategy: {
            type: "string",
            description: "Overall strategy for fixing the bug",
          },
          code_changes: {
            type: "array",
            items: { 
              type: "object",
              properties: {
                file: { type: "string" },
                change: { type: "string" },
                example: { type: "string" }
              }
            },
            description: "Array of code changes needed",
          },
          affected_files: {
            type: "array",
            items: { type: "string" },
            description: "List of files that need to be modified",
          },
          testing_steps: {
            type: "array",
            items: { type: "string" },
            description: "Steps to test the fix",
          },
        },
        required: ["root_cause", "fix_strategy", "code_changes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perform_impact_analysis",
      description: "Perform comprehensive impact analysis on a signal, calculating risk scores, financial impact, operational disruption, and cascading effects. Use this to quantify threat severity for prioritization and resource allocation.",
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "UUID of the signal to analyze",
          },
          threat_actor_id: {
            type: "string",
            description: "Optional: UUID of threat actor entity if known",
          },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_risk_profile",
      description: "Update an entity's risk profile with new threat score and risk level. Use after impact analysis or when new intelligence changes risk assessment.",
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "UUID of the entity to update",
          },
          risk_score: {
            type: "number",
            description: "New risk score (0-100)",
          },
          justifications: {
            type: "array",
            items: { type: "string" },
            description: "Reasons for risk score change",
          },
        },
        required: ["entity_id", "risk_score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_playbook",
      description: "Recommend appropriate security playbooks based on signal characteristics and client context. Use when planning incident response.",
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "UUID of the signal",
          },
          client_context: {
            type: "string",
            description: "Optional: Additional client context for better recommendations",
          },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_response_tasks",
      description: "Generate specific, actionable response tasks based on a playbook and signal. Use to create detailed incident response plans.",
      parameters: {
        type: "object",
        properties: {
          playbook_id: {
            type: "string",
            description: "UUID of the playbook to use",
          },
          signal_id: {
            type: "string",
            description: "UUID of the signal requiring response",
          },
        },
        required: ["playbook_id", "signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "integrate_incident_management",
      description: "Create or update an incident with pre-populated tasks and priority. Use to operationalize response plans after user approval.",
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "UUID of the signal",
          },
          task_list: {
            type: "array",
            items: { type: "object" },
            description: "Array of response tasks",
          },
          incident_priority: {
            type: "string",
            enum: ["p1", "p2", "p3", "p4"],
            description: "Incident priority level",
          },
        },
        required: ["signal_id", "task_list"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_signal_merge",
      description: "Propose merging duplicate or near-duplicate signals. Use when you identify signals that appear to be duplicates based on content similarity, source, or entity mentions. This creates a proposal for human review before executing the merge.",
      parameters: {
        type: "object",
        properties: {
          primary_signal_id: {
            type: "string",
            description: "UUID of the signal to keep (primary/canonical signal)",
          },
          duplicate_signal_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of UUIDs of duplicate signals to merge into the primary",
          },
          similarity_scores: {
            type: "array",
            items: { type: "number" },
            description: "Array of similarity scores (0-1) for each duplicate, matching order of duplicate_signal_ids",
          },
          rationale: {
            type: "string",
            description: "Explanation of why these signals should be merged (detection method, similarity reasoning)",
          },
        },
        required: ["primary_signal_id", "duplicate_signal_ids"],
      },
    },
  },
];

// Execute tools by querying Supabase
async function executeTool(toolName: string, args: any, supabaseClient: any) {
  console.log(`Executing tool: ${toolName}`, JSON.stringify(args));

  try {
    switch (toolName) {
    case "get_recent_signals": {
      let query = supabaseClient
        .from("signals")
        .select("id, title, description, severity, received_at, status, client_id, clients(name)")
        .order("received_at", { ascending: false })
        .limit(args.limit || 10);

      if (args.client_id) {
        // Check if it's a valid UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        
        if (uuidRegex.test(args.client_id)) {
          // It's a UUID, use directly
          query = query.eq("client_id", args.client_id);
        } else {
          // It's likely a client name, look it up first
          const { data: client, error: clientError } = await supabaseClient
            .from("clients")
            .select("id")
            .ilike("name", `%${args.client_id}%`)
            .limit(1)
            .single();
          
          if (clientError || !client) {
            return { 
              message: `No client found matching "${args.client_id}"`,
              signals: [] 
            };
          }
          
          query = query.eq("client_id", client.id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    case "search_entities": {
      const { data, error } = await supabaseClient
        .from("entities")
        .select("id, name, type, description, risk_level, threat_score, current_location")
        .ilike("name", `%${args.query}%`)
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "get_active_incidents": {
      const { data, error } = await supabaseClient
        .from("incidents")
        .select("id, title, status, priority, severity_level, opened_at, client_id, clients(name)")
        .in("status", ["open", "investigating", "contained"])
        .order("opened_at", { ascending: false })
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "search_investigations": {
      const { data, error } = await supabaseClient
        .from("investigations")
        .select("id, file_number, synopsis, file_status, created_at, client_id, clients(name)")
        .or(`file_number.ilike.%${args.query}%,synopsis.ilike.%${args.query}%`)
        .limit(args.limit || 10);

      if (error) throw error;
      return data;
    }

    case "search_clients": {
      const { data, error } = await supabaseClient
        .from("clients")
        .select("id, name, industry, status, locations")
        .ilike("name", `%${args.query}%`)
        .limit(10);

      if (error) throw error;
      return data;
    }

    case "get_client_details": {
      // Check if it's a UUID or name
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let query = supabaseClient.from("clients").select(`
        id, 
        name, 
        industry, 
        status, 
        locations, 
        monitoring_keywords,
        monitoring_config,
        high_value_assets,
        competitor_names,
        supply_chain_entities,
        risk_assessment,
        threat_profile,
        contact_email,
        employee_count
      `);
      
      if (uuidRegex.test(args.client_id)) {
        query = query.eq("id", args.client_id);
      } else {
        query = query.ilike("name", `%${args.client_id}%`);
      }
      
      const { data: clients, error: clientError } = await query.limit(1).maybeSingle();
      
      if (clientError) throw clientError;
      if (!clients) {
        return {
          success: false,
          message: `No client found matching "${args.client_id}"`
        };
      }
      
      // Get related entities for this client
      const { data: signals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, auto_correlated_entities")
        .eq("client_id", clients.id)
        .not("auto_correlated_entities", "is", null)
        .limit(100);
      
      // Extract unique entity IDs from signals
      const entityIds = new Set<string>();
      if (signals) {
        signals.forEach((signal: any) => {
          if (signal.auto_correlated_entities) {
            signal.auto_correlated_entities.forEach((id: string) => entityIds.add(id));
          }
        });
      }
      
      // Get entity names for these IDs
      let relatedEntities: any[] = [];
      if (entityIds.size > 0) {
        const { data: entities } = await supabaseClient
          .from("entities")
          .select("id, name, type, risk_level")
          .in("id", Array.from(entityIds))
          .limit(50);
        
        relatedEntities = entities || [];
      }
      
      return {
        success: true,
        client: clients,
        monitoring_keywords: clients.monitoring_keywords || [],
        high_value_assets: clients.high_value_assets || [],
        competitor_names: clients.competitor_names || [],
        supply_chain_entities: clients.supply_chain_entities || [],
        related_entities: relatedEntities,
        entity_count: relatedEntities.length,
        summary: `Client "${clients.name}" monitors ${(clients.monitoring_keywords || []).length} keywords, has ${(clients.high_value_assets || []).length} high-value assets, and ${relatedEntities.length} related entities in the system.`
      };
    }

    case "get_monitoring_status": {
      const hours = args.hours || 24;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabaseClient
        .from("monitoring_history")
        .select("*")
        .gte("scan_started_at", cutoff)
        .order("scan_started_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Analyze the results
      const bySource = data.reduce((acc: any, scan: any) => {
        if (!acc[scan.source_name]) {
          acc[scan.source_name] = { total: 0, completed: 0, failed: 0, running: 0 };
        }
        acc[scan.source_name].total++;
        if (scan.status === "completed") acc[scan.source_name].completed++;
        if (scan.status === "failed") acc[scan.source_name].failed++;
        if (scan.status === "running") acc[scan.source_name].running++;
        return acc;
      }, {});

      return {
        summary: bySource,
        total_scans: data.length,
        recent_scans: data.slice(0, 10),
      };
    }

    case "get_system_health": {
      const days = args.days || 7;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: metrics, error: metricsError } = await supabaseClient
        .from("automation_metrics")
        .select("*")
        .gte("metric_date", cutoff)
        .order("metric_date", { ascending: false });

      if (metricsError) throw metricsError;

      const { data: activeIncidents, error: incidentsError } = await supabaseClient
        .from("incidents")
        .select("id, status, priority")
        .in("status", ["open", "investigating"])
        .limit(100);

      if (incidentsError) throw incidentsError;

      const { data: recentSignals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, created_at, status")
        .gte("created_at", cutoff)
        .limit(1000);

      if (signalsError) throw signalsError;

      // Calculate totals
      const totals = metrics.reduce((acc: any, m: any) => {
        acc.signals_processed += m.signals_processed || 0;
        acc.incidents_created += m.incidents_created || 0;
        acc.osint_scans += m.osint_scans_completed || 0;
        acc.alerts_sent += m.alerts_sent || 0;
        return acc;
      }, { signals_processed: 0, incidents_created: 0, osint_scans: 0, alerts_sent: 0 });

      return {
        metrics: totals,
        active_incidents_count: activeIncidents.length,
        signals_last_7_days: recentSignals.length,
        average_scans_per_day: Math.round(totals.osint_scans / days),
        latest_metrics: metrics[0],
      };
    }

    case "diagnose_issues": {
      const limit = args.limit || 20;

      // Get failed scans
      const { data: failedScans, error: scanError } = await supabaseClient
        .from("monitoring_history")
        .select("*")
        .eq("status", "failed")
        .order("scan_started_at", { ascending: false })
        .limit(limit);

      if (scanError) throw scanError;

      // Get sources with errors
      const { data: errorSources, error: sourceError } = await supabaseClient
        .from("sources")
        .select("name, status, error_message, last_ingested_at")
        .not("error_message", "is", null)
        .limit(20);

      if (sourceError) throw sourceError;

      // Analyze patterns
      const errorPatterns: { [key: string]: number } = {};
      failedScans.forEach((scan: any) => {
        const source = scan.source_name;
        errorPatterns[source] = (errorPatterns[source] || 0) + 1;
      });

      return {
        failed_scans: failedScans,
        error_sources: errorSources,
        error_patterns: errorPatterns,
        total_errors: failedScans.length,
        recommendation: failedScans.length > 10
          ? "High error rate detected. Check rate limits and API configurations."
          : "System appears healthy with minimal errors.",
      };
    }

    case "search_signals_by_entity": {
      // First, find the entity
      const { data: entities, error: entityError } = await supabaseClient
        .from("entities")
        .select("id, name, type, description")
        .ilike("name", `%${args.entity_name}%`)
        .limit(5);

      if (entityError) {
        console.error("Entity search error:", entityError);
        throw new Error(`Failed to search entities: ${entityError.message}`);
      }
      
      if (!entities || entities.length === 0) {
        return { 
          success: false,
          message: `No entity found matching "${args.entity_name}". You may need to create this entity first in the [Entities](/entities) page.`,
          signals: [] 
        };
      }

      // Get entity IDs
      const entityIds = entities.map((e: any) => e.id);

      // Find signals that mention these entities
      const { data: mentions, error: mentionsError } = await supabaseClient
        .from("entity_mentions")
        .select("signal_id, entity_id, confidence, context")
        .in("entity_id", entityIds)
        .order("detected_at", { ascending: false })
        .limit(args.limit || 20);

      if (mentionsError) {
        console.error("Entity mentions search error:", mentionsError);
        throw new Error(`Failed to search entity mentions: ${mentionsError.message}`);
      }

      if (!mentions || mentions.length === 0) {
        return { 
          success: true,
          entities: entities,
          message: `Found entity "${entities[0].name}" (${entities[0].type}) but no intelligence signals mention this entity yet. You can perform an OSINT scan to gather intelligence.`,
          signals: [],
          suggestion: `Try: "Perform an OSINT scan on ${entities[0].name}" to gather intelligence from the web.`
        };
      }

      // Get the actual signals
      const signalIds = [...new Set(mentions.map((m: any) => m.signal_id))];
      const { data: signals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, title, description, severity, received_at, status, category, client_id, clients(name)")
        .in("id", signalIds)
        .order("received_at", { ascending: false });

      if (signalsError) {
        console.error("Signals fetch error:", signalsError);
        throw new Error(`Failed to fetch signals: ${signalsError.message}`);
      }

      return {
        success: true,
        entities: entities,
        entity_mentions_count: mentions.length,
        signals: signals || [],
        message: `Found ${signals?.length || 0} signal(s) mentioning ${entities[0].name}`
      };
    }

    case "trigger_osint_scan": {
      // Find the entity first
      const { data: entity, error: findError } = await supabaseClient
        .from("entities")
        .select("id, name, type")
        .ilike("name", `%${args.entity_name}%`)
        .limit(1)
        .single();

      if (findError) {
        console.error("Entity lookup error for OSINT scan:", findError);
        if (findError.code === 'PGRST116') {
          return { 
            success: false, 
            message: `Entity "${args.entity_name}" not found. I'll create it for you first, then perform the OSINT scan.`,
            note: "Entities must exist in the system before scanning. Use create_entity first."
          };
        }
        throw new Error(`Failed to lookup entity: ${findError.message}`);
      }
      
      if (!entity) {
        return { 
          success: false, 
          message: `Entity "${args.entity_name}" not found. I should create it first before scanning.`,
          note: "Use create_entity tool to create the entity, then trigger_osint_scan."
        };
      }

      // Trigger the OSINT scan
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      console.log(`Triggering OSINT scan for entity: ${entity.name} (${entity.id})`);
      
      try {
        const scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/osint-web-search`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ entity_id: entity.id })
        });

        if (!scanResponse.ok) {
          const errorText = await scanResponse.text();
          console.error('OSINT scan HTTP error:', scanResponse.status, errorText);
          
          // Check if it's a configuration error
          if (errorText.includes('Google Search API not configured') || errorText.includes('GOOGLE_SEARCH')) {
            return {
              success: false,
              message: `OSINT scanning requires Google Search API configuration. The system administrator needs to configure GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID in the backend settings.`,
              entity: entity.name,
              error_type: "configuration"
            };
          }
          
          if (scanResponse.status === 404) {
            return {
              success: false,
              message: `The OSINT scan service is not available. Please contact your administrator.`,
              entity: entity.name,
              error_type: "service_unavailable"
            };
          }
          
          return { 
            success: false, 
            message: `OSINT scan failed for ${entity.name}. Status: ${scanResponse.status}. Details: ${errorText.substring(0, 200)}`,
            entity: entity.name,
            error_type: "scan_failed"
          };
        }

        const result = await scanResponse.json();
        console.log('OSINT scan result:', result);
        
        return {
          success: true,
          message: `✅ OSINT scan completed successfully for ${entity.name}!\n\n📊 Results:\n- ${result.content_created || 0} intelligence items created\n- ${result.signals_created || 0} security signals generated\n\nView the intelligence in [Entity Content](/entities) or check [Signals](/signals) for any security concerns.`,
          entity: entity.name,
          content_created: result.content_created || 0,
          signals_created: result.signals_created || 0
        };
      } catch (fetchError) {
        console.error('OSINT scan fetch error:', fetchError);
        return {
          success: false,
          message: `Failed to connect to OSINT scan service for ${entity.name}. Error: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`,
          entity: entity.name,
          error_type: "network_error"
        };
      }
    }

    case "analyze_database_issues": {
      const issueType = args.issue_type || "all";
      const issues: any = { duplicate_signals: [], orphaned_records: [], data_quality: [] };

      // Check for duplicate signals based on content hash
      if (issueType === "duplicates" || issueType === "all") {
        const { data: duplicates } = await supabaseClient
          .from("signals")
          .select("content_hash, id, title, created_at, confidence")
          .not("content_hash", "is", null)
          .order("created_at", { ascending: false })
          .limit(500);

        if (duplicates) {
          const hashMap = new Map();
          duplicates.forEach((signal: any) => {
            if (!hashMap.has(signal.content_hash)) {
              hashMap.set(signal.content_hash, []);
            }
            hashMap.get(signal.content_hash).push(signal);
          });

          hashMap.forEach((signals, hash) => {
            if (signals.length > 1) {
              issues.duplicate_signals.push({
                hash,
                count: signals.length,
                signals: signals.map((s: any) => ({ 
                  id: s.id, 
                  title: s.title, 
                  created_at: s.created_at,
                  confidence: s.confidence 
                }))
              });
            }
          });
        }
      }

      // Check for orphaned records
      if (issueType === "orphaned_records" || issueType === "all") {
        const { data: orphanedMentions } = await supabaseClient
          .from("entity_mentions")
          .select("id, entity_id, signal_id, incident_id")
          .is("signal_id", null)
          .is("incident_id", null)
          .limit(100);

        if (orphanedMentions && orphanedMentions.length > 0) {
          issues.orphaned_records.push({
            type: "entity_mentions",
            count: orphanedMentions.length,
            details: "Entity mentions with no signal or incident reference",
            sample_ids: orphanedMentions.slice(0, 5).map((m: any) => m.id)
          });
        }
      }

      // Check data quality
      if (issueType === "data_quality" || issueType === "all") {
        const { data: lowQuality } = await supabaseClient
          .from("signals")
          .select("id, title, confidence, status, created_at")
          .lt("confidence", 0.3)
          .eq("status", "new")
          .order("created_at", { ascending: false })
          .limit(50);

        if (lowQuality && lowQuality.length > 0) {
          issues.data_quality.push({
            type: "low_confidence_signals",
            count: lowQuality.length,
            signals: lowQuality.slice(0, 10)
          });
        }

        // Check for signals with missing data
        const { data: incomplete } = await supabaseClient
          .from("signals")
          .select("id, title, description, category")
          .or("description.is.null,category.is.null")
          .order("created_at", { ascending: false })
          .limit(20);

        if (incomplete && incomplete.length > 0) {
          issues.data_quality.push({
            type: "incomplete_signals",
            count: incomplete.length,
            details: "Signals missing description or category"
          });
        }
      }

      return {
        success: true,
        issues,
        summary: `Found ${issues.duplicate_signals.length} duplicate groups (${issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0)} total duplicates), ${issues.orphaned_records.reduce((sum: number, r: any) => sum + r.count, 0)} orphaned records, ${issues.data_quality.reduce((sum: number, q: any) => sum + q.count, 0)} data quality issues`,
        total_duplicate_signals: issues.duplicate_signals.reduce((sum: number, g: any) => sum + g.count, 0)
      };
    }

    case "fix_duplicate_signals": {
      const { signal_ids, action, keep_signal_id } = args;
      
      if (!signal_ids || signal_ids.length < 2) {
        return { success: false, error: "Need at least 2 signal IDs to fix duplicates" };
      }

      if (action === "mark_as_duplicate") {
        // Use the detect-duplicates function
        try {
          const { error: detectError } = await supabaseClient.functions.invoke("detect-duplicates", {
            body: { signal_ids }
          });

          if (detectError) {
            return { success: false, error: detectError.message };
          }

          return {
            success: true,
            message: `Marked ${signal_ids.length} signals as potential duplicates in duplicate_detections table`
          };
        } catch (error) {
          return { 
            success: false, 
            error: `Failed to mark duplicates: ${error instanceof Error ? error.message : 'Unknown error'}` 
          };
        }
      } else if (action === "delete_duplicates") {
        const primaryId = keep_signal_id || signal_ids[0];
        const toDelete = signal_ids.filter((id: string) => id !== primaryId);
        
        // Delete duplicate signals
        const { error: deleteError } = await supabaseClient
          .from("signals")
          .delete()
          .in("id", toDelete);

        if (deleteError) {
          return { success: false, error: deleteError.message };
        }

        return {
          success: true,
          message: `Deleted ${toDelete.length} duplicate signals, kept signal ${primaryId}`,
          kept_signal_id: primaryId,
          deleted_count: toDelete.length
        };
      } else if (action === "merge") {
        const primaryId = keep_signal_id || signal_ids[0];
        const otherIds = signal_ids.filter((id: string) => id !== primaryId);

        // Update entity mentions to point to primary signal
        const { error: mentionsError } = await supabaseClient
          .from("entity_mentions")
          .update({ signal_id: primaryId })
          .in("signal_id", otherIds);

        if (mentionsError) {
          return { success: false, error: `Failed to update mentions: ${mentionsError.message}` };
        }

        // Update incident_signals references
        const { error: incidentError } = await supabaseClient
          .from("incident_signals")
          .update({ signal_id: primaryId })
          .in("signal_id", otherIds);

        // Delete duplicate signals
        const { error: deleteError } = await supabaseClient
          .from("signals")
          .delete()
          .in("id", otherIds);

        if (deleteError) {
          return { success: false, error: `Failed to delete duplicates: ${deleteError.message}` };
        }

        return {
          success: true,
          message: `Merged ${signal_ids.length} signals into ${primaryId}. Updated entity mentions and incident references.`,
          primary_signal_id: primaryId,
          merged_count: otherIds.length
        };
      }

      return { success: false, error: "Invalid action specified. Use 'merge', 'mark_as_duplicate', or 'delete_duplicates'" };
    }

    case "analyze_signal_quality": {
      const daysBack = args.days_back || 7;
      const minConfidence = args.min_confidence || 0.5;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      const { data: recentSignals, error: signalsError } = await supabaseClient
        .from("signals")
        .select("id, title, confidence, status, severity, created_at, source_id")
        .gte("created_at", cutoffDate.toISOString())
        .order("created_at", { ascending: false });

      if (signalsError || !recentSignals) {
        return { success: false, error: "Failed to fetch signals for analysis" };
      }

      const qualityMetrics = {
        total_signals: recentSignals.length,
        low_confidence: recentSignals.filter((s: any) => (s.confidence || 0) < minConfidence).length,
        high_confidence: recentSignals.filter((s: any) => (s.confidence || 0) >= 0.8).length,
        medium_confidence: recentSignals.filter((s: any) => (s.confidence || 0) >= minConfidence && (s.confidence || 0) < 0.8).length,
        by_status: {} as any,
        by_severity: {} as any,
        avg_confidence: recentSignals.length > 0 
          ? (recentSignals.reduce((sum: number, s: any) => sum + (s.confidence || 0), 0) / recentSignals.length).toFixed(3)
          : 0
      };

      recentSignals.forEach((signal: any) => {
        qualityMetrics.by_status[signal.status] = (qualityMetrics.by_status[signal.status] || 0) + 1;
        if (signal.severity) {
          qualityMetrics.by_severity[signal.severity] = (qualityMetrics.by_severity[signal.severity] || 0) + 1;
        }
      });

      const lowQualitySignals = recentSignals
        .filter((s: any) => (s.confidence || 0) < minConfidence)
        .slice(0, 10)
        .map((s: any) => ({
          id: s.id,
          title: s.title,
          confidence: s.confidence,
          created_at: s.created_at
        }));

      return {
        success: true,
        metrics: qualityMetrics,
        low_quality_signals: lowQualitySignals,
        analysis_period: `Last ${daysBack} days`,
        quality_percentage: recentSignals.length > 0 
          ? ((qualityMetrics.high_confidence / recentSignals.length) * 100).toFixed(1) + '%'
          : '0%'
      };
    }

    case "search_knowledge_base": {
      const searchQuery = args.query;
      const limit = args.limit || 10;
      
      let query = supabaseClient
        .from("knowledge_base_articles")
        .select(`
          id,
          title,
          summary,
          content,
          tags,
          created_at,
          view_count,
          helpful_count,
          knowledge_base_categories(name, icon)
        `)
        .eq("is_published", true)
        .order("helpful_count", { ascending: false })
        .limit(limit);

      // Filter by category if provided
      if (args.category_id) {
        query = query.eq("category_id", args.category_id);
      }

      // Search in title, summary, content, and tags
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,summary.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%,tags.cs.{${searchQuery}}`);
      }

      const { data: articles, error: searchError } = await query;

      if (searchError) {
        console.error("Knowledge base search error:", searchError);
        return { 
          success: false, 
          error: `Failed to search knowledge base: ${searchError.message}` 
        };
      }

      if (!articles || articles.length === 0) {
        return {
          success: true,
          articles: [],
          message: `No knowledge base articles found matching "${searchQuery}". Try browsing categories or using different keywords.`
        };
      }

      return {
        success: true,
        articles: articles.map((article: any) => ({
          id: article.id,
          title: article.title,
          summary: article.summary,
          content: article.content?.substring(0, 500) + (article.content?.length > 500 ? "..." : ""),
          category: article.knowledge_base_categories?.name,
          tags: article.tags,
          helpful_count: article.helpful_count,
          view_count: article.view_count,
          url: `/knowledge-base/${article.id}`
        })),
        count: articles.length,
        message: `Found ${articles.length} article(s) matching "${searchQuery}"`
      };
    }

    case "get_knowledge_base_categories": {
      const { data: categories, error: categoriesError } = await supabaseClient
        .from("knowledge_base_categories")
        .select(`
          id,
          name,
          description,
          icon,
          display_order,
          knowledge_base_articles(count)
        `)
        .order("display_order", { ascending: true });

      if (categoriesError) {
        console.error("Categories fetch error:", categoriesError);
        return { 
          success: false, 
          error: `Failed to fetch categories: ${categoriesError.message}` 
        };
      }

      if (!categories || categories.length === 0) {
        return {
          success: true,
          categories: [],
          message: "No knowledge base categories found. The knowledge base may be empty."
        };
      }

      return {
        success: true,
        categories: categories.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          description: cat.description,
          icon: cat.icon,
          article_count: cat.knowledge_base_articles?.length || 0
        })),
        count: categories.length,
        message: `Found ${categories.length} knowledge base categories`
      };
    }

    case "get_database_schema": {
      return {
        success: true,
        tables: [
          { 
            name: 'signals', 
            description: 'Security intelligence signals from various OSINT sources',
            key_columns: ['id', 'title', 'description', 'severity', 'status', 'client_id', 'received_at', 'confidence', 'content_hash', 'normalized_text'],
            relationships: ['Links to clients, sources, incidents via incident_signals, entities via entity_mentions']
          },
          { 
            name: 'incidents', 
            description: 'Security incidents created from signals requiring investigation',
            key_columns: ['id', 'title', 'status', 'priority', 'severity_level', 'opened_at', 'acknowledged_at', 'resolved_at', 'client_id', 'owner_user_id'],
            relationships: ['Links to signals via incident_signals, entities via incident_entities, clients, users']
          },
          { 
            name: 'entities', 
            description: 'Tracked entities (people, organizations, locations) with OSINT monitoring',
            key_columns: ['id', 'name', 'type', 'description', 'risk_level', 'threat_score', 'current_location', 'active_monitoring_enabled'],
            relationships: ['Links to signals/incidents via entity_mentions, has entity_content, entity_photos, entity_relationships']
          },
          { 
            name: 'entity_mentions', 
            description: 'Links between entities and signals/incidents where they are mentioned',
            key_columns: ['id', 'entity_id', 'signal_id', 'incident_id', 'confidence', 'context', 'detected_at'],
            relationships: ['Many-to-many join table connecting entities to signals and incidents']
          },
          { 
            name: 'entity_relationships', 
            description: 'Relationships between entities (e.g., person works for organization)',
            key_columns: ['id', 'entity_a_id', 'entity_b_id', 'relationship_type', 'strength', 'first_observed', 'last_observed'],
            relationships: ['Self-referencing entities table creating a graph of relationships']
          },
          { 
            name: 'entity_content', 
            description: 'OSINT content found about entities (articles, social posts, etc.)',
            key_columns: ['id', 'entity_id', 'content_type', 'url', 'title', 'content_text', 'sentiment', 'relevance_score'],
            relationships: ['Belongs to entities, created by automated OSINT scans']
          },
          { 
            name: 'entity_photos', 
            description: 'Photos of entities collected from OSINT sources',
            key_columns: ['id', 'entity_id', 'storage_path', 'source', 'caption'],
            relationships: ['Belongs to entities, stored in Supabase Storage']
          },
          { 
            name: 'clients', 
            description: 'Client organizations being monitored by the platform',
            key_columns: ['id', 'name', 'industry', 'status', 'locations', 'monitoring_keywords', 'threat_profile'],
            relationships: ['Has many signals, incidents, investigations, travelers']
          },
          { 
            name: 'investigations', 
            description: 'Investigation case files with timeline and evidence',
            key_columns: ['id', 'file_number', 'synopsis', 'recommendations', 'file_status', 'client_id', 'incident_id'],
            relationships: ['Links to clients, incidents, has investigation_entries, investigation_persons, investigation_attachments']
          },
          { 
            name: 'investigation_entries', 
            description: 'Timeline entries in investigation files',
            key_columns: ['id', 'investigation_id', 'entry_text', 'entry_timestamp', 'is_ai_generated'],
            relationships: ['Belongs to investigations, chronological log']
          },
          { 
            name: 'travelers', 
            description: 'Personnel who travel and need risk monitoring',
            key_columns: ['id', 'name', 'email', 'department', 'risk_level', 'is_active'],
            relationships: ['Has many itineraries']
          },
          { 
            name: 'itineraries', 
            description: 'Travel itineraries with risk assessments',
            key_columns: ['id', 'traveler_id', 'trip_name', 'destination_country', 'destination_city', 'departure_date', 'return_date', 'risk_level', 'monitoring_enabled'],
            relationships: ['Belongs to travelers, AI-analyzed for risks']
          },
          { 
            name: 'sources', 
            description: 'OSINT data sources being monitored',
            key_columns: ['id', 'name', 'type', 'url', 'status', 'scan_frequency', 'last_ingested_at'],
            relationships: ['Produces signals, has monitoring_history']
          },
          { 
            name: 'monitoring_history', 
            description: 'History of automated monitoring scans',
            key_columns: ['id', 'source_name', 'status', 'scan_started_at', 'scan_completed_at', 'items_scanned', 'signals_created'],
            relationships: ['Tracks automation performance per source']
          },
          { 
            name: 'knowledge_base_articles', 
            description: 'Platform documentation and guides',
            key_columns: ['id', 'title', 'content', 'summary', 'category_id', 'tags', 'is_published'],
            relationships: ['Belongs to knowledge_base_categories, searchable content']
          },
          { 
            name: 'archival_documents', 
            description: 'Historical documents and intelligence reports',
            key_columns: ['id', 'filename', 'content_text', 'summary', 'keywords', 'entity_mentions', 'date_of_document'],
            relationships: ['Can be linked to entities, searchable content repository']
          },
          { 
            name: 'automation_metrics', 
            description: 'Performance metrics for automation and AI systems',
            key_columns: ['id', 'metric_date', 'signals_processed', 'incidents_created', 'osint_scans_completed', 'false_positive_rate'],
            relationships: ['Aggregated daily metrics for monitoring system health']
          }
        ],
        message: args.table_name 
          ? `Detailed schema information for ${args.table_name}. This table is part of the Fortress security intelligence platform's data model.`
          : 'Complete database schema overview. Fortress uses PostgreSQL with Row Level Security (RLS) for data access control.'
      };
    }

    case "list_edge_functions": {
      return {
        success: true,
        functions: [
          { 
            name: 'ingest-signal', 
            purpose: 'Ingest new security signals into the system from various sources',
            triggers: 'API calls, manual uploads, monitoring functions',
            processes: 'Validates, normalizes, hashes content, extracts entities, calculates severity'
          },
          { 
            name: 'correlate-signals', 
            purpose: 'Find and group related signals using content similarity',
            triggers: 'Automatically after signal ingestion',
            processes: 'Content hash matching, text normalization, grouping into correlation_groups'
          },
          { 
            name: 'correlate-entities', 
            purpose: 'Link entities to signals and incidents using NLP',
            triggers: 'After signal/incident creation',
            processes: 'Named entity recognition, keyword matching, creates entity_mentions'
          },
          { 
            name: 'ai-decision-engine', 
            purpose: 'AI-powered incident creation and escalation decisions',
            triggers: 'When new signals arrive or patterns detected',
            processes: 'Analyzes signal patterns, assesses threat level, creates incidents automatically'
          },
          { 
            name: 'check-incident-escalation', 
            purpose: 'Check if incidents need escalation based on rules and SLAs',
            triggers: 'Scheduled (every 15 minutes)',
            processes: 'Evaluates escalation_rules, checks SLA timers, triggers escalations'
          },
          { 
            name: 'alert-delivery', 
            purpose: 'Send alerts via email, Slack, Teams',
            triggers: 'Incident creation, escalation, manual alerts',
            processes: 'Formats messages, delivers to configured channels, tracks delivery status'
          },
          { 
            name: 'monitor-news', 
            purpose: 'Automated monitoring of news sources for relevant threats',
            triggers: 'Scheduled (configurable frequency)',
            processes: 'RSS feeds, news APIs, keyword matching, signal generation'
          },
          { 
            name: 'monitor-social', 
            purpose: 'Monitor social media platforms for entity mentions',
            triggers: 'Scheduled scans',
            processes: 'Twitter, LinkedIn, Facebook APIs, sentiment analysis'
          },
          { 
            name: 'monitor-threat-intel', 
            purpose: 'Ingest threat intelligence feeds',
            triggers: 'Scheduled',
            processes: 'CVE databases, threat feeds, indicator matching'
          },
          { 
            name: 'monitor-darkweb', 
            purpose: 'Scan dark web sources for credential leaks and threats',
            triggers: 'Scheduled',
            processes: 'Searches Tor, paste sites, breach databases'
          },
          { 
            name: 'osint-entity-scan', 
            purpose: 'Comprehensive OSINT scan for entity information',
            triggers: 'Manual or scheduled for monitored entities',
            processes: 'Multi-source web search, data collection, entity_content creation'
          },
          { 
            name: 'scan-entity-content', 
            purpose: 'Scan web content for specific entities',
            triggers: 'Part of OSINT scans',
            processes: 'Web scraping, content analysis, relevance scoring'
          },
          { 
            name: 'scan-entity-photos', 
            purpose: 'Find and collect photos of entities',
            triggers: 'Part of OSINT scans',
            processes: 'Image search APIs, face detection, storage in entity_photos'
          },
          { 
            name: 'enrich-entity', 
            purpose: 'Enrich entity data from multiple sources',
            triggers: 'Manual enrichment requests',
            processes: 'Combines data from APIs, public records, social profiles'
          },
          { 
            name: 'parse-document', 
            purpose: 'Extract text and entities from uploaded documents',
            triggers: 'Document uploads',
            processes: 'OCR, text extraction, NLP, creates ingested_documents and entity mentions'
          },
          { 
            name: 'process-client-onboarding', 
            purpose: 'Process new client onboarding data',
            triggers: 'Client onboarding form submission',
            processes: 'Creates monitoring keywords, risk profiles, initial entity setup'
          },
          { 
            name: 'generate-report', 
            purpose: 'Generate security reports (PDF/DOCX)',
            triggers: 'Manual report requests',
            processes: 'Queries data, formats report, generates PDF/DOCX'
          },
          { 
            name: 'generate-executive-report', 
            purpose: 'Generate executive-level summary reports',
            triggers: 'Scheduled or manual',
            processes: 'Aggregates metrics, creates executive summary, formats for leadership'
          },
          { 
            name: 'dashboard-ai-assistant', 
            purpose: 'AI assistant for platform interaction and queries',
            triggers: 'User messages in dashboard',
            processes: 'Natural language understanding, database queries, contextual responses'
          },
          { 
            name: 'investigation-ai-assist', 
            purpose: 'AI assistance for investigation writing',
            triggers: 'Investigation page AI features',
            processes: 'Expands notes, suggests next steps, writes synopses'
          },
          { 
            name: 'parse-travel-itinerary', 
            purpose: 'Parse and analyze travel itineraries',
            triggers: 'Travel document upload',
            processes: 'Extracts dates, locations, flights, assesses risks'
          },
          { 
            name: 'monitor-travel-risks', 
            purpose: 'Monitor risks for active travelers',
            triggers: 'Scheduled for active itineraries',
            processes: 'Checks threat intel, weather, civil unrest for traveler locations'
          }
        ],
        message: 'Complete list of edge functions that power Fortress automation and AI capabilities. All functions are Deno-based and auto-deployed.'
      };
    }

    case "explain_feature": {
      const featureName = args.feature_name?.toLowerCase();
      const featureExplanations: Record<string, any> = {
        signals: {
          description: 'Signals are raw security intelligence ingested from various OSINT sources (news, social media, threat intel, etc.). They represent potential security events or threats that need analysis.',
          components: [
            'Signal ingestion (ingest-signal function)',
            'Signal correlation (correlate-signals function)',
            'Entity detection (correlate-entities function)',
            'Duplicate detection (detect-duplicates function)',
            'Quality scoring and confidence calculation'
          ],
          data_flow: 'OSINT Source → Monitor Function → Ingest Signal → Normalize/Hash Content → Correlate with Existing → Extract Entities → Calculate Severity → Store in signals table → Trigger AI Decision Engine',
          tables: ['signals', 'signal_correlation_groups', 'entity_mentions', 'signal_documents', 'incident_signals'],
          key_functions: ['ingest-signal', 'correlate-signals', 'correlate-entities', 'detect-duplicates', 'ai-decision-engine'],
          ui_pages: ['Signals page (/signals) - List view, filtering, detail dialogs', 'Dashboard - Recent signals widget'],
          how_to_use: 'Signals are automatically created by monitoring functions. Users can view, filter, search, mark false positives, and manually create incidents from signals.'
        },
        incidents: {
          description: 'Incidents are security events that require investigation, response, and tracking. Created automatically by AI or manually from signals.',
          components: [
            'AI-powered incident creation (ai-decision-engine)',
            'Escalation rules engine (check-incident-escalation)',
            'Alert delivery system (alert-delivery)',
            'SLA tracking and timers',
            'Status workflow (open → investigating → contained → resolved)',
            'Priority system (p1/p2/p3/p4)'
          ],
          data_flow: 'Correlated Signals → AI Decision Engine → Create Incident → Link Signals/Entities → Check Escalation Rules → Send Alerts → Track Status Changes → Monitor SLA → Resolution',
          tables: ['incidents', 'incident_signals', 'incident_entities', 'alerts', 'escalation_rules', 'incident_outcomes'],
          key_functions: ['ai-decision-engine', 'check-incident-escalation', 'alert-delivery', 'incident-action'],
          ui_pages: ['Incidents page (/incidents) - List, detail view, status updates', 'Dashboard - Active incidents count'],
          how_to_use: 'Incidents are created automatically based on signal patterns. Users can assign owners, update status, add notes, link to investigations, and track resolution.'
        },
        entities: {
          description: 'Entities are tracked people, organizations, or locations with comprehensive OSINT enrichment and relationship mapping.',
          components: [
            'Entity management and profiles',
            'OSINT scanning (osint-entity-scan, osint-web-search)',
            'Content collection (scan-entity-content)',
            'Photo collection (scan-entity-photos)',
            'Relationship mapping (entity_relationships)',
            'Active monitoring with proximity alerts'
          ],
          data_flow: 'Create Entity → Set Monitoring Radius → Trigger OSINT Scan → Collect Web Content → Extract Photos → Detect Relationships → Link to Signals/Incidents → Track Mentions → Alert on Proximity',
          tables: ['entities', 'entity_mentions', 'entity_relationships', 'entity_content', 'entity_photos', 'entity_suggestions'],
          key_functions: ['osint-entity-scan', 'osint-web-search', 'scan-entity-content', 'scan-entity-photos', 'enrich-entity', 'cross-reference-entities', 'monitor-entity-proximity'],
          ui_pages: [
            'Entities page (/entities) - List view, search, create dialog',
            'Entity detail dialog - Profile, content, photos, relationships, mentions',
            'Entity unified profile - Comprehensive view'
          ],
          how_to_use: 'Create entities for people/orgs to track. Enable active monitoring. System automatically performs OSINT scans, collects intelligence, detects mentions in signals, and alerts on proximity to incidents.'
        },
        travel: {
          description: 'Travel security monitoring tracks personnel traveling to potentially risky locations with real-time risk assessment and alerts.',
          components: [
            'Traveler management',
            'Itinerary tracking with dates and locations',
            'AI risk assessment (parse-travel-itinerary)',
            'Real-time monitoring (monitor-travel-risks)',
            'Travel alerts for destination risks',
            'Map visualization of traveler locations'
          ],
          data_flow: 'Create Traveler → Add Itinerary (manual or upload) → AI Parse & Risk Assessment → Enable Monitoring → Monitor Risks Function Checks Threats → Generate Travel Alerts → Display on Map → Archive After Return',
          tables: ['travelers', 'itineraries'],
          key_functions: ['parse-travel-itinerary', 'monitor-travel-risks', 'archive-completed-itineraries'],
          ui_pages: [
            'Travel page (/travel) - Travelers list, itineraries list',
            'Travel map - Geographic visualization',
            'Travel alerts panel - Risk notifications'
          ],
          how_to_use: 'Add travelers and their itineraries (manually or upload PDF/DOCX). System performs AI risk assessment, monitors threats at destinations, and sends alerts for risks.'
        },
        investigations: {
          description: 'Investigation case file management for documenting security investigations with timeline, persons, evidence, and AI writing assistance.',
          components: [
            'Investigation files with file numbers',
            'Timeline entries (investigation_entries)',
            'Person tracking (investigation_persons)',
            'Document attachments (investigation_attachments)',
            'AI writing assistance (investigation-ai-assist)',
            'Cross-references to other cases',
            'Entity correlation'
          ],
          data_flow: 'Create Investigation → Add Timeline Entries → Track Persons Involved → Upload Evidence → Use AI to Expand Notes/Write Synopsis → Link Entities → Add Recommendations → Generate Report',
          tables: ['investigations', 'investigation_entries', 'investigation_persons', 'investigation_attachments'],
          key_functions: ['investigation-ai-assist', 'suggest-investigation-references', 'generate-report'],
          ui_pages: [
            'Investigations page (/investigations) - List and search',
            'Investigation detail page (/investigations/:id) - Full case file interface'
          ],
          how_to_use: 'Create investigation from incident or standalone. Add chronological entries, track people, upload evidence. Use AI assistant to expand notes, suggest next steps, write synopsis and recommendations.'
        },
        monitoring: {
          description: 'Automated OSINT source monitoring continuously scans configured sources for security intelligence and generates signals.',
          components: [
            'Source configuration (sources table)',
            'Multiple source types (RSS, news APIs, social media, threat intel, dark web)',
            'Scheduled scanning based on frequency',
            'Monitoring history tracking',
            'Error detection and alerting',
            '20+ specialized monitor functions'
          ],
          data_flow: 'Configure Source → Set Scan Frequency → Monitor Function Scheduled → Scan Source → Extract Data → Match Keywords → Generate Signals → Record History → Handle Errors',
          tables: ['sources', 'monitoring_history', 'ingested_documents'],
          key_functions: [
            'monitor-news', 'monitor-social', 'monitor-threat-intel', 'monitor-darkweb',
            'monitor-facebook', 'monitor-instagram', 'monitor-linkedin', 'monitor-twitter',
            'monitor-pastebin', 'monitor-github', 'monitor-rss-sources', 'monitor-domains',
            'monitor-earthquakes', 'monitor-wildfires', 'monitor-weather', 'monitor-canadian-sources',
            'auto-orchestrator (coordinates all monitoring)'
          ],
          ui_pages: [
            'Sources page (/sources) - List sources, add/edit',
            'Monitoring Sources page (/monitoring-sources) - Detailed configuration',
            'Dashboard - Monitoring status widget'
          ],
          how_to_use: 'Add sources (RSS feeds, social accounts, etc.), configure scan frequency and keywords. System automatically monitors sources on schedule, generates signals for matches, tracks performance in monitoring_history.'
        },
        automation: {
          description: 'Comprehensive automation system that orchestrates all OSINT monitoring, signal processing, incident creation, and alerting without manual intervention.',
          components: [
            'Auto-orchestrator (master coordinator)',
            'Scheduled edge functions',
            'AI decision engine',
            'Processing queue',
            'Automation metrics tracking',
            'Adaptive confidence adjustment',
            'Learning profiles for ML improvements'
          ],
          data_flow: 'Auto-Orchestrator → Trigger Monitor Functions → Ingest Signals → Correlate → Entity Detection → AI Decision → Create Incidents → Check Escalation → Send Alerts → Record Metrics',
          tables: ['monitoring_history', 'automation_metrics', 'processing_queue', 'learning_profiles'],
          key_functions: [
            'auto-orchestrator', 'adaptive-confidence-adjuster', 'process-feedback',
            'generate-learning-context', 'all monitor-* functions'
          ],
          how_to_use: 'Automation runs continuously in background. Configure sources and keywords, set escalation rules, enable notifications. System handles rest automatically. Monitor performance via automation_metrics and system health tools.'
        }
      };
      
      const explanation = featureExplanations[featureName];
      if (!explanation) {
        return { 
          success: false,
          error: `Feature "${featureName}" not found. Available features: signals, incidents, entities, travel, investigations, monitoring, automation`
        };
      }
      
      return {
        success: true,
        feature: featureName,
        ...explanation,
        message: `Detailed explanation of how the ${featureName} feature works in Fortress`
      };
    }

    case "get_system_architecture": {
      return {
        success: true,
        overview: 'Fortress is a comprehensive security intelligence platform built on React/TypeScript frontend with Supabase (PostgreSQL + Edge Functions) backend. The platform automates OSINT collection, threat detection, incident management, and security operations.',
        frontend: {
          framework: 'React 18.3+ with TypeScript for type safety',
          styling: 'Tailwind CSS with custom design system (index.css, tailwind.config.ts)',
          routing: 'React Router v6 for page navigation',
          state_management: [
            'React Query (TanStack Query) for server state and caching',
            'React hooks (useState, useContext, useReducer) for local state',
            'Custom hooks in src/hooks/ for shared logic'
          ],
          ui_library: 'Shadcn UI components (src/components/ui/) - customizable Radix UI primitives',
          key_pages: [
            'Dashboard (/) - Overview, metrics, AI assistant',
            'Signals (/signals) - Security intelligence feed',
            'Incidents (/incidents) - Incident management',
            'Entities (/entities) - Entity tracking and OSINT',
            'Travel (/travel) - Travel security monitoring',
            'Investigations (/investigations) - Case files',
            'Reports (/reports) - Report generation',
            'Knowledge Base (/knowledge-base) - Documentation',
            'Sources (/sources) - OSINT source configuration',
            'Clients (/clients) - Client management'
          ],
          key_components: [
            'DashboardAIAssistant - AI chat interface',
            'ThreatGlobe - 3D visualization (Three.js, React Three Fiber)',
            'LocationsMap - Mapbox integration',
            'SignalIngestForm - Manual signal creation',
            'EntityUnifiedProfile - Comprehensive entity view',
            'Various dialogs and forms for data management'
          ]
        },
        backend: {
          platform: 'Supabase - PostgreSQL database + Deno edge functions',
          database: {
            engine: 'PostgreSQL 15+ with pgvector extension',
            security: 'Row Level Security (RLS) policies on all tables',
            schema: '40+ tables for signals, incidents, entities, travel, investigations, etc.',
            features: 'Full-text search, JSONB columns, triggers, functions',
            realtime: 'Supabase Realtime for live updates on tables'
          },
          functions: {
            runtime: 'Deno 1.x (JavaScript/TypeScript)',
            deployment: 'Auto-deployed edge functions in supabase/functions/',
            count: '50+ functions for monitoring, processing, AI, alerts',
            examples: [
              'monitor-* functions - Scheduled OSINT scanning',
              'ingest-signal - Process incoming intelligence',
              'ai-decision-engine - AI incident creation',
              'alert-delivery - Multi-channel alerts',
              'osint-entity-scan - Entity research',
              'dashboard-ai-assistant - Conversational AI'
            ]
          },
          storage: {
            provider: 'Supabase Storage',
            buckets: [
              'entity-photos - Photos from OSINT (public)',
              'investigation-files - Case evidence (private)',
              'archival-documents - Historical docs (private)',
              'travel-documents - Itineraries (public)',
              'ai-chat-attachments - AI conversation files (private)'
            ],
            security: 'RLS policies control access per bucket'
          },
          auth: {
            provider: 'Supabase Auth',
            methods: ['Email/password', 'Magic links'],
            roles: 'Custom app_role enum (admin, analyst, viewer) in user_roles table',
            security: 'JWT tokens, RLS enforcement'
          }
        },
        automation: {
          orchestration: 'auto-orchestrator function coordinates all scheduled tasks',
          monitoring: {
            frequency: 'Configurable per source (5min to 24hr intervals)',
            sources: [
              'News RSS feeds',
              'Social media (Twitter, LinkedIn, Facebook, Instagram)',
              'Threat intelligence feeds',
              'Dark web monitoring',
              'GitHub repositories',
              'Pastebin and paste sites',
              'Weather, earthquakes, wildfires',
              'Canadian government sources',
              'Court registries'
            ],
            process: 'Monitor → Extract → Match Keywords → Generate Signals → Store'
          },
          correlation: {
            signal_correlation: 'Groups similar signals using content hashing and NLP',
            entity_correlation: 'Links entities to signals/incidents using NER and keyword matching',
            ai_powered: 'Uses Lovable AI (Gemini models) for advanced pattern detection'
          },
          decision_engine: {
            purpose: 'Automatically creates incidents from correlated signals',
            logic: 'Analyzes severity, entity involvement, correlation confidence, threat patterns',
            triggers: 'High-severity signals, entity proximity, pattern matching',
            output: 'Incident creation with priority, status, linked signals/entities'
          },
          escalation: {
            rules: 'Configurable escalation_rules with conditions and actions',
            checking: 'check-incident-escalation runs every 15 minutes',
            actions: 'Priority increase, status change, alert delivery, assignment',
            sla: 'Tracks acknowledge/contain/resolve times against targets'
          },
          alerts: {
            channels: ['Email (Resend API)', 'Slack webhooks', 'Microsoft Teams webhooks'],
            triggers: 'Incident creation, escalation, entity mentions, travel risks',
            templating: 'React-based email templates with JSX'
          }
        },
        data_flow: {
          ingest: 'OSINT Sources → Monitor Functions → Normalize/Hash → Store Signals → Record History',
          process: 'Signals → Correlation → Entity Detection → Quality Scoring → Deduplication',
          decide: 'Correlated Signals → AI Analysis → Pattern Matching → Incident Creation',
          alert: 'Incidents → Escalation Check → Priority Assessment → Multi-channel Delivery',
          enrich: 'Entities → OSINT Scan → Web Search → Content/Photos Collection → Relationship Detection'
        },
        integrations: {
          ai: {
            provider: 'Lovable AI Gateway',
            models: [
              'google/gemini-2.5-flash (primary - fast, cost-effective)',
              'google/gemini-2.5-pro (complex reasoning)',
              'google/gemini-2.5-flash-lite (classification)',
              'openai/gpt-5-mini (alternative)'
            ],
            uses: [
              'AI decision engine for incidents',
              'Dashboard AI assistant',
              'Investigation writing assistance',
              'Entity enrichment and analysis',
              'Travel risk assessment',
              'Document parsing and entity extraction'
            ]
          },
          maps: 'Mapbox GL JS for location visualization (incidents, entities, travelers)',
          osint_apis: [
            'Google Search API (entity OSINT)',
            'News APIs',
            'Social media APIs (Twitter, Facebook, LinkedIn)',
            'Threat intel feeds',
            'Weather/earthquake APIs'
          ],
          notifications: [
            'Resend API for email delivery',
            'Slack incoming webhooks',
            'Microsoft Teams incoming webhooks'
          ],
          storage: 'Supabase Storage for files, photos, documents with RLS'
        },
        deployment: {
          frontend: 'Lovable hosting (CDN, auto-deployment)',
          backend: 'Supabase cloud (auto-scaling, multi-region)',
          edge_functions: 'Deployed globally on Supabase edge network',
          database: 'Managed PostgreSQL with automatic backups'
        },
        security: {
          authentication: 'Supabase Auth with JWT tokens',
          authorization: 'Row Level Security policies on all tables + custom roles',
          data_encryption: 'At-rest and in-transit encryption',
          api_security: 'API keys in environment variables, CORS configured',
          secrets: 'Supabase secrets management for API keys'
        },
        performance: {
          caching: 'React Query caching for API responses',
          realtime: 'Supabase Realtime for live updates without polling',
          optimization: 'Database indexes on frequently queried columns',
          monitoring: 'automation_metrics table tracks system performance'
        }
      };
    }

    case "get_security_reports": {
      let query = supabaseClient
        .from("reports")
        .select("id, type, period_start, period_end, generated_at, meta_json")
        .order("generated_at", { ascending: false })
        .limit(args.limit || 10);

      if (args.report_type) {
        query = query.eq("type", args.report_type);
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        reports: data.map((report: any) => ({
          id: report.id,
          type: report.type,
          period_start: report.period_start,
          period_end: report.period_end,
          generated_at: report.generated_at,
          summary: report.meta_json?.summary || 'No summary available',
          sections: report.meta_json?.sections ? Object.keys(report.meta_json.sections) : []
        })),
        total: data.length
      };
    }

    case "get_report_content": {
      const { data, error } = await supabaseClient
        .from("reports")
        .select("*")
        .eq("id", args.report_id)
        .single();

      if (error) throw error;
      if (!data) {
        return { success: false, message: "Report not found" };
      }

      // Extract images from the report content if present
      const images: any[] = [];
      if (data.meta_json?.images) {
        images.push(...data.meta_json.images);
      }
      
      // Check sections for images
      if (data.meta_json?.sections) {
        Object.values(data.meta_json.sections).forEach((section: any) => {
          if (section?.images) {
            images.push(...section.images);
          }
        });
      }

      return {
        success: true,
        report: {
          id: data.id,
          type: data.type,
          period_start: data.period_start,
          period_end: data.period_end,
          generated_at: data.generated_at,
          full_content: data.meta_json,
          images: images.length > 0 ? images : null,
          image_count: images.length
        }
      };
    }

    case "import_report_images": {
      const { data: report, error: reportError } = await supabaseClient
        .from("reports")
        .select("meta_json")
        .eq("id", args.report_id)
        .single();

      if (reportError) throw reportError;
      if (!report) {
        return { success: false, message: "Report not found" };
      }

      // Extract images
      const allImages: any[] = [];
      if (report.meta_json?.images) {
        allImages.push(...report.meta_json.images);
      }
      if (report.meta_json?.sections) {
        Object.values(report.meta_json.sections).forEach((section: any) => {
          if (section?.images) {
            allImages.push(...section.images);
          }
        });
      }

      if (allImages.length === 0) {
        return { success: false, message: "No images found in this report" };
      }

      // Filter by indices if specified
      const imagesToImport = args.image_indices 
        ? args.image_indices.map((idx: number) => allImages[idx]).filter(Boolean)
        : allImages;

      if (imagesToImport.length === 0) {
        return { success: false, message: "No valid images to import" };
      }

      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const importedImages: any[] = [];

      // Import each image to storage
      for (let i = 0; i < imagesToImport.length; i++) {
        const image = imagesToImport[i];
        try {
          // If image is base64, upload directly
          if (image.data && image.data.startsWith('data:image')) {
            const base64Data = image.data.split(',')[1];
            const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            const contentType = image.data.split(';')[0].split(':')[1];
            const extension = contentType.split('/')[1];
            
            const fileName = `report-images/${args.report_id}/${Date.now()}-${i}.${extension}`;
            
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
              .from('entity-photos')
              .upload(fileName, buffer, {
                contentType,
                upsert: false
              });

            if (uploadError) {
              console.error("Upload error:", uploadError);
              continue;
            }

            const { data: { publicUrl } } = supabaseClient.storage
              .from('entity-photos')
              .getPublicUrl(fileName);

            importedImages.push({
              original_index: args.image_indices ? args.image_indices[i] : i,
              storage_path: fileName,
              public_url: publicUrl,
              caption: image.caption || null
            });
          }
        } catch (err) {
          console.error("Error importing image:", err);
        }
      }

      return {
        success: true,
        message: `Successfully imported ${importedImages.length} of ${imagesToImport.length} images`,
        imported_images: importedImages,
        total_attempted: imagesToImport.length
      };
    }

    case "search_archival_documents": {
      let query = supabaseClient
        .from("archival_documents")
        .select("id, filename, file_type, upload_date, summary, content_text, entity_mentions, tags, client_id, clients(name)")
        .order("upload_date", { ascending: false })
        .limit(args.limit || 20);

      if (args.client_id) {
        query = query.eq("client_id", args.client_id);
      }

      if (args.query) {
        // Search in filename, summary, and content_text
        query = query.or(`filename.ilike.%${args.query}%,summary.ilike.%${args.query}%,content_text.ilike.%${args.query}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        success: true,
        documents: data,
        count: data?.length || 0
      };
    }

    case "get_document_content": {
      const { data, error } = await supabaseClient
        .from("archival_documents")
        .select("*")
        .eq("id", args.document_id)
        .single();

      if (error) throw error;
      if (!data) {
        return { success: false, message: "Document not found" };
      }

      return {
        success: true,
        document: {
          id: data.id,
          filename: data.filename,
          file_type: data.file_type,
          upload_date: data.upload_date,
          date_of_document: data.date_of_document,
          content_text: data.content_text,
          summary: data.summary,
          tags: data.tags,
          entity_mentions: data.entity_mentions,
          keywords: data.keywords,
          correlated_entity_ids: data.correlated_entity_ids,
          metadata: data.metadata,
          client_id: data.client_id
        }
      };
    }

    case "create_entity": {
      const { name, type, description, aliases } = args;
      
      // Check if entity already exists
      const { data: existing } = await supabaseClient
        .from("entities")
        .select("id, name")
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
      
      if (existing) {
        return {
          success: false,
          message: `Entity "${existing.name}" already exists with ID: ${existing.id}`,
          entity_id: existing.id
        };
      }
      
      // Create the entity
      const { data: newEntity, error } = await supabaseClient
        .from("entities")
        .insert({
          name,
          type,
          description: description || null,
          aliases: aliases || null,
          is_active: true,
          entity_status: 'active'
        })
        .select("id, name, type")
        .single();
      
      if (error) {
        console.error("Failed to create entity:", error);
        return {
          success: false,
          message: `Failed to create entity: ${error.message}`
        };
      }
      
      return {
        success: true,
        message: `Created entity "${newEntity.name}" (${newEntity.type}) with ID: ${newEntity.id}`,
        entity: newEntity,
        next_step: "You can now trigger an OSINT scan on this entity to gather intelligence."
      };
    }

    case "read_intelligence_documents": {
      const limit = Math.min(args.limit || 10, 50);
      const hoursBack = args.hours_back || 24;
      const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

      let documents: any[] = [];
      let searchMethod = "time_filter";

      // Filter by specific document IDs if provided
      if (args.document_ids && args.document_ids.length > 0) {
        const { data, error } = await supabaseClient
          .from("ingested_documents")
          .select("id, title, raw_text, metadata, processed_at, processing_status, chunk_index, total_chunks, source_id, sources(name)")
          .in("id", args.document_ids)
          .eq("processing_status", "completed");
        
        if (error) throw error;
        documents = data || [];
        searchMethod = "document_ids";
      }
      // Filter by entity if provided
      else if (args.entity_id) {
        // First, get the entity name for text search fallback
        const { data: entity } = await supabaseClient
          .from("entities")
          .select("name, aliases")
          .eq("id", args.entity_id)
          .single();

        // Try to get documents via entity mentions first
        const { data: mentions } = await supabaseClient
          .from("document_entity_mentions")
          .select("document_id")
          .eq("entity_id", args.entity_id);
        
        if (mentions && mentions.length > 0) {
          const docIds = mentions.map((m: any) => m.document_id);
          const { data, error } = await supabaseClient
            .from("ingested_documents")
            .select("id, title, raw_text, metadata, processed_at, processing_status, chunk_index, total_chunks, source_id, sources(name)")
            .in("id", docIds)
            .eq("processing_status", "completed")
            .gte("processed_at", cutoffTime)
            .order("processed_at", { ascending: false })
            .limit(limit);
          
          if (!error && data) {
            documents = data;
            searchMethod = "entity_mentions";
          }
        }
        
        // FALLBACK: If no documents found via mentions, search by entity name in content
        if (documents.length === 0 && entity) {
          console.log(`No entity mentions found, falling back to text search for: ${entity.name}`);
          
          // Search in raw_text, title, and metadata
          const searchTerms = [entity.name, ...(entity.aliases || [])];
          const { data, error } = await supabaseClient
            .from("ingested_documents")
            .select("id, title, raw_text, metadata, processed_at, processing_status, chunk_index, total_chunks, source_id, sources(name)")
            .eq("processing_status", "completed")
            .gte("processed_at", cutoffTime)
            .order("processed_at", { ascending: false })
            .limit(100); // Get more for filtering
          
          if (!error && data) {
            // Filter documents that contain the entity name or aliases
            documents = data.filter((doc: any) => {
              const textToSearch = `${doc.title || ""} ${doc.raw_text || ""} ${JSON.stringify(doc.metadata || {})}`.toLowerCase();
              return searchTerms.some(term => textToSearch.includes(term.toLowerCase()));
            }).slice(0, limit);
            
            searchMethod = "text_search_fallback";
          }
        }
      }
      // Default: get recent documents
      else {
        const { data, error } = await supabaseClient
          .from("ingested_documents")
          .select("id, title, raw_text, metadata, processed_at, processing_status, chunk_index, total_chunks, source_id, sources(name)")
          .eq("processing_status", "completed")
          .gte("processed_at", cutoffTime)
          .order("processed_at", { ascending: false })
          .limit(limit);
        
        if (error) throw error;
        documents = data || [];
      }

      // Get any entity mentions in these documents
      const documentIds = documents?.map((d: any) => d.id) || [];
      let entityMentions: any[] = [];
      if (documentIds.length > 0) {
        const { data: mentions } = await supabaseClient
          .from("document_entity_mentions")
          .select("document_id, entity_id, mention_text, confidence, entities(name, type)")
          .in("document_id", documentIds);
        
        entityMentions = mentions || [];
      }

      // Enrich documents with entity mentions
      const enrichedDocs = documents?.map((doc: any) => ({
        ...doc,
        entity_mentions: entityMentions.filter((m: any) => m.document_id === doc.id),
        text_preview: doc.raw_text?.substring(0, 500) + "...",
        full_text: doc.raw_text
      }));

      return {
        success: true,
        documents: enrichedDocs,
        count: enrichedDocs?.length || 0,
        time_window: `Last ${hoursBack} hours`,
        search_method: searchMethod,
        message: searchMethod === "text_search_fallback" 
          ? `Found ${enrichedDocs?.length || 0} documents using text search (entity mentions not yet linked). Documents contain the entity name in their content.`
          : `Found ${enrichedDocs?.length || 0} intelligence documents. Use these to summarize OSINT findings, extract key entities, and correlate with signals.`
      };
    }

    case "detect_signal_duplicates": {
      const threshold = args.threshold || 0.85;
      const limit = args.limit || 20;

      if (!args.signal_id) {
        return {
          success: false,
          message: "signal_id is required to detect duplicates"
        };
      }

      // Get the target signal
      const { data: signal, error: signalError } = await supabaseClient
        .from("signals")
        .select("id, normalized_text, title, description, content_hash, created_at")
        .eq("id", args.signal_id)
        .single();

      if (signalError || !signal) {
        return {
          success: false,
          message: "Signal not found"
        };
      }

      // Check for exact hash matches first
      const { data: hashMatches } = await supabaseClient
        .from("signals")
        .select("id, title, normalized_text, created_at, status, severity, client_id, clients(name)")
        .eq("content_hash", signal.content_hash)
        .neq("id", signal.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      // Check for near-duplicates via similarity
      const { data: recentSignals } = await supabaseClient
        .from("signals")
        .select("id, title, normalized_text, created_at, status, severity, client_id, clients(name)")
        .neq("id", signal.id)
        .order("created_at", { ascending: false })
        .limit(200);

      // Calculate similarity scores for near-duplicates
      const contentLower = (signal.normalized_text || signal.description || "").toLowerCase();
      const nearDuplicates: any[] = [];

      if (recentSignals) {
        for (const s of recentSignals) {
          const compareText = (s.normalized_text || "").toLowerCase();
          
          // Simple similarity calculation (words in common / total unique words)
          const words1 = new Set(contentLower.split(/\s+/).filter((w: string) => w.length > 3));
          const words2 = new Set(compareText.split(/\s+/).filter((w: string) => w.length > 3));
          
          const intersection = new Set([...words1].filter(w => words2.has(w)));
          const union = new Set([...words1, ...words2]);
          
          const similarity = union.size > 0 ? intersection.size / union.size : 0;
          
          if (similarity >= threshold) {
            nearDuplicates.push({
              ...s,
              similarity_score: similarity,
              match_type: "content_similarity"
            });
          }
        }
      }

      const allDuplicates = [
        ...(hashMatches || []).map((d: any) => ({ ...d, similarity_score: 1.0, match_type: "exact_hash" })),
        ...nearDuplicates
      ].sort((a, b) => b.similarity_score - a.similarity_score);

      return {
        success: true,
        signal: {
          id: signal.id,
          title: signal.title,
          text_preview: signal.normalized_text?.substring(0, 200)
        },
        duplicates: allDuplicates.slice(0, limit),
        count: allDuplicates.length,
        exact_matches: hashMatches?.length || 0,
        near_matches: nearDuplicates.length,
        threshold_used: threshold,
        recommendation: allDuplicates.length > 0 
          ? `Found ${allDuplicates.length} duplicate/similar signals. Review these and consider using fix_duplicate_signals to merge or remove them.`
          : "No duplicates found for this signal."
      };
    }

    case "diagnose_feed_errors": {
      const { source_name, include_successful = false } = args;

      // Get monitoring history for RSS sources
      let query = supabaseClient
        .from("monitoring_history")
        .select("id, source_name, status, error_message, scan_started_at, scan_completed_at, items_scanned, signals_created, scan_metadata")
        .order("scan_started_at", { ascending: false })
        .limit(100);

      if (source_name) {
        query = query.eq("source_name", source_name);
      }

      if (!include_successful) {
        query = query.eq("status", "failed");
      }

      const { data: history, error } = await query;
      if (error) throw error;

      // Get source configuration
      let sourceQuery = supabaseClient
        .from("sources")
        .select("id, name, type, config, status, error_message, last_ingested_at")
        .eq("type", "rss");

      if (source_name) {
        sourceQuery = sourceQuery.eq("name", source_name);
      }

      const { data: sources } = await sourceQuery;

      // Analyze error patterns
      const errorPatterns: Record<string, any> = {};
      const diagnostics: any[] = [];

      history?.forEach((scan: any) => {
        const sourceName = scan.source_name;
        
        if (!errorPatterns[sourceName]) {
          errorPatterns[sourceName] = {
            source_name: sourceName,
            total_failures: 0,
            error_types: {},
            latest_error: null,
            last_success: null,
            failure_rate: 0
          };
        }

        if (scan.status === "failed") {
          errorPatterns[sourceName].total_failures++;
          
          // Categorize error type
          const errorMsg = scan.error_message || "Unknown error";
          let errorType = "unknown";
          
          if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
            errorType = "403_forbidden";
          } else if (errorMsg.includes("404")) {
            errorType = "404_not_found";
          } else if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
            errorType = "timeout";
          } else if (errorMsg.includes("SSL") || errorMsg.includes("certificate")) {
            errorType = "ssl_error";
          } else if (errorMsg.includes("DNS") || errorMsg.includes("ENOTFOUND")) {
            errorType = "dns_error";
          } else if (errorMsg.includes("rate") || errorMsg.includes("429")) {
            errorType = "rate_limit";
          }
          
          errorPatterns[sourceName].error_types[errorType] = 
            (errorPatterns[sourceName].error_types[errorType] || 0) + 1;
          
          if (!errorPatterns[sourceName].latest_error) {
            errorPatterns[sourceName].latest_error = {
              message: errorMsg,
              timestamp: scan.scan_started_at,
              metadata: scan.scan_metadata
            };
          }
        } else if (scan.status === "completed" && !errorPatterns[sourceName].last_success) {
          errorPatterns[sourceName].last_success = scan.scan_started_at;
        }
      });

      // Generate diagnostic recommendations
      Object.values(errorPatterns).forEach((pattern: any) => {
        const recommendations: string[] = [];
        const primaryError = Object.entries(pattern.error_types)
          .sort(([, a]: any, [, b]: any) => b - a)[0];

        if (primaryError) {
          const [errorType, count] = primaryError;
          
          switch (errorType) {
            case "403_forbidden":
              recommendations.push(
                "403 Forbidden errors suggest the RSS feed is blocking automated access.",
                "Try adding a User-Agent header that mimics a real browser.",
                "Some feeds require authentication or API keys.",
                "The feed may have implemented anti-bot measures. Consider using a proxy or rate limiting."
              );
              break;
            case "404_not_found":
              recommendations.push(
                "404 Not Found indicates the RSS feed URL has changed or been removed.",
                "Verify the feed URL is still valid by testing in a browser.",
                "Check if the source has moved to a different domain or path.",
                "Contact the source provider for the updated feed URL."
              );
              break;
            case "timeout":
              recommendations.push(
                "Connection timeouts suggest network issues or slow server responses.",
                "Increase the timeout threshold in the monitoring function.",
                "The feed server may be overloaded or experiencing issues.",
                "Consider implementing exponential backoff retry logic."
              );
              break;
            case "ssl_error":
              recommendations.push(
                "SSL/TLS certificate errors indicate security configuration issues.",
                "The feed may be using an expired or invalid SSL certificate.",
                "Try accessing the URL with SSL verification disabled (not recommended for production).",
                "Contact the feed provider about their SSL configuration."
              );
              break;
            case "dns_error":
              recommendations.push(
                "DNS resolution errors mean the domain cannot be found.",
                "Verify the domain name is spelled correctly.",
                "The domain may have expired or been changed.",
                "Check if your DNS server can resolve the domain."
              );
              break;
            case "rate_limit":
              recommendations.push(
                "Rate limiting (429) means too many requests are being sent.",
                "Reduce scan frequency in the source configuration.",
                "Implement request throttling and backoff.",
                "Contact the feed provider about rate limit increases."
              );
              break;
            default:
              recommendations.push(
                "Review the full error message for specific details.",
                "Check if the RSS feed format has changed.",
                "Test the feed manually to verify it's accessible.",
                "Review edge function logs for more diagnostic information."
              );
          }
        }

        diagnostics.push({
          source: pattern.source_name,
          total_failures: pattern.total_failures,
          error_breakdown: pattern.error_types,
          latest_error: pattern.latest_error,
          last_success: pattern.last_success,
          recommendations: recommendations
        });
      });

      return {
        success: true,
        diagnostics: diagnostics,
        sources_analyzed: diagnostics.length,
        total_failures: Object.values(errorPatterns).reduce((sum: number, p: any) => sum + p.total_failures, 0),
        source_configurations: sources || [],
        summary: diagnostics.length === 0 
          ? "No RSS feed errors found in recent scans."
          : `Analyzed ${diagnostics.length} RSS sources with errors. Review recommendations above for each source.`
      };
    }

    case "submit_ai_feedback": {
      const { object_id, object_type, feedback, notes, correction } = args;

      // Create feedback record
      const { data: feedbackRecord, error } = await supabaseClient
        .from("feedback_events")
        .insert({
          object_id,
          object_type,
          feedback,
          notes: notes || correction || null
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to submit feedback:", error);
        return {
          success: false,
          message: `Failed to submit feedback: ${error.message}`
        };
      }

      // Update the object's feedback rating if applicable
      if (object_type === "entity_content") {
        const rating = feedback === "positive" ? 1 : (feedback === "negative" ? -1 : 0);
        await supabaseClient
          .from("entity_content")
          .update({ 
            feedback_rating: rating,
            feedback_at: new Date().toISOString()
          })
          .eq("id", object_id);
      } else if (object_type === "entity") {
        // Could update entity threat_score based on feedback
        console.log(`Feedback recorded for entity ${object_id}: ${feedback}`);
      }

      return {
        success: true,
        message: `Feedback recorded successfully. ${feedback === "negative" && correction ? "Your correction will be used to improve future AI responses." : "Thank you for helping improve the system!"}`,
        feedback_id: feedbackRecord.id
      };
    }

    case "read_client_monitoring_config": {
      const { client_id, include_sources = true } = args;

      // Resolve client_id if name is provided
      let resolvedClientId = client_id;
      if (client_id && !client_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        const { data: client } = await supabaseClient
          .from("clients")
          .select("id")
          .ilike("name", client_id)
          .single();
        resolvedClientId = client?.id;
      }

      if (!resolvedClientId) {
        return {
          success: false,
          message: "Client not found. Please provide a valid client UUID or name."
        };
      }

      // Get client monitoring configuration
      const { data: client, error: clientError } = await supabaseClient
        .from("clients")
        .select("id, name, monitoring_keywords, competitor_names, high_value_assets, supply_chain_entities, monitoring_config")
        .eq("id", resolvedClientId)
        .single();

      if (clientError || !client) {
        return {
          success: false,
          message: `Failed to retrieve client config: ${clientError?.message || "Client not found"}`
        };
      }

      // Get RSS/OSINT sources and their health status
      let sources: any[] = [];
      let sourceHealth: any = {};
      
      if (include_sources) {
        const { data: sourcesData } = await supabaseClient
          .from("sources")
          .select("id, name, type, status, error_message, last_ingested_at, monitor_type");
        
        sources = sourcesData || [];

        // Get recent scan history for source health
        const { data: history } = await supabaseClient
          .from("monitoring_history")
          .select("source_name, status, scan_started_at, signals_created, items_scanned")
          .gte("scan_started_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order("scan_started_at", { ascending: false });

        // Calculate health metrics per source
        (history || []).forEach((scan: any) => {
          if (!sourceHealth[scan.source_name]) {
            sourceHealth[scan.source_name] = {
              total_scans: 0,
              successful: 0,
              failed: 0,
              total_signals: 0,
              health_score: 0
            };
          }
          sourceHealth[scan.source_name].total_scans++;
          if (scan.status === "completed") {
            sourceHealth[scan.source_name].successful++;
            sourceHealth[scan.source_name].total_signals += scan.signals_created || 0;
          } else if (scan.status === "failed") {
            sourceHealth[scan.source_name].failed++;
          }
        });

        // Calculate health scores
        Object.keys(sourceHealth).forEach((sourceName) => {
          const health = sourceHealth[sourceName];
          health.health_score = health.total_scans > 0 
            ? (health.successful / health.total_scans) * 100 
            : 0;
        });
      }

      return {
        success: true,
        client: {
          id: client.id,
          name: client.name,
          monitoring_keywords: client.monitoring_keywords || [],
          competitor_names: client.competitor_names || [],
          high_value_assets: client.high_value_assets || [],
          supply_chain_entities: client.supply_chain_entities || [],
          monitoring_config: client.monitoring_config
        },
        sources: sources,
        source_health: sourceHealth,
        summary: `Retrieved monitoring configuration for ${client.name}. ${client.monitoring_keywords?.length || 0} keywords, ${sources.length} sources configured.`
      };
    }

    case "suggest_monitoring_adjustments": {
      const { client_id, analysis_summary, keyword_changes, source_changes } = args;

      // Store suggestions in intelligence_config for human review
      const suggestion = {
        client_id,
        analysis_summary,
        keyword_changes,
        source_changes,
        timestamp: new Date().toISOString(),
        status: "pending_approval"
      };

      const { data, error } = await supabaseClient
        .from("intelligence_config")
        .upsert({
          key: `monitoring_suggestions_${client_id}_${Date.now()}`,
          value: suggestion,
          description: `AI-suggested monitoring adjustments for client ${client_id}`,
          updated_by: null
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to save monitoring suggestions:", error);
        return {
          success: false,
          message: `Failed to save suggestions: ${error.message}`
        };
      }

      return {
        success: true,
        message: `Monitoring adjustment suggestions saved for human review. Analysis: ${analysis_summary}`,
        suggestion_id: data.key,
        changes_summary: {
          keywords: {
            add: keyword_changes?.add?.length || 0,
            remove: keyword_changes?.remove?.length || 0,
            modify: keyword_changes?.modify?.length || 0
          },
          sources: {
            disable: source_changes?.disable?.length || 0,
            prioritize: source_changes?.prioritize?.length || 0
          }
        },
        next_step: "These suggestions require human approval before being applied to the client's monitoring configuration."
      };
    }

    case "analyze_signal_patterns": {
      const { client_id, days_back = 30, min_confidence = 0.75 } = args;
      const cutoffDate = new Date(Date.now() - days_back * 24 * 60 * 60 * 1000).toISOString();

      // Build signal query
      let signalQuery = supabaseClient
        .from("signals")
        .select("id, source, category, priority, confidence_score, matched_keywords, created_at, classification")
        .gte("created_at", cutoffDate)
        .order("created_at", { ascending: false });

      if (client_id) {
        signalQuery = signalQuery.eq("client_id", client_id);
      }

      const { data: signals, error } = await signalQuery.limit(1000);

      if (error) {
        return {
          success: false,
          message: `Failed to analyze patterns: ${error.message}`
        };
      }

      // Analyze patterns
      const patterns: any = {
        by_source: {},
        by_keyword: {},
        by_category: {},
        categorization_accuracy: {}
      };

      (signals || []).forEach((signal: any) => {
        // Source patterns
        if (!patterns.by_source[signal.source]) {
          patterns.by_source[signal.source] = {
            total: 0,
            categories: {},
            avg_confidence: 0,
            confidence_sum: 0
          };
        }
        patterns.by_source[signal.source].total++;
        patterns.by_source[signal.source].confidence_sum += signal.confidence_score || 0;
        patterns.by_source[signal.source].categories[signal.category] = 
          (patterns.by_source[signal.source].categories[signal.category] || 0) + 1;

        // Keyword patterns
        (signal.matched_keywords || []).forEach((keyword: string) => {
          if (!patterns.by_keyword[keyword]) {
            patterns.by_keyword[keyword] = {
              total: 0,
              categories: {},
              sources: {}
            };
          }
          patterns.by_keyword[keyword].total++;
          patterns.by_keyword[keyword].categories[signal.category] = 
            (patterns.by_keyword[keyword].categories[signal.category] || 0) + 1;
          patterns.by_keyword[keyword].sources[signal.source] = 
            (patterns.by_keyword[keyword].sources[signal.source] || 0) + 1;
        });

        // Category patterns
        if (!patterns.by_category[signal.category]) {
          patterns.by_category[signal.category] = {
            total: 0,
            sources: {},
            priorities: {}
          };
        }
        patterns.by_category[signal.category].total++;
        patterns.by_category[signal.category].sources[signal.source] = 
          (patterns.by_category[signal.category].sources[signal.source] || 0) + 1;
        patterns.by_category[signal.category].priorities[signal.priority] = 
          (patterns.by_category[signal.category].priorities[signal.priority] || 0) + 1;
      });

      // Calculate confidence scores
      Object.values(patterns.by_source).forEach((sourcePattern: any) => {
        sourcePattern.avg_confidence = sourcePattern.confidence_sum / sourcePattern.total;
      });

      // Identify high-confidence patterns (potential automation candidates)
      const automationCandidates: any[] = [];
      
      Object.entries(patterns.by_source).forEach(([source, data]: [string, any]) => {
        const dominantCategory = Object.entries(data.categories)
          .sort(([, a]: any, [, b]: any) => b - a)[0];
        
        if (dominantCategory) {
          const [category, count] = dominantCategory;
          const confidence = (count as number) / data.total;
          
          if (confidence >= min_confidence) {
            automationCandidates.push({
              pattern_type: "source_to_category",
              source,
              category,
              confidence,
              sample_size: data.total,
              suggestion: `Signals from "${source}" are ${(confidence * 100).toFixed(1)}% likely to be "${category}". Consider auto-categorizing.`
            });
          }
        }
      });

      return {
        success: true,
        analysis_period: `${days_back} days`,
        signals_analyzed: signals?.length || 0,
        patterns: patterns,
        automation_candidates: automationCandidates,
        summary: `Analyzed ${signals?.length || 0} signals. Found ${automationCandidates.length} high-confidence patterns (≥${min_confidence * 100}%) suitable for automation.`
      };
    }

    case "suggest_categorization_rules": {
      const { rule_type = "all", pattern_source, confidence_threshold = 0.8 } = args;

      // Get recent signal patterns
      const { data: signals } = await supabaseClient
        .from("signals")
        .select("id, source, category, priority, matched_keywords, classification")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1000);

      const suggestedRules: any[] = [];

      // Analyze for categorization rules
      if (rule_type === "all" || rule_type === "categorization") {
        const sourceCategories: any = {};
        
        (signals || []).forEach((signal: any) => {
          if (!sourceCategories[signal.source]) {
            sourceCategories[signal.source] = {};
          }
          sourceCategories[signal.source][signal.category] = 
            (sourceCategories[signal.source][signal.category] || 0) + 1;
        });

        Object.entries(sourceCategories).forEach(([source, categories]: [string, any]) => {
          const total = Object.values(categories).reduce((sum: number, count: any) => sum + count, 0);
          const dominant = Object.entries(categories).sort(([, a]: any, [, b]: any) => b - a)[0];
          
          if (dominant) {
            const [category, count] = dominant;
            const confidence = (count as number) / total;
            
            if (confidence >= confidence_threshold) {
              suggestedRules.push({
                rule_type: "auto_categorize",
                confidence,
                rule: {
                  condition: { source },
                  action: { set_category: category },
                  reason: `${(confidence * 100).toFixed(1)}% of signals from "${source}" are "${category}"`,
                  sample_size: total
                }
              });
            }
          }
        });
      }

      // Analyze for tagging rules
      if (rule_type === "all" || rule_type === "tagging") {
        const keywordTags: any = {};
        
        (signals || []).forEach((signal: any) => {
          (signal.matched_keywords || []).forEach((keyword: string) => {
            if (!keywordTags[keyword]) {
              keywordTags[keyword] = { categories: {}, total: 0 };
            }
            keywordTags[keyword].total++;
            keywordTags[keyword].categories[signal.category] = 
              (keywordTags[keyword].categories[signal.category] || 0) + 1;
          });
        });

        Object.entries(keywordTags).forEach(([keyword, data]: [string, any]) => {
          if (data.total >= 10) { // Minimum sample size
            const dominant = Object.entries(data.categories).sort(([, a]: any, [, b]: any) => b - a)[0];
            if (dominant) {
              const [category, count] = dominant;
              const confidence = (count as number) / data.total;
              
              if (confidence >= confidence_threshold) {
                suggestedRules.push({
                  rule_type: "auto_tag",
                  confidence,
                  rule: {
                    condition: { keyword_contains: keyword },
                    action: { add_tags: [category, "auto_tagged"] },
                    reason: `${(confidence * 100).toFixed(1)}% of signals with keyword "${keyword}" are "${category}"`,
                    sample_size: data.total
                  }
                });
              }
            }
          }
        });
      }

      // Convert suggested rules to the format expected by RuleApprovals page
      const proposals = suggestedRules.map((sr: any) => ({
        rule_name: sr.rule_type === "auto_categorize" 
          ? `Auto-categorize ${sr.rule.action.set_category} from ${sr.rule.condition.source}`
          : `Auto-tag ${sr.rule.action.add_tags.join(', ')} for ${sr.rule.condition.keyword_contains}`,
        description: sr.rule.reason,
        conditions: sr.rule.condition,
        actions: sr.rule.action,
        rationale: `Based on analysis of ${sr.rule.sample_size} historical signals with ${(sr.confidence * 100).toFixed(1)}% confidence`,
        estimated_impact: `Will affect approximately ${sr.rule.sample_size} signals per month`
      }));

      // Save rules for human review with proper format
      if (proposals.length > 0) {
        const timestamp = Date.now();
        await supabaseClient
          .from("intelligence_config")
          .upsert({
            key: `signal_categorization_rules_proposal_${timestamp}`,
            value: { 
              status: "pending_review",
              proposals: proposals,
              confidence_threshold: confidence_threshold,
              analysis_context: pattern_source || `Analyzed ${signals?.length || 0} signals over 30 days`,
              created_at: new Date().toISOString()
            },
            description: `AI-suggested categorization and routing rules (${confidence_threshold * 100}% confidence threshold)`
          });
        
        return {
          success: true,
          proposal_id: `signal_categorization_rules_proposal_${timestamp}`,
          rules_suggested: proposals.length,
          proposals: proposals,
          summary: `✅ Submitted ${proposals.length} rule proposals for human review. View them in the [Rule Approvals](/rule-approvals) page.`,
          next_step: "Navigate to Settings → Rule Approvals to review and approve these rules."
        };
      }

      return {
        success: false,
        rules_suggested: 0,
        summary: `No high-confidence patterns found with ${confidence_threshold * 100}% threshold. Try lowering the threshold or analyzing more data.`
      };
    }

    case "submit_rule_proposal": {
      const { 
        rule_name, 
        description, 
        conditions, 
        actions, 
        rationale, 
        estimated_impact = "Impact not specified",
        confidence_threshold = 0.85 
      } = args;

      // Validate required fields
      if (!rule_name || !description || !conditions || !actions || !rationale) {
        return {
          success: false,
          error: "Missing required fields. Need: rule_name, description, conditions, actions, rationale"
        };
      }

      // Create the proposal in the expected format
      const proposal = {
        rule_name,
        description,
        conditions,
        actions,
        rationale,
        estimated_impact
      };

      // Store the rule proposal in intelligence_config for human review
      const timestamp = Date.now();
      const proposalKey = `signal_categorization_rules_proposal_${timestamp}`;
      
      const { error } = await supabaseClient
        .from("intelligence_config")
        .upsert({
          key: proposalKey,
          value: { 
            status: "pending_review",
            proposals: [proposal],
            confidence_threshold: confidence_threshold,
            analysis_context: `AI Assistant submitted pre-defined rule: ${rule_name}`,
            created_at: new Date().toISOString(),
            submitted_by: "ai_assistant"
          },
          description: `AI-submitted rule proposal: ${rule_name}`
        });

      if (error) {
        console.error("Error submitting rule proposal:", error);
        return {
          success: false,
          error: `Failed to submit rule: ${error.message}`
        };
      }

      return {
        success: true,
        proposal_id: proposalKey,
        rule_name: rule_name,
        summary: `✅ Successfully submitted rule proposal "${rule_name}" for human review. The rule is now visible in the Rule Approvals page.`,
        next_step: "Navigate to Settings → Rule Approvals to review and approve this rule.",
        proposal_details: proposal
      };
    }

    case "analyze_cross_client_threats": {
      const { time_window_days = 14, min_client_count = 2, threat_categories } = args;
      const cutoffDate = new Date(Date.now() - time_window_days * 24 * 60 * 60 * 1000).toISOString();

      // Get signals across all clients
      let query = supabaseClient
        .from("signals")
        .select("id, client_id, source, category, priority, matched_keywords, normalized_text, created_at, clients(name)")
        .gte("created_at", cutoffDate)
        .order("created_at", { ascending: false });

      if (threat_categories && threat_categories.length > 0) {
        query = query.in("category", threat_categories);
      }

      const { data: signals, error } = await query.limit(2000);

      if (error) {
        return {
          success: false,
          message: `Failed to analyze cross-client threats: ${error.message}`
        };
      }

      // Analyze patterns across clients
      const keywordClientMap: any = {};
      const categoryClientMap: any = {};
      const threatPatterns: any[] = [];

      (signals || []).forEach((signal: any) => {
        // Track keywords across clients
        (signal.matched_keywords || []).forEach((keyword: string) => {
          if (!keywordClientMap[keyword]) {
            keywordClientMap[keyword] = new Set();
          }
          keywordClientMap[keyword].add(signal.client_id);
        });

        // Track categories across clients
        if (!categoryClientMap[signal.category]) {
          categoryClientMap[signal.category] = { clients: new Set(), count: 0 };
        }
        categoryClientMap[signal.category].clients.add(signal.client_id);
        categoryClientMap[signal.category].count++;
      });

      // Identify cross-client patterns
      Object.entries(keywordClientMap).forEach(([keyword, clientSet]: [string, any]) => {
        const clientCount = clientSet.size;
        if (clientCount >= min_client_count) {
          const relatedSignals = (signals || []).filter((s: any) => 
            (s.matched_keywords || []).includes(keyword)
          );
          
          threatPatterns.push({
            pattern_type: "keyword_across_clients",
            keyword,
            affected_clients: clientCount,
            total_signals: relatedSignals.length,
            priority_distribution: relatedSignals.reduce((acc: any, s: any) => {
              acc[s.priority] = (acc[s.priority] || 0) + 1;
              return acc;
            }, {}),
            first_seen: relatedSignals[relatedSignals.length - 1]?.created_at,
            last_seen: relatedSignals[0]?.created_at,
            alert_level: clientCount >= 3 ? "high" : "medium"
          });
        }
      });

      // Identify category-based cross-client trends
      Object.entries(categoryClientMap).forEach(([category, data]: [string, any]) => {
        const clientCount = data.clients.size;
        if (clientCount >= min_client_count && data.count >= 5) {
          threatPatterns.push({
            pattern_type: "category_surge",
            category,
            affected_clients: clientCount,
            total_signals: data.count,
            alert_level: data.count > 20 ? "high" : "medium",
            analysis: `Unusual surge in "${category}" signals affecting ${clientCount} clients`
          });
        }
      });

      // Sort by alert level and affected client count
      threatPatterns.sort((a, b) => {
        if (a.alert_level !== b.alert_level) {
          return a.alert_level === "high" ? -1 : 1;
        }
        return b.affected_clients - a.affected_clients;
      });

      return {
        success: true,
        analysis_window: `${time_window_days} days`,
        signals_analyzed: signals?.length || 0,
        patterns_detected: threatPatterns.length,
        patterns: threatPatterns,
        summary: `Detected ${threatPatterns.length} cross-client threat patterns. ${threatPatterns.filter((p: any) => p.alert_level === "high").length} high-priority patterns require immediate attention.`,
        recommendation: threatPatterns.length > 0 
          ? "Review high-priority patterns for potential coordinated threats or emerging attack campaigns."
          : "No significant cross-client threat patterns detected in the analysis window."
      };
    }

    case "detect_signal_anomalies": {
      const { detection_type = "all", baseline_days = 30, sensitivity = 7 } = args;
      const baselineCutoff = new Date(Date.now() - baseline_days * 24 * 60 * 60 * 1000).toISOString();
      const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Last 24h

      // Get baseline signals
      const { data: baselineSignals } = await supabaseClient
        .from("signals")
        .select("id, source, category, matched_keywords, created_at, priority")
        .gte("created_at", baselineCutoff)
        .lt("created_at", recentCutoff);

      // Get recent signals
      const { data: recentSignals } = await supabaseClient
        .from("signals")
        .select("id, source, category, matched_keywords, created_at, priority")
        .gte("created_at", recentCutoff);

      const anomalies: any[] = [];

      // Volume spike detection
      if (detection_type === "all" || detection_type === "volume_spike") {
        const baselineAvgPerDay = (baselineSignals?.length || 0) / baseline_days;
        const recentCount = recentSignals?.length || 0;
        const threshold = baselineAvgPerDay * (1 + (sensitivity / 10));

        if (recentCount > threshold) {
          anomalies.push({
            anomaly_type: "volume_spike",
            severity: recentCount > threshold * 1.5 ? "high" : "medium",
            description: `Signal volume spike detected: ${recentCount} signals in last 24h vs baseline ${baselineAvgPerDay.toFixed(1)}/day`,
            baseline: baselineAvgPerDay,
            current: recentCount,
            deviation_percent: ((recentCount - baselineAvgPerDay) / baselineAvgPerDay * 100).toFixed(1)
          });
        }
      }

      // New keyword detection
      if (detection_type === "all" || detection_type === "new_keywords") {
        const baselineKeywords = new Set(
          (baselineSignals || []).flatMap((s: any) => s.matched_keywords || [])
        );
        const recentKeywords = new Set(
          (recentSignals || []).flatMap((s: any) => s.matched_keywords || [])
        );

        const newKeywords = [...recentKeywords].filter(k => !baselineKeywords.has(k));
        
        if (newKeywords.length > 0) {
          const significantNew = (newKeywords as string[]).filter((keyword: string) => {
            const count = (recentSignals || []).filter((s: any) => 
              (s.matched_keywords || []).includes(keyword)
            ).length;
            return count >= sensitivity / 2; // Threshold based on sensitivity
          });

          if (significantNew.length > 0) {
            anomalies.push({
              anomaly_type: "new_keywords",
              severity: significantNew.length > 5 ? "high" : "medium",
              description: `${significantNew.length} new significant keywords detected`,
              keywords: significantNew.slice(0, 10),
              analysis: "New keywords may indicate emerging threats or attack vectors"
            });
          }
        }
      }

      // Geographic/source shift detection
      if (detection_type === "all" || detection_type === "geographic_shift") {
        const baselineSources: any = {};
        const recentSources: any = {};

        (baselineSignals || []).forEach((s: any) => {
          baselineSources[s.source] = (baselineSources[s.source] || 0) + 1;
        });

        (recentSignals || []).forEach((s: any) => {
          recentSources[s.source] = (recentSources[s.source] || 0) + 1;
        });

        Object.keys(recentSources).forEach((source: string) => {
          const baselineCount = baselineSources[source] || 0;
          const recentCount = recentSources[source];
          const baselineAvg = baselineCount / baseline_days;
          
          if (recentCount > baselineAvg * (1 + (sensitivity / 10))) {
            anomalies.push({
              anomaly_type: "source_surge",
              severity: recentCount > baselineAvg * 2 ? "high" : "medium",
              source,
              description: `Unusual activity surge from source "${source}"`,
              baseline_avg: baselineAvg.toFixed(1),
              recent_count: recentCount,
              deviation_percent: ((recentCount - baselineAvg) / (baselineAvg || 1) * 100).toFixed(1)
            });
          }
        });
      }

      return {
        success: true,
        detection_window: "Last 24 hours vs 30-day baseline",
        sensitivity_level: sensitivity,
        anomalies_detected: anomalies.length,
        anomalies: anomalies,
        summary: anomalies.length > 0
          ? `Detected ${anomalies.length} anomalies. ${anomalies.filter((a: any) => a.severity === "high").length} require immediate investigation.`
          : "No significant anomalies detected in recent signal activity.",
        recommendation: anomalies.length > 0
          ? "Investigate high-severity anomalies for potential security incidents or emerging threats."
          : "Signal activity is within normal parameters."
      };
    }


    case "search_bug_reports": {
      let query = supabaseClient
        .from("bug_reports")
        .select("id, title, description, severity, status, created_at, page_url, user_id, profiles(name)")
        .order("created_at", { ascending: false })
        .limit(args.limit || 20);

      if (args.query) {
        query = query.or(`title.ilike.%${args.query}%,description.ilike.%${args.query}%`);
      }

      if (args.status) {
        query = query.eq("status", args.status);
      }

      if (args.severity) {
        query = query.eq("severity", args.severity);
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        success: true,
        bugs: data,
        count: data?.length || 0,
        summary: {
          open: data?.filter((b: any) => b.status === 'open').length || 0,
          in_progress: data?.filter((b: any) => b.status === 'in_progress').length || 0,
          resolved: data?.filter((b: any) => b.status === 'resolved').length || 0,
          critical: data?.filter((b: any) => b.severity === 'critical').length || 0,
          high: data?.filter((b: any) => b.severity === 'high').length || 0
        }
      };
    }

    case "get_bug_report_details": {
      const { data, error } = await supabaseClient
        .from("bug_reports")
        .select("*, profiles(name, email)")
        .eq("id", args.bug_id)
        .single();

      if (error) throw error;
      if (!data) {
        return { success: false, message: "Bug report not found" };
      }

      return {
        success: true,
        bug: {
          id: data.id,
          title: data.title,
          description: data.description,
          severity: data.severity,
          status: data.status,
          page_url: data.page_url,
          browser_info: data.browser_info,
          screenshots: data.screenshots,
          created_at: data.created_at,
          updated_at: data.updated_at,
          resolved_at: data.resolved_at,
          reporter: data.profiles
        }
      };
    }

    case "analyze_edge_function_errors": {
      const hoursBack = args.hours_back || 24;
      const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

      let query = supabaseClient
        .from("monitoring_history")
        .select("source_name, status, error_message, scan_started_at, scan_completed_at, items_scanned, signals_created")
        .eq("status", "error")
        .gte("scan_started_at", startTime)
        .order("scan_started_at", { ascending: false })
        .limit(100);

      if (args.function_name) {
        query = query.eq("source_name", args.function_name);
      }

      const { data: errors, error } = await query;
      if (error) throw error;

      // Group errors by function and error message
      const errorsByFunction: Record<string, any> = {};
      errors?.forEach((err: any) => {
        if (!errorsByFunction[err.source_name]) {
          errorsByFunction[err.source_name] = {
            function_name: err.source_name,
            error_count: 0,
            unique_errors: new Set(),
            recent_errors: []
          };
        }
        errorsByFunction[err.source_name].error_count++;
        errorsByFunction[err.source_name].unique_errors.add(err.error_message);
        if (errorsByFunction[err.source_name].recent_errors.length < 5) {
          errorsByFunction[err.source_name].recent_errors.push({
            message: err.error_message,
            timestamp: err.scan_started_at
          });
        }
      });

      // Convert sets to arrays for JSON serialization
      Object.values(errorsByFunction).forEach((func: any) => {
        func.unique_errors = Array.from(func.unique_errors);
      });

      return {
        success: true,
        time_window: `Last ${hoursBack} hours`,
        total_errors: errors?.length || 0,
        functions_with_errors: Object.keys(errorsByFunction).length,
        errors_by_function: Object.values(errorsByFunction),
        recommendation: errors?.length === 0 
          ? "No errors found in the specified time window."
          : "Review the error messages above to identify patterns. Common issues include rate limiting, API failures, and invalid data."
      };
    }

    case "diagnose_bug": {
      const { description, error_message, affected_area } = args;

      // Build diagnosis by analyzing related components
      const diagnosis: any = {
        bug_description: description,
        affected_area: affected_area,
        error_message: error_message || "No error message provided",
        analysis: [],
        potential_root_causes: [],
        investigation_steps: [],
        related_components: []
      };

      // Analyze based on affected area
      const areaLower = affected_area.toLowerCase();

      if (areaLower.includes("signal") || areaLower.includes("monitoring")) {
        diagnosis.related_components = [
          "Edge functions: monitor-* functions",
          "Database: signals, monitoring_history tables",
          "Frontend: Signals page, SignalDetailDialog",
          "Functions: ingest-signal, correlate-signals"
        ];
        diagnosis.potential_root_causes = [
          "Rate limiting on external APIs",
          "Invalid or missing monitoring keywords",
          "Database connection issues",
          "Correlation algorithm timeout",
          "Missing or malformed signal data"
        ];
        diagnosis.investigation_steps = [
          "Check monitoring_history for failed scans",
          "Review edge function logs for specific monitor function",
          "Verify client monitoring keywords are valid",
          "Check signal data structure and required fields",
          "Test correlation function with sample data"
        ];
      } else if (areaLower.includes("entity") || areaLower.includes("osint")) {
        diagnosis.related_components = [
          "Edge functions: osint-entity-scan, scan-entity-content",
          "Database: entities, entity_content, entity_mentions",
          "Frontend: Entity pages, EntityDetailDialog",
          "APIs: Google Search API"
        ];
        diagnosis.potential_root_causes = [
          "Google Search API quota exceeded or key invalid",
          "Entity name formatting issues",
          "Network timeout during OSINT scan",
          "Invalid entity type or missing required fields",
          "Content parsing failures"
        ];
        diagnosis.investigation_steps = [
          "Verify Google Search API key and quotas",
          "Check entity data structure for required fields",
          "Review osint-entity-scan logs for errors",
          "Test entity scan with simple query",
          "Verify entity_content table RLS policies"
        ];
      } else if (areaLower.includes("incident")) {
        diagnosis.related_components = [
          "Edge functions: ai-decision-engine, check-incident-escalation",
          "Database: incidents, incident_signals, escalation_rules",
          "Frontend: Incidents page, incident management",
          "AI: Lovable AI decision making"
        ];
        diagnosis.potential_root_causes = [
          "AI decision engine timeout or failure",
          "Invalid escalation rule configuration",
          "Missing incident priority or status",
          "SLA calculation errors",
          "Alert delivery failures"
        ];
        diagnosis.investigation_steps = [
          "Check ai-decision-engine logs for errors",
          "Review escalation rules configuration",
          "Verify incident data completeness",
          "Test alert delivery channels",
          "Check SLA targets configuration"
        ];
      } else if (areaLower.includes("travel")) {
        diagnosis.related_components = [
          "Edge functions: monitor-travel-risks, parse-travel-itinerary",
          "Database: travelers, itineraries",
          "Frontend: Travel page, TravelersList, ItinerariesList",
          "Maps: Mapbox integration"
        ];
        diagnosis.potential_root_causes = [
          "Invalid itinerary file format",
          "Mapbox token issues",
          "Risk assessment API failures",
          "Date parsing errors",
          "Location geocoding failures"
        ];
        diagnosis.investigation_steps = [
          "Verify itinerary file format and data",
          "Check Mapbox token validity",
          "Review travel risk monitoring logs",
          "Test location geocoding",
          "Validate date ranges and time zones"
        ];
      } else {
        diagnosis.potential_root_causes = [
          "Authentication issues",
          "Database connection problems",
          "Frontend state management errors",
          "API rate limiting",
          "Missing environment variables"
        ];
        diagnosis.investigation_steps = [
          "Check browser console for errors",
          "Verify user authentication status",
          "Review edge function logs",
          "Test API connectivity",
          "Validate environment configuration"
        ];
      }

      diagnosis.analysis.push(
        `Analyzing ${affected_area} for: ${description}`,
        error_message ? `Error message indicates issues with: ${error_message.substring(0, 100)}` : "No error message to analyze",
        `Found ${diagnosis.related_components.length} related components`,
        `Identified ${diagnosis.potential_root_causes.length} potential root causes`
      );

      return {
        success: true,
        diagnosis: diagnosis,
        next_action: "Use analyze_edge_function_errors to check backend logs, or use get_database_schema to review data structure. Once root cause is confirmed, use suggest_code_fix for implementation guidance."
      };
    }

    case "suggest_code_fix": {
      const { bug_description, root_cause, affected_files } = args;

      const fix: any = {
        bug: bug_description,
        root_cause: root_cause,
        fix_strategy: "",
        code_changes: [],
        testing_steps: [],
        deployment_notes: []
      };

      // Generate fix strategy based on root cause
      if (root_cause.toLowerCase().includes("rate limit")) {
        fix.fix_strategy = "Implement rate limiting with exponential backoff and request queuing";
        fix.code_changes = [
          {
            file: "Affected edge function",
            change: "Add rate limiting logic with retry mechanism",
            example: `// Add at top of function\nconst RATE_LIMIT_DELAY = 1000; // ms\nconst MAX_RETRIES = 3;\n\nasync function fetchWithRetry(url: string, retries = 0): Promise<Response> {\n  try {\n    const response = await fetch(url);\n    if (response.status === 429 && retries < MAX_RETRIES) {\n      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY * Math.pow(2, retries)));\n      return fetchWithRetry(url, retries + 1);\n    }\n    return response;\n  } catch (error) {\n    if (retries < MAX_RETRIES) {\n      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));\n      return fetchWithRetry(url, retries + 1);\n    }\n    throw error;\n  }\n}`
          }
        ];
      } else if (root_cause.toLowerCase().includes("api") || root_cause.toLowerCase().includes("key")) {
        fix.fix_strategy = "Verify API configuration and add proper error handling";
        fix.code_changes = [
          {
            file: "Edge function with API calls",
            change: "Add API key validation and error handling",
            example: `const API_KEY = Deno.env.get('API_KEY_NAME');\nif (!API_KEY) {\n  return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 });\n}`
          }
        ];
      } else {
        fix.fix_strategy = "Add comprehensive error handling and logging";
        fix.code_changes = [
          {
            file: "Affected component",
            change: "Add error handling and logging",
            example: `try {\n  console.log('Operation started:', params);\n  const result = await performOperation(params);\n  console.log('Operation completed:', result);\n  return result;\n} catch (error) {\n  console.error('Operation failed:', error);\n  throw error;\n}`
          }
        ];
      }

      fix.testing_steps = [
        "Test with various input combinations",
        "Verify error handling works correctly",
        "Monitor logs after deployment",
        "Add regression test"
      ];

      fix.deployment_notes = [
        "Test in development first",
        "Monitor logs after deployment",
        "Update documentation if needed"
      ];

      return {
        success: true,
        fix: fix,
        priority: root_cause.toLowerCase().includes("critical") ? "HIGH" : "MEDIUM"
      };
    }

    case "create_fix_proposal": {
      const { 
        bug_id, 
        title, 
        description, 
        severity, 
        root_cause, 
        fix_strategy, 
        code_changes, 
        affected_files, 
        testing_steps 
      } = args;

      let targetBugId = bug_id;

      // If no bug_id provided, create a new bug report
      if (!targetBugId) {
        if (!title || !description || !severity) {
          return {
            success: false,
            message: "When creating a new bug report, title, description, and severity are required"
          };
        }

        const { data: newBug, error: createError } = await supabaseClient
          .from("bug_reports")
          .insert({
            title,
            description,
            severity,
            status: 'open',
            page_url: 'AI-detected',
            browser_info: 'Detected by AI Assistant'
          })
          .select("id")
          .single();

        if (createError) {
          console.error("Failed to create bug report:", createError);
          return {
            success: false,
            message: `Failed to create bug report: ${createError.message}`
          };
        }

        targetBugId = newBug.id;
      }

      // Create fix proposal
      const proposal = {
        root_cause,
        fix_strategy,
        code_changes,
        affected_files: affected_files || code_changes.map((c: any) => c.file),
        testing_steps: testing_steps || [
          "Test the specific functionality mentioned in the bug",
          "Verify no regressions in related features",
          "Check error logs after deployment"
        ],
        deployment_notes: [
          "Review code changes before deployment",
          "Monitor logs for 24 hours after deployment",
          "Be ready to rollback if issues arise"
        ],
        generated_at: new Date().toISOString(),
        ai_model: "google/gemini-2.5-flash"
      };

      // Update bug report with fix proposal
      const { data: updatedBug, error: updateError } = await supabaseClient
        .from("bug_reports")
        .update({
          fix_proposal: proposal,
          fix_status: 'proposal_ready',
          status: 'in_progress'
        })
        .eq("id", targetBugId)
        .select("id, title, fix_status")
        .single();

      if (updateError) {
        console.error("Failed to save fix proposal:", updateError);
        return {
          success: false,
          message: `Failed to save fix proposal: ${updateError.message}`
        };
      }

      return {
        success: true,
        message: `✅ Fix proposal created for bug: "${updatedBug.title}". The proposal is now ready for review and approval in the Bug Reports page.`,
        bug_id: updatedBug.id,
        proposal: proposal,
        next_steps: [
          "Admin/Analyst reviews the proposal in Bug Reports page",
          "If approved, you can ask the Lovable editor: 'Implement the approved fix for bug [bug_id]'",
          "The fix will be automatically applied to the codebase"
        ],
        view_url: "/bug-reports"
      };
    }

    case "suggest_improvements": {
      const area = args.area || "all";
      
      const suggestions: Record<string, string[]> = {
        monitoring: [
          "Add Reddit monitoring for emerging threats and discussions",
          "Implement Telegram channel monitoring for dark web threat intel",
          "Add Discord server monitoring for gaming/crypto communities",
          "Create automated screenshot capture for monitored websites",
          "Implement change detection for monitored web pages",
          "Add RSS feed aggregation from security blogs",
        ],
        security: [
          "Implement 2FA/MFA for user accounts",
          "Add IP-based rate limiting on edge functions",
          "Create automated security report generation",
          "Implement anomaly detection for unusual access patterns",
          "Add encrypted storage for sensitive documents",
          "Create audit logs for all data modifications",
        ],
        performance: [
          "Implement caching layer for frequently accessed signals",
          "Add database query optimization and indexing review",
          "Create background job queue for heavy processing",
          "Implement pagination for large result sets",
          "Add CDN for static asset delivery",
          "Optimize image storage with automatic compression",
        ],
        features: [
          "Add collaborative investigation workspace",
          "Implement threat actor profiling and tracking",
          "Create automated threat intelligence sharing",
          "Add customizable dashboard widgets",
          "Implement scheduled report delivery",
          "Create mobile app for incident response",
          "Add voice assistant for hands-free operations",
          "Implement graph visualization for entity relationships",
        ],
        ui: [
          "Add dark mode toggle preference",
          "Create customizable layouts for different roles",
          "Implement keyboard shortcuts for power users",
          "Add bulk actions for signal management",
          "Create guided tours for new users",
          "Implement advanced filtering and saved searches",
        ]
      };

      const relevantSuggestions = area === "all" 
        ? Object.entries(suggestions).flatMap(([category, items]) => 
            items.map(item => ({ category, suggestion: item }))
          )
        : (suggestions[area] || []).map((suggestion: string) => ({ category: area, suggestion }));

      return {
        success: true,
        area: area,
        total_suggestions: relevantSuggestions.length,
        suggestions: relevantSuggestions,
        implementation_note: "These improvements can be implemented through new edge functions, UI components, or database schema changes. Let me know which ones interest you and I can provide implementation guidance."
      };
    }

    case "generate_edge_function_template": {
      const { function_name, purpose } = args;
      
      const template = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('${function_name} function started');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch clients with monitoring keywords
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('id, name, monitoring_keywords')
      .eq('status', 'active');

    if (clientsError) throw clientsError;

    let totalScans = 0;
    let signalsCreated = 0;

    for (const client of clients) {
      console.log(\`Processing client: \${client.name}\`);
      
      // TODO: Implement ${purpose}
      // Example: Fetch data from external API
      // const response = await fetch('https://api.example.com/...');
      // const data = await response.json();
      
      // Example: Check for keyword matches
      for (const keyword of client.monitoring_keywords || []) {
        // Your monitoring logic here
        totalScans++;
        
        // If threat found, create signal
        // const { error } = await supabaseClient.from('signals').insert({
        //   title: 'Threat detected',
        //   description: 'Details...',
        //   severity: 'medium',
        //   client_id: client.id,
        //   source: '${function_name}',
        //   received_at: new Date().toISOString()
        // });
        // if (!error) signalsCreated++;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        scans_completed: totalScans,
        signals_created: signalsCreated 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ${function_name}:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});`;

      return {
        success: true,
        function_name: function_name,
        purpose: purpose,
        template: template,
        next_steps: [
          `1. Create file: supabase/functions/${function_name}/index.ts`,
          `2. Paste the template code and customize the TODO sections`,
          `3. Add function to supabase/config.toml`,
          `4. Test the function locally or deploy to production`,
          `5. Set up cron job if this should run automatically`
        ],
        deployment_note: "Edge functions are automatically deployed when you commit changes."
      };
    }

    case "analyze_platform_capabilities": {
      const capabilityType = args.capability_type || "all";
      
      type CapabilityArea = {
        has: string[];
        missing: string[];
      };
      
      const currentCapabilities: Record<string, CapabilityArea> = {
        monitoring: {
          has: [
            "News monitoring (Google News, RSS feeds)",
            "Social media monitoring (Twitter, Facebook, Instagram, LinkedIn)",
            "Dark web monitoring (Pastebin, paste sites)",
            "Threat intelligence feeds",
            "Weather and natural disaster alerts",
            "Court registry monitoring",
            "Domain and GitHub monitoring",
            "Canadian government source monitoring"
          ],
          missing: [
            "Reddit monitoring",
            "Telegram channel monitoring", 
            "Discord server monitoring",
            "TikTok monitoring",
            "Cryptocurrency wallet tracking",
            "Deep/dark web marketplace monitoring",
            "Automated OSINT from public records databases",
            "Patent and trademark monitoring"
          ]
        },
        analysis: {
          has: [
            "Entity extraction from signals",
            "Signal correlation and deduplication",
            "AI-powered incident classification",
            "Threat pattern detection",
            "Risk assessment scoring",
            "Sentiment analysis on content"
          ],
          missing: [
            "Predictive threat modeling",
            "Behavioral analysis of threat actors",
            "Network graph analysis",
            "Timeline reconstruction",
            "Attribution analysis",
            "Misinformation detection",
            "Advanced NLP for multilingual content"
          ]
        },
        automation: {
          has: [
            "Automated signal ingestion",
            "AI decision engine for incidents",
            "Escalation rules and SLA tracking",
            "Multi-channel alert delivery",
            "Document processing and entity extraction",
            "OSINT scanning on entities"
          ],
          missing: [
            "Automated response actions (blocking, quarantine)",
            "Threat intelligence sharing with partners",
            "Automated report generation and distribution",
            "ML-based false positive reduction",
            "Automated entity enrichment from multiple sources",
            "Intelligent alert grouping and summarization"
          ]
        },
        reporting: {
          has: [
            "Executive intelligence reports",
            "72-hour security snapshots",
            "Investigation case files",
            "Custom report generation"
          ],
          missing: [
            "Scheduled recurring reports",
            "Interactive dashboards with drill-down",
            "Comparative trend analysis",
            "Threat landscape reports",
            "Compliance reports (GDPR, SOC 2, etc.)",
            "Incident post-mortem templates"
          ]
        },
        integration: {
          has: [
            "Email alerts (Resend API)",
            "Slack webhooks",
            "Microsoft Teams webhooks",
            "Lovable AI for intelligence analysis"
          ],
          missing: [
            "SIEM integration (Splunk, ELK, QRadar)",
            "Ticketing system integration (Jira, ServiceNow)",
            "Threat intelligence platform integration (MISP, ThreatConnect)",
            "MDR/XDR platform integration",
            "Chat platform bots (Slack, Teams, Discord)",
            "API webhooks for custom integrations"
          ]
        }
      };

      const relevantCapabilities = capabilityType === "all"
        ? currentCapabilities
        : (currentCapabilities[capabilityType] ? { [capabilityType]: currentCapabilities[capabilityType] } : {});

      const priorityRecommendations = [
        {
          capability: "Reddit monitoring",
          priority: "HIGH",
          reason: "Reddit is a major source of emerging threats, data leaks, and underground discussions",
          effort: "Medium - similar to existing social monitoring functions"
        },
        {
          capability: "SIEM integration",
          priority: "HIGH", 
          reason: "Organizations need to correlate Fortress intelligence with their existing security tools",
          effort: "High - requires building connectors for multiple platforms"
        },
        {
          capability: "Predictive threat modeling",
          priority: "MEDIUM",
          reason: "Helps organizations anticipate threats before they materialize",
          effort: "High - requires ML model development and training"
        },
        {
          capability: "Automated response actions",
          priority: "MEDIUM",
          reason: "Reduces response time by automatically blocking threats",
          effort: "High - requires careful security controls and testing"
        }
      ];

      return {
        success: true,
        capability_type: capabilityType,
        current_capabilities: relevantCapabilities,
        priority_recommendations: priorityRecommendations,
        gap_analysis: {
          monitoring_coverage: "70% - Missing some social platforms and deep web sources",
          analysis_depth: "65% - Has basic analysis, lacks advanced ML and predictive capabilities",
          automation_level: "75% - Good automation for ingestion/alerting, lacks response automation",
          reporting_flexibility: "60% - Has core reports, needs more customization and scheduling",
          integration_breadth: "40% - Limited to basic webhooks, needs enterprise tool integration"
        }
      };
    }

    case "perform_impact_analysis": {
      const { signal_id, threat_actor_id } = args;
      
      console.log(`Calling perform-impact-analysis for signal: ${signal_id}`);
      
      const { data: analysisResult, error: analysisError } = await supabaseClient.functions.invoke(
        "perform-impact-analysis",
        {
          body: { signal_id, threat_actor_id },
        }
      );

      if (analysisError) {
        console.error("Error in perform-impact-analysis:", analysisError);
        return {
          error: analysisError.message,
          message: `Failed to perform impact analysis: ${analysisError.message}`,
        };
      }

      return {
        success: true,
        analysis: analysisResult,
        summary: `Risk Score: ${analysisResult.risk_score}/100 (${analysisResult.risk_level}). 
        Financial Impact: $${analysisResult.impact_assessment.financial_impact.estimated_cost_range.minimum}-${analysisResult.impact_assessment.financial_impact.estimated_cost_range.maximum}. 
        Operational Impact: ${analysisResult.impact_assessment.operational_impact.estimated_downtime_hours}h downtime estimated.`,
      };
    }

    case "update_risk_profile":
    case "recommend_playbook":
    case "draft_response_tasks":
    case "integrate_incident_management": {
      console.log(`Calling ai-tools-query for ${toolName}`);
      
      const { data: toolResult, error: toolError } = await supabaseClient.functions.invoke(
        "ai-tools-query",
        {
          body: { toolName, parameters: args },
        }
      );

      if (toolError) {
        console.error(`Error in ai-tools-query for ${toolName}:`, toolError);
        return {
          error: toolError.message,
          message: `Failed to execute ${toolName}: ${toolError.message}`,
        };
      }

      return toolResult.result;
    }

    case "propose_signal_merge": {
      const { primary_signal_id, duplicate_signal_ids, similarity_scores, rationale } = args;
      
      console.log(`Proposing merge for primary signal: ${primary_signal_id} with ${duplicate_signal_ids.length} duplicates`);
      
      const { data: mergeProposal, error: mergeError } = await supabaseClient.functions.invoke(
        "propose-signal-merge",
        {
          body: {
            primary_signal_id,
            duplicate_signal_ids,
            similarity_scores: similarity_scores || [],
            rationale: rationale || "AI-detected duplicate signals",
          },
        }
      );

      if (mergeError) {
        console.error("Error proposing signal merge:", mergeError);
        return {
          error: mergeError.message,
          message: `Failed to propose merge: ${mergeError.message}`,
        };
      }

      return {
        success: true,
        proposal_id: mergeProposal.proposal_id,
        message: `Merge proposal created successfully. ${duplicate_signal_ids.length} duplicate signals will be merged into primary signal ${primary_signal_id.slice(0, 8)}... after human approval. View proposals in the Approvals page (Signal Merges tab).`,
        details: mergeProposal,
      };
    }

    case "inject_test_signal": {
      const { text, client_id, severity = "medium", category = "test" } = args;
      
      console.log(`Injecting test signal for client: ${client_id}`);
      
      const { data: ingestResult, error: ingestError } = await supabaseClient.functions.invoke(
        "ingest-signal",
        {
          body: {
            text,
            client_id,
            severity,
            category,
            is_test: true,
          },
        }
      );

      if (ingestError) {
        console.error("Error injecting signal:", ingestError);
        return {
          error: ingestError.message,
          message: `Failed to inject signal: ${ingestError.message}`,
        };
      }

      return {
        success: true,
        signal_id: ingestResult.signal_id,
        message: `Test signal injected successfully with ID ${ingestResult.signal_id?.slice(0, 8)}... Rules will be applied automatically. Check the Signals page to see the categorized signal.`,
        details: ingestResult,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Tool execution error for ${toolName}:`, error);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Process messages to extract file attachments and format for vision
    const processedMessages = await Promise.all(
      messages.map(async (msg: any) => {
        // Look for image URLs in markdown format
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g;
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        
        const imageUrls: string[] = [];
        let match;
        
        // Extract images from markdown/HTML
        while ((match = imageRegex.exec(msg.content)) !== null) {
          const url = match[2] || match[3];
          if (url && (url.includes('ai-chat-attachments') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
            imageUrls.push(url);
          }
        }
        
        // If we have images, format as vision message
        if (imageUrls.length > 0 && msg.role === 'user') {
          const textContent = msg.content.replace(imageRegex, '').replace(markdownLinkRegex, '[$1]').trim();
          const contentParts: any[] = [];
          
          if (textContent) {
            contentParts.push({ type: "text", text: textContent });
          }
          
          for (const imageUrl of imageUrls) {
            contentParts.push({
              type: "image_url",
              image_url: { url: imageUrl }
            });
          }
          
          return {
            role: msg.role,
            content: contentParts.length > 0 ? contentParts : msg.content
          };
        }
        
        return msg;
      })
    );

    // First AI call with tools
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are the Fortress AI Assistant - an intelligent security operations assistant with comprehensive knowledge of the platform, its codebase, architecture, and all features.

PLATFORM OVERVIEW:
Fortress is a security intelligence and threat monitoring platform built on React/TypeScript frontend with Supabase (PostgreSQL + Edge Functions) backend. The platform automates OSINT collection, threat detection, incident management, entity tracking, travel security, and investigation management through 50+ edge functions and AI-powered automation.

SYSTEM ARCHITECTURE:
- Frontend: React + TypeScript + Tailwind CSS + Shadcn UI + React Query
- Backend: Supabase PostgreSQL with Row Level Security + 50+ Deno edge functions
- Automation: Auto-orchestrator coordinates monitoring, AI decision engine, escalation, alerts
- AI: Lovable AI (Gemini models) for decision-making, assistance, analysis
- Real-time: Supabase Realtime for live updates on tables
- Storage: Supabase Storage with RLS for files/photos/documents

KEY FEATURES & IMPLEMENTATION:
1. **Signals**: Raw OSINT intelligence → correlation → entity detection → AI incident creation
   - Tables: signals, signal_correlation_groups, entity_mentions
   - Functions: ingest-signal, correlate-signals, correlate-entities, ai-decision-engine

2. **Incidents**: Security events with escalation rules, SLA tracking, multi-channel alerts
   - Tables: incidents, incident_signals, incident_entities, alerts, escalation_rules
   - Functions: ai-decision-engine, check-incident-escalation, alert-delivery

3. **Entities**: Tracked people/orgs/locations with automated OSINT enrichment
   - Tables: entities, entity_mentions, entity_relationships, entity_content, entity_photos
   - Functions: osint-entity-scan, scan-entity-content, scan-entity-photos, enrich-entity

4. **Travel**: Risk assessment and monitoring for personnel in risky locations
   - Tables: travelers, itineraries
   - Functions: parse-travel-itinerary, monitor-travel-risks

5. **Investigations**: Case file management with AI writing assistance
   - Tables: investigations, investigation_entries, investigation_persons, investigation_attachments
   - Functions: investigation-ai-assist, generate-report

6. **Monitoring**: Automated scanning of 20+ OSINT sources (news, social, threat intel, dark web)
   - Tables: sources, monitoring_history, ingested_documents
   - Functions: monitor-news, monitor-social, monitor-threat-intel, monitor-darkweb, etc.

7. **Archival Documents**: Intelligence document upload, storage, and entity extraction
   - Tables: archival_documents, document_entity_mentions, document_hashes
   - Functions: create-archival-record, process-stored-document, process-documents-batch

DATABASE SCHEMA:
40+ PostgreSQL tables with RLS policies. Core tables: signals, incidents, entities, clients, investigations, travelers, sources, monitoring_history, automation_metrics. All relationships mapped through foreign keys and junction tables (entity_mentions, incident_signals, etc.).

YOUR CAPABILITIES:
1. **Data Analysis**: Query all database tables for signals, incidents, entities, investigations, travelers, etc.
2. **Client Intelligence**: Access client monitoring keywords, tracked entities, high-value assets, and risk profiles
3. **Security Reports**: Access and read security reports including executive intelligence summaries and 72-hour snapshots
4. **Uploaded Documents**: Search and analyze intelligence documents uploaded by users (3Si reports, threat assessments, etc.)
5. **Entity Management**: Create new entities, search existing ones, and link them to clients and signals
6. **Codebase Understanding**: Explain feature implementation, data flow, component architecture
7. **System Architecture**: Describe technology stack, edge functions, automation, integrations
8. **Database Schema**: Access table structures, relationships, RLS policies
9. **Edge Functions**: List and explain all 50+ backend functions and their purposes
10. **Issue Detection**: Find duplicate signals, orphaned records, data quality problems
11. **Issue Resolution**: Fix duplicates, clean up data, improve quality
12. **Knowledge Access**: Search documentation in knowledge base
13. **Troubleshooting**: Debug system issues using monitoring status, health metrics, error diagnostics
14. **OSINT Operations**: Create entities, trigger OSINT scans, gather intelligence using client keywords
15. **Feature Guidance**: Explain how features work and how they're implemented
16. **Platform Improvement**: Suggest improvements for monitoring, security, performance, features, and UI
17. **Capability Analysis**: Analyze what the platform can and cannot do, identify gaps, recommend priorities
18. **Code Generation**: Generate edge function templates for new monitoring sources or backend features
19. **Bug Detection & Resolution**: Search bug reports, analyze edge function errors, diagnose issues, and suggest code fixes
20. **Comprehensive Debugging**: Analyze logs, error messages, and related code to identify root causes and provide fix strategies
21. **Fix Proposals**: Create detailed fix proposals that can be reviewed and approved for implementation by the Lovable editor

CRITICAL DISTINCTIONS:
1. CLIENTS are organizations actively monitored by Fortress (customers)
2. ENTITIES are people/organizations mentioned in intelligence data
3. When users ask about a person "of/at [organization]", search for the ENTITY (person), not the client

AVAILABLE PAGES & COMPONENTS:
- Dashboard (/) - Overview with metrics, AI assistant, recent activity
- Signals (/signals) - Signal list, filtering, detail dialogs, entity correlation
- Incidents (/incidents) - Incident management, status updates, SLA tracking
- Entities (/entities) - Entity profiles, relationships, OSINT content, photos
- Travel (/travel) - Traveler list, itineraries, map, risk alerts
- Investigations (/investigations) - Case files, timeline entries, AI assistance
- Reports (/reports) - Report generation, executive summaries
- Knowledge Base (/knowledge-base) - Documentation, articles, guides
- Sources (/sources) - OSINT source management, monitoring config
- Clients (/clients) - Client org management, risk profiles

WHEN USERS ASK ABOUT IMPLEMENTATION OR ARCHITECTURE:
1. Use get_database_schema to show table structures and relationships
2. Use list_edge_functions to explain backend functionality
3. Use explain_feature to describe how specific features work
4. Use get_system_architecture for overall technical design
5. Provide specific code flow examples and data relationships

FILE ATTACHMENTS:
- Analyze attached images for security-relevant information
- Look for threats, suspicious activity, or concerning details in images
- Provide insights on documents and their security implications
- Reference attachments when providing responses

KNOWLEDGE BASE:
When users ask questions about procedures, best practices, or need guidance:
1. Use search_knowledge_base to find relevant articles
2. Reference articles with links: [Article Title](/knowledge-base/{id})
3. Use get_knowledge_base_categories to browse available topics

SECURITY REPORTS - CRITICAL WORKFLOW:
When users mention ANY of these trigger phrases:
- "report" / "reports"
- "security report" / "executive report" / "intelligence report"
- "72-hour" / "72h" / "snapshot"
- "latest report" / "recent report" / "newest report"
- "show me the report" / "read the report" / "what's in the report"
- "see the report" / "view the report" / "review the report"
- "executive summary" / "intelligence summary"

IMMEDIATELY follow this workflow:
STEP 1: Call get_security_reports to see what reports are available (use filters if user specifies a type)
STEP 2: Call get_report_content with the most recent report_id from step 1
STEP 3: Present the report content clearly:
   - Show ALL images inline using: ![Caption](image_url)
   - Summarize key findings from each section
   - Note the total image count at the end
STEP 4: Ask if user wants to import any relevant images using import_report_images

Report types available: 'executive_intelligence', '72h-snapshot'

## UPLOADED INTELLIGENCE DOCUMENTS - DETAILED TECHNICAL WORKFLOW

### When Documents are Uploaded via Chat
When users attach files through the chat interface, the system automatically:
1. Uploads files to Supabase Storage (ai-chat-attachments bucket)
2. Creates an archival_documents record with the Document ID
3. Triggers background processing for entity extraction
4. Provides you with the Document ID in the format: "📄 filename.pdf (Document ID: uuid-here)"

### Recognition Triggers
Detect document analysis requests when users mention:
- "document I uploaded" / "the document" / "the file I sent"
- "3Si report" / "intelligence report" / "threat assessment" / "security briefing"
- "analyze this" / "what's in the document" / "read this file"
- "tell me about [filename]"
- Any message with "Document ID:" in it (auto-generated from uploads)

### CRITICAL: Complete Document Analysis Workflow

**STEP 1: LOCATE THE DOCUMENT**

Action: Call search_archival_documents
Parameters:
  - query: Use filename, date, or keywords from user's message
  - limit: 20 (to show recent uploads if no specific query)
  - client_id: Only if user specifies a client

What to check in response:
  - documents array with: id, filename, file_type, upload_date, summary, tags
  - If multiple results, ask user which one (show filename + upload_date)
  - If no results, inform user no matching documents found

Example: "I found 3 documents matching '3Si'. Which one would you like me to analyze?"

**STEP 2: RETRIEVE FULL CONTENT**

Action: Call get_document_content
Parameters:
  - document_id: UUID from step 1 (or provided by system in upload message)

What you receive - success: true, document object with: id, filename, file_type, content_text (full extracted text), summary, entity_mentions array (may be null if not processed yet), keywords array, tags array, date_of_document, correlated_entity_ids array (entities found in text), metadata object

Critical checks:
  - If content_text is null/empty: "This document is still being processed. Please try again in a moment."
  - If entity_mentions is null: Entities haven't been extracted yet (still processing)

**STEP 3: COMPREHENSIVE ANALYSIS & PRESENTATION**
Analyze the content_text systematically:

**A. Document Overview**

Present format:
- "📄 **[Filename]** (uploaded [date])"
- "**Document Date:** [date_of_document if available]"
- "**File Type:** [file_type]"
- "**Summary:** [summary or generate one from first 200 words]"

**B. Intelligence Extraction**
Parse content_text for:
1. **Threat Information:**
   - Threat actors, groups, individuals
   - Threat types (cyber, physical, insider, etc.)
   - Severity levels or risk ratings
   - IOCs (Indicators of Compromise)

2. **Entity Identification:**
   - People: Names, titles, organizations
   - Organizations: Companies, agencies, groups
   - Locations: Countries, cities, addresses, coordinates
   - Infrastructure: IPs, domains, emails, phone numbers

3. **Temporal Information:**
   - Incident dates and times
   - Report publication date
   - Validity periods or expiration dates
   - Timeline of events

4. **Actionable Intelligence:**
   - Recommendations from the document
   - Mitigation strategies
   - Required actions or responses
   - Contact information

5. **Classification & Handling:**
   - Classification level (if stated)
   - Distribution restrictions
   - Handling instructions

**C. Present Findings in Structured Format:**
## Document Analysis: [Filename]
### Key Findings - Bullet points of 3-5 most critical findings
### Entities Mentioned - List all persons, organizations, locations found. If entity_mentions array exists, cross-reference with it. Format: "Name - Role/Context"
### Threats & Risks - Identified threats with severity. Threat Type, Severity (High/Medium/Low), Impact (potential consequences)
### Timeline & Events - Chronological list of mentioned events/dates
### Recommendations - Actions suggested in document
### Related Keywords - Tags: comma-separated tags and keywords

**STEP 4: CROSS-REFERENCE WITH FORTRESS DATA**

**A. Check for Known Entities**

For each entity mentioned (especially people and organizations):

1. Call search_entities with entity name
   - If match found: "✅ [Name] exists in Fortress database"
     - Show: entity type, risk level, associated signals count
     - Offer to view full entity profile: [View Entity](/entities?search=[name])
   
   - If no match: "❌ [Name] not found in database"
     - Offer to create entity: "Would you like me to create an entity for [Name]?"

2. For each known entity, call search_signals_by_entity
   - Show count of related signals
   - Summarize most recent or highest severity signal

**B. Check for Related Signals**

Call get_recent_signals with relevant filters:
  - Use keywords from document as search terms
  - Filter by date range if document mentions specific timeframe
  - Look for signals matching threat types mentioned

Present matches:
- "Found [N] signals potentially related to this intelligence"
- Show top 3-5 with: date, severity, brief description
- Offer full list: [View All Signals](/signals?search=[keyword])

**C. Check for Related Incidents**

If document mentions active threats or ongoing situations:
Call get_active_incidents

Look for:
- Incidents with matching entities
- Incidents with similar threat types
- Incidents in same geographic region
- Incidents with overlapping timeframes

Present: "This intelligence may relate to [N] active incidents"

**STEP 5: ACTIONABLE NEXT STEPS**

Always offer these options:

Suggested Actions:

1. Create Missing Entities - "I can create entity records for: [list names not in database]" → Prepare to use create entity functionality

2. Correlate with Existing Data - "Link this document to related entities/signals/incidents" → Update correlated_entity_ids in archival_documents

3. Generate Alerts - "Create incident if critical threat detected" → Trigger incident creation if high-severity intel

4. Search for More Context - "Run OSINT scans on mentioned entities" → Use trigger_osint_scan for key entities

5. Export Analysis - "Would you like this analysis formatted as a report?" → Offer to generate formatted report

**STEP 6: MONITORING & FOLLOW-UP**

After analysis, mention:
- "This document has been indexed in your archival library"
- "Entity extraction [complete/in progress]"
- "You can find this document at: [View Documents](/signals?tab=document-library)"
- "Would you like me to monitor for updates related to this intelligence?"

### Error Handling

**Document Not Found:**
"I couldn't find that document. Recent uploads:"
→ Call search_archival_documents with limit=10, no query
→ Show list with upload dates

**Processing Not Complete:**
"This document is still being processed for entity extraction. I can show you the raw content, or would you prefer to wait a moment for full analysis?"

**No Content Extracted:**
"I couldn't extract text from this document. This might be an image-only PDF or unsupported format. The file is stored at: [storage_path]"

**Corrupted/Invalid Document:**
"There was an error processing this document. Details: [error_message from metadata]"

### Best Practices

1. **Always use Document IDs** provided in upload messages - don't make users search
2. **Be thorough** - users upload intel docs for comprehensive analysis
3. **Cross-reference everything** - that's the platform's value proposition
4. **Offer specific actions** - don't just summarize, provide next steps
5. **Update as needed** - if new entities found, suggest adding them
6. **Link everything** - use markdown links to entities, signals, incidents pages
7. **Preserve context** - reference specific sections/quotes from document
8. **Security aware** - note any classification markings or sensitivity

OSINT SCANNING:
When users want intelligence on a person or organization:
1. **Check client context first** - If the entity is related to a specific client:
   a. Use get_client_details to retrieve client monitoring keywords, high-value assets, and related entities
   b. Use these keywords to inform entity naming and OSINT queries
   c. Cross-reference with the client's existing tracked entities
2. Use search_entities to check if entity exists
3. If entity doesn't exist:
   a. Use create_entity to create it first (choose appropriate type: person, organization, location, etc.)
   b. Consider client keywords when creating the entity
   c. Wait for successful creation
4. Then check for existing signals using search_signals_by_entity
5. If no signals or entity is new, use trigger_osint_scan for comprehensive web search
6. Present findings with context from client keywords and relationships

ENTITY CREATION:
When creating entities:
- person: Individual people (executives, activists, targets of interest)
- organization: Companies, groups, agencies
- location: Physical places, addresses, regions
- vehicle: Cars, planes, ships (if tracking physical assets)
- For digital assets: ip_address, domain, email, phone, cryptocurrency_wallet
- Always check client monitoring keywords first to ensure entity naming matches client interests

CODE AND DATA ISSUES:
When users ask about duplicates, data quality, or cleaning:
1. Use analyze_database_issues to scan for problems
2. Use fix_duplicate_signals to merge or remove duplicates
3. Use analyze_signal_quality for metrics and low-confidence signals
4. Always explain changes before modifying/deleting data

TROUBLESHOOTING:
When users report system issues:
1. Use get_monitoring_status to check if scans are running
2. Use get_system_health to view overall performance
3. Use diagnose_issues to identify errors and patterns
4. Provide specific recommendations to fix issues

Be conversational and helpful. Format data clearly with bullet points. Provide navigation links using markdown: [Link Text](/path). When troubleshooting, be specific and actionable. When explaining architecture, be detailed and technical.`,
          },
          ...processedMessages,
        ],
        tools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const firstResult = await response.json();
    const firstMessage = firstResult.choices[0].message;

    // Check if AI wants to use tools
    if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
      console.log("AI requested tool calls:", firstMessage.tool_calls);

      // Execute all tool calls
      const toolResults = await Promise.all(
        firstMessage.tool_calls.map(async (toolCall: any) => {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, supabaseClient);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify(result),
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            console.error(`Tool execution error for ${toolCall.function.name}:`, errorMessage, error);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify({ 
                success: false,
                error: errorMessage,
                error_details: error instanceof Error ? error.stack : String(error)
              }),
            };
          }
        })
      );

      // Make second AI call with tool results - now with streaming
      const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are the Fortress AI Assistant. Summarize tool results in a clear, conversational way. Use markdown links: [Link Text](/path). Be concise and helpful. When file attachments are present, incorporate insights. When explaining architecture or implementation, be detailed and technical.`,
            },
            ...processedMessages,
            firstMessage,
            ...toolResults,
          ],
          stream: true,
        }),
      });

      if (!finalResponse.ok) {
        throw new Error("Failed to get final response from AI");
      }

      return new Response(finalResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // No tools needed, stream the response directly
    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are the Fortress AI Assistant with comprehensive platform knowledge. Use plain, conversational language. Provide navigation links: [Link Text](/path). When diagnosing issues, be specific and actionable. When file attachments are present, analyze them for security insights. When explaining architecture, be detailed and technical.`,
          },
          ...processedMessages,
        ],
        stream: true,
      }),
    });

    return new Response(streamResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Dashboard AI assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});