import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";

/**
 * NAAD (National Alert Aggregation & Dissemination) Emergency Alert Monitor
 * 
 * Polls Canada's official emergency alert Atom feed.
 * - Filters French-language alerts (keeps English only)
 * - Strips raw XML/HTML from summaries
 * - Deduplicates bilingual pairs using normalized content hashing
 * - Nests updates into existing signals via signal_updates table
 */

interface NAADAlert {
  id: string;
  title: string;
  summary: string;
  updated: string;
  link: string;
  category: string;
  language: string;
}

/** Strip HTML/XML tags and decode entities */
function stripXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')  // Unwrap CDATA
    .replace(/&lt;br\s*\/?&gt;/gi, '. ')             // Encoded <br> tags
    .replace(/<br\s*\/?>/gi, '. ')                   // Literal <br> tags
    .replace(/&lt;[^&]*&gt;/g, ' ')                  // Encoded HTML tags
    .replace(/<[^>]+>/g, ' ')                        // Literal HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\.\s*\./g, '.')                        // Clean double periods
    .replace(/\s+/g, ' ')                            // Collapse whitespace
    .trim();
}

/** Detect French content by title/summary patterns */
function isFrenchAlert(alert: NAADAlert): boolean {
  const text = `${alert.title} ${alert.summary}`.toLowerCase();
  // Explicit language tag
  if (alert.language === 'fr' || alert.language === 'fr-CA') return true;
  // French NAAD patterns
  if (/en vigueur|terminé|annulé|avertissement|avis|bulletin météorologique|spécial/.test(text)) return true;
  if (/\bde\b.*\bla\b.*\bpour\b/.test(text)) return true;
  if (/ceci est un message|n'est pas prévu|distribution au public/.test(text)) return true;
  // French weather terms
  if (/poudrerie|froid|neige|pluie verglaçante|brouillard|tempête/.test(text)) return true;
  return false;
}

/** Extract a normalized "event fingerprint" to group bilingual duplicates and updates */
function getEventFingerprint(alert: NAADAlert): string {
  // NAAD IDs often contain an OID that's shared across bilingual pairs
  // Extract the OID portion: urn:oid:2.49.0.1.124.XXXXXXXXXX.YYYY
  const oidMatch = alert.id.match(/urn[_:]oid[_:]([\d.]+)/);
  if (oidMatch) return oidMatch[1];
  // Fallback: use the full ID stripped of language markers
  return alert.id.replace(/[-_](fr|en)/gi, '');
}

function parseAtomFeed(xmlText: string): NAADAlert[] {
  const alerts: NAADAlert[] = [];
  const entryMatches = xmlText.matchAll(/<entry>([\s\S]*?)<\/entry>/g);

  for (const match of entryMatches) {
    const entryXml = match[1];
    const id = entryXml.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || '';
    const rawTitle = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
    const rawSummary = entryXml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.trim() || '';
    const updated = entryXml.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() || new Date().toISOString();
    const link = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/)?.[1] || '';
    const category = entryXml.match(/<category[^>]*term="([^"]*)"[^>]*\/?>/)?.[1] || 'unknown';
    
    // Try to extract language from xml:lang or content
    const language = entryXml.match(/xml:lang="([^"]*)"/) ?.[1] || 
                     entryXml.match(/lang="([^"]*)"/) ?.[1] || '';

    if (id) {
      alerts.push({
        id,
        title: stripXml(rawTitle),
        summary: stripXml(rawSummary),
        updated,
        link,
        category,
        language,
      });
    }
  }

  return alerts;
}

