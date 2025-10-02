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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>72-Hour Risk Snapshot - ArachnNet™</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      padding: 40px 20px;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: #1e293b;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
    
    .header {
      background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
      padding: 40px;
      border-bottom: 4px solid #9333ea;
    }
    
    .header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      color: white;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    
    .header .subtitle {
      font-size: 1rem;
      color: rgba(255, 255, 255, 0.9);
      font-weight: 500;
    }
    
    .meta-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 24px 40px;
      background: #0f172a;
      border-bottom: 1px solid #334155;
    }
    
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .meta-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #94a3b8;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    
    .meta-value {
      font-size: 0.95rem;
      color: #e2e8f0;
      font-weight: 500;
    }
    
    .content {
      padding: 40px;
    }
    
    .section {
      margin-bottom: 48px;
    }
    
    .section-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: white;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 2px solid #334155;
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    
    .metric-card {
      background: linear-gradient(135deg, #334155 0%, #1e293b 100%);
      border-radius: 12px;
      padding: 24px;
      border: 1px solid #475569;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    
    .metric-label {
      font-size: 0.875rem;
      color: #94a3b8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .metric-value {
      font-size: 2.5rem;
      font-weight: 800;
      color: white;
    }
    
    .metric-card.critical .metric-value { color: #ef4444; }
    .metric-card.high .metric-value { color: #f97316; }
    .metric-card.medium .metric-value { color: #eab308; }
    .metric-card.success .metric-value { color: #22c55e; }
    
    .executive-summary {
      background: linear-gradient(135deg, #7c3aed15 0%, #a855f715 100%);
      border: 2px solid #7c3aed;
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 32px;
      white-space: pre-wrap;
      line-height: 1.8;
      font-size: 1.05rem;
    }
    
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      background: #0f172a;
      border-radius: 12px;
      overflow: hidden;
      margin-top: 20px;
    }
    
    thead {
      background: linear-gradient(135deg, #334155 0%, #475569 100%);
    }
    
    th {
      padding: 16px;
      text-align: left;
      font-weight: 700;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: white;
      border-bottom: 2px solid #7c3aed;
    }
    
    td {
      padding: 16px;
      border-bottom: 1px solid #334155;
      font-size: 0.95rem;
    }
    
    tbody tr {
      transition: background-color 0.2s;
    }
    
    tbody tr:hover {
      background: #1e293b;
    }
    
    tbody tr:last-child td {
      border-bottom: none;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge.critical {
      background: #ef444420;
      color: #ef4444;
      border: 1px solid #ef4444;
    }
    
    .badge.high {
      background: #f9731620;
      color: #f97316;
      border: 1px solid #f97316;
    }
    
    .badge.medium {
      background: #eab30820;
      color: #eab308;
      border: 1px solid #eab308;
    }
    
    .badge.low {
      background: #22c55e20;
      color: #22c55e;
      border: 1px solid #22c55e;
    }
    
    .badge.open { background: #3b82f620; color: #3b82f6; border: 1px solid #3b82f6; }
    .badge.resolved { background: #22c55e20; color: #22c55e; border: 1px solid #22c55e; }
    .badge.contained { background: #eab30820; color: #eab308; border: 1px solid #eab308; }
    
    .footer {
      text-align: center;
      padding: 32px;
      background: #0f172a;
      border-top: 1px solid #334155;
      color: #64748b;
      font-size: 0.875rem;
    }
    
    @media print {
      body { background: white; color: black; }
      .container { box-shadow: none; }
      .header { background: #7c3aed; }
      .metric-card:hover { transform: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🕷️ ArachnNet™</h1>
      <div class="subtitle">72-Hour Risk Intelligence Snapshot</div>
    </div>
    
    <div class="meta-info">
      <div class="meta-item">
        <div class="meta-label">Report Period</div>
        <div class="meta-value">${new Date(periodStart).toLocaleDateString()} - ${new Date(periodEnd).toLocaleDateString()}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Generated</div>
        <div class="meta-value">${new Date().toLocaleString()}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Coverage</div>
        <div class="meta-value">72 Hours</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Report Type</div>
        <div class="meta-value">Executive Briefing</div>
      </div>
    </div>
    
    <div class="content">
      <div class="section">
        <h2 class="section-title">📊 Key Metrics Overview</h2>
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">Total Signals</div>
            <div class="metric-value">${signals?.length || 0}</div>
          </div>
          <div class="metric-card critical">
            <div class="metric-label">Critical Signals</div>
            <div class="metric-value">${criticalSignals}</div>
          </div>
          <div class="metric-card high">
            <div class="metric-label">High Priority</div>
            <div class="metric-value">${highSignals}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Total Incidents</div>
            <div class="metric-value">${incidents?.length || 0}</div>
          </div>
          <div class="metric-card critical">
            <div class="metric-label">P1 Incidents</div>
            <div class="metric-value">${incidents?.filter(i => i.priority === 'p1').length || 0}</div>
          </div>
          <div class="metric-card high">
            <div class="metric-label">P2 Incidents</div>
            <div class="metric-value">${incidents?.filter(i => i.priority === 'p2').length || 0}</div>
          </div>
          <div class="metric-card medium">
            <div class="metric-label">Open Incidents</div>
            <div class="metric-value">${openIncidents}</div>
          </div>
          <div class="metric-card success">
            <div class="metric-label">Resolved</div>
            <div class="metric-value">${resolvedIncidents}</div>
          </div>
        </div>
      </div>
      
      <div class="section">
        <h2 class="section-title">🎯 Executive Summary</h2>
        <div class="executive-summary">${executiveSummary}</div>
      </div>
      
      <div class="section">
        <h2 class="section-title">🚨 Recent Incidents</h2>
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Status</th>
              <th>Opened</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${incidents?.length ? incidents.map(inc => {
              const duration = inc.resolved_at 
                ? Math.round((new Date(inc.resolved_at).getTime() - new Date(inc.opened_at).getTime()) / 60000)
                : Math.round((new Date().getTime() - new Date(inc.opened_at).getTime()) / 60000);
              
              return `
              <tr>
                <td><span class="badge ${inc.priority === 'p1' ? 'critical' : inc.priority === 'p2' ? 'high' : 'medium'}">${inc.priority?.toUpperCase() || 'P3'}</span></td>
                <td><span class="badge ${inc.status}">${inc.status}</span></td>
                <td>${new Date(inc.opened_at).toLocaleString()}</td>
                <td>${duration < 60 ? duration + ' min' : Math.round(duration / 60) + ' hrs'}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="4" style="text-align: center; color: #64748b;">No incidents in this period</td></tr>'}
          </tbody>
        </table>
      </div>
      
      <div class="section">
        <h2 class="section-title">📡 Signal Intelligence</h2>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Category</th>
              <th>Received</th>
              <th>Intelligence</th>
            </tr>
          </thead>
          <tbody>
            ${signals?.length ? signals.slice(0, 50).map(sig => `
              <tr>
                <td><span class="badge ${sig.severity === 'critical' ? 'critical' : sig.severity === 'high' ? 'high' : sig.severity === 'medium' ? 'medium' : 'low'}">${sig.severity || 'LOW'}</span></td>
                <td>${sig.category || 'Unknown'}</td>
                <td>${new Date(sig.received_at).toLocaleString()}</td>
                <td>${sig.normalized_text?.substring(0, 120) || 'No details'}${sig.normalized_text?.length > 120 ? '...' : ''}</td>
              </tr>
            `).join('') : '<tr><td colspan="4" style="text-align: center; color: #64748b;">No signals in this period</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    
    <div class="footer">
      <p>🕷️ ArachnNet™ Autonomous Security Intelligence Platform</p>
      <p style="margin-top: 8px; font-size: 0.75rem;">This report contains confidential security information. Distribution is restricted.</p>
    </div>
  </div>
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
