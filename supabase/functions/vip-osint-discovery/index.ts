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
  industry?: string;
}

interface Discovery {
  type: "social_media" | "photo" | "news" | "property" | "corporate" | "family" | "contact" | "breach" | "threat" | "geospatial" | "dependency" | "other";
  label: string;
  value: string;
  source: string;
  confidence: number;
  fieldMapping?: string;
  category?: "identity" | "physical" | "digital" | "operational" | "threat" | "consequence";
  riskLevel?: "low" | "medium" | "high" | "critical";
  commentary?: string;
}

interface TerrainAnalysis {
  identity: { visibility: number; observations: string[] };
  physical: { exposure: number; observations: string[] };
  digital: { attackSurface: number; observations: string[] };
  operational: { dependencies: number; observations: string[] };
}

interface ThreatSignal {
  vector: string;
  momentum: "rising" | "stable" | "declining";
  narrative: string;
  trigger: string;
  confidence: number;
}

interface ExposureTier {
  tier: 1 | 2 | 3;
  exposure: string;
  reason: string;
  exploitMethod: string;
  earlyWarning: string;
  intervention: string;
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
        const { name, email, dateOfBirth, location, socialMediaHandles, industry } = params;

        if (!name) {
          send({ type: "error", data: { message: "Name is required" } });
          controller.close();
          return;
        }

        const GOOGLE_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
        const GOOGLE_CX = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");

