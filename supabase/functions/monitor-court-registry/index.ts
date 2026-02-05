import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const COURT_KEYWORDS = [
  'fraud', 'theft', 'assault', 'breach', 'violation', 'charge', 'convicted',
  'lawsuit', 'plaintiff', 'defendant', 'judgment', 'restraining', 'injunction',
  'bankruptcy', 'foreclosure', 'lien', 'damages', 'negligence', 'liability'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('Starting court registry monitoring scan');

    const supabaseClient = createServiceClient();

    // Fetch all clients and entities
    const { data: clients } = await supabaseClient.from('clients').select('*');
    const { data: entities } = await supabaseClient.from('entities').select('*');

    let signalsCreated = 0;
    const sources = [];

    // 1. BC Court Services Daily Court Lists
    try {
      console.log('Monitoring BC Court Services...');
      
      const bcCourtResponse = await fetch('https://www.courthouselibrary.ca/news-events/rss');
      if (bcCourtResponse.ok) {
        const courtText = await bcCourtResponse.text();
        const courtItems = parseRSS(courtText);
        
        for (const item of courtItems.slice(0, 10)) {
          const content = `${item.title} ${item.description}`.toLowerCase();
          
          // Check against clients
          for (const client of clients || []) {
            if (content.includes(client.name.toLowerCase())) {
              await createSignal(supabaseClient, {
                client_id: client.id,
                entity_id: null,
                source: 'BC Courthouse Library',
                category: 'legal-regulatory',
                severity: determineSeverity(content),
                title: item.title,
                description: item.description,
                url: item.link,
                published_date: item.pubDate
              });
              signalsCreated++;
            }
          }

          // Check against entities
          for (const entity of entities || []) {
            if (content.includes(entity.name.toLowerCase())) {
              await createSignal(supabaseClient, {
                client_id: null,
                entity_id: entity.id,
                source: 'BC Courthouse Library',
                category: 'legal-regulatory',
                severity: determineSeverity(content),
                title: item.title,
                description: item.description,
                url: item.link,
                published_date: item.pubDate
              });
              signalsCreated++;
            }
          }
        }
        sources.push('BC Courthouse Library');
      }
    } catch (error) {
      console.error('Error monitoring BC Court Services:', error);
    }

    // 2. Supreme Court of Canada
    try {
      console.log('Monitoring Supreme Court of Canada...');
      const sccResponse = await fetch('https://www.scc-csc.ca/case-dossier/info/rss-eng.aspx');
      if (sccResponse.ok) {
        const sccText = await sccResponse.text();
        const sccItems = parseRSS(sccText);
        
        for (const item of sccItems.slice(0, 10)) {
          const content = `${item.title} ${item.description}`.toLowerCase();
          
          const hasKeyword = COURT_KEYWORDS.some(keyword => content.includes(keyword));
          
          if (hasKeyword) {
            // Check against clients
            for (const client of clients || []) {
              if (content.includes(client.name.toLowerCase())) {
                await createSignal(supabaseClient, {
                  client_id: client.id,
                  entity_id: null,
                  source: 'Supreme Court of Canada',
                  category: 'legal-regulatory',
                  severity: 'high',
                  title: item.title,
                  description: item.description,
                  url: item.link,
                  published_date: item.pubDate
                });
                signalsCreated++;
              }
            }

            // Check against entities
            for (const entity of entities || []) {
              if (content.includes(entity.name.toLowerCase())) {
                await createSignal(supabaseClient, {
                  client_id: null,
                  entity_id: entity.id,
                  source: 'Supreme Court of Canada',
                  category: 'legal-regulatory',
                  severity: 'high',
                  title: item.title,
                  description: item.description,
                  url: item.link,
                  published_date: item.pubDate
                });
                signalsCreated++;
              }
            }
          }
        }
        sources.push('Supreme Court of Canada');
      }
    } catch (error) {
      console.error('Error monitoring Supreme Court:', error);
    }

    // 3. Check entities in court databases (placeholder for future integration)
    try {
      console.log('Checking for court case mentions...');
      sources.push('Court Database Search (placeholder)');
    } catch (error) {
      console.error('Error checking court databases:', error);
    }

    console.log(`Court registry monitoring complete. Created ${signalsCreated} signals from ${sources.length} sources`);

    return successResponse({
      success: true,
      message: `Scanned ${sources.length} court registry sources`,
      signalsCreated,
      sources
    });

  } catch (error) {
    console.error('Court registry monitoring error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

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

// Determine severity based on keywords
function determineSeverity(text: string): string {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('convicted') || lowerText.includes('guilty') || 
      lowerText.includes('fraud') || lowerText.includes('criminal')) {
    return 'critical';
  }
  
  if (lowerText.includes('lawsuit') || lowerText.includes('breach') || 
      lowerText.includes('violation') || lowerText.includes('charge')) {
    return 'high';
  }
  
  if (lowerText.includes('hearing') || lowerText.includes('proceeding') || 
      lowerText.includes('case')) {
    return 'medium';
  }
  
  return 'low';
}

// Create a signal in the database
async function createSignal(supabaseClient: any, data: {
  client_id: string | null;
  entity_id: string | null;
  source: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  url?: string;
  published_date?: string;
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
          entity_id: data.entity_id
        },
        confidence: 80,
        received_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating signal:', error);
    }
  } catch (error) {
    console.error('Error in createSignal:', error);
  }
}
