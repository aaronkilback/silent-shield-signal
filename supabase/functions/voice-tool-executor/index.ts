import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tool_name, arguments: toolArgs } = await req.json();
    console.log(`[Voice Tool] Executing: ${tool_name}`, toolArgs);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let result: unknown;

    switch (tool_name) {
      case 'search_web': {
        const query = toolArgs.query || '';
        try {
          const searchResponse = await fetch(`${supabaseUrl}/functions/v1/perform-external-web-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
            body: JSON.stringify({ query, max_results: 5 }),
          });
          if (searchResponse.ok) {
            const data = await searchResponse.json();
            result = { found: data.data_source !== 'no_data', summary: data.summary, source_type: data.data_source };
          } else {
            result = { found: false, message: 'Search unavailable' };
          }
        } catch {
          result = { found: false, message: 'Search error' };
        }
        break;
      }
      
      case 'get_current_threats': {
        const { data: signals } = await supabase.from('signals')
          .select('id, title, severity, rule_category, status')
          .in('severity', ['critical', 'high']).in('status', ['new', 'triaged'])
          .order('created_at', { ascending: false }).limit(10);
        const { data: incidents } = await supabase.from('incidents')
          .select('id, title, severity_level, priority, status')
          .in('status', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(10);
        result = {
          signals: signals?.map(s => ({ title: s.title, severity: s.severity, category: s.rule_category })) || [],
          incidents: incidents?.map(i => ({ title: i.title, severity: i.severity_level, priority: i.priority })) || [],
          summary: `${signals?.length || 0} high signals, ${incidents?.length || 0} open incidents`
        };
        break;
      }
      
      case 'get_entity_info': {
        const { data: entities } = await supabase.from('entities')
          .select('id, name, type, risk_level, description')
          .ilike('name', `%${toolArgs.entity_name || ''}%`).limit(5);
        if (entities?.length) {
          const e = entities[0];
          result = { found: true, entity: { name: e.name, type: e.type, risk_level: e.risk_level, description: e.description } };
        } else {
          result = { found: false, message: `No entity found matching "${toolArgs.entity_name}"` };
        }
        break;
      }
      
      case 'analyze_threat_radar': {
        const { data: signals } = await supabase.from('signals')
          .select('severity, rule_category')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).limit(100);
        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        signals?.forEach(s => { if (s.severity in counts) counts[s.severity as keyof typeof counts]++; });
        const score = counts.critical * 10 + counts.high * 5 + counts.medium * 2 + counts.low;
        result = {
          threat_score: score,
          overall_level: score > 50 ? 'CRITICAL' : score > 30 ? 'HIGH' : score > 15 ? 'ELEVATED' : 'LOW',
          signal_counts: counts
        };
        break;
      }
      
      case 'get_client_info': {
        const { data: clients } = await supabase.from('clients')
          .select('id, name, industry, status').ilike('name', `%${toolArgs.client_name || ''}%`).limit(5);
        if (clients?.length) {
          result = { found: true, client: clients[0] };
        } else {
          result = { found: false, message: `No client found matching "${toolArgs.client_name}"` };
        }
        break;
      }
      
      case 'get_travel_status': {
        const { data: travelers } = await supabase.from('travelers')
          .select('name, current_location, status')
          .in('status', ['traveling', 'in_country']).limit(20);
        result = { active_travelers: travelers?.length || 0, travelers: travelers || [] };
        break;
      }
      
      case 'get_investigation_status': {
        const { data: investigations } = await supabase.from('investigations')
          .select('id, title, status, priority')
          .in('status', ['open', 'in_progress']).order('created_at', { ascending: false }).limit(10);
        result = { count: investigations?.length || 0, investigations: investigations || [] };
        break;
      }
      
      case 'generate_intelligence_summary': {
        const hours = toolArgs.time_range_hours || 24;
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const { data: signals } = await supabase.from('signals')
          .select('severity, rule_category').gte('created_at', cutoff).limit(50);
        const { data: incidents } = await supabase.from('incidents')
          .select('priority, status').in('status', ['open', 'acknowledged']).limit(20);
        const critical = signals?.filter(s => ['critical', 'high'].includes(s.severity)).length || 0;
        const p1p2 = incidents?.filter(i => ['p1', 'p2'].includes(i.priority)).length || 0;
        result = {
          time_range_hours: hours,
          total_signals: signals?.length || 0,
          critical_high: critical,
          open_incidents: incidents?.length || 0,
          high_priority: p1p2
        };
        break;
      }
      
      case 'check_dark_web_exposure': {
        const email = toolArgs.email;
        if (!email) { result = { error: 'Email required' }; break; }
        const apiKey = Deno.env.get('HIBP_API_KEY');
        if (!apiKey) { result = { error: 'HIBP not configured' }; break; }
        try {
          const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
            { headers: { 'hibp-api-key': apiKey, 'user-agent': 'Fortress-AEGIS' } });
          if (res.ok) {
            const breaches = await res.json();
            result = { found: true, breach_count: breaches.length, email };
          } else if (res.status === 404) {
            result = { found: false, breach_count: 0, email };
          } else {
            result = { error: `Check failed: ${res.status}` };
          }
        } catch (e) {
          result = { error: `Breach check error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
        break;
      }
      
      case 'get_threat_intel_feeds': {
        try {
          const res = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
            { signal: AbortSignal.timeout(10000) });
          if (res.ok) {
            const data = await res.json();
            const vulns = (data.vulnerabilities || []).slice(0, 5);
            result = { source: 'CISA KEV', count: vulns.length, vulnerabilities: vulns.map((v: any) => ({ cve: v.cveID, vendor: v.vendorProject })) };
          } else {
            result = { error: 'CISA feed unavailable' };
          }
        } catch {
          result = { error: 'Feed fetch error' };
        }
        break;
      }
      
      case 'run_vip_deep_scan': {
        const name = toolArgs.name;
        if (!name) { result = { error: 'Name required' }; break; }
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/vip-osint-discovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
            body: JSON.stringify({ name, email: toolArgs.email })
          });
          if (res.ok) {
            result = { scan_complete: true, subject: name };
          } else {
            result = { error: `Scan failed: ${res.status}` };
          }
        } catch (e) {
          result = { error: `Scan error: ${e instanceof Error ? e.message : 'Unknown'}` };
        }
        break;
      }
      
      default:
        result = { error: `Unknown tool: ${tool_name}` };
    }
    
    console.log(`[Voice Tool] Result for ${tool_name}:`, JSON.stringify(result).substring(0, 300));
    return new Response(JSON.stringify({ result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Voice Tool] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
