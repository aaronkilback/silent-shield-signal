import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

// Regional APAC News Sources Configuration
const APAC_SOURCES = [
  // Malaysian Sources
  {
    name: 'Bernama',
    region: 'Malaysia',
    type: 'rss',
    url: 'https://www.bernama.com/en/rss/general.xml',
    fallbackUrl: 'https://news.google.com/rss/search?q=site:bernama.com&hl=en-MY&gl=MY&ceid=MY:en',
    categories: ['general', 'politics', 'business'],
    priority: 'high'
  },
  {
    name: 'The Edge Malaysia',
    region: 'Malaysia',
    type: 'google_news',
    searchQuery: 'site:theedgemarkets.com OR "The Edge Malaysia"',
    categories: ['business', 'markets', 'energy'],
    priority: 'high'
  },
  {
    name: 'New Straits Times',
    region: 'Malaysia',
    type: 'google_news',
    searchQuery: 'site:nst.com.my Malaysia',
    categories: ['general', 'politics', 'crime'],
    priority: 'medium'
  },
  {
    name: 'Malay Mail',
    region: 'Malaysia',
    type: 'google_news',
    searchQuery: 'site:malaymail.com',
    categories: ['general', 'politics'],
    priority: 'medium'
  },
  // Asia-Pacific Sources
  {
    name: 'Nikkei Asia',
    region: 'Asia-Pacific',
    type: 'google_news',
    searchQuery: 'site:asia.nikkei.com',
    categories: ['business', 'politics', 'energy', 'technology'],
    priority: 'high'
  },
  {
    name: 'South China Morning Post',
    region: 'Asia-Pacific',
    type: 'google_news',
    searchQuery: 'site:scmp.com Southeast Asia',
    categories: ['politics', 'business', 'china'],
    priority: 'high'
  },
  {
    name: 'Channel News Asia',
    region: 'Southeast Asia',
    type: 'rss',
    url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511',
    fallbackUrl: 'https://news.google.com/rss/search?q=site:channelnewsasia.com&hl=en-SG&gl=SG&ceid=SG:en',
    categories: ['general', 'asia', 'business'],
    priority: 'high'
  },
  {
    name: 'The Straits Times',
    region: 'Singapore',
    type: 'google_news',
    searchQuery: 'site:straitstimes.com',
    categories: ['general', 'politics', 'business'],
    priority: 'medium'
  },
  // Energy Sector Sources
  {
    name: 'Energy Voice',
    region: 'Global',
    type: 'google_news',
    searchQuery: 'site:energyvoice.com Asia OR Malaysia OR Singapore',
    categories: ['energy', 'oil_gas'],
    priority: 'high'
  },
  {
    name: 'Upstream Online',
    region: 'Global',
    type: 'google_news',
    searchQuery: 'site:upstreamonline.com Asia',
    categories: ['energy', 'oil_gas'],
    priority: 'high'
  },
  {
    name: 'Rigzone',
    region: 'Global',
    type: 'rss',
    url: 'https://www.rigzone.com/rss/news_articles.aspx',
    fallbackUrl: 'https://news.google.com/rss/search?q=site:rigzone.com+Asia',
    categories: ['energy', 'oil_gas'],
    priority: 'medium'
  },
  {
    name: 'S&P Global Platts',
    region: 'Global',
    type: 'google_news',
    searchQuery: '"S&P Global" OR "Platts" Asia energy',
    categories: ['energy', 'commodities'],
    priority: 'high'
  },
  {
    name: 'LNG World News',
    region: 'Global',
    type: 'google_news',
    searchQuery: 'site:lngworldnews.com OR "LNG" Malaysia Singapore Asia',
    categories: ['energy', 'lng'],
    priority: 'medium'
  },
  // Additional Regional Sources
  {
    name: 'Jakarta Post',
    region: 'Indonesia',
    type: 'google_news',
    searchQuery: 'site:thejakartapost.com',
    categories: ['general', 'politics', 'business'],
    priority: 'medium'
  },
  {
    name: 'Bangkok Post',
    region: 'Thailand',
    type: 'google_news',
    searchQuery: 'site:bangkokpost.com',
    categories: ['general', 'politics', 'business'],
    priority: 'medium'
  },
  {
    name: 'Vietnam News',
    region: 'Vietnam',
    type: 'google_news',
    searchQuery: 'site:vietnamnews.vn OR "Vietnam" business energy',
    categories: ['general', 'business'],
    priority: 'low'
  }
];

