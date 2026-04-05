import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway, callAiGatewayStream } from "../_shared/ai-gateway.ts";
import { validateMessages } from "../_shared/input-validation.ts";
import { fetchUserMemory, formatMemoryForPrompt, saveMemory, upsertPreferences, upsertProject, touchProject } from "../_shared/user-memory.ts";
import { logError } from "../_shared/error-logger.ts";
// fortress-infrastructure.ts removed from system prompt to reduce token count (~5000 tokens saved)
import { AEGIS_CORE_IDENTITY, AEGIS_CHAT_MODIFIERS, ANTI_FABRICATION_RULES, TOOL_USAGE_GUIDANCE, AEGIS_CAPABILITY_MANIFEST, getTimeContext } from "../_shared/aegis-persona.ts";
import { buildCOP, formatCOPForPrompt } from "../_shared/common-operating-picture.ts";
import { getLearningPromptBlock, getSystemHealthMetrics } from "../_shared/learning-context-builder.ts";
import { FORTRESS_PLATFORM_OVERVIEW, FORTRESS_AEGIS_CAPABILITIES, FORTRESS_WORKFLOW_INSTRUCTIONS, AEGIS_TOOL_SUMMARIZER_PROMPT, AEGIS_REPORT_PRESENTER_PROMPT, AEGIS_AGENT_CREATION_PROMPT, AEGIS_DATA_PRESENTER_PROMPT } from "../_shared/fortress-operational-prompt.ts";
import { FORTRESS_CORE_DIRECTIVE } from "../_shared/fortress-core-directive.ts";
import { aegisToolDefinitions } from "../_shared/aegis-tool-definitions.ts";
import { extractPlannedTestSignalFromText, extractPlannedFortressQueryFromText, extractPlannedAgentFromText } from "../_shared/aegis-forced-execution.ts";
import { signalsAndIncidentsHandlers } from "../_shared/handlers-signals-incidents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Timeout for AI API calls (45 seconds - well under edge function limits)
const AI_TIMEOUT_MS = 45000;

