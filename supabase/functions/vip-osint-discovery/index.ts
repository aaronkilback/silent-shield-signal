import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Helper: delay between requests
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: fetch with retry and exponential backoff for rate limits
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 1500
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const waitTime = baseDelayMs * Math.pow(2, attempt);
        console.log(`[DEEP-SCAN] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }
      return response;
    } catch (e) {
      lastError = e as Error;
      console.error(`[DEEP-SCAN] Fetch error (attempt ${attempt + 1}):`, e);
      await delay(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastError || new Error("Max retries exceeded");
}

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
  url?: string;
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

function extractDiscovery(item: any, source: any, fullName: string): Discovery | null {
  if (!item.title && !item.snippet) return null;
  
  const title = item.title || "";
  const snippet = item.snippet || "";
  const link = item.link || "";
  
  // Check if result is relevant to the person
  const nameParts = fullName.toLowerCase().split(/\s+/);
  const combinedText = (title + " " + snippet).toLowerCase();
  const hasNameMatch = nameParts.some(part => part.length > 2 && combinedText.includes(part));
  
  if (!hasNameMatch) return null;
  
  // Determine confidence based on match quality
  let confidence = 60;
  if (combinedText.includes(fullName.toLowerCase())) confidence = 90;
  else if (nameParts.filter(p => p.length > 2 && combinedText.includes(p)).length >= 2) confidence = 80;
  
  // Determine risk level based on content
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  const riskIndicators = ["lawsuit", "arrest", "fraud", "scandal", "controversy", "investigation", "breach", "leak"];
  if (riskIndicators.some(ind => combinedText.includes(ind))) {
    riskLevel = "high";
    confidence = Math.min(confidence + 10, 95);
  }
  
  return {
    type: source.type as Discovery["type"],
    label: `${source.name}: ${title.substring(0, 80)}`,
    value: snippet.substring(0, 300),
    source: source.name,
    confidence,
    url: link,
    category: source.category as Discovery["category"],
    riskLevel,
    fieldMapping: getFieldMapping(source.type),
  };
}

function getFieldMapping(type: string): string {
  const mappings: Record<string, string> = {
    social_media: "socialMedia",
    photo: "photos",
    news: "newsArticles",
    property: "properties",
    corporate: "businessInterests",
    family: "familyMembers",
    contact: "contactInfo",
    breach: "previousIncidents",
    threat: "threats",
    geospatial: "locations",
    dependency: "dependencies",
    other: "additionalInfo",
  };
  return mappings[type] || "additionalInfo";
}

function updateTerrainAnalysis(terrain: TerrainAnalysis, discovery: Discovery, category: string): void {
  const scoreIncrement = discovery.confidence * 0.1;
  
  switch (category) {
    case "identity":
      terrain.identity.visibility += scoreIncrement;
      terrain.identity.observations.push(discovery.label);
      break;
    case "physical":
      terrain.physical.exposure += scoreIncrement;
      terrain.physical.observations.push(discovery.label);
      break;
    case "digital":
      terrain.digital.attackSurface += scoreIncrement;
      terrain.digital.observations.push(discovery.label);
      break;
    case "operational":
      terrain.operational.dependencies += scoreIncrement;
      terrain.operational.observations.push(discovery.label);
      break;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

        if (!name || name.trim().length < 2) {
          send({ type: "error", data: { message: "Name is required (minimum 2 characters)" } });
          controller.close();
          return;
        }

        const fullName = name.trim();
        const nameParts = fullName.split(/\s+/);
        const firstName = nameParts[0] || fullName;
        const lastName = nameParts[nameParts.length - 1] || "";
        
        const GOOGLE_API_KEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
        const GOOGLE_CX = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        const HIBP_API_KEY = Deno.env.get("HIBP_API_KEY");

        console.log(`[DEEP-SCAN] ════════════════════════════════════════════════════`);
        console.log(`[DEEP-SCAN] Silent Shield™ 7-Day Protocol for: "${fullName}"`);
        console.log(`[DEEP-SCAN] Name parts: first="${firstName}" last="${lastName}"`);
        console.log(`[DEEP-SCAN] Industry: ${industry || "not specified"}`);
        console.log(`[DEEP-SCAN] Google API: ${!!GOOGLE_API_KEY && !!GOOGLE_CX ? "configured" : "NOT configured"}`);
        console.log(`[DEEP-SCAN] Lovable AI: ${!!LOVABLE_API_KEY ? "configured" : "NOT configured"}`);
        console.log(`[DEEP-SCAN] ════════════════════════════════════════════════════`);

        const discoveries: Discovery[] = [];
        const terrainAnalysis: TerrainAnalysis = {
          identity: { visibility: 0, observations: [] },
          physical: { exposure: 0, observations: [] },
          digital: { attackSurface: 0, observations: [] },
          operational: { dependencies: 0, observations: [] },
        };

        // PHASE I: TERRAIN MAPPING
        send({ type: "phase", data: { phase: "terrain_mapping", label: "Phase I: Terrain Mapping" } });
        send({ type: "domain", data: { domain: "identity", label: "Identity & Visibility Footprint" } });

        // Build targeted search sources
        const identitySources = [
          { name: "LinkedIn", query: `site:linkedin.com/in "${fullName}"`, type: "social_media", category: "identity" },
          { name: "Twitter/X", query: `site:twitter.com "${fullName}" OR site:x.com "${fullName}"`, type: "social_media", category: "identity" },
          { name: "Wikipedia", query: `site:wikipedia.org "${fullName}"`, type: "news", category: "identity" },
          { name: "Crunchbase", query: `site:crunchbase.com/person "${fullName}"`, type: "corporate", category: "identity" },
          { name: "Forbes", query: `site:forbes.com "${fullName}"`, type: "news", category: "identity" },
        ];

        const contactSources = [
          { name: "Email Discovery", query: `"${fullName}" email contact "@"`, type: "contact", category: "identity" },
          { name: "Company Contact", query: `"${fullName}" contact phone email CEO founder`, type: "contact", category: "identity" },
        ];

        const physicalSources = [
          { name: "Property Records", query: `"${fullName}" property owner OR deed OR real estate`, type: "property", category: "physical" },
          { name: "Conference Appearances", query: `"${fullName}" speaking OR keynote 2024 OR 2025`, type: "news", category: "physical" },
        ];

        const digitalSources = [
          { name: "GitHub", query: `site:github.com "${fullName}"`, type: "social_media", category: "digital" },
          { name: "Domain Records", query: `"${fullName}" domain owner OR WHOIS`, type: "other", category: "digital" },
        ];

        const operationalSources = [
          { name: "SEC Filings", query: `site:sec.gov "${fullName}"`, type: "corporate", category: "operational" },
          { name: "Company Leadership", query: `"${fullName}" CEO OR founder OR "chief executive"`, type: "corporate", category: "operational" },
          { name: "Board Positions", query: `"${fullName}" board director OR advisory`, type: "corporate", category: "operational" },
        ];

        const emailSources = email ? [
          { name: "Email Accounts", query: `"${email}" OR "${email.split('@')[0]}"`, type: "contact", category: "digital" },
        ] : [];

        const locationSources = location ? [
          { name: "Location Property", query: `"${fullName}" "${location}" property`, type: "property", category: "physical" },
        ] : [];

        const allSources = [
          ...identitySources, 
          ...contactSources, 
          ...physicalSources, 
          ...digitalSources, 
          ...operationalSources,
          ...emailSources,
          ...locationSources,
        ];
        
        const progressPerSource = 50 / allSources.length;
        let progressPercent = 0;

        // Execute searches
        for (let i = 0; i < allSources.length; i++) {
          const source = allSources[i];
          send({ type: "source_started", data: { source: source.name, category: source.category } });

          if (GOOGLE_API_KEY && GOOGLE_CX) {
            try {
              const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
              searchUrl.searchParams.set("key", GOOGLE_API_KEY);
              searchUrl.searchParams.set("cx", GOOGLE_CX);
              searchUrl.searchParams.set("q", source.query);
              searchUrl.searchParams.set("num", "5");

              console.log(`[DEEP-SCAN] ${source.name}: "${source.query}"`);
              const response = await fetchWithRetry(searchUrl.toString(), { method: 'GET' }, 2, 1000);
              
              if (response.ok) {
                const data = await response.json();
                const items = data.items || [];
                console.log(`[DEEP-SCAN] ${source.name}: ${items.length} results`);
                
                for (const item of items) {
                  const discovery = extractDiscovery(item, source, fullName);
                  if (discovery) {
                    discoveries.push(discovery);
                    send({ type: "discovery", data: discovery });
                    updateTerrainAnalysis(terrainAnalysis, discovery, source.category);
                  }
                }
              } else {
                console.error(`[DEEP-SCAN] ${source.name} failed: ${response.status}`);
              }
            } catch (e) {
              console.error(`[DEEP-SCAN] ${source.name} error:`, e);
            }
          }

          send({ type: "source_complete", data: { source: source.name } });
          progressPercent += progressPerSource;
          send({ type: "progress", data: { percent: Math.round(progressPercent) } });
          
          if (i < allSources.length - 1 && GOOGLE_API_KEY) {
            await delay(200);
          }
        }

        // HIBP Breach Check
        if (email && HIBP_API_KEY) {
          send({ type: "domain", data: { domain: "dark_web", label: "Dark Web & Breach Intelligence" } });
          send({ type: "source_started", data: { source: "Have I Been Pwned", category: "digital" } });
          
          try {
            const hibpResponse = await fetch(
              `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
              {
                headers: {
                  "hibp-api-key": HIBP_API_KEY,
                  "user-agent": "SilentShield-DeepScan",
                },
              }
            );
            
            if (hibpResponse.ok) {
              const breaches = await hibpResponse.json();
              console.log(`[DEEP-SCAN] HIBP: ${breaches.length} breaches found for ${email}`);
              
              for (const breach of breaches) {
                const dataClasses = breach.DataClasses || [];
                const hasCriticalData = dataClasses.some((dc: string) => 
                  /password|credit|financial|ssn|social security|passport|bank/i.test(dc)
                );
                const discovery: Discovery = {
                  type: "breach",
                  label: `🔓 BREACH: ${breach.Name}`,
                  value: `${breach.Title} - Data exposed: ${dataClasses.slice(0, 5).join(", ")}`,
                  source: "Have I Been Pwned",
                  confidence: 98,
                  category: "digital",
                  riskLevel: hasCriticalData ? "critical" : "high",
                  fieldMapping: "previousIncidents",
                  commentary: `CONFIRMED BREACH: Email compromised in ${breach.Name} (${breach.BreachDate}).`,
                };
                discoveries.push(discovery);
                send({ type: "discovery", data: discovery });
                terrainAnalysis.digital.attackSurface += hasCriticalData ? 35 : 20;
              }
            } else if (hibpResponse.status === 404) {
              console.log(`[DEEP-SCAN] HIBP: No breaches found for ${email}`);
            }
          } catch (e) {
            console.error(`[DEEP-SCAN] HIBP check error:`, e);
          }
          send({ type: "source_complete", data: { source: "Have I Been Pwned" } });
        }

        // AI Analysis Phase
        send({ type: "phase", data: { phase: "ai_analysis", label: "Phase II: AI Analysis" } });
        send({ type: "progress", data: { percent: 75 } });

        let aiAnalysis = null;
        if (LOVABLE_API_KEY && discoveries.length > 0) {
          try {
            const analysisPrompt = `You are a corporate security intelligence analyst conducting a VIP deep scan. Analyze these OSINT discoveries for ${fullName}:

DISCOVERIES:
${JSON.stringify(discoveries.slice(0, 30), null, 2)}

TERRAIN ANALYSIS:
${JSON.stringify(terrainAnalysis, null, 2)}

Provide a structured security assessment:
1. EXECUTIVE SUMMARY (2-3 sentences)
2. KEY FINDINGS (top 5 discoveries with security implications)
3. RISK ASSESSMENT (overall risk level: low/medium/high/critical with rationale)
4. DIGITAL FOOTPRINT SCORE (0-100)
5. RECOMMENDATIONS (top 3 security recommendations)

Be direct and actionable.`;

            const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: "You are a corporate security intelligence analyst." },
                  { role: "user", content: analysisPrompt }
                ],
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              aiAnalysis = aiData.choices?.[0]?.message?.content || null;
              send({ type: "ai_analysis", data: { analysis: aiAnalysis } });
            }
          } catch (e) {
            console.error("[DEEP-SCAN] AI analysis error:", e);
          }
        }

        send({ type: "progress", data: { percent: 100 } });

        // Final report
        send({
          type: "complete",
          data: {
            discoveries,
            terrainAnalysis,
            aiAnalysis,
            summary: {
              total_discoveries: discoveries.length,
              high_risk_count: discoveries.filter(d => d.riskLevel === "high" || d.riskLevel === "critical").length,
              categories: {
                identity: terrainAnalysis.identity.observations.length,
                physical: terrainAnalysis.physical.observations.length,
                digital: terrainAnalysis.digital.observations.length,
                operational: terrainAnalysis.operational.observations.length,
              },
            },
          },
        });

        controller.close();
      } catch (error) {
        console.error("[DEEP-SCAN] Critical error:", error);
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
      "Connection": "keep-alive",
    },
  });
});
