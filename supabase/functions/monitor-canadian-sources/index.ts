import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Client {
  id: string;
  name: string;
  industry: string | null;
  locations: string[] | null;
  monitoring_keywords?: string[] | null;
  competitor_names?: string[] | null;
  supply_chain_entities?: string[] | null;
  monitoring_config?: {
    min_relevance_score: number;
    auto_create_incidents: boolean;
    priority_keywords: string[];
    exclude_keywords: string[];
  } | null;
}

interface RelevanceMatch {
  score: number;
  reasons: string[];
  matchType: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Create monitoring history entry
  const { data: historyEntry, error: historyError } = await supabaseClient
    .from('monitoring_history')
    .insert({
      source_name: 'Canadian Sources Enhanced',
      status: 'running',
      scan_metadata: { sources: ['RCMP Gazette', 'BC Energy Regulator'] }
    })
    .select()
    .single();

  if (historyError) {
    console.error('Failed to create monitoring history:', historyError);
  }

  try {
    console.log('Starting Canadian sources monitoring scan with enhanced relevance scoring');

    // Fetch all clients with monitoring config
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('*');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    const sources = [];

    // 1. RCMP Gazette (RSS feed)
    try {
      console.log('Monitoring RCMP Gazette...');
      const rcmpResponse = await fetch('https://www.rcmp-grc.gc.ca/en/news/rss.xml');
      const rcmpText = await rcmpResponse.text();
      const rcmpItems = parseRSS(rcmpText);
      
      for (const item of rcmpItems.slice(0, 10)) {
        const content = item.title + ' ' + item.description;
        
        for (const client of clients) {
          const match = calculateRelevance(client, content, 'RCMP Gazette');
          
          // Lower threshold to catch more potential signals (was 50)
          if (match.score >= (client.monitoring_config?.min_relevance_score || 35)) {
            await createSignal(supabaseClient, {
              client_id: client.id,
              source: 'RCMP Gazette',
              category: 'threat-intelligence',
              severity: determineSeverity(content, match.score),
              title: item.title,
              description: item.description,
              url: item.link,
              published_date: item.pubDate,
              relevance_score: match.score,
              relevance_reasons: match.reasons
            });
            signalsCreated++;
          }
        }
      }
      sources.push('RCMP Gazette');
    } catch (error) {
      console.error('Error monitoring RCMP:', error);
    }

    // 2. BC Energy Regulator Bulletins
    try {
      console.log('Monitoring BC Energy Regulator...');
      const bcerResponse = await fetch('https://www.bc-er.ca/feed/');
      const bcerText = await bcerResponse.text();
      const bcerItems = parseRSS(bcerText);
      
      for (const item of bcerItems.slice(0, 10)) {
        const content = item.title + ' ' + item.description;
        
        for (const client of clients) {
          const match = calculateRelevance(client, content, 'BC Energy Regulator');
          
          // Lower threshold to catch more potential signals (was 50)
          if (match.score >= (client.monitoring_config?.min_relevance_score || 35)) {
            await createSignal(supabaseClient, {
              client_id: client.id,
              source: 'BC Energy Regulator',
              category: 'regulatory',
              severity: determineSeverity(content, match.score),
              title: item.title,
              description: item.description,
              url: item.link,
              published_date: item.pubDate,
              relevance_score: match.score,
              relevance_reasons: match.reasons
            });
            signalsCreated++;
          }
        }
      }
      sources.push('BC Energy Regulator');
    } catch (error) {
      console.error('Error monitoring BC Energy Regulator:', error);
    }

    console.log(`Canadian sources monitoring complete. Created ${signalsCreated} signals from sources: ${sources.join(', ')}`);

    // Update monitoring history with success
    if (historyEntry) {
      await supabaseClient
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: sources.length,
          signals_created: signalsCreated,
          scan_metadata: { sources, details: `Scanned ${sources.length} sources` }
        })
        .eq('id', historyEntry.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scanned ${sources.length} Canadian sources with enhanced relevance scoring`,
        signalsCreated,
        sources,
        historyId: historyEntry?.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Canadian sources monitoring error:', error);
    
    // Update monitoring history with failure
    if (historyEntry) {
      await supabaseClient
        .from('monitoring_history')
        .update({
          status: 'failed',
          scan_completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', historyEntry.id);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Enhanced relevance calculation with scoring
function calculateRelevance(client: Client, content: string, source: string): RelevanceMatch {
  const lowerContent = content.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const matchType: string[] = [];

  // Check for exclude keywords first (immediate disqualification)
  if (client.monitoring_config?.exclude_keywords) {
    for (const keyword of client.monitoring_config.exclude_keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return { score: 0, reasons: [`Excluded by keyword: ${keyword}`], matchType: ['excluded'] };
      }
    }
  }

  // 1. Direct client name match (40 points)
  if (lowerContent.includes(client.name.toLowerCase())) {
    score += 40;
    reasons.push(`Direct mention of ${client.name}`);
    matchType.push('name');
  }

  // 2. Custom monitoring keywords (30 points max, 5 per match, max 6 matches)
  if (client.monitoring_keywords && client.monitoring_keywords.length > 0) {
    let keywordMatches = 0;
    const matchedKeywords: string[] = [];
    
    for (const keyword of client.monitoring_keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        keywordMatches++;
        matchedKeywords.push(keyword);
        if (keywordMatches <= 6) {
          score += 5;
        }
      }
    }
    
    if (keywordMatches > 0) {
      reasons.push(`Matched ${keywordMatches} custom keywords: ${matchedKeywords.slice(0, 3).join(', ')}${matchedKeywords.length > 3 ? '...' : ''}`);
      matchType.push('keywords');
    }
  }

  // 3. Priority keywords (20 points, critical issues)
  if (client.monitoring_config?.priority_keywords) {
    let priorityMatches = 0;
    const matchedPriority: string[] = [];
    
    for (const keyword of client.monitoring_config.priority_keywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        priorityMatches++;
        matchedPriority.push(keyword);
      }
    }
    
    if (priorityMatches > 0) {
      score += 20;
      reasons.push(`High-priority keywords matched: ${matchedPriority.join(', ')}`);
      matchType.push('priority');
    }
  }

  // 4. Industry match (15 points)
  if (client.industry && lowerContent.includes(client.industry.toLowerCase())) {
    score += 15;
    reasons.push(`Industry match: ${client.industry}`);
    matchType.push('industry');
  }

  // 5. Location match (15 points)
  if (client.locations) {
    let locationMatches = 0;
    const matchedLocations: string[] = [];
    
    for (const location of client.locations) {
      if (lowerContent.includes(location.toLowerCase())) {
        locationMatches++;
        matchedLocations.push(location);
      }
    }
    
    if (locationMatches > 0) {
      score += 15;
      reasons.push(`Location match: ${matchedLocations.join(', ')}`);
      matchType.push('location');
    }
  }

  // 6. Competitor mentions (10 points) - indirect relevance
  if (client.competitor_names && client.competitor_names.length > 0) {
    let competitorMatches = 0;
    const matchedCompetitors: string[] = [];
    
    for (const competitor of client.competitor_names) {
      if (lowerContent.includes(competitor.toLowerCase())) {
        competitorMatches++;
        matchedCompetitors.push(competitor);
      }
    }
    
    if (competitorMatches > 0) {
      score += 10;
      reasons.push(`Competitor mentioned: ${matchedCompetitors.slice(0, 2).join(', ')}`);
      matchType.push('competitor');
    }
  }

  // 7. Supply chain entities (10 points)
  if (client.supply_chain_entities && client.supply_chain_entities.length > 0) {
    let supplyChainMatches = 0;
    const matchedEntities: string[] = [];
    
    for (const entity of client.supply_chain_entities) {
      if (lowerContent.includes(entity.toLowerCase())) {
        supplyChainMatches++;
        matchedEntities.push(entity);
      }
    }
    
    if (supplyChainMatches > 0) {
      score += 10;
      reasons.push(`Supply chain entity: ${matchedEntities.slice(0, 2).join(', ')}`);
      matchType.push('supply_chain');
    }
  }

  // Bonus: Source-specific relevance boost
  if (source === 'BC Energy Regulator' && client.industry?.toLowerCase().includes('energy')) {
    score += 5;
    reasons.push('Regulatory source relevant to industry');
  }

  return { score: Math.min(score, 100), reasons, matchType };
}

// Helper function to parse RSS feeds
function parseRSS(xmlText: string) {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const description = extractTag(itemXml, 'description');
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');

    items.push({ title, description, link, pubDate });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

// Determine severity based on content and relevance score
function determineSeverity(text: string, relevanceScore: number): string {
  const lowerText = text.toLowerCase();
  
  // High relevance with critical keywords
  if (relevanceScore >= 80 && (
    lowerText.includes('critical') || lowerText.includes('emergency') || 
    lowerText.includes('severe') || lowerText.includes('explosion') ||
    lowerText.includes('fatality')
  )) {
    return 'critical';
  }
  
  // High relevance or serious keywords
  if (relevanceScore >= 70 || lowerText.includes('violation') || 
      lowerText.includes('fine') || lowerText.includes('incident') ||
      lowerText.includes('spill') || lowerText.includes('leak')) {
    return 'high';
  }
  
  // Medium relevance or warning keywords
  if (relevanceScore >= 60 || lowerText.includes('warning') || 
      lowerText.includes('advisory') || lowerText.includes('concern')) {
    return 'medium';
  }
  
  return 'low';
}

// Create a signal in the database with relevance metadata
async function createSignal(supabaseClient: any, data: {
  client_id: string;
  source: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  url?: string;
  published_date?: string;
  relevance_score: number;
  relevance_reasons: string[];
}) {
  try {
    const { error } = await supabaseClient
      .from('signals')
      .insert({
        client_id: data.client_id,
        category: data.category,
        severity: data.severity,
        status: 'new',
        normalized_text: `${data.title}\n\n${data.description}`,
        raw_json: {
          source: data.source,
          title: data.title,
          description: data.description,
          url: data.url,
          published_date: data.published_date,
          relevance_score: data.relevance_score,
          relevance_reasons: data.relevance_reasons
        },
        confidence: data.relevance_score,
        received_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating signal:', error);
    } else {
      console.log(`Created signal with ${data.relevance_score}% relevance: ${data.title.substring(0, 50)}...`);
    }
  } catch (error) {
    console.error('Error in createSignal:', error);
  }
}