        console.log(`[VIP-DEEP-SCAN] ═══════════════════════════════════════════════`);
        console.log(`[VIP-DEEP-SCAN] Starting 7-Day Deep Scan Protocol for: ${name}`);
        console.log(`[VIP-DEEP-SCAN] Google API configured: ${!!GOOGLE_API_KEY && !!GOOGLE_CX}`);
        console.log(`[VIP-DEEP-SCAN] Lovable AI configured: ${!!LOVABLE_API_KEY}`);
        console.log(`[VIP-DEEP-SCAN] HIBP API configured: ${!!HIBP_API_KEY}`);
        console.log(`[VIP-DEEP-SCAN] ═══════════════════════════════════════════════`);

        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const discoveries: Discovery[] = [];
        const terrainAnalysis: TerrainAnalysis = {
          identity: { visibility: 0, observations: [] },
          physical: { exposure: 0, observations: [] },
          digital: { attackSurface: 0, observations: [] },
          operational: { dependencies: 0, observations: [] },
        };
        const threatSignals: ThreatSignal[] = [];
        const exposureTiers: ExposureTier[] = [];

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE I: TERRAIN MAPPING (Days 1-2)
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "terrain_mapping", label: "Phase I: Terrain Mapping" } });
        
        // A. Identity & Visibility Footprint
        send({ type: "domain", data: { domain: "identity", label: "Identity & Visibility Footprint" } });
        
        const identitySources = [
          { name: "LinkedIn", query: `site:linkedin.com "${name}"`, type: "social_media", category: "identity" },
          { name: "Twitter", query: `site:twitter.com OR site:x.com "${name}"`, type: "social_media", category: "identity" },
          { name: "Facebook", query: `site:facebook.com "${name}"`, type: "social_media", category: "identity" },
          { name: "Instagram", query: `site:instagram.com "${name}"`, type: "social_media", category: "identity" },
          { name: "Media", query: `"${name}" interview OR profile OR biography`, type: "news", category: "identity" },
          { name: "Affiliations", query: `"${name}" board OR member OR association OR club`, type: "corporate", category: "identity" },
          { name: "Wikipedia", query: `site:wikipedia.org "${name}"`, type: "news", category: "identity" },
          { name: "Crunchbase", query: `site:crunchbase.com "${name}"`, type: "corporate", category: "identity" },
        ];

        // B. Physical & Geographic Exposure
        send({ type: "domain", data: { domain: "physical", label: "Physical & Geographic Exposure" } });
        
        const physicalSources: any[] = [];
        if (location) {
          physicalSources.push(
            { name: "Property Records", query: `"${name}" "${location}" property OR deed OR owner`, type: "property", category: "physical" },
            { name: "Business Addresses", query: `"${name}" office address OR headquarters`, type: "property", category: "physical" },
          );
        }
        physicalSources.push(
          { name: "Travel Patterns", query: `"${name}" spotted OR seen OR attended event`, type: "news", category: "physical" },
          { name: "Public Appearances", query: `"${name}" speaking OR conference OR summit`, type: "news", category: "physical" },
        );

        // C. Digital & Data Surface
        send({ type: "domain", data: { domain: "digital", label: "Digital & Data Surface" } });
        
        const digitalSources = [
          { name: "Domain WHOIS", query: `"${name}" domain OR website OR owns`, type: "other", category: "digital" },
          { name: "GitHub", query: `site:github.com "${name}"`, type: "social_media", category: "digital" },
          { name: "Data Leaks", query: `"${name}" leak OR breach OR exposed`, type: "breach", category: "digital" },
        ];

        // D. Operational Dependencies
        send({ type: "domain", data: { domain: "operational", label: "Operational Dependencies" } });
        
        const operationalSources = [
          { name: "Corporate Filings", query: `"${name}" CEO OR founder OR director company`, type: "corporate", category: "operational" },
          { name: "Partnerships", query: `"${name}" partnership OR venture OR investment`, type: "corporate", category: "operational" },
          { name: "Legal", query: `"${name}" lawsuit OR litigation OR court`, type: "news", category: "operational" },
        ];

        const allSources = [...identitySources, ...physicalSources, ...digitalSources, ...operationalSources];
        
        let progressPercent = 0;
        const progressPerSource = 40 / allSources.length;

        // Execute searches
        for (let i = 0; i < allSources.length; i += 3) {
          const batch = allSources.slice(i, i + 3);
          
          await Promise.all(
            batch.map(async (source) => {
              send({ type: "source_started", data: { source: source.name, category: source.category } });

              if (GOOGLE_API_KEY && GOOGLE_CX) {
                try {
                  const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
                  searchUrl.searchParams.set("key", GOOGLE_API_KEY);
                  searchUrl.searchParams.set("cx", GOOGLE_CX);
                  searchUrl.searchParams.set("q", source.query);
                  searchUrl.searchParams.set("num", "5");

                  console.log(`[VIP-DEEP-SCAN] Searching ${source.name}: ${source.query.substring(0, 50)}...`);
                  const response = await fetch(searchUrl.toString());
                  console.log(`[VIP-DEEP-SCAN] ${source.name} response: ${response.status}`);
                  
                  if (response.ok) {
                    const data = await response.json();
                    console.log(`[VIP-DEEP-SCAN] ${source.name}: ${data.items?.length || 0} results`);
                    
                    for (const item of data.items || []) {
                      const discovery = extractDiscovery(item, source, name);
                      if (discovery) {
                        discoveries.push(discovery);
                        send({ type: "discovery", data: discovery });
                        
                        // Update terrain analysis
                        updateTerrainAnalysis(terrainAnalysis, discovery, source.category);
                      }
                    }
                  } else {
                    const errorText = await response.text();
                    console.error(`[VIP-DEEP-SCAN] ${source.name} failed: ${errorText.substring(0, 200)}`);
                  }
                } catch (e) {
                  console.error(`[VIP-DEEP-SCAN] Search error for ${source.name}:`, e);
                }
              } else {
                // Simulate for development
                const simulatedDiscoveries = simulateDiscoveries(source, name);
                for (const d of simulatedDiscoveries) {
                  discoveries.push(d);
                  send({ type: "discovery", data: d });
                  updateTerrainAnalysis(terrainAnalysis, d, source.category);
                }
              }

              send({ type: "source_complete", data: { source: source.name } });
            })
          );

          progressPercent += progressPerSource * batch.length;
          send({ type: "progress", data: { percent: Math.round(progressPercent) } });
        }

        // Check for breaches (HIBP)
        if (email && HIBP_API_KEY) {
          send({ type: "source_started", data: { source: "Have I Been Pwned", category: "digital" } });
          try {
            const hibpResponse = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
              headers: {
                "hibp-api-key": HIBP_API_KEY,
                "user-agent": "SilentShield-DeepScan",
              },
            });
            
            if (hibpResponse.ok) {
              const breaches = await hibpResponse.json();
              for (const breach of breaches) {
                const discovery: Discovery = {
                  type: "breach",
                  label: `Breach: ${breach.Name}`,
                  value: `${breach.Title} - ${breach.DataClasses?.join(", ")}`,
                  source: "Have I Been Pwned",
                  confidence: 95,
                  category: "digital",
                  riskLevel: breach.IsSensitive ? "critical" : "high",
                  commentary: `Email appeared in ${breach.Name} breach (${breach.BreachDate}). Exposed: ${breach.DataClasses?.join(", ")}`,
                };
                discoveries.push(discovery);
                send({ type: "discovery", data: discovery });
                terrainAnalysis.digital.attackSurface += 15;
                terrainAnalysis.digital.observations.push(`Credential exposure in ${breach.Name}`);
              }
            } else if (hibpResponse.status !== 404) {
              console.error(`[VIP-DEEP-SCAN] HIBP error: ${hibpResponse.status}`);
            }
          } catch (e) {
            console.error(`[VIP-DEEP-SCAN] HIBP check error:`, e);
          }
          send({ type: "source_complete", data: { source: "Have I Been Pwned" } });
        }

        send({ type: "progress", data: { percent: 45 } });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE II: SIGNAL DETECTION (Days 3-4)
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "signal_detection", label: "Phase II: Signal Detection" } });

        const threatSearches = [
          { name: "Activist Momentum", query: `"${name}" protest OR boycott OR campaign against`, type: "threat" },
          { name: "Criminal Activity", query: `"${name}" fraud OR investigation OR criminal`, type: "threat" },
          { name: "Reputational Risk", query: `"${name}" scandal OR controversy OR criticized`, type: "threat" },
          { name: "Industry Threats", query: `${industry || "executive"} threat OR attack OR targeting`, type: "threat" },
          { name: "Geopolitical", query: `"${name}" sanction OR political OR government`, type: "threat" },
        ];

        for (const source of threatSearches) {
          if (GOOGLE_API_KEY && GOOGLE_CX) {
            try {
              const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
              searchUrl.searchParams.set("key", GOOGLE_API_KEY);
              searchUrl.searchParams.set("cx", GOOGLE_CX);
              searchUrl.searchParams.set("q", source.query);
              searchUrl.searchParams.set("num", "3");
              searchUrl.searchParams.set("dateRestrict", "y1"); // Last year

              const response = await fetch(searchUrl.toString());
              if (response.ok) {
                const data = await response.json();
                if (data.items?.length > 0) {
                  const discovery: Discovery = {
                    type: "threat",
                    label: `${source.name} Signal`,
                    value: data.items[0].title,
                    source: source.name,
                    confidence: Math.min(50 + data.items.length * 10, 85),
                    category: "threat",
                    riskLevel: data.items.length > 2 ? "high" : "medium",
                    commentary: `Found ${data.items.length} recent mentions related to ${source.name.toLowerCase()}`,
                  };
                  discoveries.push(discovery);
                  send({ type: "discovery", data: discovery });
                }
              }
            } catch (e) {
              console.error(`[VIP-DEEP-SCAN] Threat search error:`, e);
            }
          }
        }

        send({ type: "progress", data: { percent: 60 } });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE III-IV: AI ANALYSIS (Days 5-6)
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "analyzing", label: "Phase III-IV: Analysis & Prioritization" } });

        if (LOVABLE_API_KEY && discoveries.length > 0) {
          try {
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
                    content: `You are a Silent Shield™ OSINT analyst conducting a VIP Deep Scan for "${name}". 

Your task is to:
1. Extract structured data from discoveries (social handles, contacts, affiliations)
2. Identify threat vectors and who would benefit from disrupting this person
3. Rank exposures into Tier 1 (immediate), Tier 2 (strategic), Tier 3 (monitoring)
4. Generate analyst commentary explaining the "why" behind each finding

Be specific and actionable. Focus on intelligence value, not generic observations.`,
                  },
                  {
                    role: "user",
                    content: `Analyze these discoveries and provide structured intelligence output:\n\n${JSON.stringify(discoveries.slice(0, 30), null, 2)}`,
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "deep_scan_analysis",
                      description: "Provide comprehensive Deep Scan analysis",
                      parameters: {
                        type: "object",
                        properties: {
                          discoveries: {
                            type: "array",
                            description: "Extracted and enhanced discoveries with field mappings",
                            items: {
                              type: "object",
                              properties: {
                                type: { type: "string", enum: ["social_media", "photo", "news", "property", "corporate", "family", "contact", "breach", "threat", "geospatial", "dependency", "other"] },
                                label: { type: "string" },
                                value: { type: "string" },
                                source: { type: "string" },
                                confidence: { type: "number" },
                                fieldMapping: { type: "string", description: "Form field: socialMediaHandles, knownAliases, corporateAffiliations, primaryEmail, secondaryEmails, vehicles, frequentedLocations, knownAdversaries, industryThreats" },
                                category: { type: "string", enum: ["identity", "physical", "digital", "operational", "threat", "consequence"] },
                                riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                                commentary: { type: "string", description: "Analyst note explaining significance" },
                              },
                              required: ["type", "label", "value", "source", "confidence"],
                            },
                          },
                          terrainSummary: {
                            type: "object",
                            properties: {
                              identityVisibility: { type: "number", description: "0-100 score" },
                              identityObservations: { type: "array", items: { type: "string" } },
                              physicalExposure: { type: "number" },
                              physicalObservations: { type: "array", items: { type: "string" } },
                              digitalAttackSurface: { type: "number" },
                              digitalObservations: { type: "array", items: { type: "string" } },
                              operationalDependencies: { type: "number" },
                              operationalObservations: { type: "array", items: { type: "string" } },
                            },
                          },
                          threatVectors: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                vector: { type: "string" },
                                beneficiary: { type: "string", description: "Who would benefit from exploiting this" },
                                narrative: { type: "string", description: "What narrative could justify targeting" },
                                trigger: { type: "string", description: "What conditions would activate this threat" },
                                momentum: { type: "string", enum: ["rising", "stable", "declining"] },
                                confidence: { type: "number" },
                              },
                              required: ["vector", "beneficiary", "narrative", "trigger", "momentum", "confidence"],
                            },
                          },
                          exposureRanking: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                tier: { type: "number", enum: [1, 2, 3] },
                                exposure: { type: "string" },
                                reason: { type: "string" },
                                exploitMethod: { type: "string" },
                                earlyWarning: { type: "string" },
                                intervention: { type: "string" },
                              },
                              required: ["tier", "exposure", "reason", "exploitMethod", "earlyWarning", "intervention"],
                            },
                          },
                          executiveSummary: { type: "string", description: "3-4 sentence strategic overview for CEO" },
                        },
                        required: ["discoveries", "terrainSummary", "threatVectors", "exposureRanking", "executiveSummary"],
                      },
                    },
                  },
                ],
                tool_choice: { type: "function", function: { name: "deep_scan_analysis" } },
              }),
            });

            if (response.ok) {
              const aiData = await response.json();
              const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
              
              if (toolCall) {
                const analysis = JSON.parse(toolCall.function.arguments);
                
                // Add AI discoveries (deduplicated)
                for (const d of analysis.discoveries || []) {
                  if (!discoveries.some((existing) => existing.value === d.value && existing.type === d.type)) {
                    discoveries.push(d);
                    send({ type: "discovery", data: d });
                  }
                }

                // Send terrain summary
                if (analysis.terrainSummary) {
                  send({ type: "terrain_summary", data: analysis.terrainSummary });
                }

                // Send threat vectors
                for (const threat of analysis.threatVectors || []) {
                  send({ type: "threat_vector", data: threat });
                }

                // Send exposure ranking
                for (const exposure of analysis.exposureRanking || []) {
                  send({ type: "exposure_tier", data: exposure });
                }

                // Send executive summary
                if (analysis.executiveSummary) {
                  send({ type: "executive_summary", data: { summary: analysis.executiveSummary } });
                }
              }
            } else {
              console.error(`[VIP-DEEP-SCAN] AI analysis failed: ${response.status}`);
            }
          } catch (e) {
            console.error("[VIP-DEEP-SCAN] AI analysis error:", e);
          }
        }

        send({ type: "progress", data: { percent: 100 } });
        send({ type: "phase", data: { phase: "complete", label: "Deep Scan Complete" } });
        send({ type: "done", data: { 
          totalDiscoveries: discoveries.length,
          terrainAnalysis,
        }});

        console.log(`[VIP-DEEP-SCAN] ═══════════════════════════════════════════════`);
        console.log(`[VIP-DEEP-SCAN] Scan complete: ${discoveries.length} discoveries`);
        console.log(`[VIP-DEEP-SCAN] ═══════════════════════════════════════════════`);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        console.error("[VIP-DEEP-SCAN] Fatal error:", error);
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

