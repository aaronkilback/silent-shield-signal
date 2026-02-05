import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { threat_type, client_id, timeframe_hours = 168 } = await req.json(); // Default 7 days
    console.log('Identifying precursor indicators:', { threat_type, client_id });

    const supabaseClient = createServiceClient();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const timeframeCutoff = new Date(Date.now() - timeframe_hours * 60 * 60 * 1000).toISOString();

    // Gather multi-source intelligence
    const { data: recentSignals } = await supabaseClient
      .from('signals')
      .select('id, normalized_text, rule_category, rule_tags, source_type, priority, created_at')
      .eq('client_id', client_id)
      .gte('created_at', timeframeCutoff)
      .order('created_at', { ascending: false })
      .limit(200);

    const { data: entityMentions } = await supabaseClient
      .from('entity_mentions')
      .select('entity_id, confidence, context, detected_at, entities(name, type, threat_score)')
      .gte('detected_at', timeframeCutoff)
      .limit(100);

    const { data: client } = await supabaseClient
      .from('clients')
      .select('name, industry, high_value_assets, threat_profile, risk_assessment')
      .eq('id', client_id)
      .single();

    // Categorize signals by source type
    const signalsBySource: Record<string, any[]> = {};
    recentSignals?.forEach(signal => {
      const source = signal.source_type || 'unknown';
      if (!signalsBySource[source]) signalsBySource[source] = [];
      signalsBySource[source].push(signal);
    });

    // Build analysis prompt
    const analysisPrompt = `Analyze this multi-source intelligence for precursor indicators of ${threat_type || 'emerging threats'}.

Client Context:
- Name: ${client?.name}
- Industry: ${client?.industry}
- Critical Assets: ${client?.high_value_assets?.join(', ')}

Recent Intelligence (${timeframe_hours} hours):
- Total signals: ${recentSignals?.length || 0}
- Dark web signals: ${signalsBySource['darkweb']?.length || 0}
- Social media signals: ${signalsBySource['social']?.length || 0}
- News signals: ${signalsBySource['news']?.length || 0}
- Technical signals: ${signalsBySource['technical']?.length || 0}
- Entity mentions: ${entityMentions?.length || 0}

High-priority signals sample:
${recentSignals?.filter(s => s.priority === 'high' || s.priority === 'critical').slice(0, 10).map(s => 
  `- [${s.source_type}] ${s.rule_category}: ${s.normalized_text?.substring(0, 150)}`
).join('\n')}

Identify:
1. Correlated weak signals across different sources
2. Precursor patterns (e.g., dark web + vulnerability + geopolitical tension)
3. Early warning indicators for ${threat_type || 'potential threats'}
4. Recommended preventive actions
5. Confidence level and timeline estimate`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a strategic threat intelligence analyst specializing in early warning detection and precursor pattern recognition.' },
          { role: 'user', content: analysisPrompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error('AI analysis failed');
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    console.log('Precursor indicator analysis complete');

    return successResponse({
      threat_type,
      client_id,
      timeframe_hours,
      precursor_analysis: analysis,
      intelligence_summary: {
        total_signals: recentSignals?.length || 0,
        sources: Object.keys(signalsBySource),
        high_priority_count: recentSignals?.filter(s => s.priority === 'high' || s.priority === 'critical').length || 0,
        entity_mentions: entityMentions?.length || 0
      },
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in identify-precursor-indicators:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
