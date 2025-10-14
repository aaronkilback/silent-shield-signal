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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { client_id, period_days = 7 } = await req.json();
    
    console.log(`Generating executive report for client ${client_id}, ${period_days} days`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - period_days);
    const periodEnd = new Date();

    // Fetch client details
    const { data: client, error: clientError } = await supabaseClient
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError) throw clientError;

    // Fetch signals for this client
    const { data: signals, error: signalsError } = await supabaseClient
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .order('received_at', { ascending: false });

    if (signalsError) throw signalsError;

    // Fetch incidents for this client
    const { data: incidents, error: incidentsError } = await supabaseClient
      .from('incidents')
      .select('*')
      .eq('client_id', client_id)
      .gte('opened_at', periodStart.toISOString())
      .lte('opened_at', periodEnd.toISOString())
      .order('opened_at', { ascending: false });

    if (incidentsError) throw incidentsError;

    // Group signals by category and severity
    const signalsByCategory = signals?.reduce((acc: any, s) => {
      const cat = s.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    }, {}) || {};

    const criticalSignals = signals?.filter(s => s.severity === 'critical') || [];
    const highSignals = signals?.filter(s => s.severity === 'high') || [];

    // Calculate risk ratings
    const surveillanceRisk = signals?.filter(s => 
      s.category?.toLowerCase().includes('surveillance') || 
      s.normalized_text?.toLowerCase().includes('reconnaissance')
    ).length || 0;

    const protestRisk = signals?.filter(s => 
      s.category?.toLowerCase().includes('protest') || 
      s.category?.toLowerCase().includes('activism') ||
      s.normalized_text?.toLowerCase().includes('rally')
    ).length || 0;

    const sabotageThreat = signals?.filter(s => 
      s.category?.toLowerCase().includes('sabotage') ||
      s.category?.toLowerCase().includes('vandalism') ||
      s.severity === 'critical'
    ).length || 0;

    // Determine overall risk level
    function getRiskLevel(count: number): string {
      if (count >= 5) return 'HIGH';
      if (count >= 3) return 'ELEVATED';
      if (count >= 1) return 'MODERATE';
      return 'LOW';
    }

    const overallRiskLevel = getRiskLevel(
      Math.max(surveillanceRisk, protestRisk, sabotageThreat, criticalSignals.length)
    );

    // Generate AI-powered executive summary
    const summaryPrompt = `You are a security intelligence analyst creating an executive summary for ${client.name}.

Period: ${periodStart.toDateString()} to ${periodEnd.toDateString()}

Client Context:
- Organization: ${client.organization || client.name}
- Industry: ${client.industry || 'N/A'}
- Locations: ${client.locations?.join(', ') || 'N/A'}
- High-Value Assets: ${client.high_value_assets?.join(', ') || 'N/A'}

Intelligence Summary:
- Total signals collected: ${signals?.length || 0}
- Critical severity signals: ${criticalSignals.length}
- High severity signals: ${highSignals.length}
- Open incidents: ${incidents?.filter(i => i.status === 'open').length || 0}
- Categories: ${Object.keys(signalsByCategory).join(', ')}

Top 5 Signals:
${signals?.slice(0, 5).map((s, i) => `${i + 1}. [${s.severity}] ${s.category}: ${s.normalized_text?.substring(0, 200)}`).join('\n')}

Write a professional 2-3 paragraph executive summary that:
1. Highlights the most significant threats or developments
2. Explains potential operational or reputational risks
3. Provides context about why these matters are important
4. Uses professional security industry language

Be specific, cite concrete examples from the signals, and focus on actionable intelligence.`;

    console.log('Generating executive summary with AI...');
    const summaryResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            content: 'You are a professional security intelligence analyst with expertise in threat assessment and executive briefings. Write clear, actionable intelligence reports.'
          },
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
      }),
    });

    let executiveSummary = 'Analysis in progress...';
    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      executiveSummary = summaryData.choices?.[0]?.message?.content || executiveSummary;
    }

    // Generate deductions for top issues
    const deductionsPrompt = `As a security analyst, provide strategic deductions about the top threats facing ${client.name}.

Based on these critical/high signals:
${[...criticalSignals, ...highSignals].slice(0, 10).map((s, i) => 
  `${i + 1}. ${s.category}: ${s.normalized_text}`
).join('\n')}

Write 2-3 deduction paragraphs that:
1. Explain the strategic implications of these developments
2. Assess how they could impact operations, reputation, or stakeholder relationships
3. Identify potential escalation scenarios
4. Suggest monitoring priorities

Use professional language with phrases like "poses potential reputational risks", "could trigger increased interest from", "perception could damage", etc.`;

    console.log('Generating strategic deductions...');
    const deductionsResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            content: 'You are a strategic security analyst providing executive-level threat assessment and risk analysis.'
          },
          {
            role: 'user',
            content: deductionsPrompt
          }
        ],
      }),
    });

    let deductions = 'Analysis in progress...';
    if (deductionsResponse.ok) {
      const deductionsData = await deductionsResponse.json();
      deductions = deductionsData.choices?.[0]?.message?.content || deductions;
    }

    // Generate detailed signal narratives for top issues
    const narrativesPromises = Object.entries(signalsByCategory)
      .slice(0, 3)
      .map(async ([category, categorySignals]: [string, any]) => {
        const topSignals = categorySignals.slice(0, 5);
        
        const narrativePrompt = `Write a professional intelligence narrative about ${category} related to ${client.name}.

Signals to analyze:
${topSignals.map((s: any, i: number) => `${i + 1}. ${s.normalized_text} (${s.severity}, ${new Date(s.received_at).toLocaleDateString()})`).join('\n')}

Write 2-3 paragraphs that:
1. Summarize what's happening in this category
2. Provide context and explain significance
3. Include specific details from the signals (dates, sources, quotes if available)
4. Explain potential risks or opportunities

Use professional intelligence report language.`;

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
                content: 'You are an intelligence analyst writing detailed threat narratives for executive briefings.'
              },
              {
                role: 'user',
                content: narrativePrompt
              }
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          return {
            category,
            narrative: data.choices?.[0]?.message?.content || 'Analysis unavailable',
            signals: topSignals
          };
        }
        return {
          category,
          narrative: 'Analysis unavailable',
          signals: topSignals
        };
      });

    console.log('Generating detailed narratives...');
    const narratives = await Promise.all(narrativesPromises);

    // Generate HTML report in professional format
    const reportDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Awareness Report - ${client.name}</title>
  <style>
    @page { margin: 0.75in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: 'Arial', 'Helvetica', sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: white;
    }

    .header {
      border-bottom: 3px solid #7c3aed;
      padding-bottom: 12pt;
      margin-bottom: 24pt;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 12pt;
    }

    .classification {
      background: #7c3aed;
      color: white;
      padding: 6pt 12pt;
      font-weight: 700;
      font-size: 9pt;
      letter-spacing: 1px;
    }

    .report-date {
      font-size: 10pt;
      color: #666;
      font-weight: 600;
    }

    .logo-area {
      text-align: center;
      margin-bottom: 6pt;
    }

    .company-name {
      font-size: 20pt;
      font-weight: 700;
      color: #7c3aed;
      margin-bottom: 4pt;
    }

    .report-title {
      font-size: 14pt;
      color: #333;
      font-weight: 600;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12pt;
      background: #f8f9fa;
      padding: 12pt;
      border-radius: 4pt;
      margin-bottom: 24pt;
      border: 1px solid #e0e0e0;
    }

    .meta-item {
      font-size: 9pt;
    }

    .meta-label {
      text-transform: uppercase;
      font-weight: 700;
      color: #666;
      letter-spacing: 0.5pt;
      margin-bottom: 2pt;
    }

    .meta-value {
      color: #1a1a1a;
      font-weight: 600;
    }

    .section {
      margin-bottom: 28pt;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 14pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12pt;
      padding-bottom: 6pt;
      border-bottom: 2px solid #7c3aed;
    }

    .subsection-title {
      font-size: 12pt;
      font-weight: 700;
      color: #7c3aed;
      margin: 18pt 0 8pt 0;
    }

    .executive-summary {
      background: #f0f0f0;
      border-left: 4pt solid #7c3aed;
      padding: 16pt;
      margin: 16pt 0;
      font-size: 10.5pt;
      line-height: 1.6;
    }

    .risk-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16pt 0;
      font-size: 10pt;
    }

    .risk-table th {
      background: #7c3aed;
      color: white;
      padding: 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 9pt;
      letter-spacing: 0.5pt;
    }

    .risk-table td {
      padding: 8pt;
      border-bottom: 1px solid #e0e0e0;
    }

    .risk-table tbody tr:nth-child(even) {
      background: #f8f9fa;
    }

    .risk-badge {
      display: inline-block;
      padding: 3pt 8pt;
      border-radius: 3pt;
      font-weight: 700;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }

    .risk-low { background: #22c55e; color: white; }
    .risk-moderate { background: #eab308; color: white; }
    .risk-elevated { background: #f97316; color: white; }
    .risk-high { background: #ef4444; color: white; }

    .narrative-section {
      margin: 20pt 0;
      padding: 16pt;
      background: #fafafa;
      border-radius: 4pt;
      border: 1px solid #e0e0e0;
    }

    .narrative-text {
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1a1a1a;
      margin: 12pt 0;
    }

    .signal-citation {
      background: white;
      border-left: 3pt solid #7c3aed;
      padding: 8pt 12pt;
      margin: 8pt 0;
      font-size: 9.5pt;
      color: #555;
    }

    .signal-meta {
      font-size: 8.5pt;
      color: #888;
      margin-top: 4pt;
    }

    .deduction-box {
      background: #fff8e1;
      border: 2pt solid #f59e0b;
      border-radius: 4pt;
      padding: 16pt;
      margin: 16pt 0;
    }

    .deduction-label {
      font-weight: 700;
      color: #f59e0b;
      text-transform: uppercase;
      font-size: 9pt;
      letter-spacing: 1pt;
      margin-bottom: 8pt;
    }

    .deduction-text {
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1a1a1a;
    }

    .footer {
      position: fixed;
      bottom: 0;
      width: 100%;
      text-align: center;
      font-size: 8pt;
      color: #999;
      padding: 12pt 0;
      border-top: 1px solid #e0e0e0;
    }

    .page-break { page-break-after: always; }

    @media print {
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="classification">SENSITIVE SECURITY INFORMATION</div>
      <div class="report-date">${reportDate}</div>
    </div>
    <div class="logo-area">
      <div class="company-name">Fortress AI</div>
      <div class="report-title">${client.name} – Security Awareness Report</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">Client</div>
      <div class="meta-value">${client.name}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Reporting Period</div>
      <div class="meta-value">${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Report Generated</div>
      <div class="meta-value">${new Date().toLocaleString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Industry</div>
      <div class="meta-value">${client.industry || 'N/A'}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Signals Analyzed</div>
      <div class="meta-value">${signals?.length || 0}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Incidents Tracked</div>
      <div class="meta-value">${incidents?.length || 0}</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <div class="executive-summary">
      ${executiveSummary.split('\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Risk Rating</h2>
    <p style="margin-bottom: 12pt;">
      The overall inherent risk rating for ${client.name} for ${reportDate} is 
      <strong><span class="risk-badge risk-${overallRiskLevel.toLowerCase()}">${overallRiskLevel}</span></strong>
    </p>

    <table class="risk-table">
      <thead>
        <tr>
          <th>Threat Factor</th>
          <th>Risk Rating</th>
          <th>Signal Count</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Surveillance / Reconnaissance</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(surveillanceRisk).toLowerCase()}">${getRiskLevel(surveillanceRisk)}</span></td>
          <td>${surveillanceRisk}</td>
        </tr>
        <tr>
          <td><strong>Protest / Activism</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(protestRisk).toLowerCase()}">${getRiskLevel(protestRisk)}</span></td>
          <td>${protestRisk}</td>
        </tr>
        <tr>
          <td><strong>Work Interruption</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(incidents?.filter(i => i.status === 'open').length || 0).toLowerCase()}">${getRiskLevel(incidents?.filter(i => i.status === 'open').length || 0)}</span></td>
          <td>${incidents?.filter(i => i.status === 'open').length || 0}</td>
        </tr>
        <tr>
          <td><strong>Sabotage / Vandalism</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(sabotageThreat).toLowerCase()}">${getRiskLevel(sabotageThreat)}</span></td>
          <td>${sabotageThreat}</td>
        </tr>
        <tr>
          <td><strong>Critical Threats</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(criticalSignals.length).toLowerCase()}">${getRiskLevel(criticalSignals.length)}</span></td>
          <td>${criticalSignals.length}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${narratives.length > 0 ? `
    <div class="page-break"></div>
    <div class="section">
      <h2 class="section-title">Issues of Specific Concern</h2>
      ${narratives.map(item => `
        <div class="narrative-section">
          <h3 class="subsection-title">${item.category}</h3>
          <div class="narrative-text">
            ${item.narrative.split('\n\n').map((p: string) => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
          </div>
          
          ${item.signals.slice(0, 3).map((signal: any) => `
            <div class="signal-citation">
              <strong>${signal.category || 'Signal'}:</strong> ${signal.normalized_text?.substring(0, 200) || 'No details available'}
              <div class="signal-meta">
                Severity: ${signal.severity?.toUpperCase()} | 
                Received: ${new Date(signal.received_at).toLocaleString()} |
                Location: ${signal.location || 'Unknown'}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
  ` : ''}

  <div class="section">
    <div class="deduction-box">
      <div class="deduction-label">Deductions</div>
      <div class="deduction-text">
        ${deductions.split('\n\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
      </div>
    </div>
  </div>

  <div class="footer">
    Client: ${client.name} | Effective Date: ${reportDate}<br>
    Copyright © 2025. Fortress AI Security Intelligence Platform. All Rights Reserved.
  </div>
</body>
</html>`;

    // Store report metadata
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        type: 'executive_intelligence',
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        meta_json: {
          client_id,
          client_name: client.name,
          total_signals: signals?.length || 0,
          critical_signals: criticalSignals.length,
          high_signals: highSignals.length,
          open_incidents: incidents?.filter(i => i.status === 'open').length || 0,
          overall_risk_level: overallRiskLevel,
          categories: Object.keys(signalsByCategory),
          executive_summary: executiveSummary,
          deductions,
          narratives: narratives.map(n => ({ category: n.category, narrative: n.narrative }))
        }
      })
      .select()
      .single();

    if (reportError) throw reportError;

    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.id,
        html,
        metadata: {
          client: client.name,
          period: `${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
          signals_analyzed: signals?.length || 0,
          risk_level: overallRiskLevel,
          categories: Object.keys(signalsByCategory)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating executive report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});