import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createHistoryEntry, completeHistoryEntry, failHistoryEntry } from "../_shared/monitoring-history.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { enqueueJob } from "../_shared/queue.ts";

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

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeNumericEntities(input: string): string {
  if (!input) return '';

  return input
    // Decimal entities: &#8217;
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      if (!Number.isFinite(code)) return _m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _m;
      }
    })
    // Hex entities: &#x2019;
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(String(hex), 16);
      if (!Number.isFinite(code)) return _m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return _m;
      }
    });
}

function stripXml(text: string): string {
  if (!text) return "";

  return decodeNumericEntities(text)
    // Unwrap CDATA
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")

    // Decode entities (do &amp; first so &amp;lt; becomes &lt;)
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")

    // Normalize line breaks
    .replace(/<br\s*\/?>/gi, ". ")

    // Strip any remaining tags (including decoded CAP/XML)
    .replace(/<[^>]+>/g, " ")

    // Clean up whitespace/punctuation
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/** Detect French content by title/summary patterns */
function isFrenchAlert(alert: NAADAlert): boolean {
  const text = `${alert.title} ${alert.summary}`.toLowerCase();
  // Explicit language tag
  if (alert.language === 'fr' || alert.language === 'fr-ca') return true;

  // Strong French NAAD patterns
  if (/\balerte\b|en vigueur|terminé|annulé|annulée|avertissement|avis|bulletin météorologique|spécial|mise à jour|urgence/.test(text)) return true;
  if (/\bceci est un message\b|n'est pas prévu|distribution au public/.test(text)) return true;

  // Common French connector words in NAAD boilerplate
  if (/\bde\b.*\bla\b.*\bpour\b/.test(text)) return true;

  // French weather terms
  if (/poudrerie|froid|neige|pluie verglaçante|brouillard|tempête/.test(text)) return true;

  return false;
}

function getFingerprintCandidates(alert: NAADAlert): { canonical: string; candidates: string[] } {
  const text = `${alert.title} ${alert.summary}`;

  // Extract the CAP issuing authority (e.g., "BCRCMP")
  const capAuthorityMatch = text.match(/Originated from CAP Alert:\s*([A-Za-z0-9]+)/i);
  const authority = capAuthorityMatch?.[1]?.toUpperCase() || '';

  // Normalize the event type by stripping status prefixes like Cancelled/Updated/Amended
  const eventType = alert.title
    .replace(/^\s*(cancel+ed|cancel+led)\s+/i, '')
    .replace(/^\s*updated?\s+/i, '')
    .replace(/^\s*amended?\s+/i, '')
    .replace(/^\s*(cancellation of|cancelation of)\s+/i, '')
    .trim()
    .toLowerCase();

  const authorityEventType = authority ? `${authority}|${eventType}` : '';

  // CAP event identifier often appears as the 3rd value after "Originated from CAP Alert:".
  // Example: "Originated from CAP Alert: BCRCMP, 2026-..., 426A44E9-..."
  const capEventIdMatch = text.match(/Originated from CAP Alert:\s*[^,]+,\s*[^,]+,\s*([A-Za-z0-9_-]+)/i);
  const capEventId = capEventIdMatch?.[1]?.trim() || '';

  // NAAD OIDs (shared across bilingual pairs and often across updates)
  const oidMatch = alert.id.match(/urn[_:]oid[_:]([\d.]+)/i);
  const oid = oidMatch?.[1] || '';

  // Final fallback: ID stripped of language markers
  const cleanedId = alert.id.replace(/[-_](fr|en)/gi, '');

  // Canonical: prefer the existing (authority|eventType) scheme when available
  // to avoid breaking dedupe against previously-ingested signals.
  const canonical = authorityEventType || capEventId || oid || cleanedId;

  const candidates: string[] = [];
  const pushUnique = (v: string) => {
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  pushUnique(canonical);
  pushUnique(authorityEventType);
  pushUnique(capEventId);
  pushUnique(oid);
  pushUnique(cleanedId);

  return { canonical, candidates };
}

function getEventFingerprint(alert: NAADAlert): string {
  return getFingerprintCandidates(alert).canonical;
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
  const hb = await startHeartbeat(supabase, 'monitor-naad-alerts-15min');

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
        // Process oldest→newest so we create the original signal first, then nest later updates.
        alerts.sort((a, b) => new Date(a.updated).getTime() - new Date(b.updated).getTime());
        totalAlerts = alerts.length;

        console.log(`[NAAD] Parsed ${alerts.length} alerts`);

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

        // 4. Generate fingerprint candidates + hashes (lets us match older signals even if
        // some feed entries omit CAP authority lines, OIDs, etc.)
        const { canonical, candidates } = getFingerprintCandidates(alert);
        const candidateHashes = await Promise.all(
          candidates.map((fp) => sha256Hex(`naad|${fp}`))
        );

        // Use the canonical fingerprint for any newly-created signal
        const contentHash = candidateHashes[0];

        // Check rejected hashes (match against ANY candidate hash)
        const { data: rejected } = await supabase
          .from('rejected_content_hashes')
          .select('id')
          .in('content_hash', candidateHashes)
          .limit(1)
          .maybeSingle();

        if (rejected) continue;

        // 5. Check if a signal with any candidate fingerprint already exists → nest as update
        const { data: existingSignal } = await supabase
          .from('signals')
          .select('id, normalized_text, created_at')
          .in('content_hash', candidateHashes)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        const wouldBeSignalText = `[NAAD Emergency Alert] ${alert.title}. ${alert.summary}`;
        const normalizeForDedupe = (t: string) =>
          t
            .toLowerCase()
            .replace(/https?:\/\/\S+/g, " ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (existingSignal) {
          // Only store an update if it adds new information (not a reprint of the same text)
          if (normalizeForDedupe(existingSignal.normalized_text || '') === normalizeForDedupe(wouldBeSignalText)) {
            continue;
          }

          // Dedupe updates by their cleaned content (NOT timestamps/IDs) so reruns don't flood updates
          const updateText = `[NAAD Update] ${alert.title}. ${alert.summary}`;
          const encoder = new TextEncoder();
          const updateHashData = encoder.encode(`naad_update|${existingSignal.id}|${normalizeForDedupe(updateText)}`);
          const updateHashBuffer = await crypto.subtle.digest('SHA-256', updateHashData);
          const updateHashArray = Array.from(new Uint8Array(updateHashBuffer));
          const updateContentHash = updateHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

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
                content: updateText,
                source_name: 'naad_emergency_alerts',
                source_url: alert.link || `https://alerts.pelmorex.com/`,
                content_hash: updateContentHash,
                  metadata: {
                    alert_id: alert.id,
                    updated: alert.updated,
                    category: alert.category,
                    event_fingerprint: canonical,
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
        // We bypass ingest-signal to preserve the bilingual content-hash dedup
        // applied above. After insert, fire-and-forget ai-decision-engine so the
        // signal still gets composite_confidence + agent_review enrichment that
        // ingest-signal would normally trigger. Without this, NAAD signals
        // entered the feed without AI context (caught by watchdog 2026-04-30).
        const { data: insertedSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            client_id: matchedClientId,
            normalized_text: `[NAAD Emergency Alert] ${alert.title}. ${alert.summary}`,
            category: classification.category,
            severity: classification.severity,
            location: 'Canada',
            content_hash: contentHash,
            source_url: alert.link || 'https://alerts.pelmorex.com/',
            raw_json: {
              source: 'naad_emergency_alerts',
              alert_id: alert.id,
              event_fingerprint: canonical,
              category: alert.category,
              classification,
              url: alert.link || `https://alerts.pelmorex.com/`,
              updated: alert.updated,
            },
            status: 'new',
            confidence: 0.95,
          })
          .select('id')
          .single();

        if (!signalError && insertedSignal?.id) {
          signalsCreated++;
          console.log(`[NAAD] ✓ ${classification.priority.toUpperCase()}: ${alert.title.substring(0, 80)}`);
          processedAlerts.push({
            title: alert.title,
            priority: classification.priority,
            category: classification.category,
          });
          // Enqueue durable async job rather than fire-and-forget. The worker
          // drains function_jobs every minute with retry on failure. This
          // replaces a fragile supabase.functions.invoke().catch() pattern that
          // was being killed by Edge runtime teardown after monitor-naad-alerts
          // returned. idempotency_key prevents duplicate enqueues if NAAD
          // re-processes the same alert.
          await enqueueJob(supabase, {
            type: 'ai-decision-engine',
            payload: { signal_id: insertedSignal.id, force_ai: classification.severity === 'high' || classification.severity === 'critical' },
            idempotencyKey: `ai-decision-engine:${insertedSignal.id}`,
          }).catch((err: any) => console.warn('[NAAD] enqueueJob failed:', err?.message || err));
        }
      }
    } catch (feedError) {
      console.error(`[NAAD] Feed error:`, feedError);
    }

    if (historyEntry?.id) {
      await completeHistoryEntry(supabase, historyEntry.id, totalAlerts, signalsCreated);
    }

    await completeHeartbeat(supabase, hb, {
      alerts_scanned: totalAlerts,
      french_filtered: filteredFrench,
      low_priority_filtered: filteredLowPriority,
      signals_created: signalsCreated,
      nested_updates: nestedAsUpdates,
    });

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
    await failHeartbeat(supabase, hb, error);
    return errorResponse(errorMessage, 500);
  }
});
