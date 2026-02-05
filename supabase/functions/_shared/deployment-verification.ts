// ═══════════════════════════════════════════════════════════════════════════════
//                        DEPLOYMENT VERIFICATION UTILITY
// ═══════════════════════════════════════════════════════════════════════════════
// This module provides utilities to verify edge function deployment status.
// Use during E2E tests or health checks to ensure all functions are deployed.

/**
 * List of all edge functions that should be deployed.
 * This is the source of truth for deployment verification.
 * 
 * IMPORTANT: Update this list when adding new edge functions!
 */
export const REQUIRED_EDGE_FUNCTIONS = [
  // Core AI & Chat
  'dashboard-ai-assistant',
  'agent-chat',
  'support-chat',
  'ai-decision-engine',
  'ai-tools-query',
  
  // Voice
  'openai-realtime-token',
  'voice-tool-executor-v2',
  'gemini-voice-conversation',
  'generate-briefing-audio',
  
  // Signal Processing
  'ingest-signal',
  'correlate-signals',
  'detect-near-duplicate-signals',
  'propose-signal-merge',
  'execute-signal-merge',
  'cleanup-duplicate-signals',
  'extract-signal-insights',
  'backfill-signal-media',
  
  // Entity Management
  'create-entity',
  'search-entities',
  'enrich-entity',
  'auto-enrich-entities',
  'correlate-entities',
  'entity-deep-scan',
  'osint-entity-scan',
  'configure-entity-monitoring',
  'monitor-entity-proximity',
  
  // Incident Management
  'incident-action',
  'incident-agent-orchestrator',
  'manage-incident-ticket',
  'check-incident-escalation',
  'auto-summarize-incident',
  
  // VIP & Security
  'vip-deep-scan',
  'vip-osint-discovery',
  'scan-entity-content',
  'scan-entity-photos',
  
  // Threat Analysis
  'threat-radar-analysis',
  'analyze-threat-escalation',
  'identify-precursor-indicators',
  'perform-impact-analysis',
  'analyze-image-content',
  'analyze-sentiment-drift',
  
  // Monitoring Sources
  'monitor-rss-sources',
  'monitor-news',
  'monitor-news-google',
  'monitor-social',
  'monitor-twitter',
  'monitor-linkedin',
  'monitor-facebook',
  'monitor-instagram',
  'monitor-github',
  'monitor-pastebin',
  'monitor-darkweb',
  'monitor-domains',
  'monitor-threat-intel',
  'monitor-weather',
  'monitor-wildfires',
  'monitor-wildfire-comprehensive',
  'monitor-earthquakes',
  'monitor-travel-risks',
  'monitor-canadian-sources',
  'monitor-court-registry',
  'monitor-csis',
  'monitor-regional-apac',
  'monitor-regulatory-changes',
  
  // Document Processing
  'parse-document',
  'parse-entities-document',
  'parse-travel-itinerary',
  'parse-travel-security-report',
  'process-intelligence-document',
  'process-stored-document',
  'process-documents-batch',
  'process-archival-documents',
  'process-pending-documents',
  'process-security-report',
  'process-geospatial-map',
  'fortress-document-converter',
  'create-archival-record',
  
  // Reports & Briefings
  'generate-report',
  'generate-executive-report',
  'generate-security-briefing',
  'generate-incident-briefing',
  'generate-consortium-briefing',
  'briefing-query',
  'briefing-chat-response',
  
  // Automation & Learning
  'auto-orchestrator',
  'adaptive-confidence-adjuster',
  'optimize-rule-thresholds',
  'propose-new-monitoring-keywords',
  'autonomous-source-health-manager',
  'aggregate-global-learnings',
  'generate-learning-context',
  'data-quality-monitor',
  
  // Alerts & Notifications
  'alert-delivery',
  'alert-delivery-secure',
  'send-notification-email',
  
  // API Endpoints
  'api-v1-signals',
  'api-v1-clients',
  'api-v1-agents',
  'api-key-management',
  'oauth-token',
  
  // Multi-tenancy & Workspace
  'create-tenant',
  'create-workspace',
  'create-invite',
  'accept-invite',
  'send-workspace-invitation',
  'get-user-tenants',
  
  // Agents
  'create-agent',
  'generate-agent-avatar',
  'update-agent-configuration',
  
  // Investigations
  'investigation-ai-assist',
  'suggest-investigation-references',
  'cross-reference-entities',
  
  // Compliance & Policy
  'access-industry-standards',
  'audit-compliance-status',
  'review-client-policy',
  'map-policy-to-controls',
  'recommend-compliance-remediation',
  'recommend-policy-adjustments',
  'retrieve-regulatory-document',
  
  // Strategic Analysis
  'run-what-if-scenario',
  'run-task-force',
  'simulate-protest-escalation',
  'simulate-attack-path',
  'model-geopolitical-risk',
  'identify-critical-failure-points',
  'evaluate-countermeasure-impact',
  'recommend-tactical-countermeasures',
  'optimize-defense-strategies',
  'propose-security-investments',
  'track-mitigation-effectiveness',
  'calculate-anticipation-index',
  'fuse-geospatial-intelligence',
  'guide-decision-tree',
  
  // System Health
  'system-health-check',
  'guardian-check',
  'test-osint-source-connectivity',
  'update-osint-source-config',
  
  // Webhooks
  'webhook-dispatcher',
  'webhook-management',
  
  // Client Onboarding
  'process-client-onboarding',
  'generate-vehicle-image',
  
  // Memory & Context
  'extract-conversation-memory',
  'query-fortress-data',
  'query-internal-context',
  'query-legal-database',
  'perform-external-web-search',
  'osint-web-search',
  'manual-scan-trigger',
  
  // Feedback & Bug Tracking
  'process-feedback',
  'bug-workflow-manager',
  
  // MFA
  'send-mfa-code',
  'verify-mfa-code',
  
  // Archive
  'archive-completed-itineraries',
  'ingest-intelligence',
] as const;

export type EdgeFunctionName = typeof REQUIRED_EDGE_FUNCTIONS[number];

/**
 * Check if an edge function responds (is deployed)
 */
export async function checkFunctionDeployed(
  supabaseUrl: string,
  functionName: string,
  serviceKey: string
): Promise<{ deployed: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );
    
    // A 404 means not deployed, anything else means it exists
    if (response.status === 404) {
      return { deployed: false, status: 404, error: 'Function not found' };
    }
    
    return { deployed: true, status: response.status };
  } catch (error) {
    return { 
      deployed: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Verify all required edge functions are deployed
 * Returns list of missing functions
 */
export async function verifyAllDeployments(
  supabaseUrl: string,
  serviceKey: string
): Promise<{
  allDeployed: boolean;
  missing: string[];
  deployed: string[];
  errors: { function: string; error: string }[];
}> {
  const results = await Promise.all(
    REQUIRED_EDGE_FUNCTIONS.map(async (fn) => {
      const result = await checkFunctionDeployed(supabaseUrl, fn, serviceKey);
      return { function: fn, ...result };
    })
  );
  
  const missing = results.filter(r => !r.deployed).map(r => r.function);
  const deployed = results.filter(r => r.deployed).map(r => r.function);
  const errors = results
    .filter(r => r.error && r.error !== 'Function not found')
    .map(r => ({ function: r.function, error: r.error! }));
  
  return {
    allDeployed: missing.length === 0,
    missing,
    deployed,
    errors,
  };
}
