// Specialized voice tool handlers - threat radar, client info, scans, intel feeds

export async function handleAnalyzeThreatRadar(supabase: any) {
  const { data: allSignals } = await supabase.from('signals')
    .select('id, severity, rule_category, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(100);
  
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const categoryBreakdown: Record<string, number> = {};
  
  allSignals?.forEach((s: any) => {
    if (s.severity in severityCounts) severityCounts[s.severity as keyof typeof severityCounts]++;
    const cat = s.rule_category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });
  
  const { data: activeIncidents } = await supabase.from('incidents')
    .select('id, priority, status').in('status', ['open', 'investigating']);
  
  const incidentCounts = { p1: 0, p2: 0, p3: 0, p4: 0 };
  activeIncidents?.forEach((i: any) => {
    if (i.priority in incidentCounts) incidentCounts[i.priority as keyof typeof incidentCounts]++;
  });
  
  const threatScore = (severityCounts.critical * 10) + (severityCounts.high * 5) + (severityCounts.medium * 2) + severityCounts.low;
  let overallThreatLevel = 'LOW';
  if (threatScore > 50) overallThreatLevel = 'CRITICAL';
  else if (threatScore > 30) overallThreatLevel = 'HIGH';
  else if (threatScore > 15) overallThreatLevel = 'ELEVATED';
  else if (threatScore > 5) overallThreatLevel = 'MODERATE';
  
  return {
    overall_threat_level: overallThreatLevel,
    threat_score: threatScore,
    signal_breakdown: severityCounts,
    incident_breakdown: incidentCounts,
    top_categories: Object.entries(categoryBreakdown).sort(([,a], [,b]) => b - a).slice(0, 5)
      .map(([cat, count]) => ({ category: cat, count })),
    analysis_period: '7 days',
    generated_at: new Date().toISOString()
  };
}

export async function handleGetClientInfo(supabase: any, toolArgs: any) {
  const clientName = toolArgs.client_name || '';
  
  const { data: clients } = await supabase.from('clients')
    .select('id, name, industry, status, locations, monitoring_keywords')
    .ilike('name', `%${clientName}%`).limit(5);
  
  if (clients?.length > 0) {
    const client = clients[0];
    const { data: clientSignals } = await supabase.from('signals')
      .select('id, title, severity, created_at')
      .eq('client_id', client.id).order('created_at', { ascending: false }).limit(5);
    
    return {
      found: true,
      client: { id: client.id, name: client.name, industry: client.industry, status: client.status },
      recent_signals: clientSignals || [],
      other_matches: clients.length > 1 ? clients.slice(1).map((c: any) => c.name) : []
    };
  }
  return { found: false, message: `No client found matching "${clientName}"` };
}

export async function handleGetKnowledgeBase(supabase: any, toolArgs: any) {
  const topic = toolArgs.topic || toolArgs.query || '';
  const category = toolArgs.category;
  
  let query = supabase.from('knowledge_base_articles')
    .select('id, title, content, category, tags, created_at')
    .order('created_at', { ascending: false }).limit(10);
  
  if (category) query = query.eq('category', category);
  if (topic) query = query.or(`title.ilike.%${topic}%,content.ilike.%${topic}%`);
  
  const { data: articles } = await query;
  
  return {
    found: (articles?.length || 0) > 0,
    count: articles?.length || 0,
    articles: articles?.map((a: any) => ({
      id: a.id, title: a.title, category: a.category, tags: a.tags,
      excerpt: a.content?.substring(0, 200) + '...'
    })) || []
  };
}

export async function handleGetTravelStatus(supabase: any) {
  const { data: activeItineraries } = await supabase.from('itineraries')
    .select('id, destinations, start_date, end_date, status, risk_level')
    .in('status', ['active', 'upcoming']).order('start_date', { ascending: true }).limit(10);
  
  const { data: travelers } = await supabase.from('travelers')
    .select('id, name, current_location, status')
    .in('status', ['traveling', 'in_country']).limit(20);
  
  return {
    active_travelers: travelers?.length || 0,
    active_itineraries: activeItineraries?.length || 0,
    travelers: travelers?.map((t: any) => ({ name: t.name, location: t.current_location, status: t.status })) || [],
    itineraries: activeItineraries?.map((i: any) => ({
      destinations: i.destinations, start_date: i.start_date, end_date: i.end_date, risk_level: i.risk_level
    })) || []
  };
}

export async function handleGetInvestigationStatus(supabase: any, toolArgs: any) {
  const investigationName = toolArgs.investigation_name;
  
  let query = supabase.from('investigations')
    .select('id, title, status, priority, lead_investigator, created_at, description')
    .order('created_at', { ascending: false }).limit(10);
  
  if (investigationName) query = query.ilike('title', `%${investigationName}%`);
  else query = query.in('status', ['open', 'in_progress']);
  
  const { data: investigations } = await query;
  
  return {
    found: (investigations?.length || 0) > 0,
    count: investigations?.length || 0,
    investigations: investigations?.map((inv: any) => ({
      id: inv.id, title: inv.title, status: inv.status, priority: inv.priority,
      lead: inv.lead_investigator, created_at: inv.created_at
    })) || []
  };
}

export async function handleCheckDarkWebExposure(toolArgs: any) {
  const email = toolArgs.email;
  if (!email) return { error: "Email address is required for breach check" };
  
  const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
  if (!HIBP_API_KEY) return { error: "Dark web breach checking is not configured" };
  
  try {
    const hibpResponse = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      { headers: { "hibp-api-key": HIBP_API_KEY, "user-agent": "Fortress-AEGIS-Voice" } }
    );
    
    if (hibpResponse.ok) {
      const breaches = await hibpResponse.json();
      const criticalBreaches = breaches.filter((b: any) => 
        (b.DataClasses || []).some((dc: string) => /password|credit|financial/i.test(dc))
      );
      return {
        found: true, email, breach_count: breaches.length, critical_breaches: criticalBreaches.length,
        breaches: breaches.slice(0, 5).map((b: any) => ({ name: b.Name, date: b.BreachDate })),
        risk_level: criticalBreaches.length > 0 ? "critical" : breaches.length > 2 ? "high" : "medium",
        summary: `${email} found in ${breaches.length} breach(es).`
      };
    } else if (hibpResponse.status === 404) {
      return { found: false, email, breach_count: 0, risk_level: "low", summary: `${email} not found in breaches.` };
    }
    return { error: `Breach check failed: ${hibpResponse.status}` };
  } catch (e) {
    return { error: `Breach check error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleGetThreatIntelFeeds() {
  try {
    const cisaResponse = await fetch(
      "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      { signal: AbortSignal.timeout(10000) }
    );
    
    if (cisaResponse.ok) {
      const cisaData = await cisaResponse.json();
      const vulns = (cisaData.vulnerabilities || []).slice(0, 5);
      return {
        source: "CISA Known Exploited Vulnerabilities",
        count: vulns.length,
        vulnerabilities: vulns.map((v: any) => ({ cve: v.cveID, vendor: v.vendorProject, product: v.product })),
        summary: `${vulns.length} active vulnerabilities requiring patching.`
      };
    }
    return { error: `CISA feed unavailable: ${cisaResponse.status}` };
  } catch (e) {
    return { error: `Threat intel fetch error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleRunVipDeepScan(supabaseUrl: string, supabaseKey: string, toolArgs: any) {
  const name = toolArgs.name;
  if (!name) return { error: "Name is required for VIP deep scan" };
  
  try {
    const scanResponse = await fetch(`${supabaseUrl}/functions/v1/vip-osint-discovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ name, email: toolArgs.email, location: toolArgs.location })
    });
    
    if (!scanResponse.ok) return { error: `Deep scan failed: ${scanResponse.status}` };
    
    const text = await scanResponse.text();
    const lines = text.split("\n").filter(l => l.startsWith("data: "));
    let discoveryCount = 0, breachCount = 0, executiveSummary = "";
    
    for (const line of lines) {
      try {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr === "[DONE]") continue;
        const event = JSON.parse(jsonStr);
        if (event.type === "discovery") discoveryCount++;
        if (event.type === "discovery" && event.data?.type === "breach") breachCount++;
        if (event.type === "executive_summary") executiveSummary = event.data?.summary || "";
      } catch { /* skip */ }
    }
    
    return {
      scan_complete: true, subject: name, discoveries_found: discoveryCount, breaches_found: breachCount,
      summary: executiveSummary || `Deep scan completed for ${name}. Found ${discoveryCount} data points.`
    };
  } catch (e) {
    return { error: `Deep scan error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleRunEntityDeepScan(supabase: any, supabaseUrl: string, supabaseKey: string, toolArgs: any) {
  const entityId = toolArgs.entity_id;
  const entityName = toolArgs.entity_name;
  
  if (!entityId && !entityName) return { error: "Either entity_id or entity_name is required" };
  
  let targetEntityId = entityId;
  if (!targetEntityId && entityName) {
    const { data: foundEntity } = await supabase.from('entities')
      .select('id, name').ilike('name', `%${entityName}%`).limit(1).single();
    if (!foundEntity) return { error: `Entity not found: ${entityName}` };
    targetEntityId = foundEntity.id;
  }
  
  try {
    const scanResponse = await fetch(`${supabaseUrl}/functions/v1/entity-deep-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
      body: JSON.stringify({ entity_id: targetEntityId })
    });
    
    if (!scanResponse.ok) return { error: `Entity deep scan failed: ${scanResponse.status}` };
    
    const scanResult = await scanResponse.json();
    return {
      success: true, entity_name: scanResult.entity_name, findings_count: scanResult.findings_count,
      critical_count: scanResult.critical_count, overall_risk: scanResult.overall_risk,
      summary: `Deep scan complete for ${scanResult.entity_name}: ${scanResult.findings_count} findings.`
    };
  } catch (e) {
    return { error: `Entity deep scan error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleQueryLegalDatabase(supabaseUrl: string, supabaseKey: string, toolArgs: any) {
  const jurisdiction = toolArgs.jurisdiction || 'Canada';
  const topic = toolArgs.topic || toolArgs.query || '';
  
  try {
    const legalResponse = await fetch(`${supabaseUrl}/functions/v1/query-legal-database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({ jurisdiction, topic, keywords: toolArgs.keywords || [], max_results: 5 })
    });
    
    if (legalResponse.ok) {
      const legalData = await legalResponse.json();
      return { found: legalData.success, results: legalData.results, disclaimer: legalData.disclaimer };
    }
    return { found: false, message: 'Legal database query failed.' };
  } catch {
    return { found: false, message: 'Unable to query legal database.' };
  }
}
