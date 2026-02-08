import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * World Knowledge Ingestion Engine
 * 
 * Pulls expertise from the world's top security frameworks, standards,
 * and threat intelligence sources via Perplexity AI, then distills
 * findings into the expert_knowledge table for all agents to leverage.
 * 
 * Can be triggered manually or via cron for continuous learning.
 */

interface IngestionRequest {
  domains?: string[];        // Specific domains to refresh
  source_ids?: string[];     // Specific sources to ingest
  force_refresh?: boolean;   // Ignore refresh intervals
  max_queries?: number;      // Limit queries per invocation (default 3 for timeout safety)
}

const KNOWLEDGE_DOMAINS = [
  {
    domain: 'cyber',
    queries: [
      'Latest MITRE ATT&CK techniques and tactics used by advanced persistent threat groups in 2025 2026',
      'CISA current known exploited vulnerabilities and emergency directives 2025 2026',
      'NIST cybersecurity framework best practices for enterprise security operations centers',
      'OWASP top 10 web application security risks and mitigation strategies',
      'Zero trust architecture implementation best practices for Fortune 500 companies',
      'Ransomware defense strategies and incident response playbooks 2025 2026',
    ]
  },
  {
    domain: 'physical_security',
    queries: [
      'ASIS international standards for physical security and enterprise security risk management',
      'Corporate campus security best practices including access control and surveillance systems',
      'Active shooter preparedness and response protocols for corporate environments',
      'Workplace violence prevention programs and threat assessment methodologies',
      'Security operations center design and staffing best practices',
    ]
  },
  {
    domain: 'executive_protection',
    queries: [
      'Executive protection best practices for Fortune 500 CEO and C-suite security',
      'Advance security survey methodology and protective intelligence techniques',
      'Surveillance detection routes and counter-surveillance best practices',
      'Travel security risk assessment for high-net-worth individuals',
      'Residential security assessment and home hardening for executives',
      'Social media threat monitoring for corporate executives and VIPs',
    ]
  },
  {
    domain: 'crisis_management',
    queries: [
      'Corporate crisis management framework and business continuity planning best practices',
      'FEMA incident command system ICS for corporate security teams',
      'Crisis communication strategies during security incidents',
      'Emergency evacuation planning and assembly point management for large facilities',
      'Pandemic and health emergency response protocols for multinational corporations',
    ]
  },
  {
    domain: 'threat_intelligence',
    queries: [
      'Current global terrorism threat landscape and emerging threat actors 2025 2026',
      'Nation-state cyber threat actor TTPs and attribution indicators',
      'Insider threat detection indicators and behavioral analytics',
      'Supply chain security risks and third-party threat assessment',
      'Dark web intelligence collection methodologies and tools',
    ]
  },
  {
    domain: 'travel_security',
    queries: [
      'High risk travel security protocols and executive travel risk management',
      'Kidnap for ransom trends and prevention strategies by region 2025 2026',
      'Medical evacuation planning and duty of care for traveling employees',
      'Country risk assessment methodology for corporate travel programs',
    ]
  },
  {
    domain: 'compliance',
    queries: [
      'ISO 27001 implementation guide and audit preparation best practices',
      'NIST SP 800-53 security controls mapping and implementation priorities',
      'SOC 2 Type II compliance requirements and continuous monitoring',
      'GDPR and privacy regulation security requirements for multinational companies',
      'SEC cybersecurity disclosure rules and reporting requirements 2025 2026',
    ]
  },
  {
    domain: 'geopolitical',
    queries: [
      'Current geopolitical risks affecting multinational corporate security 2025 2026',
      'Economic sanctions compliance and screening requirements for corporations',
      'Civil unrest prediction indicators and corporate response protocols',
      'Political instability risk assessment frameworks for corporate operations',
    ]
  }
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({})) as IngestionRequest;
    const { domains, source_ids, force_refresh, max_queries } = body;
    const queryLimit = max_queries || 3; // Process max 3 queries per invocation to avoid timeouts
    
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    if (!PERPLEXITY_API_KEY) {
      return errorResponse('PERPLEXITY_API_KEY not configured', 500);
    }

    const supabase = createServiceClient();
    
    // Determine which domains to process
    let domainsToProcess = KNOWLEDGE_DOMAINS;
    if (domains && domains.length > 0) {
      domainsToProcess = KNOWLEDGE_DOMAINS.filter(d => domains.includes(d.domain));
    }

    // Check source freshness if not force refresh
    if (!force_refresh) {
      const { data: sources } = await supabase
        .from('world_knowledge_sources')
        .select('domain, last_ingested_at, refresh_interval_hours')
        .eq('is_active', true);
      
      if (sources) {
        const freshDomains = new Set<string>();
        for (const src of sources) {
          if (src.last_ingested_at) {
            const lastIngested = new Date(src.last_ingested_at).getTime();
            const intervalMs = (src.refresh_interval_hours || 168) * 60 * 60 * 1000;
            if (Date.now() - lastIngested < intervalMs) {
              freshDomains.add(src.domain);
            }
          }
        }
        domainsToProcess = domainsToProcess.filter(d => !freshDomains.has(d.domain));
      }
    }

    if (domainsToProcess.length === 0) {
      return successResponse({ message: 'All knowledge domains are fresh. No ingestion needed.', ingested: 0 });
    }

    console.log(`[ingest-world-knowledge] Processing ${domainsToProcess.length} domains: ${domainsToProcess.map(d => d.domain).join(', ')}`);

    let totalIngested = 0;
    let totalQueriesRun = 0;
    const results: Record<string, number> = {};

    for (const domainConfig of domainsToProcess) {
      let domainCount = 0;
      
      for (const query of domainConfig.queries) {
        if (totalQueriesRun >= queryLimit) break;
        try {
          // Rate limit: 1.5s between Perplexity calls
          await new Promise(r => setTimeout(r, 1500));
          totalQueriesRun++;
          
          const knowledge = await queryPerplexityForExpertise(PERPLEXITY_API_KEY, query, domainConfig.domain);
          
          if (knowledge && knowledge.length > 0) {
            for (const entry of knowledge) {
              // Check for duplicates by title similarity
              const { data: existing } = await supabase
                .from('expert_knowledge')
                .select('id')
                .eq('domain', domainConfig.domain)
                .ilike('title', `%${entry.title.substring(0, 40)}%`)
                .limit(1);
              
              if (existing && existing.length > 0) {
                // Update existing
                await supabase
                  .from('expert_knowledge')
                  .update({
                    content: entry.content,
                    last_validated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existing[0].id);
              } else {
                // Insert new
                await supabase
                  .from('expert_knowledge')
                  .insert({
                    domain: domainConfig.domain,
                    subdomain: entry.subdomain,
                    knowledge_type: entry.knowledge_type,
                    title: entry.title,
                    content: entry.content,
                    applicability_tags: entry.tags,
                    citation: entry.citation,
                    confidence_score: 0.85,
                  });
              }
              domainCount++;
            }
          }
        } catch (err) {
          console.error(`[ingest-world-knowledge] Error querying "${query}":`, err);
        }
      }

      // Update source tracking
      await supabase
        .from('world_knowledge_sources')
        .update({
          last_ingested_at: new Date().toISOString(),
          ingestion_count: domainCount,
          updated_at: new Date().toISOString(),
        })
        .eq('domain', domainConfig.domain);

      results[domainConfig.domain] = domainCount;
      totalIngested += domainCount;
      
      console.log(`[ingest-world-knowledge] Domain "${domainConfig.domain}": ${domainCount} entries ingested`);
    }

    // Also promote top insights to global learning context
    await promoteTopKnowledgeToGlobal(supabase);

    return successResponse({
      message: `World knowledge ingestion complete`,
      domains_processed: domainsToProcess.length,
      total_ingested: totalIngested,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ingest-world-knowledge] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function queryPerplexityForExpertise(
  apiKey: string,
  query: string,
  domain: string
): Promise<Array<{
  title: string;
  content: string;
  subdomain: string;
  knowledge_type: string;
  tags: string[];
  citation: string;
}>> {
  const systemPrompt = `You are a world-class security intelligence analyst extracting actionable expert knowledge.
For the given query, return EXACTLY 3-5 distilled knowledge entries as a JSON array.
Each entry must have:
- "title": concise title (max 100 chars)
- "content": detailed actionable knowledge (200-500 words). Include specific methodologies, frameworks, metrics, thresholds, and procedures. This should read like a handbook entry.
- "subdomain": specific sub-area (e.g., "ransomware", "access_control", "advance_work")
- "knowledge_type": one of "best_practice", "framework", "methodology", "case_study", "threat_pattern", "standard"
- "tags": array of 3-6 applicability tags
- "citation": source reference or standard name

Focus on ACTIONABLE intelligence that a security operations center could immediately apply.
Return ONLY the JSON array, no other text.`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      temperature: 0.1,
      search_recency_filter: 'year',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[ingest-world-knowledge] Perplexity error ${response.status}:`, errText);
    return [];
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    }
  } catch (e) {
    console.error('[ingest-world-knowledge] Failed to parse Perplexity response:', e);
  }

  return [];
}

async function promoteTopKnowledgeToGlobal(supabase: any) {
  // Get high-confidence knowledge not yet in global insights
  const { data: topKnowledge } = await supabase
    .from('expert_knowledge')
    .select('id, domain, title, content, knowledge_type')
    .gte('confidence_score', 0.80)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!topKnowledge || topKnowledge.length === 0) return;

  for (const entry of topKnowledge) {
    // Check if already promoted
    const { data: existing } = await supabase
      .from('global_learning_insights')
      .select('id')
      .eq('insight_type', 'world_expertise')
      .ilike('insight_content', `%${entry.title.substring(0, 30)}%`)
      .limit(1);

    if (!existing || existing.length === 0) {
      await supabase
        .from('global_learning_insights')
        .insert({
          insight_type: 'world_expertise',
          category: entry.domain,
          insight_content: `[${entry.knowledge_type.toUpperCase()}] ${entry.title}: ${entry.content.substring(0, 500)}`,
          confidence_score: 0.85,
          occurrence_count: 1,
          source_tenant_count: 0,
          metadata: { source: 'world_knowledge_engine', knowledge_id: entry.id },
        });
    }
  }
}
