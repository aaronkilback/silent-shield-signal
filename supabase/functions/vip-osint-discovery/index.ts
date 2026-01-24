import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscoveryParams {
  name: string;
  email?: string;
  dateOfBirth?: string;
  location?: string;
  socialMediaHandles?: string;
}

interface Discovery {
  type: "social_media" | "photo" | "news" | "property" | "corporate" | "family" | "contact" | "other";
  label: string;
  value: string;
  source: string;
  confidence: number;
  fieldMapping?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: { type: string; data: any }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const params: DiscoveryParams = await req.json();
        const { name, email, dateOfBirth, location, socialMediaHandles } = params;

        if (!name) {
          send({ type: "error", data: { message: "Name is required" } });
          controller.close();
          return;
        }

        const GOOGLE_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
        const GOOGLE_CX = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

        console.log(`[VIP-OSINT] Starting discovery for: ${name}`);
        console.log(`[VIP-OSINT] Google API configured: ${!!GOOGLE_API_KEY && !!GOOGLE_CX}`);
        console.log(`[VIP-OSINT] Lovable API configured: ${!!LOVABLE_API_KEY}`);

        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const discoveries: Discovery[] = [];
        const sources = [
          { name: "LinkedIn", query: `site:linkedin.com "${name}"`, type: "social_media" },
          { name: "Twitter", query: `site:twitter.com OR site:x.com "${name}"`, type: "social_media" },
          { name: "Facebook", query: `site:facebook.com "${name}"`, type: "social_media" },
          { name: "Instagram", query: `site:instagram.com "${name}"`, type: "social_media" },
          { name: "News", query: `"${name}" news`, type: "news" },
          { name: "Corporate", query: `"${name}" company OR "director of" OR "CEO" OR "founder"`, type: "corporate" },
        ];

        // Add location-specific searches if provided
        if (location) {
          sources.push({
            name: "Property",
            query: `"${name}" "${location}" property OR address OR residence`,
            type: "property",
          });
        }

        send({ type: "phase", data: { phase: "searching" } });

        let progressPercent = 0;
        const progressPerSource = 70 / sources.length;

        // Run searches in parallel batches
        for (let i = 0; i < sources.length; i += 2) {
          const batch = sources.slice(i, i + 2);
          
          await Promise.all(
            batch.map(async (source) => {
              send({ type: "source_started", data: { source: source.name } });

              if (GOOGLE_API_KEY && GOOGLE_CX) {
                try {
                  const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
                  searchUrl.searchParams.set("key", GOOGLE_API_KEY);
                  searchUrl.searchParams.set("cx", GOOGLE_CX);
                  searchUrl.searchParams.set("q", source.query);
                  searchUrl.searchParams.set("num", "5");

                  console.log(`[VIP-OSINT] Searching ${source.name}: ${source.query}`);
                  const response = await fetch(searchUrl.toString());
                  console.log(`[VIP-OSINT] ${source.name} response status: ${response.status}`);
                  
                  if (response.ok) {
                    const data = await response.json();
                    console.log(`[VIP-OSINT] ${source.name} results: ${data.items?.length || 0} items`);
                    
                    for (const item of data.items || []) {
                      const discovery = extractDiscovery(item, source, name);
                      if (discovery) {
                        discoveries.push(discovery);
                        send({ type: "discovery", data: discovery });
                      }
                    }
                  } else {
                    const errorText = await response.text();
                    console.error(`[VIP-OSINT] ${source.name} search failed: ${errorText}`);
                  }
                } catch (e) {
                  console.error(`[VIP-OSINT] Search error for ${source.name}:`, e);
                }
              } else {
                console.log(`[VIP-OSINT] Using simulated discovery for ${source.name} (no Google API)`)
                // Simulate discovery for development
                const simulatedDiscovery = simulateDiscovery(source, name);
                if (simulatedDiscovery) {
                  discoveries.push(simulatedDiscovery);
                  send({ type: "discovery", data: simulatedDiscovery });
                }
              }

              send({ type: "source_complete", data: { source: source.name } });
            })
          );

          progressPercent += progressPerSource * batch.length;
          send({ type: "progress", data: { percent: Math.round(progressPercent) } });
        }

        // AI analysis phase
        send({ type: "phase", data: { phase: "analyzing" } });
        send({ type: "progress", data: { percent: 75 } });

