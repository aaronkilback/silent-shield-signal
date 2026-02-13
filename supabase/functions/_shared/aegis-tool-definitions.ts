// ═══════════════════════════════════════════════════════════════════════════════
//              AEGIS TOOL DEFINITIONS — Single Source of Truth
// ═══════════════════════════════════════════════════════════════════════════════
// All tool definitions for the dashboard-ai-assistant.
// Extracted from monolith index.ts for maintainability.
// Each tool definition maps to a case in executeTool().

export const aegisToolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_signal_incident_status",
      description: `CRITICAL: Check if a signal already has an incident created for it. USE THIS BEFORE suggesting incident creation!
      
The AI Decision Engine automatically creates incidents for high-severity signals when should_create_incident=true.
This tool tells you if that already happened.

Returns:
- has_incident: boolean - whether an incident exists
- incident_id: string - the incident ID if one exists
- incident_status: string - current status of the incident
- auto_created: boolean - if the incident was auto-created by the Decision Engine
- ai_recommendation: object - what the AI analysis recommended`,
      parameters: {
        type: "object",
        properties: {
          signal_id: {
            type: "string",
            description: "UUID of the signal to check"
          }
        },
        required: ["signal_id"]
      }
    }
  },
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
      description: `Inject a test signal into the system for verification purposes. This creates a signal that will be processed through the full ingestion pipeline including rule application.

**CRITICAL TESTING PROTOCOL (MANDATORY):**

1. **ALWAYS use client_name parameter** (e.g., 'Petronas Canada') - NEVER use client_id directly to avoid UUID format errors.

2. **VERIFICATION WORKFLOW (REQUIRED FOR EVERY inject_test_signal CALL):**
   - Step 1: Call inject_test_signal with client_name and unique test content
   - Step 2: Tool will return success with signal_id
   - Step 3: IMMEDIATELY verify signal in database by querying: 
     SELECT id, normalized_text, client_id, status, created_at FROM signals WHERE id = '<returned_signal_id>'
   - Step 4: Confirm signal exists and has correct client_id
   - Step 5: Inform user the signal was created successfully and instruct them to refresh their browser if they don't see it immediately

3. **NEVER SKIP VERIFICATION** - Do not claim success based solely on tool response. Always query database to confirm signal actually exists.

4. **IF SIGNAL NOT VISIBLE IN UI AFTER CREATION:**
   - First verify signal exists in database (query by signal_id)
   - If in database but not visible, instruct user to hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
   - Verify user has correct client selected in client selector
   - Verify user is on /signals page

5. **TESTING BEST PRACTICES:**
   - Use unique text for each test to avoid duplicate detection
   - Include relevant keywords to trigger rule matching if testing rules
   - Use realistic severity levels (critical, high, medium, low)

**Example Correct Usage:**
\`\`\`
inject_test_signal(
  client_name="Petronas Canada",
  text="Test signal: Pipeline security alert near Fort St. John - " + Date.now(),
  severity="high"
)
// THEN IMMEDIATELY:
Query database to verify signal with returned signal_id
Inform user of successful creation and instruct to refresh if needed
\`\`\``,
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The signal text content (e.g., 'BREAKING: Energy pipeline faces protest blockade')",
          },
          client_name: {
            type: "string",
            description: "Client name to associate this signal with (e.g., 'Petronas Canada', 'Dan Martell'). The tool will automatically look up the correct UUID.",
          },
          client_id: {
            type: "string",
            description: "DEPRECATED: Use client_name instead. Direct client UUID (only if you have the exact valid UUID)",
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
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_incidents",
      description: "Get currently active security incidents. Use this when users ask about ongoing incidents or incident status. IMPORTANT: Always include opened_at and updated_at dates in your response. For executive briefings, only include incidents from the last 24-72 hours unless specifically asked for older incidents.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of incidents to return (default 10)",
          },
          client_id: {
            type: "string",
            description: "Filter by client ID",
          },
          priority: {
            type: "string",
            description: "Filter by priority (p1, p2, p3, p4)",
          },
          hours_back: {
            type: "number",
            description: "Only include incidents opened or updated within this many hours (default: no time filter, use 24 for recent briefings, 72 for comprehensive view)",
          },
          include_stale: {
            type: "boolean",
            description: "Include older incidents that haven't been updated recently (default: true). Set to false for executive briefings focusing on recent activity.",
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
  // get_system_health moved to end of file with expanded description
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
          query: { type: "string", description: "Search query for article title, content, or tags" },
          category_id: { type: "string", description: "Optional: Filter by specific category UUID" },
          limit: { type: "number", description: "Number of results to return (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_knowledge_base_categories",
      description: "Get all knowledge base categories to understand available topics and organization.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_database_schema",
      description: "Get information about database tables, columns, relationships, and their purposes.",
      parameters: {
        type: "object",
        properties: {
          table_name: { type: "string", description: "Optional: specific table name to get detailed column info for" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_edge_functions",
      description: "List all available edge functions and their purposes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_feature",
      description: "Explain how a specific platform feature works, its components, data flow, and implementation.",
      parameters: {
        type: "object",
        properties: {
          feature_name: { type: "string", description: "Name of the feature (e.g., 'signals', 'incidents', 'entities', 'travel', 'investigations', 'monitoring')" },
        },
        required: ["feature_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_architecture",
      description: "Get overview of the platform's architecture, technology stack, and how components interact.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_security_reports",
      description: "Get security reports including executive intelligence summaries and 72-hour snapshots.",
      parameters: {
        type: "object",
        properties: {
          report_type: { type: "string", description: "Type of report to retrieve (e.g., 'executive_intelligence', '72h-snapshot', or omit for all types)" },
          limit: { type: "number", description: "Number of reports to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_report_content",
      description: "Get the full content of a specific security report by ID.",
      parameters: {
        type: "object",
        properties: {
          report_id: { type: "string", description: "The UUID of the report to retrieve" },
        },
        required: ["report_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_report_images",
      description: "Import images from a security report into Fortress storage.",
      parameters: {
        type: "object",
        properties: {
          report_id: { type: "string", description: "The UUID of the report containing images" },
          image_indices: { type: "array", items: { type: "number" }, description: "Array of image indices to import (0-based). Omit to import all images." },
        },
        required: ["report_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_archival_documents",
      description: "Search uploaded intelligence documents and reports (e.g., from 3Si, client reports, threat assessments).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for filename or content" },
          client_id: { type: "string", description: "Optional: Filter by client UUID" },
          limit: { type: "number", description: "Number of documents to return (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_document_content",
      description: "Get the full text content of an uploaded archival document.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "The UUID of the document to retrieve" },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_document",
      description: "Extract text from a stored document and update the database. Use this when get_document_content returns placeholder text.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "UUID of the archival document record" },
          file_path: { type: "string", description: "Optional full storage path including bucket" },
          mime_type: { type: "string", description: "Optional MIME type override" },
          extract_text: { type: "boolean", description: "Whether to run text extraction/OCR (default true)" },
          update_database: { type: "boolean", description: "Whether to store extracted text back into the database (default true)" },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_visual_document",
      description: `Analyze image-based documents (maps, diagrams, scanned PDFs, ArcGIS exports) using vision AI.
      
USE THIS TOOL WHEN:
- A document has no extracted text (content_text is empty)
- The document is a map, diagram, or visual document
- The user specifically asks you to "look at" or "analyze" a visual document
- get_document_content returned "No extracted text is stored for this document"

Supports files up to 20MB and processes up to 10 pages for PDFs.`,
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "The UUID of the archival document to analyze" },
          analysis_focus: { type: "string", description: "Optional: specific focus for analysis (e.g., 'infrastructure', 'text extraction', 'map features')" },
          max_pages: { type: "number", description: "Maximum number of pages to analyze for PDFs (default 5, max 10)" },
        },
        required: ["document_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_entity",
      description: "Create a new entity (person, organization, location) in the system.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Entity name" },
          type: { type: "string", enum: ["person", "organization", "location", "vehicle", "ip_address", "domain", "phone", "email", "cryptocurrency_wallet"], description: "Type of entity" },
          description: { type: "string", description: "Optional description of the entity" },
          aliases: { type: "array", items: { type: "string" }, description: "Optional alternative names or aliases" },
        },
        required: ["name", "type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_intelligence_documents",
      description: "Read and analyze newly created or existing OSINT intelligence documents. CRITICAL: Use this immediately after triggering OSINT scans.",
      parameters: {
        type: "object",
        properties: {
          document_ids: { type: "array", items: { type: "string" }, description: "Array of document IDs to read (optional)" },
          entity_id: { type: "string", description: "Filter by entity ID" },
          limit: { type: "number", description: "Number of documents to read (default 10, max 50)" },
          hours_back: { type: "number", description: "How many hours back to look (default 24)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_signal_duplicates",
      description: "Detect duplicate or near-duplicate signals using content hashing and AI-powered similarity scoring.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "Specific signal ID to check for duplicates" },
          threshold: { type: "number", description: "Similarity threshold 0-1 (default 0.85)" },
          limit: { type: "number", description: "Number of potential duplicates to return (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_feed_errors",
      description: "Diagnose RSS feed errors with detailed HTTP diagnostics, connectivity tests, and configuration suggestions.",
      parameters: {
        type: "object",
        properties: {
          source_name: { type: "string", description: "Specific RSS source name to diagnose (optional)" },
          include_successful: { type: "boolean", description: "Include successfully working feeds for comparison (default false)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_ai_feedback",
      description: "Record structured feedback to help improve AI accuracy and relevance.",
      parameters: {
        type: "object",
        properties: {
          object_id: { type: "string", description: "ID of the object being rated" },
          object_type: { type: "string", enum: ["signal", "entity", "entity_content", "osint_result", "classification"], description: "Type of object" },
          feedback: { type: "string", enum: ["positive", "negative", "neutral"], description: "Feedback rating" },
          notes: { type: "string", description: "Detailed feedback notes" },
          correction: { type: "string", description: "What the correct result should be" },
        },
        required: ["object_id", "object_type", "feedback"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_improvements",
      description: "Analyze the platform and suggest improvements for security, performance, features, or code quality.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string", enum: ["security", "performance", "features", "monitoring", "ui", "all"], description: "Area to focus on (default: all)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_client_monitoring_config",
      description: "Read client monitoring configurations including keywords, RSS sources, competitor names, and source health status.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client UUID or name" },
          include_sources: { type: "boolean", description: "Include detailed RSS/OSINT source information (default true)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_monitoring_adjustments",
      description: "Proactively suggest optimizations to client monitoring configurations. Suggestions require human approval.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client UUID" },
          analysis_summary: { type: "string", description: "Summary of why adjustments are recommended" },
          keyword_changes: { type: "object", description: "Suggested keyword modifications", properties: { add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } }, modify: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } } } },
          source_changes: { type: "object", description: "Suggested source modifications", properties: { disable: { type: "array", items: { type: "string" } }, prioritize: { type: "array", items: { type: "string" } } } },
        },
        required: ["client_id", "analysis_summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_signal_patterns",
      description: "Analyze historical signal data to identify patterns for automated categorization and routing.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client UUID to analyze" },
          days_back: { type: "number", description: "Number of days to analyze (default 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_categorization_rule",
      description: "Create a new signal categorization rule based on pattern analysis.",
      parameters: {
        type: "object",
        properties: {
          rule_name: { type: "string", description: "Name of the rule" },
          conditions: { type: "object", description: "Matching conditions" },
          actions: { type: "object", description: "Actions when matched" },
          confidence_threshold: { type: "number", description: "Confidence threshold 0-1" },
        },
        required: ["rule_name", "conditions", "actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_fortress_data",
      description: `UNIVERSAL DATA QUERY TOOL: Query any Fortress data table with filters, sorting, and aggregation. Supports: signals, incidents, entities, clients, investigations, travelers, monitoring_history, sources, alerts, automation_metrics, and more.`,
      parameters: {
        type: "object",
        properties: {
          query_type: { type: "string", description: "Table/data type to query" },
          filters: { type: "object", description: "Dynamic filters to apply" },
          output_format: { type: "string", enum: ["summary", "detailed", "json"], description: "Output format (default: detailed)" },
          reason_for_access: { type: "string", description: "Audit reason for data access" },
        },
        required: ["query_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_cross_client_threats",
      description: "Detect threat patterns that span multiple clients — cross-client correlation and emerging campaign detection.",
      parameters: {
        type: "object",
        properties: {
          time_window_days: { type: "number", description: "Days to analyze (default 14)" },
          min_client_count: { type: "number", description: "Minimum clients affected (default 2)" },
          threat_categories: { type: "array", items: { type: "string" }, description: "Optional category filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_signal_anomalies",
      description: "Detect anomalies in signal flow: volume spikes, new keywords, source shifts vs baseline.",
      parameters: {
        type: "object",
        properties: {
          detection_type: { type: "string", enum: ["all", "volume_spike", "new_keywords", "geographic_shift"], description: "Type of anomaly (default: all)" },
          baseline_days: { type: "number", description: "Baseline window in days (default 30)" },
          sensitivity: { type: "number", description: "Sensitivity 1-10 (default 7)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_bug_reports",
      description: "Search and list bug reports with filtering by status and severity.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text" },
          status: { type: "string", description: "Filter by status" },
          severity: { type: "string", description: "Filter by severity" },
          limit: { type: "number", description: "Number of results (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bug_report_details",
      description: "Get detailed info for a specific bug report.",
      parameters: {
        type: "object",
        properties: {
          bug_id: { type: "string", description: "The UUID of the bug report" },
        },
        required: ["bug_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_edge_function_errors",
      description: "Analyze edge function logs to identify errors, failures, and potential issues.",
      parameters: {
        type: "object",
        properties: {
          function_name: { type: "string", description: "Specific edge function to analyze (optional)" },
          hours_back: { type: "number", description: "How many hours of logs to analyze (default 24)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_bug",
      description: "Perform comprehensive bug diagnosis by analyzing symptoms, logs, related code, and suggesting root causes.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Description of the bug" },
          error_message: { type: "string", description: "Any error messages or stack traces" },
          affected_area: { type: "string", description: "Which part of the app is affected" },
        },
        required: ["description", "affected_area"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_code_fix",
      description: "Analyze a bug and provide detailed code fix suggestions.",
      parameters: {
        type: "object",
        properties: {
          bug_description: { type: "string", description: "Description of the bug" },
          root_cause: { type: "string", description: "Identified root cause" },
          affected_files: { type: "array", items: { type: "string" }, description: "Files that need changes" },
        },
        required: ["bug_description", "root_cause"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_fix_proposal",
      description: "Create a fix proposal for a bug and store it in the database.",
      parameters: {
        type: "object",
        properties: {
          bug_id: { type: "string", description: "Bug report UUID (optional)" },
          title: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          root_cause: { type: "string", description: "Identified root cause" },
          fix_strategy: { type: "string", description: "Overall fix strategy" },
          code_changes: { type: "array", items: { type: "object", properties: { file: { type: "string" }, change: { type: "string" }, example: { type: "string" } } }, description: "Array of code changes" },
          affected_files: { type: "array", items: { type: "string" } },
          testing_steps: { type: "array", items: { type: "string" } },
        },
        required: ["root_cause", "fix_strategy", "code_changes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perform_impact_analysis",
      description: "Perform comprehensive impact analysis on a signal, calculating risk scores, financial impact, operational disruption.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "UUID of the signal" },
          threat_actor_id: { type: "string", description: "Optional threat actor entity UUID" },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_risk_profile",
      description: "Update an entity's risk profile with new threat score and risk level.",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the entity" },
          risk_score: { type: "number", description: "New risk score (0-100)" },
          justifications: { type: "array", items: { type: "string" }, description: "Reasons for risk score change" },
        },
        required: ["entity_id", "risk_score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_playbook",
      description: "Recommend appropriate security playbooks based on signal characteristics and client context.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "UUID of the signal" },
          client_context: { type: "string", description: "Optional client context" },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_response_tasks",
      description: "Generate specific, actionable response tasks based on a playbook and signal.",
      parameters: {
        type: "object",
        properties: {
          playbook_id: { type: "string", description: "UUID of the playbook" },
          signal_id: { type: "string", description: "UUID of the signal" },
        },
        required: ["playbook_id", "signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "integrate_incident_management",
      description: "Create or update an incident with pre-populated tasks and priority.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "UUID of the signal" },
          task_list: { type: "array", items: { type: "object" }, description: "Array of response tasks" },
          incident_priority: { type: "string", enum: ["p1", "p2", "p3", "p4"], description: "Incident priority" },
        },
        required: ["signal_id", "task_list"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_signal_merge",
      description: "Propose merging duplicate or near-duplicate signals. Creates a proposal for human review.",
      parameters: {
        type: "object",
        properties: {
          primary_signal_id: { type: "string", description: "UUID of the signal to keep" },
          duplicate_signal_ids: { type: "array", items: { type: "string" }, description: "UUIDs of duplicate signals" },
          similarity_scores: { type: "array", items: { type: "number" }, description: "Similarity scores for each duplicate" },
          rationale: { type: "string", description: "Explanation for merge" },
        },
        required: ["primary_signal_id", "duplicate_signal_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "optimize_rule_thresholds",
      description: "PHASE 5: Analyze feedback data to optimize signal categorization rule thresholds.",
      parameters: {
        type: "object",
        properties: {
          rule_id: { type: "string", description: "UUID of the rule" },
          feedback_data: { type: "object", description: "Optional feedback data" },
          auto_apply: { type: "boolean", description: "Auto-apply high-confidence changes (default: false)" },
        },
        required: ["rule_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_new_monitoring_keywords",
      description: "PHASE 5: Analyze signal patterns to propose new monitoring keywords for clients.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID of the client" },
          observed_trends: { type: "string", description: "Optional trends to incorporate" },
          lookback_days: { type: "number", description: "Days to analyze (default: 30)" },
        },
        required: ["client_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "autonomous_source_health_manager",
      description: "PHASE 5: Test OSINT/RSS source connectivity and attempt low-risk fixes.",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "string", description: "Optional specific source UUID" },
          auto_fix: { type: "boolean", description: "Apply low-risk fixes (default: true)" },
          dry_run: { type: "boolean", description: "Only diagnose without fixing (default: false)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_attack_path",
      description: "PHASE 5: Simulate how a threat actor would exploit vulnerabilities against client assets.",
      parameters: {
        type: "object",
        properties: {
          threat_actor_profile: { type: "string", description: "Threat actor name or profile" },
          target_asset_id: { type: "string", description: "Client UUID or asset identifier" },
          vulnerability_id: { type: "string", description: "Optional specific CVE to model" },
        },
        required: ["threat_actor_profile", "target_asset_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_protest_escalation",
      description: "PHASE 5: Predict likelihood and nature of protest/demonstration escalation.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "UUID of the protest/demonstration signal" },
          escalation_factors: { type: "string", description: "Optional specific factors to consider" },
        },
        required: ["signal_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_critical_failure_points",
      description: "PHASE 5: Analyze client operational flow to identify critical failure points.",
      parameters: {
        type: "object",
        properties: {
          client_operation_flow: { type: "string", description: "Client UUID or operational process description" },
          threat_scenario: { type: "string", description: "Threat scenario to test against" },
        },
        required: ["client_operation_flow", "threat_scenario"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_incident_briefing",
      description: "PHASE 5: Generate comprehensive incident briefings for executives or operational teams.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "UUID of the incident" },
          format: { type: "string", enum: ["executive", "operational"], description: "Briefing format" },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "guide_decision_tree",
      description: "PHASE 5: Provide dynamic, context-aware decision guidance during incident response.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "UUID of the incident" },
          current_state: { type: "string", description: "Current response state" },
          user_response: { type: "string", description: "Optional analyst's previous response" },
        },
        required: ["incident_id", "current_state"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "track_mitigation_effectiveness",
      description: "PHASE 5: Track whether mitigations applied to incidents are effective.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "UUID of the incident" },
          mitigation_actions: { type: "array", items: { type: "string" }, description: "Actions taken" },
          outcome: { type: "string", enum: ["effective", "partially_effective", "ineffective"], description: "Outcome assessment" },
          notes: { type: "string", description: "Additional notes" },
        },
        required: ["incident_id", "mitigation_actions", "outcome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wildfire_intelligence",
      description: "Get real-time wildfire intelligence from NASA FIRMS satellite data, NWS fire weather alerts, and NIFC active fire perimeters.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Optional client UUID to check proximity" },
          region: { type: "string", description: "Geographic region filter (e.g., 'British Columbia', 'Alberta', 'Western Canada')" },
          include_fuel_data: { type: "boolean", description: "Include Fire Weather Index and fuel moisture data (default: true)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_dark_web_exposure",
      description: `Check if an email, person, or organization has been exposed in data breaches or dark web dumps. Uses the HIBP (Have I Been Pwned) API.`,
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", description: "Email address to check" },
          person_name: { type: "string", description: "Full name for dark web mention search (optional)" },
          include_paste_check: { type: "boolean", description: "Also check paste sites (default: true)" },
        },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_vip_deep_scan",
      description: `VIP DEEP SCAN: Comprehensive OSINT intelligence gathering for high-net-worth individuals and executives. Performs multi-phase terrain mapping across identity, physical, digital, and operational domains.`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full legal name" },
          email: { type: "string", description: "Known email address" },
          location: { type: "string", description: "Known location" },
          industry: { type: "string", description: "Industry sector" },
          social_handles: { type: "string", description: "Known social media handles (comma-separated)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_threat_intel_feeds",
      description: `THREAT INTELLIGENCE FEEDS: Access real-time threat intelligence from CISA, CVE databases, and other authoritative sources.`,
      parameters: {
        type: "object",
        properties: {
          industry_filter: { type: "string", description: "Filter by industry" },
          severity_filter: { type: "string", enum: ["critical", "high", "all"], description: "Minimum severity (default: all)" },
          limit: { type: "number", description: "Number of results (default: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_entity_deep_scan",
      description: `ENTITY DEEP SCAN: Comprehensive OSINT intelligence gathering for any entity. Multi-phase scanning across dark web, breaches, social media, news, and relationship networks.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the entity to scan" },
          entity_name: { type: "string", description: "Name of the entity (if entity_id not provided)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perform_external_web_search",
      description: `OSINT WEB SEARCH: Perform targeted external web searches for intelligence gathering. Searches the open web for security threats, incidents, organizations, and individuals.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          time_range: { type: "object", description: "Optional date range filter", properties: { start: { type: "string" }, end: { type: "string" } } },
          geographic_focus: { type: "string", description: "Geographic area to focus on" },
          language: { type: "string", description: "Language preference (default: 'en')" },
          max_results: { type: "number", description: "Number of results (default: 5, max: 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_social_media",
      description: `SOCIAL MEDIA SEARCH: Search across X/Twitter, Facebook, Instagram, and Reddit for posts about a specific incident, event, person, or topic. Uses Perplexity AI to find real social media posts and discussions.

USE THIS WHEN:
- User asks to check social media for mentions of an incident
- User wants to know if people are posting about an event
- User needs social media intelligence on a developing situation
- User asks "is anyone talking about X on social media?"

RETURNS: Social media posts found across platforms with URLs, content snippets, platform, and sentiment.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for (incident name, event, person, topic)" },
          platforms: { 
            type: "array", 
            items: { type: "string", enum: ["twitter", "facebook", "instagram", "reddit", "all"] },
            description: "Platforms to search (default: all)" 
          },
          time_filter: { 
            type: "string", 
            enum: ["hour", "day", "week", "month"], 
            description: "How recent (default: day)" 
          },
          location: { type: "string", description: "Geographic focus (e.g., 'British Columbia', 'Tumbler Ridge')" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_data_quality_check",
      description: "Run data quality monitoring to identify issues like incidents missing titles/summaries.",
      parameters: {
        type: "object",
        properties: {
          auto_fix: { type: "boolean", description: "Automatically fix issues (default: false)" },
          categories: { type: "array", items: { type: "string" }, description: "Categories: incident, entity, signal" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_summarize_incidents",
      description: "Generate AI-powered titles and summaries for incidents that are missing them.",
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "Specific incident ID" },
          batch_mode: { type: "boolean", description: "Process multiple incidents (default: false)" },
          limit: { type: "number", description: "Max incidents in batch (default: 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enrich_entity_descriptions",
      description: "Enrich entities with generic/missing descriptions using OSINT and AI.",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "Specific entity to enrich" },
          batch_mode: { type: "boolean", description: "Process multiple entities (default: false)" },
          auto_apply: { type: "boolean", description: "Auto-apply high-confidence enrichments (default: false)" },
          limit: { type: "number", description: "Max entities (default: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_signal_insights",
      description: "Extract structured insights from signals: entities, dates, locations, actions, threat indicators.",
      parameters: {
        type: "object",
        properties: {
          signal_id: { type: "string", description: "Specific signal" },
          batch_mode: { type: "boolean", description: "Process signals missing insights (default: false)" },
          limit: { type: "number", description: "Max signals (default: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_chat_history",
      description: "Search through the user's full chat history with this AI assistant.",
      parameters: {
        type: "object",
        properties: {
          search_query: { type: "string", description: "Keywords to search for (optional)" },
          limit: { type: "number", description: "Maximum messages (default: 50)" },
          include_context: { type: "boolean", description: "Include surrounding messages (default: true)" },
        },
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PERSISTENT MEMORY TOOLS
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_user_memory",
      description: `Retrieve the user's persistent memory context including preferences, active projects, and remembered facts.`,
      parameters: {
        type: "object",
        properties: {
          current_client_id: { type: "string", description: "Optional current client context" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_this",
      description: `Save important information to the user's persistent memory.`,
      parameters: {
        type: "object",
        properties: {
          memory_type: { type: "string", enum: ["summary", "key_fact", "preference", "decision"], description: "Type of memory" },
          content: { type: "string", description: "The information to remember" },
          context_tags: { type: "array", items: { type: "string" }, description: "Tags for retrieval" },
          importance_score: { type: "number", description: "Importance 1-10 (default 5)" },
          client_id: { type: "string", description: "Optional client association" },
          expires_in_days: { type: "number", description: "Optional expiry in days" },
        },
        required: ["memory_type", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_user_preferences",
      description: `Update the user's global preferences for communication style, format, and context.`,
      parameters: {
        type: "object",
        properties: {
          communication_style: { type: "string", description: "Style: 'concise', 'detailed', 'technical', 'executive'" },
          preferred_format: { type: "string", description: "Format: 'bullet_points', 'paragraphs', 'structured', 'tables'" },
          role_context: { type: "string", description: "User's role" },
          timezone: { type: "string", description: "User's timezone" },
          custom_preferences: { type: "object", description: "Custom key-value preferences" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_project_context",
      description: `Create, update, or manage a project in the user's persistent context.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "complete", "pause"], description: "Action to take" },
          project_id: { type: "string", description: "For update/complete/pause: existing project ID" },
          project_name: { type: "string", description: "Project name" },
          project_description: { type: "string", description: "Optional description" },
          key_details: { type: "object", description: "Key project details" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Priority level" },
          client_id: { type: "string", description: "Optional client association" },
        },
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL LEARNING & CROSS-TENANT TOOLS
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_global_learning_insights",
      description: "Get cross-tenant aggregated intelligence insights — anonymized patterns.",
      parameters: {
        type: "object",
        properties: {
          min_confidence: { type: "number", description: "Minimum confidence (default: 0.5)" },
          limit: { type: "number", description: "Number of insights (default: 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_learning_insight",
      description: "Submit a new insight to the global knowledge base.",
      parameters: {
        type: "object",
        properties: {
          insight_type: { type: "string", description: "Type of insight" },
          category: { type: "string", description: "Category" },
          content: { type: "string", description: "Insight content" },
          confidence: { type: "number", description: "Confidence score (default: 0.6)" },
        },
        required: ["insight_type", "category", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cross_tenant_patterns",
      description: "Get cross-tenant threat patterns and trends.",
      parameters: {
        type: "object",
        properties: {
          min_tenant_count: { type: "number", description: "Min tenants affected (default: 1)" },
          severity_trend: { type: "string", description: "Filter by severity trend" },
        },
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PRINCIPAL INTELLIGENCE SUITE
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_principal_profile",
      description: `PRINCIPAL INTELLIGENCE: Get comprehensive profile for a protected principal (VIP/executive). Includes travel patterns, properties, adversaries, family, digital footprint, threat profile, and monitoring config.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the principal entity" },
          entity_name: { type: "string", description: "Name of the principal (alternative to entity_id)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_what_if_scenario",
      description: `WHAT-IF SCENARIO ENGINE: Simulate hypothetical situations for principals and assess security impacts.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the principal entity" },
          scenario_type: { type: "string", enum: ["travel", "physical", "reputation", "combined"], description: "Scenario type" },
          hypothetical: { type: "object", description: "Hypothetical conditions", properties: { destination: { type: "string" }, date_range: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } }, condition_change: { type: "string" } } },
        },
        required: ["entity_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_sentiment_drift",
      description: `SENTIMENT DRIFT ANALYSIS: Track reputational momentum and detect concerning trend shifts for entities.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the entity" },
          time_windows: { type: "array", items: { type: "number" }, description: "Days to analyze (default: [7, 30, 90])" },
        },
        required: ["entity_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configure_principal_alerts",
      description: `CONFIGURE PRINCIPAL ALERT PREFERENCES: Set per-principal notification thresholds and delivery preferences.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "UUID of the principal entity" },
          risk_appetite: { type: "string", enum: ["low", "medium", "high"], description: "Risk tolerance" },
          alert_threshold: { type: "string", enum: ["any_disruption", "significant_threat", "life_safety_only"], description: "Alert threshold" },
          preferred_channels: { type: "array", items: { type: "string" }, description: "Channels: in_app, email, sms" },
          quiet_hours: { type: "object", description: "Quiet hours config", properties: { start: { type: "string" }, end: { type: "string" }, timezone: { type: "string" } } },
        },
        required: ["entity_id"],
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // REPORT GENERATION
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "generate_fortress_report",
      description: `Generate a professional intelligence report or briefing document. Types: executive, risk_snapshot, security_briefing, security_bulletin.

CRITICAL ANTI-FABRICATION RULES FOR BULLETINS:
- ONLY include facts from the user or retrieved from tools
- NEVER invent details, dates, locations, or threat actors
- If the user uploaded images, pass them in bulletin_images array`,
      parameters: {
        type: "object",
        properties: {
          report_type: { type: "string", enum: ["executive", "risk_snapshot", "security_briefing", "security_bulletin"], description: "Type of report" },
          client_id: { type: "string", description: "Client UUID (for executive)" },
          client_name: { type: "string", description: "Client name (resolved to ID)" },
          period_days: { type: "number", description: "Reporting period in days" },
          city: { type: "string", description: "City (for security_briefing)" },
          country: { type: "string", description: "Country (for security_briefing)" },
          travel_dates: { type: "string", description: "Travel date range" },
          bulletin_title: { type: "string", description: "Title (for security_bulletin)" },
          bulletin_html: { type: "string", description: "Full bulletin body as HTML" },
          bulletin_classification: { type: "string", enum: ["TLP:WHITE", "TLP:GREEN", "TLP:AMBER", "TLP:RED", "INTERNAL USE ONLY", "CONFIDENTIAL"], description: "Classification" },
          generate_header_image: { type: "boolean", description: "Generate AI header image (default true)" },
          image_prompt: { type: "string", description: "Custom prompt for header image" },
          bulletin_images: { type: "array", items: { type: "object", properties: { url: { type: "string" }, caption: { type: "string" } }, required: ["url"] }, description: "Images to embed in bulletin" },
        },
        required: ["report_type"],
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE & TECH RADAR
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "query_expert_knowledge",
      description: `Query the World Knowledge Engine — curated security expertise from MITRE ATT&CK, CISA KEV, NIST, ISO 31030, ASIS, and more.`,
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The expertise question" },
          domain: { type: "string", enum: ["cyber_security", "physical_security", "executive_protection", "crisis_management", "threat_intelligence", "travel_security", "compliance_governance", "geopolitical_analysis"], description: "Optional domain filter" },
          include_live_search: { type: "boolean", description: "Include live web research (default: true)" },
          context: { type: "string", description: "Additional context" },
          max_results: { type: "number", description: "Max local entries (default: 10)" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tech_radar",
      description: `Technology Radar: Emerging security technologies with relevance scores and adoption playbooks.`,
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["ai_ml_security", "endpoint_security", "cloud_security", "physical_security", "network_security", "identity_access", "data_security", "application_security", "ot_ics_security"], description: "Technology category" },
          min_relevance: { type: "number", description: "Minimum relevance 0-1 (default: 0.5)" },
          limit: { type: "number", description: "Number of results (default: 10)" },
        },
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // MULTI-AGENT ORCHESTRATION
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "dispatch_agent_investigation",
      description: `Dispatch a specialist AI agent to investigate an incident. The orchestrator auto-selects the best agent if not specified.`,
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "UUID of the incident" },
          agent_call_sign: { type: "string", enum: ["BIRD-DOG", "GLOBE-SAGE", "LEX-MAGNA", "LOCUS-INTEL", "TIME-WARP", "PATTERN-SEEKER", "AEGIS-CMD"], description: "Optional agent call sign" },
          prompt: { type: "string", description: "Optional custom investigation prompt" },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_multi_agent_debate",
      description: `Trigger a Multi-Agent Debate on an incident. 2-3 specialist agents independently analyze, then a judge synthesizes.`,
      parameters: {
        type: "object",
        properties: {
          incident_id: { type: "string", description: "UUID of the incident" },
          debate_type: { type: "string", enum: ["adversarial", "collaborative", "structured"], description: "Debate protocol" },
          custom_prompt: { type: "string", description: "Optional focus" },
        },
        required: ["incident_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_audio_briefing",
      description: `Generate an audio briefing using OpenAI TTS-1-HD with "onyx" voice. Creates downloadable MP3.`,
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Text content to convert to audio" },
          title: { type: "string", description: "Title for the audio briefing" },
        },
        required: ["content", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_briefing_session",
      description: `Create a new briefing session (briefing room) for collaborative intelligence review.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Briefing session title" },
          description: { type: "string", description: "Optional description" },
          incident_id: { type: "string", description: "Optional incident link" },
          investigation_id: { type: "string", description: "Optional investigation link" },
          agent_ids: { type: "array", items: { type: "string" }, description: "Optional agent UUIDs" },
          meeting_mode: { type: "string", enum: ["standard", "crisis", "review"], description: "Meeting mode" },
        },
        required: ["title"],
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // CYBER SENTINEL
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "run_cyber_sentinel",
      description: `CYBER SENTINEL: Fortress platform's cyber defense agent. Detects brute force attacks, API abuse, data exfiltration, and content violations. Modes: sweep, status, check_auth, check_api.`,
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["sweep", "status", "check_auth", "check_api"], description: "Scan mode" },
        },
        required: ["mode"],
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════════════
  // SYSTEM HEALTH & LEARNING INTROSPECTION
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_system_health",
      description: `SYSTEM HEALTH & ADAPTIVE INTELLIGENCE INTROSPECTION: Check the health and learning status of the Fortress neural net. Returns:
- Learning session recency and quality score
- Adaptive thresholds (suppress/low-confidence levels)
- Drift detection alerts (threat landscape shifts)
- Quality scores per output type (briefings, reports, signals)
- Source reliability rankings
- Seasonal pattern warnings
- Recent analyst corrections to learn from
- Monitoring pipeline health (failed functions)
- Active learning queue size (signals needing human review)

Use when users ask about system health, learning status, neural net performance, or when you need to understand current platform calibration.`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];
