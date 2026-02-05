import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { client_id, threat_type } = await req.json();
    console.log('Optimizing defense strategies for client:', client_id, 'threat:', threat_type);

    const supabase = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch comprehensive client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    // Fetch relevant signals for this threat type
    const { data: relevantSignals } = await supabase
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .eq('rule_category', threat_type)
      .order('created_at', { ascending: false })
      .limit(20);

    // Fetch recent incidents
    const { data: recentIncidents } = await supabase
      .from('incidents')
      .select('*')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(15);

    // Fetch entities for context
    const { data: entities } = await supabase
      .from('entities')
      .select('*')
      .limit(50);

    const optimizationPrompt = `
You are a strategic defense architect optimizing security controls for a client facing specific threat types.

CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry || 'Unknown'}
- Locations: ${client.locations?.join(', ') || 'Unknown'}
- High-value Assets: ${client.high_value_assets?.join(', ') || 'None specified'}
- Employee Count: ${client.employee_count || 'Unknown'}
- Threat Profile: ${JSON.stringify(client.threat_profile || {})}
- Risk Assessment: ${JSON.stringify(client.risk_assessment || {})}

THREAT TYPE FOCUS: ${threat_type}

RECENT THREAT INTELLIGENCE:
${relevantSignals?.length ? `${relevantSignals.length} relevant signals in past 90 days` : 'No recent signals'}

INCIDENT HISTORY:
${recentIncidents?.length ? `${recentIncidents.length} incidents (${recentIncidents.filter(i => i.status === 'resolved').length} resolved)` : 'No recent incidents'}

TASK:
Design an optimized, layered defense strategy combining technical, physical, and procedural controls. Provide:

1. LAYERED DEFENSE MODEL:
   - Preventive controls (stopping threats before they materialize)
   - Detective controls (identifying threats in progress)
   - Responsive controls (containing and neutralizing threats)
   - Corrective controls (recovering and learning from incidents)

2. PRIORITIZED CONTROL RECOMMENDATIONS:
   - Top 5-10 specific security controls to implement
   - Technology/infrastructure requirements
   - Personnel/training needs
   - Process/policy changes

3. IMPLEMENTATION ROADMAP:
   - Phase 1 (0-30 days): Critical, immediate controls
   - Phase 2 (30-90 days): Important strategic controls
   - Phase 3 (90-180 days): Comprehensive hardening

4. RESOURCE OPTIMIZATION:
   - Budget allocation recommendations
   - ROI estimates for each control category
   - Quick wins vs. long-term investments

5. EFFECTIVENESS METRICS:
   - KPIs to track defense effectiveness
   - Expected risk reduction percentages

Consider client-specific constraints (industry regulations, operational requirements, budget) and ensure recommendations are practical and implementable.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert strategic defense architect specializing in comprehensive security program design and optimization.' },
          { role: 'user', content: optimizationPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const strategy = data.choices?.[0]?.message?.content;

    if (!strategy) {
      throw new Error('No strategy generated');
    }

    console.log('Defense strategy optimization completed');

    return successResponse({ 
      client_id,
      threat_type,
      optimized_strategy: strategy,
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in optimize-defense-strategies:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
