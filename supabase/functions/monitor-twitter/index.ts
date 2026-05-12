import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

/**
 * Twitter/X monitor — uses Twitter API v2 recent search when
 * TWITTER_BEARER_TOKEN is set, otherwise no-ops (Google CSE cannot
 * reliably index x.com posts since 2023).
 *
 * Free tier limits: 1 request per 15 min per app, 500k tweet reads/month.
 * Strategy: pack everything into 2 queries per run —
 *   Query A: person entity names + threat/harassment terms
 *   Query B: client campaign keywords + activism terms
 */

const TWITTER_SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";

// Hard threat/targeting terms for person monitoring
const PERSON_THREAT_TERMS = [
  "threat", "harass", "dox", "doxx", "doxxing", "doxxed",
  "\"home address\"", "\"personal information\"", "\"personal details\"",
  "\"find them\"", "protest", "\"at risk\""
];

// Wildfire ops zone — same canonical list used by monitor-wildfires for
// client filtering. Twitter Query C only fires for clients with at least
// one location matching this list, which scopes early-warning fire
// coverage to NE BC / Skeena / Calgary energy operations rather than
// every client globally.
const ZONE_LOCATION_KEYWORDS = [
  'fort st. john', 'fort st john', 'fort nelson', 'dawson creek',
  'chetwynd', 'tumbler ridge', 'montney', 'peace river',
  'kitimat', 'terrace', 'prince rupert', 'calgary',
];

