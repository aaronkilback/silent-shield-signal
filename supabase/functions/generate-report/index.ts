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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role for inserting reports (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { report_type, period_hours } = await req.json();
    
    console.log(`Generating ${report_type} report for last ${period_hours} hours`);

    const periodStart = new Date();
    periodStart.setHours(periodStart.getHours() - (period_hours || 72));
    const periodEnd = new Date();

    // Fetch signals in time window (using user auth)
    const { data: signals, error: signalsError } = await supabaseClient
      .from('signals')
      .select('*')
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .order('received_at', { ascending: false });

    if (signalsError) throw signalsError;

    // Fetch incidents in time window (using user auth)
    const { data: incidents, error: incidentsError } = await supabaseClient
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

    // Generate HTML report
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>72-Hour Risk Snapshot - ArachnNet™</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1, h2 { color: #333; }
    .metric { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .critical { color: #dc2626; font-weight: bold; }
    .high { color: #ea580c; font-weight: bold; }
    .medium { color: #eab308; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #333; color: white; }
  </style>
</head>
<body>
  <h1>ArachnNet™ 72-Hour Risk Snapshot</h1>
  <p>Period: ${periodStart} to ${periodEnd}</p>
  <p>Generated: ${new Date().toISOString()}</p>
  
  <div class="metric">
    <h2>Executive Summary</h2>
    ${executiveSummary}
  </div>
  
  <div class="metric">
    <h2>Key Metrics</h2>
    <p>Total Signals: ${signals.length}</p>
    <p>Total Incidents: ${incidents.length}</p>
    <p>Critical Incidents: ${incidents.filter(i => i.priority === 'p1').length}</p>
    <p>High Priority: ${incidents.filter(i => i.priority === 'p2').length}</p>
  </div>
  
  <h2>Recent Incidents</h2>
  <table>
    <tr>
      <th>Priority</th>
      <th>Status</th>
      <th>Opened</th>
      <th>Severity</th>
    </tr>
    ${incidents.map(inc => `
      <tr>
        <td class="${inc.priority === 'p1' ? 'critical' : inc.priority === 'p2' ? 'high' : 'medium'}">${inc.priority?.toUpperCase()}</td>
        <td>${inc.status}</td>
        <td>${new Date(inc.opened_at).toLocaleString()}</td>
        <td>${inc.signals?.severity || 'N/A'}</td>
      </tr>
    `).join('')}
  </table>
  
  <h2>Signals Summary</h2>
  <table>
    <tr>
      <th>Severity</th>
      <th>Category</th>
      <th>Received</th>
      <th>Text</th>
    </tr>
    ${signals.slice(0, 50).map(sig => `
      <tr>
        <td class="${sig.severity === 'critical' ? 'critical' : sig.severity === 'high' ? 'high' : 'medium'}">${sig.severity}</td>
        <td>${sig.category || 'Unknown'}</td>
        <td>${new Date(sig.received_at).toLocaleString()}</td>
        <td>${sig.normalized_text?.substring(0, 100)}...</td>
      </tr>
    `).join('')}
  </table>
</body>
</html>
    `.trim();

    return new Response(
      JSON.stringify({ report, html }),
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
