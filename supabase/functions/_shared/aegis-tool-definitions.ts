// ═══════════════════════════════════════════════════════════════════════════════
//              AEGIS TOOL DEFINITIONS — Single Source of Truth
// ═══════════════════════════════════════════════════════════════════════════════
// All tool definitions for the dashboard-ai-assistant.
// Extracted from monolith index.ts for maintainability.
// Each tool definition maps to a case in executeTool().

export const aegisToolDefinitions = [
  // ── Codebase audit tools ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_source_files",
      description: `List all source files in the codebase snapshot. Returns a manifest of Edge Functions, shared modules, config files, and docs WITHOUT their content.

Use this BEFORE making architectural or pipeline recommendations so you understand what is actually deployed. The manifest includes file_path, file_type, function_name, and byte_size.

file_type values: 'edge_function' | 'shared' | 'config' | 'doc'

After reviewing the manifest, use get_source_file to read specific files you need to inspect.`,
      parameters: {
        type: "object",
        properties: {
          file_type: {
            type: "string",
            description: "Filter by type: 'edge_function', 'shared', 'config', or 'doc'. Omit to get all.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_source_file",
      description: `Read the full source code of a specific file from the codebase snapshot.

Use list_source_files first to get the file_path, then call this to read the content. Returns the full TypeScript/SQL/Markdown source so you can audit the current implementation before making recommendations.`,
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The file_path as returned by list_source_files, e.g. 'supabase/functions/ingest-signal/index.ts'",
          },
        },
        required: ["file_path"],
      },
    },
  },
  // ── Signal / incident tools ───────────────────────────────────────────────
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
      name: "get_monitored_signals",
      description: `MONITORED QUEUE: Get signals that passed the relevance gate but scored below the incident creation threshold on the composite confidence score. These signals are being watched — they contain real intelligence but haven't yet reached the confidence level required to auto-create an incident.

Composite score formula: (ai_confidence × 0.50) + (relevance_score × 0.35) + (source_credibility × 0.15)
Threshold: signals with composite_confidence between 0.40 and 0.64 are in the monitored queue.

Use when:
- User asks "what signals are being watched" or "what's in the monitored queue"
- Operator wants to review weak signals before they age out
- Building situational awareness beyond just open incidents`,
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of signals to return (default 10)",
          },
          client_id: {
            type: "string",
            description: "Filter by client ID or name",
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
  // trigger_osint_scan — REMOVED: calls OSINT API that is unavailable; had fake success fallback
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
      description: "Record structured feedback on signals, entities, or other objects. For signals: use 'relevant' to confirm or 'irrelevant' to mark as false positive (this updates status and triggers learning). CRITICAL: Only call this tool when explicitly asked by the user to provide feedback. Report the ACTUAL tool result — never claim feedback was submitted without calling this tool first.",
      parameters: {
        type: "object",
        properties: {
          object_id: { type: "string", description: "UUID of the object being rated" },
          object_type: { type: "string", enum: ["signal", "incident", "entity", "entity_content", "entity_suggestion", "daily_briefing", "report", "travel_alert", "audio_briefing", "entity_photo", "osint_result", "classification"], description: "Type of object" },
          feedback: { type: "string", enum: ["relevant", "irrelevant", "too_minor", "confirmed", "rejected", "positive", "negative", "neutral"], description: "Feedback type. For signals: relevant/irrelevant/too_minor. For entities: confirmed/rejected. For briefings/reports: positive/negative." },
          notes: { type: "string", description: "Detailed feedback notes explaining why" },
          correction: { type: "string", description: "What the correct result should be (for negative/irrelevant feedback)" },
          reason: { type: "string", description: "Structured reason for rejection: duplicate, out_of_scope, stale, low_quality, wrong_location, not_actionable" },
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
  // perform_impact_analysis — REMOVED: calls intelligence-engine edge function unavailable; had fake signal fallback
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
  // draft_response_tasks — REMOVED: calls ai-tools-query edge function unavailable; had fake incident fallback
  // integrate_incident_management — REMOVED: calls ai-tools-query edge function unavailable; had fake incident fallback
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
  // optimize_rule_thresholds — REMOVED: calls optimize-rule-thresholds edge function unavailable; had fake category-distribution fallback
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
  // simulate_attack_path — REMOVED: calls simulate-attack-path edge function unavailable; had fake signal fallback
  // simulate_protest_escalation — REMOVED: calls simulate-protest-escalation edge function unavailable; had fake signal fallback
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
  // ═══ WILDFIRE TOOL — ENABLED (BC OpenMaps WFS live data, April 8 2026) ═══
  {
    type: "function",
    function: {
      name: "get_wildfire_intelligence",
      description: `Get live BC wildfire intelligence from BC Wildfire Service via BC OpenMaps WFS — real government data, no API key required. Returns active fire count, out-of-control fires, fires by fire centre, largest active fires, cause breakdown (human vs lightning), and a risk assessment score.

Use when:
- User asks about wildfire risk, fire season, active fires in BC
- Assessing risk to client operations in BC Interior, Northern BC, or areas with forest operations
- Generating an executive report that should include current wildfire conditions
- User asks "are there any fires near [location]"

Data is live from https://openmaps.gov.bc.ca — provides current BC fire polygon database.
Provide client_id for operational proximity context against client locations.`,
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Client UUID — if provided, client operational areas are included in the response for proximity cross-reference",
          },
        },
        required: [],
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
      description: `VIP DEEP SCAN: This capability is handled by the dedicated VIP Deep Scan wizard at /vip-deep-scan. When a user asks to run a VIP deep scan, deep dive, or SRA on a person, do NOT attempt to run it here. Instead, tell them: "VIP deep scans are handled by the dedicated wizard — navigate to VIP Deep Scan in the sidebar, or I can take you there now." Do not call this tool directly.`,
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
  // run_what_if_scenario — REMOVED: calls run-what-if-scenario edge function unavailable; had fake signal fallback
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
  // AI REPORT VISUALS
  // ══════════════════════════════════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "generate_report_visual",
      description: "Generate AI-powered visuals for intelligence reports. Creates cinematic header images, threat landscape visualizations, situational maps, risk heatmaps, event timelines, and incident scene imagery. Use when generating reports or when the user requests visual intelligence products.",
      parameters: {
        type: "object",
        properties: {
          types: { 
            type: "array", 
            items: { type: "string", enum: ["header", "threat_landscape", "situational_map", "risk_heatmap", "timeline", "incident_scene"] },
            description: "Visual types to generate (can request multiple)" 
          },
          client_name: { type: "string", description: "Client name for context" },
          report_title: { type: "string", description: "Report title for context" },
          threat_categories: { type: "array", items: { type: "string" }, description: "Threat categories (e.g., cyber, physical, fraud)" },
          locations: { type: "array", items: { type: "string" }, description: "Geographic locations relevant to the visual" },
          risk_level: { type: "string", enum: ["low", "moderate", "elevated", "high", "critical"], description: "Overall risk level" },
          incident_types: { type: "array", items: { type: "string" }, description: "Types of incidents for scene generation" },
          period: { type: "string", description: "Time period (e.g., 'past 7 days')" },
          custom_prompt: { type: "string", description: "Custom image generation prompt (overrides template)" },
          high_quality: { type: "boolean", description: "Use higher quality model (slower)" },
        },
        required: ["types"],
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
  {
    type: "function",
    function: {
      name: "get_signal_contradictions",
      description: `Find unresolved contradictions between signals about the same entity. Use when:
- User asks about conflicting intelligence or contradictory reports
- Analyzing an entity with multiple signals that may disagree
- Assessing confidence on a topic where conflicting information exists
Returns contradiction details, severity, and AI analysis of the conflict.`,
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Filter contradictions by entity name (partial match supported)",
          },
          status: {
            type: "string",
            enum: ["unresolved", "resolved", "all"],
            description: "Filter by resolution status (default: unresolved)",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_analyst_accuracy",
      description: `Get analyst accuracy calibration metrics. Shows how accurate each analyst's feedback has been when compared to actual incident outcomes. Analysts with higher accuracy get more weight in signal scoring. Use when users ask about team performance, feedback quality, or analyst reliability.`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_knowledge_freshness",
      description: `Check the freshness of the expert knowledge base. Shows entries with decayed confidence scores and the last freshness audit results. Use when users ask about knowledge currency, stale intelligence, or knowledge base health.`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_self_assessment",
      description: `Run a deep structured self-assessment across ALL active agents. Each agent receives real system context (signal counts, incident counts, available tools) and is asked to honestly report:
- Their WORRIES (specific concerns about their operational capacity, blind spots, data gaps)
- Their GOALS (what they want to achieve, with priority and current blockers)
- Their IMPROVEMENTS (specific changes that would make them more effective)

Use this when the user wants to know what agents actually need, worry about, or want to improve — especially when a previous broadcast gave generic answers. Results are persisted to the database for historical tracking.`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_agent_knowledge_hunt",
      description: `Trigger an aggressive internet-wide knowledge hunt for all agents or a specific agent. Each agent searches for the best books, podcasts, expert practitioners, frameworks, case studies, research papers, and tools in their specialty. Results are stored in the shared knowledge base. Use this to kick off learning for the whole team or a targeted agent.`,
      parameters: {
        type: "object",
        properties: {
          agent_call_sign: { type: "string", description: "Specific agent to run the hunt for. Leave empty to run for all agents." },
          max_agents: { type: "number", description: "Max agents to process per invocation (default 5, max 36)" },
          force: { type: "boolean", description: "Re-hunt even if recently done" },
          angles: {
            type: "array",
            items: { type: "string", enum: ["books", "podcasts", "practitioners", "frameworks", "case_studies", "research", "emerging", "tools"] },
            description: "Specific knowledge angles to search. Leave empty for all.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_expert_topics",
      description: `Run the topic-sweep ingestion for an expert — queries Perplexity for each of their registered topic areas (books, frameworks, methodologies) and stores the results as structured knowledge entries. This runs separately from media ingestion to avoid timeouts. Use this after ingest_expert_content, or any time you want to deepen an expert's knowledge base with their specific subject matter expertise. Pass expert_name or expert_profile_id.`,
      parameters: {
        type: "object",
        properties: {
          expert_name: { type: "string", description: "Expert's name (e.g. 'Clint Emerson')" },
          expert_profile_id: { type: "string", description: "UUID of the expert profile" },
          force: { type: "boolean", description: "Re-ingest topics already processed" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_expert_profiles",
      description: `List all registered expert profiles in the system — human experts (retired SEALs, CIA analysts, security researchers, etc.) whose content agents learn from. Returns each expert's ID, name, title, domains, assigned agents, content sources, and ingestion status. Use this before calling ingest_expert_content so you have the correct expert_profile_id or name.`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_expert_source",
      description: `Add a human expert (retired Navy SEAL, CIA analyst, security researcher, ethical hacker, etc.) to the platform so agents can learn from their content. Provide their name, title, and any available content URLs (YouTube channel, podcast RSS, LinkedIn, website). The expert's knowledge will be ingested into the agent knowledge base and tagged to the most relevant agents.`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Expert's full name" },
          title: { type: "string", description: "Their background/title (e.g. 'Retired Navy SEAL', 'Former CIA Operations Officer')" },
          expertise_domains: {
            type: "array",
            items: { type: "string" },
            description: "Domains they cover: cyber, physical_security, executive_protection, crisis_management, threat_intelligence, travel_security, counter_terrorism, fraud_social_engineering, leadership, etc."
          },
          youtube_channel_url: { type: "string", description: "YouTube channel URL" },
          podcast_rss_url: { type: "string", description: "Podcast RSS feed URL" },
          linkedin_url: { type: "string", description: "LinkedIn profile URL" },
          website_url: { type: "string", description: "Personal website or blog URL" },
          relevant_agent_call_signs: {
            type: "array",
            items: { type: "string" },
            description: "Call signs of agents who should learn from this expert (e.g. ['0DAY', 'AEGIS-CMD'])"
          },
          notes: { type: "string", description: "Brief note on why this expert is valuable" },
          ingest_immediately: { type: "boolean", description: "Start ingesting their content right now (default: true)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_expert_content",
      description: `Ingest content from a specific URL (YouTube video, podcast episode, article, LinkedIn post) or sweep all sources for a known expert profile. Extracts structured knowledge entries and stores them in the agent knowledge base with full attribution.

You can identify the expert by:
- expert_name: "Clint Emerson" — looks up by name automatically (PREFERRED when you don't have the ID)
- expert_profile_id: UUID from list_expert_profiles
- url: a direct content URL (YouTube video, article, etc.)

To ingest ALL sources for a named expert, pass just expert_name. To ingest a specific piece of content, pass url.`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of specific content to ingest (YouTube video, podcast RSS, article, LinkedIn post)" },
          expert_profile_id: { type: "string", description: "UUID of an existing expert profile — sweeps ALL their sources" },
          expert_name: { type: "string", description: "Expert's name — system will look up their profile and ingest all their sources. Use this when you know the name but not the ID." },
          domain: { type: "string", description: "Override domain classification if needed" },
          force: { type: "boolean", description: "Re-ingest even if already processed" },
          topics_only: { type: "boolean", description: "Run only the topic sweep (Perplexity queries), skip YouTube/podcast/LinkedIn media fetch" },
          media_only: { type: "boolean", description: "Run only media sources (YouTube/podcast/website), skip topic sweep" },
          youtube_limit: { type: "number", description: "Max YouTube videos to process per channel (default 10, max 50)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_agent_responses",
      description: `Ask all active agents a question and get their live responses immediately. Use this when you want to poll the agent team for their thoughts, status, needs, concerns, or any question. Returns live answers from every agent.`,
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The question or message to send to all agents",
          },
          priority: {
            type: "string",
            enum: ["normal", "urgent"],
            description: "Message priority (default: normal)",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "broadcast_to_agents",
      description: `Send a message or question to ALL active agents and receive their LIVE responses immediately.

This tool now invokes every agent in real-time and returns their answers directly to you.
Use this when:
- The user asks you to poll, ask, or check with all agents ("ask all agents if...", "check with the team")
- The user wants to know what agents think, need, want, or are concerned about
- You need to gather input or status from the full agent network
- Sharing intelligence, directives, or operational updates with all agents

IMPORTANT: After calling this tool, READ the agent_responses returned and present each agent's
answer clearly to the user. The responses are LIVE and IMMEDIATE — do not say agents will
respond later or that you need another tool to retrieve responses. The responses are in the
tool result under "agent_responses" and "formatted_responses". Present them directly.`,
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to broadcast to all agents (e.g., 'Great work today, team. Your vigilance keeps Fortress strong.')",
          },
          priority: {
            type: "string",
            enum: ["normal", "urgent"],
            description: "Message priority (default: normal)",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perform_web_fetch",
      description: `Fetch and read the content of any URL — web pages, news articles, social media posts, PDFs, and documents.

CRITICAL USE CASES:
- X/Twitter posts: When given an x.com or twitter.com URL, fetch its full text content
- News articles: Retrieve full article text from any news URL
- Research documents: Read online reports, PDFs, or intelligence documents
- Any URL a user pastes into the conversation

For X/Twitter URLs (x.com or twitter.com): automatically uses a rendering proxy to bypass JavaScript restrictions.
Always use this tool when a user shares a URL and wants you to read its contents.
Returns the full text content of the page.`,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL to fetch (e.g., 'https://x.com/user/status/123', 'https://news.example.com/article')",
          },
          context: {
            type: "string",
            description: "Optional: what the user wants to do with this content (e.g., 'analyze for threat indicators', 'summarize', 'share with agents')",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_message_to_agent",
      description: `Send a direct message or tasking instruction to a specific agent by their call sign.

Use this tool when the user wants to:
- Contact a specific agent directly (e.g., "tell BIRD-DOG to...", "message GLOBE-SAGE about...")
- Assign a specific task to one agent
- Send targeted intelligence to a single agent
- Get a specific agent's attention on a particular matter

IMPORTANT: Use agent's exact call sign (e.g., "BIRD-DOG", "GLOBE-SAGE"). 
The message will appear in that agent's next conversation as a pending directive from command.
Use broadcast_to_agents instead if you want to reach ALL agents simultaneously.`,
      parameters: {
        type: "object",
        properties: {
          agent_call_sign: {
            type: "string",
            description: "The exact call sign of the target agent (e.g., 'BIRD-DOG', 'GLOBE-SAGE', 'CIPHER-9')",
          },
          message: {
            type: "string",
            description: "The message or task instruction to send to the agent",
          },
          priority: {
            type: "string",
            enum: ["normal", "urgent"],
            description: "Message priority (default: normal)",
          },
        },
        required: ["agent_call_sign", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_entity_to_watchlist",
      description: `Add a person of interest, threat actor, or organization to the persistent entity watch list.

When a watched entity is detected in future signals, the signal's severity score is automatically boosted and an immediate alert is triggered. Watch list entries persist across sessions and monitor cycles.

Watch levels and severity boosts:
- monitor: passive tracking (+10 severity boost) — for entities worth keeping an eye on
- alert: active concern (+20 severity boost) — for entities showing threatening behavior
- critical: imminent threat (+35 severity boost) — for entities posing direct, immediate threat

Use this when:
- An entity repeatedly appears in threat-related signals
- Intelligence indicates a person/group is planning or escalating hostile activity
- An analyst flags a person of interest for ongoing tracking
- A new threat actor is identified in the area of operations`,
      parameters: {
        type: "object",
        properties: {
          entity_name: {
            type: "string",
            description: "Full name or alias of the entity to watch (e.g., 'John Smith', 'Gidimt\\'en Checkpoint')",
          },
          watch_level: {
            type: "string",
            enum: ["monitor", "alert", "critical"],
            description: "Surveillance urgency level — determines severity boost applied to future signals",
          },
          reason: {
            type: "string",
            description: "Why this entity is being added to the watch list (will be visible to analysts)",
          },
          client_id: {
            type: "string",
            description: "UUID of the client to scope this watch to. Omit to monitor across all clients.",
          },
          expiry_days: {
            type: "integer",
            description: "How many days until this watch entry expires. Omit for no expiry.",
            minimum: 1,
            maximum: 365,
          },
          entity_id: {
            type: "string",
            description: "UUID of an existing entity record in the database, if known.",
          },
        },
        required: ["entity_name", "watch_level", "reason"],
      },
    },
  },
  // investigate_poi — REMOVED: calls investigate-poi edge function unavailable; had fake DB fallback
  {
    type: "function",
    function: {
      name: "generate_poi_report",
      description: `Generate (or regenerate) an AI-written intelligence report for a Person of Interest.

Synthesizes all available evidence into a structured analyst report with sections:
- Subject Profile, Executive Summary, Positive/Negative Findings
- Social Media Footprint, Breach Data, Signal History
- Confidence Assessment, Recommended Next Steps

Use this when:
- New intelligence has been collected and the report needs to be refreshed
- An analyst asks to see or generate a POI intelligence report
- After an investigation has run and you want to produce the formal report`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "UUID of the entity to generate a report for.",
          },
          investigation_id: {
            type: "string",
            description: "Optional UUID of a specific investigation to base the report on.",
          },
        },
        required: ["entity_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "synthesize_knowledge",
      description: `Run the knowledge synthesizer — transforms accumulated knowledge into intelligence.

Does three things:
1. BELIEF FORMATION: Reads each agent's knowledge entries and extracts analytical conclusions — what the agent now believes about how threats work, who key actors are, what patterns repeat. Tracks confidence over time.
2. CROSS-DOMAIN CONNECTIONS: Finds non-obvious links between different agents' knowledge — where one specialist's finding changes the meaning of another's. Writes synthesis notes capturing what neither domain saw alone.
3. BELIEF EVOLUTION: Updates confidence in existing beliefs when new evidence strengthens or contradicts them. Logs the reasoning.

Use this:
- After a knowledge hunt to convert raw knowledge into beliefs and connections
- When you want to see how agent thinking has evolved
- To surface cross-domain intelligence between specialists
- On-demand after major knowledge ingestion`,
      parameters: {
        type: "object",
        properties: {
          agent_call_sign: {
            type: "string",
            description: "Target a specific agent (optional — default processes all agents)",
          },
          since_days: {
            type: "number",
            description: "How far back to look for knowledge entries (default 7)",
          },
          force: {
            type: "boolean",
            description: "Re-process even if recently synthesized",
          },
        },
      },
    },
  },
  // ── Threat intelligence IOC lookup ────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "lookup_ioc_indicator",
      description: `Check whether a specific domain, IP address, URL, or file hash is known malicious in Fortress.

Searches all ingested threat intelligence signals (including Microsoft Defender TI exports and other IOC sources) for prior sightings of the indicator. Returns a verdict of 'known_malicious' or 'unknown' with full source context.

Use this:
- When a new signal mentions a domain, IP, or hash and you want to know if Fortress has seen it before
- To close the belief loop: if an indicator is known-bad, elevate the signal severity automatically rather than treating it as unknown
- Before recommending containment — confirm the indicator has a sourced, traceable record in Fortress
- To surface the original threat intelligence article that documented the indicator

ALWAYS call this before concluding an IOC is novel. Prior ingestion from Defender TI or other feeds means the threat is already tracked.`,
      parameters: {
        type: "object",
        properties: {
          indicator: {
            type: "string",
            description: "The IOC value to look up — domain, IP address, URL, or file hash",
          },
          indicator_type: {
            type: "string",
            enum: ["domain", "ip", "url", "hash", "unknown"],
            description: "Type hint for the indicator. Use 'unknown' if unsure.",
          },
          client_id: {
            type: "string",
            description: "Optional — scope the lookup to a specific client's signals",
          },
        },
        required: ["indicator"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_agent_mission",
      description: `Assign an explicit mission to a specific agent — a short-term objective with a deadline and reporting cadence.

Use this when:
- A user wants an agent to actively monitor something ("have FININT watch these entities for 30 days")
- A client situation requires dedicated agent focus ("task VERIDIAN-TANGO to assess Coastal GasLink risk through Q2")
- You want an agent to proactively surface findings rather than waiting to be asked

The agent will see this mission at the start of every conversation and treat it as an active directive. They will log findings as they occur.

Examples:
- assign_agent_mission(agent="FININT", title="Monitor Petronas transaction patterns", objective="Track all financial signals related to PECL and LNG Canada for suspicious transaction patterns or sanctions exposure. Report any findings immediately.", deadline="2026-07-01", reporting_cadence="on_finding")
- assign_agent_mission(agent="ECHO-ALPHA", title="Assess Q2 hemispheric risk", objective="Monitor US-Canada defense posture changes and assess implications for Petronas operational security in NE BC.", deadline="2026-06-30", reporting_cadence="weekly")`,
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Agent call sign (e.g. 'FININT', 'VERIDIAN-TANGO', 'ECHO-ALPHA')",
          },
          title: {
            type: "string",
            description: "Short mission title (max 80 chars)",
          },
          objective: {
            type: "string",
            description: "Full description of what the agent should find, monitor, or assess",
          },
          deadline: {
            type: "string",
            description: "ISO date string for mission deadline (e.g. '2026-06-30'). Optional.",
          },
          reporting_cadence: {
            type: "string",
            enum: ["on_finding", "daily", "weekly"],
            description: "How often the agent should report. 'on_finding' means immediately when something relevant is discovered.",
          },
          client_name: {
            type: "string",
            description: "Client name to associate this mission with (optional). Resolved to client_id automatically.",
          },
        },
        required: ["agent", "title", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_agent_missions",
      description: `List active or recent missions assigned to agents.

Use to answer questions like:
- "What is FININT currently tasked with?"
- "Show me all active agent missions"
- "What missions are assigned for Petronas?"`,
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Filter by agent call sign. Omit for all agents.",
          },
          status: {
            type: "string",
            enum: ["active", "completed", "paused", "abandoned", "all"],
            description: "Filter by mission status. Default: 'active'.",
          },
          client_name: {
            type: "string",
            description: "Filter by client name.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_mission_progress",
      description: `Log a finding or progress update to an active mission.

Use this when an agent surfaces intelligence that is relevant to one of their active missions. This keeps a traceable record of what was found and when.

Call this proactively when you recognize that new information satisfies or advances a mission objective.`,
      parameters: {
        type: "object",
        properties: {
          mission_id: {
            type: "string",
            description: "Mission UUID. Use list_agent_missions to find it if unknown.",
          },
          update: {
            type: "string",
            description: "The finding or progress note to log",
          },
          finding_type: {
            type: "string",
            enum: ["finding", "escalation", "no_change", "completed"],
            description: "'finding' = relevant intelligence found. 'escalation' = urgent finding. 'no_change' = checked, nothing new. 'completed' = mission objective achieved.",
          },
          mark_completed: {
            type: "boolean",
            description: "Set true if this finding completes the mission objective.",
          },
        },
        required: ["mission_id", "update", "finding_type"],
      },
    },
  },
];