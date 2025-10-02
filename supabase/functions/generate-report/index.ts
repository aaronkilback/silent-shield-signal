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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { report_type, period_hours } = await req.json();
    
    console.log(`Generating ${report_type} report for last ${period_hours} hours`);

    const periodStart = new Date();
    periodStart.setHours(periodStart.getHours() - (period_hours || 72));
    const periodEnd = new Date();

    // Fetch signals in time window
    const { data: signals, error: signalsError } = await supabase
      .from('signals')
      .select('*')
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .order('received_at', { ascending: false });

    if (signalsError) throw signalsError;

    // Fetch incidents in time window
    const { data: incidents, error: incidentsError } = await supabase
      .from('incidents')
      .select('*')
      .gte('opened_at', periodStart.toISOString())
      .lte('opened_at', periodEnd.toISOString());

    if (incidentsError) throw incidentsError;

    // Calculate metrics
    const criticalSignals = signals?.filter(s => s.severity === 'critical').length || 0;
    const highSignals = signals?.filter(s => s.severity === 'high').length || 0;
    const openIncidents = incidents?.filter(i => i.status === 'open').length || 0;
    const resolvedIncidents = incidents?.filter(i => i.status === 'resolved').length || 0;

    // Use AI to generate executive summary
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const summaryPrompt = `Generate a concise executive risk snapshot for the last ${period_hours} hours.
    
Data:
- Total signals: ${signals?.length || 0}
- Critical signals: ${criticalSignals}
- High priority signals: ${highSignals}
- Open incidents: ${openIncidents}
- Resolved incidents: ${resolvedIncidents}

Top signals: ${JSON.stringify(signals?.slice(0, 5) || [])}

Provide:
1. Overall threat level (LOW, ELEVATED, HIGH, CRITICAL)
2. Top 3 concerns
3. Recommended actions
4. Trend analysis

Keep it executive-friendly and action-oriented.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are a security intelligence analyst creating executive briefings.'
          },
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
      }),
    });

    let executiveSummary = 'Report generation in progress...';
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      executiveSummary = aiData.choices?.[0]?.message?.content || executiveSummary;
    }

    // Create report record
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        type: report_type,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        meta_json: {
          total_signals: signals?.length || 0,
          critical_signals: criticalSignals,
          high_signals: highSignals,
          open_incidents: openIncidents,
          resolved_incidents: resolvedIncidents,
          executive_summary: executiveSummary
        }
      })
      .select()
      .single();

    if (reportError) throw reportError;

    return new Response(
      JSON.stringify({ report }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in generate-report:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
