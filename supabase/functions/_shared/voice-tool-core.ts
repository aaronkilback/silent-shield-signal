// Core voice tool handlers - search, threats, entities, fortress data

export async function handleSearchWeb(
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  toolArgs: any
) {
  const query = toolArgs.query || '';
  const geographic_focus = toolArgs.geographic_focus || '';
  
  try {
    const searchResponse = await fetch(`${supabaseUrl}/functions/v1/perform-external-web-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ query, geographic_focus, max_results: 5 }),
    });
    
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      const summaryParts: string[] = [];
      
      if (searchData.source_urls?.length > 0) {
        summaryParts.push(`Found ${searchData.source_urls.length} web sources:`);
        searchData.source_urls.slice(0, 3).forEach((source: any) => {
          const dateInfo = source.published_date ? ` (${source.published_date})` : '';
          summaryParts.push(`- ${source.title}${dateInfo}: ${source.snippet?.substring(0, 150)}...`);
        });
      }
      
      if (searchData.key_entities?.length > 0) {
        summaryParts.push(`\nRelated entities: ${searchData.key_entities.slice(0, 5).join(', ')}`);
      }
      
      return {
        found: searchData.data_source !== 'no_data',
        summary: searchData.summary,
        details: summaryParts.join('\n'),
        source_type: searchData.data_source,
        reliability_note: searchData.reliability_note,
        query
      };
    }
    return await searchInternalOnly(supabase, query);
  } catch (error) {
    console.error('[Voice Tool] Search error:', error);
    return await searchInternalOnly(supabase, query);
  }
}

export async function handleGetCurrentThreats(supabase: any) {
  const { data: recentSignals } = await supabase
    .from('signals')
    .select('id, title, severity, source_id, created_at, rule_category, status')
    .in('severity', ['critical', 'high'])
    .in('status', ['new', 'triaged'])
    .order('created_at', { ascending: false })
    .limit(10);
  
  const { data: openIncidents } = await supabase
    .from('incidents')
    .select('id, title, severity_level, status, incident_type, priority, opened_at')
    .in('status', ['open', 'acknowledged'])
    .order('created_at', { ascending: false })
    .limit(10);
  
  const signalCategories: Record<string, number> = {};
  recentSignals?.forEach((s: any) => {
    const cat = s.rule_category || 'Uncategorized';
    signalCategories[cat] = (signalCategories[cat] || 0) + 1;
  });
  
  return {
    high_priority_signals: recentSignals?.map((s: any) => ({
      id: s.id, title: s.title, severity: s.severity, source: s.source_id,
      category: s.rule_category, status: s.status, created_at: s.created_at
    })) || [],
    open_incidents: openIncidents?.map((i: any) => ({
      id: i.id, title: i.title, severity: i.severity_level, priority: i.priority,
      type: i.incident_type, status: i.status, opened_at: i.opened_at
    })) || [],
    threat_patterns: Object.entries(signalCategories).map(([cat, count]) => ({ category: cat, count })),
    summary: `${recentSignals?.length || 0} high-priority signals, ${openIncidents?.length || 0} open incidents`
  };
}

export async function handleGetEntityInfo(supabase: any, toolArgs: any) {
  const entityName = toolArgs.entity_name || '';
  
  const { data: entities } = await supabase
    .from('entities')
    .select('*')
    .ilike('name', `%${entityName}%`)
    .limit(5);
  
  if (entities?.length > 0) {
    const entity = entities[0];
    
    const { data: relatedSignals } = await supabase
      .from('signals')
      .select('id, title, severity, created_at, rule_category, status')
      .contains('auto_correlated_entities', [entity.id])
      .order('created_at', { ascending: false })
      .limit(5);
    
    return {
      found: true,
      entity: {
        id: entity.id, name: entity.name, type: entity.type,
        risk_level: entity.risk_level,
        monitoring_status: entity.active_monitoring_enabled ? 'enabled' : 'disabled',
        aliases: entity.aliases, description: entity.description
      },
      recent_signals: relatedSignals || [],
      other_matches: entities.length > 1 ? entities.slice(1).map((e: any) => e.name) : []
    };
  }
  return { found: false, message: `No entity found matching "${entityName}"` };
}

export async function handleQueryFortressData(supabase: any, toolArgs: any) {
  const queryType = toolArgs.query_type || 'comprehensive';
  const keywords = toolArgs.keywords || [];
  const limit = toolArgs.limit || 20;
  const daysBack = toolArgs.time_range_days || 30;
  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  
  const results: any = { signals: [], incidents: [], entities: [], documents: [] };
  
  if (queryType === 'signals' || queryType === 'comprehensive') {
    let query = supabase.from('signals')
      .select('id, title, severity, source_id, created_at, rule_category, status')
      .gte('created_at', cutoffDate).order('created_at', { ascending: false }).limit(limit);
    if (keywords.length > 0) {
      query = query.or(keywords.map((k: string) => `title.ilike.%${k}%`).join(','));
    }
    const { data } = await query;
    results.signals = data || [];
  }
  
  if (queryType === 'incidents' || queryType === 'comprehensive') {
    let query = supabase.from('incidents')
      .select('id, title, severity_level, status, priority, incident_type, opened_at')
      .gte('created_at', cutoffDate).order('created_at', { ascending: false }).limit(limit);
    if (keywords.length > 0) {
      query = query.or(keywords.map((k: string) => `title.ilike.%${k}%`).join(','));
    }
    const { data } = await query;
    results.incidents = data || [];
  }
  
  if (queryType === 'entities' || queryType === 'comprehensive') {
    let query = supabase.from('entities')
      .select('id, name, type, risk_level, active_monitoring_enabled').limit(limit);
    if (keywords.length > 0) {
      query = query.or(keywords.map((k: string) => `name.ilike.%${k}%`).join(','));
    }
    const { data } = await query;
    results.entities = data || [];
  }
  
  const totalCount = results.signals.length + results.incidents.length + results.entities.length;
  return {
    found: totalCount > 0,
    query_type: queryType,
    time_range_days: daysBack,
    total_count: totalCount,
    ...results,
    summary: `Found ${results.signals.length} signals, ${results.incidents.length} incidents, ${results.entities.length} entities`
  };
}

export async function handleGenerateIntelligenceSummary(supabase: any, toolArgs: any) {
  const timeRangeHours = toolArgs.time_range_hours || 24;
  const cutoffDate = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000).toISOString();
  
  const { data: signals } = await supabase.from('signals')
    .select('id, title, severity, source_id, created_at, rule_category')
    .gte('created_at', cutoffDate).order('created_at', { ascending: false }).limit(50);
  
  const criticalSignals = signals?.filter((s: any) => ['critical', 'high'].includes(s.severity)) || [];
  
  const { data: incidents } = await supabase.from('incidents')
    .select('id, title, severity_level, status, priority, incident_type, opened_at')
    .in('status', ['open', 'acknowledged']).order('opened_at', { ascending: false }).limit(20);
  
  const highPriorityIncidents = incidents?.filter((i: any) => ['p1', 'p2'].includes(i.priority)) || [];
  
  const categoryMap: Record<string, number> = {};
  signals?.forEach((s: any) => {
    const cat = s.rule_category || 'Uncategorized';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  });
  
  return {
    time_range_hours: timeRangeHours,
    generated_at: new Date().toISOString(),
    summary: {
      total_signals: signals?.length || 0,
      critical_high_signals: criticalSignals.length,
      total_open_incidents: incidents?.length || 0,
      high_priority_incidents: highPriorityIncidents.length
    },
    critical_signals: criticalSignals.slice(0, 5).map((s: any) => ({
      title: s.title, severity: s.severity, category: s.rule_category
    })),
    high_priority_incidents: highPriorityIncidents.slice(0, 5).map((i: any) => ({
      title: i.title, priority: i.priority, severity: i.severity_level
    })),
    threat_patterns: Object.entries(categoryMap)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5),
    briefing_note: `Intelligence summary for the past ${timeRangeHours} hours.`
  };
}

export async function searchInternalOnly(supabase: any, query: string) {
  const internalResults: string[] = [];
  
  const { data: signals } = await supabase.from('signals')
    .select('title, severity, created_at, rule_category')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('created_at', { ascending: false }).limit(5);
  
  if (signals?.length) {
    internalResults.push('**Recent Signals:**');
    signals.forEach((s: any) => {
      internalResults.push(`- [${s.severity?.toUpperCase()}] ${s.title}`);
    });
  }
  
  const { data: entities } = await supabase.from('entities')
    .select('name, type, risk_level')
    .or(`name.ilike.%${query}%`)
    .limit(5);
  
  if (entities?.length) {
    internalResults.push('\n**Known Entities:**');
    entities.forEach((e: any) => {
      internalResults.push(`- ${e.name} (${e.type}) - Risk: ${e.risk_level || 'Unknown'}`);
    });
  }
  
  return internalResults.length > 0 ? {
    found: true,
    summary: `Found internal data matching "${query}"`,
    details: internalResults.join('\n'),
    source_type: 'internal_only',
    query
  } : {
    found: false,
    summary: `No information found for "${query}"`,
    source_type: 'no_data',
    query
  };
}