// Security & threat keywords for APAC region
const APAC_SECURITY_KEYWORDS = [
  // Security threats
  'protest', 'demonstration', 'riot', 'unrest', 'strike', 'blockade',
  'terrorism', 'militant', 'extremist', 'bomb', 'attack', 'explosion',
  'kidnapping', 'hostage', 'abduction', 'ransom',
  // Cyber threats
  'cyber attack', 'hacking', 'data breach', 'ransomware', 'phishing',
  // Political risks
  'coup', 'martial law', 'emergency', 'curfew', 'political crisis',
  'sanctions', 'embargo', 'trade war', 'diplomatic incident',
  // Environmental & operational
  'typhoon', 'earthquake', 'tsunami', 'flood', 'landslide', 'volcano',
  'oil spill', 'pipeline leak', 'explosion', 'fire', 'accident',
  // Regulatory
  'regulatory crackdown', 'investigation', 'corruption', 'arrest', 'indictment'
];

// Energy sector specific keywords
const ENERGY_KEYWORDS = [
  'oil', 'gas', 'LNG', 'petroleum', 'refinery', 'pipeline', 'offshore',
  'PETRONAS', 'Sapura', 'Shell', 'ExxonMobil', 'Chevron', 'BP',
  'upstream', 'downstream', 'midstream', 'exploration', 'production',
  'drilling', 'FPSO', 'platform', 'rig', 'well', 'reservoir',
  'renewable', 'solar', 'wind', 'hydrogen', 'carbon capture', 'energy transition'
];

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  source: string;
  region: string;
  categories: string[];
}

function parseRSS(xmlText: string, sourceName: string, region: string, categories: string[]): RSSItem[] {
  const items: RSSItem[] = [];
  
  // Handle both standard RSS and Google News CDATA format
  const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g);
  
  for (const match of itemMatches) {
    const itemXml = match[1];
    
    // Try CDATA format first (Google News)
    let title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1];
    let description = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1];
    
    // Fall back to standard format
    if (!title) {
      title = itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '') || '';
    }
    if (!description) {
      description = itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '') || '';
    }
    
    const link = itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    
    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        description: (description || '').trim(),
        pubDate,
        source: sourceName,
        region,
        categories
      });
    }
  }
  
  return items;
}

