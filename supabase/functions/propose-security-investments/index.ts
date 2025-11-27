import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, budget_constraints, timeframe_months = 12 } = await req.json();
    console.log('Proposing security investments for client:', client_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      throw new Error('Client not found');
    }

    // Fetch historical incident data for trend analysis
    const { data: incidents } = await supabase
      .from('incidents')
      .select('*')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false });

    // Fetch recent signals for threat landscape
    const { data: signals } = await supabase
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .order('detected_at', { ascending: false })
      .limit(100);

    const proposalPrompt = `
You are a strategic security investment advisor providing C-suite recommendations for security capital expenditure.

CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry || 'Unknown'}
- Locations: ${client.locations?.join(', ') || 'Unknown'}
- High-value Assets: ${client.high_value_assets?.join(', ') || 'None specified'}
- Employee Count: ${client.employee_count || 'Unknown'}
- Current Threat Profile: ${JSON.stringify(client.threat_profile || {})}

BUDGET CONSTRAINTS:
${budget_constraints || 'No specific constraints provided'}

INVESTMENT TIMEFRAME: ${timeframe_months} months

THREAT LANDSCAPE ANALYSIS:
- Total Signals (Recent): ${signals?.length || 0}
- Total Incidents (Historical): ${incidents?.length || 0}
- Open Incidents: ${incidents?.filter(i => i.status === 'open').length || 0}

TASK:
Develop a strategic security investment portfolio prioritized by risk reduction ROI. Provide:

1. EXECUTIVE SUMMARY:
   - Top 3-5 strategic investment priorities
   - Total recommended investment range
   - Expected risk reduction outcomes

2. INVESTMENT CATEGORIES:
   
   A. TECHNOLOGY INVESTMENTS:
      - Threat detection & intelligence platforms
      - Access control & identity management
      - Incident response & automation tools
      - Physical security infrastructure
      - Cyber defense technologies
   
   B. PERSONNEL INVESTMENTS:
      - Security team expansion
      - Specialized expertise (threat intel, SOC analysts)
      - Training & certification programs
   
   C. INFRASTRUCTURE INVESTMENTS:
      - Facility hardening
      - Network segmentation
      - Backup & business continuity
   
   D. PROCESS/PROGRAM INVESTMENTS:
      - Security assessments & audits
      - Tabletop exercises & preparedness
      - Policy development & compliance

3. PRIORITIZATION MATRIX:
   For each investment category, provide:
   - Estimated cost range
   - Expected risk reduction (%)
   - Implementation timeline
   - Dependencies
   - Strategic rationale

4. PHASED IMPLEMENTATION ROADMAP:
   - Quarter 1: Critical/foundational investments
   - Quarter 2-3: Strategic capability buildout
   - Quarter 4: Optimization & enhancement

5. ROI JUSTIFICATION:
   - Cost-benefit analysis
   - Avoided incident cost projections
   - Efficiency gains
   - Compliance/regulatory benefits

6. METRICS & SUCCESS CRITERIA:
   - KPIs to measure investment effectiveness
   - Expected improvements in security posture

Tailor recommendations to client industry, threat profile, and operational requirements. Focus on practical, defensible investments that directly address observed threat patterns.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are an expert strategic security investment advisor specializing in security capital planning and ROI optimization.' },
          { role: 'user', content: proposalPrompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const proposal = data.choices?.[0]?.message?.content;

    if (!proposal) {
      throw new Error('No proposal generated');
    }

    console.log('Security investment proposal generated');

    return new Response(
      JSON.stringify({ 
        client_id,
        investment_proposal: proposal,
        timeframe_months,
        generated_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in propose-security-investments:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
