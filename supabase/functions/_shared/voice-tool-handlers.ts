// Voice tool handler implementations for analyze_threat_radar, get_client_info, etc.

export async function handleAnalyzeThreatRadar(supabase: any, toolArgs: any) {
  const { data: allSignals } = await supabase
    .from('signals')
    .select('id, severity, rule_category, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(100);
  
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const categoryBreakdown: Record<string, number> = {};
  
  allSignals?.forEach((s: any) => {
    if (s.severity in severityCounts) {
      severityCounts[s.severity as keyof typeof severityCounts]++;
    }
    const cat = s.rule_category || 'Other';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });
  
  const { data: activeIncidents } = await supabase
    .from('incidents')
    .select('id, priority, status')
    .in('status', ['open', 'investigating']);
  
  const incidentCounts = { p1: 0, p2: 0, p3: 0, p4: 0 };
  activeIncidents?.forEach((i: any) => {
    if (i.priority in incidentCounts) {
      incidentCounts[i.priority as keyof typeof incidentCounts]++;
    }
  });
  
  const threatScore = (severityCounts.critical * 10) + (severityCounts.high * 5) + (severityCounts.medium * 2) + (severityCounts.low * 1);
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
    top_categories: Object.entries(categoryBreakdown)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([cat, count]) => ({ category: cat, count })),
    analysis_period: '7 days',
    generated_at: new Date().toISOString()
  };
}

export async function handleGetClientInfo(supabase: any, toolArgs: any) {
  const clientName = toolArgs.client_name || '';
  
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, industry, status, locations, monitoring_keywords, contact_email')
    .ilike('name', `%${clientName}%`)
    .limit(5);
  
  if (clients && clients.length > 0) {
    const client = clients[0];
    
    const { data: clientSignals } = await supabase
      .from('signals')
      .select('id, title, severity, created_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(5);
    
    const { data: clientIncidents } = await supabase
      .from('incidents')
      .select('id, title, priority, status')
      .eq('client_id', client.id)
      .in('status', ['open', 'acknowledged'])
      .limit(5);
    
    return {
      found: true,
      client: {
        id: client.id,
        name: client.name,
        industry: client.industry,
        status: client.status,
        locations: client.locations,
        monitoring_keywords: client.monitoring_keywords
      },
      recent_signals: clientSignals || [],
      open_incidents: clientIncidents || [],
      other_matches: clients.length > 1 ? clients.slice(1).map((c: any) => c.name) : []
    };
  } else {
    return {
      found: false,
      message: `No client found matching "${clientName}"`
    };
  }
}

export async function handleGetKnowledgeBase(supabase: any, toolArgs: any) {
  const topic = toolArgs.topic || toolArgs.query || '';
  const category = toolArgs.category;
  
  let query = supabase
    .from('knowledge_base_articles')
    .select('id, title, content, category, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (category) {
    query = query.eq('category', category);
  }
  
  if (topic) {
    query = query.or(`title.ilike.%${topic}%,content.ilike.%${topic}%`);
  }
  
  const { data: articles } = await query;
  
  return {
    found: (articles?.length || 0) > 0,
    count: articles?.length || 0,
    articles: articles?.map((a: any) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      tags: a.tags,
      excerpt: a.content?.substring(0, 200) + '...'
    })) || [],
    query: { topic, category }
  };
}

export async function handleGetTravelStatus(supabase: any) {
  const { data: activeItineraries } = await supabase
    .from('itineraries')
    .select('id, traveler_id, destinations, start_date, end_date, status, risk_level')
    .in('status', ['active', 'upcoming'])
    .order('start_date', { ascending: true })
    .limit(10);
  
  const { data: travelers } = await supabase
    .from('travelers')
    .select('id, name, current_location, status')
    .in('status', ['traveling', 'in_country'])
    .limit(20);
  
  const { data: travelAlerts } = await supabase
    .from('signals')
    .select('id, title, severity, created_at')
    .eq('rule_category', 'Travel Risk')
    .order('created_at', { ascending: false })
    .limit(5);
  
  return {
    active_travelers: travelers?.length || 0,
    active_itineraries: activeItineraries?.length || 0,
    travelers: travelers?.map((t: any) => ({
      name: t.name,
      location: t.current_location,
      status: t.status
    })) || [],
    itineraries: activeItineraries?.map((i: any) => ({
      destinations: i.destinations,
      start_date: i.start_date,
      end_date: i.end_date,
      risk_level: i.risk_level,
      status: i.status
    })) || [],
    recent_travel_alerts: travelAlerts || []
  };
}

