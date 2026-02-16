/**
 * Shared Schema Contracts — Single Source of Truth
 * 
 * ALL edge functions must import types from this file instead of
 * defining inline interfaces. This prevents schema drift, "column not found"
 * bugs, and ensures consistent typing across ~180 functions.
 * 
 * Usage:
 *   import type { Signal, Entity, Incident, SystemOpsAction } from "../_shared/types.ts";
 */

// ═══════════════════════════════════════════════════════════════
//                    COMMON ENUMS & LITERALS
// ═══════════════════════════════════════════════════════════════

/** Signal processing status lifecycle */
export type SignalStatus =
  | 'pending'
  | 'triaged'
  | 'processing'
  | 'analyzed'
  | 'correlated'
  | 'escalated'
  | 'resolved'
  | 'false_positive'
  | 'archived';

/** Incident priority levels */
export type IncidentPriority = 'p1' | 'p2' | 'p3' | 'p4';

/** Incident status lifecycle */
export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'contained'
  | 'resolved'
  | 'closed';

/** Entity types */
export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'vehicle'
  | 'asset'
  | 'event'
  | 'threat_group';

/** Risk / severity levels */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Alert status */
export type AlertStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'acknowledged';

/** User roles */
export type AppRole = 'super_admin' | 'admin' | 'analyst' | 'viewer';

/** Tenant roles */
export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Health check status */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Source types for signals */
export type SignalSourceType =
  | 'osint'
  | 'manual'
  | 'automated'
  | 'tip'
  | 'social_media'
  | 'news'
  | 'dark_web'
  | 'rss'
  | 'api'
  | 'communication'
  | 'document'
  | 'email'
  | 'sensor'
  | 'satellite'
  | 'internal'
  | 'external'
  | 'vulnerability_scanner';

// ═══════════════════════════════════════════════════════════════
//                    TABLE NAME CONSTANTS
// ═══════════════════════════════════════════════════════════════
/**
 * Canonical table name constants — import these instead of hardcoding strings.
 * Prevents schema drift when tables are renamed or refactored.
 * 
 * Usage:
 *   import { Tables } from "../_shared/types.ts";
 *   const { data } = await supabase.from(Tables.SIGNALS).select('*');
 */
export const Tables = {
  // Core intelligence
  SIGNALS: 'signals' as const,
  INCIDENTS: 'incidents' as const,
  ENTITIES: 'entities' as const,
  CLIENTS: 'clients' as const,
  PROFILES: 'profiles' as const,
  
  // AI & Agents
  AI_AGENTS: 'ai_agents' as const,
  AI_ASSISTANT_MESSAGES: 'ai_assistant_messages' as const,
  AGENT_MEMORY: 'agent_memory' as const,
  AGENT_CONVERSATIONS: 'agent_conversations' as const,
  AGENT_MESSAGES: 'agent_messages' as const,
  AGENT_PENDING_MESSAGES: 'agent_pending_messages' as const,
  AGENT_ACCURACY_METRICS: 'agent_accuracy_metrics' as const,
  AGENT_ACCURACY_TRACKING: 'agent_accuracy_tracking' as const,
  AGENT_INVESTIGATION_MEMORY: 'agent_investigation_memory' as const,
  AGENT_DEBATE_RECORDS: 'agent_debate_records' as const,
  
  // Operations & Health
  CIRCUIT_BREAKER_STATE: 'circuit_breaker_state' as const,
  DEAD_LETTER_QUEUE: 'dead_letter_queue' as const,
  EDGE_FUNCTION_ERRORS: 'edge_function_errors' as const,
  PROCESSING_QUEUE: 'processing_queue' as const,
  AUDIT_EVENTS: 'audit_events' as const,
  AUTOMATION_METRICS: 'automation_metrics' as const,
  AUTONOMOUS_ACTIONS_LOG: 'autonomous_actions_log' as const,
  AUTONOMOUS_SCAN_RESULTS: 'autonomous_scan_results' as const,
  
  // Monitoring & OSINT
  OSINT_SOURCES: 'osint_sources' as const,
  INTELLIGENCE_DOCUMENTS: 'intelligence_documents' as const,
  INTELLIGENCE_CONFIG: 'intelligence_config' as const,
  MONITORING_HISTORY: 'monitoring_history' as const,
  
  // Investigations
  INVESTIGATIONS: 'investigations' as const,
  INVESTIGATION_WORKSPACES: 'investigation_workspaces' as const,
  
  // Alerts & Notifications
  ALERTS: 'alerts' as const,
  NOTIFICATION_PREFERENCES: 'notification_preferences' as const,
  
  // Feedback & Learning
  IMPLICIT_FEEDBACK_EVENTS: 'implicit_feedback_events' as const,
  FEEDBACK_EVENTS: 'feedback_events' as const,
  ANALYST_ACCURACY_METRICS: 'analyst_accuracy_metrics' as const,
  ANALYST_PREFERENCES: 'analyst_preferences' as const,
  
  // Audio
  AUDIO_BRIEFINGS: 'audio_briefings' as const,
  
  // Multi-tenant
  TENANTS: 'tenants' as const,
  TENANT_USERS: 'tenant_users' as const,
  USER_ROLES: 'user_roles' as const,
  
  // Watchdog
  WATCHDOG_LEARNINGS: 'watchdog_learnings' as const,
} as const;

