import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// TIER 1 — Direct entity/project match. Any single hit → send to AI gate.
const TIER1_KEYWORDS = [
  // Entity names — direct
  'petronas', 'petronas canada', 'pecl', 'petroliam nasional',
  // Projects and infrastructure
  'lng canada', 'coastal gaslink', 'cgl', 'cedar lng', 'ksi lisims lng',
  'prince rupert gas', 'woodfibre lng', 'bc lng terminal',
  // Indigenous groups active on these projects
  "wet'suwet'en", "wetsuweten", "gidimt'en", "gitdumt'en", "unist'ot'en",
  // Activist groups targeting LNG Canada
  'stand.earth', 'dogwood bc', 'dogwood initiative', 'frack free bc',
  // Pipeline/LNG terms
  'lng export', 'bc lng', 'liquefied natural gas bc', 'natural gas export canada',
  'pipeline protest', 'pipeline opposition', 'pipeline injunction',
  'energy infrastructure bc', 'alberta energy infrastructure',
  // Regulatory bodies that govern PETRONAS operations
  'canada energy regulator', 'cer pipeline', 'national energy board',
  'bc energy regulator', 'bcer', 'bc oil gas commission',
  'environmental assessment office bc', 'bc eao',
  // LNG industry broad
  'lng industry canada', 'canadian lng', 'lng terminal bc',
  'natural gas canada', 'canadian natural gas', 'gas export terminal',
  // Labour and operational
  'lng canada workers', 'pipeline workers strike', 'energy sector strike canada',
  'kitimat workers', 'lng construction',
];

// TIER 2A — Geographic scope: PETRONAS asset areas + BC broadly.
const TIER2_GEO = [
  // Core asset areas
  'fort st. john', 'peace region', 'northeast bc', 'dawson creek',
  'kitimat', 'prince rupert', 'northwest bc',
  'coastal gaslink corridor', 'highway 16', 'stewart-cassiar',
  'peace river', 'liard river',
  // Broader BC/Alberta energy geography
  'british columbia', 'bc government', 'victoria bc', 'alberta energy',
  'edmonton', 'calgary energy', 'northern bc', 'interior bc',
  'skeena', 'bulkley valley', 'terrace bc', 'smithers bc',
];

// TIER 2B — Threat types and business intelligence events.
// An article must hit BOTH a Tier 2A geo term AND a Tier 2B threat term to qualify.
const TIER2_THREAT = [
  // Physical / operational threats
  'wildfire bc', 'wildfire alberta', 'evacuation order bc', 'evacuation alert bc',
  'flood warning bc', 'avalanche bc', 'extreme weather bc',
  'pipeline explosion', 'pipeline rupture', 'pipeline fire', 'pipeline leak',
  'protest blockade bc', 'rail blockade bc', 'highway blockade bc',
  'indigenous land defenders', 'injunction bc', 'court injunction',
  'industrial accident bc', 'worker fatality bc', 'hse incident bc',
  'power outage bc', 'grid failure bc', 'infrastructure damage',
  // Business / regulatory intelligence
  'energy policy', 'energy regulation', 'environmental approval', 'environmental review',
  'indigenous consultation', 'first nations agreement', 'treaty negotiation',
  'carbon tax', 'emissions regulation', 'clean energy policy',
  'export permit', 'regulatory approval', 'project approval',
  'investment', 'joint venture', 'partnership', 'acquisition energy',
  'quarterly results energy', 'financial results lng', 'earnings energy',
  'security incident', 'cyber attack energy', 'critical infrastructure',
  'labour dispute', 'strike energy', 'union negotiation',
];