        if (LOVABLE_API_KEY && discoveries.length > 0) {
          try {
            // Use AI to analyze and extract structured info
            const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  {
                    role: "system",
                    content: `You are an OSINT analyst extracting structured information about a person named "${name}". 
                    Analyze the discovered information and extract any additional details like:
                    - Social media handles/usernames
                    - Contact information (phone, email)
                    - Family member names and relationships
                    - Corporate affiliations and titles
                    - Property addresses
                    Return as JSON array of discoveries.`,
                  },
                  {
                    role: "user",
                    content: `Analyze these search results and extract structured information:\n${JSON.stringify(discoveries, null, 2)}`,
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "report_discoveries",
                      description: "Report extracted discoveries about the person",
                      parameters: {
                        type: "object",
                        properties: {
                          discoveries: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                type: { type: "string", enum: ["social_media", "photo", "news", "property", "corporate", "family", "contact", "other"] },
                                label: { type: "string" },
                                value: { type: "string" },
                                source: { type: "string" },
                                confidence: { type: "number", minimum: 0, maximum: 100 },
                                fieldMapping: { type: "string", description: "Which intake form field this maps to" },
                              },
                              required: ["type", "label", "value", "source", "confidence"],
                            },
                          },
                        },
                        required: ["discoveries"],
                      },
                    },
                  },
                ],
                tool_choice: { type: "function", function: { name: "report_discoveries" } },
              }),
            });

            if (response.ok) {
              const aiData = await response.json();
              const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
              
              if (toolCall) {
                const aiDiscoveries = JSON.parse(toolCall.function.arguments).discoveries || [];
                for (const d of aiDiscoveries) {
                  // Avoid duplicates
                  if (!discoveries.some((existing) => existing.value === d.value)) {
                    discoveries.push(d);
                    send({ type: "discovery", data: d });
                  }
                }
              }
            }
          } catch (e) {
            console.error("AI analysis error:", e);
          }
        }

        send({ type: "progress", data: { percent: 100 } });
        send({ type: "phase", data: { phase: "complete" } });
        send({ type: "done", data: { totalDiscoveries: discoveries.length } });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        send({ type: "error", data: { message: error instanceof Error ? error.message : "Unknown error" } });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

function extractDiscovery(
  item: { title?: string; link?: string; snippet?: string; pagemap?: any },
  source: { name: string; type: string },
  targetName: string
): Discovery | null {
  const title = item.title || "";
  const link = item.link || "";
  const snippet = item.snippet || "";

  // Skip if the result doesn't seem to match the person
  const nameParts = targetName.toLowerCase().split(" ");
  const contentLower = `${title} ${snippet}`.toLowerCase();
  const matchScore = nameParts.filter((p) => contentLower.includes(p)).length / nameParts.length;
  
  if (matchScore < 0.5) return null;

  // Extract platform-specific info
  let label = title;
  let value = link;
  let fieldMapping: string | undefined;
  let confidence = Math.round(matchScore * 80 + 20);

  if (source.name === "LinkedIn") {
    const linkedInMatch = link.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (linkedInMatch) {
      label = `LinkedIn Profile`;
      value = `linkedin.com/in/${linkedInMatch[1]}`;
      fieldMapping = "socialMediaHandles";
    }
  } else if (source.name === "Twitter") {
    const twitterMatch = link.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
    if (twitterMatch && !["search", "hashtag", "intent"].includes(twitterMatch[1])) {
      label = `Twitter/X Profile`;
      value = `@${twitterMatch[1]}`;
      fieldMapping = "socialMediaHandles";
    }
  } else if (source.name === "Facebook") {
    label = "Facebook Profile";
    fieldMapping = "socialMediaHandles";
  } else if (source.name === "Instagram") {
    const igMatch = link.match(/instagram\.com\/([^\/\?]+)/);
    if (igMatch && !["p", "explore", "reel"].includes(igMatch[1])) {
      label = `Instagram Profile`;
      value = `@${igMatch[1]}`;
      fieldMapping = "socialMediaHandles";
    }
  } else if (source.type === "corporate") {
    // Extract company affiliations from snippet
    const companyPatterns = /(?:CEO|founder|director|president|chairman|executive)\s+(?:of|at)\s+([^,.]+)/i;
    const match = snippet.match(companyPatterns);
    if (match) {
      label = `Corporate: ${match[0]}`;
      value = match[1].trim();
      fieldMapping = "corporateAffiliations";
      confidence = 70;
    }
  } else if (source.type === "news") {
    label = `News: ${title.slice(0, 60)}${title.length > 60 ? "..." : ""}`;
    confidence = 60;
  }

  return {
    type: source.type as Discovery["type"],
    label,
    value,
    source: source.name,
    confidence,
    fieldMapping,
  };
}

function simulateDiscovery(source: { name: string; type: string }, name: string): Discovery | null {
  // Development simulation - return mock data
  const simulations: Record<string, () => Discovery | null> = {
    LinkedIn: () => ({
      type: "social_media",
      label: "LinkedIn Profile (simulated)",
      value: `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
      source: "LinkedIn",
      confidence: 75,
      fieldMapping: "socialMediaHandles",
    }),
    Twitter: () => ({
      type: "social_media",
      label: "Twitter Profile (simulated)",
      value: `@${name.split(" ")[0].toLowerCase()}`,
      source: "Twitter",
      confidence: 60,
      fieldMapping: "socialMediaHandles",
    }),
    Corporate: () => ({
      type: "corporate",
      label: "Corporate Affiliation (simulated)",
      value: "Example Corporation",
      source: "Corporate",
      confidence: 55,
      fieldMapping: "corporateAffiliations",
    }),
  };

  return simulations[source.name]?.() || null;
}
