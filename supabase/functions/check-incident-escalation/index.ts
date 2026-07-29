import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateIncidentGate, persistGateDecision } from "../_shared/incident-creation-gate.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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

    // Severity → PRIORITY label only (never admission). Kept for the severity_level field.
    const severityScore = signal.severity_score || 0;
    let severityLevel = 'P4';
    if (severityScore >= thresholds.P1) severityLevel = 'P1';
    else if (severityScore >= thresholds.P2) severityLevel = 'P2';
    else if (severityScore >= thresholds.P3) severityLevel = 'P3';

    // Idempotency: bail if this signal already has an incident.
    const { data: existingIncident } = await supabase
      .from('incident_signals')
      .select('incident_id')
      .eq('signal_id', signalId)
      .maybeSingle();

    if (existingIncident) {
      return new Response(
        JSON.stringify({ success: true, escalated: false, reason: 'Already linked to incident' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── CREATION GATE (WO-INCIDENT-QA Step 1) — the shared admission authority ──
    // relevance ≥ 0.60 AND (confidence ≥ 0.65 when present, else corroboration ≥ 2)
    // AND non-hazard (interim freeze) AND non-[PATTERN]. Severity is priority-only.
    const gate = await evaluateIncidentGate(supabase, signal, windowDays);
    if (!gate.admit) {
      await persistGateDecision(supabase, signalId, 'check-incident-escalation', gate, null);
      return new Response(
        JSON.stringify({ success: true, escalated: false, gate: gate.branch, reason: gate.reason }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const incidentPriority = gate.priority as string;

    // Related signals + entities (for linking the admitted incident).
    const entityIds = (signal.entity_mentions || []).map((m: any) => m.entity_id).filter(Boolean);
    let relatedSignals: any[] = [];
    if (entityIds.length > 0) {
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - windowDays);
      const { data: related } = await supabase
        .from('entity_mentions')
        .select('signal_id, entity_id')
        .in('entity_id', entityIds)
        .neq('signal_id', signalId)
        .gte('created_at', windowStart.toISOString());
      if (related) {
        const relatedSignalIds = [...new Set(related.map((r: any) => r.signal_id))];
        if (relatedSignalIds.length > 0) {
          const { data: relatedSignalsData } = await supabase
            .from('signals')
            .select('id, title, severity_score')
            .in('id', relatedSignalIds)
            .eq('status', 'new');
          relatedSignals = relatedSignalsData || [];
        }
      }
    }

    // Create incident (full classification write lands in Step 3).
    const { data: incident, error: incidentError } = await supabase
      .from('incidents')
      .insert({
        title: signal.title || `Incident: ${signal.signal_type}`,
        summary: signal.description,
        incident_type: signal.signal_type,
        severity_level: severityLevel,
        priority: incidentPriority as any,
        status: 'open',
        opened_at: new Date().toISOString(),
        created_by_function: 'check-incident-escalation',
        timeline_json: [{
          timestamp: new Date().toISOString(),
          action: 'created',
          note: `Gate-admitted (${gate.branch}). ${gate.reason}. Severity score ${severityScore} (${severityLevel}) → priority ${incidentPriority.toUpperCase()}.`
        }]
      })
      .select()
      .single();

    if (incidentError) throw incidentError;

    await persistGateDecision(supabase, signalId, 'check-incident-escalation', gate, incident.id);

    // Link signal + related + entities.
    await supabase.from('incident_signals').insert({ incident_id: incident.id, signal_id: signalId });
    if (relatedSignals.length > 0) {
      await supabase.from('incident_signals')
        .insert(relatedSignals.map(rs => ({ incident_id: incident.id, signal_id: rs.id })));
    }
    if (entityIds.length > 0) {
      await supabase.from('incident_entities')
        .insert(entityIds.map((eid: string) => ({ incident_id: incident.id, entity_id: eid })));
    }

    console.log(`Created incident ${incident.id} from signal ${signalId} (gate ${gate.branch})`);

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