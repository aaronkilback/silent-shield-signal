import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { signal_id, lookback_days = 30 } = await req.json();
    console.log('Analyzing threat escalation for signal:', signal_id);

    const supabaseClient = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Get the target signal
    const { data: signal } = await supabaseClient
      .from('signals')
      .select('*, client_id, rule_category, rule_tags, priority')
      .eq('id', signal_id)
      .single();

    if (!signal) {
      throw new Error('Signal not found');
    }

    // Get historical signals with similar characteristics
    const lookbackDate = new Date(Date.now() - lookback_days * 24 * 60 * 60 * 1000).toISOString();
    const { data: historicalSignals } = await supabaseClient
      .from('signals')
      .select('id, normalized_text, priority, rule_category, created_at')
      .eq('client_id', signal.client_id)
      .eq('rule_category', signal.rule_category)
      .gte('created_at', lookbackDate)
      .order('created_at', { ascending: false })
      .limit(100);

    // Get incidents linked to similar signals
    const { data: historicalIncidents } = await supabaseClient
      .from('incidents')
      .select('id, priority, severity_level, status, opened_at, resolved_at')
      .eq('client_id', signal.client_id)
      .gte('opened_at', lookbackDate);

    // Use AI to analyze escalation patterns
    const analysisPrompt = `Analyze this security signal for threat escalation likelihood.

Current Signal:
- Category: ${signal.rule_category}
- Priority: ${signal.priority}
- Tags: ${signal.rule_tags?.join(', ')}
- Content: ${signal.normalized_text?.substring(0, 500)}

Historical Context (${lookback_days} days):
- Similar signals: ${historicalSignals?.length || 0}
- Related incidents: ${historicalIncidents?.length || 0}
- Escalated incidents: ${historicalIncidents?.filter(i => i.severity_level === 'high' || i.priority === 'p1').length || 0}

Provide:
1. Escalation probability (0-100%)
2. Key escalation indicators
3. Recommended monitoring frequency
4. Suggested preventive actions
5. Similar historical cases`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a security threat analyst specializing in threat escalation prediction.' },
          { role: 'user', content: analysisPrompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error('AI analysis failed');
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    console.log('Threat escalation analysis complete');

    return successResponse({
      signal_id,
      escalation_analysis: analysis,
      historical_context: {
        similar_signals_count: historicalSignals?.length || 0,
        incidents_count: historicalIncidents?.length || 0,
        escalated_incidents: historicalIncidents?.filter(i => i.severity_level === 'high').length || 0
      },
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in analyze-threat-escalation:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
