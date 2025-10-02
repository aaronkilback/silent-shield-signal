import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { incident_id, action, note } = await req.json();
    
    console.log(`Performing action ${action} on incident ${incident_id}`);

    const now = new Date().toISOString();
    const updates: any = {};
    const timelineEntry: any = {
      timestamp: now,
      user_id: user.id,
      action: action,
      note: note || ''
    };

    // Calculate MTTD, MTTC, MTTR based on action
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
    }

    // Get current incident to append to timeline
    const { data: incident, error: fetchError } = await supabase
      .from('incidents')
      .select('timeline_json, opened_at, acknowledged_at')
      .eq('id', incident_id)
      .single();

    if (fetchError) throw fetchError;

    const timeline = Array.isArray(incident.timeline_json) 
      ? [...incident.timeline_json, timelineEntry]
      : [timelineEntry];

    updates.timeline_json = timeline;
    updates.updated_at = now;

    // Calculate metrics
    const openedAt = new Date(incident.opened_at);
    if (action === 'acknowledge' && !incident.acknowledged_at) {
      const mtta = (new Date(now).getTime() - openedAt.getTime()) / 1000 / 60; // minutes
      console.log(`MTTA: ${mtta.toFixed(2)} minutes`);
    }

    // Update incident
    const { data: updated, error: updateError } = await supabase
      .from('incidents')
      .update(updates)
      .eq('id', incident_id)
      .select()
      .single();

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ incident: updated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in incident-action:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
