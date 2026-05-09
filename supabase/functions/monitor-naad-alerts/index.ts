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
  /** Full CAP XML payload (fetched lazily — only when link is to a .cap file). */
  cap?: CapAlert | null;
}

/**
 * Structured CAP v1.2 fields. The Atom feed only carries title +
 * summary; the actual operational data — event type, severity tier,
 * response type ("Prepare" vs "Evacuate" vs "Shelter"), affected
 * polygon, specific instructions — lives in the linked .cap XML.
 * Until May 2026 the monitor was only consuming the Atom wrapper
 * and discarding all of this. Operator caught a Parkland County
 * wildfire alert that arrived as "[NAAD Emergency Alert] This is an
 * Alberta emergency alert." with no event/severity/response metadata
 * preserved — just the boilerplate header.
 */
interface CapAlert {
  identifier: string | null;
  sender: string | null;
  sent: string | null;
  status: string | null;
  msgType: string | null;
  /** First info block. CAP allows multiple; we use the English-language one. */
  event: string | null;
  category: string | null;
  responseType: string | null;
  urgency: string | null;
  severity: string | null;
  certainty: string | null;
  effective: string | null;
  expires: string | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  /** First area block. */
  areaDesc: string | null;
  /** Polygon ring as [lat, lng] pairs (CAP convention is "lat,lng lat,lng ..."). */
  polygon: Array<[number, number]> | null;
  /** Circle as { center: [lat, lng], radiusKm }. CAP uses "lat,lng radiusKm". */
  circle: { center: [number, number]; radiusKm: number } | null;
}

function captureTag(xml: string, tag: string): string | null {
  // Regex tag-extractor — tolerates attributes on the open tag and
  // doesn't recurse, but CAP XML is flat enough that this works for
  // every field we care about.
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? stripXml(m[1]).trim() || null : null;
}

function parseCapXml(xml: string): CapAlert | null {
  if (!xml || !xml.includes('<alert')) return null;

  // Pick the English info block when multiple are present (NAAD
  // alerts are bilingual; we already filter French at the Atom layer
  // but the CAP can still carry both).
  const infoBlocks = [...xml.matchAll(/<info>([\s\S]*?)<\/info>/g)].map((m) => m[1]);
  const englishInfo = infoBlocks.find((b) => /<language>en[-_]?[A-Z]{0,2}<\/language>/i.test(b))
    ?? infoBlocks[0]
    ?? '';

  // Pick the first area block from the English info.
  const areaMatch = englishInfo.match(/<area>([\s\S]*?)<\/area>/);
  const areaXml = areaMatch ? areaMatch[1] : '';

  // CAP polygon format: "lat,lng lat,lng lat,lng ..." (note: lat first,
  // unlike GeoJSON). Convert to [[lat, lng], ...] pairs.
  let polygon: Array<[number, number]> | null = null;
  const polygonRaw = areaXml.match(/<polygon>([\s\S]*?)<\/polygon>/)?.[1]?.trim();
  if (polygonRaw) {
    const pts: Array<[number, number]> = [];
    for (const pair of polygonRaw.split(/\s+/)) {
      const [latStr, lngStr] = pair.split(',');
      const lat = Number(latStr);
      const lng = Number(lngStr);
      if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng]);
    }
    if (pts.length >= 3) polygon = pts;
  }

  // CAP circle format: "lat,lng radiusKm".
  let circle: CapAlert['circle'] = null;
  const circleRaw = areaXml.match(/<circle>([\s\S]*?)<\/circle>/)?.[1]?.trim();
  if (circleRaw) {
    const parts = circleRaw.split(/\s+/);
    const [latStr, lngStr] = (parts[0] || '').split(',');
    const radiusKm = Number(parts[1]);
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusKm)) {
      circle = { center: [lat, lng], radiusKm };
    }
  }

  return {
    identifier:   captureTag(xml, 'identifier'),
    sender:       captureTag(xml, 'sender'),
    sent:         captureTag(xml, 'sent'),
    status:       captureTag(xml, 'status'),
    msgType:      captureTag(xml, 'msgType'),
    event:        captureTag(englishInfo, 'event'),
    category:     captureTag(englishInfo, 'category'),
    responseType: captureTag(englishInfo, 'responseType'),
    urgency:      captureTag(englishInfo, 'urgency'),
    severity:     captureTag(englishInfo, 'severity'),
    certainty:    captureTag(englishInfo, 'certainty'),
    effective:    captureTag(englishInfo, 'effective'),
    expires:      captureTag(englishInfo, 'expires'),
    senderName:   captureTag(englishInfo, 'senderName'),
    headline:     captureTag(englishInfo, 'headline'),
    description:  captureTag(englishInfo, 'description'),
    instruction:  captureTag(englishInfo, 'instruction'),
    areaDesc:     captureTag(areaXml, 'areaDesc'),
    polygon,
    circle,
  };
}