// ═══════════════════════════════════════════════════════════════
//                      TABLE ROW TYPES
// ═══════════════════════════════════════════════════════════════

/** signals table row (commonly selected fields) */
export interface Signal {
  id: string;
  title: string | null;
  normalized_text: string | null;
  source_type: SignalSourceType | string;
  source_url: string | null;
  severity: string | null;
  priority: string | null;
  status: SignalStatus | string;
  client_id: string | null;
  tenant_id: string | null;
  content_hash: string | null;
  correlation_group_id: string | null;
  importance_score: number | null;
  confidence_score: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[] | null;
  tags: string[] | null;
  rule_category: string | null;
  rule_priority: string | null;
  rule_tags: string[] | null;
  applied_rules: unknown | null;
  routed_to_team: string | null;
  created_at: string;
  updated_at: string;
}

/** entities table row */
export interface Entity {
  id: string;
  name: string;
  type: EntityType | string;
  description: string | null;
  aliases: string[] | null;
  risk_level: RiskLevel | string | null;
  threat_score: number | null;
  threat_indicators: string[] | null;
  associations: string[] | null;
  attributes: Record<string, unknown> | null;
  client_id: string | null;
  active_monitoring_enabled: boolean | null;
  monitoring_radius_km: number | null;
  address_street: string | null;
  address_city: string | null;
  address_province: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  current_location: string | null;
  confidence_score: number | null;
  created_at: string;
  updated_at: string;
}