// Situational terms catch local-news wildfire / evacuation / smoke
// coverage that lacks the activism vocabulary Query B requires.
const SITUATIONAL_TERMS = [
  'wildfire', 'fire', 'evacuation', 'smoke',
  '"fire ban"', '"evacuation alert"', '"evacuation order"',
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  // Heartbeat job_name must match the cron name (monitor-twitter-30min)
  // per CLAUDE.md naming-alignment rule.
  const hb = await startHeartbeat(supabase, "monitor-twitter-30min");

  try {
    const bearerToken = Deno.env.get("TWITTER_BEARER_TOKEN");

    if (!bearerToken) {
      console.log("[TwitterMonitor] No TWITTER_BEARER_TOKEN configured — skipping");
      await completeHeartbeat(supabase, hb, {
        signals_created: 0,
        skipped: true,
        reason: "no_bearer_token",
      });
      return successResponse({ success: true, message: "No bearer token configured", signals_created: 0 });
    }

    // Fetch all actively monitored person entities
    const { data: personEntities, error: entErr } = await supabase
      .from("entities")
      .select("id, name, type, client_id, attributes")
      .eq("active_monitoring_enabled", true)
      .eq("type", "person");

    if (entErr) throw entErr;

    // Fetch clients for campaign monitoring (status='active' only — matches
    // the 2026-05-11 sweep across keyword-driven monitors).
    const { data: clients, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, monitoring_keywords")
      .eq("status", "active");

    if (clientErr) throw clientErr;

    const persons = personEntities || [];
    const clientList = clients || [];

    let signalsCreated = 0;
    let tweetsProcessed = 0;
    let conversationsExpanded = 0;
    let replySignals = 0;
    // Collect high-reply tweets from each query for conversation
    // expansion at the end. Comments are where activist coordination
    // happens — the parent tweet is often news, replies are the plan.
    const conversationCandidates: Tweet[] = [];
    const expandedConversationIds = new Set<string>();

    // ═══ QUERY A: Person threat monitoring ═══
    // Build one OR query from all monitored person names.
    //
    // 2026-05-12 hardening — Twitter API v2 rejected the query with HTTP 400
    // when an entity name contained punctuation like "-" or "(" (e.g.
    // "François Poirier - TC Energy President and CEO"). Same name was
    // also stored 3x as separate entity records, causing redundant OR
    // terms. Both inflated the query past 1024 chars OR triggered a parse
    // error that the function silently swallowed.
    //
    // Sanitisation now:
    //   1. Strip characters Twitter's query parser doesn't accept inside
    //      quoted phrases (hyphens, parens, brackets, slashes, etc.).
    //   2. Drop names > 50 chars — those are role descriptors, not names.
    //   3. Dedupe (case-insensitive) within the OR list.
    const sanitizeName = (name: string): string | null => {
      if (!name || typeof name !== "string") return null;
      // Allow letters, digits, spaces, apostrophes, accented chars. Drop everything else.
      const cleaned = name
        .replace(/[-()\[\]{}\/\\<>@#$%&*+=|;:,.!?_]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (cleaned.length < 2 || cleaned.length > 50) return null;
      return cleaned;
    };
    const sanitisedNames = (() => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of persons as any[]) {
        const c = sanitizeName(p.name);
        if (!c) continue;
        const key = c.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }
      return out;
    })();
    if (sanitisedNames.length > 0) {
      // Names stay quoted (exact-phrase match — names need precision).
      const nameTerms = sanitisedNames.map(n => `"${n}"`).join(" OR ");
      const threatOR = PERSON_THREAT_TERMS.slice(0, 8).join(" OR ");

      // 2026-05-12 tuning: dropped `lang:en` because Quebec / Acadian /
      // Indigenous-language activist communities tweet in French and
      // partial-French — the AI relevance gate at ingest filters out
      // genuinely-irrelevant non-English content downstream.
      const query = `(${nameTerms}) (${threatOR}) -is:retweet`;
      const truncated = query.length > 1000 ? query.substring(0, 1000) + ")" : query;

      console.log(`[TwitterMonitor] Person threat query (${truncated.length} chars): ${truncated.substring(0, 120)}...`);

      const tweets = await searchRecentTweets(bearerToken, truncated, 25);

      for (const tweet of tweets) {
        const result = await ingestTweet(supabase, tweet, persons, null, "person_threat");
        if (result) signalsCreated++;
        tweetsProcessed++;
        // Track high-reply candidates for conversation expansion
        if ((tweet.public_metrics?.reply_count ?? 0) >= 3 && tweet.conversation_id) {
          conversationCandidates.push(tweet);
        }
      }

      console.log(`[TwitterMonitor] Person threat query: ${tweets.length} tweets, ${signalsCreated} signals`);
    }

    // ═══ QUERY B: Client campaign monitoring ═══
    //
    // 2026-05-12 tuning: previous version wrapped every keyword in quotes,
    // which forced exact-phrase match and missed the way activism actually
    // shows up on X — hashtags (#LNGCanada, #StopCGL) and looser word
    // co-occurrence ("Coastal" + "GasLink" in a sentence, not the verbatim
    // phrase). Now we mix three forms:
    //   - Multi-word entity names → keep quoted (e.g. "Coastal GasLink")
    //   - Short keywords / single words → unquoted (broader match)
    //   - Common protest hashtags → explicit (Twitter indexes these)
    // Also dropped `lang:en` so French + Indigenous-language activism
    // reaches the AI relevance gate downstream.
    const allClientKeywords: string[] = [];
    for (const client of clientList) {
      const kws: string[] = client.monitoring_keywords || [];
      const filtered = kws.filter((k: string) => k.length > 6).slice(0, 5);
      allClientKeywords.push(...filtered);
    }

    if (allClientKeywords.length > 0) {
      const uniqueKws = [...new Set(allClientKeywords)].slice(0, 10);
      const kwTerms = uniqueKws.map((k: string) => {
        // Multi-word phrases stay quoted only if they're clearly entity
        // names (≥2 capitalised words). Otherwise drop the quotes so
        // Twitter does word-co-occurrence matching, which is more
        // forgiving for activist hashtags + paraphrases.
        const words = k.trim().split(/\s+/);
        const isEntityPhrase = words.length >= 2 &&
          words.filter(w => /^[A-Z]/.test(w)).length >= 2;
        return isEntityPhrase ? `"${k}"` : k;
      });

      // Static hashtag set — the most common activism tags for Canadian
      // energy infrastructure. Updated occasionally as new campaigns
      // pick up tags. Kept short to leave room under the 1024-char cap.
      const protestHashtags = [
        '#LNGCanada', '#StopLNG', '#NoLNG',
        '#CGL', '#StopCGL', '#NoCGL',
        '#LandBack', '#Wetsuweten', '#Wetsuwet',
        '#PRGT', '#NoPRGT',
        '#BoycottLNG',
      ];

      const kwOR = [...kwTerms, ...protestHashtags].join(" OR ");
      const campaignQuery = `(${kwOR}) (protest OR blockade OR threat OR sabotage OR activist OR boycott OR rally OR direct action OR land defender) -is:retweet`;

      console.log(`[TwitterMonitor] Campaign query (${campaignQuery.length} chars): ${campaignQuery.substring(0, 120)}...`);

      // Wait 1s between API calls to be safe
      await new Promise(r => setTimeout(r, 1000));

      const campaignTweets = await searchRecentTweets(bearerToken, campaignQuery, 25);
      let campaignSignals = 0;

      for (const tweet of campaignTweets) {
        const result = await ingestTweet(supabase, tweet, persons, clientList, "campaign");
        if (result) { campaignSignals++; signalsCreated++; }
        tweetsProcessed++;
        if ((tweet.public_metrics?.reply_count ?? 0) >= 3 && tweet.conversation_id) {
          conversationCandidates.push(tweet);
        }
      }

      console.log(`[TwitterMonitor] Campaign query: ${campaignTweets.length} tweets, ${campaignSignals} signals`);
    }

    // ═══ QUERY C: Situational early-warning (wildfire / evacuation / smoke) ═══
    // CWFIS satellite detection lags news by 1-3 hours. Local outlets
    // (e.g. Energetic City, BCWS, NWFS) often tweet a fire before VIIRS/
    // MODIS picks up the hotspot. Scoped to clients whose locations
    // overlap our wildfire ops zones — energy/critical-infra operators
    // get early warning; healthcare/non-energy clients aren't spammed.
    const wildfireClients = clientList.filter((c: any) => {
      const raw = c?.locations;
      const flat: string[] = Array.isArray(raw)
        ? raw.map((l: any) => typeof l === 'string' ? l : (l?.name ?? l?.city ?? l?.address ?? JSON.stringify(l ?? '')))
        : typeof raw === 'string' ? [raw] : [];
      const haystack = flat.join(' | ').toLowerCase();
      return ZONE_LOCATION_KEYWORDS.some(kw => haystack.includes(kw));
    });

    if (wildfireClients.length > 0) {
      const locationTerms: string[] = [];
      for (const c of wildfireClients) {
        const raw = c.locations;
        const flat = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
        for (const loc of flat) {
          const s = (typeof loc === 'string' ? loc : (loc?.name || loc?.city || '')).trim();
          if (s.length >= 4) locationTerms.push(s);
        }
      }
      const uniqueLocs = [...new Set(locationTerms.map(s => s.toLowerCase()))]
        .filter(s => ZONE_LOCATION_KEYWORDS.some(kw => s.includes(kw)))
        .slice(0, 8); // cap to keep query under Twitter's 1024-char limit

      if (uniqueLocs.length > 0) {
        const locOR = uniqueLocs.map(l => `"${l}"`).join(' OR ');
        const sitOR = SITUATIONAL_TERMS.join(' OR ');
        const sitQuery = `(${locOR}) (${sitOR}) -is:retweet`;

        if (sitQuery.length < 1000) {
          console.log(`[TwitterMonitor] Situational query (${sitQuery.length} chars): ${sitQuery.substring(0, 120)}...`);
          await new Promise(r => setTimeout(r, 1000));
          const sitTweets = await searchRecentTweets(bearerToken, sitQuery, 25);
          let sitSignals = 0;
          for (const tweet of sitTweets) {
            const result = await ingestTweet(supabase, tweet, persons, wildfireClients, "situational");
            if (result) { sitSignals++; signalsCreated++; }
            tweetsProcessed++;
            if ((tweet.public_metrics?.reply_count ?? 0) >= 3 && tweet.conversation_id) {
              conversationCandidates.push(tweet);
            }
          }
          console.log(`[TwitterMonitor] Situational query: ${sitTweets.length} tweets, ${sitSignals} signals`);
        } else {
          console.warn(`[TwitterMonitor] Situational query too long (${sitQuery.length} chars), skipping`);
        }
      }
    }

    // ═══ QUERY D: Conversation expansion ═══════════════════════════════
    // High-reply tweets surfaced by A/B/C often have activist coordination
    // in the replies that the parent tweet doesn't show. Pick the top
    // candidates by reply_count, fetch each conversation, and ingest the
    // replies as individual tweets. Cap at 3 expansions per cron run to
    // bound API spend (each expansion = 1 request, ~50 replies returned).
    if (conversationCandidates.length > 0) {
      const topCandidates = conversationCandidates
        .filter((t) => t.conversation_id && !expandedConversationIds.has(t.conversation_id))
        .sort((a, b) =>
          (b.public_metrics?.reply_count ?? 0) - (a.public_metrics?.reply_count ?? 0),
        )
        .slice(0, 3);

      for (const parent of topCandidates) {
        if (!parent.conversation_id) continue;
        expandedConversationIds.add(parent.conversation_id);
        console.log(`[TwitterMonitor] Expanding conversation_id=${parent.conversation_id} (parent has ${parent.public_metrics?.reply_count} replies)`);
        await new Promise((r) => setTimeout(r, 1000));

        const replies = await searchRecentTweets(
          bearerToken,
          `conversation_id:${parent.conversation_id} -is:retweet`,
          50,
        );
        for (const reply of replies) {
          if (reply.id === parent.id) continue;   // skip the parent itself
          const result = await ingestTweet(supabase, reply, persons, clientList, "conversation_reply");
          if (result) { signalsCreated++; replySignals++; }
          tweetsProcessed++;
        }
        conversationsExpanded++;
        console.log(`[TwitterMonitor] Conversation ${parent.conversation_id}: ${replies.length} replies, ${replySignals} signals so far`);
      }
    }

    console.log(`[TwitterMonitor] Done. Tweets processed: ${tweetsProcessed}, signals created: ${signalsCreated} (conversations expanded: ${conversationsExpanded}, reply signals: ${replySignals})`);

    await completeHeartbeat(supabase, hb, {
      tweets_processed: tweetsProcessed,
      signals_created: signalsCreated,
      conversations_expanded: conversationsExpanded,
      reply_signals: replySignals,
      source: "twitter_api_v2",
    });

    return successResponse({
      success: true,
      tweets_processed: tweetsProcessed,
      signals_created: signalsCreated,
      source: "twitter_api_v2"
    });

  } catch (error) {
    console.error("[TwitterMonitor] Fatal error:", error);
    await failHeartbeat(supabase, hb, error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Twitter API v2 recent search
// ═══════════════════════════════════════════════════════════════

interface Tweet {
  id: string;
  text: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  created_at?: string;
  public_metrics?: { like_count: number; retweet_count: number; reply_count: number };
  author?: { username: string; name: string };
}

async function searchRecentTweets(bearerToken: string, query: string, maxResults = 10): Promise<Tweet[]> {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    // conversation_id + in_reply_to_user_id let us identify and expand
    // reply threads on high-engagement tweets.
    "tweet.fields": "created_at,public_metrics,text,conversation_id,in_reply_to_user_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });

  const url = `${TWITTER_SEARCH_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429) {
      const resetAt = response.headers.get("x-rate-limit-reset");
      console.warn(`[TwitterMonitor] Rate limited. Resets at: ${resetAt ? new Date(Number(resetAt) * 1000).toISOString() : "unknown"}`);
      return [];
    }

    if (!response.ok) {
      const body = await response.text();
      console.error(`[TwitterMonitor] API error ${response.status}: ${body.substring(0, 200)}`);
      return [];
    }

    const data = await response.json();

    if (!data.data?.length) {
      console.log("[TwitterMonitor] No tweets returned");
      return [];
    }

    // Merge author info into tweets
    const usersById = new Map<string, { username: string; name: string }>();
    for (const user of data.includes?.users || []) {
      usersById.set(user.id, { username: user.username, name: user.name });
    }

    return (data.data as any[]).map((t: any) => ({
      id: t.id,
      text: t.text,
      conversation_id: t.conversation_id,
      in_reply_to_user_id: t.in_reply_to_user_id,
      created_at: t.created_at,
      public_metrics: t.public_metrics,
      author: usersById.get(t.author_id),
    }));

  } catch (err) {
    console.error("[TwitterMonitor] Fetch error:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// Signal ingestion
// ═══════════════════════════════════════════════════════════════

async function ingestTweet(
  supabase: any,
  tweet: Tweet,
  persons: any[],
  clients: any[] | null,
  queryType: "person_threat" | "campaign" | "situational"
): Promise<boolean> {
  const tweetUrl = `https://x.com/i/web/status/${tweet.id}`;
  const lowerText = tweet.text.toLowerCase();

  // Dedup check
  const { data: existing } = await supabase
    .from("ingested_documents")
    .select("id")
    .eq("source_url", tweetUrl)
    .limit(1);

  if (existing?.length > 0) return false;

  // Match which entity or client this tweet is about
  const matchedPerson = persons.find((p: any) => lowerText.includes(p.name.toLowerCase()));
  const matchedClient = clients?.find((c: any) => lowerText.includes(c.name.toLowerCase()));

  const entityId = matchedPerson?.id || null;
  const clientId = matchedPerson?.client_id || matchedClient?.id || null;

  // Categorise
  let category = "social_media";
  const threatTerms = ["threat", "harass", "dox", "doxx", "home address", "personal information", "find them"];
  const wildfireTerms = ["wildfire", "evacuation alert", "evacuation order", "fire ban"];
  if (threatTerms.some(t => lowerText.includes(t))) {
    category = "threat_indication";
  } else if (lowerText.includes("protest") || lowerText.includes("blockade")) {
    category = "protest_activity";
  } else if (lowerText.includes("boycott") || lowerText.includes("activist") || lowerText.includes("sabotage")) {
    category = "activism";
  } else if (queryType === "situational" || wildfireTerms.some(t => lowerText.includes(t))) {
    // Situational tweets from Query C — wildfire / evacuation / smoke /
    // fire-ban early warning. Use 'wildfire' to match what
    // monitor-wildfires writes so the feed groups them together.
    category = "wildfire";
  }

  const authorHandle = tweet.author ? `@${tweet.author.username}` : null;
  const title = `Tweet${authorHandle ? ` by ${authorHandle}` : ""}${matchedPerson ? `: ${matchedPerson.name}` : matchedClient ? `: ${matchedClient.name}` : ""}`;

  const { data: doc, error: docErr } = await supabase
    .from("ingested_documents")
    .insert({
      title,
      raw_text: tweet.text,
      source_url: tweetUrl,
      post_caption: tweet.text,
      author_handle: authorHandle,
      author_name: tweet.author?.name || null,
      metadata: {
        source: "twitter_api_v2",
        source_type: "social_media",
        platform: "twitter",
        client_id: clientId,
        entity_id: entityId,
        tweet_id: tweet.id,
        created_at: tweet.created_at,
        public_metrics: tweet.public_metrics,
        category,
        query_type: queryType,
        is_high_priority: category === "threat_indication",
      },
    })
    .select()
    .single();

  if (docErr || !doc) {
    console.error("[TwitterMonitor] Insert error:", docErr);
    return false;
  }

  // Link to entity if matched
  if (entityId) {
    await supabase.from("document_entity_mentions").insert({
      document_id: doc.id,
      entity_id: entityId,
      confidence: 0.9,
      mention_text: matchedPerson.name,
    });
  }

  // Trigger intelligence pipeline
  await supabase.functions.invoke("process-intelligence-document", {
    body: { documentId: doc.id },
  });

  console.log(`[TwitterMonitor] ✓ Ingested ${category} tweet${matchedPerson ? ` about ${matchedPerson.name}` : ""}: "${tweet.text.substring(0, 80)}..."`);
  return true;
}