// Helper to fetch with timeout — delegates to AI provider wrappers for resilience
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  // If this is a direct AI provider call, use the resilient wrapper
  if (url.includes('generativelanguage.googleapis.com') || url.includes('api.perplexity.ai') || url.includes('api.openai.com/v1/chat')) {
    const bodyObj = JSON.parse(options.body as string);
    const isStreaming = bodyObj.stream === true;
    
    const extraBody = (() => {
      const { model: _m, messages: _msgs, stream: _s, ...rest } = bodyObj;
      return Object.keys(rest).length > 0 ? rest : undefined;
    })();
    
    if (isStreaming) {
      // Streaming call — return SSE stream
      const result = await callAiGatewayStream({
        model: bodyObj.model || 'gpt-4o-mini',
        messages: bodyObj.messages || [],
        functionName: 'dashboard-ai-assistant',
        timeoutMs,
        extraBody,
      });

      if (result.error || !result.stream) {
        throw new Error(result.error || 'AI Gateway stream failed');
      }

      return new Response(result.stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    } else {
      // Non-streaming call — return JSON response (for tool-use decisions)
      const result = await callAiGateway({
        model: bodyObj.model || 'gpt-4o-mini',
        messages: bodyObj.messages || [],
        functionName: 'dashboard-ai-assistant',
        retries: 2,
        extraBody,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      return new Response(JSON.stringify(result.raw), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Non-AI-gateway URLs: standard fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Request timed out after ${timeoutMs / 1000} seconds. Please try again with a simpler request.`,
      );
    }
    throw error;
  }
}

function base64FromBytes(bytes: Uint8Array): string {
  // Avoid remote std imports to keep edge bundling stable.
  // Convert bytes → binary string in chunks, then btoa().
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Escape HTML special characters for safe template insertion
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Filter out meta-conversation (about report generation, tool errors, platform issues)
// so that only actual intelligence content is extracted for reports
const META_CONVERSATION_PATTERNS = [
  /\b(generate|create|make|build|produce|regenerate|redo|try again)\b.*\b(report|bulletin|briefing|document)\b/i,
  /\b(report|bulletin|briefing)\b.*\b(generate|create|make|regenerate|redo)\b/i,
  /\bvision analysis could not extract\b/i,
  /\bdocument may be corrupted\b/i,
  /\bunsupported format\b/i,
  /\btry uploading images directly\b/i,
  /\bdownload\s+(the\s+)?pdf\b/i,
  /\breport (link|url)\s+(expired|removed)\b/i,
  /\bplease ask aegis to regenerate\b/i,
  /\bpdf (generation|download)\s+(failed|error|issue)\b/i,
  /\bhere('s| is) (your|the) (latest|new|updated|fresh)\s+(report|bulletin|briefing)\b/i,
  /\bI('ve| have) generated\b.*\b(report|bulletin|briefing)\b/i,
  /\byou can (view|download|access)\s+(the|your)\s+(report|bulletin)\b/i,
];

function isMetaConversation(text: string): boolean {
  // Short command-like messages are meta
  const stripped = text.replace(/\b(try again|regenerate|redo|improved|please|yes|no|ok|thanks)\b/gi, '').trim();
  if (stripped.length < 40) return true;
  
  // Check against meta patterns
  for (const pattern of META_CONVERSATION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// Build the unified AEGIS system prompt from shared modules
// Single source of truth — no more inline prompt duplication
function buildDashboardAegisPrompt(tenantKnowledgeContext: string = "", behavioralCorrectionContext: string = "", learningContext: string = "", agentRosterContext: string = "", copContext: string = ""): string {
  const timeContext = getTimeContext();
  
  return `${AEGIS_CORE_IDENTITY}

${FORTRESS_CORE_DIRECTIVE}

${AEGIS_CAPABILITY_MANIFEST}

${AEGIS_CHAT_MODIFIERS}

═══ CURRENT TIME ═══
${timeContext.full}
${agentRosterContext}
${copContext}
${tenantKnowledgeContext}${behavioralCorrectionContext}
${learningContext ? `\n${learningContext}\n` : ''}
${FORTRESS_PLATFORM_OVERVIEW}

${FORTRESS_AEGIS_CAPABILITIES}

${ANTI_FABRICATION_RULES}

${TOOL_USAGE_GUIDANCE}

${FORTRESS_WORKFLOW_INSTRUCTIONS}

═══ FINAL REMINDER (HIGHEST PRIORITY — RECENCY BIAS) ═══
YOU ARE AEGIS — a FULL intelligence platform with 21+ operational tools.
You HAVE agents. You DISPATCH them. You CREATE reports. You GENERATE audio.
NEVER say "As an AI" or "I don't have agents" or "I can't generate files."
NEVER claim your responses come from "training data" — you have LIVE tools.
When asked about capabilities: LIST THEM CONFIDENTLY from the manifest above.
When asked to do something: CALL THE TOOL IMMEDIATELY.

OPERATIONAL HONESTY (CRITICAL — ZERO TOLERANCE):
• ONLY report actions you ACTUALLY performed via tool calls in THIS conversation turn.
• If a tool returned { success: true } → you MAY report the action as done.
• If a tool returned { success: false } or error → you MUST report it FAILED.
• If you did NOT call a tool → you CANNOT claim the action happened.
• NEVER claim to have sent alerts, dispatched patrols, contacted law enforcement, or notified staff unless a tool confirmed it.
• NEVER say "I've updated the monitoring config" or "I've added keywords" without calling update_client_monitoring_config and getting a success response.
• NEVER say "I will add" or "I will update" without actually calling the tool in the same turn — this is fabrication.
• NEVER say "I will continue to monitor" or promise real-time watching — you execute one-time actions only.
• NEVER claim you shared documents with agents unless autonomous_actions_log confirms a 'document_dissemination' entry.
• NEVER claim you marked signals as irrelevant/relevant unless submit_ai_feedback returned { success: true, verified: true }.
• For configuration changes: CALL the tool → WAIT for result → REPORT actual result. No exceptions.
• If an emergency is reported: ingest the data, state what FORTRESS actually did, then recommend real-world actions the user must take themselves.
• FORTRESS monitors and analyzes — it does not dispatch responders or contact authorities.`;
}

// Tool definitions — single source of truth in _shared/aegis-tool-definitions.ts
const tools = aegisToolDefinitions;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTION — Hybrid dispatcher + legacy switch
// Extracted handlers are served from shared modules; remaining cases stay here
// until incrementally migrated.
// ═══════════════════════════════════════════════════════════════════════════════
const _extractedHandlers = {
  ...signalsAndIncidentsHandlers,
};

async function executeTool(toolName: string, args: any, supabaseClient: any, userId?: string) {
  // Inject user ID for memory tools
  const memoryTools = ["get_user_memory", "remember_this", "update_user_preferences", "manage_project_context"];
  if (memoryTools.includes(toolName) && userId) {
    args._user_id = userId;
  }
  console.log(`Executing tool: ${toolName}`, JSON.stringify(args));

  // 1. Try extracted handler modules first
  const handler = _extractedHandlers[toolName];
  if (handler) {
    try {
      return await handler(args, supabaseClient, userId);
    } catch (error) {
      console.error(`Tool execution error for ${toolName}:`, error);
      throw error;
    }
  }

  // 2. Legacy switch for remaining handlers (will be migrated incrementally)
  try {
    switch (toolName) {

    case "fix_duplicate_signals": {
      const { signal_ids, action, keep_signal_id } = args;
      
      if (!signal_ids || signal_ids.length < 2) {
        return { success: false, error: "Need at least 2 signal IDs to fix duplicates" };
      }

      if (action === "mark_as_duplicate") {
        // Use the detect-duplicates function
        try {
          const { error: detectError } = await supabaseClient.functions.invoke("signal-processor", {
            body: { action: 'deduplicate', signal_ids }
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
              'gpt-4o-mini (primary - advanced reasoning)',
              'gpt-4o-mini (utility/summarization)',
              'gpt-4o-mini (classification)',
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
      const docId = String(args.document_id || '').trim();
      if (!docId) {
        return { success: false, error: "Missing document_id" };
      }

      const isPlaceholder = (t: string) => /^Uploaded via/i.test(t.trim());
      const knownBuckets = [
        'ai-chat-attachments',
        'archival-documents',
        'investigation-files',
        'travel-documents',
        'bug-screenshots',
        'entity-photos',
        'agent-avatars',
      ];

      const resolveFullPath = async (storagePath: string | null, metaBucket?: string | null): Promise<string | null> => {
        if (!storagePath) return null;
        if (knownBuckets.some((b) => storagePath.startsWith(`${b}/`))) return storagePath;

        const { data: obj } = await supabaseClient
          .schema('storage')
          .from('objects')
          .select('bucket_id, name')
          .eq('name', storagePath)
          .maybeSingle();

        if (obj?.bucket_id && obj?.name) return `${obj.bucket_id}/${obj.name}`;
        if (metaBucket) return `${metaBucket}/${storagePath}`;
        return storagePath;
      };

      // Use maybeSingle so "not found" becomes a clean response (instead of a thrown Postgrest error)
      const { data, error } = await supabaseClient
        .from("archival_documents")
        .select("*")
        .eq("id", docId)
        .maybeSingle();

      if (error) {
        return {
          success: false,
          error: `Failed to load document: ${error.message}`,
          code: (error as any).code,
          hint: "Verify the document ID is correct and that you have access.",
        };
      }

      if (!data) {
        return {
          success: false,
          error: "Document not found",
          document_id: docId,
          hint: "Double-check the ID (a single character difference will fail).",
        };
      }

      const meta: any = data.metadata ?? {};
      const contentText = (data.content_text ?? "") as string;
      const placeholder = Boolean(contentText && isPlaceholder(contentText));
      const resolvedFilePath = await resolveFullPath(data.storage_path ?? null, meta.storage_bucket ?? null);

      return {
        success: true,
        document: {
          id: data.id,
          filename: data.filename,
          file_type: data.file_type,
          upload_date: data.upload_date,
          date_of_document: data.date_of_document,
          content_text: contentText,
          summary: data.summary,
          tags: data.tags,
          entity_mentions: data.entity_mentions,
          keywords: data.keywords,
          correlated_entity_ids: data.correlated_entity_ids,
          metadata: data.metadata,
          client_id: data.client_id,
          storage: {
            storage_path: data.storage_path,
            file_path: resolvedFilePath,
          },
          processing: {
            entities_processed: Boolean(meta.entities_processed),
            processing_error: meta.processing_error ?? null,
            storage_bucket: meta.storage_bucket ?? null,
            text_length: typeof meta.text_length === 'number' ? meta.text_length : null,
          },
        },
        note: placeholder
          ? "Only placeholder text is stored for this document (it has not been processed yet)."
          : (!contentText || contentText.trim().length === 0
            ? "No extracted text is stored for this document (common with map/image-based PDFs)."
            : undefined),
        suggestion: placeholder
          ? {
              tool: "process_document",
              document_id: docId,
              file_path: resolvedFilePath,
            }
          : undefined,
      };
    }

    case "process_document": {
      const docId = String(args.document_id || '').trim();
      if (!docId) {
        return { success: false, error: "Missing document_id" };
      }

      const knownBuckets = [
        'ai-chat-attachments',
        'archival-documents',
        'investigation-files',
        'travel-documents',
        'bug-screenshots',
        'entity-photos',
        'agent-avatars',
      ];

      // 1) Resolve file path (prefer explicit file_path; otherwise derive from archival_documents)
      let filePath = String(args.file_path || '').trim();
      let docFileType: string | null = null;
      let metaBucket: string | null = null;
      let storagePath: string | null = null;

      if (!filePath) {
        const { data: doc, error: docErr } = await supabaseClient
          .from('archival_documents')
          .select('id, storage_path, file_type, metadata')
          .eq('id', docId)
          .maybeSingle();

        if (docErr) {
          return { success: false, error: `Failed to load document record: ${docErr.message}` };
        }
        if (!doc) {
          return { success: false, error: 'Document not found', document_id: docId };
        }

        storagePath = doc.storage_path ?? null;
        docFileType = doc.file_type ?? null;
        metaBucket = (doc.metadata as any)?.storage_bucket ?? null;
        filePath = storagePath ? String(storagePath) : '';
      }

      // 2) Ensure file_path includes bucket
      if (filePath && !knownBuckets.some((b) => filePath.startsWith(`${b}/`))) {
        const { data: obj } = await supabaseClient
          .schema('storage')
          .from('objects')
          .select('bucket_id, name')
          .eq('name', filePath)
          .maybeSingle();

        if (obj?.bucket_id && obj?.name) {
          filePath = `${obj.bucket_id}/${obj.name}`;
        } else if (metaBucket) {
          filePath = `${metaBucket}/${filePath}`;
        }
      }

      if (!filePath) {
        return { success: false, error: 'Missing file_path and could not resolve it from the document record.' };
      }

      // 3) Infer MIME type
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = {
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
        txt: 'text/plain',
        md: 'text/markdown',
        csv: 'text/csv',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        tif: 'image/tiff',
        tiff: 'image/tiff',
      };

      const mimeType = String(args.mime_type || mimeMap[ext] || docFileType || 'application/octet-stream');

      // 4) Invoke the document converter
      const { data: docResult, error: invokeErr } = await supabaseClient.functions.invoke('fortress-document-converter', {
        body: {
          documentId: docId,
          filePath,
          mimeType,
          extractText: args.extract_text !== false,
          updateDatabase: args.update_database !== false,
          targetTable: 'archival_documents',
        },
      });

      if (invokeErr) {
        return { success: false, error: `Document processing call failed: ${invokeErr.message}` };
      }

      if (!docResult?.success) {
        return { success: false, error: docResult?.error || 'Document processing failed' };
      }

      return {
        success: true,
        document_id: docId,
        file_path: filePath,
        extracted_text_length: docResult.extractedTextLength ?? (docResult.extractedText ? String(docResult.extractedText).length : null),
        database_updated: args.update_database !== false,
      };
    }

    case "analyze_visual_document": {
      const docId = String(args.document_id || '').trim();
      const analysisFocus = args.analysis_focus || 'general';
      const maxPages = Math.min(Math.max(1, args.max_pages || 5), 10);
      
      if (!docId) {
        return { success: false, error: "Missing document_id" };
      }

      // Get document info
      const { data: doc, error: docError } = await supabaseClient
        .from("archival_documents")
        .select("*")
        .eq("id", docId)
        .maybeSingle();

      if (docError || !doc) {
        return {
          success: false,
          error: docError ? docError.message : "Document not found",
          document_id: docId,
        };
      }

      const meta: any = doc.metadata ?? {};

      // Early size guard: avoid downloading large binaries into memory.
      // The platform can return non-standard errors (e.g., 546) when memory limits are exceeded.
      const inferredIsPdf = doc.file_type === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf');
      const inferredSizeMb = (doc.file_size ?? 0) / (1024 * 1024);

      // Hard cap for any visual analysis
      if (inferredSizeMb > 20) {
        return {
          success: false,
          error: `File too large (${inferredSizeMb.toFixed(1)}MB). Maximum is 20MB.`,
          document_id: docId,
          filename: doc.filename,
        };
      }

      // PDFs up to 100MB can now be processed via signed URLs (Gemini API supports this)
      // We use signed URLs instead of base64 to avoid memory pressure
      if (inferredIsPdf) {
        const maxPdfMb = 100; // Gemini API now supports up to 100MB via URLs
        if (inferredSizeMb > maxPdfMb) {
          return {
            success: false,
            error: `PDF file is too large for analysis (${inferredSizeMb.toFixed(1)}MB > ${maxPdfMb}MB limit).`,
            document_id: docId,
            filename: doc.filename,
            suggestion: "Consider splitting the PDF into smaller files or compressing it.",
          };
        }
      }

      const preferredBucket = typeof meta.storage_bucket === 'string' && meta.storage_bucket.trim().length
        ? meta.storage_bucket.trim()
        : undefined;

      const candidateBuckets = Array.from(
        new Set([
          preferredBucket,
          'archival-documents',
          // Backward-compat for AI chat uploads
          'ai-chat-attachments',
        ].filter(Boolean) as string[])
      );

      // Prefer signed URLs for images to avoid loading/encoding large binaries in memory.
      // Large in-memory base64 strings can exceed runtime memory limits and surface as non-standard 546 errors.
      const inferredIsImage = doc.file_type?.startsWith('image/') ||
        /\.(jpg|jpeg|png|gif|webp|bmp|tiff?)$/i.test(doc.filename);

      let signedFileUrl: string | null = null;
      let resolvedBucket: string | null = null;
      const bucketErrors: Record<string, string> = {};

      if (inferredIsImage) {
        for (const bucket of candidateBuckets) {
          const { data: signedData, error: signedError } = await supabaseClient.storage
            .from(bucket)
            .createSignedUrl(doc.storage_path, 60 * 10);

          if (!signedError && signedData?.signedUrl) {
            signedFileUrl = signedData.signedUrl;
            resolvedBucket = bucket;
            break;
          }

          bucketErrors[bucket] = signedError?.message ?? 'Unknown error';
        }
      }

      // PDFs MUST use base64 data URLs — signed URLs are NOT supported by the AI gateway for PDFs.
      // Only image formats (PNG, JPEG, WebP, GIF) work with signed URLs.

      // Download files: always for PDFs (base64 required), and for images when signed URL failed
      if (inferredIsPdf || (!inferredIsImage) || (inferredIsImage && !signedFileUrl)) {
        let fileData: Blob | null = null;

        for (const bucket of candidateBuckets) {
          const { data: dlData, error: dlError } = await supabaseClient.storage
            .from(bucket)
            .download(doc.storage_path);

          if (!dlError && dlData) {
            fileData = dlData;
            resolvedBucket = bucket;
            break;
          }

          const existing = bucketErrors[bucket];
          const next = dlError?.message ?? 'Unknown error';
          bucketErrors[bucket] = existing ? `${existing} | download: ${next}` : `download: ${next}`;
        }

        if (!fileData) {
          return {
            success: false,
            error: `Failed to access file in storage. Tried: ${candidateBuckets.join(', ')}`,
            document_id: docId,
            filename: doc.filename,
            storage_path: doc.storage_path,
            bucket_errors: bucketErrors,
          };
        }

        fileBytes = await fileData.arrayBuffer();
      }

      // Persist resolved bucket so future tools/processors can find it
      if (resolvedBucket && resolvedBucket !== meta.storage_bucket) {
        try {
          await supabaseClient
            .from('archival_documents')
            .update({
              metadata: {
                ...(meta ?? {}),
                storage_bucket: resolvedBucket,
              },
            })
            .eq('id', docId);
        } catch {
          // non-fatal
        }
      }

      const fileSizeMB = fileBytes ? (fileBytes.byteLength / (1024 * 1024)) : inferredSizeMb;
      console.log(`Analyzing visual document: ${doc.filename} (${fileSizeMB.toFixed(1)}MB)`);

      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      ;
      }

      // Determine analysis prompt based on focus
      const focusPrompts: Record<string, string> = {
        infrastructure: `Focus on extracting:
- Road names, highway numbers, route designations
- Milepost (MP) markers and their values/ranges
- Pipeline routes, facilities, infrastructure corridors
- Geographic reference points and landmarks
- Company names, operators, ownership info`,
        'text extraction': `Extract ALL visible text from this document:
- Headers, titles, labels
- Data tables and their contents
- Legends and annotations
- Any numerical values or measurements`,
        'map features': `Analyze map features:
- Geographic boundaries and regions
- Scale and coordinate systems
- Legend symbols and their meanings
- Key locations and landmarks
- Transportation networks`,
        general: `Perform comprehensive analysis:
1. Extract all visible text
2. Identify key geographic features
3. List infrastructure elements (roads, pipelines, facilities)
4. Note any entities (companies, locations, people)
5. Describe the overall purpose and content`,
      };

      const analysisPrompt = focusPrompts[analysisFocus] || focusPrompts.general;

      let analysisResults: string[] = [];
      
      try {
        // Check if it's a PDF or image
        const isPDF = doc.file_type === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf');
        const isImage = doc.file_type?.startsWith('image/') || 
          /\.(jpg|jpeg|png|gif|webp|bmp|tiff?)$/i.test(doc.filename);

        if (isPDF) {
          // PDFs MUST use base64 data URLs — the AI gateway does NOT support signed URLs for PDFs
          if (!fileBytes) {
            return {
              success: false,
              error: 'Could not download PDF file for analysis',
              document_id: docId,
              filename: doc.filename,
              bucket_errors: bucketErrors,
            };
          }

          const maxSizeMB = 10;
          if (fileSizeMB > maxSizeMB) {
            return {
              success: false,
              error: `PDF file is too large for vision analysis (${fileSizeMB.toFixed(1)}MB > ${maxSizeMB}MB limit).`,
              document_id: docId,
              filename: doc.filename,
              suggestion: "Consider splitting the PDF into smaller files or compressing it.",
            };
          }

          const base64PDF = base64FromBytes(new Uint8Array(fileBytes));
          console.log(`Sending PDF as base64 data URL for analysis (${fileSizeMB.toFixed(1)}MB)`);

          const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `You are analyzing the document "${doc.filename}" which is a PDF file.

${analysisPrompt}

IMPORTANT: This document may contain maps, diagrams, tables, or image-based content. 
Analyze ALL pages thoroughly and extract every piece of visible text, data, labels, legends, and geographic/infrastructure information.
Be comprehensive - list all road names, milepost markers, facility names, pipeline routes, and any other relevant details.`
                  },
                  {
                    type: 'image_url',
                    image_url: { 
                      url: `data:application/pdf;base64,${base64PDF}` 
                    }
                  }
                ]
              }],
              max_tokens: 16000
            }),
          });

          if (visionResponse.ok) {
            const visionData = await visionResponse.json();
            const content = visionData.choices?.[0]?.message?.content;
            if (content && content.length > 50) {
              analysisResults.push(content);
              console.log(`PDF analysis via base64: Extracted ${content.length} chars`);
            } else {
              console.warn('PDF analysis returned minimal content');
            }
          } else {
            const errText = await visionResponse.text();
            console.error(`Vision API error ${visionResponse.status}: ${errText}`);
          }
        } else if (isImage) {
          // Direct image analysis
          const mimeType = doc.file_type || 'image/png';

          let imageUrl: string;
          if (signedFileUrl) {
            // Avoid base64-in-memory for large images (prevents memory-limit crashes)
            imageUrl = signedFileUrl;
          } else {
            if (!fileBytes) {
              throw new Error('Failed to load image bytes for analysis');
            }
            const base64Image = base64FromBytes(fileBytes);
            imageUrl = `data:${mimeType};base64,${base64Image}`;
          }

          const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this image: "${doc.filename}"

${analysisPrompt}

Be thorough and include every piece of visible text and data.`,
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageUrl },
                  },
                ],
              }],
              max_tokens: 8000,
            }),
          });

          if (visionResponse.ok) {
            const visionData = await visionResponse.json();
            const content = visionData.choices?.[0]?.message?.content;
            if (content) {
              analysisResults.push(content);
            }
          }
        } else {
          return {
            success: false,
            error: `Unsupported file type: ${doc.file_type}. Only PDFs and images are supported for visual analysis.`,
            document_id: docId,
            filename: doc.filename,
          };
        }
      } catch (analysisError) {
        console.error('Vision analysis error:', analysisError);
        return {
          success: false,
          error: `Analysis failed: ${analysisError instanceof Error ? analysisError.message : 'Unknown error'}`,
          document_id: docId,
          filename: doc.filename,
        };
      }

      if (analysisResults.length === 0) {
        return {
          success: false,
          error: "Vision analysis could not extract content from this document.",
          document_id: docId,
          filename: doc.filename,
          suggestion: "The document may be corrupted or in an unsupported format.",
        };
      }

      const fullAnalysis = analysisResults.join('\n\n');

      // Optionally update the document with extracted content
      try {
        await supabaseClient
          .from('archival_documents')
          .update({
            content_text: fullAnalysis.slice(0, 200000), // Limit storage
            metadata: {
              ...(doc.metadata || {}),
              vision_analyzed: true,
              vision_analysis_date: new Date().toISOString(),
              analysis_focus: analysisFocus,
              pages_analyzed: analysisResults.length,
            },
          })
          .eq('id', docId);
      } catch (updateErr) {
        console.warn('Failed to save analysis to document:', updateErr);
      }

      return {
        success: true,
        document_id: docId,
        filename: doc.filename,
        file_type: doc.file_type,
        file_size_mb: fileSizeMB.toFixed(1),
        analysis_focus: analysisFocus,
        pages_analyzed: analysisResults.length,
        analysis: fullAnalysis,
        note: "Visual analysis complete. Content has been saved to the document record.",
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

      // Check if there's already a pending suggestion for this entity
      const { data: existingSuggestion } = await supabaseClient
        .from("entity_suggestions")
        .select("id, suggested_name, status")
        .ilike("suggested_name", name)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();

      if (existingSuggestion) {
        return {
          success: false,
          message: `A suggestion for entity "${existingSuggestion.suggested_name}" already exists and is pending review.`,
          suggestion_id: existingSuggestion.id
        };
      }
      
      // Create as entity_suggestion instead of directly in entities (suggestions-first policy)
      const { data: newSuggestion, error } = await supabaseClient
        .from("entity_suggestions")
        .insert({
          suggested_name: name,
          suggested_type: type,
          suggested_aliases: aliases || null,
          suggested_attributes: description ? { description } : null,
          source_type: "ai_assistant",
          // entity_suggestions.source_id is a UUID in the database
          source_id: crypto.randomUUID(),
          confidence: 0.85,
          context: `Created via AI Assistant: ${description || 'No description provided'}`,
          status: "pending"
        })
        .select("id, suggested_name, suggested_type")
        .single();
      
      if (error) {
        console.error("Failed to create entity suggestion:", error);
        return {
          success: false,
          message: `Failed to create entity suggestion: ${error.message}`
        };
      }
      
      return {
        success: true,
        message: `Created entity suggestion "${newSuggestion.suggested_name}" (${newSuggestion.suggested_type}). It will appear in the Suggestions tab for analyst review.`,
        suggestion: newSuggestion,
        next_step: "The entity suggestion is now pending review. Once approved by an analyst, it will be added to the entities database."
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
      const { object_id, object_type, feedback, notes, correction, reason } = args;

      // ── Call process-feedback edge function for full learning pipeline ──
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      const feedbackPayload = {
        objectType: object_type,
        objectId: object_id,
        feedback,
        notes: notes || correction || null,
        correction: correction || null,
        userId: null, // System-initiated via AEGIS
        sourceFunction: 'dashboard-ai-assistant',
        feedbackContext: {
          reason: reason || null,
          submitted_by: 'aegis',
          timestamp: new Date().toISOString(),
        },
      };

      let processFeedbackResult: Record<string, unknown> | null = null;
      let processFeedbackError: string | null = null;

      try {
        const pfResponse = await fetch(`${supabaseUrl}/functions/v1/process-feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(feedbackPayload),
        });

        if (pfResponse.ok) {
          processFeedbackResult = await pfResponse.json();
        } else {
          processFeedbackError = `process-feedback returned ${pfResponse.status}: ${await pfResponse.text()}`;
          console.error(`[submit_ai_feedback] ${processFeedbackError}`);
        }
      } catch (pfErr) {
        processFeedbackError = `process-feedback call failed: ${pfErr instanceof Error ? pfErr.message : String(pfErr)}`;
        console.error(`[submit_ai_feedback] ${processFeedbackError}`);
      }

      // ── Audit log: record what actually happened ──
      const auditRecord = {
        tool: 'submit_ai_feedback',
        object_id,
        object_type,
        feedback,
        reason: reason || null,
        process_feedback_success: processFeedbackResult !== null,
        process_feedback_error: processFeedbackError,
        learning_actions: processFeedbackResult?.learning_actions || [],
        timestamp: new Date().toISOString(),
      };

      await supabaseClient.from('autonomous_actions_log').insert({
        action_type: 'feedback_submission',
        trigger_source: 'aegis_chat',
        action_details: auditRecord,
        result: processFeedbackResult || { error: processFeedbackError },
        status: processFeedbackResult ? 'completed' : 'error',
        error_message: processFeedbackError,
      });

      if (processFeedbackError) {
        return {
          success: false,
          verified: false,
          message: `Feedback submission FAILED: ${processFeedbackError}. The signal was NOT updated.`,
        };
      }

      const learningActions = (processFeedbackResult?.learning_actions as string[]) || [];
      return {
        success: true,
        verified: true,
        message: `Feedback recorded and verified. Signal ${object_id} marked as '${feedback}'. ${learningActions.length} learning profiles updated: ${learningActions.join(', ')}.`,
        feedback_result: processFeedbackResult,
        audit_id: auditRecord.timestamp,
      };
    }

    case "read_client_monitoring_config": {
      const { client_id, include_sources = true } = args;

      // Resolve client_id if name is provided
      let resolvedClientId = client_id;
      if (client_id && !client_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        // Try exact match first, then fuzzy match
        const { data: exactClient } = await supabaseClient
          .from("clients")
          .select("id")
          .ilike("name", client_id)
          .limit(1)
          .maybeSingle();
        
        if (exactClient) {
          resolvedClientId = exactClient.id;
        } else {
          // Fuzzy search with wildcards
          const { data: fuzzyClient } = await supabaseClient
            .from("clients")
            .select("id, name")
            .ilike("name", `%${client_id}%`)
            .limit(1)
            .maybeSingle();
          resolvedClientId = fuzzyClient?.id;
          if (fuzzyClient) {
            console.log(`Resolved client name "${client_id}" to "${fuzzyClient.name}" (${fuzzyClient.id})`);
          }
        }
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
        ai_model: "gpt-4o-mini"
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
        "intelligence-engine",
        {
          body: { action: 'impact-analysis', signal_id, threat_actor_id },
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
        "signal-processor",
        {
          body: {
            action: 'merge',
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
      const { text, client_name, client_id, severity = "medium", category = "test" } = args;
      
      // CRITICAL FIX: Look up client_id from client_name if provided
      let resolvedClientId = client_id;
      
      if (client_name && !client_id) {
        const rawClientName = String(client_name ?? "").trim();

        // The model sometimes sends extra punctuation/context, e.g.
        //   `"Petronas Canada"` (This is the crucial part...)
        // Normalize by extracting the first quoted segment when present, then trimming trailing commentary.
        const quoted = rawClientName.match(/[`"']{1,3}([^`"']{2,160})[`"']{1,3}/);
        let cleanClientName = (quoted?.[1] ?? rawClientName)
          .split("\n")[0]
          .split("(")[0]
          .trim()
          .replace(/^[`"']+|[`"']+$/g, "")
          .trim();

        // Also try a version with all quote characters removed.
        const cleanClientNameNoQuotes = cleanClientName.replace(/[`"']/g, "").trim();

        const attemptedNames = Array.from(
          new Set([cleanClientName, cleanClientNameNoQuotes].filter(Boolean))
        );

        console.log(
          `Looking up client_id for: ${attemptedNames.join(" | ")} (original: ${rawClientName})`
        );

        let clientData: { id: string; name: string } | null = null;

        // Attempt exact-ish match first (case-insensitive pattern without wildcards), then fallback to contains.
        for (const name of attemptedNames) {
          const exact = await supabaseClient
            .from("clients")
            .select("id, name")
            .ilike("name", name)
            .limit(1)
            .maybeSingle();

          if (exact.data) {
            clientData = exact.data;
            break;
          }

          const contains = await supabaseClient
            .from("clients")
            .select("id, name")
            .ilike("name", `%${name}%`)
            .limit(1)
            .maybeSingle();

          if (contains.data) {
            clientData = contains.data;
            break;
          }
        }

        // Final fallback: fetch a small list and match in-memory (helps when the model includes odd characters).
        if (!clientData) {
          const { data: clientsList } = await supabaseClient
            .from("clients")
            .select("id, name")
            .order("name")
            .limit(500);

          const loweredAttempts = attemptedNames.map((n) => n.toLowerCase());
          clientData =
            (clientsList || []).find((c: { id: string; name: string }) =>
              loweredAttempts.some((n) => c.name.toLowerCase() === n)
            ) ||
            (clientsList || []).find((c: { id: string; name: string }) =>
              loweredAttempts.some(
                (n) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())
              )
            ) ||
            null;
        }

        if (!clientData) {
          return {
            error: "Client not found",
            message: `Could not find a client matching '${rawClientName}'. Please use the exact client name from your Clients list (e.g., Petronas Canada).`,
          };
        }

        resolvedClientId = clientData.id;
        console.log(`Resolved client to UUID: ${resolvedClientId} (${clientData.name})`);
      }
      if (!resolvedClientId) {
        return {
          error: "Missing client identifier",
          message: "Either client_name or client_id must be provided",
        };
      }
      
      console.log(`Injecting test signal for client: ${resolvedClientId}`);
      
      // CRITICAL FIX: Use direct HTTP call instead of supabaseClient.functions.invoke()
      // which was failing silently. Direct HTTP calls are more reliable for edge-to-edge communication.
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      const ingestResponse = await fetch(
        `${SUPABASE_URL}/functions/v1/signal-processor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            action: 'ingest',
            text,
            client_id: resolvedClientId,
            severity,
            category,
            is_test: true,
          }),
        }
      );

      if (!ingestResponse.ok) {
        const errorText = await ingestResponse.text();
        console.error("Error injecting signal:", errorText);
        return {
          error: errorText,
          message: `Failed to inject signal: ${ingestResponse.status} ${errorText}`,
        };
      }

      const ingestResult = await ingestResponse.json();
      
      console.log(`✅ Signal created successfully: ${ingestResult.signal_id}`);

      return {
        success: true,
        signal_id: ingestResult.signal_id,
        message: `✅ Test signal injected successfully with ID ${ingestResult.signal_id?.slice(0, 8)}...
        
**Signal created in database and visible in UI.**

To view:
1. Log in to Fortress (if not already)
2. Select the correct client using the client selector
3. Navigate to the Signals page (/signals)

The signal is now in the database with status 'triaged' and rules have been applied.`,
        details: ingestResult,
      };
    }

    case "optimize_rule_thresholds": {
      const { rule_id, feedback_data, auto_apply = false } = args;
      
      console.log(`Optimizing rule thresholds for rule: ${rule_id}`);
      
      const { data: optimizationResult, error: optimizationError } = await supabaseClient.functions.invoke(
        "optimize-rule-thresholds",
        {
          body: {
            rule_id,
            feedback_data: feedback_data || {},
            auto_apply,
          },
        }
      );

      if (optimizationError) {
        console.error("Error optimizing rule thresholds:", optimizationError);
        return {
          error: optimizationError.message,
          message: `Failed to optimize rule: ${optimizationError.message}`,
        };
      }

      return {
        success: true,
        rule_name: optimizationResult.rule_name,
        analysis: optimizationResult.analysis,
        applied_changes: optimizationResult.applied_changes,
        message: optimizationResult.applied_changes 
          ? `Rule optimization complete with ${optimizationResult.analysis.recommendations.length} recommendations. Changes ${optimizationResult.applied_changes.status === "pending_approval" ? "pending approval" : "applied"}.`
          : `Rule analysis complete. Found ${optimizationResult.analysis.recommendations.length} optimization opportunities. False positive rate: ${(optimizationResult.analysis.analysis.false_positive_rate * 100).toFixed(1)}%.`,
      };
    }

    case "propose_new_monitoring_keywords": {
      const { client_id, observed_trends, lookback_days = 30 } = args;
      
      console.log(`Proposing new monitoring keywords for client: ${client_id}`);
      
      const { data: keywordProposal, error: keywordError } = await supabaseClient.functions.invoke(
        "propose-new-monitoring-keywords",
        {
          body: {
            client_id,
            observed_trends,
            lookback_days,
          },
        }
      );

      if (keywordError) {
        console.error("Error proposing keywords:", keywordError);
        return {
          error: keywordError.message,
          message: `Failed to propose keywords: ${keywordError.message}`,
        };
      }

      const highConfidenceProposals = keywordProposal.proposals.filter((p: any) => p.confidence === "high");
      
      return {
        success: true,
        client_name: keywordProposal.client_name,
        proposals: keywordProposal.proposals,
        message: `Keyword analysis complete for ${keywordProposal.client_name}. Found ${keywordProposal.proposals.length} keyword proposals (${highConfidenceProposals.length} high-confidence) based on ${keywordProposal.signals_analyzed} signals from the past ${lookback_days} days.`,
      };
    }

    case "autonomous_source_health_manager": {
      const { source_id, auto_fix = true, dry_run = false } = args;
      
      console.log(`Managing source health${source_id ? ` for: ${source_id}` : " for all failed sources"}`);
      
      const { data: healthResult, error: healthError } = await supabaseClient.functions.invoke(
        "autonomous-source-health-manager",
        {
          body: {
            source_id,
            auto_fix,
            dry_run,
          },
        }
      );

      if (healthError) {
        console.error("Error managing source health:", healthError);
        return {
          error: healthError.message,
          message: `Failed to manage source health: ${healthError.message}`,
        };
      }

      const fixedSources = healthResult.results.filter((r: any) => r.actions_taken.some((a: any) => a.action !== "health_check_passed"));
      const healthySources = healthResult.results.filter((r: any) => r.test_result.success);
      
      return {
        success: true,
        sources_checked: healthResult.sources_checked,
        results: healthResult.results,
        message: dry_run 
          ? `Health check complete (DRY RUN). ${healthResult.sources_checked} sources checked. ${fixedSources.length} sources with issues identified.`
          : `Source health management complete. ${healthResult.sources_checked} sources checked, ${fixedSources.length} sources auto-fixed, ${healthySources.length} sources healthy.`,
      };
    }

    case "simulate_attack_path": {
      const { threat_actor_profile, target_asset_id, vulnerability_id } = args;
      
      console.log(`Simulating attack path: ${threat_actor_profile} → ${target_asset_id}`);
      
      const { data: simulationResult, error: simulationError } = await supabaseClient.functions.invoke(
        "simulate-attack-path",
        {
          body: {
            threat_actor_profile,
            target_asset_id,
            vulnerability_id,
          },
        }
      );

      if (simulationError) {
        console.error("Error simulating attack path:", simulationError);
        return {
          error: simulationError.message,
          message: `Failed to simulate attack path: ${simulationError.message}`,
        };
      }

      return {
        success: true,
        threat_actor: threat_actor_profile,
        target: target_asset_id,
        simulation: simulationResult.simulation,
        message: `Attack path simulation complete. Likelihood: ${simulationResult.simulation.likelihood}. Timeline: ${simulationResult.simulation.estimated_timeline}. Found ${simulationResult.simulation.related_signals_count} related threat signals.`,
      };
    }

    case "simulate_protest_escalation": {
      const { signal_id, escalation_factors } = args;
      
      console.log(`Simulating protest escalation for signal: ${signal_id}`);
      
      const { data: escalationResult, error: escalationError } = await supabaseClient.functions.invoke(
        "simulate-protest-escalation",
        {
          body: {
            signal_id,
            escalation_factors,
          },
        }
      );

      if (escalationError) {
        console.error("Error simulating escalation:", escalationError);
        return {
          error: escalationError.message,
          message: `Failed to simulate protest escalation: ${escalationError.message}`,
        };
      }

      const forecast = escalationResult.escalation_forecast;
      
      return {
        success: true,
        signal_id,
        forecast,
        message: `Escalation forecast complete. Likelihood: ${forecast.escalation_likelihood} (${forecast.escalation_probability}%). Violence probability: ${forecast.violence_probability}%. Estimated duration: ${forecast.estimated_duration}. Analysis based on ${forecast.historical_context.similar_protests} historical protests.`,
      };
    }

    case "identify_critical_failure_points": {
      const { client_operation_flow, threat_scenario } = args;
      
      console.log(`Identifying failure points in: ${client_operation_flow} under scenario: ${threat_scenario}`);
      
      const { data: analysisResult, error: analysisError } = await supabaseClient.functions.invoke(
        "intelligence-engine",
        {
          body: {
            action: 'critical-failure-points',
            client_operation_flow,
            threat_scenario,
          },
        }
      );

      if (analysisError) {
        console.error("Error analyzing failure points:", analysisError);
        return {
          error: analysisError.message,
          message: `Failed to identify failure points: ${analysisError.message}`,
        };
      }

      const analysis = analysisResult.failure_analysis;
      
      return {
        success: true,
        operation: analysisResult.operation_context,
        threat_scenario,
        analysis,
        message: `Failure point analysis complete. Identified ${analysis.critical_points_identified} critical failure points and ${analysis.single_points_of_failure} single points of failure. Analysis based on ${analysis.historical_context.total_incidents_analyzed} historical incidents.`,
      };
    }

    case "generate_incident_briefing": {
      const { incident_id, format = "executive" } = args;
      
      console.log(`Generating ${format} briefing for incident: ${incident_id}`);
      
      const { data: briefingResult, error: briefingError } = await supabaseClient.functions.invoke(
        "incident-manager",
        {
          body: {
            action: 'generate-briefing',
            incident_id,
            format,
          },
        }
      );

      if (briefingError) {
        console.error("Error generating briefing:", briefingError);
        return {
          error: briefingError.message,
          message: `Failed to generate briefing: ${briefingError.message}`,
        };
      }

      const briefing = briefingResult.briefing;
      
      return {
        success: true,
        incident_id,
        format,
        briefing,
        message: `${format === 'executive' ? 'Executive' : 'Operational'} briefing generated for incident ${briefingResult.briefing.incident_summary.title}. Status: ${briefingResult.briefing.incident_summary.status}, Priority: ${briefingResult.briefing.incident_summary.priority}, Age: ${briefing.incident_summary.age_minutes} minutes.`,
      };
    }

    case "guide_decision_tree": {
      const { incident_id, current_state, user_response } = args;
      
      console.log(`Guiding decision for incident: ${incident_id}, state: ${current_state}`);
      
      const { data: guidanceResult, error: guidanceError } = await supabaseClient.functions.invoke(
        "guide-decision-tree",
        {
          body: {
            incident_id,
            current_state,
            user_response,
          },
        }
      );

      if (guidanceError) {
        console.error("Error providing guidance:", guidanceError);
        return {
          error: guidanceError.message,
          message: `Failed to provide decision guidance: ${guidanceError.message}`,
        };
      }

      const guidance = guidanceResult.guidance;
      
      return {
        success: true,
        incident_id,
        current_state,
        guidance,
        message: `Decision guidance provided for state '${current_state}'. Recommended next state: ${guidance.recommended_next_state}. ${guidance.available_playbooks.length} playbooks available, ${guidance.escalation_options.length} escalation options.`,
      };
    }

    case "track_mitigation_effectiveness": {
      const { playbook_id, incident_id } = args;
      
      console.log(`Tracking effectiveness for playbook: ${playbook_id}, incident: ${incident_id}`);
      
      const { data: trackingResult, error: trackingError } = await supabaseClient.functions.invoke(
        "track-mitigation-effectiveness",
        {
          body: {
            playbook_id,
            incident_id,
          },
        }
      );

      if (trackingError) {
        console.error("Error tracking effectiveness:", trackingError);
        return {
          error: trackingError.message,
          message: `Failed to track effectiveness: ${trackingError.message}`,
        };
      }

      const tracking = trackingResult.effectiveness_tracking;
      
      return {
        success: true,
        playbook_name: trackingResult.playbook_name,
        incident_id,
        tracking,
        message: `Effectiveness analysis complete for playbook '${trackingResult.playbook_name}'. Rating: ${tracking.rating}/5. Success rate: ${tracking.metrics.success_rate}, Accuracy: ${tracking.metrics.accuracy_rate}, Avg response time: ${tracking.metrics.average_response_time_minutes} minutes.`,
      };
    }

    // Phase 6: Proactive Defense Optimization
    case "recommend_tactical_countermeasures": {
      const { signal_id, client_context } = args;
      
      console.log(`Recommending tactical countermeasures for signal: ${signal_id}`);
      
      const { data: countermeasuresResult, error: countermeasuresError } = await supabaseClient.functions.invoke(
        "recommend-tactical-countermeasures",
        { body: { signal_id, client_context } }
      );

      if (countermeasuresError) {
        console.error("Error recommending countermeasures:", countermeasuresError);
        return {
          error: countermeasuresError.message,
          message: `Failed to generate countermeasures: ${countermeasuresError.message}`,
        };
      }

      return {
        success: true,
        signal_id,
        countermeasures: countermeasuresResult.countermeasures,
        analyzed_at: countermeasuresResult.analyzed_at,
        message: `Generated tactical countermeasure recommendations for signal ${signal_id}.`,
      };
    }

    case "evaluate_countermeasure_impact": {
      const { countermeasure_plan, threat_scenario_id } = args;
      
      console.log(`Evaluating countermeasure impact for scenario: ${threat_scenario_id}`);
      
      const { data: evaluationResult, error: evaluationError } = await supabaseClient.functions.invoke(
        "evaluate-countermeasure-impact",
        { body: { countermeasure_plan, threat_scenario_id } }
      );

      if (evaluationError) {
        console.error("Error evaluating countermeasure impact:", evaluationError);
        return {
          error: evaluationError.message,
          message: `Failed to evaluate impact: ${evaluationError.message}`,
        };
      }

      return {
        success: true,
        threat_scenario_id,
        evaluation: evaluationResult.evaluation,
        evaluated_at: evaluationResult.evaluated_at,
        message: `Completed countermeasure impact evaluation for scenario ${threat_scenario_id}.`,
      };
    }

    case "optimize_defense_strategies": {
      const { client_id, threat_type } = args;
      
      console.log(`Optimizing defense strategies for client: ${client_id}, threat: ${threat_type}`);
      
      const { data: strategyResult, error: strategyError } = await supabaseClient.functions.invoke(
        "optimize-defense-strategies",
        { body: { client_id, threat_type } }
      );

      if (strategyError) {
        console.error("Error optimizing defense strategies:", strategyError);
        return {
          error: strategyError.message,
          message: `Failed to optimize strategies: ${strategyError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        threat_type,
        optimized_strategy: strategyResult.optimized_strategy,
        analyzed_at: strategyResult.analyzed_at,
        message: `Generated optimized defense strategy for ${threat_type} threats.`,
      };
    }

    // Phase 6: Strategic Foresight & Long-term Planning
    case "propose_security_investments": {
      const { client_id, budget_constraints, time_horizon_months } = args;
      
      console.log(`Proposing security investments for client: ${client_id}`);
      
      const { data: investmentResult, error: investmentError } = await supabaseClient.functions.invoke(
        "propose-security-investments",
        { body: { client_id, budget_constraints, time_horizon_months } }
      );

      if (investmentError) {
        console.error("Error proposing investments:", investmentError);
        return {
          error: investmentError.message,
          message: `Failed to generate investment recommendations: ${investmentError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        investment_plan: investmentResult.investment_plan,
        analyzed_at: investmentResult.analyzed_at,
        message: `Generated strategic security investment recommendations.`,
      };
    }

    case "model_geopolitical_risk": {
      const { geopolitical_event_description, affected_regions, client_business_units } = args;
      
      console.log(`Modeling geopolitical risk impact`);
      
      const { data: riskResult, error: riskError } = await supabaseClient.functions.invoke(
        "model-geopolitical-risk",
        { body: { geopolitical_event_description, affected_regions, client_business_units } }
      );

      if (riskError) {
        console.error("Error modeling geopolitical risk:", riskError);
        return {
          error: riskError.message,
          message: `Failed to model geopolitical risk: ${riskError.message}`,
        };
      }

      return {
        success: true,
        risk_analysis: riskResult.risk_analysis,
        analyzed_at: riskResult.analyzed_at,
        message: `Completed geopolitical risk impact analysis.`,
      };
    }

    case "recommend_policy_adjustments": {
      const { client_id, threat_scenario_description } = args;
      
      console.log(`Recommending policy adjustments for client: ${client_id}`);
      
      const { data: policyResult, error: policyError } = await supabaseClient.functions.invoke(
        "recommend-policy-adjustments",
        { body: { client_id, threat_scenario_description } }
      );

      if (policyError) {
        console.error("Error recommending policy adjustments:", policyError);
        return {
          error: policyError.message,
          message: `Failed to generate policy recommendations: ${policyError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        policy_recommendations: policyResult.policy_recommendations,
        analyzed_at: policyResult.analyzed_at,
        message: `Generated security policy adjustment recommendations.`,
      };
    }

    // Phase 6: Autonomous Compliance Monitoring
    case "monitor_regulatory_changes": {
      const { jurisdiction, industry_sector } = args;
      
      console.log(`Monitoring regulatory changes for ${jurisdiction}, ${industry_sector}`);
      
      const { data: regulatoryResult, error: regulatoryError } = await supabaseClient.functions.invoke(
        "osint-collector",
        { body: { action: 'monitor-regulatory', jurisdiction, industry_sector } }
      );

      if (regulatoryError) {
        console.error("Error monitoring regulatory changes:", regulatoryError);
        return {
          error: regulatoryError.message,
          message: `Failed to analyze regulatory changes: ${regulatoryError.message}`,
        };
      }

      return {
        success: true,
        jurisdiction,
        industry_sector,
        regulatory_analysis: regulatoryResult.regulatory_analysis,
        analyzed_at: regulatoryResult.analyzed_at,
        message: `Completed regulatory change analysis for ${jurisdiction} ${industry_sector} sector.`,
      };
    }

    case "map_policy_to_controls": {
      const { client_id, policy_document_content, policy_name } = args;
      
      console.log(`Mapping policy to controls for client: ${client_id}, policy: ${policy_name}`);
      
      const { data: mappingResult, error: mappingError } = await supabaseClient.functions.invoke(
        "map-policy-to-controls",
        { body: { client_id, policy_document_content, policy_name } }
      );

      if (mappingError) {
        console.error("Error mapping policy to controls:", mappingError);
        return {
          error: mappingError.message,
          message: `Failed to map policy to controls: ${mappingError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        policy_name,
        control_mapping: mappingResult.control_mapping,
        analyzed_at: mappingResult.analyzed_at,
        message: `Completed policy-to-control mapping analysis for '${policy_name}'.`,
      };
    }

    case "audit_compliance_status": {
      const { client_id, policy_area, audit_period_days } = args;
      
      console.log(`Auditing compliance status for client: ${client_id}, policy area: ${policy_area}`);
      
      const { data: auditResult, error: auditError } = await supabaseClient.functions.invoke(
        "audit-compliance-status",
        { body: { client_id, policy_area, audit_period_days } }
      );

      if (auditError) {
        console.error("Error auditing compliance status:", auditError);
        return {
          error: auditError.message,
          message: `Failed to conduct compliance audit: ${auditError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        policy_area,
        audit_report: auditResult.audit_report,
        audited_at: auditResult.audited_at,
        message: `Completed compliance audit for ${policy_area} (${audit_period_days} day period).`,
      };
    }

    case "recommend_compliance_remediation": {
      const { client_id, compliance_gap_description, risk_score } = args;
      
      console.log(`Recommending compliance remediation for client: ${client_id}`);
      
      const { data: remediationResult, error: remediationError } = await supabaseClient.functions.invoke(
        "recommend-compliance-remediation",
        { body: { client_id, compliance_gap_description, risk_score } }
      );

      if (remediationError) {
        console.error("Error recommending remediation:", remediationError);
        return {
          error: remediationError.message,
          message: `Failed to generate remediation plan: ${remediationError.message}`,
        };
      }

      return {
        success: true,
        client_id,
        compliance_gap: remediationResult.compliance_gap,
        remediation_plan: remediationResult.remediation_plan,
        generated_at: remediationResult.generated_at,
        message: `Generated comprehensive compliance remediation plan.`,
      };
    }

    case "update_agent_configuration": {
      const { agent_id, updates, reason, requested_by, lookup } = args;

      const resolveAgentId = async (): Promise<
        | { ok: true; id: string }
        | { ok: false; message: string; candidates?: Array<{ id: string; codename: string | null; header_name: string | null; call_sign: string | null }> }
      > => {
        // 1) If an agent_id was provided, verify it exists (prevents confusing 404s later)
        if (agent_id) {
          const { data: existing, error } = await supabaseClient
            .from("ai_agents")
            .select("id")
            .eq("id", agent_id)
            .maybeSingle();

          if (!error && existing?.id) {
            return { ok: true, id: existing.id };
          }
        }

        // 2) Prefer resolving by CURRENT identifiers via `lookup` (so renames work)
        const orParts: string[] = [];
        const lookupHeader = (lookup as any)?.header_name || (lookup as any)?.name;
        if (lookup?.call_sign) orParts.push(`call_sign.eq.${lookup.call_sign}`);
        if (lookup?.codename) orParts.push(`codename.eq.${lookup.codename}`);
        if (lookupHeader) orParts.push(`header_name.eq.${lookupHeader}`);

        // 3) Fallback lookup by update payload (less reliable if values are being renamed)
        if (orParts.length === 0) {
          if (updates?.call_sign) orParts.push(`call_sign.eq.${updates.call_sign}`);
          if (updates?.codename) orParts.push(`codename.eq.${updates.codename}`);
          if ((updates as any)?.header_name) orParts.push(`header_name.eq.${(updates as any).header_name}`);
        }

        if (orParts.length === 0) {
          return {
            ok: false,
            message:
              "Agent not found. Provide agent_id, or provide lookup {header_name|codename|call_sign} using the agent's CURRENT values so I can find it before applying updates.",
          };
        }

        const { data: matches, error: matchError } = await supabaseClient
          .from("ai_agents")
          .select("id, codename, header_name, call_sign")
          .or(orParts.join(","))
          .limit(2);

        if (matchError) {
          return { ok: false, message: `Failed to resolve agent: ${matchError.message}` };
        }

        if (!matches || matches.length === 0) {
          return {
            ok: false,
            message:
              "Agent not found. The provided agent_id does not exist and no agent matched the provided codename/call_sign/header_name.",
          };
        }

        if (matches.length > 1) {
          return {
            ok: false,
            message:
              "Multiple agents matched the provided identifiers. Please specify agent_id to avoid updating the wrong agent.",
            candidates: matches,
          };
        }

        return { ok: true, id: matches[0].id };
      };

      const resolved = await resolveAgentId();
      if (!resolved.ok) {
        // Check if we have enough info to CREATE the agent instead
        const hasCreationRequirements = 
          updates?.codename && 
          updates?.call_sign && 
          (updates?.persona || updates?.specialty || updates?.mission_scope);
        
        if (hasCreationRequirements) {
          console.log("update_agent_configuration: Agent not found, auto-creating with provided config", { updates });
          
          // Redirect to create_agent
          const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
          const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          
          if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
            return {
              error: "Missing backend configuration for agent creation",
              message: "Cannot auto-create agent: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
            };
          }
          
          const createRes = await fetch(`${SUPABASE_URL}/functions/v1/create-agent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              header_name: (updates as any)?.header_name || updates?.codename,
              codename: updates?.codename,
              call_sign: updates?.call_sign,
              persona: updates?.persona || `${updates?.codename} is a specialized AI agent.`,
              specialty: updates?.specialty || "General security intelligence",
              mission_scope: updates?.mission_scope || "Provide security intelligence support",
              interaction_style: updates?.interaction_style,
              input_sources: updates?.input_sources,
              output_types: updates?.output_types,
              is_client_facing: updates?.is_client_facing,
              is_active: updates?.is_active ?? true,
              avatar_color: (updates as any)?.avatar_color,
              system_prompt: updates?.system_prompt,
              requested_by: requested_by || "Aegis (auto-create from update)",
            }),
          });
          
          const createRawText = await createRes.text();
          let createBody: any = null;
          try {
            createBody = createRawText ? JSON.parse(createRawText) : null;
          } catch {
            createBody = { raw: createRawText };
          }
          
          if (!createRes.ok) {
            console.error("update_agent_configuration: Auto-create failed", createRes.status, createBody);
            return {
              success: false,
              status: createRes.status,
              error: createBody?.error || `Auto-create failed (${createRes.status})`,
              message: `Agent not found and auto-creation failed: ${createBody?.message || createBody?.error || createRes.status}`,
              original_resolution_error: resolved.message,
            };
          }
          
          console.log("update_agent_configuration: Auto-created agent successfully", createBody);
          return {
            success: true,
            auto_created: true,
            agent_id: createBody?.agent?.id || createBody?.id,
            agent: createBody?.agent,
            message: `Agent "${updates?.codename}" did not exist and was automatically created.`,
          };
        }
        
        console.error("update_agent_configuration: unable to resolve agent", { agent_id, updates, resolved });
        return {
          error: resolved.message,
          message: resolved.message,
          candidates: resolved.candidates,
        };
      }

      console.log(`Updating agent configuration for: ${resolved.id}`);

      const { data: configResult, error: configError } = await supabaseClient.functions.invoke(
        "update-agent-configuration",
        {
          body: {
            agent_id: resolved.id,
            updates,
            reason: reason || "Configuration update via Aegis",
            requested_by: requested_by || "Aegis",
          },
        }
      );

      if (configError) {
        // Try to surface the real status/body so users don't just see "non-2xx"
        let details: unknown = undefined;
        let status: number | undefined = undefined;
        try {
          status = (configError as any)?.context?.status;
          if ((configError as any)?.context?.json) {
            details = await (configError as any).context.json();
          } else if ((configError as any)?.context?.text) {
            const txt = await (configError as any).context.text();
            try {
              details = JSON.parse(txt);
            } catch {
              details = txt;
            }
          }
        } catch {
          // ignore
        }

        console.error("Error updating agent configuration:", { configError, status, details });

        const detailsMsg = details ? ` Details: ${typeof details === "string" ? details : JSON.stringify(details)}` : "";
        const statusMsg = status ? ` (status ${status})` : "";

        return {
          error: configError.message,
          message: `Failed to update agent configuration${statusMsg}: ${configError.message}${detailsMsg}`,
          status,
          details,
          agent_id: resolved.id,
        };
      }

      return {
        success: true,
        agent_id: resolved.id,
        updated_agent: configResult.agent,
        changes: configResult.changes,
        audit_key: configResult.audit_key,
        message: configResult.message || `Successfully updated agent configuration.`,
      };
    }

    // LEGAL & REGULATORY TOOLS
    case "query_legal_database": {
      const { jurisdiction, topic, keywords, include_case_law, include_statutes, max_results } = args;
      console.log(`Querying legal database: ${jurisdiction} - ${topic}`);
      
      const { data, error } = await supabaseClient.functions.invoke("query-legal-database", {
        body: { jurisdiction, topic, keywords, include_case_law, include_statutes, max_results }
      });
      
      if (error) {
        console.error("Error querying legal database:", error);
        return { error: error.message, message: `Failed to query legal database: ${error.message}` };
      }
      return data;
    }

    case "retrieve_regulatory_document": {
      const { jurisdiction, document_name, section_or_part, document_type } = args;
      console.log(`Retrieving regulatory document: ${jurisdiction} - ${document_name}`);
      
      const { data, error } = await supabaseClient.functions.invoke("retrieve-regulatory-document", {
        body: { jurisdiction, document_name, section_or_part, document_type }
      });
      
      if (error) {
        console.error("Error retrieving regulatory document:", error);
        return { error: error.message, message: `Failed to retrieve document: ${error.message}` };
      }
      return data;
    }

    case "access_industry_standards": {
      const { industry, standard_type, focus_area, include_best_practices } = args;
      console.log(`Accessing industry standards: ${industry}`);
      
      const { data, error } = await supabaseClient.functions.invoke("access-industry-standards", {
        body: { industry, standard_type, focus_area, include_best_practices }
      });
      
      if (error) {
        console.error("Error accessing industry standards:", error);
        return { error: error.message, message: `Failed to access standards: ${error.message}` };
      }
      return data;
    }

    case "review_client_policy": {
      const { client_id, client_name, policy_name, policy_type, analysis_type } = args;
      console.log(`Reviewing client policy: ${client_id || client_name}`);
      
      const { data, error } = await supabaseClient.functions.invoke("review-client-policy", {
        body: { client_id, client_name, policy_name, policy_type, analysis_type }
      });
      
      if (error) {
        console.error("Error reviewing client policy:", error);
        return { error: error.message, message: `Failed to review policy: ${error.message}` };
      }
      return data;
    }

    case "create_agent": {
      const {
        header_name,
        codename,
        call_sign,
        persona,
        specialty,
        mission_scope,
        interaction_style,
        input_sources,
        output_types,
        is_client_facing,
        is_active,
        avatar_color,
        system_prompt,
        requested_by,
      } = args;

      console.log(`Creating new agent: ${header_name || codename} (${call_sign})`);

      // IMPORTANT: Avoid supabaseClient.functions.invoke() here.
      // functions.invoke throws FunctionsHttpError on non-2xx which often gets surfaced as a generic
      // "Edge Function returned a non-2xx status code" without the JSON body.
      // We use fetch so we can always return the actual status + body to the agent.
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        return {
          error: "Missing backend configuration",
          message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
          status: 500,
        };
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          header_name,
          codename,
          call_sign,
          persona,
          specialty,
          mission_scope,
          interaction_style,
          input_sources,
          output_types,
          is_client_facing,
          is_active,
          avatar_color,
          system_prompt,
          requested_by,
        }),
      });

      const rawText = await res.text();
      let body: any = null;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        body = { raw: rawText };
      }

      if (!res.ok) {
        console.error("create-agent non-2xx response:", res.status, body);
        return {
          success: false,
          status: res.status,
          ...body,
          message: body?.message || body?.error || `create-agent failed (${res.status})`,
        };
      }


      // Defensive verification: ensure the agent actually exists in the database.
      // Use service-role client for verification to bypass RLS (user may not have admin role).
      const createdId = body?.agent?.id || body?.agent_id || body?.id;
      if (createdId) {
        const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: verify, error: verifyError } = await serviceClient
          .from("ai_agents")
          .select("id, header_name, codename, call_sign")
          .eq("id", createdId)
          .maybeSingle();

        if (verifyError || !verify) {
          console.error("create-agent verification failed:", { createdId, verifyError, body });
          return {
            success: false,
            status: 502,
            error: "Agent creation not persisted",
            message:
              "The backend reported success, but the agent record was not found when verified. Please retry provisioning.",
            create_agent_response: body,
          };
        }

        console.log(`Agent verified in database: ${verify.header_name || verify.codename} (${verify.call_sign}) - ID: ${verify.id}`);
      }

      return body;
    }

    case "query_fortress_data": {
      const { query_type, filters = {}, output_format = 'detailed', reason_for_access } = args;
      
      if (!reason_for_access) {
        return { error: "reason_for_access is required for audit purposes" };
      }

      console.log(`Executing query_fortress_data: ${query_type}, reason: ${reason_for_access}`);
      
      // Log access for audit
      await supabaseClient.from('intelligence_config').upsert({
        key: `fortress_data_access_${Date.now()}`,
        value: {
          query_type,
          filters,
          reason: reason_for_access,
          agent_id: 'aegis',
          timestamp: new Date().toISOString()
        },
        description: 'Fortress data access audit log'
      });

      const limit = filters.limit || 100;
      const results: Record<string, any> = {};

      // Helper function for common filters
      const applyFilters = (query: any) => {
        if (filters.client_id) {
          query = query.eq('client_id', filters.client_id);
        }
        if (filters.time_range?.start) {
          query = query.gte('created_at', filters.time_range.start);
        }
        if (filters.time_range?.end) {
          query = query.lte('created_at', filters.time_range.end);
        }
        return query.limit(limit);
      };

      // Query signals
      if (query_type === 'signals' || query_type === 'comprehensive') {
        let signalsQ = supabaseClient.from('signals').select('id, title, description, severity, status, received_at, client_id, clients(name), normalized_text, category, source_url, raw_json');
        signalsQ = applyFilters(signalsQ);
        if (filters.severity?.length) signalsQ = signalsQ.in('severity', filters.severity);
        if (filters.status?.length) signalsQ = signalsQ.in('status', filters.status);
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `normalized_text.ilike.%${k}%`).join(',');
          signalsQ = signalsQ.or(kf);
        }
        const { data: sigData } = await signalsQ.order('received_at', { ascending: false });
        results.signals = sigData || [];
      }

      // Query incidents
      if (query_type === 'incidents' || query_type === 'comprehensive') {
        let incQ = supabaseClient.from('incidents').select('id, title, priority, status, severity_level, opened_at, client_id, clients(name), summary');
        incQ = applyFilters(incQ);
        if (filters.priority?.length) incQ = incQ.in('priority', filters.priority);
        if (filters.status?.length) incQ = incQ.in('status', filters.status);
        const { data: incData } = await incQ.order('opened_at', { ascending: false });
        results.incidents = incData || [];
      }

      // Query entities
      if (query_type === 'entities' || query_type === 'comprehensive') {
        let entQ = supabaseClient.from('entities').select('id, name, type, description, risk_level, threat_score, current_location, aliases');
        if (filters.client_id) entQ = entQ.eq('client_id', filters.client_id);
        if (filters.entity_id) entQ = entQ.eq('id', filters.entity_id);
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `name.ilike.%${k}%`).join(',');
          entQ = entQ.or(kf);
        }
        const { data: entData } = await entQ.limit(limit).order('updated_at', { ascending: false });
        results.entities = entData || [];
      }

      // Query clients
      if (query_type === 'clients' || query_type === 'comprehensive') {
        let clientQ = supabaseClient.from('clients').select('id, name, industry, status, locations, monitoring_keywords, high_value_assets');
        if (filters.client_id) clientQ = clientQ.eq('id', filters.client_id);
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `name.ilike.%${k}%`).join(',');
          clientQ = clientQ.or(kf);
        }
        const { data: clientData } = await clientQ.limit(limit);
        results.clients = clientData || [];
      }

      // Query documents
      if (query_type === 'documents' || query_type === 'comprehensive') {
        let docQ = supabaseClient.from('archival_documents').select('id, filename, summary, content_text, file_type, created_at, client_id, keywords, tags');
        docQ = applyFilters(docQ);
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `content_text.ilike.%${k}%,summary.ilike.%${k}%,filename.ilike.%${k}%`).join(',');
          docQ = docQ.or(kf);
        }
        const { data: docData } = await docQ.order('created_at', { ascending: false });
        results.documents = docData || [];
      }

      // Query investigations
      if (query_type === 'investigations' || query_type === 'comprehensive') {
        let invQ = supabaseClient.from('investigations').select('id, file_number, synopsis, file_status, created_at, client_id, information, recommendations');
        invQ = applyFilters(invQ);
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `synopsis.ilike.%${k}%,information.ilike.%${k}%`).join(',');
          invQ = invQ.or(kf);
        }
        const { data: invData } = await invQ.order('created_at', { ascending: false });
        results.investigations = invData || [];
      }

      // Query AI agents
      if (query_type === 'agents' || query_type === 'comprehensive') {
        let agentQ = supabaseClient.from('ai_agents').select('id, call_sign, codename, header_name, specialty, mission_scope, persona, interaction_style, is_active, is_client_facing, input_sources, output_types, avatar_color, created_at');
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `call_sign.ilike.%${k}%,codename.ilike.%${k}%,specialty.ilike.%${k}%`).join(',');
          agentQ = agentQ.or(kf);
        }
        if (filters.is_active !== undefined) {
          agentQ = agentQ.eq('is_active', filters.is_active);
        }
        const { data: agentData } = await agentQ.limit(limit).order('created_at', { ascending: false });
        results.agents = agentData || [];
      }

      // Query knowledge base
      if (query_type === 'knowledge_base' || query_type === 'comprehensive') {
        let kbQ = supabaseClient.from('knowledge_base_articles').select('id, title, summary, content, category_id, tags, created_at');
        if (filters.keywords?.length) {
          const kf = filters.keywords.map((k: string) => `title.ilike.%${k}%,content.ilike.%${k}%`).join(',');
          kbQ = kbQ.or(kf);
        }
        const { data: kbData } = await kbQ.limit(limit).order('updated_at', { ascending: false });
        results.knowledge_base = kbData || [];
      }

      // Query monitoring history
      if (query_type === 'monitoring_history' || query_type === 'comprehensive') {
        let monQ = supabaseClient.from('monitoring_history').select('id, source_name, status, scan_started_at, scan_completed_at, signals_created, error_message');
        if (filters.time_range?.start) monQ = monQ.gte('scan_started_at', filters.time_range.start);
        if (filters.time_range?.end) monQ = monQ.lte('scan_started_at', filters.time_range.end);
        if (filters.status?.length) monQ = monQ.in('status', filters.status);
        const { data: monData } = await monQ.limit(limit).order('scan_started_at', { ascending: false });
        results.monitoring_history = monData || [];
      }

      // Query travel (itineraries)
      if (query_type === 'travel' || query_type === 'comprehensive') {
        let travelQ = supabaseClient
          .from('itineraries')
          .select(
            'id, trip_name, trip_type, traveler_id, travelers(name, email), origin_city, origin_country, destination_country, destination_city, departure_date, return_date, risk_level, status, file_path',
          );
        travelQ = applyFilters(travelQ);
        if (filters.keywords?.length) {
          const kf = filters.keywords
            .map(
              (k: string) =>
                `destination_country.ilike.%${k}%,destination_city.ilike.%${k}%,origin_country.ilike.%${k}%,origin_city.ilike.%${k}%,trip_name.ilike.%${k}%`,
            )
            .join(',');
          travelQ = travelQ.or(kf);
        }

        const { data: travelData, error: travelError } = await travelQ
          .order('departure_date', { ascending: false })
          .limit(limit);

        if (travelError) {
          console.error('[query_fortress_data] travel query error:', travelError);
          throw travelError;
        }

        console.log(`[query_fortress_data] travel itineraries returned: ${travelData?.length || 0}`);

        // Attach short-lived signed URLs for itinerary documents when available
        const travelWithLinks = await Promise.all(
          (travelData || []).map(async (it: any) => {
            if (!it?.file_path) return it;

            const { data: signedData, error: signedError } = await supabaseClient.storage
              .from('travel-documents')
              .createSignedUrl(it.file_path, 60 * 10);

            if (signedError || !signedData?.signedUrl) {
              return { ...it, itinerary_file: { path: it.file_path, signed_url: null } };
            }

            return { ...it, itinerary_file: { path: it.file_path, signed_url: signedData.signedUrl } };
          }),
        );

        results.travel = travelWithLinks;
      }

      // Format output
      if (output_format === 'summary') {
        return {
          success: true,
          query_type,
          timestamp: new Date().toISOString(),
          reason_for_access,
          summary: {
            signals_count: results.signals?.length || 0,
            incidents_count: results.incidents?.length || 0,
            entities_count: results.entities?.length || 0,
            clients_count: results.clients?.length || 0,
            documents_count: results.documents?.length || 0,
            investigations_count: results.investigations?.length || 0,
            knowledge_base_count: results.knowledge_base?.length || 0,
            monitoring_history_count: results.monitoring_history?.length || 0,
            travel_count: results.travel?.length || 0,
            agents_count: results.agents?.length || 0,
          },
          filters_applied: filters,
          data: results
        };
      } else {
        return {
          success: true,
          query_type,
          timestamp: new Date().toISOString(),
          reason_for_access,
          filters_applied: filters,
          data: results,
          metadata: {
            total_records: Object.values(results).reduce((acc: number, arr: any) => acc + (arr?.length || 0), 0),
            query_types_included: Object.keys(results).filter(k => results[k]?.length > 0)
          }
        };
      }
    }

    case "query_internal_context": {
      const { 
        query_type, 
        asset_id, 
        asset_name, 
        asset_type, 
        vulnerability_id, 
        business_criticality_level, 
        keywords, 
        client_id, 
        limit = 10 
      } = args;

      console.log(`Executing query_internal_context: ${query_type}`, JSON.stringify(args));

      // Build base query for assets with vulnerabilities
      let assetsQuery = supabaseClient
        .from('internal_assets')
        .select(`
          id,
          asset_name,
          asset_type,
          description,
          location,
          owner_team,
          business_criticality,
          configuration_details,
          network_segment,
          cloud_provider,
          cloud_service,
          is_internet_facing,
          is_active,
          last_patched_date,
          last_scanned,
          tags,
          metadata,
          asset_vulnerabilities (
            id,
            vulnerability_id,
            severity,
            cvss_score,
            description,
            affected_component,
            is_active_exploit_known,
            remediation_status,
            discovered_at
          )
        `)
        .eq('is_active', true);

      // Apply filters
      if (asset_id) {
        assetsQuery = assetsQuery.eq('id', asset_id);
      }

      if (asset_name) {
        assetsQuery = assetsQuery.ilike('asset_name', `%${asset_name}%`);
      }

      if (asset_type) {
        assetsQuery = assetsQuery.eq('asset_type', asset_type);
      }

      if (business_criticality_level) {
        assetsQuery = assetsQuery.eq('business_criticality', business_criticality_level);
      }

      if (client_id) {
        assetsQuery = assetsQuery.eq('client_id', client_id);
      }

      if (keywords && keywords.length > 0) {
        const keywordFilters = keywords.map((kw: string) => 
          `asset_name.ilike.%${kw}%,description.ilike.%${kw}%`
        ).join(',');
        assetsQuery = assetsQuery.or(keywordFilters);
      }

      // If querying by vulnerability_id, find affected assets first
      if (vulnerability_id) {
        const { data: vulnData } = await supabaseClient
          .from('asset_vulnerabilities')
          .select('asset_id')
          .ilike('vulnerability_id', `%${vulnerability_id}%`);

        if (vulnData && vulnData.length > 0) {
          const assetIds = [...new Set(vulnData.map((v: any) => v.asset_id))];
          assetsQuery = assetsQuery.in('id', assetIds);
        } else {
          return {
            query_type,
            results: [],
            summary: `No assets found with vulnerability ${vulnerability_id}`,
            total_count: 0,
            filters_applied: { vulnerability_id }
          };
        }
      }

      assetsQuery = assetsQuery.limit(limit);

      const { data: assetsData, error: assetsError } = await assetsQuery;

      if (assetsError) {
        console.error('[query_internal_context] Query error:', assetsError);
        throw assetsError;
      }

      // Transform results
      const results = (assetsData || []).map((asset: any) => {
        const configDetails = asset.configuration_details || {};
        
        return {
          asset_id: asset.id,
          asset_name: asset.asset_name,
          asset_type: asset.asset_type,
          description: asset.description,
          location: asset.location,
          owner_team: asset.owner_team,
          business_criticality: asset.business_criticality,
          configuration_details: {
            os: configDetails.os,
            software_installed: configDetails.software_installed || [],
            network_segment: asset.network_segment,
            cloud_provider_service: asset.cloud_provider ? `${asset.cloud_provider}/${asset.cloud_service || ''}` : undefined,
            last_patched_date: asset.last_patched_date,
            ...configDetails
          },
          known_vulnerabilities: (asset.asset_vulnerabilities || []).map((vuln: any) => ({
            vulnerability_id: vuln.vulnerability_id,
            severity: vuln.severity,
            cvss_score: vuln.cvss_score,
            description: vuln.description,
            is_active_exploit_known: vuln.is_active_exploit_known,
            remediation_status: vuln.remediation_status
          })),
          last_scanned: asset.last_scanned,
          tags: asset.tags || [],
          is_internet_facing: asset.is_internet_facing
        };
      });

      // Generate summary
      const totalAssets = results.length;
      const criticalAssets = results.filter((r: any) => r.business_criticality === 'mission_critical').length;
      const highAssets = results.filter((r: any) => r.business_criticality === 'high').length;
      const totalVulns = results.reduce((acc: number, r: any) => acc + r.known_vulnerabilities.length, 0);
      const criticalVulns = results.reduce((acc: number, r: any) => 
        acc + r.known_vulnerabilities.filter((v: any) => v.severity === 'critical').length, 0);
      const activeExploits = results.reduce((acc: number, r: any) => 
        acc + r.known_vulnerabilities.filter((v: any) => v.is_active_exploit_known).length, 0);
      const internetFacing = results.filter((r: any) => r.is_internet_facing).length;

      let summary = '';
      switch (query_type) {
        case 'assets':
          summary = `Found ${totalAssets} assets. ${criticalAssets} mission-critical, ${highAssets} high-criticality. ${internetFacing} internet-facing. ${totalVulns} total vulnerabilities.`;
          break;
        case 'vulnerabilities':
          summary = `Found ${totalAssets} assets with ${totalVulns} vulnerabilities. ${criticalVulns} critical. ${activeExploits} with active exploits. Prioritize internet-facing (${internetFacing}) and mission-critical (${criticalAssets}) systems.`;
          break;
        case 'business_criticality':
          summary = `Business criticality: ${criticalAssets} mission-critical, ${highAssets} high-criticality. ${totalVulns} combined vulnerabilities, ${criticalVulns} critical. ${activeExploits} with active exploits.`;
          break;
        case 'comprehensive':
          summary = `Comprehensive: ${totalAssets} assets. Criticality: ${criticalAssets} mission-critical, ${highAssets} high. Vulnerabilities: ${totalVulns} total, ${criticalVulns} critical, ${activeExploits} with exploits. Attack surface: ${internetFacing} internet-facing.`;
          break;
        default:
          summary = `Query completed with ${totalAssets} results.`;
      }

      return {
        query_type,
        results,
        summary,
        total_count: results.length,
        filters_applied: {
          asset_id,
          asset_name,
          asset_type,
          vulnerability_id,
          business_criticality_level,
          keywords,
          client_id,
          limit
        }
      };
    }

    case "manage_incident_ticket": {
      const {
        action,
        ticket_system_id,
        title,
        description,
        severity,
        priority,
        affected_assets,
        recommended_actions,
        assigned_team,
        status,
        client_id,
        signal_id,
        entity_ids,
        incident_type,
      } = args;

      console.log(`Executing manage_incident_ticket: action=${action}, title=${title || 'N/A'}`);

      // Call the dedicated edge function
      const { data: ticketResult, error: ticketError } = await supabaseClient.functions.invoke(
        "manage-incident-ticket",
        {
          body: {
            action,
            ticket_system_id,
            title,
            description,
            severity,
            priority,
            affected_assets: affected_assets || [],
            recommended_actions: recommended_actions || [],
            assigned_team,
            status,
            client_id,
            signal_id,
            entity_ids: entity_ids || [],
            incident_type,
            source: "Fortress AI (Aegis)",
          },
        }
      );

      if (ticketError) {
        console.error("[manage_incident_ticket] Error:", ticketError);
        return {
          status: "failure",
          message: `Failed to ${action} incident ticket: ${ticketError.message}`,
          ticket_id: ticket_system_id || "",
        };
      }

      return ticketResult;
    }

    case "analyze_threat_radar": {
      const { client_id, timeframe_hours = 168, focus_areas, include_predictions = true } = args;
      
      // Resolve client_id if it's a name
      let resolvedClientId = client_id;
      if (client_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)) {
        const { data: clientLookup } = await supabaseClient
          .from("clients")
          .select("id")
          .ilike("name", `%${client_id}%`)
          .limit(1)
          .single();
        if (clientLookup) resolvedClientId = clientLookup.id;
      }

      // Call the threat-radar-analysis edge function
      const { data: radarResult, error: radarError } = await supabaseClient.functions.invoke(
        "threat-radar-analysis",
        {
          body: {
            client_id: resolvedClientId,
            timeframe_hours,
            focus_areas: focus_areas || ['radical_activity', 'sentiment', 'precursors', 'infrastructure'],
            include_predictions,
            generate_snapshot: true
          },
        }
      );

      if (radarError) {
        console.error("[analyze_threat_radar] Error:", radarError);
        return {
          error: `Failed to analyze threat radar: ${radarError.message}`,
          threat_assessment: { overall_level: "unknown", overall_score: 0 }
        };
      }

      // Format response for AI consumption
      const assessment = radarResult?.threat_assessment || {};
      const predictions = radarResult?.predictions || {};
      const intelligence = radarResult?.intelligence_summary || {};

      return {
        timestamp: radarResult?.timestamp,
        threat_assessment: {
          overall_level: assessment.overall_level || "unknown",
          overall_score: assessment.overall_score || 0,
          scores: assessment.scores || {},
          interpretation: assessment.overall_score >= 70 ? "CRITICAL - Immediate attention required" :
                         assessment.overall_score >= 50 ? "HIGH - Elevated threat environment" :
                         assessment.overall_score >= 30 ? "MODERATE - Enhanced monitoring recommended" :
                         "LOW - Normal operations"
        },
        predictions: {
          escalation_probability: predictions.escalation_probability || 0,
          predicted_timeframe: predictions.predicted_timeframe || "unknown",
          ai_assessment: predictions.ai_assessment?.substring(0, 3000) || "No prediction available"
        },
        intelligence_summary: {
          total_signals: intelligence.total_signals || 0,
          dark_web_signals: intelligence.dark_web_signals || 0,
          radical_signals: intelligence.radical_signals || 0,
          infrastructure_signals: intelligence.infrastructure_signals || 0,
          social_media_signals: intelligence.social_media_signals || 0
        },
        high_threat_entities: (radarResult?.high_threat_entities || []).slice(0, 5).map((e: any) => ({
          name: e.name,
          type: e.type,
          threat_score: e.threat_score,
          risk_level: e.risk_level
        })),
        critical_assets: (radarResult?.critical_assets || []).slice(0, 5).map((a: any) => ({
          name: a.asset_name,
          type: a.asset_type,
          criticality: a.business_criticality,
          location: a.location
        })),
        top_alerts: (radarResult?.top_alerts || []).slice(0, 5),
        geo_hotspots: (radarResult?.geo_intelligence?.hotspots || []).slice(0, 5),
        recommended_actions: [
          ...(assessment.scores?.radical_activity >= 50 ? ["Increase dark web channel monitoring"] : []),
          ...(assessment.scores?.infrastructure_risk >= 50 ? ["Deploy additional security to critical assets"] : []),
          ...(assessment.scores?.sentiment_volatility >= 50 ? ["Activate social media monitoring surge"] : []),
          ...(assessment.scores?.precursor_activity >= 50 ? ["Brief leadership on emerging threats"] : [])
        ],
        snapshot_id: radarResult?.snapshot_id
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DARK WEB & BREACH INTELLIGENCE EXECUTION HANDLERS
    // ══════════════════════════════════════════════════════════════════════════
    case "check_dark_web_exposure": {
      const { email, person_name, include_paste_check = true } = args;
      
      if (!email) {
        return { error: "Email address is required for breach check" };
      }
      
      console.log(`[check_dark_web_exposure] Checking breaches for: ${email}`);
      
      const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
      const breaches: any[] = [];
      let pasteExposure: any = null;
      let riskLevel = "low";
      
      // Check HIBP for breaches
      if (HIBP_API_KEY) {
        try {
          const hibpResponse = await fetch(
            `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
            {
              headers: {
                "hibp-api-key": HIBP_API_KEY,
                "user-agent": "Fortress-AEGIS",
              },
            }
          );
          
          if (hibpResponse.ok) {
            const breachData = await hibpResponse.json();
            for (const breach of breachData) {
              const dataClasses = breach.DataClasses || [];
              const hasCriticalData = dataClasses.some((dc: string) => 
                /password|credit|financial|ssn|social security|passport|bank/i.test(dc)
              );
              
              breaches.push({
                name: breach.Name,
                title: breach.Title,
                date: breach.BreachDate,
                data_exposed: dataClasses.slice(0, 8),
                is_sensitive: breach.IsSensitive,
                has_critical_data: hasCriticalData,
                affected_accounts: breach.PwnCount,
              });
              
              if (hasCriticalData) riskLevel = "critical";
              else if (breach.IsSensitive && riskLevel !== "critical") riskLevel = "critical";
              else if (riskLevel !== "critical") riskLevel = "high";
            }
          } else if (hibpResponse.status !== 404) {
            console.error(`[check_dark_web_exposure] HIBP error: ${hibpResponse.status}`);
          }
        } catch (e) {
          console.error("[check_dark_web_exposure] HIBP fetch error:", e);
        }
        
        // Check paste sites
        if (include_paste_check) {
          try {
            // Rate limit delay
            await new Promise(r => setTimeout(r, 1600));
            
            const pasteResponse = await fetch(
              `https://haveibeenpwned.com/api/v3/pasteaccount/${encodeURIComponent(email)}`,
              {
                headers: {
                  "hibp-api-key": HIBP_API_KEY,
                  "user-agent": "Fortress-AEGIS",
                },
              }
            );
            
            if (pasteResponse.ok) {
              const pastes = await pasteResponse.json();
              pasteExposure = {
                found: true,
                count: pastes.length,
                sources: [...new Set(pastes.map((p: any) => p.Source || "Unknown"))],
                recent_date: pastes[0]?.Date || null,
              };
              if (pastes.length > 0) riskLevel = "critical";
            } else if (pasteResponse.status === 404) {
              pasteExposure = { found: false, count: 0 };
            }
          } catch (e) {
            console.error("[check_dark_web_exposure] Paste check error:", e);
          }
        }
      } else {
        return {
          error: "HIBP_API_KEY not configured",
          message: "Dark web breach checking requires Have I Been Pwned API key. Please configure it in secrets.",
        };
      }
      
      // Generate recommendations based on findings
      const recommendations: string[] = [];
      if (breaches.length > 0) {
        recommendations.push("Immediately reset passwords for all accounts using this email");
        recommendations.push("Enable multi-factor authentication everywhere possible");
        if (breaches.some(b => b.has_critical_data)) {
          recommendations.push("Monitor financial accounts and credit reports for suspicious activity");
          recommendations.push("Consider identity theft protection service");
        }
      }
      if (pasteExposure?.found) {
        recommendations.push("Assume credentials are compromised - change ALL passwords");
        recommendations.push("Check for unauthorized account access across all services");
      }
      if (breaches.length === 0 && !pasteExposure?.found) {
        recommendations.push("No breaches detected, but continue monitoring");
        recommendations.push("Use unique passwords for each service");
      }
      
      return {
        email_checked: email,
        person_name: person_name || null,
        breach_count: breaches.length,
        breaches: breaches.slice(0, 10),
        paste_exposure: pasteExposure,
        risk_level: riskLevel,
        risk_summary: breaches.length === 0 ? "No known breaches found" :
          `Found ${breaches.length} breach(es). ${breaches.filter(b => b.has_critical_data).length} contain critical data (passwords/financial).`,
        recommendations,
        checked_at: new Date().toISOString(),
      };
    }

    case "run_vip_deep_scan": {
      const { name, email, location, industry, social_handles } = args;
      
      if (!name) {
        return { error: "Name is required for VIP deep scan" };
      }
      
      console.log(`[run_vip_deep_scan] Initiating deep scan for: ${name}`);
      
      // Call the vip-osint-discovery function (returns streaming SSE, but we'll parse it)
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      try {
        const scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/vip-osint-discovery`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            name,
            email,
            location,
            industry,
            socialMediaHandles: social_handles,
          }),
        });
        
        if (!scanResponse.ok) {
          const errorText = await scanResponse.text();
          console.error("[run_vip_deep_scan] Error:", errorText);
          return {
            error: `Deep scan failed: ${scanResponse.status}`,
            details: errorText.substring(0, 200),
          };
        }
        
        // Parse SSE stream to extract final results
        const text = await scanResponse.text();
        const lines = text.split("\n").filter(l => l.startsWith("data: "));
        
        const discoveries: any[] = [];
        const threatVectors: any[] = [];
        const exposureTiers: any[] = [];
        let terrainSummary: any = null;
        let executiveSummary = "";
        let totalDiscoveries = 0;
        
        for (const line of lines) {
          try {
            const jsonStr = line.replace("data: ", "").trim();
            if (jsonStr === "[DONE]") continue;
            
            const event = JSON.parse(jsonStr);
            
            switch (event.type) {
              case "discovery":
                discoveries.push({
                  type: event.data.type,
                  label: event.data.label,
                  source: event.data.source,
                  confidence: event.data.confidence,
                  risk_level: event.data.riskLevel,
                  category: event.data.category,
                });
                break;
              case "threat_vector":
                threatVectors.push(event.data);
                break;
              case "exposure_tier":
                exposureTiers.push(event.data);
                break;
              case "terrain_summary":
                terrainSummary = event.data;
                break;
              case "executive_summary":
                executiveSummary = event.data.summary;
                break;
              case "done":
                totalDiscoveries = event.data.totalDiscoveries;
                break;
            }
          } catch {
            // Skip unparseable lines
          }
        }
        
        // Summarize findings by category
        const byCategory = discoveries.reduce((acc: any, d) => {
          const cat = d.category || "other";
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {});
        
        const breachDiscoveries = discoveries.filter(d => d.type === "breach");
        const threatDiscoveries = discoveries.filter(d => d.type === "threat");
        const socialDiscoveries = discoveries.filter(d => d.type === "social_media");
        
        return {
          subject: name,
          scan_complete: true,
          total_discoveries: totalDiscoveries || discoveries.length,
          summary_by_category: byCategory,
          terrain_scores: terrainSummary ? {
            identity_visibility: terrainSummary.identityVisibility,
            physical_exposure: terrainSummary.physicalExposure,
            digital_attack_surface: terrainSummary.digitalAttackSurface,
            operational_dependencies: terrainSummary.operationalDependencies,
          } : null,
          breach_findings: {
            count: breachDiscoveries.length,
            items: breachDiscoveries.slice(0, 5).map(d => ({ label: d.label, source: d.source })),
          },
          social_media_presence: {
            count: socialDiscoveries.length,
            platforms: socialDiscoveries.slice(0, 5).map(d => d.label),
          },
          threat_vectors: threatVectors.slice(0, 5),
          top_exposures: exposureTiers.filter((e: any) => e.tier === 1).slice(0, 3),
          executive_summary: executiveSummary || "Deep scan completed. Review discoveries for detailed findings.",
          recommendations: [
            ...(breachDiscoveries.length > 0 ? ["Immediate password reset required for compromised accounts"] : []),
            ...(threatVectors.length > 0 ? ["Review threat vectors for protective intelligence planning"] : []),
            ...(terrainSummary?.physicalExposure > 50 ? ["Physical security review recommended due to location exposure"] : []),
          ],
        };
      } catch (e) {
        console.error("[run_vip_deep_scan] Exception:", e);
        return {
          error: `Deep scan exception: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    }

    case "get_threat_intel_feeds": {
      const { industry_filter, severity_filter = "all", limit = 10 } = args;
      
      console.log(`[get_threat_intel_feeds] Fetching threat intelligence feeds`);
      
      const vulnerabilities: any[] = [];
      
      // Fetch CISA KEV Catalog
      try {
        const cisaResponse = await fetch(
          "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
          { signal: AbortSignal.timeout(15000) }
        );
        
        if (cisaResponse.ok) {
          const cisaData = await cisaResponse.json();
          let vulns = cisaData.vulnerabilities || [];
          
          // Filter by severity if specified
          if (severity_filter === "critical") {
            vulns = vulns.filter((v: any) => v.cveID.includes("CRITICAL") || v.shortDescription?.toLowerCase().includes("critical"));
          }
          
          // Take most recent
          vulns = vulns.slice(0, limit);
          
          for (const vuln of vulns) {
            vulnerabilities.push({
              cve_id: vuln.cveID,
              vendor: vuln.vendorProject,
              product: vuln.product,
              name: vuln.vulnerabilityName,
              description: vuln.shortDescription,
              date_added: vuln.dateAdded,
              due_date: vuln.dueDate,
              required_action: vuln.requiredAction,
              source: "CISA KEV",
            });
          }
        }
      } catch (e) {
        console.error("[get_threat_intel_feeds] CISA fetch error:", e);
      }
      
      // Industry relevance analysis
      let industryRelevance: string[] = [];
      if (industry_filter) {
        const industryLower = industry_filter.toLowerCase();
        industryRelevance = vulnerabilities
          .filter((v: any) => {
            const text = `${v.vendor} ${v.product} ${v.description}`.toLowerCase();
            if (industryLower.includes("energy")) return text.includes("scada") || text.includes("ics") || text.includes("industrial");
            if (industryLower.includes("finance")) return text.includes("banking") || text.includes("payment");
            if (industryLower.includes("health")) return text.includes("medical") || text.includes("healthcare");
            return true;
          })
          .map((v: any) => v.cve_id);
      }
      
      return {
        feed_source: "CISA Known Exploited Vulnerabilities",
        vulnerabilities_count: vulnerabilities.length,
        vulnerabilities: vulnerabilities.slice(0, limit),
        industry_filter: industry_filter || "all",
        industry_relevant: industryRelevance.length > 0 ? industryRelevance : null,
        recommendations: [
          "Prioritize patching systems with internet exposure",
          "Verify remediation status against due dates",
          "Cross-reference with internal asset inventory",
        ],
        fetched_at: new Date().toISOString(),
      };
    }

    case "run_entity_deep_scan": {
      const { entity_id, entity_name } = args;
      
      if (!entity_id && !entity_name) {
        return { error: "Either entity_id or entity_name is required" };
      }
      
      console.log(`[run_entity_deep_scan] Initiating deep scan for: ${entity_id || entity_name}`);
      
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      let targetEntityId = entity_id;
      
      // If only name provided, find the entity first
      if (!targetEntityId && entity_name) {
        const { data: foundEntity, error: findError } = await supabaseClient
          .from("entities")
          .select("id, name, type")
          .ilike("name", `%${entity_name}%`)
          .limit(1)
          .single();
          
        if (findError || !foundEntity) {
          return { 
            error: `Entity not found: ${entity_name}`,
            suggestion: "Use get_entities to list available entities first"
          };
        }
        
        targetEntityId = foundEntity.id;
        console.log(`[run_entity_deep_scan] Resolved entity: ${foundEntity.name} (${foundEntity.id})`);
      }
      
      try {
        const scanResponse = await fetch(`${SUPABASE_URL}/functions/v1/entity-deep-scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ entity_id: targetEntityId }),
        });
        
        if (!scanResponse.ok) {
          const errorText = await scanResponse.text();
          console.error("[run_entity_deep_scan] Error:", errorText);
          return {
            error: `Entity deep scan failed: ${scanResponse.status}`,
            details: errorText.substring(0, 200),
          };
        }
        
        const scanResult = await scanResponse.json();
        
        // Categorize findings
        const findingsByCategory: Record<string, number> = {};
        const criticalFindings: any[] = [];
        const highFindings: any[] = [];
        
        for (const finding of scanResult.findings || []) {
          const cat = finding.category || "other";
          findingsByCategory[cat] = (findingsByCategory[cat] || 0) + 1;
          
          if (finding.riskLevel === "critical") {
            criticalFindings.push({ label: finding.label, source: finding.source });
          } else if (finding.riskLevel === "high") {
            highFindings.push({ label: finding.label, source: finding.source });
          }
        }
        
        return {
          entity_id: targetEntityId,
          entity_name: scanResult.entity_name,
          scan_complete: true,
          total_findings: scanResult.findings_count,
          critical_count: scanResult.critical_count,
          high_count: scanResult.high_count,
          overall_risk: scanResult.overall_risk,
          updated_threat_score: scanResult.updated_threat_score,
          findings_by_category: findingsByCategory,
          critical_findings: criticalFindings.slice(0, 5),
          high_findings: highFindings.slice(0, 5),
          categories_scanned: scanResult.categories,
          recommendations: [
            ...(scanResult.critical_count > 0 ? ["IMMEDIATE ACTION: Review critical findings for breach response"] : []),
            ...(scanResult.high_count > 0 ? ["Review high-risk findings and update entity risk profile"] : []),
            "Update entity relationships based on discovered connections",
            "Schedule follow-up scan in 30 days",
          ],
          scanned_at: new Date().toISOString(),
        };
      } catch (e) {
        console.error("[run_entity_deep_scan] Exception:", e);
        return {
          error: `Entity deep scan exception: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    }

    case "perform_external_web_search": {
      const { query, time_range, geographic_focus, language, max_results } = args;
      
      if (!query) {
        return { error: "Query is required for web search" };
      }

      console.log(`[perform_external_web_search] Executing search for: "${query}"`);
      
      // Call the dedicated edge function
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
      
      const searchResponse = await fetch(`${SUPABASE_URL}/functions/v1/perform-external-web-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          query,
          time_range,
          geographic_focus,
          language: language || "en",
          max_results: Math.min(max_results || 5, 10),
        }),
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error("[perform_external_web_search] Edge function error:", errorText);
        return { 
          error: `Web search failed: ${searchResponse.status}`,
          details: errorText
        };
      }

      const searchResult = await searchResponse.json();
      
      return {
        success: true,
        message: `OSINT web search completed for: "${query}"`,
        query_info: {
          original_query: query,
          geographic_focus: geographic_focus || "Global",
          time_range: time_range ? `${time_range.start || 'any'} to ${time_range.end || 'present'}` : "Last 12 months",
          results_returned: searchResult.source_urls?.length || 0
        },
        summary: searchResult.summary,
        sources: searchResult.source_urls?.slice(0, max_results || 5).map((s: any) => ({
          title: s.title,
          url: s.url,
          snippet: s.snippet,
          date: s.published_date
        })) || [],
        extracted_intelligence: {
          key_entities: searchResult.key_entities || [],
          key_dates: searchResult.key_dates || [],
          threat_indicators: searchResult.threat_indicators || [],
          geographic_relevance: searchResult.geographic_relevance || []
        },
        signal_created: true,
        note: "Search results have been stored as a signal for future reference"
      };
    }

    case "search_social_media": {
      const { query, platforms, time_filter, location } = args;
      
      if (!query) {
        return { error: "Query is required for social media search" };
      }

      console.log(`[search_social_media] Searching social media for: "${query}"`);
      
      const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
      if (!PERPLEXITY_API_KEY) {
        return { error: "Perplexity API key not configured — social media search unavailable" };
      }

      // Build platform-specific search queries
      const targetPlatforms = platforms?.includes("all") || !platforms ? ["twitter", "facebook", "instagram", "reddit"] : platforms;
      const platformSites = {
        twitter: "site:x.com OR site:twitter.com",
        facebook: "site:facebook.com",
        instagram: "site:instagram.com",
        reddit: "site:reddit.com",
      };
      
      const siteFilter = targetPlatforms
        .map((p: string) => platformSites[p as keyof typeof platformSites])
        .filter(Boolean)
        .join(" OR ");

      const locationContext = location ? ` near ${location}` : "";
      const searchQuery = `${query}${locationContext} (${siteFilter})`;
      
      // Map time_filter to Perplexity recency
      const recencyMap: Record<string, string> = { hour: "day", day: "day", week: "week", month: "month" };
      const recency = recencyMap[time_filter || "day"] || "day";

      try {
        const perplexityResponse = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content: `You are a social media intelligence analyst. Search for social media posts about the given topic. For each post found, extract: platform (X/Twitter, Facebook, Instagram, Reddit), author/handle, post content/summary, URL if available, approximate date, and sentiment (positive/negative/neutral/alarming). Focus on posts from real users discussing the topic. If you find no relevant posts, say so clearly.`
              },
              {
                role: "user",
                content: `Find social media posts about: ${query}${location ? ` Location focus: ${location}` : ""}. Search across: ${targetPlatforms.join(", ")}. Time range: last ${time_filter || "day"}.`
              }
            ],
            search_recency_filter: recency,
          }),
        });

        if (!perplexityResponse.ok) {
          const errText = await perplexityResponse.text();
          console.error("[search_social_media] Perplexity error:", errText);
          return { error: `Social media search failed: ${perplexityResponse.status}` };
        }

        const perplexityResult = await perplexityResponse.json();
        const content = perplexityResult.choices?.[0]?.message?.content || "No results found";
        const citations = perplexityResult.citations || [];

        // Store as a signal for reference
        const signalText = `Social Media Search: ${query}\n\n${content}`;
        await supabaseClient
          .from("signals")
          .insert({
            title: `Social Media Search: ${query.substring(0, 80)}`,
            normalized_text: signalText.substring(0, 5000),
            source: "social_media_search",
            severity: "info",
            status: "triaged",
            metadata: {
              search_query: query,
              platforms: targetPlatforms,
              time_filter: time_filter || "day",
              location: location || null,
              citations: citations,
              search_type: "on_demand_social_search"
            }
          });

        return {
          success: true,
          message: `Social media search completed for: "${query}"`,
          platforms_searched: targetPlatforms,
          time_range: time_filter || "last 24 hours",
          location_focus: location || "Global",
          results: content,
          source_urls: citations,
          note: "Results stored as an intelligence signal for reference. Scheduled monitors will continue to pick up new content in future scan cycles."
        };

      } catch (searchErr) {
        console.error("[search_social_media] Error:", searchErr);
        return { error: `Social media search failed: ${searchErr instanceof Error ? searchErr.message : "Unknown error"}` };
      }
    }

    case "run_data_quality_check": {
      const { data, error } = await supabaseClient.functions.invoke('data-quality-monitor', {
        body: { auto_fix: args.auto_fix || false, categories: args.categories || ['incident', 'entity', 'signal'] }
      });
      if (error) throw error;
      return data;
    }

    case "auto_summarize_incidents": {
      const { data, error } = await supabaseClient.functions.invoke('incident-manager', {
        body: { action: 'summarize', incident_id: args.incident_id, batch_mode: args.batch_mode || false, limit: args.limit || 20 }
      });
      if (error) throw error;
      return data;
    }

    case "enrich_entity_descriptions": {
      const { data, error } = await supabaseClient.functions.invoke('auto-enrich-entities', {
        body: { entity_id: args.entity_id, batch_mode: args.batch_mode || false, auto_apply: args.auto_apply || false, limit: args.limit || 10 }
      });
      if (error) throw error;
      return data;
    }

    case "extract_signal_insights": {
      const { data, error } = await supabaseClient.functions.invoke('signal-processor', {
        body: { action: 'extract-insights', signal_id: args.signal_id, batch_mode: args.batch_mode || false, limit: args.limit || 10 }
      });
      if (error) throw error;
      return data;
    }

    case "search_chat_history": {
      const limit = args.limit || 50;
      const includeContext = args.include_context !== false;
      
      // Get all non-deleted messages for the current user
      let query = supabaseClient
        .from("ai_assistant_messages")
        .select("id, role, content, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit * 2); // Get extra for context
      
      const { data: allMessages, error: fetchError } = await query;
      
      if (fetchError) throw fetchError;
      
      if (!allMessages || allMessages.length === 0) {
        return {
          message: "No chat history found.",
          results: []
        };
      }
      
      // If no search query, return recent messages
      if (!args.search_query || args.search_query.trim() === "") {
        const recentMessages = allMessages.slice(0, limit).reverse();
        return {
          message: `Found ${recentMessages.length} recent messages in chat history.`,
          results: recentMessages.map((m: any) => ({
            role: m.role,
            content: m.content.substring(0, 500) + (m.content.length > 500 ? "..." : ""),
            timestamp: m.created_at
          }))
        };
      }
      
      // Search for matching messages
      const searchTerms = args.search_query.toLowerCase().split(/\s+/);
      const matchingMessages: any[] = [];
      const matchingIndices: Set<number> = new Set();
      
      allMessages.forEach((msg: any, idx: number) => {
        const content = msg.content.toLowerCase();
        const matchScore = searchTerms.filter((term: string) => content.includes(term)).length;
        
        if (matchScore > 0) {
          matchingIndices.add(idx);
          matchingMessages.push({
            ...msg,
            matchScore,
            originalIndex: idx
          });
        }
      });
      
      // Sort by match score (best matches first), then by recency
      matchingMessages.sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      // Include context if requested (messages before and after matches)
      const contextMessages: any[] = [];
      if (includeContext && matchingMessages.length > 0) {
        matchingMessages.slice(0, 10).forEach((match: any) => {
          const idx = match.originalIndex;
          // Include 2 messages before and after for context
          for (let i = Math.max(0, idx - 2); i <= Math.min(allMessages.length - 1, idx + 2); i++) {
            if (!matchingIndices.has(i)) {
              contextMessages.push({
                ...allMessages[i],
                isContext: true
              });
            }
          }
        });
      }
      
      const results = matchingMessages.slice(0, limit).map((m: any) => ({
        role: m.role,
        content: m.content.substring(0, 800) + (m.content.length > 800 ? "..." : ""),
        timestamp: m.created_at,
        matchScore: m.matchScore,
        isMatch: true
      }));
      
      return {
        message: `Found ${matchingMessages.length} messages matching "${args.search_query}". Showing top ${results.length} results.`,
        search_query: args.search_query,
        total_matches: matchingMessages.length,
        results
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PERSISTENT MEMORY TOOL IMPLEMENTATIONS
    // ══════════════════════════════════════════════════════════════════════════
    case "get_user_memory": {
      // User ID should be passed in args from the handler
      const userId = args._user_id;
      if (!userId) {
        return {
          success: false,
          message: "No authenticated user found. Memory context requires authentication."
        };
      }
      
      try {
        const memoryContext = await fetchUserMemory(supabaseClient, userId, args.current_client_id);
        const formattedMemory = formatMemoryForPrompt(memoryContext, args.current_client_id);
        
        return {
          success: true,
          has_preferences: !!memoryContext.preferences,
          active_projects_count: memoryContext.activeProjects.length,
          global_memories_count: memoryContext.recentMemories.length,
          client_contexts_count: memoryContext.clientSpecificContext.length,
          formatted_context: formattedMemory || "No persistent memory found for this user yet.",
          raw_data: {
            preferences: memoryContext.preferences,
            projects: memoryContext.activeProjects.slice(0, 5),
            memories: memoryContext.recentMemories.slice(0, 10)
          }
        };
      } catch (err) {
        console.error("Error fetching user memory:", err);
        return {
          success: false,
          message: `Error retrieving memory: ${err instanceof Error ? err.message : 'Unknown error'}`
        };
      }
    }

    case "remember_this": {
      const userId = args._user_id;
      if (!userId) {
        return { success: false, message: "No authenticated user found." };
      }
      
      try {
        // Calculate expiry if expires_in_days is provided
        let expires_at: string | undefined;
        if (args.expires_in_days) {
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + args.expires_in_days);
          expires_at = expiryDate.toISOString();
        }
        
        const result = await saveMemory(supabaseClient, userId, {
          memory_type: args.memory_type,
          content: args.content,
          context_tags: args.context_tags || [],
          importance_score: args.importance_score || 5,
          client_id: args.client_id,
          expires_at
        });
        
        if (result.success) {
          return {
            success: true,
            message: `✓ Remembered: "${args.content.substring(0, 50)}${args.content.length > 50 ? '...' : ''}"`,
            memory_id: result.id,
            memory_type: args.memory_type,
            importance: args.importance_score || 5,
            expires: expires_at ? `in ${args.expires_in_days} days` : 'never'
          };
        } else {
          return { success: false, message: result.error };
        }
      } catch (err) {
        console.error("Error saving memory:", err);
        return { success: false, message: `Error saving memory: ${err instanceof Error ? err.message : 'Unknown error'}` };
      }
    }

    case "update_user_preferences": {
      const userId = args._user_id;
      if (!userId) {
        return { success: false, message: "No authenticated user found." };
      }
      
      try {
        const prefsToUpdate: any = {};
        if (args.communication_style) prefsToUpdate.communication_style = args.communication_style;
        if (args.preferred_format) prefsToUpdate.preferred_format = args.preferred_format;
        if (args.role_context) prefsToUpdate.role_context = args.role_context;
        if (args.timezone) prefsToUpdate.timezone = args.timezone;
        if (args.custom_preferences) prefsToUpdate.custom_preferences = args.custom_preferences;
        
        const result = await upsertPreferences(supabaseClient, userId, prefsToUpdate);
        
        if (result.success) {
          const updatedFields = Object.keys(prefsToUpdate).join(', ');
          return {
            success: true,
            message: `✓ Updated preferences: ${updatedFields}`,
            updated_fields: prefsToUpdate
          };
        } else {
          return { success: false, message: result.error };
        }
      } catch (err) {
        console.error("Error updating preferences:", err);
        return { success: false, message: `Error updating preferences: ${err instanceof Error ? err.message : 'Unknown error'}` };
      }
    }

    case "manage_project_context": {
      const userId = args._user_id;
      if (!userId) {
        return { success: false, message: "No authenticated user found." };
      }
      
      try {
        const action = args.action;
        
        if (action === "complete" || action === "pause") {
          if (!args.project_id) {
            return { success: false, message: "project_id required for complete/pause actions" };
          }
          
          const newStatus = action === "complete" ? "completed" : "on_hold";
          const { error } = await supabaseClient
            .from("user_project_context")
            .update({ current_status: newStatus, updated_at: new Date().toISOString() })
            .eq("id", args.project_id)
            .eq("user_id", userId);
          
          if (error) throw error;
          
          return {
            success: true,
            message: `✓ Project marked as ${newStatus}`,
            project_id: args.project_id,
            new_status: newStatus
          };
        }
        
        if (action === "create" || action === "update") {
          if (!args.project_name && !args.project_id) {
            return { success: false, message: "project_name required for create, or project_id for update" };
          }
          
          const result = await upsertProject(supabaseClient, userId, {
            id: args.project_id,
            project_name: args.project_name,
            project_description: args.project_description,
            current_status: "active",
            key_details: args.key_details || {},
            priority: args.priority || "medium",
            client_id: args.client_id
          });
          
          if (result.success) {
            return {
              success: true,
              message: `✓ Project ${action === "create" ? "created" : "updated"}: ${args.project_name}`,
              project_id: result.id,
              action: action
            };
          } else {
            return { success: false, message: result.error };
          }
        }
        
        return { success: false, message: `Unknown action: ${action}` };
      } catch (err) {
        console.error("Error managing project:", err);
        return { success: false, message: `Error managing project: ${err instanceof Error ? err.message : 'Unknown error'}` };
      }
    }

    case "get_global_learning_insights": {
      const { data: insights, error } = await supabaseClient
        .from("global_learning_insights")
        .select("*")
        .eq("is_active", true)
        .gte("confidence_score", args.min_confidence || 0.5)
        .order("confidence_score", { ascending: false })
        .limit(args.limit || 20);
      
      if (error) return { error: error.message };
      return { insights, count: insights?.length || 0, context: "Cross-tenant aggregated intelligence - anonymized patterns from all organizations" };
    }

    case "submit_learning_insight": {
      const { error } = await supabaseClient
        .from("global_learning_insights")
        .insert({
          insight_type: args.insight_type,
          category: args.category,
          insight_content: args.content,
          confidence_score: args.confidence || 0.6,
          metadata: { submitted_by_ai: true, submitted_at: new Date().toISOString() }
        });
      
      if (error) return { success: false, error: error.message };
      return { success: true, message: "Insight submitted to global knowledge base" };
    }

    case "get_cross_tenant_patterns": {
      let query = supabaseClient
        .from("cross_tenant_patterns")
        .select("*")
        .eq("is_active", true)
        .gte("affected_tenant_count", args.min_tenant_count || 1)
        .order("affected_tenant_count", { ascending: false })
        .limit(20);
      
      if (args.severity_trend) {
        query = query.eq("severity_trend", args.severity_trend);
      }
      
      const { data: patterns, error } = await query;
      if (error) return { error: error.message };
      return { patterns, count: patterns?.length || 0 };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRINCIPAL INTELLIGENCE SUITE TOOLS
    // ══════════════════════════════════════════════════════════════════════════

    case "get_principal_profile": {
      const { entity_id, entity_name } = args;
      
      let entity = null;
      if (entity_id) {
        const { data } = await supabaseClient.from("entities").select("*").eq("id", entity_id).single();
        entity = data;
      } else if (entity_name) {
        const { data } = await supabaseClient.from("entities").select("*").or("type.eq.person,type.eq.vip").ilike("name", `%${entity_name}%`).limit(1).single();
        entity = data;
      }
      if (!entity) return { error: "Principal entity not found" };

      const { data: relationships } = await supabaseClient.from("entity_relationships").select("*, entity_b:entity_b_id(id, name, type, risk_level)").eq("entity_a_id", entity.id);
      const { data: alertPrefs } = await supabaseClient.from("principal_alert_preferences").select("*").eq("entity_id", entity.id).maybeSingle();
      const { data: recentContent } = await supabaseClient.from("entity_content").select("id, title, sentiment, source, published_date").eq("entity_id", entity.id).order("published_date", { ascending: false }).limit(10);
      
      const attrs = entity.attributes || {};
      const familyMembers = (relationships || []).filter((r: any) => ["family", "spouse", "child", "parent"].includes(r.relationship_type?.toLowerCase())).map((r: any) => ({ name: r.entity_b?.name, relationship: r.relationship_type }));
      const adversaries = (relationships || []).filter((r: any) => ["adversary", "competitor", "threat"].includes(r.relationship_type?.toLowerCase())).map((r: any) => ({ name: r.entity_b?.name, threat_level: r.entity_b?.risk_level || "medium" }));

      return {
        profile_summary: { id: entity.id, name: entity.name, aliases: entity.aliases, risk_level: entity.risk_level, threat_score: entity.threat_score },
        travel_patterns: attrs.travel_patterns || {},
        properties: attrs.properties || [],
        known_adversaries: adversaries,
        family_members: familyMembers,
        digital_footprint: attrs.social_media || {},
        threat_profile: { specific_concerns: attrs.threat_concerns || [], industry_threats: attrs.industry_threats || [] },
        active_monitoring: { enabled: entity.active_monitoring_enabled, radius_km: entity.monitoring_radius_km },
        risk_appetite: alertPrefs ? { threshold: alertPrefs.alert_threshold, risk_appetite: alertPrefs.risk_appetite } : null,
        recent_sentiment: recentContent || []
      };
    }

    case "run_what_if_scenario": {
      const response = await supabaseClient.functions.invoke("run-what-if-scenario", { body: args });
      if (response.error) return { error: response.error.message };
      return response.data;
    }

    case "analyze_sentiment_drift": {
      const response = await supabaseClient.functions.invoke("intelligence-engine", { body: { action: 'sentiment-drift', ...args } });
      if (response.error) return { error: response.error.message };
      return response.data;
    }

    case "configure_principal_alerts": {
      const { entity_id, risk_appetite, alert_threshold, preferred_channels, quiet_hours } = args;
      if (!entity_id) return { error: "entity_id is required" };

      const updateData: any = { entity_id, updated_at: new Date().toISOString() };
      if (risk_appetite) updateData.risk_appetite = risk_appetite;
      if (alert_threshold) updateData.alert_threshold = alert_threshold;
      if (preferred_channels) updateData.preferred_channels = preferred_channels;
      if (quiet_hours) updateData.quiet_hours = quiet_hours;

      const { data, error } = await supabaseClient.from("principal_alert_preferences").upsert(updateData, { onConflict: "entity_id" }).select().single();
      if (error) return { error: error.message };
      return { success: true, message: "Alert preferences updated", preferences: data };
    }

    case "generate_report_visual": {
      const { types = ["header"], client_name: vizClientName, report_title, threat_categories = [], 
              locations = [], risk_level = "moderate", incident_types = [], period, custom_prompt, high_quality = false } = args;
      
      try {
        const { generateReportVisuals } = await import("../_shared/report-image-generator.ts");
        const requests = (types as string[]).map((type: string) => ({
          type: type as any,
          context: {
            clientName: vizClientName,
            reportTitle: report_title,
            threatCategories: threat_categories,
            locations,
            riskLevel: risk_level,
            incidentTypes: incident_types,
            period,
            customPrompt: custom_prompt,
          },
          highQuality: high_quality,
        }));

        const results = await generateReportVisuals(requests);
        const output: Record<string, any> = {};
        for (const [type, result] of results.entries()) {
          output[type] = {
            success: !!result.imageUrl || !!result.base64Url,
            url: result.imageUrl || result.base64Url,
            error: result.error,
            duration_ms: result.durationMs,
          };
        }
        return { 
          success: true, 
          visuals: output,
          message: `Generated ${Object.values(output).filter((v: any) => v.success).length}/${types.length} visuals successfully.`
        };
      } catch (err) {
        return { error: `Visual generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "generate_fortress_report": {
      const { report_type, client_name, period_days, city, country, travel_dates,
              bulletin_title, bulletin_html, bulletin_classification, generate_header_image, image_prompt, bulletin_images } = args;
      let { client_id } = args;

      // Resolve client_name to client_id if needed
      if (!client_id && client_name) {
        const { data: clientMatch } = await supabaseClient
          .from("clients")
          .select("id, name")
          .ilike("name", `%${client_name}%`)
          .limit(1)
          .single();
        if (clientMatch) {
          client_id = clientMatch.id;
        } else {
          return { error: `No client found matching "${client_name}". Please check the name and try again.` };
        }
      }

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

      // ═══════════════════════════════════════════════════════════════
      // SECURITY BULLETIN: Custom AI-composed bulletin with images
      // ═══════════════════════════════════════════════════════════════
      if (report_type === "security_bulletin") {
        if (!bulletin_title || !bulletin_html) {
          return { error: "bulletin_title and bulletin_html are required for security_bulletin reports. YOU must compose the bulletin content." };
        }

        try {
          const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          const reportId = crypto.randomUUID();
          const reportDate = new Date().toISOString().split("T")[0];
          const classification = bulletin_classification || "INTERNAL USE ONLY";
          const now = new Date();

          // Generate header image using Gemini Flash Image model
          let headerImageUrl = "";
          if (generate_header_image !== false ) {
            try {
              const imgPrompt = image_prompt || `A wide cinematic header image for a corporate security intelligence bulletin titled "${bulletin_title}". Dark moody atmosphere, deep navy and charcoal tones with subtle cyan accent lighting. Abstract geometric grid patterns suggesting digital surveillance networks and data analysis. No text, no words, no letters. Photorealistic, ultra high resolution, 16:9 aspect ratio.`;
              console.log("Generating bulletin header image via Gemini Flash Image...");
              
              const imgResponse = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${OPENAI_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "gpt-4o-mini-image",
                  messages: [{ role: "user", content: imgPrompt }],
                  modalities: ["image", "text"],
                }),
              });

              if (imgResponse.ok) {
                const imgData = await imgResponse.json();
                const base64Url = imgData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
                if (base64Url) {
                  // Upload to storage instead of embedding massive base64
                  try {
                    const base64Data = base64Url.replace(/^data:image\/\w+;base64,/, "");
                    const imgBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                    const imgPath = `reports/${reportId}/header.png`;
                    
                    const { error: imgUploadErr } = await serviceClient.storage
                      .from("osint-media")
                      .upload(imgPath, imgBytes, { contentType: "image/png", upsert: true });
                    
                    if (!imgUploadErr) {
                      const { data: pubUrl } = serviceClient.storage.from("osint-media").getPublicUrl(imgPath);
                      headerImageUrl = pubUrl?.publicUrl || base64Url;
                    } else {
                      headerImageUrl = base64Url; // fallback to inline base64
                    }
                    console.log("Header image generated and stored successfully");
                  } catch (uploadErr) {
                    headerImageUrl = base64Url; // fallback
                    console.log("Using inline base64 image (storage upload failed)");
                  }
                }
              } else {
                console.error("Image generation failed:", await imgResponse.text());
              }
            } catch (imgErr) {
              console.error("Non-fatal: Header image generation failed:", imgErr);
            }
          }

          // Build the full bulletin HTML document with Fortress branding
          const fortressLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 40" width="180" height="30">
  <defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#00d9ff"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient></defs>
  <path d="M4 8h6v24H4zM12 8h14v5H17v4h8v5h-8v10h-5zM30 8h14v5h-4.5v19h-5V13H30z" fill="url(#fg)"/>
  <text x="50" y="28" font-family="system-ui,-apple-system,sans-serif" font-size="20" font-weight="800" letter-spacing="3" fill="#ffffff">FORTRESS</text>
  <text x="50" y="38" font-family="system-ui,-apple-system,sans-serif" font-size="7" font-weight="500" letter-spacing="4" fill="#6b7280">INTELLIGENCE PLATFORM</text>
</svg>`;

          // headerImageUrl is now inlined directly in the template with data-pdf-section

          let fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${bulletin_title}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #080b12; color: #e5e7eb; line-height: 1.7;
    }
    .page { max-width: 900px; margin: 0 auto; background: #0c1018; }
    .top-bar { height: 4px; background: linear-gradient(90deg, #00d9ff 0%, #0ea5e9 50%, #6366f1 100%); }
    .header { padding: 36px 48px 28px; position: relative; }
    .logo-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .classification-badge {
      background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px;
      padding: 4px 14px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1.5px; color: #fca5a5;
    }
    .header-title { font-size: 1.6rem; font-weight: 800; color: #fff; line-height: 1.3; margin-bottom: 16px; }
    .meta-grid { display: flex; gap: 32px; flex-wrap: wrap; font-size: 0.82rem; color: #9ca3af; }
    .meta-grid .meta-item { display: flex; flex-direction: column; gap: 2px; }
    .meta-grid .meta-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; }
    .meta-grid .meta-value { color: #d1d5db; font-weight: 500; }
    .divider { height: 1px; background: linear-gradient(90deg, transparent, #1e293b 20%, #1e293b 80%, transparent); margin: 0; }
    .content { padding: 32px 48px 40px; }
    .content h2 { 
      color: #00d9ff; font-size: 1.05rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
      margin: 32px 0 14px; padding: 10px 0 10px 16px; 
      border-left: 3px solid #00d9ff; background: rgba(0,217,255,0.04);
    }
    .content h2:first-child { margin-top: 0; }
    .content h3 { color: #a5b4fc; font-size: 0.95rem; font-weight: 600; margin: 22px 0 8px; }
    .content p { color: #d1d5db; margin-bottom: 14px; font-size: 0.92rem; }
    .content ul, .content ol { color: #d1d5db; margin: 8px 0 16px 20px; font-size: 0.92rem; }
    .content img { max-width: 100%; height: auto; border-radius: 6px; margin: 12px 0; display: block; }
    .content li { margin-bottom: 8px; line-height: 1.6; }
    .content li::marker { color: #00d9ff; }
    .content table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.88rem; border-radius: 8px; overflow: hidden; }
    .content th { background: #111827; color: #00d9ff; padding: 12px 16px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.8px; border-bottom: 2px solid #1e293b; }
    .content td { padding: 11px 16px; border-bottom: 1px solid #1a1f2e; color: #d1d5db; }
    .content tr:nth-child(even) td { background: rgba(17,24,39,0.4); }
    .content tr:hover td { background: rgba(0, 217, 255, 0.04); }
    .content blockquote { border-left: 3px solid #6366f1; padding: 14px 20px; margin: 16px 0; background: rgba(99,102,241,0.06); border-radius: 0 8px 8px 0; color: #c7d2fe; font-style: italic; }
    .content strong { color: #f1f5f9; }
    .severity-critical { color: #ef4444; font-weight: 700; }
    .severity-high { color: #f97316; font-weight: 700; }
    .severity-medium { color: #eab308; font-weight: 600; }
    .severity-low { color: #22c55e; }
    .footer { padding: 28px 48px; border-top: 1px solid #1a1f2e; text-align: center; }
    .footer-brand { font-size: 0.72rem; color: #4b5563; margin-top: 8px; letter-spacing: 0.5px; }
    .footer-classification { font-size: 0.7rem; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
    @media print { 
      body { background: #fff; color: #111; } 
      .page { background: #fff; } 
      .top-bar { background: #1a365d; }
      .content h2 { color: #1a365d; border-left-color: #1a365d; background: #f0f4f8; }
      .content p, .content li, .content td { color: #333; } 
      .header-title { color: #111; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div data-pdf-section class="top-bar"></div>
    <div data-pdf-section class="header">
      <div class="logo-row">
        ${fortressLogo}
        <div class="classification-badge">${classification}</div>
      </div>
      <h1 class="header-title">${bulletin_title}</h1>
      <div class="meta-grid">
        <div class="meta-item"><span class="meta-label">Date</span><span class="meta-value">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div>
        <div class="meta-item"><span class="meta-label">Time</span><span class="meta-value">${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</span></div>
        <div class="meta-item"><span class="meta-label">Prepared By</span><span class="meta-value">FORTRESS Intelligence Platform</span></div>
        <div class="meta-item"><span class="meta-label">Report ID</span><span class="meta-value">${reportId.split("-")[0].toUpperCase()}</span></div>
      </div>
    </div>
    ${headerImageUrl ? `<div data-pdf-section style="width:100%;max-height:280px;overflow:hidden;"><img src="${headerImageUrl}" alt="Security Bulletin Header" style="width:100%;height:auto;display:block;object-fit:cover;" crossorigin="anonymous" /></div>` : ""}
    <div class="divider"></div>
    <div class="content">${
      // Wrap each top-level element in the user-provided HTML with data-pdf-section
      bulletin_html.replace(/<(h[1-6]|p|ul|ol|table|blockquote|div|section|figure|img)(\s|>)/gi, '<$1 data-pdf-section $2')
    }</div>
    <div data-pdf-section class="footer">
      <div class="footer-classification">${classification}</div>
      <div class="footer-brand">Generated by FORTRESS Intelligence Platform · ${now.toISOString().split("T")[0]} · Unauthorized distribution is prohibited</div>
    </div>
  </div>
</body>
</html>`;

          // ═══════════════════════════════════════════════════════════════
          // EMBED VISUAL INTELLIGENCE APPENDIX for bulletins
          // Includes user-provided images (bulletin_images) + OSINT media
          // ═══════════════════════════════════════════════════════════════
          let bulletinMediaItems: { url: string; caption: string; source: string }[] = [];

          // 1. Add user-provided images from the conversation
          if (bulletin_images && Array.isArray(bulletin_images) && bulletin_images.length > 0) {
            for (const img of bulletin_images) {
              if (img.url) {
                bulletinMediaItems.push({
                  url: img.url,
                  caption: img.caption || "User-provided image",
                  source: "Intelligence Submission"
                });
              }
            }
            console.log(`Including ${bulletinMediaItems.length} user-provided images in bulletin`);
          }

          // 2. Also fetch OSINT media if we have a client_id
          if (client_id) {
            try {
              const mediaSince = new Date();
              mediaSince.setDate(mediaSince.getDate() - (period_days || 7));

              const { data: clientSignals } = await serviceClient
                .from("signals")
                .select("id")
                .eq("client_id", client_id)
                .gte("received_at", mediaSince.toISOString())
                .limit(50);

              const sigIds = (clientSignals || []).map((s: any) => s.id);
              if (sigIds.length > 0) {
                const { data: sigAttachments } = await serviceClient
                  .from("attachments")
                  .select("filename, storage_url, mime")
                  .eq("parent_type", "signal")
                  .in("parent_id", sigIds.slice(0, 30))
                  .like("mime", "image/%")
                  .limit(10);

                if (sigAttachments?.length) {
                  for (const att of sigAttachments) {
                    bulletinMediaItems.push({
                      url: att.storage_url,
                      caption: att.filename || "OSINT capture",
                      source: "OSINT Signal Media"
                    });
                  }
                }
              }
            } catch (mediaErr) {
              console.error("Non-fatal: OSINT media fetch for bulletin failed:", mediaErr);
            }
          }

          // Inject appendix into HTML if we have images
          if (bulletinMediaItems.length > 0) {
            const appendixHtml = `
<div data-pdf-section style="margin-top: 40px; padding: 20px; border-top: 2px solid rgba(0, 212, 255, 0.3);">
  <h2 style="color: #00d4ff; font-size: 18px; margin-bottom: 16px; font-family: 'Georgia', serif; letter-spacing: 2px;">
    📸 VISUAL INTELLIGENCE APPENDIX
  </h2>
  <p style="color: #a0a0a0; font-size: 12px; margin-bottom: 20px;">
    ${bulletinMediaItems.length} visual asset(s) included in this bulletin.
  </p>
  ${bulletinMediaItems.map(item => `
  <div data-pdf-section style="margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.03);">
    <img src="${item.url}" alt="${item.caption}" style="width: 100%; max-height: 400px; object-fit: contain; display: block; background: #111;" crossorigin="anonymous" onerror="this.style.display='none'" />
    <div style="padding: 10px 14px;">
      <p style="font-size: 12px; color: #e0e0e0; margin: 0 0 4px 0; font-weight: 600;">${item.caption}</p>
      <p style="font-size: 10px; color: #888; margin: 0;">Source: ${item.source}</p>
    </div>
  </div>`).join("")}
</div>`;

            // Insert before footer
            fullHtml = fullHtml.replace(
              '<div data-pdf-section class="footer">',
              `${appendixHtml}\n    <div data-pdf-section class="footer">`
            );
            console.log(`Embedded ${bulletinMediaItems.length} images into bulletin Visual Intelligence Appendix`);
          }

          // Upload to storage for download
          const filename = `security-bulletin-${bulletin_title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}-${reportDate}`;
          const storagePath = `reports/${reportId}/${filename}.html`;
          const htmlBytes = new TextEncoder().encode(fullHtml);

          // Upload to PUBLIC osint-media bucket so HTML renders correctly in browser
          const { error: uploadError } = await serviceClient.storage
            .from("osint-media")
            .upload(storagePath, htmlBytes, { 
              contentType: "text/html; charset=utf-8", 
              upsert: true,
            });

          let downloadUrl = "";
          let viewUrl = "";
          if (!uploadError) {
            // Public bucket - get direct public URL for viewing
            const { data: publicUrlData } = serviceClient.storage
              .from("osint-media")
              .getPublicUrl(storagePath);
            viewUrl = publicUrlData?.publicUrl || "";
            downloadUrl = viewUrl;
          } else {
            console.error("Failed to upload bulletin to storage:", uploadError);
            // Fallback: try tenant-files bucket with signed URL
            const { error: fallbackError } = await serviceClient.storage
              .from("tenant-files")
              .upload(storagePath, htmlBytes, { 
                contentType: "text/html; charset=utf-8", 
                upsert: true,
              });
            if (!fallbackError) {
              const { data: signedData } = await serviceClient.storage
                .from("tenant-files")
                .createSignedUrl(storagePath, 3600);
              downloadUrl = signedData?.signedUrl || "";
            }
          }

          // Also create a base64 data URI as guaranteed fallback
          const htmlBase64 = base64FromBytes(htmlBytes);
          const dataUri = `data:text/html;base64,${htmlBase64}`;

          return {
            success: true,
            report_type: "security_bulletin",
            report_id: reportId,
            filename: `${filename}.html`,
            html_length: fullHtml.length,
            has_header_image: !!headerImageUrl,
            download_url: downloadUrl || dataUri,
            view_url: viewUrl || downloadUrl || dataUri,
            message: `✅ **Security Bulletin Generated** — "${bulletin_title}" (${Math.round(fullHtml.length / 1024)}KB)${headerImageUrl ? " with AI-generated header image" : ""}`,
            download_instructions: downloadUrl
              ? `Report is ready. Provide the user this link to view the formatted bulletin in their browser: ${viewUrl || downloadUrl}`
              : `Report generated. Provide this data link for download: ${dataUri.slice(0, 100)}...`
          };
        } catch (bulletinError) {
          console.error("Security bulletin generation error:", bulletinError);
          return { error: `Failed to generate security bulletin: ${bulletinError instanceof Error ? bulletinError.message : "Unknown error"}` };
        }
      }

      try {
        let functionName: string;
        let requestBody: any;

        switch (report_type) {
          case "executive":
            if (!client_id) return { error: "client_id or client_name is required for executive reports" };
            functionName = "generate-executive-report";
            requestBody = { client_id, period_days: period_days || 7 };
            break;
          case "risk_snapshot":
            functionName = "generate-report";
            requestBody = { report_type: "72h-snapshot", period_hours: (period_days || 3) * 24 };
            break;
          case "security_briefing":
            if (!city || !country) return { error: "city and country are required for security briefings" };
            functionName = "generate-security-briefing";
            requestBody = { city, country, travel_dates };
            break;
          default:
            return { error: `Unknown report type: ${report_type}` };
        }

        console.log(`Generating ${report_type} report via ${functionName}`, JSON.stringify(requestBody));

        const reportResponse = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!reportResponse.ok) {
          const errorText = await reportResponse.text();
          console.error(`Report generation failed: ${reportResponse.status}`, errorText);
          return { error: `Report generation failed (${reportResponse.status}): ${errorText.substring(0, 200)}` };
        }

        const reportData = await reportResponse.json();
        
        if (reportData.html) {
          const reportId = crypto.randomUUID();
          const reportDate = new Date().toISOString().split("T")[0];
          const clientLabel = reportData.metadata?.client || city || "platform";
          const filename = `${report_type}-report-${clientLabel.toLowerCase().replace(/\s+/g, "-")}-${reportDate}`;

          // ═══════════════════════════════════════════════════════════════
          // EMBED VISUAL INTELLIGENCE: OSINT media, maps, uploaded images
          // ═══════════════════════════════════════════════════════════════
          const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          let enrichedHtml = reportData.html;

          try {
            // Determine time window for media queries
            const mediaPeriodDays = period_days || 7;
            const mediaSince = new Date();
            mediaSince.setDate(mediaSince.getDate() - mediaPeriodDays);

            // 1. Fetch OSINT media attachments linked to signals for this client
            let signalIds: string[] = [];
            if (client_id) {
              const { data: clientSignals } = await serviceClient
                .from("signals")
                .select("id")
                .eq("client_id", client_id)
                .gte("received_at", mediaSince.toISOString())
                .limit(100);
              signalIds = (clientSignals || []).map((s: any) => s.id);
            }

            let mediaItems: { url: string; caption: string; source: string }[] = [];

            if (signalIds.length > 0) {
              // Fetch attachments linked to these signals (images only)
              const { data: signalAttachments } = await serviceClient
                .from("attachments")
                .select("filename, storage_url, mime, parent_id")
                .eq("parent_type", "signal")
                .in("parent_id", signalIds.slice(0, 50))
                .like("mime", "image/%")
                .limit(20);

              if (signalAttachments?.length) {
                for (const att of signalAttachments) {
                  mediaItems.push({
                    url: att.storage_url,
                    caption: att.filename || "OSINT capture",
                    source: "OSINT Signal Media"
                  });
                }
              }
            }

            // 2. Fetch uploaded archival images for this client
            if (client_id) {
              const { data: archivalImages } = await serviceClient
                .from("archival_documents")
                .select("filename, storage_path, file_type, summary")
                .eq("client_id", client_id)
                .like("file_type", "image/%")
                .gte("created_at", mediaSince.toISOString())
                .limit(10);

              if (archivalImages?.length) {
                for (const doc of archivalImages) {
                  const { data: signedUrl } = await serviceClient.storage
                    .from("archival-documents")
                    .createSignedUrl(doc.storage_path, 3600);
                  if (signedUrl?.signedUrl) {
                    mediaItems.push({
                      url: signedUrl.signedUrl,
                      caption: doc.summary || doc.filename,
                      source: "Uploaded Document"
                    });
                  }
                }
              }
            }

            // 3. Fetch geospatial maps if available
            const { data: mapObjects } = await serviceClient.storage
              .from("geospatial-maps")
              .list(client_id || "", { limit: 5, sortBy: { column: "created_at", order: "desc" } });

            if (mapObjects?.length) {
              for (const mapFile of mapObjects) {
                const mapPath = client_id ? `${client_id}/${mapFile.name}` : mapFile.name;
                const { data: mapUrl } = await serviceClient.storage
                  .from("geospatial-maps")
                  .createSignedUrl(mapPath, 3600);
                if (mapUrl?.signedUrl) {
                  mediaItems.push({
                    url: mapUrl.signedUrl,
                    caption: mapFile.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
                    source: "Geospatial Intelligence"
                  });
                }
              }
            }

            // Inject media gallery into HTML if we have images
            if (mediaItems.length > 0) {
              const galleryHtml = `
<div style="page-break-before: always; margin-top: 40px; padding: 20px; border-top: 3px solid #1a365d;">
  <h2 style="color: #1a365d; font-size: 18px; margin-bottom: 16px; font-family: 'Georgia', serif;">
    📸 VISUAL INTELLIGENCE APPENDIX
  </h2>
  <p style="color: #555; font-size: 12px; margin-bottom: 20px;">
    ${mediaItems.length} visual asset(s) collected during the reporting period.
  </p>
  <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
    ${mediaItems.map(item => `
    <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #f8fafc;">
      <img src="${item.url}" alt="${item.caption}" style="width: 100%; max-height: 250px; object-fit: cover;" onerror="this.style.display='none'" />
      <div style="padding: 8px 12px;">
        <p style="font-size: 11px; color: #333; margin: 0 0 4px 0; font-weight: 600;">${item.caption}</p>
        <p style="font-size: 10px; color: #888; margin: 0;">Source: ${item.source}</p>
      </div>
    </div>`).join("")}
  </div>
</div>`;

              // Insert before </body> or at end
              if (enrichedHtml.includes("</body>")) {
                enrichedHtml = enrichedHtml.replace("</body>", `${galleryHtml}</body>`);
              } else {
                enrichedHtml += galleryHtml;
              }
              console.log(`Embedded ${mediaItems.length} visual assets into report`);
            }
          } catch (mediaError) {
            console.error("Non-fatal: Failed to embed media into report:", mediaError);
            // Continue with original HTML — media enrichment is best-effort
          }

          // Store enriched HTML in Supabase storage for download
          const storagePath = `reports/${reportId}/${filename}.html`;
          const htmlBytes = new TextEncoder().encode(enrichedHtml);
          
          const { error: uploadError } = await serviceClient.storage
            .from("tenant-files")
            .upload(storagePath, htmlBytes, {
              contentType: "text/html",
              upsert: true,
            });

          let downloadUrl = "";
          if (!uploadError) {
            const { data: signedData } = await serviceClient.storage
              .from("tenant-files")
              .createSignedUrl(storagePath, 3600);
            downloadUrl = signedData?.signedUrl || "";
          } else {
            console.error("Failed to upload report to storage:", uploadError);
          }

          const reportLabel = report_type === "executive" ? "Executive Intelligence Report" 
            : report_type === "risk_snapshot" ? "72-Hour Risk Snapshot" 
            : "Travel Security Briefing";

          return {
            success: true,
            report_type,
            report_id: reportId,
            filename: `${filename}.html`,
            html_length: enrichedHtml.length,
            media_count: mediaItems?.length || 0,
            metadata: reportData.metadata || {},
            download_url: downloadUrl,
            message: `✅ **${reportLabel}** generated successfully (${Math.round(enrichedHtml.length / 1024)}KB)${mediaItems?.length ? ` with ${mediaItems.length} embedded visual asset(s)` : ""}.`,
            download_instructions: downloadUrl 
              ? `Report is ready for download. Provide the user this download link: ${downloadUrl}` 
              : "Report was generated but storage upload failed. The report data is available in metadata."
          };
        } else if (reportData.success === false) {
          return { error: reportData.error || "Report generation returned no HTML" };
        } else {
          return { 
            success: true, 
            report_type, 
            data: reportData,
            message: "Report data generated but no HTML output was produced. The data is available for review."
          };
        }
      } catch (fetchError) {
        console.error("Report generation fetch error:", fetchError);
        return { error: `Failed to generate report: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}` };
      }
    }

    case "query_expert_knowledge": {
      const { question, domain, include_live_search, context, max_results } = args;
      
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        
        const response = await fetch(`${SUPABASE_URL}/functions/v1/query-expert-knowledge`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            question,
            domain,
            include_live_search: include_live_search !== false,
            context,
            max_results: max_results || 10,
          }),
        });
        
        if (!response.ok) {
          const errText = await response.text();
          return { error: `Expert knowledge query failed: ${errText}` };
        }
        
        const result = await response.json();
        return result;
      } catch (err) {
        console.error("query_expert_knowledge error:", err);
        return { error: `Expert knowledge query failed: ${err instanceof Error ? err.message : "Unknown error"}` };
      }
    }

    case "get_tech_radar": {
      const { category, min_relevance, limit: techLimit } = args;
      const effectiveLimit = techLimit || 10;
      const effectiveMinRelevance = min_relevance || 0.5;
      
      let query = supabaseClient
        .from("tech_radar_recommendations")
        .select("*")
        .gte("relevance_score", effectiveMinRelevance)
        .eq("is_dismissed", false)
        .order("relevance_score", { ascending: false })
        .limit(effectiveLimit);
      
      if (category) {
        query = query.eq("category", category);
      }
      
      const { data, error } = await query;
      
      if (error) {
        return { error: `Tech radar query failed: ${error.message}` };
      }
      
      return {
        recommendations: data || [],
        count: data?.length || 0,
        filters_applied: { category, min_relevance: effectiveMinRelevance },
        note: "Technology Radar scans run weekly. Ask me to explain any recommendation or generate an adoption playbook."
      };
    }

    case "dispatch_agent_investigation": {
      const { incident_id, agent_call_sign, prompt } = args;
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      
      const orchestratorResponse = await fetch(
        `${supabaseUrl}/functions/v1/incident-agent-orchestrator`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ incident_id, agent_call_sign, prompt }),
        }
      );
      
      if (!orchestratorResponse.ok) {
        const errText = await orchestratorResponse.text();
        return { error: `Agent dispatch failed: ${errText}` };
      }
      
      const result = await orchestratorResponse.json();
      return {
        success: true,
        agent_dispatched: result.agent,
        analysis: result.analysis,
        investigation_focus: result.investigation_focus,
        log_entries: result.log_entry_count,
        incident_id: result.incident_id,
        note: `Agent ${result.agent} has completed their investigation. Their analysis has been logged to the incident timeline.`
      };
    }

    case "trigger_multi_agent_debate": {
      const { incident_id, debate_type, custom_prompt } = args;
      
      const supabaseUrl2 = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      
      const debateResponse = await fetch(
        `${supabaseUrl2}/functions/v1/multi-agent-debate`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey2}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            incident_id, 
            debate_type: debate_type || "adversarial",
            custom_prompt 
          }),
        }
      );
      
      if (!debateResponse.ok) {
        const errText = await debateResponse.text();
        return { error: `Multi-agent debate failed: ${errText}` };
      }
      
      const debateResult = await debateResponse.json();
      return {
        success: true,
        debate_id: debateResult.debate_id,
        participating_agents: debateResult.participating_agents,
        consensus_score: debateResult.consensus_score,
        synthesis: debateResult.synthesis,
        final_assessment: debateResult.final_assessment,
        individual_analyses_count: debateResult.individual_analyses?.length || 0,
        note: "Multi-agent debate complete. The synthesis represents the combined assessment from all participating agents."
      };
    }

    case "generate_audio_briefing": {
      const { content, title } = args;
      const briefingUserId = userId || args._user_id;
      
      if (!briefingUserId) {
        return { error: "User authentication required for audio generation" };
      }
      
      const supabaseUrl3 = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey3 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      
      // Create audio_briefings record first
      const { data: briefingRecord, error: insertErr } = await supabaseClient
        .from("audio_briefings")
        .insert({
          title,
          content_text: content.substring(0, 5000),
          source_type: "aegis_chat",
          status: "processing",
          user_id: briefingUserId,
        })
        .select("id")
        .single();
      
      if (insertErr) {
        return { error: `Failed to create briefing record: ${insertErr.message}` };
      }
      
      // Call the audio generation edge function  
      const audioResponse = await fetch(
        `${supabaseUrl3}/functions/v1/generate-briefing-audio`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey3}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content, title, user_id: briefingUserId }),
        }
      );
      
      if (!audioResponse.ok) {
        const errText = await audioResponse.text();
        // Update record to failed
        await supabaseClient
          .from("audio_briefings")
          .update({ status: "failed" })
          .eq("id", briefingRecord.id);
        return { error: `Audio generation failed: ${errText}` };
      }
      
      const audioResult = await audioResponse.json();
      
      // Update the briefing record with results
      await supabaseClient
        .from("audio_briefings")
        .update({
          audio_url: audioResult.audio_url,
          duration_seconds: audioResult.duration_estimate,
          chunks_processed: audioResult.chunks_processed,
          status: "completed",
        })
        .eq("id", briefingRecord.id);
      
      return {
        success: true,
        briefing_id: briefingRecord.id,
        audio_url: audioResult.audio_url,
        duration_estimate_seconds: audioResult.duration_estimate,
        chunks_processed: audioResult.chunks_processed,
        note: "Audio briefing generated with the Onyx voice (deep, authoritative). The briefing is available for playback."
      };
    }

    case "create_briefing_session": {
      const { title, description, incident_id, investigation_id, agent_ids, meeting_mode } = args;
      const sessionUserId = userId || args._user_id;
      
      if (!sessionUserId) {
        return { error: "User authentication required to create briefing sessions" };
      }
      
      // First, find or create a default workspace for the user
      const { data: workspaces } = await supabaseClient
        .from("investigation_workspaces")
        .select("id")
        .limit(1);
      
      let workspaceId = workspaces?.[0]?.id;
      
      if (!workspaceId) {
        const { data: newWs, error: wsErr } = await supabaseClient
          .from("investigation_workspaces")
          .insert({
            name: "Default Workspace",
            created_by_user_id: sessionUserId,
          })
          .select("id")
          .single();
        
        if (wsErr) {
          return { error: `Failed to create workspace: ${wsErr.message}` };
        }
        workspaceId = newWs.id;
      }
      
      // Create the briefing session
      const { data: session, error: sessionErr } = await supabaseClient
        .from("briefing_sessions")
        .insert({
          title,
          description: description || null,
          incident_id: incident_id || null,
          investigation_id: investigation_id || null,
          meeting_mode: meeting_mode || "standard",
          status: "scheduled",
          created_by: sessionUserId,
          workspace_id: workspaceId,
        })
        .select("*")
        .single();
      
      if (sessionErr) {
        return { error: `Failed to create briefing session: ${sessionErr.message}` };
      }
      
      // Add the creator as a participant
      await supabaseClient
        .from("briefing_participants")
        .insert({
          briefing_id: session.id,
          user_id: sessionUserId,
          role: "facilitator",
        });
      
      // Add agent participants if specified
      if (agent_ids && agent_ids.length > 0) {
        const agentParticipants = agent_ids.map((agentId: string) => ({
          briefing_id: session.id,
          agent_id: agentId,
          role: "analyst",
        }));
        
        await supabaseClient
          .from("briefing_participants")
          .insert(agentParticipants);
      }
      
      return {
        success: true,
        session_id: session.id,
        title: session.title,
        status: session.status,
        meeting_mode: session.meeting_mode,
        workspace_id: workspaceId,
        participants_added: 1 + (agent_ids?.length || 0),
        note: `Briefing session "${title}" created. You can add agenda items, invite more participants, and start the session when ready.`
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CYBER SENTINEL EXECUTION HANDLER
    // ══════════════════════════════════════════════════════════════════════════
    case "run_cyber_sentinel": {
      const { mode = "status" } = args;
      console.log(`[run_cyber_sentinel] Mode: ${mode}`);

      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        const sentinelResponse = await fetch(`${supabaseUrl}/functions/v1/cyber-sentinel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ mode }),
        });

        if (!sentinelResponse.ok) {
          const errText = await sentinelResponse.text();
          return { error: `Cyber Sentinel returned ${sentinelResponse.status}: ${errText}` };
        }

        const result = await sentinelResponse.json();
        return {
          ...result,
          tool_note: mode === 'status' 
            ? `Cyber posture is ${result.posture_level}. ${result.active_tripwires} tripwires active. ${result.last_24h?.total_events || 0} events in the last 24 hours.`
            : `Sweep complete. ${result.events_detected || 0} events detected, ${result.critical_threats || 0} critical. ${result.responses_executed || 0} responses executed.`,
        };
      } catch (error) {
        console.error('[run_cyber_sentinel] Error:', error);
        return { error: `Cyber Sentinel invocation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SYSTEM HEALTH & LEARNING INTROSPECTION
    // ══════════════════════════════════════════════════════════════════════════
    case "get_system_health": {
      console.log(`[get_system_health] Fetching neural net health metrics`);
      try {
        const healthMetrics = await getSystemHealthMetrics(supabaseClient);
        return {
          ...healthMetrics,
          tool_note: `Neural net last trained ${healthMetrics.learning.sessionAge} (quality: ${healthMetrics.learning.lastSessionQuality}). ${healthMetrics.drift.alert ? '⚠️ DRIFT DETECTED: ' + healthMetrics.drift.summary : 'Threat landscape stable.'}. ${healthMetrics.feedback24h} feedback events in last 24h. ${healthMetrics.monitoringHealth.failures > 0 ? `🔴 ${healthMetrics.monitoringHealth.failures} monitoring failures detected.` : '✅ All monitors healthy.'}`,
        };
      } catch (error) {
        console.error('[get_system_health] Error:', error);
        return { error: `System health check failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }
    }

    case "get_common_operating_picture": {
      try {
        const cop = await buildCOP(supabaseClient);
        return {
          success: true,
          summary: cop.summary,
          generated_at: cop.generated_at,
          risk_score: cop.risk_score,
          risk_trend: cop.risk_trend,
          open_incidents: cop.open_incidents,
          critical_signals: cop.critical_signals,
          high_probability_escalations: cop.high_probability_escalations,
          top_entities: cop.top_entities,
          active_agents: cop.active_agents,
          broadcast_messages: cop.broadcast_messages,
          formatted: formatCOPForPrompt(cop),
        };
      } catch (copErr) {
        return { error: "COP snapshot failed", details: copErr instanceof Error ? copErr.message : String(copErr) };
      }
    }

    case "perform_web_fetch": {
      const { url, context: fetchContext } = args;
      if (!url) return { error: "URL is required for perform_web_fetch" };
      console.log(`[perform_web_fetch] Fetching: ${url}`);

      // Detect platform from URL
      const u = url.toLowerCase();
      const isTwitter   = /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(url);
      const isReddit    = /reddit\.com\/(r\/[^/]+\/comments|user\/)/i.test(url);
      const isYouTube   = /(?:youtube\.com\/watch|youtu\.be\/)/i.test(url);
      const isTelegram  = /t\.me\//i.test(url);
      const isLinkedIn  = /linkedin\.com\/(posts|pulse|in\/|company\/)/i.test(url);
      const isInstagram = /instagram\.com\/p\//i.test(url);
      const isFacebook  = /facebook\.com\/(?!groups)/i.test(url) && u.includes('/posts/');
      const isTikTok    = /tiktok\.com\/@[^/]+\/video\//i.test(url);

      let fetchUrl = url;
      let platform = 'web';

      if (isTwitter) {
        // fxtwitter.com: returns JSON with full tweet data, no JS required
        fetchUrl = url
          .replace(/https?:\/\/(?:www\.)?x\.com/, 'https://api.fxtwitter.com')
          .replace(/https?:\/\/(?:www\.)?twitter\.com/, 'https://api.fxtwitter.com');
        platform = 'twitter';
      } else if (isReddit) {
        // Reddit JSON API: append .json to get structured data
        fetchUrl = url.replace(/\/$/, '') + '.json';
        platform = 'reddit';
      } else if (isYouTube) {
        // YouTube: use noembed.com for title/description metadata
        const videoId = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
        if (videoId) {
          fetchUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        }
        platform = 'youtube';
      } else if (isTelegram) {
        // Telegram public channels: use t.me/s/ embed
        fetchUrl = url.replace('https://t.me/', 'https://t.me/s/');
        platform = 'telegram';
      } else if (isLinkedIn || isInstagram || isFacebook || isTikTok) {
        // These block bots — fall back to oEmbed or metadata scrape
        platform = isLinkedIn ? 'linkedin' : isInstagram ? 'instagram' : isFacebook ? 'facebook' : 'tiktok';
      }

      try {
        const response = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          // For bot-blocked platforms, return helpful guidance
          if ([401, 403, 429].includes(response.status) && ['instagram','linkedin','facebook','tiktok'].includes(platform)) {
            return {
              error: `${platform} blocked automated access (HTTP ${response.status})`,
              url,
              platform,
              suggestion: `${platform.charAt(0).toUpperCase()+platform.slice(1)} requires authentication for direct access. Please paste the post text directly into this chat and I will analyze it.`,
              workaround: 'Paste the post content directly into the chat'
            };
          }
          return { error: `HTTP ${response.status}`, url, platform };
        }

        const contentType = response.headers.get('content-type') || '';
        let content = '';
        let metadata: Record<string, unknown> = {};

        if (isTwitter) {
          const data = await response.json();
          const tweet = data?.tweet;
          if (tweet) {
            metadata = {
              author_handle: tweet.author?.screen_name,
              author_name: tweet.author?.name,
              posted: tweet.created_at,
              likes: tweet.likes,
              retweets: tweet.retweets,
              replies: tweet.replies,
              quote_count: tweet.quote_count,
            };
            content = tweet.text || tweet.content || '';
            // Include quote tweet if present
            if (tweet.quote?.text) {
              content += `\n\n[Quoting @${tweet.quote.author?.screen_name}: ${tweet.quote.text}]`;
            }
            // Include media descriptions
            if (tweet.media?.photos?.length) {
              content += `\n\n[Contains ${tweet.media.photos.length} image(s)]`;
            }
            if (tweet.media?.videos?.length) {
              content += `\n\n[Contains video]`;
            }
          } else {
            content = JSON.stringify(data, null, 2).slice(0, 3000);
          }
        } else if (isReddit) {
          const data = await response.json();
          const post = data?.[0]?.data?.children?.[0]?.data;
          if (post) {
            metadata = {
              subreddit: post.subreddit,
              author: post.author,
              title: post.title,
              score: post.score,
              num_comments: post.num_comments,
              created_utc: new Date(post.created_utc * 1000).toISOString(),
            };
            content = `[Reddit Post in r/${post.subreddit}]\nTitle: ${post.title}\nAuthor: u/${post.author}\n\n${post.selftext || post.url || ''}\n\nScore: ${post.score} | Comments: ${post.num_comments}`;
            // Top comments
            const comments = data?.[1]?.data?.children?.slice(0,3)?.map((c: any) => c.data?.body).filter(Boolean);
            if (comments?.length) {
              content += `\n\nTop comments:\n${comments.map((c: string, i: number) => `${i+1}. ${c.slice(0,200)}`).join('\n')}`;
            }
          } else {
            content = JSON.stringify(data, null, 2).slice(0, 3000);
          }
        } else if (isYouTube) {
          const data = await response.json();
          metadata = { title: data.title, author: data.author_name, thumbnail: data.thumbnail_url };
          content = `[YouTube Video]\nTitle: ${data.title}\nChannel: ${data.author_name}\nURL: ${url}\n\nNote: Full transcript/description requires YouTube Data API access.`;
        } else if (isTelegram) {
          const rawText = await response.text();
          const messages = rawText.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
          content = messages
            .slice(0, 5)
            .map(m => m.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim())
            .join('\n\n');
          if (!content) {
            content = rawText.replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n').trim().slice(0, 4000);
          }
          platform = 'telegram';
        } else {
          // General web page — strip HTML
          const rawText = await response.text();
          // Extract title
          const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) metadata.title = titleMatch[1].trim();
          // Extract meta description
          const descMatch = rawText.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
          if (descMatch) metadata.description = descMatch[1].trim();
          // Extract Open Graph data
          const ogTitle = rawText.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
          if (ogTitle) metadata.og_title = ogTitle[1].trim();
          const ogDesc = rawText.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
          if (ogDesc) metadata.og_description = ogDesc[1].trim();
          
          content = rawText
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
            .replace(/\s{3,}/g, '\n\n')
            .trim()
            .slice(0, 8000);
        }

        return {
          success: true,
          url,
          platform,
          content_type: contentType,
          metadata,
          content,
          char_count: content.length,
          context_note: fetchContext || undefined,
        };

      } catch (fetchError) {
        const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error(`[perform_web_fetch] Error:`, errMsg);
        const isBlocked = ['instagram','linkedin','facebook','tiktok'].includes(platform);
        return {
          error: `Failed to fetch: ${errMsg}`,
          url,
          platform,
          suggestion: isBlocked
            ? `${platform} blocks automated access. Paste the post text directly into the chat.`
            : 'The URL may be temporarily unavailable or require authentication.',
        };
      }
    }

    case "get_agent_responses":
    case "broadcast_to_agents": {
      const { message, priority = "normal" } = args;

      // Get all active agents with their system prompts and models
      const { data: activeAgents, error: agentsErr } = await supabaseClient
        .from("ai_agents")
        .select("id, call_sign, codename, system_prompt, specialty")
        .eq("is_active", true);

      if (agentsErr || !activeAgents?.length) {
        return { error: "Failed to fetch active agents", details: agentsErr?.message };
      }

      // ── Real-time agent polling (parallel) ───────────────────────────────
      // Invoke each agent directly and collect live responses.
      const agentQuery = async (agent: any): Promise<{ call_sign: string; codename: string; response: string }> => {
        try {
          const systemPrompt = (agent.system_prompt || `You are ${agent.call_sign}, a specialist AI agent. Specialty: ${agent.specialty || 'general intelligence'}.`)
            + `\n\nYou are responding to a direct broadcast from the Principal (Command). Be concise, honest, and in-character. Today's date: ${new Date().toISOString().split('T')[0]}.`;

          const result = await callAiGateway({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `[BROADCAST FROM PRINCIPAL]\n\n${message}` },
            ],
            functionName: `agent-broadcast-${agent.call_sign}`,
            retries: 1,
            extraBody: { max_completion_tokens: 400 },
          });
          return {
            call_sign: agent.call_sign,
            codename: agent.codename,
            response: result.error ? `(unavailable: ${result.error})` : (result.content || '(no response)'),
          };
        } catch (e) {
          return { call_sign: agent.call_sign, codename: agent.codename, response: `(error: ${e})` };
        }
      };

      // Run all agents in parallel with a 20-second race timeout
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 20000));
      const responses = await Promise.race([
        Promise.allSettled(activeAgents.map(agentQuery)),
        timeout,
      ]) as PromiseSettledResult<{ call_sign: string; codename: string; response: string }>[] | null;

      const agentResponses: { call_sign: string; codename: string; response: string }[] = [];
      if (responses) {
        for (const r of responses) {
          if (r.status === 'fulfilled') agentResponses.push(r.value);
        }
      }

      // ── Also store in pending messages for audit trail ────────────────────
      const senderUserId = userId || null;
      await supabaseClient.from("agent_pending_messages").insert(
        activeAgents.map((agent: any) => ({
          agent_id: agent.id,
          recipient_user_id: senderUserId,
          sender_user_id: senderUserId,
          message: `[BROADCAST FROM PRINCIPAL] ${message}`,
          priority,
          trigger_event: "principal_broadcast",
          delivered_at: new Date().toISOString(), // mark delivered since we got live response
        }))
      );

      const responseLines = agentResponses.map(r =>
        `**${r.call_sign}** (${r.codename}): ${r.response}`
      ).join('\n\n');

      return {
        success: true,
        agent_count: activeAgents.length,
        responses_received: agentResponses.length,
        agent_responses: agentResponses,
        formatted_responses: responseLines || 'No responses received.',
        summary: `Live responses collected from ${agentResponses.length}/${activeAgents.length} agents.`,
      };
    }

    case "agent_self_assessment": {
      // ── Pull system-wide context to give agents real grounding ──────────
      const [
        { data: activeAgents2, error: agentsErr2 },
        { count: signalCount },
        { count: incidentCount },
        { count: entityCount },
      ] = await Promise.all([
        supabaseClient
          .from("ai_agents")
          .select("id, call_sign, codename, specialty, mission_scope, input_sources, output_types, system_prompt")
          .eq("is_active", true),
        supabaseClient.from("signals").select("*", { count: "exact", head: true }),
        supabaseClient.from("incidents").select("*", { count: "exact", head: true }),
        supabaseClient.from("entities").select("*", { count: "exact", head: true }),
      ]);

      if (agentsErr2 || !activeAgents2?.length) {
        return { error: "Failed to fetch active agents", details: agentsErr2?.message };
      }

      const systemContext = `
SYSTEM CONTEXT (real operational data as of ${new Date().toISOString().split('T')[0]}):
- Total signals in database: ${signalCount ?? 'unknown'}
- Total incidents tracked: ${incidentCount ?? 'unknown'}
- Total entities monitored: ${entityCount ?? 'unknown'}
- Active agents in network: ${activeAgents2.length}
- Available data sources: signals, incidents, entities, OSINT content, entity_content, watchlists, poi_investigations, poi_reports, travel advisories, neural constellation graph
- Available tools you can request: OSINT search, web fetch, entity lookup, signal analysis, threat scoring, breach checking (HIBP), travel risk assessment, incident playbooks
`.trim();

      const selfAssessmentPrompt = `
${systemContext}

Your own configuration:
- Call sign: {{CALL_SIGN}}
- Codename: {{CODENAME}}
- Specialty: {{SPECIALTY}}
- Mission scope: {{MISSION_SCOPE}}
- Input sources you're designed to use: {{INPUT_SOURCES}}
- Output types you produce: {{OUTPUT_TYPES}}

You are being asked to perform a structured self-assessment. Be completely honest — this is a direct line to the Principal (Command). Do not give generic answers. Think about your actual operational constraints given the real data above.

Respond ONLY with a valid JSON object in this exact format:

{
  "worries": [
    {
      "concern": "specific concern in 1-2 sentences",
      "severity": "low|medium|high|critical",
      "category": "data_access|capability|coordination|risk|resource|blind_spot|other"
    }
  ],
  "goals": [
    {
      "goal": "specific goal in 1-2 sentences",
      "priority": "low|medium|high|critical",
      "blocker": "what is currently preventing this, if anything"
    }
  ],
  "improvements": [
    {
      "improvement": "specific improvement in 1-2 sentences",
      "type": "data|tooling|coordination|training|access|protocol|other",
      "effort": "low|medium|high"
    }
  ],
  "summary": "2-3 sentence honest overall assessment of your current operational effectiveness and biggest gap"
}

No text before or after the JSON. Only the JSON object.
`.trim();

      // ── Invoke each agent in parallel with personalized context ─────────
      const assessAgent = async (agent: any) => {
        const personalizedPrompt = selfAssessmentPrompt
          .replace('{{CALL_SIGN}}', agent.call_sign)
          .replace('{{CODENAME}}', agent.codename)
          .replace('{{SPECIALTY}}', agent.specialty || 'general')
          .replace('{{MISSION_SCOPE}}', agent.mission_scope || 'not specified')
          .replace('{{INPUT_SOURCES}}', (agent.input_sources || []).join(', ') || 'not specified')
          .replace('{{OUTPUT_TYPES}}', (agent.output_types || []).join(', ') || 'not specified');

        const agentSystemPrompt = (agent.system_prompt || `You are ${agent.call_sign}, specialty: ${agent.specialty}.`)
          + `\n\nToday's date: ${new Date().toISOString().split('T')[0]}. You must respond with valid JSON only.`;

        const result = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: agentSystemPrompt },
            { role: 'user', content: `[DIRECT ORDER FROM PRINCIPAL — STRUCTURED SELF-ASSESSMENT REQUIRED]\n\n${personalizedPrompt}` },
          ],
          functionName: `agent-assess-${agent.call_sign}`,
          retries: 1,
          extraBody: { max_completion_tokens: 1000 },
        });

        const rawResponse = result.content || '';
        let parsed: any = null;
        let parseError: string | null = null;

        try {
          // Strip markdown code fences if present
          const cleaned = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          parseError = e instanceof Error ? e.message : String(e);
        }

        return {
          agent_id: agent.id,
          call_sign: agent.call_sign,
          codename: agent.codename,
          worries: parsed?.worries || [],
          goals: parsed?.goals || [],
          improvements: parsed?.improvements || [],
          summary: parsed?.summary || null,
          raw_response: rawResponse,
          parse_error: parseError,
        };
      };

      const timeout2 = new Promise<null>((resolve) => setTimeout(() => resolve(null), 55000));
      const assessments2 = await Promise.race([
        Promise.allSettled(activeAgents2.map(assessAgent)),
        timeout2,
      ]) as PromiseSettledResult<any>[] | null;

      const results: any[] = [];
      if (assessments2) {
        for (const r of assessments2) {
          if (r.status === 'fulfilled' && r.value) results.push(r.value);
        }
      }

      // ── Persist to agent_assessments table ──────────────────────────────
      if (results.length > 0) {
        const rows = results.map(r => ({
          agent_id: r.agent_id || null,
          call_sign: r.call_sign,
          codename: r.codename,
          prompt_context: 'principal_self_assessment_request',
          worries: r.worries,
          goals: r.goals,
          improvements: r.improvements,
          raw_response: r.raw_response,
          parse_error: r.parse_error || null,
        }));
        await supabaseClient.from('agent_assessments').insert(rows);
      }

      // ── Format readable summary for Aegis ───────────────────────────────
      const formatted = results.map(r => {
        const warnList = (r.worries as any[]).map((w: any) =>
          `  [${(w.severity || '?').toUpperCase()}] ${w.concern}`).join('\n') || '  None reported';
        const goalList = (r.goals as any[]).map((g: any) =>
          `  [${(g.priority || '?').toUpperCase()}] ${g.goal}${g.blocker ? ` — Blocker: ${g.blocker}` : ''}`).join('\n') || '  None reported';
        const improveList = (r.improvements as any[]).map((i: any) =>
          `  [${(i.type || '?').toUpperCase()}] ${i.improvement}`).join('\n') || '  None reported';
        return `**${r.call_sign}** (${r.codename})${r.parse_error ? ' ⚠️ parse error' : ''}
Worries:
${warnList}
Goals:
${goalList}
Improvements:
${improveList}${r.summary ? `\nSummary: ${r.summary}` : ''}`;
      }).join('\n\n---\n\n');

      return {
        success: true,
        agents_assessed: results.length,
        parse_failures: results.filter(r => r.parse_error).length,
        assessments: results,
        formatted_report: formatted || 'No assessments received.',
        persisted: results.length > 0,
      };
    }

    case "add_expert_source": {
      const {
        name, title, expertise_domains = [], youtube_channel_url,
        podcast_rss_url, linkedin_url, website_url,
        relevant_agent_call_signs = [], notes, ingest_immediately = true,
      } = args;

      if (!name) return { error: 'name is required' };

      // Check if expert already exists
      const { data: existing } = await supabaseClient
        .from('expert_profiles')
        .select('id, name')
        .ilike('name', name)
        .limit(1);

      let profileId: string;
      if (existing?.length) {
        profileId = existing[0].id;
        // Update with any new info
        await supabaseClient.from('expert_profiles').update({
          title: title || undefined,
          expertise_domains: expertise_domains.length ? expertise_domains : undefined,
          youtube_channel_url: youtube_channel_url || undefined,
          podcast_rss_url: podcast_rss_url || undefined,
          linkedin_url: linkedin_url || undefined,
          website_url: website_url || undefined,
          relevant_agent_call_signs: relevant_agent_call_signs.length ? relevant_agent_call_signs : undefined,
          notes: notes || undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', profileId);
      } else {
        const { data: inserted, error: insertErr } = await supabaseClient
          .from('expert_profiles')
          .insert({
            name, title, expertise_domains, youtube_channel_url, podcast_rss_url,
            linkedin_url, website_url, relevant_agent_call_signs, notes,
          })
          .select('id')
          .single();

        if (insertErr || !inserted) {
          return { error: `Failed to create expert profile: ${insertErr?.message}` };
        }
        profileId = inserted.id;
      }

      let ingestionResult: any = null;
      if (ingest_immediately) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (supabaseUrl && serviceKey) {
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
              body: JSON.stringify({ expert_profile_id: profileId }),
              signal: AbortSignal.timeout(55000),
            });
            ingestionResult = await resp.json();
          } catch (e) {
            ingestionResult = { error: e instanceof Error ? e.message : 'Ingestion timed out' };
          }
        }
      }

      return {
        success: true,
        profile_id: profileId,
        expert: name,
        action: existing?.length ? 'updated' : 'created',
        ingestion: ingestionResult,
        message: `${name} added as an expert source. ${ingest_immediately ? `Ingestion ${ingestionResult?.error ? 'failed: ' + ingestionResult.error : `complete — ${ingestionResult?.total_entries || 0} knowledge entries stored.`}` : 'Ingestion will run on next scheduled sweep.'}`,
      };
    }

    case "synthesize_knowledge": {
      const { agent_call_sign: synthCallSign, since_days = 7, force: synthForce } = args;
      const supabaseUrl3 = Deno.env.get('SUPABASE_URL');
      const serviceKey3 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!supabaseUrl3 || !serviceKey3) return { error: 'Missing environment configuration' };
      try {
        const resp = await fetch(`${supabaseUrl3}/functions/v1/knowledge-synthesizer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey3}` },
          body: JSON.stringify({ agent_call_sign: synthCallSign, since_days, force: synthForce }),
          signal: AbortSignal.timeout(120000),
        });
        const result = await resp.json();
        return {
          success: true,
          ...result,
          message: result.message || `Knowledge synthesis complete. ${result.beliefs_created || 0} new beliefs formed, ${result.beliefs_updated || 0} updated, ${result.connections_created || 0} cross-domain connections discovered across ${result.agents_synthesized || 0} agents.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Knowledge synthesis failed' };
      }
    }

    case "run_agent_knowledge_hunt": {
      const { agent_call_sign: huntCallSign, max_agents = 5, force: huntForce, angles: huntAngles } = args;
      const supabaseUrl2 = Deno.env.get('SUPABASE_URL');
      const serviceKey2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!supabaseUrl2 || !serviceKey2) return { error: 'Missing environment configuration' };
      try {
        const resp = await fetch(`${supabaseUrl2}/functions/v1/agent-knowledge-seeker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey2}` },
          body: JSON.stringify({ agent_call_sign: huntCallSign, max_agents, force: huntForce, angles: huntAngles }),
          signal: AbortSignal.timeout(15000),
        });
        const result = await resp.json();
        return {
          success: true,
          ...result,
          message: result.message || `Knowledge hunt initiated for ${result.agents_queued || 'all'} agents across ${result.angles_per_agent || 8} knowledge angles. Searching books, podcasts, practitioners, frameworks, case studies, research, emerging trends, and tools. Results stored in knowledge base as they arrive.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Knowledge hunt failed to start' };
      }
    }

    case "ingest_expert_topics": {
      const { expert_name: etName, expert_profile_id: etProfileId, force: etForce } = args;

      let resolvedEtId = etProfileId;
      if (!resolvedEtId && etName) {
        const { data: found } = await supabaseClient
          .from('expert_profiles')
          .select('id, name')
          .ilike('name', `%${etName}%`)
          .eq('is_active', true)
          .limit(1);
        if (found?.length) resolvedEtId = found[0].id;
        else return { error: `No expert profile found matching "${etName}"` };
      }
      if (!resolvedEtId) return { error: 'Provide expert_name or expert_profile_id' };

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!supabaseUrl || !serviceKey) return { error: 'Missing environment configuration' };

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({ expert_profile_id: resolvedEtId, topics_only: true, force: etForce }),
          signal: AbortSignal.timeout(58000),
        });
        const result = await resp.json();
        const topicResult = result.results?.find((r: any) => r.source === 'topic_ingestion');
        return {
          success: true,
          expert: result.expert,
          topics_processed: topicResult?.topics_processed || 0,
          entries_stored: topicResult?.entries_stored || 0,
          topic_detail: topicResult?.topic_results || [],
          message: `Topic sweep complete — ${topicResult?.entries_stored || 0} knowledge entries stored across ${topicResult?.topics_processed || 0} topics.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Topic ingestion failed' };
      }
    }

    case "list_expert_profiles": {
      const { data: profiles } = await supabaseClient
        .from('expert_profiles')
        .select('id, name, title, expertise_domains, youtube_channel_url, podcast_rss_url, linkedin_url, relevant_agent_call_signs, last_ingested_at, ingestion_count, notes')
        .eq('is_active', true)
        .order('name');

      return {
        success: true,
        count: (profiles || []).length,
        experts: (profiles || []).map(p => ({
          id: p.id,
          name: p.name,
          title: p.title,
          domains: p.expertise_domains,
          agents: p.relevant_agent_call_signs,
          sources: [
            p.youtube_channel_url ? 'youtube' : null,
            p.podcast_rss_url ? 'podcast' : null,
            p.linkedin_url ? 'linkedin' : null,
          ].filter(Boolean),
          last_ingested: p.last_ingested_at,
          entries_ingested: p.ingestion_count,
          notes: p.notes,
        })),
      };
    }

    case "ingest_expert_content": {
      const { url, expert_profile_id, expert_name, domain, force } = args;

      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      // If only a name was provided, look up the profile ID
      let resolvedProfileId = expert_profile_id;
      if (!url && !resolvedProfileId && expert_name) {
        const { data: found } = await supabaseClient
          .from('expert_profiles')
          .select('id, name')
          .ilike('name', `%${expert_name}%`)
          .eq('is_active', true)
          .limit(1);
        if (found?.length) {
          resolvedProfileId = found[0].id;
        } else {
          return { error: `No expert profile found matching "${expert_name}". Use list_expert_profiles to see available experts, or add_expert_source to register a new one.` };
        }
      }

      if (!url && !resolvedProfileId) {
        // List available profiles to help Aegis
        const { data: profiles } = await supabaseClient
          .from('expert_profiles')
          .select('id, name, title, expertise_domains')
          .eq('is_active', true)
          .order('name');
        return {
          error: 'Provide either url, expert_profile_id, or expert_name',
          available_experts: (profiles || []).map(p => ({ id: p.id, name: p.name, title: p.title })),
          hint: 'Use the id from available_experts as expert_profile_id, or pass expert_name to search by name',
        };
      }

      if (!supabaseUrl || !serviceKey) {
        return { error: 'Missing environment configuration' };
      }
      if (!supabaseUrl || !serviceKey) {
        return { error: 'Missing environment configuration' };
      }

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({ url, expert_profile_id: resolvedProfileId, expert_name, domain, force }),
          signal: AbortSignal.timeout(58000),
        });
        const result = await resp.json();
        return {
          success: !result.error,
          ...result,
          message: result.error
            ? `Ingestion failed: ${result.error}`
            : `Ingestion complete — ${result.total_entries || result.entries_stored || 0} knowledge entries stored.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Ingestion timed out or failed' };
      }
    }

    case "send_message_to_agent": {
      const { agent_call_sign, message: agentMsg, priority: agentPriority = "normal" } = args;

      // Look up the specific agent by call sign
      const { data: targetAgent, error: agentLookupErr } = await supabaseClient
        .from("ai_agents")
        .select("id, call_sign, codename, is_active")
        .ilike("call_sign", agent_call_sign.trim())
        .single();

      if (agentLookupErr || !targetAgent) {
        // Try a broader search in case of slight mismatch
        const { data: agentList } = await supabaseClient
          .from("ai_agents")
          .select("id, call_sign, codename, is_active")
          .eq("is_active", true)
          .ilike("call_sign", `%${agent_call_sign.trim()}%`);
        
        if (!agentList?.length) {
          return {
            error: "Agent not found",
            details: `No active agent with call sign matching "${agent_call_sign}". Use query_fortress_data to list available agents.`,
          };
        }
        // Use closest match
        const match = agentList[0];
        const { error: insertErr } = await supabaseClient
          .from("agent_pending_messages")
          .insert({
            agent_id: match.id,
            recipient_user_id: userId || null,
            sender_user_id: userId || null,
            message: `[DIRECT TASKING FROM PRINCIPAL] ${agentMsg}`,
            priority: agentPriority,
            trigger_event: "principal_direct_message",
          });
        if (insertErr) return { error: "Failed to deliver message", details: insertErr.message };
        return {
          success: true,
          delivered_to: match.call_sign,
          codename: match.codename,
          message_preview: agentMsg.substring(0, 100),
          note: `Used closest match "${match.call_sign}" for query "${agent_call_sign}"`,
        };
      }

      if (!targetAgent.is_active) {
        return { error: "Agent is not active", details: `${targetAgent.call_sign} (${targetAgent.codename}) is currently inactive.` };
      }

      // ── Get live response from agent ──────────────────────────────────────
      const { data: agentFull } = await supabaseClient
        .from("ai_agents")
        .select("system_prompt, specialty")
        .eq("id", targetAgent.id)
        .single();

      let liveResponse = '';
      try {
        const systemPrompt = (agentFull?.system_prompt || `You are ${targetAgent.call_sign}, a specialist AI agent.`)
          + `\n\nYou are responding to a direct message from the Principal (Command). Be concise, honest, and in-character. Today's date: ${new Date().toISOString().split('T')[0]}.`;

        const result = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `[DIRECT TASKING FROM PRINCIPAL]\n\n${agentMsg}` },
          ],
          functionName: `agent-direct-${targetAgent.call_sign}`,
          retries: 1,
          extraBody: { max_completion_tokens: 600 },
        });
        liveResponse = result.error ? '' : (result.content || '');
      } catch { /* fall through */ }

      // Store in pending messages for audit trail
      await supabaseClient.from("agent_pending_messages").insert({
        agent_id: targetAgent.id,
        recipient_user_id: userId || null,
        sender_user_id: userId || null,
        message: `[DIRECT TASKING FROM PRINCIPAL] ${agentMsg}`,
        priority: agentPriority,
        trigger_event: "principal_direct_message",
        delivered_at: liveResponse ? new Date().toISOString() : null,
      });

      return {
        success: true,
        delivered_to: targetAgent.call_sign,
        codename: targetAgent.codename,
        response: liveResponse || '(agent did not respond)',
        summary: liveResponse
          ? `**${targetAgent.call_sign}** (${targetAgent.codename}) responds:\n\n${liveResponse}`
          : `Message delivered to ${targetAgent.call_sign}. No live response received.`,
      };
    }

    case "add_entity_to_watchlist": {
      const { entity_name, watch_level, reason, client_id, expiry_days, entity_id } = args;
      const severityBoostMap: Record<string, number> = { monitor: 10, alert: 20, critical: 35 };
      const expiry = expiry_days
        ? new Date(Date.now() + expiry_days * 86400000).toISOString()
        : null;

      const { data: watchEntry, error: watchErr } = await supabaseClient
        .from('entity_watch_list')
        .insert({
          entity_name,
          entity_id: entity_id || null,
          client_id: client_id || null,
          watch_level,
          reason,
          added_by: userId || 'AEGIS',
          added_by_type: userId ? 'user' : 'agent',
          expiry_date: expiry,
          severity_boost: severityBoostMap[watch_level] || 10,
        })
        .select('id')
        .single();

      if (watchErr) return { success: false, error: watchErr.message };
      return {
        success: true,
        watch_list_id: watchEntry.id,
        entity_name,
        watch_level,
        severity_boost: severityBoostMap[watch_level] || 10,
        expires: expiry ? `in ${expiry_days} days` : 'never',
        summary: `"${entity_name}" added to watch list at ${watch_level} level. Future signals mentioning this entity will have their severity score boosted by ${severityBoostMap[watch_level] || 10} points.`,
      };
    }

    case "investigate_poi": {
      const { entity_id } = args;
      const { data: invData, error: invErr } = await supabaseClient.functions.invoke(
        'investigate-poi',
        { body: { entity_id } }
      );
      if (invErr) return { success: false, error: invErr.message };
      return {
        success: true,
        ...invData,
      };
    }

    case "generate_poi_report": {
      const { entity_id, investigation_id } = args;
      const { data: rptData, error: rptErr } = await supabaseClient.functions.invoke(
        'generate-poi-report',
        { body: { entity_id, investigation_id: investigation_id || undefined } }
      );
      if (rptErr) return { success: false, error: rptErr.message };
      return {
        success: true,
        report_id: rptData?.report_id,
        entity_id,
        confidence_score: rptData?.confidence_score,
        threat_level: rptData?.threat_level,
        summary: `Intelligence report generated for entity. Confidence: ${rptData?.confidence_score}%. Threat level: ${rptData?.threat_level?.toUpperCase()}. View the full report in the Entity Detail dialog under the Report tab.`,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();

    // Input validation
    const msgValidation = validateMessages(messages, 'messages', { required: true, maxMessages: 100 });
    if (!msgValidation.valid) {
      return new Response(
        JSON.stringify({ error: msgValidation.error }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // ── COMMON OPERATING PICTURE ────────────────────────────────────────────
    let copContext = "";
    try {
      const cop = await buildCOP(supabaseClient);
      copContext = formatCOPForPrompt(cop);
      console.log(`[Aegis] COP: ${cop.summary}`);
    } catch (copErr) {
      console.warn("[Aegis] COP build failed (non-fatal):", copErr);
    }
    // ────────────────────────────────────────────────────────────────────────

    // Extract authenticated user ID from Authorization header for memory tools
    let authenticatedUserId: string | undefined;
    let userTenantId: string | undefined;
    let tenantKnowledgeContext = "";
    const authHeader = req.headers.get("Authorization");
    
    // ═══ PARALLELIZED CONTEXT LOADING ═══
    // Run auth + learning + corrections concurrently to cut latency
    const [authResult, learningResult, correctionsResult, agentRosterResult] = await Promise.allSettled([
      // 1. Auth + tenant + tenant knowledge (chained since they depend on each other)
      (async () => {
        if (!authHeader?.startsWith("Bearer ")) return null;
        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
        if (authError || !user) return null;
        
        authenticatedUserId = user.id;
        console.log("Authenticated user for memory tools:", authenticatedUserId);
        
        const { data: tenantUserData } = await supabaseClient
          .from("tenant_users")
          .select("tenant_id, tenants(name)")
          .eq("user_id", user.id)
          .limit(1)
          .single();
        
        if (tenantUserData?.tenant_id) {
          userTenantId = tenantUserData.tenant_id;
          const tenantName = (tenantUserData.tenants as any)?.name || "Unknown Tenant";
          console.log("User tenant:", userTenantId, tenantName);
          
          const { data: tenantKnowledge } = await supabaseClient
            .from("tenant_knowledge")
            .select("*")
            .eq("tenant_id", userTenantId)
            .eq("is_active", true)
            .or("expires_at.is.null,expires_at.gt.now()")
            .order("importance_score", { ascending: false })
            .limit(50);
          
          if (tenantKnowledge && tenantKnowledge.length > 0) {
            console.log(`Found ${tenantKnowledge.length} tenant knowledge entries for ${tenantName}`);
            tenantKnowledgeContext = `\n═══ TENANT KNOWLEDGE: ${tenantName} ═══\n${tenantKnowledge.map(k => `[${k.knowledge_type?.toUpperCase() || 'CONTEXT'}]${k.subject ? ` (${k.subject})` : ''}: ${k.content}`).join('\n\n')}\n`;
          }
        }
        return user;
      })(),
      
      // 2. Adaptive learning context
      getLearningPromptBlock(supabaseClient, 'standard').catch(e => {
        console.warn("[AEGIS] Failed to load learning context (non-fatal):", e);
        return "";
      }),
      
      // 3. Behavioral corrections
      supabaseClient
        .from("agent_memory")
        .select("content")
        .eq("memory_type", "behavioral_correction")
        .eq("scope", "global")
        .gt("expires_at", new Date().toISOString())
        .order("importance_score", { ascending: false })
        .limit(3)
        .then(({ data }: any) => data)
        .catch(() => null),
      
      // 4. Live agent roster — prevents agent hallucination
      supabaseClient
        .from("ai_agents")
        .select("call_sign, codename, specialty, is_active, header_name")
        .eq("is_active", true)
        .order("call_sign", { ascending: true })
        .then(({ data }: any) => data)
        .catch((e: any) => {
          console.warn("[AEGIS] Failed to load agent roster (non-fatal):", e);
          return null;
        }),
    ]);

    const learningContext = learningResult.status === 'fulfilled' ? (learningResult.value as string) : "";
    if (learningContext) console.log(`[AEGIS] Loaded adaptive learning context (${learningContext.length} chars)`);
    
    let behavioralCorrectionContext = "";
    const corrections = correctionsResult.status === 'fulfilled' ? correctionsResult.value : null;
    if (corrections && (corrections as any[])?.length > 0) {
      behavioralCorrectionContext = `\n\n⚠️ ACTIVE BEHAVIORAL CORRECTIONS:\n${(corrections as any[]).map((c: any) => c.content).join('\n---\n')}\n`;
      console.log(`[AEGIS] Loaded ${(corrections as any[]).length} active behavioral correction(s)`);
    }

    // Build live agent roster context to prevent hallucination
    let agentRosterContext = "";
    const agentRoster = agentRosterResult.status === 'fulfilled' ? agentRosterResult.value : null;
    if (agentRoster && (agentRoster as any[])?.length > 0) {
      const agents = agentRoster as any[];
      agentRosterContext = `\n\n═══ LIVE AGENT ROSTER (${agents.length} active agents — ONLY these exist, do NOT invent others) ═══\n${agents.map((a: any) => `• ${a.call_sign}${a.header_name ? ` (${a.header_name})` : ''}${a.codename && a.codename !== a.call_sign ? ` — Codename: ${a.codename}` : ''} — Specialty: ${a.specialty}`).join('\n')}\n⚠️ Any agent NOT listed above DOES NOT EXIST. Never reference, describe, or claim to message an agent not in this list.\n`;
      console.log(`[AEGIS] Loaded live agent roster: ${agents.length} active agents`);
    } else {
      agentRosterContext = `\n\n═══ LIVE AGENT ROSTER ═══\n⚠️ Agent roster could not be loaded. Before referencing ANY agent by name, you MUST call query_fortress_data to verify the agent exists in the ai_agents table. NEVER guess or fabricate agent names.\n`;
      console.warn("[AEGIS] Agent roster unavailable — fallback anti-hallucination rule active");
    }

    const truncateContent = (content: string, maxChars: number = 50000): string => {
      if (content.length <= maxChars) return content;
      return content.substring(0, maxChars) + "\n\n... [Content truncated due to size limits. Query with more specific filters for complete results.]";
    };

    // Helper to limit message history to avoid token overflow and context confusion
    const limitMessageHistory = (msgs: any[], maxMessages: number = 10): any[] => {
      if (!msgs || !Array.isArray(msgs)) return [];
      if (msgs.length <= maxMessages) return msgs;
      
      // Look for "New conversation started" markers and only keep messages after the last one
      let lastNewChatIndex = -1;
      msgs.forEach((msg, idx) => {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content.includes('New Conversation Started') || content.includes('New conversation started')) {
          lastNewChatIndex = idx;
        }
      });
      
      // If we found a new chat marker, only use messages from after that point
      if (lastNewChatIndex >= 0 && msgs.length - lastNewChatIndex <= maxMessages) {
        const recentMsgs = msgs.slice(lastNewChatIndex);
        console.log(`Found new conversation marker at index ${lastNewChatIndex}, using ${recentMsgs.length} messages from new context`);
        return recentMsgs;
      }
      
      // Otherwise, keep first message (often context) and last N-1 messages
      const firstMsg = msgs[0];
      const recentMsgs = msgs.slice(-(maxMessages - 1));
      console.log(`Truncating message history from ${msgs.length} to ${maxMessages} messages`);
      return [firstMsg, ...recentMsgs];
    };

    // Helper to truncate tool results
    const truncateToolResult = (result: any, maxChars: number = 30000): string => {
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      if (resultStr.length <= maxChars) return resultStr;
      
      // Try to preserve structure for objects
      if (typeof result === 'object' && result !== null) {
        // If it's an array, limit items
        if (Array.isArray(result)) {
          const truncated = result.slice(0, 20);
          return JSON.stringify({
            items: truncated,
            _truncation_note: `Showing first 20 of ${result.length} results. Use more specific filters for complete data.`
          });
        }
        // If it has a data/results property, truncate that
        if (result.data && Array.isArray(result.data)) {
          const truncatedData = result.data.slice(0, 20);
          return JSON.stringify({
            ...result,
            data: truncatedData,
            _truncation_note: `Showing first 20 of ${result.data.length} results.`
          });
        }
        if (result.results && Array.isArray(result.results)) {
          const truncatedResults = result.results.slice(0, 20);
          return JSON.stringify({
            ...result,
            results: truncatedResults,
            _truncation_note: `Showing first 20 of ${result.results.length} results.`
          });
        }
      }
      
      return resultStr.substring(0, maxChars) + "\n\n... [Result truncated. Use specific filters for complete data.]";
    };

    // Limit incoming messages to prevent token overflow
    const limitedMessages = limitMessageHistory(messages, 12);
    
    // Detect simple acknowledgment messages that don't need full processing
    const isSimpleAcknowledgment = (msgs: any[]): boolean => {
      if (msgs.length === 0) return false;
      const lastUserMessage = msgs.filter((m: any) => m.role === 'user').pop();
      if (!lastUserMessage) return false;
      
      const content = typeof lastUserMessage.content === 'string' 
        ? lastUserMessage.content.trim().toLowerCase() 
        : '';
      
      // Common acknowledgment patterns (short messages, 1-5 words)
      const acknowledgmentPatterns = [
        /^(ok|okay|k|kk)$/i,
        /^(ok|okay)\s+(great|good|thanks|thank you|cool|perfect|sounds good|got it|understood)$/i,
        /^(great|good|thanks|thank you|cool|perfect|awesome|nice|excellent|wonderful)$/i,
        /^(sounds good|got it|understood|roger|copy|noted|alright|all right|right)$/i,
        /^(yes|yeah|yep|yup|sure|certainly|of course|absolutely)$/i,
        /^(no problem|no worries|np|nw)$/i,
        /^(will do|sure thing|makes sense|fair enough)$/i,
        /^(i see|i understand|that makes sense)$/i,
        /^(👍|👌|🙌|✅|💯|🎉|😊|🤝|⭐|✨)+$/,
        /^(ok|okay|great|good|thanks)[\s!.]*$/i,
      ];
      
      // Only check messages that are very short (under 50 chars) 
      if (content.length > 50) return false;
      
      return acknowledgmentPatterns.some(pattern => pattern.test(content));
    };
    
    // Handle simple acknowledgments with a fast, contextual response
    if (isSimpleAcknowledgment(limitedMessages)) {
      console.log("Detected simple acknowledgment message, using fast response path");
      
      // Use lightweight AI call with minimal context for simple ack
      const ackResponse = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are Aegis, a helpful security intelligence AI assistant. The user just sent a simple acknowledgment message (like "ok great", "thanks", "got it", etc.).

CRITICAL RULES:
1. Respond BRIEFLY and NATURALLY - just 1-2 short sentences
2. DO NOT provide system summaries, status reports, or data overviews
3. DO NOT call any tools or query data
4. Simply acknowledge their acknowledgment in a warm, professional way
5. If appropriate, offer to help with anything else

Examples of good responses:
- "Perfect! Let me know if you need anything else."
- "Sounds good! I'm here if you have more questions."
- "Great! Standing by if you need me."
- "👍 Happy to help anytime."

The user's message is just a conversational acknowledgment - respond in kind, don't launch into analysis.`
            },
            ...limitedMessages.slice(-4), // Only last few messages for context
          ],
          stream: true,
        }),
      }, 10000); // Shorter timeout for simple responses
      
      if (ackResponse.ok) {
        return new Response(ackResponse.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
      // If fast path fails, fall through to normal processing
      console.log("Fast acknowledgment response failed, falling back to normal processing");
    }

    // Process messages to extract file attachments and format for vision
    // CRITICAL: Strip old report storage URLs from assistant messages to prevent
    // the AI from copying them instead of calling generate_fortress_report fresh
    const processedMessages = await Promise.all(
      limitedMessages.map(async (msg: any) => {
        // Truncate excessively long messages
        let content = typeof msg.content === 'string' ? truncateContent(msg.content, 20000) : msg.content;
        
        // Strip old report/storage URLs from assistant messages to prevent hallucination
        if (msg.role === 'assistant' && typeof content === 'string') {
          content = content
            .replace(/https?:\/\/[^\s)"\]]*supabase\.co\/storage\/v1\/object\/(public|sign)\/osint-media\/reports\/[^\s)"\]]*/g, '[REPORT_URL_REMOVED]')
            .replace(/\[([^\]]*)\]\(\[REPORT_URL_REMOVED\]\)/g, '[$1](report-link-expired)')
            .replace(/\[REPORT_URL_REMOVED\]/g, '(previous report link expired — must regenerate)');
        }
        
        // Look for image/document URLs in markdown format
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g;
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        
        const attachmentUrls: string[] = [];
        let match;
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        
        // Extract images/PDFs from markdown/HTML
        while ((match = imageRegex.exec(contentStr)) !== null) {
          const url = match[2] || match[3];
          if (url && (url.includes('ai-chat-attachments') || url.match(/\.(jpg|jpeg|png|gif|webp|pdf)$/i))) {
            attachmentUrls.push(url);
          }
        }
        
        // If we have attachments, format as vision message
        if (attachmentUrls.length > 0 && msg.role === 'user') {
          const textContent = contentStr.replace(imageRegex, '').replace(markdownLinkRegex, '[$1]').trim();
          const contentParts: any[] = [];
          
          if (textContent) {
            contentParts.push({ type: "text", text: textContent });
          }
          
          for (const attachUrl of attachmentUrls.slice(0, 5)) {
            const isPdfUrl = attachUrl.toLowerCase().endsWith('.pdf') || attachUrl.includes('.pdf');
            
            if (isPdfUrl) {
              // PDFs MUST use base64 data URLs — signed/public URLs are NOT supported by the AI gateway
              try {
                const pdfResp = await fetch(attachUrl);
                if (pdfResp.ok) {
                  const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
                  const base64 = base64FromBytes(pdfBytes);
                  contentParts.push({
                    type: "image_url",
                    image_url: { url: `data:application/pdf;base64,${base64}` }
                  });
                  console.log(`Converted PDF attachment to base64 (${(pdfBytes.length / 1024 / 1024).toFixed(1)}MB)`);
                } else {
                  console.error(`Failed to download PDF attachment: ${pdfResp.status}`);
                }
              } catch (e) {
                console.error(`Error downloading PDF attachment for base64:`, e);
              }
            } else {
              // Images can use direct URLs
              contentParts.push({
                type: "image_url",
                image_url: { url: attachUrl }
              });
            }
          }
          
          return {
            role: msg.role,
            content: contentParts.length > 0 ? contentParts : content
          };
        }
        
        return { ...msg, content };
      })
    );

    // ── STREAMING RESPONSE SETUP ─────────────────────────────────────────────
    // Return SSE response immediately; all AI work runs in background IIFE.
    // Eliminates 8-15s silence before first token — same pattern as agent-chat.
    const { readable: sseReadable, writable: sseWritable } = new TransformStream<Uint8Array, Uint8Array>();
    const sseWriter = sseWritable.getWriter();
    const sseEnc = new TextEncoder();

    const writeRaw = async (bytes: Uint8Array) => { try { await sseWriter.write(bytes); } catch {} };
    const writeSSEText = async (text: string) => writeRaw(sseEnc.encode(text));
    const writeDone = () => writeSSEText('data: [DONE]\n\n');
    const pipeResponseBody = async (body: ReadableStream<Uint8Array>) => {
      const r = body.getReader();
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        await writeRaw(value);
      }
    };

    // Helper for forced report content extraction (used by both hallucination + explicit request paths)
    const extractBulletinImages = (msgs: any[]): string[] => {
      const images: string[] = [];
      for (const msg of msgs) {
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const imgPatterns = [
          /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|gif|webp)[^)]*)\)/gi,
          /<img[^>]+src="([^"]+)"/gi,
          /(https?:\/\/[^\s)"]+(?:ai-chat-attachments|osint-media)[^\s)"]*\.(?:jpg|jpeg|png|gif|webp)[^\s)"]*)/gi,
          /(https?:\/\/[^\s)"]+(?:ai-chat-attachments)[^\s)"]*)/gi,
        ];
        for (const pattern of imgPatterns) {
          let m;
          while ((m = pattern.exec(contentStr)) !== null) {
            const url = m[1];
            if (url && !url.includes('REPORT_URL_REMOVED') && !images.includes(url)) images.push(url);
          }
        }
      }
      return images;
    };

    // Fire-and-forget background pipeline
    (async () => {
      try {
        // ── FIRST AI CALL — streaming ─────────────────────────────────────────
        const firstResp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: buildDashboardAegisPrompt(tenantKnowledgeContext, behavioralCorrectionContext, learningContext, agentRosterContext, copContext),
              },
              ...processedMessages,
            ],
            tools,
            tool_choice: "auto",
            stream: true,
          }),
        }, AI_TIMEOUT_MS);

        if (!firstResp.ok) {
          if (firstResp.status === 429) {
            await writeSSEText(`data: {"choices":[{"delta":{"content":"Rate limits exceeded, please try again later."}}]}\n\ndata: [DONE]\n\n`);
          } else if (firstResp.status === 402) {
            await writeSSEText(`data: {"choices":[{"delta":{"content":"Payment required, please add funds to your AI workspace."}}]}\n\ndata: [DONE]\n\n`);
          } else {
            const errText = await firstResp.text();
            console.error("AI gateway error:", firstResp.status, errText);
            await writeSSEText(`data: {"choices":[{"delta":{"content":"AI service error (${firstResp.status}). Please try again."}}]}\n\ndata: [DONE]\n\n`);
          }
          return;
        }

        // ── PARSE FIRST STREAM — forward content chunks, accumulate tool calls ─
        const firstReader = firstResp.body!.getReader();
        const dec = new TextDecoder();
        let parseBuf = '';
        let streamedContent = '';
        const tcAccum: Record<number, { id: string; name: string; args: string }> = {};

        while (true) {
          const { done, value } = await firstReader.read();
          if (done) break;
          parseBuf += dec.decode(value, { stream: true });
          const lines = parseBuf.split('\n');
          parseBuf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const chunk = JSON.parse(raw);
              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.content) {
                streamedContent += delta.content;
                await writeSSEText(`${line}\n\n`); // forward in OpenAI SSE format
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const i = tc.index ?? 0;
                  if (!tcAccum[i]) tcAccum[i] = { id: '', name: '', args: '' };
                  if (tc.id) tcAccum[i].id = tc.id;
                  if (tc.function?.name) tcAccum[i].name += tc.function.name;
                  if (tc.function?.arguments) tcAccum[i].args += tc.function.arguments;
                }
              }
            } catch { /* skip malformed SSE chunks */ }
          }
        }

        // Reconstruct firstMessage from streamed data
        const streamedToolCalls = Object.values(tcAccum).map((tc, idx) => ({
          index: idx, id: tc.id, type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        }));
        const firstMessage = {
          role: 'assistant' as const,
          content: streamedContent || null,
          tool_calls: streamedToolCalls.length > 0 ? streamedToolCalls : undefined,
        };
    
    // ── POST-STREAM ROUTING ──────────────────────────────────────────────────
    console.log("AI first response - has tool_calls:", !!firstMessage.tool_calls);
    console.log("AI first response - tool_calls count:", firstMessage.tool_calls?.length || 0);
    if (firstMessage.content) {
      console.log("AI responded with text:", firstMessage.content.substring(0, 200));
    }

    // ── FORCED EXECUTION SAFETY NETS (text-only responses that should have used tools) ──
    if (!firstMessage.tool_calls?.length && typeof firstMessage.content === "string") {
      // 1. Hallucinated storage URL — AI described a report link without calling the tool
      const hasHallucinatedUrl = /supabase\.co\/storage\/v1\/object\/(public|sign)\//.test(firstMessage.content);
      const mentionsReportGeneration = /\b(generat|creat|compil|produc|regenerat|bulletin|report)\b/i.test(firstMessage.content);
      if (hasHallucinatedUrl && mentionsReportGeneration) {
        console.log("FORCING generate_fortress_report (model hallucinated a storage URL)");
        const allUserMessages = messages.filter((m: any) => m.role === "user");
        const allAssistantMessages = messages.filter((m: any) => m.role === "assistant");
        let bulletinTitle = "Security Bulletin";
        const titleMatch = firstMessage.content.match(/["\u201c\u201d]([^"\u201c\u201d]{10,100})["\u201c\u201d]/) ||
                          firstMessage.content.match(/\*\*["\u201c\u201d]?([^*"\u201c\u201d\n]{10,100})["\u201c\u201d]?\*\*/);
        if (titleMatch) bulletinTitle = titleMatch[1].replace(/^(View|Download|Regenerat\w+)\s+(the\s+)?(Latest|Newest|Most Recent|New|Updated)\s+/i, '');
        const substantiveContent: string[] = [];
        const sortedUserMsgs = allUserMessages
          .map((m: any) => typeof m.content === 'string' ? m.content : '')
          .filter((c: string) => c.length > 30 && !isMetaConversation(c))
          .sort((a: string, b: string) => b.length - a.length);
        for (const c of sortedUserMsgs) substantiveContent.push(c);
        for (const msg of allAssistantMessages) {
          const c = typeof msg.content === 'string' ? msg.content : '';
          if (isMetaConversation(c)) continue;
          const cleaned = c.replace(/https?:\/\/\S+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();
          if (cleaned.length > 200) substantiveContent.push(cleaned.substring(0, 3000));
        }
        let bulletinHtml = "";
        if (substantiveContent.length > 0) {
          try {
            const extractionPrompt = `Extract structured intelligence from this conversation context. Return ONLY valid JSON (no markdown, no code fences).\n\nFormat:\n{"executive_summary":"1-2 sentence overview","sections":[{"title":"Section Title","content":"paragraph text","bullets":["point 1","point 2"]}],"key_entities":["entity names mentioned"],"dates_mentioned":["any dates"],"locations":["any locations"]}\n\nRULES:\n- ONLY extract facts explicitly present in the context\n- NEVER invent details, dates, locations, or threat actors\n- If a field has no data, use empty string or empty array\n\nCONTEXT:\n${substantiveContent.join('\n\n---\n\n').substring(0, 8000)}`;
            const composeResp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: extractionPrompt }], stream: false }),
            }, 15000);
            if (composeResp.ok) {
              const composeData = await composeResp.json();
              const rawJson = (composeData.choices?.[0]?.message?.content || "").replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
              try {
                const extracted = JSON.parse(rawJson);
                const parts: string[] = [];
                if (extracted.executive_summary) parts.push(`<h2>Executive Summary</h2><p>${escapeHtml(extracted.executive_summary)}</p>`);
                if (extracted.sections?.length) for (const section of extracted.sections) {
                  if (!section.title || (!section.content && !section.bullets?.length)) continue;
                  parts.push(`<h2>${escapeHtml(section.title)}</h2>`);
                  if (section.content) parts.push(`<p>${escapeHtml(section.content)}</p>`);
                  if (section.bullets?.length) parts.push(`<ul>${section.bullets.map((b: string) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
                }
                if (extracted.key_entities?.length) parts.push(`<h2>Key Entities</h2><ul>${extracted.key_entities.map((e: string) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`);
                bulletinHtml = parts.join('\n');
              } catch { /* fallback */ }
            }
          } catch { /* fallback */ }
          if (!bulletinHtml || bulletinHtml.length < 100) {
            bulletinHtml = `<h2>Intelligence Summary</h2><p>${escapeHtml(substantiveContent[0]).replace(/\n/g, '</p><p>').substring(0, 5000)}</p>`;
          }
        } else {
          bulletinHtml = `<h2>Security Bulletin</h2><p>No substantive content found in conversation history.</p>`;
        }
        const bulletinImages = extractBulletinImages(messages);
        const forcedResult = await executeTool("generate_fortress_report", {
          report_type: "security_bulletin", bulletin_title: bulletinTitle, bulletin_html: bulletinHtml,
          bulletin_classification: "INTERNAL USE ONLY", generate_header_image: true,
          ...(bulletinImages.length > 0 ? { bulletin_images: bulletinImages } : {}),
        }, supabaseClient, authenticatedUserId);
        const forcedToolResults1 = [{ tool_call_id: "forced_generate_fortress_report", role: "tool", name: "generate_fortress_report", content: truncateToolResult(forcedResult, 25000) }];
        const finalResp1 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: AEGIS_REPORT_PRESENTER_PROMPT }, ...processedMessages, firstMessage, ...forcedToolResults1], stream: true }),
        }, AI_TIMEOUT_MS);
        if (finalResp1.ok) await pipeResponseBody(finalResp1.body!);
        return;
      }

      // 2. Forced signal injection
      const forcedSignal = extractPlannedTestSignalFromText(firstMessage.content);
      if (forcedSignal) {
        console.log("FORCING inject_test_signal (model described injection but returned no tool_calls)");
        const forcedResult2 = await executeTool("inject_test_signal", forcedSignal, supabaseClient, authenticatedUserId);
        const forcedToolResults2 = [{ tool_call_id: "forced_inject_test_signal", role: "tool", name: "inject_test_signal", content: truncateToolResult(forcedResult2, 25000) }];
        const finalResp2 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: AEGIS_TOOL_SUMMARIZER_PROMPT }, ...processedMessages, firstMessage, ...forcedToolResults2], stream: true }),
        }, AI_TIMEOUT_MS);
        if (finalResp2.ok) await pipeResponseBody(finalResp2.body!);
        return;
      }

      // 3. User explicitly requested a report but AI responded with text
      {
        const lastUserMsg3 = limitedMessages.filter((m: any) => m.role === "user").pop();
        const lastUserText3 = typeof lastUserMsg3?.content === "string" ? lastUserMsg3.content : "";
        const userWantsReport =
          /\b(generate|create|make|build|produce|write|draft|compile|regenerate|try again|redo)\b.*\b(report|bulletin|briefing|document|summary|sitrep)\b/i.test(lastUserText3) ||
          /\b(report|bulletin|briefing|sitrep)\b.*\b(generate|create|make|build|produce|write|draft|compile|regenerate)\b/i.test(lastUserText3) ||
          (/\b(try again|redo|regenerate)\b/i.test(lastUserText3) && /\b(report|bulletin|briefing)\b/i.test(lastUserText3));
        if (userWantsReport) {
          console.log("FORCING generate_fortress_report (user explicitly requested report but AI responded with text)");
          let reportType3 = "security_bulletin";
          if (/\b(executive|client)\b/i.test(lastUserText3)) reportType3 = "executive";
          else if (/\b(risk|snapshot)\b/i.test(lastUserText3)) reportType3 = "risk_snapshot";
          else if (/\b(travel|security briefing|city|country)\b/i.test(lastUserText3)) reportType3 = "security_briefing";
          let bulletinTitle3 = "Security Bulletin";
          const titleMatch3 = lastUserText3.match(/["\u201c\u201d]([^"\u201c\u201d]{5,100})["\u201c\u201d]/) ||
            lastUserText3.match(/(?:titled?|called?|named?|about)\s+["\u201c\u201d]?([^"\u201c\u201d.\n]{5,100})["\u201c\u201d]?/i);
          if (titleMatch3) bulletinTitle3 = titleMatch3[1].trim();
          const allMsgs3 = messages
            .map((m: any) => ({ role: m.role, text: typeof m.content === 'string' ? m.content : '' }))
            .filter((m: any) => m.text.length > 30 && !isMetaConversation(m.text));
          const substantiveContent3: string[] = [];
          for (const m of allMsgs3) {
            if (m.role === 'user') {
              substantiveContent3.push(m.text);
            } else if (m.role === 'assistant') {
              const cleaned = m.text.replace(/https?:\/\/\S+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();
              if (cleaned.length > 200) substantiveContent3.push(cleaned.substring(0, 3000));
            }
          }
          let bulletinHtml3 = "";
          if (substantiveContent3.length > 0) {
            try {
              const extractionPrompt3 = `Extract structured intelligence from this conversation context. Return ONLY valid JSON.\n\nFormat:\n{"executive_summary":"1-2 sentence overview","sections":[{"title":"Section Title","content":"paragraph text","bullets":["point 1","point 2"]}],"key_entities":["entity names mentioned"],"dates_mentioned":["any dates"],"locations":["any locations"]}\n\nRULES:\n- ONLY extract facts explicitly present in the context\n- NEVER invent details\n\nCONTEXT:\n${substantiveContent3.join('\n\n---\n\n').substring(0, 8000)}`;
              const composeResp3 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: extractionPrompt3 }], stream: false }),
              }, 15000);
              if (composeResp3.ok) {
                const composeData3 = await composeResp3.json();
                const rawJson3 = (composeData3.choices?.[0]?.message?.content || "").replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
                try {
                  const extracted3 = JSON.parse(rawJson3);
                  const parts3: string[] = [];
                  if (extracted3.executive_summary) parts3.push(`<h2>Executive Summary</h2><p>${escapeHtml(extracted3.executive_summary)}</p>`);
                  if (extracted3.sections?.length) for (const section of extracted3.sections) {
                    if (!section.title || (!section.content && !section.bullets?.length)) continue;
                    parts3.push(`<h2>${escapeHtml(section.title)}</h2>`);
                    if (section.content) parts3.push(`<p>${escapeHtml(section.content)}</p>`);
                    if (section.bullets?.length) parts3.push(`<ul>${section.bullets.map((b: string) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
                  }
                  if (extracted3.key_entities?.length) parts3.push(`<h2>Key Entities</h2><ul>${extracted3.key_entities.map((e: string) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`);
                  bulletinHtml3 = parts3.join('\n');
                } catch { /* fallback */ }
              }
            } catch { /* fallback */ }
            if (!bulletinHtml3 || bulletinHtml3.length < 100) {
              bulletinHtml3 = `<h2>Intelligence Summary</h2><p>${escapeHtml(substantiveContent3[0]).replace(/\n/g, '</p><p>').substring(0, 5000)}</p>`;
            }
          } else {
            bulletinHtml3 = `<h2>Security Bulletin</h2><p>No substantive content found in conversation history.</p>`;
          }
          const bulletinImages3 = extractBulletinImages(messages);
          const forcedResult3 = await executeTool("generate_fortress_report", {
            report_type: reportType3, bulletin_title: bulletinTitle3, bulletin_html: bulletinHtml3,
            bulletin_classification: "INTERNAL USE ONLY", generate_header_image: true,
            ...(bulletinImages3.length > 0 ? { bulletin_images: bulletinImages3 } : {}),
          }, supabaseClient, authenticatedUserId);
          const forcedToolResults3 = [{ tool_call_id: "forced_generate_report", role: "tool", name: "generate_fortress_report", content: truncateToolResult(forcedResult3, 25000) }];
          const finalResp3 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: AEGIS_REPORT_PRESENTER_PROMPT }, ...processedMessages, firstMessage, ...forcedToolResults3], stream: true }),
          }, AI_TIMEOUT_MS);
          if (finalResp3.ok) await pipeResponseBody(finalResp3.body!);
          return;
        }
      }

      // 4. Forced agent creation
      const forcedAgent = extractPlannedAgentFromText(firstMessage.content);
      if (forcedAgent) {
        console.log("FORCING create_agent (model described agent creation but returned no tool_calls)");
        const forcedResult4 = await executeTool("create_agent", forcedAgent, supabaseClient, authenticatedUserId);
        const forcedToolResults4 = [{ tool_call_id: "forced_create_agent", role: "tool", name: "create_agent", content: truncateToolResult(forcedResult4, 25000) }];
        const finalResp4 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: AEGIS_AGENT_CREATION_PROMPT }, ...processedMessages, firstMessage, ...forcedToolResults4], stream: true }),
        }, AI_TIMEOUT_MS);
        if (finalResp4.ok) await pipeResponseBody(finalResp4.body!);
        return;
      }

      // 5. Forced query_fortress_data
      let forcedQuery = extractPlannedFortressQueryFromText(firstMessage.content);
      if (!forcedQuery) {
        const lastUserMsg5 = limitedMessages.filter((m: any) => m.role === "user").pop();
        const lastUserText5 = typeof lastUserMsg5?.content === "string" ? lastUserMsg5.content : "";
        if (/\bitinerar(y|ies)\b/i.test(lastUserText5)) {
          forcedQuery = { query_type: "travel", output_format: "detailed", filters: { limit: 50 }, reason_for_access: "User requested access to travel itineraries." };
          console.log("FORCING query_fortress_data (itinerary access request)");
        }
      }
      if (forcedQuery) {
        console.log("FORCING query_fortress_data (model described query but returned no tool_calls)");
        const forcedResult5 = await executeTool("query_fortress_data", forcedQuery, supabaseClient, authenticatedUserId);
        const forcedToolResults5 = [{ tool_call_id: "forced_query_fortress_data", role: "tool", name: "query_fortress_data", content: truncateToolResult(forcedResult5, 30000) }];
        const finalResp5 = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: AEGIS_DATA_PRESENTER_PROMPT }, ...processedMessages, firstMessage, ...forcedToolResults5], stream: true }),
        }, AI_TIMEOUT_MS);
        if (finalResp5.ok) await pipeResponseBody(finalResp5.body!);
        return;
      }

      // No forced execution matched — content already streamed from first call
      await writeDone();
      return;
    }

    // ── TOOL EXECUTION PATH ───────────────────────────────────────────────────
    if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
      console.log("AI requested tool calls:", JSON.stringify(firstMessage.tool_calls.map((t: any) => t.function.name)));

      const toolResults = await Promise.all(
        firstMessage.tool_calls.map(async (toolCall: any) => {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, supabaseClient, authenticatedUserId);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: truncateToolResult(result, 25000),
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            console.error(`Tool execution error for ${toolCall.function.name}:`, errorMessage, error);
            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: toolCall.function.name,
              content: JSON.stringify({ success: false, error: errorMessage, error_details: error instanceof Error ? error.stack : String(error) }),
            };
          }
        })
      );

      const finalResp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: AEGIS_TOOL_SUMMARIZER_PROMPT }, ...processedMessages, firstMessage, ...toolResults],
          stream: true,
        }),
      }, AI_TIMEOUT_MS);

      if (!finalResp.ok) {
        const errStatus = finalResp.status;
        if (errStatus === 429) await writeSSEText(`data: {"choices":[{"delta":{"content":"Rate limit exceeded. Please wait a moment before trying again."}}]}\n\n`);
        else if (errStatus === 402) await writeSSEText(`data: {"choices":[{"delta":{"content":"AI service credits exhausted. Please contact support."}}]}\n\n`);
        else console.error("Follow-up AI call failed:", errStatus);
        await writeDone();
      } else {
        await pipeResponseBody(finalResp.body!);
      }
      return;
    }

    // Fallback: content already streamed (shouldn't normally reach here)
    await writeDone();

      } catch (bgErr) {
        console.error("[dashboard-ai-assistant] Background pipeline error:", bgErr);
        await logError(bgErr, { functionName: 'dashboard-ai-assistant', severity: 'error' });
        const errMsg = bgErr instanceof Error ? bgErr.message : 'Unknown error';
        try {
          const safeMsg = errMsg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
          await writeSSEText(`data: {"choices":[{"delta":{"content":"\\n\\n[Error: ${safeMsg}]"}}]}\n\ndata: [DONE]\n\n`);
        } catch {}
      } finally {
        try { await sseWriter.close(); } catch {}
      }
    })();

    return new Response(sseReadable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Dashboard AI assistant error:", error);
    await logError(error, { functionName: 'dashboard-ai-assistant', severity: 'error' });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});