/** incidents table row */
export interface Incident {
  id: string;
  title: string | null;
  description: string | null;
  priority: IncidentPriority | string;
  status: IncidentStatus | string;
  signal_id: string | null;
  client_id: string | null;
  tenant_id: string | null;
  assigned_to: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** clients table row */
export interface Client {
  id: string;
  name: string;
  industry: string | null;
  risk_profile: string | null;
  tenant_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** profiles table row */
export interface Profile {
  id: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

/** edge_function_errors table row */
export interface EdgeFunctionError {
  id: string;
  function_name: string;
  error_message: string;
  error_stack: string | null;
  error_code: string | null;
  severity: 'warning' | 'error' | 'critical';
  request_context: Record<string, unknown> | null;
  user_id: string | null;
  tenant_id: string | null;
  client_id: string | null;
  duration_ms: number | null;
  resolved_at: string | null;
  created_at: string;
}

/** dead_letter_queue table row */
export interface DeadLetterItem {
  id: string;
  function_name: string;
  payload: Record<string, unknown>;
  error_message: string | null;
  error_id: string | null;
  status: 'pending' | 'retrying' | 'completed' | 'exhausted' | 'cancelled';
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** audit_events table row */
export interface AuditEvent {
  id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  user_id: string | null;
  tenant_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** ai_agents table row */
export interface AiAgent {
  id: string;
  codename: string;
  call_sign: string;
  specialty: string;
  persona: string;
  mission_scope: string;
  interaction_style: string;
  system_prompt: string | null;
  input_sources: string[] | null;
  output_types: string[] | null;
  is_active: boolean | null;
  is_client_facing: boolean | null;
  avatar_color: string | null;
  avatar_image: string | null;
  header_name: string | null;
  roe_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
//                 DOMAIN SERVICE ACTION MAPS
// ═══════════════════════════════════════════════════════════════

/** system-ops domain actions */
export type SystemOpsAction =
  | 'health-check'
  | 'data-integrity-fix'
  | 'retry-dead-letters'
  | 'data-quality'
  | 'orchestrate'
  | 'ooda-loop'
  | 'pipeline-tests'
  | 'watchdog';

/** signal-processor domain actions */
export type SignalProcessorAction =
  | 'ingest'
  | 'deduplicate'
  | 'correlate'
  | 'merge'
  | 'consolidate'
  | 'extract-insights'
  | 'backfill-media';

/** entity-manager domain actions */
export type EntityManagerAction =
  | 'create'
  | 'enrich'
  | 'deep-scan'
  | 'correlate'
  | 'cross-reference'
  | 'configure-monitoring'
  | 'scan-content'
  | 'scan-photos'
  | 'proximity-monitor';

/** intelligence-engine domain actions */
export type IntelligenceEngineAction =
  | 'analyze-sentiment'
  | 'threat-analysis'
  | 'multi-model-consensus'
  | 'multi-agent-debate'
  | 'decision-engine'
  | 'predictive-forecast'
  | 'impact-analysis';

/** incident-manager domain actions */
export type IncidentManagerAction =
  | 'create'
  | 'escalate'
  | 'summarize'
  | 'check-escalation'
  | 'action'
  | 'agent-orchestrate'
  | 'alert-delivery';

/** osint-collector domain actions */
export type OsintCollectorAction =
  | 'monitor-news'
  | 'monitor-social'
  | 'monitor-twitter'
  | 'monitor-facebook'
  | 'monitor-instagram'
  | 'monitor-linkedin'
  | 'monitor-github'
  | 'monitor-darkweb'
  | 'monitor-rss'
  | 'monitor-weather'
  | 'monitor-wildfires'
  | 'monitor-earthquakes'
  | 'monitor-domains'
  | 'monitor-threat-intel'
  | 'monitor-travel-risks'
  | 'monitor-regulatory'
  | 'monitor-pastebin'
  | 'monitor-naad'
  | 'monitor-csis'
  | 'monitor-court'
  | 'monitor-canadian'
  | 'monitor-community'
  | 'monitor-regional-apac'
  | 'web-search'
  | 'manual-scan';

// ═══════════════════════════════════════════════════════════════
//              COMMON REQUEST / RESPONSE CONTRACTS
// ═══════════════════════════════════════════════════════════════

/** Standard domain service request envelope */
export interface DomainRequest<TAction extends string = string> {
  action: TAction;
  [key: string]: unknown;
}

/** Standard success response shape */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
}

/** Standard error response shape */
export interface ErrorResponseBody {
  error: string;
  code?: string;
  details?: unknown;
  timestamp: string;
}

/** Health check result for a single probe */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  latency_ms: number;
  message?: string;
  last_checked: string;
}

/** Full system health report */
export interface SystemHealthReport {
  overall_status: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: string;
  version: string;
}

/** Create entity request (used by create-entity and entity-manager) */
export interface CreateEntityRequest {
  name: string;
  type: EntityType;
  description?: string;
  aliases?: string[];
  risk_level?: RiskLevel;
  threat_score?: number;
  threat_indicators?: string[];
  associations?: string[];
  attributes?: Record<string, unknown>;
  address_street?: string;
  address_city?: string;
  address_province?: string;
  address_postal_code?: string;
  address_country?: string;
  current_location?: string;
  active_monitoring_enabled?: boolean;
  monitoring_radius_km?: number;
  client_id?: string;
  direct_create?: boolean;
  confidence_score?: number;
  source_context?: string;
}

/** Signal ingestion request */
export interface IngestSignalRequest {
  source_key?: string;
  event?: unknown;
  text?: string;
  url?: string;
  location?: string;
  raw_json?: unknown;
  is_test?: boolean;
  client_id?: string;
}

/** Audio briefing generation request */
export interface GenerateAudioRequest {
  source_type: string;
  source_id?: string;
  title: string;
  content_text: string;
  user_id: string;
}

/** AI Gateway message format */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Circuit breaker state row */
export interface CircuitBreakerState {
  id: string;
  service_name: string;
  state: 'closed' | 'open' | 'half_open';
  failure_count: number;
  success_count: number;
  failure_threshold: number;
  recovery_timeout_ms: number;
  last_failure_at: string | null;
  last_success_at: string | null;
  opened_at: string | null;
  half_open_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
//                    UTILITY TYPES
// ═══════════════════════════════════════════════════════════════

/** Make specific keys required */
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/** Partial update — all fields optional except id */
export type UpdateOf<T extends { id: string }> = Partial<Omit<T, 'id'>> & { id: string };

/** Insert type — omit auto-generated fields */
export type InsertOf<T> = Omit<T, 'id' | 'created_at' | 'updated_at'>;
