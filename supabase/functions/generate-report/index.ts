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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

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

    // Fetch investigations in time window (using user auth)
    const { data: investigations, error: investigationsError } = await supabaseClient
      .from('investigations')
      .select('*')
      .gte('created_at', periodStart.toISOString())
      .lte('created_at', periodEnd.toISOString())
      .order('created_at', { ascending: false });

    if (investigationsError) throw investigationsError;

    // Calculate metrics
    const criticalSignals = signals?.filter(s => s.severity === 'critical').length || 0;
    const highSignals = signals?.filter(s => s.severity === 'high').length || 0;
    const openIncidents = incidents?.filter(i => i.status === 'open').length || 0;
    const resolvedIncidents = incidents?.filter(i => i.status === 'resolved').length || 0;

    // Generate AI recommendations for top signals
    const signalsWithRecommendations = await Promise.all(
      (signals || []).slice(0, 20).map(async (signal) => {
        if (!LOVABLE_API_KEY) return { ...signal, recommendations: 'AI recommendations unavailable' };
        
        try {
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
                  content: 'You are a cybersecurity analyst. Provide 3-4 brief, actionable recommendations for responding to this security signal. Be concise and specific.'
                },
                {
                  role: 'user',
                  content: `Signal: ${signal.normalized_text}\nSeverity: ${signal.severity}\nCategory: ${signal.category}\nLocation: ${signal.location || 'Unknown'}`
                }
              ],
            }),
          });

          const aiData = await aiResponse.json();
          const recommendations = aiData.choices?.[0]?.message?.content || 'No recommendations available';
          return { ...signal, recommendations };
        } catch (error) {
          console.error('Error generating recommendations:', error);
          return { ...signal, recommendations: 'Unable to generate recommendations' };
        }
      })
    );

    // Use AI to generate executive summary
    
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

    // Calculate additional analytics
    const signalsByCategory = signals?.reduce((acc: any, s) => {
      acc[s.category || 'uncategorized'] = (acc[s.category || 'uncategorized'] || 0) + 1;
      return acc;
    }, {}) || {};

    const signalsBySeverity = {
      critical: criticalSignals,
      high: highSignals,
      medium: signals?.filter(s => s.severity === 'medium').length || 0,
      low: signals?.filter(s => s.severity === 'low').length || 0,
    };

    const avgResponseTime = incidents?.length > 0
      ? incidents.reduce((sum, i) => {
          if (i.resolved_at && i.opened_at) {
            return sum + (new Date(i.resolved_at).getTime() - new Date(i.opened_at).getTime());
          }
          return sum;
        }, 0) / incidents.filter(i => i.resolved_at).length / 1000 / 60 / 60
      : 0;

    // Format dates for header
    const coverageStart = new Date(periodStart);
    const coverageEnd = new Date(periodEnd);
    const generatedDate = new Date();
    
    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    
    const formatDateTime = (date: Date) => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
        ' – ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    // Generate HTML report with tactical executive briefing format
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>72-Hour Intelligence Snapshot</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0a0a0a;
      color: #e5e7eb;
      line-height: 1.5;
      padding: 0;
    }
    
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
      position: relative;
    }
    
    .header {
      background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
      border-bottom: 3px solid #00d9ff;
      padding: 32px 40px;
      position: relative;
    }
    
    .header::after {
      content: '';
      position: absolute;
      bottom: -3px;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, #00d9ff, transparent);
    }
    
    .header-title {
      font-size: 2rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 20px;
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
    
    .header-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 32px;
      font-size: 0.875rem;
    }
    
    .header-meta-item {
      display: flex;
      gap: 8px;
    }
    
    .header-meta-label {
      color: #9ca3af;
      font-weight: 600;
      min-width: 100px;
    }
    
    .header-meta-value {
      color: #e5e7eb;
      font-weight: 500;
    }
    
    .classification {
      margin-top: 16px;
      padding: 8px 16px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #ef4444;
      border-radius: 4px;
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #fca5a5;
    }
    
    .content {
      padding: 32px 40px;
    }
    
    .section {
      margin-bottom: 32px;
      background: #1a1a1a;
      border-radius: 8px;
      padding: 24px;
      border: 1px solid #2a2a2a;
    }
    
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #00d9ff;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .section-title::before {
      content: '';
      width: 4px;
      height: 24px;
      background: linear-gradient(180deg, #00d9ff, #0ea5e9);
      border-radius: 2px;
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .metric-card {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 20px;
      border: 1px solid #2a2a2a;
      position: relative;
      overflow: hidden;
    }
    
    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, currentColor, transparent);
      opacity: 0.5;
    }
    
    .metric-label {
      font-size: 0.75rem;
      color: #6b7280;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .metric-value {
      font-size: 2rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1;
    }
    
    .metric-card.critical { color: #ef4444; }
    .metric-card.critical .metric-value { color: #ef4444; }
    .metric-card.high { color: #f97316; }
    .metric-card.high .metric-value { color: #f97316; }
    .metric-card.medium { color: #eab308; }
    .metric-card.medium .metric-value { color: #eab308; }
    .metric-card.success { color: #22c55e; }
    .metric-card.success .metric-value { color: #22c55e; }
    .metric-card.info { color: #00d9ff; }
    .metric-card.info .metric-value { color: #00d9ff; }
    
    .executive-summary {
      background: #0a0a0a;
      border: 1px solid #2a2a2a;
      border-left: 3px solid #00d9ff;
      border-radius: 6px;
      padding: 20px 24px;
      margin-bottom: 16px;
      white-space: pre-wrap;
      line-height: 1.7;
      font-size: 0.95rem;
      color: #d1d5db;
    }

    .chart-container {
      position: relative;
      height: 300px;
      margin: 32px 0;
      background: #0f172a;
      border-radius: 12px;
      padding: 24px;
    }

    .two-column {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin: 32px 0;
    }

    .recommendations-grid {
      display: grid;
      gap: 16px;
      margin-top: 24px;
    }

    .recommendation-card {
      background: linear-gradient(135deg, #334155 0%, #1e293b 100%);
      border-left: 4px solid #7c3aed;
      border-radius: 8px;
      padding: 20px;
    }

    .recommendation-card h4 {
      color: #a855f7;
      margin-bottom: 8px;
      font-size: 1rem;
    }

    .recommendation-card p {
      color: #cbd5e1;
      font-size: 0.95rem;
      line-height: 1.6;
    }

    .timeline {
      position: relative;
      padding: 20px 0 20px 40px;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(180deg, #7c3aed 0%, #a855f7 100%);
    }

    .timeline-item {
      position: relative;
      margin-bottom: 24px;
      padding-left: 30px;
    }

    .timeline-item::before {
      content: '';
      position: absolute;
      left: -31px;
      top: 4px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #7c3aed;
      border: 3px solid #1e293b;
    }

    .timeline-time {
      font-size: 0.75rem;
      color: #94a3b8;
      font-weight: 600;
    }

    .timeline-content {
      margin-top: 4px;
      color: #e2e8f0;
    }

    .priority-matrix {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin: 24px 0;
    }

    .priority-cell {
      background: #0f172a;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      border: 2px solid #334155;
    }

    .priority-cell.p1 { border-color: #ef4444; }
    .priority-cell.p2 { border-color: #f97316; }
    .priority-cell.p3 { border-color: #eab308; }
    .priority-cell.p4 { border-color: #22c55e; }

    .priority-cell-value {
      font-size: 2.5rem;
      font-weight: 800;
      margin-bottom: 8px;
    }

    .priority-cell.p1 .priority-cell-value { color: #ef4444; }
    .priority-cell.p2 .priority-cell-value { color: #f97316; }
    .priority-cell.p3 .priority-cell-value { color: #eab308; }
    .priority-cell.p4 .priority-cell-value { color: #22c55e; }
    
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
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge-critical {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border: 1px solid #ef4444;
    }
    
    .badge-high {
      background: rgba(249, 115, 22, 0.2);
      color: #fdba74;
      border: 1px solid #f97316;
    }
    
    .badge-medium {
      background: rgba(234, 179, 8, 0.2);
      color: #fde047;
      border: 1px solid #eab308;
    }
    
    .badge-low {
      background: rgba(34, 197, 94, 0.2);
      color: #86efac;
      border: 1px solid #22c55e;
    }
    
    .signal-item {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid #2a2a2a;
      border-left: 3px solid #3b82f6;
    }
    
    .signal-item.critical { border-left-color: #ef4444; }
    .signal-item.high { border-left-color: #f97316; }
    .signal-item.medium { border-left-color: #eab308; }
    
    .signal-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 8px;
      gap: 16px;
    }
    
    .signal-text {
      flex: 1;
      font-weight: 500;
      color: #e5e7eb;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    
    .signal-meta {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
      color: #6b7280;
      margin-top: 8px;
    }
    
    .trend-item {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid #2a2a2a;
      display: flex;
      justify-space-between;
      align-items: center;
    }
    
    .trend-text {
      color: #e5e7eb;
      font-size: 0.9rem;
      font-weight: 500;
    }
    
    .action-item {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid #2a2a2a;
      border-left: 3px solid #00d9ff;
    }
    
    .action-text {
      color: #e5e7eb;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    
    .investigation-item {
      background: #0a0a0a;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid #2a2a2a;
      border-left: 3px solid #8b5cf6;
    }
    
    .investigation-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 8px;
    }
    
    .investigation-number {
      font-weight: 700;
      color: #8b5cf6;
      font-size: 0.9rem;
    }
    
    .investigation-info {
      color: #9ca3af;
      font-size: 0.85rem;
    }
    
    .investigation-synopsis {
      color: #d1d5db;
      font-size: 0.85rem;
      line-height: 1.5;
      margin-top: 8px;
    }
    
    .footer {
      background: #0a0a0a;
      padding: 20px 40px;
      text-align: center;
      font-size: 0.75rem;
      color: #6b7280;
      border-top: 1px solid #2a2a2a;
    }
    
    @media print {
      body { background: white; }
      .page { box-shadow: none; }
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
        <h2 class="section-title">📊 Threat Intelligence Analytics</h2>
        
        <div class="two-column">
          <div class="chart-container">
            <canvas id="severityChart"></canvas>
          </div>
          <div class="chart-container">
            <canvas id="categoryChart"></canvas>
          </div>
        </div>

        <div class="section">
          <h3 style="font-size: 1.25rem; margin-bottom: 16px; color: #e2e8f0;">📈 Response Performance</h3>
          <div class="priority-matrix">
            <div class="priority-cell p1">
              <div class="priority-cell-value">${incidents?.filter(i => i.priority === 'p1').length || 0}</div>
              <div style="color: #cbd5e1; font-size: 0.875rem;">P1 Incidents</div>
            </div>
            <div class="priority-cell p2">
              <div class="priority-cell-value">${incidents?.filter(i => i.priority === 'p2').length || 0}</div>
              <div style="color: #cbd5e1; font-size: 0.875rem;">P2 Incidents</div>
            </div>
            <div class="priority-cell p3">
              <div class="priority-cell-value">${incidents?.filter(i => i.priority === 'p3').length || 0}</div>
              <div style="color: #cbd5e1; font-size: 0.875rem;">P3 Incidents</div>
            </div>
            <div class="priority-cell p4">
              <div class="priority-cell-value">${avgResponseTime > 0 ? avgResponseTime.toFixed(1) + 'h' : 'N/A'}</div>
              <div style="color: #cbd5e1; font-size: 0.875rem;">Avg Response Time</div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">⏱️ Incident Timeline</h2>
        <div class="timeline">
          ${incidents?.slice(0, 10).map(inc => `
            <div class="timeline-item">
              <div class="timeline-time">${new Date(inc.opened_at).toLocaleString()}</div>
              <div class="timeline-content">
                <strong style="color: ${inc.priority === 'p1' ? '#ef4444' : inc.priority === 'p2' ? '#f97316' : '#eab308'};">${inc.priority?.toUpperCase()}</strong> incident ${inc.status === 'resolved' ? 'resolved' : 'opened'}
                ${inc.resolved_at ? `<span style="color: #94a3b8;"> (${Math.round((new Date(inc.resolved_at).getTime() - new Date(inc.opened_at).getTime()) / 60000)} min)</span>` : ''}
              </div>
            </div>
          `).join('') || '<p style="color: #64748b;">No recent incidents</p>'}
        </div>
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
        <h2 class="section-title">📡 Signal Intelligence (Click for AI Recommendations)</h2>
        <style>
          .signal-row {
            cursor: pointer;
            transition: background-color 0.2s;
          }
          .signal-row:hover {
            background: #334155 !important;
          }
          .signal-details {
            display: none;
            background: #0f172a;
            border-top: 2px solid #7c3aed;
          }
          .signal-row.expanded + .signal-details {
            display: table-row;
          }
          .recommendations-box {
            padding: 24px;
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            border-radius: 8px;
            margin: 16px;
            border-left: 4px solid #7c3aed;
          }
          .recommendations-box h4 {
            color: #a855f7;
            margin-bottom: 12px;
            font-size: 1rem;
          }
          .recommendations-box p {
            color: #e2e8f0;
            line-height: 1.8;
            white-space: pre-wrap;
          }
        </style>
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
            ${signalsWithRecommendations?.length ? signalsWithRecommendations.map((sig, idx) => `
              <tr class="signal-row" onclick="this.classList.toggle('expanded')">
                <td><span class="badge ${sig.severity === 'critical' ? 'critical' : sig.severity === 'high' ? 'high' : sig.severity === 'medium' ? 'medium' : 'low'}">${sig.severity || 'LOW'}</span></td>
                <td>${sig.category || 'Unknown'}</td>
                <td>${new Date(sig.received_at).toLocaleString()}</td>
                <td>${sig.normalized_text?.substring(0, 120) || 'No details'}${sig.normalized_text?.length > 120 ? '...' : ''}</td>
              </tr>
              <tr class="signal-details">
                <td colspan="4">
                  <div class="recommendations-box">
                    <h4>🎯 AI-Generated Recommendations</h4>
                    <p>${sig.recommendations}</p>
                    ${sig.raw_json ? `
                      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #475569;">
                        <strong style="color: #94a3b8;">Additional Details:</strong>
                        <pre style="margin-top: 8px; color: #cbd5e1; font-size: 0.85rem; white-space: pre-wrap;">${JSON.stringify(sig.raw_json, null, 2)}</pre>
                      </div>
                    ` : ''}
                  </div>
                </td>
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
  
  <script>
    // Initialize severity distribution chart
    const severityCtx = document.getElementById('severityChart');
    if (severityCtx) {
      new Chart(severityCtx, {
        type: 'doughnut',
        data: {
          labels: ['Critical', 'High', 'Medium', 'Low'],
          datasets: [{
            data: [${signalsBySeverity.critical}, ${signalsBySeverity.high}, ${signalsBySeverity.medium}, ${signalsBySeverity.low}],
            backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e'],
            borderColor: '#1e293b',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#e2e8f0', padding: 15, font: { size: 12 } }
            },
            title: {
              display: true,
              text: 'Signals by Severity',
              color: '#e2e8f0',
              font: { size: 16, weight: 'bold' }
            }
          }
        }
      });
    }

    // Initialize category distribution chart
    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx) {
      const categoryData = ${JSON.stringify(signalsByCategory)};
      const categories = Object.keys(categoryData).slice(0, 8);
      const values = categories.map(c => categoryData[c]);
      
      new Chart(categoryCtx, {
        type: 'bar',
        data: {
          labels: categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)),
          datasets: [{
            label: 'Signals',
            data: values,
            backgroundColor: '#7c3aed',
            borderColor: '#a855f7',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: {
              display: true,
              text: 'Signals by Category',
              color: '#e2e8f0',
              font: { size: 16, weight: 'bold' }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { color: '#94a3b8' },
              grid: { color: '#334155' }
            },
            x: {
              ticks: { color: '#94a3b8', maxRotation: 45, minRotation: 45 },
              grid: { display: false }
            }
          }
        }
      });
    }
  </script>
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