function classifyAlert(alert: NAADAlert): { category: string; severity: string; priority: string } {
  const text = `${alert.title} ${alert.summary} ${alert.category}`.toLowerCase();

  if (/active shooter|armed person|terrorism|bomb threat|hostage|mass casualty|explosion/.test(text)) {
    return { category: 'active_threat', severity: 'critical', priority: 'p1' };
  }
  if (/amber alert|child abduction|missing.*child/.test(text)) {
    return { category: 'amber_alert', severity: 'critical', priority: 'p1' };
  }
  if (/tornado warning|tsunami warning|earthquake.*major/.test(text)) {
    return { category: 'natural_disaster', severity: 'critical', priority: 'p1' };
  }
  if (/wildfire|forest fire|evacuation|hazardous material|hazmat/.test(text)) {
    return { category: 'environmental', severity: 'high', priority: 'p2' };
  }
  if (/severe thunderstorm warning|blizzard warning|flood warning/.test(text)) {
    return { category: 'weather', severity: 'high', priority: 'p2' };
  }
  if (/civil emergency|emergency alert|public safety/.test(text)) {
    return { category: 'civil_emergency', severity: 'high', priority: 'p2' };
  }
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

    const feedUrl = 'https://rss.naad-adna.pelmorex.com/';

    let totalAlerts = 0;
    let filteredFrench = 0;
    let filteredLowPriority = 0;
    let nestedAsUpdates = 0;
    let signalsCreated = 0;
    const processedAlerts: any[] = [];

    // Fetch all clients for matching
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, locations, monitoring_keywords');

    try {
      console.log(`[NAAD] Fetching feed: ${feedUrl}`);
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': 'Fortress-OSINT-Monitor/1.0' },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Feed returned ${response.status}`);
      }

      const xmlText = await response.text();
      const alerts = parseAtomFeed(xmlText);
      totalAlerts = alerts.length;

      console.log(`[NAAD] Parsed ${alerts.length} alerts`);

      // Track seen event fingerprints to skip bilingual duplicates within this batch
      const seenFingerprints = new Set<string>();

      for (const alert of alerts) {
        // 1. Filter French alerts
        if (isFrenchAlert(alert)) {
          filteredFrench++;
          continue;
        }

        // 2. Filter test messages
        if (/test message|message.test/i.test(alert.title)) {
          continue;
        }

        // 3. Filter low-priority (P4) weather noise
        const classification = classifyAlert(alert);
        if (classification.priority === 'p4') {
          filteredLowPriority++;
          continue;
        }

        // 4. Deduplicate bilingual pairs within this batch
        const fingerprint = getEventFingerprint(alert);
        if (seenFingerprints.has(fingerprint)) {
          continue;
        }
        seenFingerprints.add(fingerprint);

        // 5. Generate content hash using event fingerprint (not raw title)
        const encoder = new TextEncoder();
        const hashData = encoder.encode(`naad|${fingerprint}`);
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

        // 6. Check if a signal with same fingerprint already exists → nest as update
        const { data: existingSignal } = await supabase
          .from('signals')
          .select('id')
          .eq('content_hash', contentHash)
          .maybeSingle();

        if (existingSignal) {
          // Nest as update to existing signal instead of creating duplicate
          const updateHash = `naad_update|${alert.id}|${alert.updated}`;
          const updateHashData = encoder.encode(updateHash);
          const updateHashBuffer = await crypto.subtle.digest('SHA-256', updateHashData);
          const updateHashArray = Array.from(new Uint8Array(updateHashBuffer));
          const updateContentHash = updateHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

          // Check if this exact update already exists
          const { data: existingUpdate } = await supabase
            .from('signal_updates')
            .select('id')
            .eq('content_hash', updateContentHash)
            .maybeSingle();

          if (!existingUpdate) {
            const { error: updateError } = await supabase
              .from('signal_updates')
              .insert({
                signal_id: existingSignal.id,
                content: `[NAAD Update] ${alert.title}. ${alert.summary}`,
                source_name: 'naad_emergency_alerts',
                source_url: alert.link || null,
                content_hash: updateContentHash,
                metadata: {
                  alert_id: alert.id,
                  updated: alert.updated,
                  category: alert.category,
                },
              });

            if (!updateError) {
              nestedAsUpdates++;
              console.log(`[NAAD] ↳ Nested update for existing signal: ${alert.title.substring(0, 60)}`);
            }
          }
          continue;
        }

        // 7. Match to client
        let matchedClientId: string | null = null;
        if (clients) {
          const alertText = `${alert.title} ${alert.summary}`.toLowerCase();
          for (const client of clients) {
            const locs = (client.locations || []).map((l: string) => l.toLowerCase());
            const kws = (client.monitoring_keywords || []).map((k: string) => k.toLowerCase());
            if (locs.some((loc: string) => alertText.includes(loc)) || 
                kws.some((kw: string) => alertText.includes(kw))) {
              matchedClientId = client.id;
              break;
            }
          }
        }

        // 8. Create clean signal
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
              event_fingerprint: fingerprint,
              category: alert.category,
              classification,
              url: alert.link || `https://rss.naad-adna.pelmorex.com/`,
              updated: alert.updated,
            },
            status: 'new',
            confidence: 0.95,
          });

        if (!signalError) {
          signalsCreated++;
          console.log(`[NAAD] ✓ ${classification.priority.toUpperCase()}: ${alert.title.substring(0, 80)}`);
          processedAlerts.push({
            title: alert.title,
            priority: classification.priority,
            category: classification.category,
          });
        }
      }
    } catch (feedError) {
      console.error(`[NAAD] Feed error:`, feedError);
    }

    if (historyEntry?.id) {
      await completeHistoryEntry(supabase, historyEntry.id, totalAlerts, signalsCreated);
    }

    console.log(`[NAAD] Complete. Total: ${totalAlerts}, French filtered: ${filteredFrench}, Low-priority filtered: ${filteredLowPriority}, New signals: ${signalsCreated}, Nested updates: ${nestedAsUpdates}`);

    return successResponse({
      success: true,
      alerts_scanned: totalAlerts,
      french_filtered: filteredFrench,
      low_priority_filtered: filteredLowPriority,
      signals_created: signalsCreated,
      nested_updates: nestedAsUpdates,
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