function updateTerrainAnalysis(terrain: TerrainAnalysis, discovery: Discovery, category: string) {
  switch (category) {
    case "identity":
      terrain.identity.visibility += discovery.confidence * 0.3;
      if (discovery.commentary) terrain.identity.observations.push(discovery.commentary);
      break;
    case "physical":
      terrain.physical.exposure += discovery.confidence * 0.3;
      if (discovery.commentary) terrain.physical.observations.push(discovery.commentary);
      break;
    case "digital":
      terrain.digital.attackSurface += discovery.confidence * 0.3;
      if (discovery.commentary) terrain.digital.observations.push(discovery.commentary);
      break;
    case "operational":
      terrain.operational.dependencies += discovery.confidence * 0.3;
      if (discovery.commentary) terrain.operational.observations.push(discovery.commentary);
      break;
  }
}

function extractDiscovery(
  item: { title?: string; link?: string; snippet?: string; pagemap?: any },
  source: { name: string; type: string; category: string },
  targetName: string
): Discovery | null {
  const title = item.title || "";
  const link = item.link || "";
  const snippet = item.snippet || "";

  const nameParts = targetName.toLowerCase().split(" ");
  const contentLower = `${title} ${snippet}`.toLowerCase();
  const matchScore = nameParts.filter((p) => contentLower.includes(p)).length / nameParts.length;
  
  if (matchScore < 0.5) return null;

  let label = title;
  let value = link;
  let fieldMapping: string | undefined;
  let confidence = Math.round(matchScore * 80 + 20);
  let commentary: string | undefined;
  let riskLevel: Discovery["riskLevel"] = "low";

  if (source.name === "LinkedIn") {
    const linkedInMatch = link.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (linkedInMatch) {
      label = `LinkedIn Profile`;
      value = `linkedin.com/in/${linkedInMatch[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = "Professional profile found - reveals career history, connections, and professional network";
    }
  } else if (source.name === "Twitter") {
    const twitterMatch = link.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
    if (twitterMatch && !["search", "hashtag", "intent"].includes(twitterMatch[1])) {
      label = `Twitter/X Profile`;
      value = `@${twitterMatch[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = "Social presence on X - monitor for real-time statements and engagement patterns";
    }
  } else if (source.name === "Facebook") {
    label = "Facebook Profile";
    fieldMapping = "socialMediaHandles";
    commentary = "Personal social profile - may reveal family connections and personal interests";
  } else if (source.name === "Instagram") {
    const igMatch = link.match(/instagram\.com\/([^\/\?]+)/);
    if (igMatch && !["p", "explore", "reel"].includes(igMatch[1])) {
      label = `Instagram Profile`;
      value = `@${igMatch[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = "Visual social media presence - reveals lifestyle and location patterns";
    }
  } else if (source.type === "corporate") {
    const companyPatterns = /(?:CEO|founder|director|president|chairman|executive|partner)\s+(?:of|at)\s+([^,.]+)/i;
    const match = snippet.match(companyPatterns);
    if (match) {
      label = `Corporate: ${match[0]}`;
      value = match[1].trim();
      fieldMapping = "corporateAffiliations";
      confidence = 75;
      commentary = `Corporate role identified - creates operational dependency on ${value}`;
    }
  } else if (source.type === "news") {
    label = `News: ${title.slice(0, 60)}${title.length > 60 ? "..." : ""}`;
    confidence = 60;
    commentary = "Media mention - indicates public visibility level";
  } else if (source.type === "property") {
    label = `Property: ${title.slice(0, 50)}`;
    riskLevel = "medium";
    commentary = "Property record found - reveals physical footprint";
  } else if (source.type === "threat") {
    label = title.slice(0, 60);
    riskLevel = "high";
    commentary = "Potential threat indicator detected";
    fieldMapping = "knownAdversaries";
  }

  return {
    type: source.type as Discovery["type"],
    label,
    value,
    source: source.name,
    confidence,
    fieldMapping,
    category: source.category as Discovery["category"],
    riskLevel,
    commentary,
  };
}

function simulateDiscoveries(source: { name: string; type: string; category: string }, name: string): Discovery[] {
  const discoveries: Discovery[] = [];
  
  const simulations: Record<string, () => Discovery[]> = {
    LinkedIn: () => [{
      type: "social_media",
      label: "LinkedIn Profile",
      value: `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
      source: "LinkedIn",
      confidence: 82,
      fieldMapping: "socialMediaHandles",
      category: "identity",
      riskLevel: "low",
      commentary: "Professional profile reveals career trajectory, current role, and business connections",
    }],
    Twitter: () => [{
      type: "social_media",
      label: "Twitter/X Profile",
      value: `@${name.split(" ")[0].toLowerCase()}`,
      source: "Twitter",
      confidence: 68,
      fieldMapping: "socialMediaHandles",
      category: "identity",
      riskLevel: "low",
      commentary: "Active social presence - real-time sentiment and public statements visible",
    }],
    "Corporate Filings": () => [{
      type: "corporate",
      label: "Corporate Affiliation",
      value: "Tech Ventures Inc.",
      source: "Corporate Filings",
      confidence: 75,
      fieldMapping: "corporateAffiliations",
      category: "operational",
      riskLevel: "medium",
      commentary: "Board position creates operational dependency and public disclosure requirements",
    }],
    Media: () => [{
      type: "news",
      label: "Media Profile Feature",
      value: "Forbes profile piece discussing business philosophy",
      source: "Media",
      confidence: 70,
      category: "identity",
      riskLevel: "low",
      commentary: "High-visibility media coverage increases targeting potential",
    }],
  };

  return simulations[source.name]?.() || [];
}
