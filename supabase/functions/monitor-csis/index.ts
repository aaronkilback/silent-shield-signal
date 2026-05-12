import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const SECURITY_KEYWORDS = [
  'espionage', 'terrorism', 'cybersecurity', 'foreign interference', 'threat',
  'intelligence', 'national security', 'hostile', 'breach', 'vulnerability',
  'ransomware', 'malware', 'phishing', 'data breach', 'critical infrastructure'
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabaseClient = createServiceClient();
  const hb = await startHeartbeat(supabaseClient, 'monitor-csis-6h');

  try {
    console.log('Starting CSIS (Canadian Security Intelligence Service) monitoring scan');

    // Fetch all clients
    const { data: clients, error: clientsError } = await supabaseClient
      .from('clients')
      .select('*');

    if (clientsError) throw clientsError;

    let signalsCreated = 0;
    const sources = [];

    // 1. CSIS Public Reports atom feed.
    // DEPRECATED 2026-05-03: this URL now redirects to canada.ca/errors/404.html.
    // Kept the block disabled-by-flag for archival reference; flip
    // CSIS_ATOM_ENABLED to true if Canada.ca republishes it.
    const CSIS_ATOM_ENABLED = false;
    if (CSIS_ATOM_ENABLED) try {
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

          // Two-tier ingest:
          //   • Client-name match → per-client signal, normal AI gate.
          //   • Security-keyword match without client-name → single
          //     cyber-advisory signal that bypasses the gate (CSIS
          //     reports about ransomware / hostile-state activity /
          //     critical infrastructure threats are inherently
          //     relevant to enterprise clients regardless of whether
          //     they name-check the client).
          if (!hasSecurityKeyword) continue;

          let perClientHit = false;
          for (const client of clients) {
            const isRelevant = client.name.toLowerCase().split(' ').some((word: string) =>
              word.length > 3 && content.includes(word)
            ) || (client.industry && content.includes(client.industry.toLowerCase()));

            if (isRelevant) {
              const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                body: {
                  text: `${item.title}\n\n${item.description}`,
                  source_url: item.link || undefined,
                  client_id: client.id,
                  location: 'Canada',
                  source_key: 'csis-public-reports',
                },
              });
              if (!error) signalsCreated++;
              perClientHit = true;
            }
          }

          if (!perClientHit && clients[0]) {
            const { error } = await supabaseClient.functions.invoke('ingest-signal', {
              body: {
                text: `[CSIS Advisory] ${item.title}\n\n${item.description}`,
                source_url: item.link || undefined,
                client_id: clients[0].id,
                location: 'Canada',
                source_key: 'csis-public-reports',
                skip_relevance_gate: true,
                raw_json: {
                  signal_origin: 'monitor-csis',
                  source: 'CSIS Public Reports',
                  category_hint: 'cyber_advisory',
                },
              },
            });
            if (!error) signalsCreated++;
          }
        }
        sources.push('CSIS Public Reports');
      }
    } catch (error) {
      console.error('Error monitoring CSIS:', error);
    }

    // 2. Canadian Centre for Cyber Security (CCCS).
    // The old atom feed at cyber.gc.ca/en/feeds/alerts-and-advisories
    // was deprecated (returns 404 as of May 2026). Switched to the
    // CCCS public JSON API that backs cyber.gc.ca/en/alerts-advisories
    // — same content, different shape.
    try {
      console.log('Monitoring CCCS via JSON API...');
      const cyberResponse = await fetch(
        'https://www.cyber.gc.ca/api/cccs/threats/v1/get?count=20',
        { signal: AbortSignal.timeout(15000) },
      );
      if (cyberResponse.ok) {
        const cyberJson: any = await cyberResponse.json();
        const items: any[] = cyberJson?.response ?? [];
        // Items come back newest-first; trust the API's ordering.
        // We process the 8 most recent so we stay under the 150s
        // edge-function timeout (each ingest-signal call costs
        // ~5-8s end-to-end).
        const recent = items.slice(0, 8);
        for (const item of recent) {
          if (!clients?.length) continue;
          // Body comes back as an array of HTML strings; flatten and
          // strip tags for the signal text.
          const bodyHtml = Array.isArray(item.body) ? item.body.join('\n\n') : (item.body ?? '');
          const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1500);
          const sourceUrl = item.path
            ? `https://www.cyber.gc.ca${item.path}`
            : `https://www.cyber.gc.ca/en/alerts-advisories?nid=${item.nid}`;

          // CCCS cyber advisories are client-agnostic — fan out to
          // every active client. 2026-05-10: parallelized the inner
          // loop. Sequential 8 items × 5 clients × ~5s each = 200s,
          // exceeding the 150s edge-function idle timeout. The function
          // would die mid-fanout, never reach completeHeartbeat, and
          // heartbeat would report signals_created=0 for the run even
          // when partial work succeeded. Per-item parallel fanout caps
          // at ~max(client_call_time) ≈ 5-8s per item × 8 items ≈ 60s.
          const fanouts = await Promise.allSettled(clients.map((client: any) =>
            supabaseClient.functions.invoke('ingest-signal', {
              body: {
                text: `[CCCS Cyber Alert] ${item.title}\n\n${bodyText}`,
                source_url: sourceUrl,
                location: 'Canada',
                client_id: client.id,
                source_key: 'cccs-cyber-advisories',
                skip_relevance_gate: true,
                raw_json: {
                  signal_origin: 'monitor-csis',
                  source: 'Canadian Centre for Cyber Security',
                  category_hint: 'cyber_advisory',
                  cccs_nid: item.nid,
                  cccs_uuid: item.uuid,
                  date_modified: item.date_modified,
                  date_created: item.date_created,
                },
              },
            })
          ));
          for (const result of fanouts) {
            if (result.status === 'fulfilled' && !result.value.error) {
              signalsCreated++;
            }
          }
        }
        sources.push('Canadian Cyber Centre');
      } else {
        console.log(`[CCCS] HTTP ${cyberResponse.status}`);
      }
    } catch (error) {
      console.error('Error monitoring Cyber Centre:', error);
    }

    // 3. Public Safety Canada RSS feed.
    // DEPRECATED 2026-05-03: returns HTTP 404 — feed is gone. Kept
    // disabled-by-flag for archival reference; flip
    // PUBLIC_SAFETY_ENABLED to true if a successor feed appears.
    const PUBLIC_SAFETY_ENABLED = false;
    if (PUBLIC_SAFETY_ENABLED) try {
      console.log('Monitoring Public Safety Canada...');
      const psResponse = await fetch('https://www.publicsafety.gc.ca/cnt/rsrcs/pblctns/rss-eng.xml');
      if (psResponse.ok) {
        const psText = await psResponse.text();
        const psItems = parseAtomFeed(psText);
        
        for (const item of psItems.slice(0, 10)) {
          const content = `${item.title} ${item.description}`.toLowerCase();

          const hasSecurityKeyword = SECURITY_KEYWORDS.some(keyword =>
            content.includes(keyword.toLowerCase())
          );
          if (!hasSecurityKeyword) continue;

          // Public Safety Canada publications cover ransomware,
          // critical-infrastructure threats, hostile-state cyber.
          // Same two-tier handling as CSIS: per-client when client
          // name matches, generic cyber-advisory ingest with gate
          // bypass otherwise.
          let perClientHit = false;
          for (const client of clients) {
            const isRelevant = client.name.toLowerCase().split(' ').some((word: string) =>
              word.length > 3 && content.includes(word)
            );
            if (isRelevant) {
              const { error } = await supabaseClient.functions.invoke('ingest-signal', {
                body: {
                  text: `${item.title}\n\n${item.description}`,
                  source_url: item.link || undefined,
                  client_id: client.id,
                  location: 'Canada',
                  source_key: 'public-safety-canada',
                },
              });
              if (!error) signalsCreated++;
              perClientHit = true;
            }
          }
          if (!perClientHit && hasHighPrioritySeverity(content) && clients[0]) {
            const { error } = await supabaseClient.functions.invoke('ingest-signal', {
              body: {
                text: `[Public Safety Canada] ${item.title}\n\n${item.description}`,
                source_url: item.link || undefined,
                client_id: clients[0].id,
                location: 'Canada',
                source_key: 'public-safety-canada',
                skip_relevance_gate: true,
                raw_json: {
                  signal_origin: 'monitor-csis',
                  source: 'Public Safety Canada',
                  category_hint: 'cyber_advisory',
                },
              },
            });
            if (!error) signalsCreated++;
          }
        }
        sources.push('Public Safety Canada');
      }
    } catch (error) {
      console.error('Error monitoring Public Safety Canada:', error);
    }

    console.log(`CSIS monitoring complete. Created ${signalsCreated} signals from ${sources.length} sources`);

    await completeHeartbeat(supabaseClient, hb, {
      signals_created: signalsCreated,
      sources_scanned: sources.length,
    });

    return successResponse({
      success: true,
      message: `Scanned ${sources.length} CSIS/security intelligence sources`,
      signalsCreated,
      sources
    });

  } catch (error) {
    console.error('CSIS monitoring error:', error);
    await failHeartbeat(supabaseClient, hb, error);
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

