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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting Canadian sources monitoring scan');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch all clients
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
        const matchedClients = findMatchingClients(clients, item.title + ' ' + item.description);
        for (const client of matchedClients) {
          await createSignal(supabaseClient, {
            client_id: client.id,
            source: 'RCMP Gazette',
            category: 'threat-intelligence',
            severity: determineSeverity(item.title + ' ' + item.description),
            title: item.title,
            description: item.description,
            url: item.link,
            published_date: item.pubDate
          });
          signalsCreated++;
        }
      }
      sources.push('RCMP Gazette');
    } catch (error) {
      console.error('Error monitoring RCMP:', error);
    }

    // 2. DriveBC Alerts
    try {
      console.log('Monitoring DriveBC alerts...');
      const driveBcResponse = await fetch('https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE');
      const driveBcData = await driveBcResponse.json();
      
      for (const event of (driveBcData.events || []).slice(0, 20)) {
        const description = `${event.headline || ''} - ${event.description || ''}`;
        const location = event.geography?.coordinates || event.roads?.[0]?.name || 'BC';
        
        const matchedClients = findMatchingClientsByLocation(clients, location);
        for (const client of matchedClients) {
          await createSignal(supabaseClient, {
            client_id: client.id,
            source: 'DriveBC',
            category: 'operational-risk',
            severity: event.severity || 'medium',
            title: event.headline || 'DriveBC Alert',
            description: description,
            location: location,
            url: `https://drivebc.ca/`,
            published_date: event.created || new Date().toISOString()
          });
          signalsCreated++;
        }
      }
      sources.push('DriveBC');
    } catch (error) {
      console.error('Error monitoring DriveBC:', error);
    }

    // 3. BC Energy Regulator Bulletins
    try {
      console.log('Monitoring BC Energy Regulator...');
      const bcerResponse = await fetch('https://www.bc-er.ca/feed/');
      const bcerText = await bcerResponse.text();
      const bcerItems = parseRSS(bcerText);
      
      for (const item of bcerItems.slice(0, 10)) {
        const matchedClients = findMatchingClients(clients, item.title + ' ' + item.description, ['energy', 'oil', 'gas']);
        for (const client of matchedClients) {
          await createSignal(supabaseClient, {
            client_id: client.id,
            source: 'BC Energy Regulator',
            category: 'regulatory',
            severity: determineSeverity(item.title),
            title: item.title,
            description: item.description,
            url: item.link,
            published_date: item.pubDate
          });
          signalsCreated++;
        }
      }
      sources.push('BC Energy Regulator');
    } catch (error) {
      console.error('Error monitoring BC Energy Regulator:', error);
    }

    // 4. Peace River Regional District
    try {
      console.log('Monitoring Peace River Regional District...');
      const prrdResponse = await fetch('https://www.prrd.bc.ca/feed/');
      const prrdText = await prrdResponse.text();
      const prrdItems = parseRSS(prrdText);
      
      for (const item of prrdItems.slice(0, 10)) {
        const matchedClients = findMatchingClientsByLocation(clients, 'Peace River');
        for (const client of matchedClients) {
          await createSignal(supabaseClient, {
            client_id: client.id,
            source: 'Peace River Regional District',
            category: 'regional-alert',
            severity: determineSeverity(item.title),
            title: item.title,
            description: item.description,
            url: item.link,
            published_date: item.pubDate
          });
          signalsCreated++;
        }
      }
      sources.push('Peace River Regional District');
    } catch (error) {
      console.error('Error monitoring PRRD:', error);
    }

    // 5. Glassdoor (company reviews - using search)
    try {
      console.log('Monitoring Glassdoor reviews...');
      for (const client of clients) {
        try {
          // Note: Glassdoor doesn't have a public API, so this is a placeholder
          // In production, you'd need to use a third-party service or web scraping
          console.log(`Would check Glassdoor for: ${client.name}`);
        } catch (error) {
          console.error(`Error checking Glassdoor for ${client.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error monitoring Glassdoor:', error);
    }

    console.log(`Canadian sources monitoring complete. Created ${signalsCreated} signals from sources: ${sources.join(', ')}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scanned ${sources.length} Canadian sources`,
        signalsCreated,
        sources
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Canadian sources monitoring error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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

// Find clients matching keywords in content
function findMatchingClients(clients: Client[], content: string, industries?: string[]): Client[] {
  const lowerContent = content.toLowerCase();
  const matched: Client[] = [];

  for (const client of clients) {
    // Check if client name appears in content
    if (lowerContent.includes(client.name.toLowerCase())) {
      matched.push(client);
      continue;
    }

    // Check if client industry matches (if industries filter provided)
    if (industries && client.industry) {
      const clientIndustry = client.industry.toLowerCase();
      if (industries.some(ind => clientIndustry.includes(ind.toLowerCase()))) {
        matched.push(client);
        continue;
      }
    }

    // Check if any client location appears in content
    if (client.locations) {
      for (const location of client.locations) {
        if (lowerContent.includes(location.toLowerCase())) {
          matched.push(client);
          break;
        }
      }
    }
  }

  return matched;
}

// Find clients by location proximity
function findMatchingClientsByLocation(clients: Client[], location: string): Client[] {
  const lowerLocation = location.toLowerCase();
  const matched: Client[] = [];

  for (const client of clients) {
    if (client.locations) {
      for (const clientLocation of client.locations) {
        if (lowerLocation.includes(clientLocation.toLowerCase()) || 
            clientLocation.toLowerCase().includes(lowerLocation)) {
          matched.push(client);
          break;
        }
      }
    }
  }

  return matched;
}

// Determine severity based on keywords
function determineSeverity(text: string): string {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('critical') || lowerText.includes('emergency') || 
      lowerText.includes('severe') || lowerText.includes('urgent')) {
    return 'critical';
  }
  
  if (lowerText.includes('warning') || lowerText.includes('alert') || 
      lowerText.includes('incident') || lowerText.includes('violation')) {
    return 'high';
  }
  
  if (lowerText.includes('notice') || lowerText.includes('update') || 
      lowerText.includes('advisory')) {
    return 'medium';
  }
  
  return 'low';
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
  location?: string;
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
        location: data.location || null,
        normalized_text: `${data.title}\n\n${data.description}`,
        raw_json: {
          source: data.source,
          title: data.title,
          description: data.description,
          url: data.url,
          published_date: data.published_date
        },
        confidence: 75,
        received_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating signal:', error);
    }
  } catch (error) {
    console.error('Error in createSignal:', error);
  }
}
