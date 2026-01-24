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

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE I: TERRAIN MAPPING - Identity & Visibility
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "terrain_mapping", label: "Phase I: Terrain Mapping" } });
        send({ type: "domain", data: { domain: "identity", label: "Identity & Visibility Footprint" } });

        // Build targeted search sources - use FULL NAME in quotes
        const identitySources = [
          { name: "LinkedIn", query: `site:linkedin.com/in "${fullName}"`, type: "social_media", category: "identity" },
          { name: "Twitter/X", query: `site:twitter.com "${fullName}" OR site:x.com "${fullName}"`, type: "social_media", category: "identity" },
          { name: "Wikipedia", query: `site:wikipedia.org "${fullName}"`, type: "news", category: "identity" },
          { name: "Crunchbase", query: `site:crunchbase.com/person "${fullName}"`, type: "corporate", category: "identity" },
          { name: "Forbes", query: `site:forbes.com "${fullName}"`, type: "news", category: "identity" },
          { name: "YouTube", query: `site:youtube.com "${fullName}" interview OR podcast OR keynote`, type: "social_media", category: "identity" },
          { name: "TED", query: `site:ted.com "${fullName}"`, type: "news", category: "identity" },
          { name: "Instagram", query: `site:instagram.com "${fullName}"`, type: "social_media", category: "identity" },
          { name: "Facebook", query: `site:facebook.com "${fullName}"`, type: "social_media", category: "identity" },
        ];

        // Contact & Email discovery sources
        send({ type: "domain", data: { domain: "contact", label: "Contact Information Discovery" } });
        const contactSources = [
          { name: "Email Discovery", query: `"${fullName}" email contact "@" site:linkedin.com OR site:crunchbase.com`, type: "contact", category: "identity" },
          { name: "Company Contact", query: `"${fullName}" contact phone email CEO founder`, type: "contact", category: "identity" },
          { name: "Speaker Bio", query: `"${fullName}" speaker bio contact email`, type: "contact", category: "identity" },
          { name: "Press Contact", query: `"${fullName}" press media contact email`, type: "contact", category: "identity" },
        ];

        // Physical & Geographic sources
        send({ type: "domain", data: { domain: "physical", label: "Physical & Geographic Exposure" } });
        const physicalSources = [
          { name: "Property Records", query: `"${fullName}" property owner OR deed OR real estate`, type: "property", category: "physical" },
          { name: "Conference Appearances", query: `"${fullName}" speaking OR keynote OR conference 2024 OR 2025`, type: "news", category: "physical" },
          { name: "Office Locations", query: `"${fullName}" office headquarters address`, type: "property", category: "physical" },
          { name: "Location Mentions", query: `"${fullName}" "lives in" OR "based in" OR "resides in"`, type: "property", category: "physical" },
        ];

        // Digital Surface sources
        send({ type: "domain", data: { domain: "digital", label: "Digital & Data Surface" } });
        const digitalSources = [
          { name: "GitHub", query: `site:github.com "${fullName}"`, type: "social_media", category: "digital" },
          { name: "Domain Records", query: `"${fullName}" domain owner OR registered OR WHOIS`, type: "other", category: "digital" },
          { name: "Breach News", query: `"${fullName}" data breach OR leak OR exposed`, type: "breach", category: "digital" },
          { name: "Podcast Appearances", query: `"${fullName}" podcast guest OR interview`, type: "news", category: "digital" },
        ];

        // Operational Dependencies sources
        send({ type: "domain", data: { domain: "operational", label: "Operational Dependencies" } });
        const operationalSources = [
          { name: "SEC Filings", query: `site:sec.gov "${fullName}"`, type: "corporate", category: "operational" },
          { name: "Company Leadership", query: `"${fullName}" CEO OR founder OR "chief executive" OR chairman`, type: "corporate", category: "operational" },
          { name: "Board Positions", query: `"${fullName}" board director OR board member OR advisory`, type: "corporate", category: "operational" },
          { name: "Investments", query: `"${fullName}" investor OR invested OR portfolio company`, type: "corporate", category: "operational" },
          { name: "Legal", query: `"${fullName}" lawsuit OR litigation OR plaintiff OR defendant`, type: "news", category: "operational" },
        ];

        // If we have email hint, search for related accounts
        const emailSources = email ? [
          { name: "Email Accounts", query: `"${email}" OR "${email.split('@')[0]}"`, type: "contact", category: "digital" },
        ] : [];

        // If we have location, enhance property search
        const locationSources = location ? [
          { name: "Location Property", query: `"${fullName}" "${location}" property OR address OR residence`, type: "property", category: "physical" },
        ] : [];

        // If we have social handles, verify and expand
        const handleSources = socialMediaHandles ? 
          socialMediaHandles.split(/[\n,]+/).filter(h => h.trim()).slice(0, 3).map((handle, i) => ({
            name: `Handle Verify ${i + 1}`,
            query: `"${handle.trim()}" "${fullName}"`,
            type: "social_media",
            category: "digital",
          })) : [];

        const allSources = [
          ...identitySources, 
          ...contactSources, 
          ...physicalSources, 
          ...digitalSources, 
          ...operationalSources,
          ...emailSources,
          ...locationSources,
          ...handleSources,
        ];
        const progressPerSource = 50 / allSources.length;
        let progressPercent = 0;

        // Execute searches in batches of 4
        for (let i = 0; i < allSources.length; i += 4) {
          const batch = allSources.slice(i, i + 4);
          
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

                  console.log(`[DEEP-SCAN] ${source.name}: "${source.query}"`);
                  const response = await fetch(searchUrl.toString());
                  
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
            })
          );

          progressPercent += progressPerSource * batch.length;
          send({ type: "progress", data: { percent: Math.round(progressPercent) } });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE I.5: BREACH CHECK (HIBP)
        // ═══════════════════════════════════════════════════════════════════════
        if (email && HIBP_API_KEY) {
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
                const discovery: Discovery = {
                  type: "breach",
                  label: `Breach: ${breach.Name}`,
                  value: `${breach.Title} - Data exposed: ${(breach.DataClasses || []).slice(0, 5).join(", ")}`,
                  source: "Have I Been Pwned",
                  confidence: 95,
                  category: "digital",
                  riskLevel: breach.IsSensitive ? "critical" : "high",
                  commentary: `Email "${email}" appeared in the ${breach.Name} breach (${breach.BreachDate}). This may enable credential stuffing or spear-phishing attacks.`,
                };
                discoveries.push(discovery);
                send({ type: "discovery", data: discovery });
                terrainAnalysis.digital.attackSurface += 20;
                terrainAnalysis.digital.observations.push(`Credential exposure in ${breach.Name}`);
              }
            } else if (hibpResponse.status === 404) {
              console.log(`[DEEP-SCAN] HIBP: No breaches found for ${email}`);
            } else {
              console.error(`[DEEP-SCAN] HIBP error: ${hibpResponse.status}`);
            }
          } catch (e) {
            console.error(`[DEEP-SCAN] HIBP check error:`, e);
          }
          send({ type: "source_complete", data: { source: "Have I Been Pwned" } });
        }

        send({ type: "progress", data: { percent: 55 } });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE II: SIGNAL DETECTION - Threat Momentum
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "signal_detection", label: "Phase II: Signal Detection" } });

        const threatSearches = [
          { name: "Activist Targeting", query: `"${fullName}" protest OR boycott OR "campaign against"`, type: "threat" },
          { name: "Controversy", query: `"${fullName}" scandal OR controversy OR accused OR criticized`, type: "threat" },
          { name: "Legal Risk", query: `"${fullName}" lawsuit OR sued OR investigation`, type: "threat" },
          { name: "Security Incidents", query: `"${fullName}" hacked OR security breach OR attacked`, type: "threat" },
        ];

        // Industry-specific threats if industry is provided
        if (industry) {
          threatSearches.push({
            name: "Industry Threats",
            query: `"${industry}" threat OR attack OR targeting executives`,
            type: "threat",
          });
        }

        for (const source of threatSearches) {
          if (GOOGLE_API_KEY && GOOGLE_CX) {
            try {
              const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
              searchUrl.searchParams.set("key", GOOGLE_API_KEY);
              searchUrl.searchParams.set("cx", GOOGLE_CX);
              searchUrl.searchParams.set("q", source.query);
              searchUrl.searchParams.set("num", "3");
              searchUrl.searchParams.set("dateRestrict", "y1");

              console.log(`[DEEP-SCAN] Threat: ${source.name}`);
              const response = await fetch(searchUrl.toString());
              
              if (response.ok) {
                const data = await response.json();
                const items = data.items || [];
                
                if (items.length > 0) {
                  const discovery: Discovery = {
                    type: "threat",
                    label: `${source.name} Signal`,
                    value: items[0].title || source.name,
                    url: items[0].link,
                    source: source.name,
                    confidence: Math.min(50 + items.length * 15, 85),
                    category: "threat",
                    riskLevel: items.length >= 3 ? "high" : "medium",
                    commentary: `Found ${items.length} recent result(s) related to ${source.name.toLowerCase()}. Review for actionable threat intelligence.`,
                  };
                  discoveries.push(discovery);
                  send({ type: "discovery", data: discovery });
                }
              }
            } catch (e) {
              console.error(`[DEEP-SCAN] Threat search error:`, e);
            }
          }
        }

        send({ type: "progress", data: { percent: 70 } });

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE III-IV: AI ANALYSIS & PRIORITIZATION
        // ═══════════════════════════════════════════════════════════════════════
        send({ type: "phase", data: { phase: "analyzing", label: "Phase III-IV: AI Analysis" } });

        if (LOVABLE_API_KEY && discoveries.length > 0) {
          try {
            console.log(`[DEEP-SCAN] AI Analysis: Processing ${discoveries.length} discoveries`);
            
            // Prepare a summary of discoveries for AI
            const discoverySummary = discoveries.slice(0, 25).map(d => ({
              type: d.type,
              label: d.label,
              value: d.value,
              source: d.source,
              category: d.category,
              riskLevel: d.riskLevel,
            }));

            const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                    content: `You are a Silent Shield™ intelligence analyst conducting a VIP Deep Scan for a high-net-worth individual named "${fullName}". Industry: ${industry || "not specified"}.

Your task is to analyze OSINT discoveries and produce:
1. Terrain summary scores (0-100) for: Identity Visibility, Physical Exposure, Digital Attack Surface, Operational Dependencies
2. Key observations for each terrain domain
3. Threat vectors with beneficiaries and triggers
4. Prioritized exposures ranked by Tier (1=immediate, 2=strategic, 3=monitoring)
5. Executive summary (3-4 sentences)

Be specific and actionable. Focus on intelligence value for protective operations.`,
                  },
                  {
                    role: "user",
                    content: `Analyze these ${discoveries.length} OSINT discoveries for "${fullName}" and return a structured JSON analysis:

${JSON.stringify(discoverySummary, null, 2)}

Return ONLY valid JSON in this exact format:
{
  "terrainSummary": {
    "identityVisibility": <0-100>,
    "identityObservations": ["observation1", "observation2"],
    "physicalExposure": <0-100>,
    "physicalObservations": ["observation1"],
    "digitalAttackSurface": <0-100>,
    "digitalObservations": ["observation1"],
    "operationalDependencies": <0-100>,
    "operationalObservations": ["observation1"]
  },
  "threatVectors": [
    {
      "vector": "threat name",
      "beneficiary": "who benefits",
      "narrative": "justification for targeting",
      "trigger": "activation condition",
      "momentum": "rising|stable|declining",
      "confidence": <0-100>
    }
  ],
  "exposureRanking": [
    {
      "tier": 1,
      "exposure": "exposure name",
      "reason": "why it exists",
      "exploitMethod": "how it could be exploited",
      "earlyWarning": "what signals would appear",
      "intervention": "what would neutralize it"
    }
  ],
  "executiveSummary": "3-4 sentence strategic overview"
}`,
                  },
                ],
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const content = aiData.choices?.[0]?.message?.content;
              
              if (content) {
                // Extract JSON from the response
                let analysis;
                try {
                  // Try to parse directly first
                  analysis = JSON.parse(content);
                } catch {
                  // Try to extract JSON from markdown code block
                  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    analysis = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                  }
                }

                if (analysis) {
                  console.log(`[DEEP-SCAN] AI Analysis: Parsed successfully`);
                  
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
                } else {
                  console.error(`[DEEP-SCAN] AI Analysis: Could not parse response`);
                }
              }
            } else {
              const errorText = await aiResponse.text();
              console.error(`[DEEP-SCAN] AI Analysis failed: ${aiResponse.status} - ${errorText.substring(0, 200)}`);
            }
          } catch (e) {
            console.error("[DEEP-SCAN] AI Analysis error:", e);
          }
        }

        send({ type: "progress", data: { percent: 100 } });
        send({ type: "phase", data: { phase: "complete", label: "Deep Scan Complete" } });
        send({ type: "done", data: { 
          totalDiscoveries: discoveries.length,
          terrainAnalysis,
        }});

        console.log(`[DEEP-SCAN] ════════════════════════════════════════════════════`);
        console.log(`[DEEP-SCAN] Complete: ${discoveries.length} discoveries for "${fullName}"`);
        console.log(`[DEEP-SCAN] ════════════════════════════════════════════════════`);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        console.error("[DEEP-SCAN] Fatal error:", error);
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
  const score = discovery.confidence * 0.3;
  switch (category) {
    case "identity":
      terrain.identity.visibility += score;
      if (discovery.commentary) terrain.identity.observations.push(discovery.commentary);
      break;
    case "physical":
      terrain.physical.exposure += score;
      if (discovery.commentary) terrain.physical.observations.push(discovery.commentary);
      break;
    case "digital":
      terrain.digital.attackSurface += score;
      if (discovery.commentary) terrain.digital.observations.push(discovery.commentary);
      break;
    case "operational":
      terrain.operational.dependencies += score;
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

  // Score name match - require at least partial match
  const nameParts = targetName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
  const contentLower = `${title} ${snippet}`.toLowerCase();
  const matchCount = nameParts.filter(p => contentLower.includes(p)).length;
  const matchScore = matchCount / Math.max(nameParts.length, 1);
  
  // Require at least 50% name match (e.g., first OR last name)
  if (matchScore < 0.5) {
    return null;
  }

  let label = title;
  let value = link;
  let fieldMapping: string | undefined;
  let confidence = Math.round(matchScore * 70 + 30);
  let commentary: string | undefined;
  let riskLevel: Discovery["riskLevel"] = "low";

  // Platform-specific extraction
  if (source.name === "LinkedIn") {
    const match = link.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (match) {
      label = `LinkedIn Profile`;
      value = `linkedin.com/in/${match[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = `Professional profile found for ${targetName}. Reveals career history, connections, and endorsements.`;
      confidence = Math.max(confidence, 85);
    }
  } else if (source.name === "Twitter/X") {
    const match = link.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
    if (match && !["search", "hashtag", "intent", "home", "explore", "i"].includes(match[1])) {
      label = `Twitter/X: @${match[1]}`;
      value = `@${match[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = `Active social presence on X. Monitor for real-time statements, engagements, and sentiment.`;
      confidence = Math.max(confidence, 80);
    }
  } else if (source.name === "Instagram") {
    const match = link.match(/instagram\.com\/([^\/\?]+)/);
    if (match && !["p", "explore", "reel", "stories", "accounts"].includes(match[1])) {
      label = `Instagram: @${match[1]}`;
      value = `@${match[1]}`;
      fieldMapping = "socialMediaHandles";
      commentary = `Visual social media presence. May reveal lifestyle, locations, and personal network.`;
      confidence = Math.max(confidence, 75);
    }
  } else if (source.name === "Facebook") {
    label = "Facebook Profile";
    fieldMapping = "socialMediaHandles";
    commentary = "Personal social profile. May expose family connections, events, and personal interests.";
  } else if (source.name === "YouTube") {
    label = `YouTube: ${title.slice(0, 50)}`;
    commentary = "Video content presence. Public appearances and statements available.";
  } else if (source.name === "Wikipedia") {
    label = "Wikipedia Article";
    commentary = `Subject has Wikipedia presence indicating notable public figure status. High visibility target.`;
    confidence = Math.max(confidence, 90);
    riskLevel = "medium";
  } else if (source.name === "Crunchbase") {
    label = "Crunchbase Profile";
    fieldMapping = "corporateAffiliations";
    commentary = "Business profile with funding, investments, and corporate relationships exposed.";
    confidence = Math.max(confidence, 85);
  } else if (source.name === "Forbes" || source.name === "TED") {
    label = `${source.name}: ${title.slice(0, 50)}`;
    commentary = `High-visibility media presence on ${source.name}. Increases targeting potential.`;
    riskLevel = "medium";
  } else if (source.name === "SEC Filings") {
    label = "SEC Filing";
    fieldMapping = "corporateAffiliations";
    commentary = "Public company disclosure. Reveals compensation, holdings, and corporate role.";
    riskLevel = "medium";
  } else if (source.name.includes("Board") || source.name.includes("Leadership") || source.name.includes("Company")) {
    label = `Corporate: ${title.slice(0, 50)}`;
    fieldMapping = "corporateAffiliations";
    commentary = "Corporate leadership role identified. Creates operational dependency and public exposure.";
  } else if (source.name.includes("Email") || source.name.includes("Contact") || source.name.includes("Speaker") || source.name.includes("Press")) {
    // Extract email addresses from content
    const emailMatch = `${title} ${snippet}`.match(/[\w.-]+@[\w.-]+\.\w+/gi);
    const phoneMatch = `${title} ${snippet}`.match(/(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g);
    
    if (emailMatch && emailMatch.length > 0) {
      const foundEmail = emailMatch[0].toLowerCase();
      label = `Email: ${foundEmail}`;
      value = foundEmail;
      fieldMapping = "primaryEmail";
      commentary = `Contact email discovered. May be used for breach monitoring and account correlation.`;
      confidence = Math.max(confidence, 75);
    } else if (phoneMatch && phoneMatch.length > 0) {
      label = `Phone: ${phoneMatch[0]}`;
      value = phoneMatch[0];
      fieldMapping = "primaryPhone";
      commentary = `Contact phone discovered. Verify and add to monitoring.`;
      confidence = Math.max(confidence, 70);
    } else {
      label = `Contact Info: ${title.slice(0, 40)}`;
      commentary = "Potential contact information source. Review for details.";
    }
  } else if (source.name.includes("Location") || source.type === "property") {
    // Extract location/address patterns
    const locationPattern = /(?:lives?\s+in|based\s+in|resides?\s+in|located\s+in|from)\s+([A-Z][a-zA-Z\s,]+(?:USA|Canada|UK|US|CA)?)/gi;
    const locationMatch = `${title} ${snippet}`.match(locationPattern);
    
    if (locationMatch) {
      label = `Location: ${locationMatch[0].slice(0, 40)}`;
      commentary = "Geographic location identified. Add to physical exposure assessment.";
      riskLevel = "medium";
    } else {
      label = `Property: ${title.slice(0, 40)}`;
      riskLevel = "medium";
      commentary = "Real estate record found. Physical footprint exposed.";
    }
  } else if (source.type === "threat") {
    label = title.slice(0, 60);
    riskLevel = "high";
    commentary = "Potential threat indicator. Requires analyst review.";
    fieldMapping = "knownAdversaries";
  } else if (source.type === "news") {
    label = `News: ${title.slice(0, 50)}`;
    commentary = "Media coverage increases visibility and may contain operational details.";
  }

  return {
    type: source.type as Discovery["type"],
    label,
    value,
    url: link,
    source: source.name,
    confidence,
    fieldMapping,
    category: source.category as Discovery["category"],
    riskLevel,
    commentary,
  };
}