export async function handleGetInvestigationStatus(supabase: any, toolArgs: any) {
  const investigationName = toolArgs.investigation_name;
  
  let query = supabase
    .from('investigations')
    .select('id, title, status, priority, lead_investigator, created_at, description')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (investigationName) {
    query = query.ilike('title', `%${investigationName}%`);
  } else {
    query = query.in('status', ['open', 'in_progress']);
  }
  
  const { data: investigations } = await query;
  
  return {
    found: (investigations?.length || 0) > 0,
    count: investigations?.length || 0,
    investigations: investigations?.map((inv: any) => ({
      id: inv.id,
      title: inv.title,
      status: inv.status,
      priority: inv.priority,
      lead: inv.lead_investigator,
      created_at: inv.created_at,
      description: inv.description?.substring(0, 200)
    })) || []
  };
}

export async function handleCheckDarkWebExposure(toolArgs: any) {
  const email = toolArgs.email;
  
  if (!email) {
    return { error: "Email address is required for breach check" };
  }
  
  const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");
  
  if (!HIBP_API_KEY) {
    return { 
      error: "Dark web breach checking is not configured",
      suggestion: "HIBP API key required for breach monitoring"
    };
  }
  
  try {
    const hibpResponse = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: {
          "hibp-api-key": HIBP_API_KEY,
          "user-agent": "Fortress-AEGIS-Voice",
        },
      }
    );
    
    if (hibpResponse.ok) {
      const breaches = await hibpResponse.json();
      const criticalBreaches = breaches.filter((b: any) => 
        (b.DataClasses || []).some((dc: string) => /password|credit|financial/i.test(dc))
      );
      
      return {
        found: true,
        email: email,
        breach_count: breaches.length,
        critical_breaches: criticalBreaches.length,
        breaches: breaches.slice(0, 5).map((b: any) => ({
          name: b.Name,
          date: b.BreachDate,
          data_types: (b.DataClasses || []).slice(0, 4).join(", ")
        })),
        risk_level: criticalBreaches.length > 0 ? "critical" : breaches.length > 2 ? "high" : "medium",
        summary: `${email} found in ${breaches.length} breach(es). ${criticalBreaches.length} contain passwords or financial data.`
      };
    } else if (hibpResponse.status === 404) {
      return {
        found: false,
        email: email,
        breach_count: 0,
        risk_level: "low",
        summary: `Good news: ${email} not found in any known breaches.`
      };
    } else {
      return { error: `Breach check failed: ${hibpResponse.status}` };
    }
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
        vulnerabilities: vulns.map((v: any) => ({
          cve: v.cveID,
          vendor: v.vendorProject,
          product: v.product,
          name: v.vulnerabilityName,
          due_date: v.dueDate
        })),
        summary: `${vulns.length} active vulnerabilities requiring immediate patching. Top vendor: ${vulns[0]?.vendorProject || 'Various'}.`,
        recommendation: "Cross-reference with asset inventory and prioritize internet-facing systems."
      };
    } else {
      return { error: `CISA feed unavailable: ${cisaResponse.status}` };
    }
  } catch (e) {
    return { error: `Threat intel fetch error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleRunVipDeepScan(supabaseUrl: string, supabaseKey: string, toolArgs: any) {
  const name = toolArgs.name;
  
  if (!name) {
    return { error: "Name is required for VIP deep scan" };
  }
  
  try {
    const scanResponse = await fetch(`${supabaseUrl}/functions/v1/vip-osint-discovery`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        name,
        email: toolArgs.email,
        location: toolArgs.location,
        industry: toolArgs.industry,
        socialMediaHandles: toolArgs.social_handles,
      }),
    });
    
    if (!scanResponse.ok) {
      return { error: `Deep scan failed to start: ${scanResponse.status}` };
    }
    
    const text = await scanResponse.text();
    const lines = text.split("\n").filter(l => l.startsWith("data: "));
    
    let discoveryCount = 0;
    let breachCount = 0;
    let threatCount = 0;
    let executiveSummary = "";
    
    for (const line of lines) {
      try {
        const jsonStr = line.replace("data: ", "").trim();
        if (jsonStr === "[DONE]") continue;
        const event = JSON.parse(jsonStr);
        
        if (event.type === "discovery") discoveryCount++;
        if (event.type === "discovery" && event.data?.type === "breach") breachCount++;
        if (event.type === "threat_vector") threatCount++;
        if (event.type === "executive_summary") executiveSummary = event.data?.summary || "";
      } catch { /* skip */ }
    }
    
    return {
      scan_complete: true,
      subject: name,
      discoveries_found: discoveryCount,
      breaches_found: breachCount,
      threats_identified: threatCount,
      summary: executiveSummary || `Deep scan completed for ${name}. Found ${discoveryCount} data points, ${breachCount} breach exposures, ${threatCount} threat vectors.`,
      recommendation: breachCount > 0 
        ? "Critical: Breach exposure detected. Recommend immediate credential reset and identity monitoring."
        : threatCount > 0 
          ? "Elevated risk profile detected. Review threat vectors for protective planning."
          : "Standard risk profile. Continue routine monitoring."
    };
  } catch (e) {
    return { error: `Deep scan error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function handleRunEntityDeepScan(supabase: any, supabaseUrl: string, supabaseKey: string, toolArgs: any) {
  const entityId = toolArgs.entity_id;
  const entityName = toolArgs.entity_name;
  
  if (!entityId && !entityName) {
    return { error: "Either entity_id or entity_name is required" };
  }
  
  let targetEntityId = entityId;
  
  if (!targetEntityId && entityName) {
    const { data: foundEntity } = await supabase
      .from('entities')
      .select('id, name, type')
      .ilike('name', `%${entityName}%`)
      .limit(1)
      .single();
    
    if (!foundEntity) {
      return { 
        error: `Entity not found: ${entityName}`,
        suggestion: "Ask user to specify entity more precisely"
      };
    }
    
    targetEntityId = foundEntity.id;
  }
  
  try {
    const scanResponse = await fetch(`${supabaseUrl}/functions/v1/entity-deep-scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ entity_id: targetEntityId }),
    });
    
    if (!scanResponse.ok) {
      return { error: `Entity deep scan failed: ${scanResponse.status}` };
    }
    
    const scanResult = await scanResponse.json();
    const riskEmoji = scanResult.critical_count > 0 ? "🚨" : scanResult.high_count > 0 ? "⚠️" : "✅";
    
    return {
      success: true,
      entity_name: scanResult.entity_name,
      findings_count: scanResult.findings_count,
      critical_count: scanResult.critical_count,
      high_count: scanResult.high_count,
      overall_risk: scanResult.overall_risk,
      categories: scanResult.categories,
      summary: `${riskEmoji} Deep scan complete for ${scanResult.entity_name}: ${scanResult.findings_count} findings discovered. ${scanResult.critical_count} critical, ${scanResult.high_count} high risk. Overall risk: ${scanResult.overall_risk}.`,
      recommendation: scanResult.critical_count > 0 
        ? "Immediate review of critical findings required."
        : scanResult.high_count > 0 
        ? "Review high-risk findings and update entity profile."
        : "No critical issues found. Continue routine monitoring."
    };
  } catch (e) {
    return { error: `Entity deep scan error: ${e instanceof Error ? e.message : 'Unknown'}` };
  }
}

export async function searchInternalOnly(supabase: any, query: string, geographic_focus: string) {
  const internalResults: string[] = [];
  
  const { data: signals } = await supabase
    .from('signals')
    .select('title, description, severity, created_at, event_date, rule_category')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (signals?.length) {
    internalResults.push('**Recent Signals:**');
    signals.forEach((s: any) => {
      const age = s.event_date ? `Event: ${s.event_date}` : `Ingested: ${s.created_at}`;
      internalResults.push(`- [${s.severity?.toUpperCase() || 'MEDIUM'}] ${s.title} (${age})`);
    });
  }
  
  const { data: incidents } = await supabase
    .from('incidents')
    .select('title, summary, severity_level, status, created_at, priority')
    .or(`title.ilike.%${query}%,summary.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (incidents?.length) {
    internalResults.push('\n**Active Incidents:**');
    incidents.forEach((i: any) => {
      internalResults.push(`- [${i.priority || 'P3'}] ${i.title} - Status: ${i.status}`);
    });
  }
  
  const { data: entities } = await supabase
    .from('entities')
    .select('name, type, risk_level, active_monitoring_enabled')
    .or(`name.ilike.%${query}%,aliases.cs.{${query}}`)
    .limit(5);
  
  if (entities?.length) {
    internalResults.push('\n**Known Entities:**');
    entities.forEach((e: any) => {
      internalResults.push(`- ${e.name} (${e.type}) - Risk: ${e.risk_level || 'Unknown'}`);
    });
  }
  
  const { data: articles } = await supabase
    .from('knowledge_base_articles')
    .select('title, category')
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .limit(3);
  
  if (articles?.length) {
    internalResults.push('\n**Knowledge Base:**');
    articles.forEach((a: any) => {
      internalResults.push(`- ${a.title} (${a.category})`);
    });
  }
  
  if (internalResults.length > 0) {
    return {
      found: true,
      summary: `Found internal data matching "${query}"`,
      details: internalResults.join('\n'),
      source_type: 'internal_only',
      reliability_note: 'Results from Fortress internal database only. External web search was not available.',
      query: query
    };
  } else {
    return {
      found: false,
      summary: `No information found for "${query}"`,
      details: 'No matching data in Fortress database. External web search was not available for this query.',
      source_type: 'no_data',
      reliability_note: 'No data available. Cannot perform external web search.',
      query: query
    };
  }
}
