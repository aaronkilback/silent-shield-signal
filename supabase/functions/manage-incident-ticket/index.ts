import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Incident Ticket Management Tool for Fortress AI
 * 
 * Provides direct interaction with the Incident Management System (IMS) to:
 * - Create new incident tickets with full context from threat intelligence
 * - Update existing tickets with new affected assets, recommended actions, and status changes
 * - Link assets, signals, and entities to incidents for comprehensive tracking
 */

interface IncidentTicketRequest {
  action: 'create' | 'update';
  ticket_system_id?: string;
  title?: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  affected_assets?: string[];
  recommended_actions?: string[];
  assigned_team?: string;
  status?: 'new' | 'open' | 'acknowledged' | 'in_progress' | 'contained' | 'resolved' | 'closed';
  source?: string;
  client_id?: string;
  signal_id?: string;
  entity_ids?: string[];
  incident_type?: string;
  timeline_entries?: Array<{
    timestamp: string;
    action: string;
    actor: string;
    details?: string;
  }>;
}

interface IncidentTicketResponse {
  status: 'success' | 'failure';
  message: string;
  ticket_id: string;
  action_performed: 'create' | 'update';
  details?: {
    title?: string;
    priority?: string;
    severity?: string;
    assigned_team?: string;
    affected_assets_count?: number;
    recommended_actions_count?: number;
    linked_entities_count?: number;
  };
}

// Map severity to incident priority if not provided
function derivePriorityFromSeverity(severity: string): string {
  switch (severity) {
    case 'critical': return 'p1';
    case 'high': return 'p2';
    case 'medium': return 'p3';
    case 'low': return 'p4';
    default: return 'p3';
  }
}

