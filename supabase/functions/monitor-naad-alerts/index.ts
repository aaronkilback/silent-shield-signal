import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";

/**
 * NAAD (National Alert Aggregation & Dissemination) Emergency Alert Monitor
 * 
 * Polls Canada's official emergency alert Atom feed for:
 * - Active threats (active shooter, terrorism, armed person)
 * - AMBER alerts
 * - Wildfires, severe weather
 * - Civil emergencies
 * 
 * Feed: https://alert.naad-adna.pelmorex.com/
 */

interface NAADAlert {
  id: string;
  title: string;
  summary: string;
  updated: string;
  link: string;
  category: string;
}

function parseAtomFeed(xmlText: string): NAADAlert[] {
  const alerts: NAADAlert[] = [];
  const entryMatches = xmlText.matchAll(/<entry>([\s\S]*?)<\/entry>/g);

  for (const match of entryMatches) {
    const entryXml = match[1];
    const id = entryXml.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const title = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
    const summary = entryXml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.trim() || '';
    const updated = entryXml.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() || new Date().toISOString();
    const link = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || '';
    const category = entryXml.match(/<category[^>]*term="([^"]*)"[^>]*\/>/)?.[1] || 'unknown';

    if (id) {
      alerts.push({ id, title, summary, updated, link, category });
    }
  }

  return alerts;
}

function classifyAlert(alert: NAADAlert): { category: string; severity: string; priority: string } {
  const text = `${alert.title} ${alert.summary} ${alert.category}`.toLowerCase();

  // P1 - Immediate life threat
  if (/active shooter|armed person|terrorism|bomb threat|hostage|mass casualty|explosion/.test(text)) {
    return { category: 'active_threat', severity: 'critical', priority: 'p1' };
  }
  if (/amber alert|child abduction|missing.*child/.test(text)) {
    return { category: 'amber_alert', severity: 'critical', priority: 'p1' };
  }
  if (/tornado warning|tsunami warning|earthquake.*major/.test(text)) {
    return { category: 'natural_disaster', severity: 'critical', priority: 'p1' };
  }

  // P2 - High urgency
  if (/wildfire|forest fire|evacuation|hazardous material|hazmat/.test(text)) {
    return { category: 'environmental', severity: 'high', priority: 'p2' };
  }
  if (/severe thunderstorm warning|blizzard warning|flood warning/.test(text)) {
    return { category: 'weather', severity: 'high', priority: 'p2' };
  }
  if (/civil emergency|emergency alert|public safety/.test(text)) {
    return { category: 'civil_emergency', severity: 'high', priority: 'p2' };
  }

  // P3 - Moderate
  if (/weather watch|air quality|road closure|power outage/.test(text)) {
    return { category: 'advisory', severity: 'medium', priority: 'p3' };
  }

  return { category: 'general_alert', severity: 'low', priority: 'p4' };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  const historyEntry = await createHistoryEntry(supabase, 'NAAD Emergency Alerts');

  try {
    console.log('[NAAD] Starting emergency alert scan...');

    // NAAD Atom feed - primary endpoint
    const feedUrls = [
      'https://rss.naad-adna.pelmorex.com/',
    ];

    let totalAlerts = 0;
    let signalsCreated = 0;
    const processedAlerts: any[] = [];

    // Fetch all clients for matching
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, locations, monitoring_keywords');

    for (const feedUrl of feedUrls) {
      try {
        console.log(`[NAAD] Fetching feed: ${feedUrl}`);
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Fortress-OSINT-Monitor/1.0' },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          console.warn(`[NAAD] Feed ${feedUrl} returned ${response.status}`);
          continue;
        }

        const xmlText = await response.text();
        const alerts = parseAtomFeed(xmlText);
        totalAlerts += alerts.length;

        console.log(`[NAAD] Found ${alerts.length} alerts from ${feedUrl}`);

        for (const alert of alerts) {
          // Classify first to filter low-priority weather noise
          const classification = classifyAlert(alert);
          
          // Only ingest P1-P3 alerts (skip routine weather advisories)
          if (classification.priority === 'p4') {
            continue;
          }

          // Generate content hash for dedup
          const encoder = new TextEncoder();
          const hashData = encoder.encode(`naad|${alert.id}|${alert.title}`);
          const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          // Check rejected hashes
          const { data: rejected } = await supabase
            .from('rejected_content_hashes')
            .select('id')
            .eq('content_hash', contentHash)
            .maybeSingle();

          if (rejected) continue;

          // Check existing signal
          const { data: existing } = await supabase
            .from('signals')
            .select('id')
            .eq('content_hash', contentHash)
            .maybeSingle();

          if (existing) continue;

          // classification already computed above

          // Match to clients based on location keywords
          let matchedClientId: string | null = null;
          if (clients) {
            for (const client of clients) {
              const clientLocations = (client.locations || []).map((l: string) => l.toLowerCase());
              const clientKeywords = (client.monitoring_keywords || []).map((k: string) => k.toLowerCase());
              const alertText = `${alert.title} ${alert.summary}`.toLowerCase();

              const locationMatch = clientLocations.some((loc: string) => alertText.includes(loc));
              const keywordMatch = clientKeywords.some((kw: string) => alertText.includes(kw));

              if (locationMatch || keywordMatch) {
                matchedClientId = client.id;
                break;
              }
            }
          }

          // Create signal
          const { error: signalError } = await supabase
            .from('signals')
            .insert({
              client_id: matchedClientId,
              normalized_text: `[NAAD Emergency Alert] ${alert.title}. ${alert.summary}`,
              category: classification.category,
              severity: classification.severity,
              location: 'Canada',
              content_hash: contentHash,
              raw_json: {
                source: 'naad_emergency_alerts',
                alert_id: alert.id,
                category: alert.category,
                classification: classification,
                url: alert.link || `https://alert.naad-adna.pelmorex.com/${alert.id}`,
                updated: alert.updated,
                feed_summary: alert.summary,
              },
              status: 'new',
              confidence: 0.95,
            });

          if (!signalError) {
            signalsCreated++;
            console.log(`[NAAD] ✓ ${classification.priority.toUpperCase()} alert: ${alert.title.substring(0, 80)}`);
            processedAlerts.push({
              title: alert.title,
              priority: classification.priority,
              category: classification.category,
              client: matchedClientId ? 'matched' : 'unmatched',
            });
          }
        }
      } catch (feedError) {
        console.error(`[NAAD] Error fetching ${feedUrl}:`, feedError);
      }
    }

    if (historyEntry?.id) {
      await completeHistoryEntry(supabase, historyEntry.id, totalAlerts, signalsCreated);
    }

    console.log(`[NAAD] Complete. Scanned ${totalAlerts} alerts, created ${signalsCreated} signals.`);

    return successResponse({
      success: true,
      alerts_scanned: totalAlerts,
      signals_created: signalsCreated,
      sample: processedAlerts.slice(0, 5),
    });

  } catch (error) {
    console.error('[NAAD] Monitor error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (historyEntry?.id) {
      await failHistoryEntry(supabase, historyEntry.id, errorMessage);
    }
    return errorResponse(errorMessage, 500);
  }
});
