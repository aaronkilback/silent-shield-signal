import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Incident Watch — Surge monitoring for active P1/P2 incidents.
 * Runs every 15 minutes via cron. Searches for new information about
 * active incidents and appends updates to the originating signal.
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    
    // Allow manual trigger for a specific incident
    const targetIncidentId = body?.incident_id;

    // Find active P1/P2 incidents
    let query = supabase
      .from("incidents")
      .select("id, signal_id, status, priority, opened_at, client_id, signals!incidents_signal_id_fkey(title, normalized_text)")
      .in("status", ["open", "acknowledged", "contained"])
      .in("priority", ["p1", "p2"]);

    if (targetIncidentId) {
      query = query.eq("id", targetIncidentId);
    }

    const { data: incidents, error: incErr } = await query.limit(10);
    if (incErr) {
      console.error("[incident-watch] Failed to fetch incidents:", incErr);
      return errorResponse("Failed to fetch incidents", 500);
    }

    if (!incidents || incidents.length === 0) {
      console.log("[incident-watch] No active P1/P2 incidents to watch");
      return successResponse({ message: "No active incidents", updates: 0 });
    }

    console.log(`[incident-watch] Watching ${incidents.length} active incident(s)`);

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    const GOOGLE_SEARCH_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
    const GOOGLE_SEARCH_ENGINE_ID = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");

    let totalUpdates = 0;

    for (const incident of incidents) {
      try {
        const signal = incident.signals as any;
        if (!signal) {
          console.log(`[incident-watch] Incident ${incident.id} has no linked signal, skipping`);
          continue;
        }

        const signalId = incident.signal_id;
        const searchQuery = buildSearchQuery(signal);
        
        if (!searchQuery) {
          console.log(`[incident-watch] Could not build query for incident ${incident.id}`);
          continue;
        }

        console.log(`[incident-watch] Searching for updates: "${searchQuery}"`);

        // Get existing update hashes to avoid duplicates
        const { data: existingUpdates } = await supabase
          .from("signal_updates")
          .select("content_hash")
          .eq("signal_id", signalId)
          .not("content_hash", "is", null);

        const existingHashes = new Set((existingUpdates || []).map(u => u.content_hash));

        // Search for new information
        const newResults = await searchForUpdates(
          searchQuery,
          PERPLEXITY_API_KEY,
          GOOGLE_SEARCH_API_KEY,
          GOOGLE_SEARCH_ENGINE_ID
        );

        // Filter and insert new updates
        for (const result of newResults) {
          const hash = await hashContent(result.content + (result.source_url || ""));
          
          if (existingHashes.has(hash)) {
            continue;
          }

          const { error: insertErr } = await supabase
            .from("signal_updates")
            .insert({
              signal_id: signalId,
              incident_id: incident.id,
              content: result.content,
              source_url: result.source_url,
              source_name: result.source_name,
              content_hash: hash,
              metadata: result.metadata || {},
            });

          if (insertErr) {
            // Duplicate hash constraint will catch races
            if (insertErr.code !== "23505") {
              console.error(`[incident-watch] Insert error:`, insertErr);
            }
            continue;
          }

          totalUpdates++;
          console.log(`[incident-watch] New update for signal ${signalId}: ${result.content.substring(0, 80)}...`);
        }
      } catch (incidentErr) {
        console.error(`[incident-watch] Error processing incident ${incident.id}:`, incidentErr);
      }
    }

    console.log(`[incident-watch] Complete. ${totalUpdates} new updates across ${incidents.length} incidents`);
    return successResponse({ message: "Watch complete", updates: totalUpdates, incidents_checked: incidents.length });
  } catch (error) {
    console.error("[incident-watch] Fatal error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

function buildSearchQuery(signal: any): string | null {
  const title = signal.title || "";
  const text = signal.normalized_text || "";
  
  // Extract key terms from signal
  const combined = `${title} ${text}`.trim();
  if (!combined) return null;

  // Use title if short enough, otherwise extract key phrases
  if (title.length > 10 && title.length < 120) {
    return title;
  }

  // Take first meaningful sentence
  const sentences = combined.split(/[.!?]+/).filter(s => s.trim().length > 15);
  if (sentences.length > 0) {
    return sentences[0].trim().substring(0, 120);
  }

  return combined.substring(0, 120);
}

async function searchForUpdates(
  query: string,
  perplexityKey?: string,
  googleKey?: string,
  googleCx?: string
): Promise<Array<{ content: string; source_url?: string; source_name?: string; metadata?: any }>> {
  const results: Array<{ content: string; source_url?: string; source_name?: string; metadata?: any }> = [];

  // Try Perplexity first for synthesized intelligence
  if (perplexityKey) {
    try {
      const perplexityResults = await searchPerplexity(query, perplexityKey);
      results.push(...perplexityResults);
      // Rate limit protection
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error("[incident-watch] Perplexity search failed:", e);
    }
  }

  // Then Google for raw sources
  if (googleKey && googleCx) {
    try {
      const googleResults = await searchGoogle(query, googleKey, googleCx);
      results.push(...googleResults);
    } catch (e) {
      console.error("[incident-watch] Google search failed:", e);
    }
  }

  return results;
}

async function searchPerplexity(
  query: string,
  apiKey: string
): Promise<Array<{ content: string; source_url?: string; source_name?: string; metadata?: any }>> {
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "You are a security intelligence analyst. Provide a concise factual update about the following event. Focus on NEW developments, confirmed facts, and official statements. Do not speculate. If there is nothing new, say 'No new developments found.'"
        },
        {
          role: "user",
          content: `What are the latest developments regarding: ${query}`
        }
      ],
      search_recency_filter: "day",
    }),
  });

  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];

  // Skip if no real updates or hallucinated inability responses
  const lowerContent = content.toLowerCase();
  const noValuePhrases = [
    "no new developments", "i don't have access", "i cannot", "i'm unable",
    "no recent updates", "no specific developments", "no verified", 
    "my training data", "my knowledge cutoff"
  ];
  if (noValuePhrases.some(p => lowerContent.includes(p)) || content.length < 50) {
    return [];
  }

  return [{
    content: content,
    source_url: citations[0] || undefined,
    source_name: "Perplexity Intelligence",
    metadata: { 
      provider: "perplexity",
      citations,
      searched_at: new Date().toISOString()
    }
  }];
}

async function searchGoogle(
  query: string,
  apiKey: string,
  cx: string
): Promise<Array<{ content: string; source_url?: string; source_name?: string; metadata?: any }>> {
  // Search for recent results only
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=3&sort=date&dateRestrict=d1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`);
  }

  const data = await response.json();
  const items = data.items || [];

  return items.map((item: any) => ({
    content: `${item.title}: ${item.snippet || ""}`.trim(),
    source_url: item.link,
    source_name: new URL(item.link).hostname,
    metadata: {
      provider: "google",
      published_date: item.pagemap?.metatags?.[0]?.["article:published_time"] || null,
      searched_at: new Date().toISOString()
    }
  }));
}

async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