// Map string status to valid incident status enum
function mapToIncidentStatus(status: string): string {
  const statusMapping: Record<string, string> = {
    'new': 'open',
    'acknowledged': 'investigating',
    'in_progress': 'investigating',
    'contained': 'contained',
    'resolved': 'resolved',
    'closed': 'closed',
  };
  return statusMapping[status] || 'open';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const requestBody: IncidentTicketRequest = await req.json();
    const {
      action,
      ticket_system_id,
      title,
      description,
      severity,
      priority,
      affected_assets = [],
      recommended_actions = [],
      assigned_team,
      status = 'new',
      source = 'Fortress AI',
      client_id,
      signal_id,
      entity_ids = [],
      incident_type,
      timeline_entries = [],
    } = requestBody;

    console.log(`[manage-incident-ticket] Action: ${action}, Title: ${title || 'N/A'}`);

    // Validate required fields
    if (!action) {
      return errorResponse('action is required (create or update)', 400);
    }

    if (!description) {
      return errorResponse('description is required', 400);
    }

    if (!severity) {
      return errorResponse('severity is required', 400);
    }

    // Derive priority if not provided
    const effectivePriority = priority || derivePriorityFromSeverity(severity);
    const effectiveStatus = mapToIncidentStatus(status);

    // Build timeline with initial entry from Fortress AI
    const initialTimeline: any[] = [{
      timestamp: new Date().toISOString(),
      action: action === 'create' ? 'Incident created by Fortress AI' : 'Incident updated by Fortress AI',
      actor: source,
      details: description.substring(0, 500),
    }];

    // Add provided timeline entries
    const fullTimeline = [...initialTimeline, ...timeline_entries];

    // Build SLA targets based on priority
    const slaTargets: Record<string, any> = {
      p1: { acknowledge_minutes: 5, contain_minutes: 60, resolve_minutes: 240 },
      p2: { acknowledge_minutes: 15, contain_minutes: 180, resolve_minutes: 480 },
      p3: { acknowledge_minutes: 60, contain_minutes: 480, resolve_minutes: 1440 },
      p4: { acknowledge_minutes: 240, contain_minutes: 1440, resolve_minutes: 4320 },
    };

    if (action === 'create') {
      // Validate title for create
      if (!title) {
        return errorResponse('title is required for create action', 400);
      }

      // Create new incident
      const incidentData: any = {
        title,
        summary: description,
        priority: effectivePriority,
        status: effectiveStatus,
        severity_level: severity,
        incident_type: incident_type || 'security_incident',
        timeline_json: fullTimeline,
        sla_targets_json: {
          ...slaTargets[effectivePriority],
          assigned_team,
          affected_assets,
          recommended_actions,
          source,
        },
        opened_at: new Date().toISOString(),
      };

      // Add optional fields
      if (client_id) incidentData.client_id = client_id;
      if (signal_id) incidentData.signal_id = signal_id;

      const { data: newIncident, error: createError } = await supabase
        .from('incidents')
        .insert(incidentData)
        .select('id, title, priority, status, severity_level, opened_at')
        .single();

      if (createError) {
        console.error('[manage-incident-ticket] Create error:', createError);
        return errorResponse(`Failed to create incident: ${createError.message}`, 500);
      }

      // Link affected assets to incident if asset IDs provided
      if (affected_assets.length > 0) {
        await supabase
          .from('incidents')
          .update({
            sla_targets_json: {
              ...incidentData.sla_targets_json,
              affected_asset_ids: affected_assets,
            },
          })
          .eq('id', newIncident.id);
      }

      // Link entities to incident if entity IDs provided
      if (entity_ids.length > 0) {
        const entityLinks = entity_ids.map(entityId => ({
          incident_id: newIncident.id,
          entity_id: entityId,
        }));

        const { error: linkError } = await supabase
          .from('incident_entities')
          .insert(entityLinks);

        if (linkError) {
          console.warn('[manage-incident-ticket] Entity link warning:', linkError);
        }
      }

      // Link signal to incident if provided
      if (signal_id) {
        const { error: signalLinkError } = await supabase
          .from('incident_signals')
          .insert({
            incident_id: newIncident.id,
            signal_id,
          });

        if (signalLinkError && !signalLinkError.message.includes('duplicate')) {
          console.warn('[manage-incident-ticket] Signal link warning:', signalLinkError);
        }
      }

      // Generate ticket ID in IMS format
      const ticketId = `INC-${new Date().getFullYear()}-${newIncident.id.slice(0, 8).toUpperCase()}`;

      const response: IncidentTicketResponse = {
        status: 'success',
        message: `Incident ticket ${ticketId} created successfully.`,
        ticket_id: ticketId,
        action_performed: 'create',
        details: {
          title: newIncident.title,
          priority: newIncident.priority,
          severity: newIncident.severity_level,
          assigned_team,
          affected_assets_count: affected_assets.length,
          recommended_actions_count: recommended_actions.length,
          linked_entities_count: entity_ids.length,
        },
      };

      console.log('[manage-incident-ticket] Created:', ticketId);
      return successResponse(response);

    } else if (action === 'update') {
      // Validate ticket_system_id for update
      if (!ticket_system_id) {
        return errorResponse('ticket_system_id is required for update action', 400);
      }

      // Parse ticket ID - handle both INC-2024-XXXXXXXX format and raw UUID
      let incidentId = ticket_system_id;
      if (ticket_system_id.startsWith('INC-')) {
        const parts = ticket_system_id.split('-');
        if (parts.length >= 3) {
          incidentId = parts.slice(2).join('-').toLowerCase();
        }
      }

      // First try exact match, then try partial match on ID
      let existingIncident;
      let fetchError;

      const exactResult = await supabase
        .from('incidents')
        .select('id, title, priority, status, severity_level, timeline_json, sla_targets_json, acknowledged_at, summary')
        .eq('id', incidentId)
        .single();

      if (!exactResult.error && exactResult.data) {
        existingIncident = exactResult.data;
      } else {
        const partialResult = await supabase
          .from('incidents')
          .select('id, title, priority, status, severity_level, timeline_json, sla_targets_json, acknowledged_at, summary')
          .ilike('id', `${incidentId}%`)
          .limit(1)
          .single();

        if (!partialResult.error && partialResult.data) {
          existingIncident = partialResult.data;
        } else {
          fetchError = partialResult.error || exactResult.error;
        }
      }

      if (!existingIncident) {
        console.error('[manage-incident-ticket] Incident not found:', ticket_system_id, fetchError);
        return new Response(
          JSON.stringify({ 
            status: 'failure', 
            message: `Incident ticket ${ticket_system_id} not found`, 
            ticket_id: ticket_system_id 
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Build update payload
      const updatePayload: any = {
        updated_at: new Date().toISOString(),
      };

      if (title) updatePayload.title = title;
      if (severity) updatePayload.severity_level = severity;
      if (priority) updatePayload.priority = effectivePriority;
      if (status) updatePayload.status = effectiveStatus;
      if (incident_type) updatePayload.incident_type = incident_type;

      if (effectiveStatus === 'investigating' && !existingIncident.acknowledged_at) {
        updatePayload.acknowledged_at = new Date().toISOString();
      }
      if (effectiveStatus === 'contained') {
        updatePayload.contained_at = new Date().toISOString();
      }
      if (effectiveStatus === 'resolved' || effectiveStatus === 'closed') {
        updatePayload.resolved_at = new Date().toISOString();
      }

      const existingTimeline = existingIncident.timeline_json || [];
      updatePayload.timeline_json = [
        ...existingTimeline,
        {
          timestamp: new Date().toISOString(),
          action: 'Updated by Fortress AI',
          actor: source,
          details: description.substring(0, 500),
        },
        ...timeline_entries,
      ];

      const existingSLA = existingIncident.sla_targets_json || {};
      const existingAssets = existingSLA.affected_asset_ids || [];
      const existingActions = existingSLA.recommended_actions || [];

      updatePayload.sla_targets_json = {
        ...existingSLA,
        assigned_team: assigned_team || existingSLA.assigned_team,
        affected_asset_ids: [...new Set([...existingAssets, ...affected_assets])],
        recommended_actions: [...new Set([...existingActions, ...recommended_actions])],
        last_updated_by: source,
        last_updated_at: new Date().toISOString(),
      };

      if (description) {
        const existingSummary = existingIncident.summary || '';
        updatePayload.summary = `${existingSummary}\n\n[${new Date().toISOString()}] ${description}`.trim();
      }

      const { error: updateError } = await supabase
        .from('incidents')
        .update(updatePayload)
        .eq('id', existingIncident.id);

      if (updateError) {
        console.error('[manage-incident-ticket] Update error:', updateError);
        return errorResponse(`Failed to update incident: ${updateError.message}`, 500);
      }

      if (entity_ids.length > 0) {
        const entityLinks = entity_ids.map(entityId => ({
          incident_id: existingIncident.id,
          entity_id: entityId,
        }));

        const { error: linkError } = await supabase
          .from('incident_entities')
          .upsert(entityLinks, { onConflict: 'incident_id,entity_id' });

        if (linkError) {
          console.warn('[manage-incident-ticket] Entity link warning:', linkError);
        }
      }

      const ticketId = `INC-${new Date().getFullYear()}-${existingIncident.id.slice(0, 8).toUpperCase()}`;

      const response: IncidentTicketResponse = {
        status: 'success',
        message: `Incident ticket ${ticketId} updated successfully.`,
        ticket_id: ticketId,
        action_performed: 'update',
        details: {
          title: title || existingIncident.title,
          priority: effectivePriority || existingIncident.priority,
          severity: severity || existingIncident.severity_level,
          assigned_team: assigned_team || existingSLA.assigned_team,
          affected_assets_count: updatePayload.sla_targets_json.affected_asset_ids.length,
          recommended_actions_count: updatePayload.sla_targets_json.recommended_actions.length,
          linked_entities_count: entity_ids.length,
        },
      };

      console.log('[manage-incident-ticket] Updated:', ticketId);
      return successResponse(response);

    } else {
      return errorResponse(`Invalid action: ${action}. Use 'create' or 'update'.`, 400);
    }

  } catch (error) {
    console.error('[manage-incident-ticket] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
