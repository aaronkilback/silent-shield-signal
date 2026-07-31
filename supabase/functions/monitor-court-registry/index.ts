import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const COURT_KEYWORDS = [
  'fraud', 'theft', 'assault', 'breach', 'violation', 'charge', 'convicted',
  'lawsuit', 'plaintiff', 'defendant', 'judgment', 'restraining', 'injunction',
  'bankruptcy', 'foreclosure', 'lien', 'damages', 'negligence', 'liability'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // WO-CHECK5-BURNDOWN-01: cron-only monitor. Internal-caller gate before service-role client.
  const gate = requireInternalCaller(req);
  if (gate) return gate;

  const supabaseClient = createServiceClient();
  const hb = await startHeartbeat(supabaseClient, 'monitor-court-registry-4h');

  try {
    console.log('Starting court registry monitoring scan');

    // Fetch all clients and entities
    const { data: clients } = await supabaseClient.from('clients').select('*');
    const { data: entities } = await supabaseClient.from('entities').select('*');

    // #256 Phase 2 (2026-05-23) — pre-resolve entity → owning-client map.
    // Pre-fix, entity-match branches sent signals with no client_id, which
    // routed through ingest-signal's cross-tenant scoring loop. New contract
    // (Aaron-approved Option D) requires explicit ownership OR skip.
    //
    // Owners are the UNION of two sources:
    //   1. entity_clients junction (canonical many-to-many table)
    //   2. entities.client_id (legacy single-owner column on some rows)
    // Fan out one signal per owning client; skip entirely when no owners.
    const { data: entityClientsRows } = await supabaseClient
      .from('entity_clients')
      .select('entity_id, client_id');
    const entityOwners = new Map<string, Set<string>>();
    for (const row of entityClientsRows || []) {
      let owners = entityOwners.get(row.entity_id);
      if (!owners) {
        owners = new Set();
        entityOwners.set(row.entity_id, owners);
      }
      owners.add(row.client_id);
    }
    const resolveEntityOwners = (entity: any): string[] => {
      const owners = new Set<string>(entityOwners.get(entity.id) ?? []);
      if (entity.client_id) owners.add(entity.client_id);
      return [...owners];
    };

    let signalsCreated = 0;
    let entityMatchesSkipped = 0;
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
              const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                body: {
                  text: `${item.title}\n\n${item.description}`,
                  source_url: item.link || undefined,
                  client_id: client.id,
                  location: 'British Columbia, Canada',
                },
              });
              if (!error) signalsCreated++;
            }
          }

          // #256 Phase 2 — entity-match branch with explicit owner attribution.
          for (const entity of entities || []) {
            if (!content.includes(entity.name.toLowerCase())) continue;
            const owners = resolveEntityOwners(entity);
            if (owners.length === 0) {
              entityMatchesSkipped++;
              console.warn(`[CourtRegistry][#256] BC: skipping entity "${entity.name}" (id=${entity.id}) — no owning client`);
              continue;
            }
            for (const ownerClientId of owners) {
              const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                body: {
                  text: `${item.title}\n\n${item.description}`,
                  source_url: item.link || undefined,
                  client_id: ownerClientId,
                  location: 'British Columbia, Canada',
                  raw_json: {
                    signal_origin: 'monitor-court-registry',
                    source: 'BC Courthouse Library',
                    entity_id: entity.id,
                    entity_name: entity.name,
                    entity_owner_count: owners.length,
                  },
                },
              });
              if (!error) signalsCreated++;
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
                const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                  body: {
                    text: `${item.title}\n\n${item.description}`,
                    source_url: item.link || undefined,
                    client_id: client.id,
                    location: 'Canada',
                  },
                });
                if (!error) signalsCreated++;
              }
            }

            // #256 Phase 2 — entity-match branch with explicit owner attribution.
            for (const entity of entities || []) {
              if (!content.includes(entity.name.toLowerCase())) continue;
              const owners = resolveEntityOwners(entity);
              if (owners.length === 0) {
                entityMatchesSkipped++;
                console.warn(`[CourtRegistry][#256] SCC: skipping entity "${entity.name}" (id=${entity.id}) — no owning client`);
                continue;
              }
              for (const ownerClientId of owners) {
                const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                  body: {
                    text: `${item.title}\n\n${item.description}`,
                    source_url: item.link || undefined,
                    client_id: ownerClientId,
                    location: 'Canada',
                    raw_json: {
                      signal_origin: 'monitor-court-registry',
                      source: 'Supreme Court of Canada',
                      entity_id: entity.id,
                      entity_name: entity.name,
                      entity_owner_count: owners.length,
                    },
                  },
                });
                if (!error) signalsCreated++;
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

    console.log(`Court registry monitoring complete. Created ${signalsCreated} signals from ${sources.length} sources. Entity matches skipped (no owning client, #256 Phase 2): ${entityMatchesSkipped}`);

    await completeHeartbeat(supabaseClient, hb, {
      signals_created: signalsCreated,
      sources_scanned: sources.length,
      entity_matches_skipped_no_owner: entityMatchesSkipped,
    });

    return successResponse({
      success: true,
      message: `Scanned ${sources.length} court registry sources`,
      signalsCreated,
      entity_matches_skipped_no_owner: entityMatchesSkipped,
      sources
    });

  } catch (error) {
    console.error('Court registry monitoring error:', error);
    await failHeartbeat(supabaseClient, hb, error);
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