async function fetchCapXml(link: string): Promise<CapAlert | null> {
  // Atom-level <link> usually points to the .cap or .xml file. Pelmorex
  // also serves capcp2.naad-adna.pelmorex.com URLs (XML CAP files) —
  // those use the .xml extension, not .cap. Accept both.
  if (!link || !/\.(cap|xml)(\?|$)/i.test(link)) return null;
  // Pelmorex's CAP host issues a 301 from http→https. Deno fetch follows
  // redirects by default, but if the upstream cert chain is anything
  // unusual the redirect may silently abort. Upgrade the scheme proactively.
  const httpsLink = link.replace(/^http:\/\//i, 'https://');
  try {
    const r = await fetch(httpsLink, {
      headers: { 'User-Agent': 'Fortress-OSINT-Monitor/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const xml = await r.text();
    return parseCapXml(xml);
  } catch {
    return null;
  }
}

/**
 * Map CAP <event> + <severity> + <responseType> to the Fortress
 * signal taxonomy. Replaces the old regex-on-title classifier
 * which mis-tagged a Wildfire CAP alert as 'environmental' instead
 * of 'wildfire' and inverted CAP severity tiers.
 *
 * CAP severity scale (highest → lowest):
 *   Extreme | Severe | Moderate | Minor | Unknown
 * Fortress severity scale:
 *   critical | high   | medium   | low   | low
 */
function classifyFromCap(cap: CapAlert): { category: string; severity: string; priority: string } {
  const event = (cap.event || '').toLowerCase();
  const responseType = (cap.responseType || '').toLowerCase();
  const capSev = (cap.severity || '').toLowerCase();

  // Severity from CAP tier — direct mapping.
  let severity: string;
  if (capSev === 'extreme') severity = 'critical';
  else if (capSev === 'severe') severity = 'high';
  else if (capSev === 'moderate') severity = 'medium';
  else severity = 'low';

  // Response type bumps severity when an evacuation or shelter order
  // is in effect (those are operational regardless of CAP severity tier).
  if (responseType === 'evacuate' || responseType === 'shelter') {
    if (severity === 'low' || severity === 'medium') severity = 'high';
  }

  // Category from CAP event — direct mapping.
  let category: string;
  if (/wildfire|forest fire/.test(event)) category = 'wildfire';
  else if (/active shooter|terrorism|bomb|hostage/.test(event)) category = 'active_threat';
  else if (/amber alert|child abduction/.test(event)) category = 'amber_alert';
  else if (/tornado|tsunami|earthquake|hurricane|cyclone/.test(event)) category = 'natural_disaster';
  else if (/flood|landslide|avalanche/.test(event)) category = 'natural_disaster';
  else if (/hazmat|hazardous|spill|release/.test(event)) category = 'environmental';
  else if (/storm|blizzard|winter storm|extreme cold|extreme heat|wind warning|fog/.test(event)) category = 'weather';
  else if (/civil emergency|public safety|911/.test(event)) category = 'civil_emergency';
  else category = 'civil_emergency'; // CAP alerts are by definition civil-emergency-class

  // Priority from severity.
  const priority =
    severity === 'critical' ? 'p1'
    : severity === 'high'   ? 'p2'
    : severity === 'medium' ? 'p3'
    : 'p4';

  return { category, severity, priority };
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

        // 3. Fetch the CAP XML for this alert. The Atom-level <link>
        //    points to the .cap file when one's available. Empty/null
        //    when the link surfaces the HTML page instead — we fall
        //    back to the old regex classifier in that case.
        const cap = await fetchCapXml(alert.link);
        if (cap) alert.cap = cap;

        // 4. Classify — prefer CAP-derived structure when available.
        //    The CAP path correctly maps Wildfire→wildfire, Tornado→
        //    natural_disaster, etc., AND honors the CAP severity tier
        //    (Moderate / Severe / Extreme) instead of regex-matching
        //    title text. Falls back to the legacy text classifier
        //    for non-CAP alerts.
        const classification = cap ? classifyFromCap(cap) : classifyAlert(alert);
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

        // 7. Match to client — geographic-first, word-boundary aware.
        //
        // Old logic: substring-includes against (title + summary + areaDesc)
        // for any client location OR keyword. Caused May 5 2026 misattribution
        // where 3 Gaetz Brook NS Civil Emergency NAAD alerts got tagged as
        // Petronas (Petronas keyword "Petronas Canada" → "canada" substring →
        // matched the word "Canada" appearing somewhere in NAAD's generic
        // boilerplate, even though the alert was about a machete in Nova
        // Scotia, 5,000 km from any Petronas asset).
        //
        // New logic:
        //   1. Geography first: cap.areaDesc is the canonical "where" of the
        //      alert. Match client.locations against areaDesc with word-
        //      boundary regex. If areaDesc contains any client location as
        //      a whole word/phrase → match.
        //   2. Keyword fallback: only if geography is silent (no areaDesc),
        //      check client.monitoring_keywords against title+summary,
        //      AND require the keyword to be ≥6 chars (drops "BC" / "PECL"
        //      / "Canada" generic-token false positives).
        let matchedClientId: string | null = null;
        if (clients) {
          const areaDescLower = (cap?.areaDesc ?? '').toLowerCase();
          const titleSummaryLower = `${alert.title} ${alert.summary}`.toLowerCase();

          const wholeWordIncludes = (haystack: string, needle: string): boolean => {
            if (!haystack || !needle) return false;
            // Escape regex metachars in needle, anchor with word boundaries.
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`\\b${esc}\\b`, 'i');
            return re.test(haystack);
          };

          for (const client of clients) {
            const locs = (client.locations || []).map((l: string) => l.toLowerCase().trim()).filter(Boolean);
            const kws = (client.monitoring_keywords || []).map((k: string) => k.toLowerCase().trim()).filter(Boolean);

            // Geography-first match
            if (areaDescLower && locs.some((loc: string) => wholeWordIncludes(areaDescLower, loc))) {
              matchedClientId = client.id;
              break;
            }
            // Keyword fallback — only proper-noun-y keywords (≥6 chars), only
            // if title/summary has them. Skip if areaDesc was non-empty
            // because we trust geography over keyword in NAAD context.
            if (!areaDescLower) {
              const properKws = kws.filter((k: string) => k.length >= 6);
              if (properKws.some((kw: string) => wholeWordIncludes(titleSummaryLower, kw))) {
                matchedClientId = client.id;
                break;
              }
            }
          }
        }

        // 7.5 Geographic / relevance gate — skip out-of-area NAAD
        // alerts that don't touch any client zone. NAAD broadcasts
        // every Canadian emergency alert; without this gate the feed
        // floods with Yukon flood watches, Nova Scotia missing-child
        // alerts, Manitoba weather, Quebec wind, etc. — operationally
        // irrelevant to BC-based clients (Petronas Canada, BCCH).
        //
        // Override: CAP severity = "Extreme" alerts pass through with
        // client_id=null as platform-level life-safety notices. We
        // never silently drop genuine life-or-death alerts even if
        // they're outside client zones — operators may want to know
        // about a major event nearby that their clients haven't
        // explicitly subscribed to.
        const isLifeSafetyExtreme = (cap?.severity || '').toLowerCase() === 'extreme';
        if (!matchedClientId && !isLifeSafetyExtreme) {
          filteredLowPriority++;
          console.log(`[NAAD] Skipping out-of-area alert: "${alert.title.substring(0, 70)}" (severity=${cap?.severity ?? '?'}, areaDesc=${cap?.areaDesc?.substring(0, 60) ?? '?'})`);
          continue;
        }

        // 8. Create clean signal
        // We bypass ingest-signal to preserve the bilingual content-hash dedup
        // applied above. After insert, fire-and-forget ai-decision-engine so the
        // signal still gets composite_confidence + agent_review enrichment that
        // ingest-signal would normally trigger. Without this, NAAD signals
        // entered the feed without AI context (caught by watchdog 2026-04-30).
        // Build the normalized_text from the most specific source
        // available. CAP-derived alerts get the senderName + headline +
        // description + instruction concatenated, which is roughly an
        // order of magnitude more useful than the Atom title +
        // summary (which often reads just "This is an Alberta
        // emergency alert."). Atom-only alerts keep the old format
        // as fallback.
        const normalizedText = cap
          ? [
              `[NAAD ${cap.msgType ?? 'Alert'}] ${cap.senderName ?? cap.sender ?? 'Unknown sender'}`,
              cap.headline ? `Headline: ${cap.headline}` : null,
              cap.event ? `Event: ${cap.event}` : null,
              cap.severity || cap.urgency || cap.responseType
                ? `CAP: severity=${cap.severity ?? '—'}, urgency=${cap.urgency ?? '—'}, responseType=${cap.responseType ?? '—'}`
                : null,
              cap.areaDesc ? `Area: ${cap.areaDesc}` : null,
              cap.description ? `Description: ${cap.description}` : null,
              cap.instruction ? `Instruction: ${cap.instruction}` : null,
              cap.effective ? `Effective: ${cap.effective}` : null,
              cap.expires ? `Expires: ${cap.expires}` : null,
            ].filter(Boolean).join('\n')
          : `[NAAD Emergency Alert] ${alert.title}. ${alert.summary}`;

        const { data: insertedSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            client_id: matchedClientId,
            // 2026-05-08: source_id populated for watchdog source-coverage
            // tracking. Maps to public.sources WHERE name='NAAD Alerts'.
            source_id: '8b708b40-36d6-497e-bef1-4a50e86ac719',
            normalized_text: normalizedText,
            category: classification.category,
            severity: classification.severity,
            location: cap?.areaDesc ?? 'Canada',
            content_hash: contentHash,
            source_url: alert.link || 'https://alerts.pelmorex.com/',
            event_date: cap?.effective ?? null,
            raw_json: {
              source: 'naad_emergency_alerts',
              alert_id: alert.id,
              event_fingerprint: canonical,
              category: alert.category,
              classification,
              url: alert.link || `https://alerts.pelmorex.com/`,
              updated: alert.updated,
              // Structured CAP fields — preserved verbatim so
              // downstream consumers (agents, briefing builder, the
              // wildfire portal) can use them without re-parsing the
              // Atom title.
              cap: cap
                ? {
                    identifier:    cap.identifier,
                    sender:        cap.sender,
                    sender_name:   cap.senderName,
                    sent:          cap.sent,
                    status:        cap.status,
                    msg_type:      cap.msgType,
                    event:         cap.event,
                    cap_category:  cap.category,
                    response_type: cap.responseType,
                    urgency:       cap.urgency,
                    severity:      cap.severity,
                    certainty:     cap.certainty,
                    effective:     cap.effective,
                    expires:       cap.expires,
                    headline:      cap.headline,
                    description:   cap.description,
                    instruction:   cap.instruction,
                    area_desc:     cap.areaDesc,
                    polygon:       cap.polygon,
                    circle:        cap.circle,
                  }
                : null,
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
