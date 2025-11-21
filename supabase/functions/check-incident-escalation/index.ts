import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { signalId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Checking escalation for signal: ${signalId}`);

    // Fetch signal
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('*, signal_documents(document_id), entity_mentions(entity_id)')
      .eq('id', signalId)
      .single();

    if (signalError || !signal) {
      throw new Error('Signal not found');
    }

    // Get config
    const { data: config } = await supabase
      .from('intelligence_config')
      .select('value')
      .in('key', ['severity_thresholds', 'correlation_window_days', 'auto_escalation_enabled']);

    const configMap = (config || []).reduce((acc: Record<string, any>, c: any) => {
      acc[c.key] = c.value;
      return acc;
    }, {} as Record<string, any>);

    const autoEscalation = configMap.auto_escalation_enabled || true;
    const thresholds = configMap.severity_thresholds || { P1: 80, P2: 50, P3: 20, P4: 0 };
    const windowDays = configMap.correlation_window_days || 7;

    if (!autoEscalation) {
      return new Response(
        JSON.stringify({ success: true, escalated: false, reason: 'Auto-escalation disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine severity level
    let severityLevel = 'P4';
    const severityScore = signal.severity_score || 0;
    
    if (severityScore >= thresholds.P1) {
      severityLevel = 'P1';
    } else if (severityScore >= thresholds.P2) {
      severityLevel = 'P2';
    } else if (severityScore >= thresholds.P3) {
      severityLevel = 'P3';
    }

    // Only auto-escalate P1 and P2
    if (!['P1', 'P2'].includes(severityLevel)) {
      return new Response(
        JSON.stringify({ success: true, escalated: false, reason: `Severity ${severityLevel} below escalation threshold` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for related signals
    const entityIds = (signal.entity_mentions || []).map((m: any) => m.entity_id);
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    let relatedSignals: any[] = [];
    
    if (entityIds.length > 0) {
      const { data: related } = await supabase
        .from('entity_mentions')
        .select('signal_id, entity_id')
        .in('entity_id', entityIds)
        .neq('signal_id', signalId)
        .gte('created_at', windowStart.toISOString());

      if (related) {
        const relatedSignalIds = [...new Set(related.map(r => r.signal_id))];
        
        const { data: relatedSignalsData } = await supabase
          .from('signals')
          .select('id, title, severity_score')
          .in('id', relatedSignalIds)
          .eq('status', 'new');

        relatedSignals = relatedSignalsData || [];
      }
    }

    // Check if incident already exists for this signal
    const { data: existingIncident } = await supabase
      .from('incident_signals')
      .select('incident_id')
      .eq('signal_id', signalId)
      .single();

    if (existingIncident) {
      return new Response(
        JSON.stringify({ success: true, escalated: false, reason: 'Already linked to incident' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create incident
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .insert({
        title: signal.title || `Incident: ${signal.signal_type}`,
        summary: signal.description,
        incident_type: signal.signal_type,
        severity_level: severityLevel,
        priority: severityLevel as any,
        status: 'open',
        opened_at: new Date().toISOString(),
        timeline_json: [{
          timestamp: new Date().toISOString(),
          action: 'created',
          note: `Auto-escalated from signal due to ${severityLevel} severity (score: ${severityScore})`
        }]
      })
      .select()
      .single();

    if (incidentError) throw incidentError;

    // Link signal to incident
    await supabase
      .from('incident_signals')
      .insert({
        incident_id: incident.id,
        signal_id: signalId
      });

    // Link related signals if any
    if (relatedSignals.length > 0) {
      const relatedLinks = relatedSignals.map(rs => ({
        incident_id: incident.id,
        signal_id: rs.id
      }));

      await supabase
        .from('incident_signals')
        .insert(relatedLinks);
    }

    // Link entities to incident
    if (entityIds.length > 0) {
      const entityLinks = entityIds.map((eid: string) => ({
        incident_id: incident.id,
        entity_id: eid
      }));

      await supabase
        .from('incident_entities')
        .insert(entityLinks);
    }

    console.log(`Created incident ${incident.id} from signal ${signalId}`);

    return new Response(
      JSON.stringify({
        success: true,
        escalated: true,
        incidentId: incident.id,
        severityLevel,
        relatedSignalsLinked: relatedSignals.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in check-incident-escalation:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});