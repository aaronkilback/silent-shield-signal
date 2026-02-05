import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    const { incident_id, action, note } = await req.json();
    
    if (!incident_id || !action) {
      return errorResponse('incident_id and action are required', 400);
    }

    console.log(`[IncidentAction] Performing action ${action} on incident ${incident_id}`);

    const now = new Date().toISOString();
    const updates: any = { updated_at: now };
    const timelineEntry: any = {
      timestamp: now,
      user_id: user.id,
      action: action,
      note: note || ''
    };

    // Calculate updates based on action
    switch (action) {
      case 'acknowledge':
        updates.acknowledged_at = now;
        updates.status = 'acknowledged';
        break;
      case 'contain':
        updates.contained_at = now;
        updates.status = 'contained';
        break;
      case 'resolve':
        updates.resolved_at = now;
        updates.status = 'resolved';
        break;
      case 'escalate':
        updates.status = 'escalated';
        break;
      case 'reopen':
        updates.status = 'open';
        updates.resolved_at = null;
        break;
      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }

    // Get current incident to append to timeline
    const { data: incident, error: fetchError } = await supabase
      .from('incidents')
      .select('timeline_json, opened_at, acknowledged_at')
      .eq('id', incident_id)
      .single();

    if (fetchError) {
      console.error('[IncidentAction] Error fetching incident:', fetchError);
      throw fetchError;
    }

    const timeline = Array.isArray(incident.timeline_json) 
      ? [...incident.timeline_json, timelineEntry]
      : [timelineEntry];

    updates.timeline_json = timeline;

    // Calculate MTTA (Mean Time to Acknowledge)
    const openedAt = new Date(incident.opened_at);
    if (action === 'acknowledge' && !incident.acknowledged_at) {
      const mttaMinutes = (new Date(now).getTime() - openedAt.getTime()) / 1000 / 60;
      console.log(`[IncidentAction] MTTA: ${mttaMinutes.toFixed(2)} minutes`);
    }

    // Update incident
    const { data: updated, error: updateError } = await supabase
      .from('incidents')
      .update(updates)
      .eq('id', incident_id)
      .select()
      .single();

    if (updateError) {
      console.error('[IncidentAction] Error updating incident:', updateError);
      throw updateError;
    }

    console.log(`[IncidentAction] Incident ${incident_id} updated to status: ${updates.status}`);

    return successResponse({ incident: updated });
  } catch (error) {
    console.error('[IncidentAction] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