// Direct Canadian news RSS feeds — replaces Google News RSS which blocks cloud/datacenter IPs
const CANADIAN_NEWS_FEEDS = [
  { name: 'CBC Top Stories',         url: 'https://www.cbc.ca/cmlink/rss-topstories' },
  { name: 'CBC Business',            url: 'https://www.cbc.ca/cmlink/rss-business' },
  { name: 'CBC Canada',              url: 'https://www.cbc.ca/cmlink/rss-canada' },
  { name: 'CBC British Columbia',    url: 'https://www.cbc.ca/cmlink/rss-canada-britishcolumbia' },
  { name: 'Globe and Mail Business', url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/' },
  { name: 'Financial Post',          url: 'https://financialpost.com/feed' },
  { name: 'Reuters Canada',          url: 'https://feeds.reuters.com/reuters/CATopNews' },
  { name: 'Reuters Energy',          url: 'https://feeds.reuters.com/reuters/businessNews' },
  { name: 'Natural Resources Canada', url: 'https://natural-resources.canada.ca/api/news/en.rss' },
];

// Extract a field from an RSS item, handling both CDATA and plain text
function extractField(itemXml: string, tag: string): string {
  const m = itemXml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`));
  if (!m) return '';
  const raw = m[0].slice(tag.length + 2, -(tag.length + 3));
  return raw.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Create monitoring history entry
    const { data: historyEntry, error: historyError } = await supabase
      .from('monitoring_history')
      .insert({
        source_name: 'News Monitor',
        status: 'running',
        scan_metadata: { sources: CANADIAN_NEWS_FEEDS.map(f => f.name) }
      })
      .select()
      .single();

    if (historyError) {
      console.error('Failed to create monitoring history:', historyError);
    }

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, industry, monitoring_keywords');

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);
    console.log(`[KEYWORDS] Tier1: ${TIER1_KEYWORDS.length} terms | Tier2 geo: ${TIER2_GEO.length} | Tier2 threat: ${TIER2_THREAT.length}`);
    for (const client of clients || []) {
      console.log(`  CLIENT: "${client.name}"`);
    }

    let signalsCreated = 0;

    // Stage counters
    const stage = {
      feeds_attempted: 0,
      feeds_http_ok: 0,
      feeds_http_error: 0,
      items_from_rss: 0,
      items_too_old: 0,
      items_no_parse: 0,
      items_short_content: 0,
      items_no_keyword_match: 0,
      items_tier1_match: 0,
      items_tier2_match: 0,
      items_sent_to_ingest: 0,
      ingest_accepted: 0,
      ingest_rejected: 0,
      ingest_suppressed: 0,
      ingest_filed_as_update: 0,
      ingest_error: 0,
      ingest_unknown: 0,
    };

    const cutoffMs = Date.now() - 48 * 60 * 60 * 1000;
    console.log(`[CONFIG] Feeds: ${CANADIAN_NEWS_FEEDS.length} | 48h cutoff: ${new Date(cutoffMs).toISOString()}`);

    for (let fi = 0; fi < CANADIAN_NEWS_FEEDS.length; fi++) {
      const feed = CANADIAN_NEWS_FEEDS[fi];
      stage.feeds_attempted++;
      let feedItems = 0;
      let feedPassed = 0;
      let feedMatched = 0;

      try {
        const response = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 OSINT Monitor' },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          stage.feeds_http_error++;
          console.log(`[FEED ${fi + 1}/${CANADIAN_NEWS_FEEDS.length}] "${feed.name}" → HTTP ${response.status} ${response.statusText} — SKIPPED`);
          continue;
        }

        stage.feeds_http_ok++;
        const xmlText = await response.text();
        const itemMatches = [...xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g)];
        feedItems = itemMatches.length;
        stage.items_from_rss += feedItems;

        console.log(`[FEED ${fi + 1}/${CANADIAN_NEWS_FEEDS.length}] "${feed.name}" → HTTP ${response.status} → ${feedItems} items in XML`);

        for (const match of itemMatches) {
          const itemXml = match[1];

          const title = extractField(itemXml, 'title');
          const rawLink = extractField(itemXml, 'link');
          const rawDescription = extractField(itemXml, 'description');
          const pubDate = extractField(itemXml, 'pubDate');

          if (!title) {
            stage.items_no_parse++;
            continue;
          }

          // Filter to last 24 hours
          if (pubDate) {
            const ts = new Date(pubDate).getTime();
            if (!isNaN(ts) && ts < cutoffMs) {
              stage.items_too_old++;
              continue;
            }
          }

          const description = rawDescription.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

          if (description.length < 40 && title.length < 20) {
            stage.items_short_content++;
            console.log(`  [SHORT] "${title.substring(0, 60)}" | desc:${description.length}chars`);
            continue;
          }

          feedPassed++;
          const validLink = rawLink.startsWith('http') ? rawLink : '';
          const fullContent = `${title}\n\n${description}`.toLowerCase();

          // Two-tier keyword matching:
          // Tier 1 — any direct entity/project hit passes immediately.
          // Tier 2 — requires BOTH a geo hit AND a threat-type hit (prevents "Kitimat fishing tournament").
          const tier1Hits = TIER1_KEYWORDS.filter(kw => fullContent.includes(kw));
          const tier2GeoHits = TIER2_GEO.filter(kw => fullContent.includes(kw));
          const tier2ThreatHits = TIER2_THREAT.filter(kw => fullContent.includes(kw));

          const tier1Match = tier1Hits.length > 0;
          const tier2Match = tier2GeoHits.length > 0 && tier2ThreatHits.length > 0;

          if (!tier1Match && !tier2Match) {
            stage.items_no_keyword_match++;
            continue;
          }

          const matchedTier = tier1Match ? 'tier1' : 'tier2';
          const matchedKeywords = tier1Match
            ? tier1Hits
            : [...tier2GeoHits, ...tier2ThreatHits];

          if (tier1Match) stage.items_tier1_match++;
          else stage.items_tier2_match++;

          // Assign to the first client (Petronas Canada) — expand when multi-client needed
          const matchedClient = (clients || [])[0];
          if (!matchedClient) {
            stage.items_no_keyword_match++;
            continue;
          }

          feedMatched++;
          stage.items_sent_to_ingest++;
          const signalText = `${title}\n\n${description.slice(0, 1000)}`;
          console.log(`  [→ INGEST][${matchedTier}] "${title.substring(0, 70)}" | matched:${matchedKeywords.slice(0, 4).join(', ')} | url:${validLink || 'none'}`);

          try {
            const ingestResult = await supabase.functions.invoke('ingest-signal', {
              body: {
                text: signalText,
                ...(validLink && { source_url: validLink }),
                client_id: matchedClient.id,
                raw_json: {
                  source: 'canadian_news_rss',
                  feed_name: feed.name,
                  ...(validLink && { source_url: validLink }),
                  description,
                  matched_keywords: matchedKeywords,
                  matched_client: matchedClient.name,
                  matched_tier: matchedTier,
                },
              },
            });

            if (ingestResult.error) {
              stage.ingest_error++;
              console.error(`  [INGEST ERROR]:`, ingestResult.error);
              continue;
            }

            const ingestData = ingestResult.data as any;
            const ingestStatus = ingestData?.status || 'unknown';
            const detail = ingestData?.reason || ingestData?.detail || ingestData?.message || '';

            if (ingestStatus === 'rejected') {
              stage.ingest_rejected++;
              console.log(`  [INGEST:rejected] score:${ingestData?.relevance_score ?? '?'} | ${detail} | "${title.substring(0, 50)}"`);
            } else if (ingestStatus === 'suppressed') {
              stage.ingest_suppressed++;
              console.log(`  [INGEST:suppressed/dedup] ${detail} | "${title.substring(0, 50)}"`);
            } else if (ingestStatus === 'filed_as_update') {
              stage.ingest_filed_as_update++;
              console.log(`  [INGEST:filed_as_update] ${detail} | "${title.substring(0, 50)}"`);
            } else if (ingestData?.signal_id || ingestStatus === 'enqueued' || ingestStatus === 'critical_processed') {
              stage.ingest_accepted++;
              signalsCreated++;
              console.log(`  [INGEST:accepted] status:${ingestStatus} | signal_id:${ingestData?.signal_id || 'batch'} | "${title.substring(0, 60)}"`);
            } else {
              stage.ingest_unknown++;
              console.log(`  [INGEST:unknown] status:${ingestStatus} | ${detail} | "${title.substring(0, 50)}"`);
            }
          } catch (err) {
            stage.ingest_error++;
            console.error(`  [INGEST ERROR] threw:`, err);
          }
        }

        console.log(`  [FEED DONE] "${feed.name}": ${feedItems} items → ${feedPassed} passed age/content filters → ${feedMatched} keyword matches`);

      } catch (err) {
        stage.feeds_http_error++;
        console.error(`[FEED ${fi + 1}/${CANADIAN_NEWS_FEEDS.length}] "${feed.name}" → fetch threw:`, err);
      }
    }

    console.log(`
=== NEWS MONITOR PIPELINE SUMMARY ===
Feeds attempted:           ${stage.feeds_attempted}
  HTTP OK:                 ${stage.feeds_http_ok}
  HTTP errors/throws:      ${stage.feeds_http_error}
RSS items total:           ${stage.items_from_rss}
  Too old (>24h):          ${stage.items_too_old}
  Failed to parse:         ${stage.items_no_parse}
  Content too short:       ${stage.items_short_content}
  No keyword match:        ${stage.items_no_keyword_match}
  Tier 1 match (entity):   ${stage.items_tier1_match}
  Tier 2 match (geo+threat):${stage.items_tier2_match}
  Sent to ingest-signal:   ${stage.items_sent_to_ingest}
    Accepted (created):        ${stage.ingest_accepted}
    Rejected (AI gate):        ${stage.ingest_rejected}
    Suppressed (dedup):        ${stage.ingest_suppressed}
    Filed as update:           ${stage.ingest_filed_as_update}
    Errors:                    ${stage.ingest_error}
    Unknown status:            ${stage.ingest_unknown}
======================================`);

    if (historyEntry) {
      await supabase
        .from('monitoring_history')
        .update({
          status: 'completed',
          scan_completed_at: new Date().toISOString(),
          items_scanned: stage.items_from_rss,
          signals_created: signalsCreated,
          scan_metadata: {
            sources: CANADIAN_NEWS_FEEDS.map(f => f.name),
            clients_scanned: clients?.length || 0,
            pipeline: stage,
          }
        })
        .eq('id', historyEntry.id);
    }

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      feeds_scanned: stage.feeds_http_ok,
      items_from_rss: stage.items_from_rss,
      items_tier1_match: stage.items_tier1_match,
      items_tier2_match: stage.items_tier2_match,
      items_sent_to_ingest: stage.items_sent_to_ingest,
      signals_created: signalsCreated,
      stage,
      source: 'canadian-news-rss',
    });

  } catch (error) {
    console.error('Error in news monitoring:', error);

    const supabase = createServiceClient();

    try {
      const { data: failedEntry } = await supabase
        .from('monitoring_history')
        .select('id')
        .eq('source_name', 'News Monitor')
        .eq('status', 'running')
        .order('scan_started_at', { ascending: false })
        .limit(1)
        .single();

      if (failedEntry) {
        await supabase
          .from('monitoring_history')
          .update({
            status: 'failed',
            scan_completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', failedEntry.id);
      }
    } catch (updateError) {
      console.error('Failed to update monitoring history:', updateError);
    }

    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
