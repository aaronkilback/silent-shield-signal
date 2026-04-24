import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

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

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const bearerToken = Deno.env.get("TWITTER_BEARER_TOKEN");

    if (!bearerToken) {
      console.log("[TwitterMonitor] No TWITTER_BEARER_TOKEN configured — skipping");
      return successResponse({ success: true, message: "No bearer token configured", signals_created: 0 });
    }

    const supabase = createServiceClient();

    // Fetch all actively monitored person entities
    const { data: personEntities, error: entErr } = await supabase
      .from("entities")
      .select("id, name, type, client_id, attributes")
      .eq("active_monitoring_enabled", true)
      .eq("type", "person");

    if (entErr) throw entErr;

    // Fetch clients for campaign monitoring
    const { data: clients, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, monitoring_keywords");

    if (clientErr) throw clientErr;

    const persons = personEntities || [];
    const clientList = clients || [];

    let signalsCreated = 0;
    let tweetsProcessed = 0;

    // ═══ QUERY A: Person threat monitoring ═══
    // Build one OR query from all monitored person names
    if (persons.length > 0) {
      const nameTerms = persons
        .map((p: any) => `"${p.name}"`)
        .join(" OR ");

      const threatOR = PERSON_THREAT_TERMS.slice(0, 8).join(" OR ");

      // Twitter API v2 query — max 1024 chars
      const query = `(${nameTerms}) (${threatOR}) -is:retweet lang:en`;
      const truncated = query.length > 1000 ? query.substring(0, 1000) + ")" : query;

      console.log(`[TwitterMonitor] Person threat query (${truncated.length} chars): ${truncated.substring(0, 120)}...`);

      const tweets = await searchRecentTweets(bearerToken, truncated, 25);

      for (const tweet of tweets) {
        const result = await ingestTweet(supabase, tweet, persons, null, "person_threat");
        if (result) signalsCreated++;
        tweetsProcessed++;
      }

      console.log(`[TwitterMonitor] Person threat query: ${tweets.length} tweets, ${signalsCreated} signals`);
    }

    // ═══ QUERY B: Client campaign monitoring ═══
    // Combine monitoring keywords from all clients into one query
    const allClientKeywords: string[] = [];
    for (const client of clientList) {
      const kws: string[] = client.monitoring_keywords || [];
      // Pick up to 5 most specific keywords per client (skip very short ones)
      const filtered = kws.filter((k: string) => k.length > 6).slice(0, 5);
      allClientKeywords.push(...filtered);
    }

    if (allClientKeywords.length > 0) {
      // Deduplicate and cap at 10 terms to stay under query length limit
      const uniqueKws = [...new Set(allClientKeywords)].slice(0, 10);
      const kwOR = uniqueKws.map((k: string) => `"${k}"`).join(" OR ");
      const campaignQuery = `(${kwOR}) (protest OR blockade OR threat OR sabotage OR activist OR boycott) -is:retweet lang:en`;

      console.log(`[TwitterMonitor] Campaign query (${campaignQuery.length} chars): ${campaignQuery.substring(0, 120)}...`);

      // Wait 1s between API calls to be safe
      await new Promise(r => setTimeout(r, 1000));

      const campaignTweets = await searchRecentTweets(bearerToken, campaignQuery, 25);
      let campaignSignals = 0;

      for (const tweet of campaignTweets) {
        const result = await ingestTweet(supabase, tweet, persons, clientList, "campaign");
        if (result) { campaignSignals++; signalsCreated++; }
        tweetsProcessed++;
      }

      console.log(`[TwitterMonitor] Campaign query: ${campaignTweets.length} tweets, ${campaignSignals} signals`);
    }

    console.log(`[TwitterMonitor] Done. Tweets processed: ${tweetsProcessed}, signals created: ${signalsCreated}`);

    return successResponse({
      success: true,
      tweets_processed: tweetsProcessed,
      signals_created: signalsCreated,
      source: "twitter_api_v2"
    });

  } catch (error) {
    console.error("[TwitterMonitor] Fatal error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Twitter API v2 recent search
// ═══════════════════════════════════════════════════════════════

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: { like_count: number; retweet_count: number; reply_count: number };
  author?: { username: string; name: string };
}

async function searchRecentTweets(bearerToken: string, query: string, maxResults = 10): Promise<Tweet[]> {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    "tweet.fields": "created_at,public_metrics,text",
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
  queryType: "person_threat" | "campaign"
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
  if (threatTerms.some(t => lowerText.includes(t))) {
    category = "threat_indication";
  } else if (lowerText.includes("protest") || lowerText.includes("blockade")) {
    category = "protest_activity";
  } else if (lowerText.includes("boycott") || lowerText.includes("activist") || lowerText.includes("sabotage")) {
    category = "activism";
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
