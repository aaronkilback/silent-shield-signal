import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const SECURITY_KEYWORDS = [
  'espionage', 'terrorism', 'cybersecurity', 'foreign interference', 'threat',
  'intelligence', 'national security', 'hostile', 'breach', 'vulnerability',
  'ransomware', 'malware', 'phishing', 'data breach', 'critical infrastructure'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    console.log('Starting CSIS (Canadian Security Intelligence Service) monitoring scan');

    const supabaseClient = createServiceClient();

    // Fetch all clients
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('*');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    const sources = [];

    // 1. CSIS Public Reports and News
    try {
      console.log('Monitoring CSIS public reports...');
      const csisResponse = await fetch('https://www.canada.ca/en/security-intelligence-service.atom.xml');
      if (csisResponse.ok) {
        const csisText = await csisResponse.text();
        const csisItems = parseAtomFeed(csisText);
        
        for (const item of csisItems.slice(0, 15)) {
          const content = `${item.title} ${item.description}`.toLowerCase();
          
          const hasSecurityKeyword = SECURITY_KEYWORDS.some(keyword => 
            content.includes(keyword.toLowerCase())
          );
          
          if (hasSecurityKeyword) {
            for (const client of clients) {
              const isRelevant = client.name.toLowerCase().split(' ').some((word: string) => 
                word.length > 3 && content.includes(word)
              ) || (client.industry && content.includes(client.industry.toLowerCase()));

              if (isRelevant || hasHighPrioritySeverity(content)) {
                await createSignal(supabaseClient, {
                  client_id: client.id,
                  source: 'CSIS',
                  category: 'threat-intelligence',
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
        }
        sources.push('CSIS Public Reports');
      }
    } catch (error) {
      console.error('Error monitoring CSIS:', error);
    }

    // 2. Canadian Centre for Cyber Security
    try {
      console.log('Monitoring Canadian Centre for Cyber Security...');
      const cyberResponse = await fetch('https://cyber.gc.ca/en/feeds/alerts-and-advisories');
      if (cyberResponse.ok) {
        const cyberText = await cyberResponse.text();
        const cyberItems = parseAtomFeed(cyberText);
        
        for (const item of cyberItems.slice(0, 20)) {
          for (const client of clients) {
            await createSignal(supabaseClient, {
              client_id: client.id,
              source: 'Canadian Cyber Centre',
              category: 'threat-intelligence',
              severity: determineCyberSeverity(item.title),
              title: item.title,
              description: item.description,
              url: item.link,
              published_date: item.pubDate
            });
            signalsCreated++;
          }
        }
        sources.push('Canadian Cyber Centre');
      }
    } catch (error) {
      console.error('Error monitoring Cyber Centre:', error);
    }

    // 3. Public Safety Canada Alerts
    try {
      console.log('Monitoring Public Safety Canada...');
      const psResponse = await fetch('https://www.publicsafety.gc.ca/index-en.atom.xml');
      if (psResponse.ok) {
        const psText = await psResponse.text();
        const psItems = parseAtomFeed(psText);
        
        for (const item of psItems.slice(0, 10)) {
          const content = `${item.title} ${item.description}`.toLowerCase();
          
          const hasSecurityKeyword = SECURITY_KEYWORDS.some(keyword => 
            content.includes(keyword.toLowerCase())
          );
          
          if (hasSecurityKeyword) {
            for (const client of clients) {
              const isRelevant = client.name.toLowerCase().split(' ').some((word: string) => 
                word.length > 3 && content.includes(word)
              ) || hasHighPrioritySeverity(content);

              if (isRelevant) {
                await createSignal(supabaseClient, {
                  client_id: client.id,
                  source: 'Public Safety Canada',
                  category: 'threat-intelligence',
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
        }
        sources.push('Public Safety Canada');
      }
    } catch (error) {
      console.error('Error monitoring Public Safety Canada:', error);
    }

    console.log(`CSIS monitoring complete. Created ${signalsCreated} signals from ${sources.length} sources`);

    return successResponse({
      success: true,
      message: `Scanned ${sources.length} CSIS/security intelligence sources`,
      signalsCreated,
      sources
    });

  } catch (error) {
    console.error('CSIS monitoring error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// Helper function to parse Atom feeds (used by Canada.ca sites)
function parseAtomFeed(xmlText: string) {
  const items: any[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryXml = match[1];
    const title = extractTag(entryXml, 'title');
    const description = extractTag(entryXml, 'summary') || extractTag(entryXml, 'content');
    const link = extractAtomLink(entryXml);
    const pubDate = extractTag(entryXml, 'updated') || extractTag(entryXml, 'published');

    items.push({ title, description, link, pubDate });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function extractAtomLink(xml: string): string {
  const linkRegex = /<link[^>]*href="([^"]*)"[^>]*>/i;
  const match = linkRegex.exec(xml);
  return match ? match[1] : '';
}

// Determine severity based on keywords
function determineSeverity(text: string): string {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('critical') || lowerText.includes('urgent') || 
      lowerText.includes('immediate') || lowerText.includes('terrorism') ||
      lowerText.includes('espionage')) {
    return 'critical';
  }
  
  if (lowerText.includes('high') || lowerText.includes('threat') || 
      lowerText.includes('breach') || lowerText.includes('attack') ||
      lowerText.includes('foreign interference')) {
    return 'high';
  }
  
  if (lowerText.includes('advisory') || lowerText.includes('warning') || 
      lowerText.includes('vulnerability')) {
    return 'medium';
  }
  
  return 'low';
}

function determineCyberSeverity(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes('critical') || lowerTitle.includes('zero-day') ||
      lowerTitle.includes('actively exploited')) {
    return 'critical';
  }
  
  if (lowerTitle.includes('high') || lowerTitle.includes('important') ||
      lowerTitle.includes('ransomware') || lowerTitle.includes('breach')) {
    return 'high';
  }
  
  if (lowerTitle.includes('medium') || lowerTitle.includes('advisory')) {
    return 'medium';
  }
  
  return 'low';
}

function hasHighPrioritySeverity(text: string): boolean {
  return determineSeverity(text) === 'critical' || determineSeverity(text) === 'high';
}

// Create a signal in the database
async function createSignal(supabaseClient: any, data: {
  client_id: string;
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
          published_date: data.published_date
        },
        confidence: 85,
        received_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating signal:', error);
    }
  } catch (error) {
    console.error('Error in createSignal:', error);
  }
}
