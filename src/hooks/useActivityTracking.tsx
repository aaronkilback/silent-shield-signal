import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { useTenant } from "@/hooks/useTenant";
import type { Json } from "@/integrations/supabase/types";

interface ActivityEvent {
  activity_type: 'view' | 'create' | 'update' | 'delete' | 'interact' | 'search' | 'export';
  resource_type: 'page' | 'signal' | 'incident' | 'entity' | 'document' | 'ai_chat' | 'agent' | 'report' | 'investigation' | 'briefing';
  resource_id?: string;
  resource_name?: string;
  description?: string;
  metadata?: Record<string, Json>;
}

/**
 * Hook to track user activity for engagement metrics
 * Automatically excludes super_admin users from tracking
 */
export function useActivityTracking() {
  const { session } = useAuth();
  const { isSuperAdmin, isLoading: adminLoading } = useIsSuperAdmin();
  const { currentTenant } = useTenant();
  const lastTrackedPage = useRef<string>('');

  const trackActivity = useCallback(async (event: ActivityEvent) => {
    // Skip tracking for super_admin users or if not authenticated
    if (adminLoading || isSuperAdmin || !session?.user?.id) {
      return;
    }

    // Skip if no tenant context
    if (!currentTenant?.id) {
      return;
    }

    try {
      await supabase.from('tenant_activity').insert([{
        tenant_id: currentTenant.id,
        user_id: session.user.id,
        activity_type: event.activity_type,
        resource_type: event.resource_type,
        resource_id: event.resource_id,
        resource_name: event.resource_name,
        description: event.description,
        metadata: (event.metadata || {}) as Json,
      }]);
    } catch (error) {
      // Silent fail - don't disrupt user experience for tracking
      console.debug('Activity tracking failed:', error);
    }
  }, [session?.user?.id, isSuperAdmin, adminLoading, currentTenant?.id]);

  // Track page views
  const trackPageView = useCallback((pageName: string, pageUrl?: string) => {
    // Deduplicate rapid page view events
    if (lastTrackedPage.current === pageName) return;
    lastTrackedPage.current = pageName;

    trackActivity({
      activity_type: 'view',
      resource_type: 'page',
      resource_name: pageName,
      description: `Viewed ${pageName}`,
      metadata: { url: pageUrl || window.location.pathname },
    });
  }, [trackActivity]);

  // Track AI interactions
  const trackAIInteraction = useCallback((
    agentName: string,
    messageType: 'user' | 'assistant',
    conversationId?: string
  ) => {
    if (messageType !== 'user') return; // Only track user messages

    trackActivity({
      activity_type: 'interact',
      resource_type: 'ai_chat',
      resource_id: conversationId,
      resource_name: agentName,
      description: `Sent message to ${agentName}`,
    });
  }, [trackActivity]);

  // Track agent interactions
  const trackAgentInteraction = useCallback((
    agentCodename: string,
    agentId: string,
    interactionType: 'chat' | 'query' | 'briefing'
  ) => {
    trackActivity({
      activity_type: 'interact',
      resource_type: 'agent',
      resource_id: agentId,
      resource_name: agentCodename,
      description: `${interactionType} with agent ${agentCodename}`,
      metadata: { interaction_type: interactionType },
    });
  }, [trackActivity]);

  // Track signal interactions
  const trackSignalAction = useCallback((
    signalId: string,
    action: 'view' | 'feedback' | 'assign' | 'dismiss',
    signalTitle?: string
  ) => {
    trackActivity({
      activity_type: action === 'view' ? 'view' : 'update',
      resource_type: 'signal',
      resource_id: signalId,
      resource_name: signalTitle,
      description: `${action} signal${signalTitle ? `: ${signalTitle.slice(0, 50)}` : ''}`,
      metadata: { action },
    });
  }, [trackActivity]);

  // Track incident interactions
  const trackIncidentAction = useCallback((
    incidentId: string,
    action: 'view' | 'create' | 'update' | 'escalate' | 'resolve',
    incidentTitle?: string
  ) => {
    trackActivity({
      activity_type: action === 'view' ? 'view' : action === 'create' ? 'create' : 'update',
      resource_type: 'incident',
      resource_id: incidentId,
      resource_name: incidentTitle,
      description: `${action} incident${incidentTitle ? `: ${incidentTitle.slice(0, 50)}` : ''}`,
      metadata: { action },
    });
  }, [trackActivity]);

  // Track entity interactions
  const trackEntityAction = useCallback((
    entityId: string,
    action: 'view' | 'create' | 'update' | 'merge' | 'monitor',
    entityName?: string
  ) => {
    trackActivity({
      activity_type: action === 'view' ? 'view' : action === 'create' ? 'create' : 'update',
      resource_type: 'entity',
      resource_id: entityId,
      resource_name: entityName,
      description: `${action} entity${entityName ? `: ${entityName}` : ''}`,
      metadata: { action },
    });
  }, [trackActivity]);

  // Track document interactions
  const trackDocumentAction = useCallback((
    documentId: string,
    action: 'view' | 'upload' | 'download' | 'process',
    documentName?: string
  ) => {
    trackActivity({
      activity_type: action === 'view' ? 'view' : action === 'upload' ? 'create' : 'interact',
      resource_type: 'document',
      resource_id: documentId,
      resource_name: documentName,
      description: `${action} document${documentName ? `: ${documentName}` : ''}`,
      metadata: { action },
    });
  }, [trackActivity]);

  // Track report generation
  const trackReportGeneration = useCallback((
    reportType: string,
    reportName?: string
  ) => {
    trackActivity({
      activity_type: 'export',
      resource_type: 'report',
      resource_name: reportName || reportType,
      description: `Generated ${reportType} report`,
      metadata: { report_type: reportType },
    });
  }, [trackActivity]);

  // Track search actions
  const trackSearch = useCallback((
    searchType: 'signals' | 'entities' | 'documents' | 'global',
    query: string
  ) => {
    trackActivity({
      activity_type: 'search',
      resource_type: searchType === 'global' ? 'page' : searchType === 'signals' ? 'signal' : searchType === 'entities' ? 'entity' : 'document',
      description: `Searched ${searchType}`,
      metadata: { query: query.slice(0, 100) }, // Truncate for privacy
    });
  }, [trackActivity]);

  return {
    trackActivity,
    trackPageView,
    trackAIInteraction,
    trackAgentInteraction,
    trackSignalAction,
    trackIncidentAction,
    trackEntityAction,
    trackDocumentAction,
    trackReportGeneration,
    trackSearch,
    isTracking: !isSuperAdmin && !adminLoading && !!session?.user?.id,
  };
}

/**
 * Hook to automatically track page views
 */
export function usePageTracking(pageName: string) {
  const { trackPageView } = useActivityTracking();

  useEffect(() => {
    trackPageView(pageName);
  }, [pageName, trackPageView]);
}