async function fetchGoogleNewsRSS(query: string, region: string = 'SG'): Promise<string> {
  const regionMap: Record<string, { hl: string; gl: string; ceid: string }> = {
    'Malaysia': { hl: 'en-MY', gl: 'MY', ceid: 'MY:en' },
    'Singapore': { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
    'Indonesia': { hl: 'en-ID', gl: 'ID', ceid: 'ID:en' },
    'Thailand': { hl: 'en-TH', gl: 'TH', ceid: 'TH:en' },
    'Vietnam': { hl: 'en-VN', gl: 'VN', ceid: 'VN:en' },
    'Asia-Pacific': { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
    'Southeast Asia': { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
    'Global': { hl: 'en-US', gl: 'US', ceid: 'US:en' }
  };
  
  const config = regionMap[region] || regionMap['Asia-Pacific'];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:2d&hl=${config.hl}&gl=${config.gl}&ceid=${config.ceid}`;
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' },
    signal: AbortSignal.timeout(30000)
  });
  
  if (!response.ok) {
    throw new Error(`Google News fetch failed: ${response.status}`);
  }
  
  return response.text();
}

async function generateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function calculateSeverity(content: string, categories: string[]): string {
  const lowerContent = content.toLowerCase();
  
  // High severity: immediate security threats
  const highSeverityKeywords = ['attack', 'explosion', 'terrorism', 'hostage', 'coup', 'emergency'];
  if (highSeverityKeywords.some(kw => lowerContent.includes(kw))) {
    return 'high';
  }
  
  // Medium severity: operational risks and significant events
  const mediumSeverityKeywords = ['protest', 'strike', 'spill', 'leak', 'investigation', 'sanctions'];
  if (mediumSeverityKeywords.some(kw => lowerContent.includes(kw))) {
    return 'medium';
  }
  
  // Low severity: general news and business intelligence
  return 'low';
}

function categorizeContent(content: string, sourceCategories: string[]): string {
  const lowerContent = content.toLowerCase();
  
  if (APAC_SECURITY_KEYWORDS.some(kw => lowerContent.includes(kw))) {
    return 'security';
  }
  
  if (ENERGY_KEYWORDS.some(kw => lowerContent.includes(kw))) {
    return 'energy';
  }
  
  if (sourceCategories.includes('politics')) {
    return 'political';
  }
  
  if (sourceCategories.includes('business') || sourceCategories.includes('markets')) {
    return 'business_intelligence';
  }
  
  return 'regional_news';
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  // Create monitoring history entry
  const { data: historyEntry, error: historyError } = await supabase
    .from('monitoring_history')
    .insert({
      source_name: 'Regional APAC Monitor',
      status: 'running',
      scan_metadata: {
        sources: APAC_SOURCES.map(s => s.name),
        regions: [...new Set(APAC_SOURCES.map(s => s.region))]
      }
    })
    .select()
    .single();

  if (historyError) {
    console.error('Failed to create monitoring history:', historyError);
  }

  try {
    console.log('Starting Regional APAC news monitoring...');
    console.log(`Configured sources: ${APAC_SOURCES.length}`);

    // Fetch all clients with their monitoring keywords
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry, monitoring_keywords, locations');

    if (clientsError) throw clientsError;
    console.log(`Monitoring for ${clients?.length || 0} clients`);

    let signalsCreated = 0;
    let documentsIngested = 0;
    let itemsScanned = 0;
    const sourceResults: Record<string, { items: number; signals: number; errors: string[] }> = {};

    // Process each APAC source
    for (const source of APAC_SOURCES) {
      sourceResults[source.name] = { items: 0, signals: 0, errors: [] };
      
      try {
        console.log(`\n📡 Processing: ${source.name} (${source.region})`);
        
        let xmlText: string;
        
        if (source.type === 'rss' && source.url) {
          // Direct RSS fetch
          try {
            const response = await fetch(source.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' },
              signal: AbortSignal.timeout(30000)
            });
            
            if (!response.ok) {
              throw new Error(`RSS fetch failed: ${response.status}`);
            }
            
            xmlText = await response.text();
          } catch (rssError) {
            console.log(`  ⚠️ Primary RSS failed, trying Google News fallback...`);
            if (source.fallbackUrl) {
              const fallbackResponse = await fetch(source.fallbackUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' },
                signal: AbortSignal.timeout(30000)
              });
              xmlText = await fallbackResponse.text();
            } else {
              throw rssError;
            }
          }
        } else if (source.type === 'google_news' && source.searchQuery) {
          // Google News search
          xmlText = await fetchGoogleNewsRSS(source.searchQuery, source.region);
        } else {
          console.log(`  ⚠️ Invalid source configuration, skipping`);
          continue;
        }
        
        const items = parseRSS(xmlText, source.name, source.region, source.categories);
        sourceResults[source.name].items = items.length;
        itemsScanned += items.length;
        
        console.log(`  Found ${items.length} items`);
        
        // Process items (limit per source to avoid overwhelming)
        const maxItemsPerSource = source.priority === 'high' ? 8 : 5;
        
        for (const item of items.slice(0, maxItemsPerSource)) {
          try {
            const fullContent = `${item.title}\n\n${item.description}`.toLowerCase();
            
            // Check for client keyword matches
            let matchedClient = null;
            let matchedKeywords: string[] = [];
            
            for (const client of clients || []) {
              // Check client name
              if (fullContent.includes(client.name.toLowerCase())) {
                matchedClient = client;
                matchedKeywords.push(`client_name:${client.name}`);
                break;
              }
              
              // Check monitoring keywords
              if (client.monitoring_keywords?.length > 0) {
                const foundKeywords = client.monitoring_keywords.filter((kw: string) =>
                  fullContent.includes(kw.toLowerCase())
                );
                
                if (foundKeywords.length > 0) {
                  matchedClient = client;
                  matchedKeywords = foundKeywords;
                  break;
                }
              }
              
              // Check location matches
              if (client.locations?.length > 0) {
                const locationMatch = client.locations.find((loc: string) =>
                  fullContent.includes(loc.toLowerCase()) || 
                  item.region.toLowerCase().includes(loc.toLowerCase())
                );
                
                if (locationMatch && (APAC_SECURITY_KEYWORDS.some(kw => fullContent.includes(kw)) || 
                    ENERGY_KEYWORDS.some(kw => fullContent.includes(kw)))) {
                  matchedClient = client;
                  matchedKeywords.push(`location:${locationMatch}`);
                  break;
                }
              }
            }
            
            // For high-priority security content, create signal even without client match
            const isSecurityContent = APAC_SECURITY_KEYWORDS.some(kw => fullContent.includes(kw));
            const isEnergyContent = ENERGY_KEYWORDS.some(kw => fullContent.includes(kw));
            
            if (matchedClient || (isSecurityContent && source.priority === 'high')) {
              // Generate content hash
              const contentHash = await generateContentHash(`${item.link}|${item.title}`);
              
              // Check for duplicates
              const { data: existingSignal } = await supabase
                .from('signals')
                .select('id')
                .eq('content_hash', contentHash)
                .single();
              
              if (existingSignal) {
                console.log(`    ↩️ Skipping duplicate: ${item.title.substring(0, 40)}...`);
                continue;
              }
              
              const severity = calculateSeverity(fullContent, item.categories);
              const category = categorizeContent(fullContent, item.categories);
              
              // Create signal
              const { error: signalError } = await supabase
                .from('signals')
                .insert({
                  client_id: matchedClient?.id || null,
                  normalized_text: `[${source.name}] ${item.title}`,
                  category,
                  severity,
                  location: `${item.region} - ${source.name}`,
                  content_hash: contentHash,
                  raw_json: {
                    source: source.name,
                    source_type: 'regional_apac',
                    region: item.region,
                    url: item.link,
                    description: item.description,
                    categories: item.categories,
                    matched_keywords: matchedKeywords,
                    published_date: item.pubDate
                  },
                  status: 'new',
                  confidence: matchedClient ? 0.85 : 0.7
                });
              
              if (!signalError) {
                signalsCreated++;
                sourceResults[source.name].signals++;
                console.log(`    ✓ Signal created: ${item.title.substring(0, 50)}...`);
              }
              
              // Ingest for AI analysis
              const { data: insertedDoc, error: ingestError } = await supabase
                .from('ingested_documents')
                .insert({
                  title: item.title,
                  raw_text: `${item.title}\n\n${item.description}`,
                  source_url: item.link || null,
                  metadata: {
                    url: item.link,
                    source_type: 'regional_apac',
                    source_name: source.name,
                    region: item.region,
                    categories: item.categories,
                    matched_client: matchedClient?.name,
                    matched_keywords: matchedKeywords,
                    published_date: item.pubDate
                  },
                  processing_status: 'pending'
                })
                .select()
                .single();
              
              if (!ingestError && insertedDoc) {
                documentsIngested++;
                
                // Trigger AI processing
                supabase.functions.invoke('process-intelligence-document', {
                  body: { documentId: insertedDoc.id }
                }).catch(err => console.error('Failed to trigger processing:', err));
              }
            }
          } catch (itemError) {
            console.error(`    ❌ Error processing item:`, itemError);
          }
        }
        
        console.log(`  ✓ ${source.name}: ${sourceResults[source.name].signals} signals created`);
        
      } catch (sourceError) {
        const errorMsg = sourceError instanceof Error ? sourceError.message : String(sourceError);
        sourceResults[source.name].errors.push(errorMsg);
        console.error(`  ❌ ${source.name} error:`, errorMsg);
      }
    }

    // Update monitoring history
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: itemsScanned,
          signals_created: signalsCreated,
          scan_metadata: {
            sources: APAC_SOURCES.map(s => s.name),
            regions: [...new Set(APAC_SOURCES.map(s => s.region))],
            source_results: sourceResults,
            documents_ingested: documentsIngested
          }
        })
        .eq('id', historyEntry.id);
    }

    console.log(`\n📊 Regional APAC monitoring complete:`);
    console.log(`   Items scanned: ${itemsScanned}`);
    console.log(`   Signals created: ${signalsCreated}`);
    console.log(`   Documents ingested: ${documentsIngested}`);

    return successResponse({
      success: true,
      sources_scanned: APAC_SOURCES.length,
      items_scanned: itemsScanned,
      signals_created: signalsCreated,
      documents_ingested: documentsIngested,
      source_results: sourceResults
    });

  } catch (error) {
    console.error('Regional APAC monitoring error:', error);
    
    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'failed',
          scan_completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', historyEntry.id);
    }

    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
