/**
 * Report Image Generator
 * 
 * Generates AI-powered visuals for intelligence reports using Gemini Image models.
 * Supports: header images, threat landscape visualizations, situational maps,
 * risk heat maps, and timeline graphics.
 * 
 * Generated images are stored in the osint-media bucket and returned as URLs.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
//  IMAGE GENERATION TYPES
// ═══════════════════════════════════════════════════════════════

export type ReportVisualType = 
  | "header"           // Cinematic header banner for report cover
  | "threat_landscape" // Abstract visualization of the threat environment
  | "situational_map"  // Stylized map showing incident/entity locations
  | "risk_heatmap"     // Visual representation of risk levels
  | "timeline"         // Visual timeline of events
  | "incident_scene";  // Dramatic scene representing an incident type

interface GenerateVisualRequest {
  /** Type of visual to generate */
  type: ReportVisualType;
  /** Report context for prompt construction */
  context: {
    clientName?: string;
    reportTitle?: string;
    threatCategories?: string[];
    locations?: string[];
    riskLevel?: "low" | "moderate" | "elevated" | "high" | "critical";
    incidentTypes?: string[];
    period?: string;
    customPrompt?: string;
  };
  /** Use higher quality model (slower, more expensive) */
  highQuality?: boolean;
  /** Storage path prefix (default: "report-visuals") */
  storagePrefix?: string;
}

interface GenerateVisualResult {
  /** Public URL of generated image */
  imageUrl: string | null;
  /** Base64 data URL fallback */
  base64Url: string | null;
  /** Error message if generation failed */
  error: string | null;
  /** Generation time in ms */
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
//  PROMPT TEMPLATES
// ═══════════════════════════════════════════════════════════════

const STYLE_BASE = "No text, no words, no letters, no watermarks. Ultra high resolution, photorealistic.";

const PROMPT_TEMPLATES: Record<ReportVisualType, (ctx: GenerateVisualRequest["context"]) => string> = {
  header: (ctx) => {
    const threat = ctx.threatCategories?.slice(0, 3).join(", ") || "security intelligence";
    return `A wide cinematic 16:9 header image for a corporate security intelligence report about ${threat}. Dark moody atmosphere, deep navy and charcoal tones with subtle violet accent lighting. Abstract geometric patterns suggesting digital surveillance networks and data analysis overlaid on a cityscape silhouette. Professional, authoritative, ${ctx.riskLevel === "critical" ? "urgent red accent highlights" : "calm controlled tones"}. ${STYLE_BASE}`;
  },

  threat_landscape: (ctx) => {
    const categories = ctx.threatCategories?.join(", ") || "cyber, physical, geopolitical threats";
    const level = ctx.riskLevel || "moderate";
    return `An abstract data visualization representing a threat landscape analysis covering ${categories}. Dark background with glowing interconnected nodes and threat vectors shown as luminous pathways. Risk level: ${level} — ${level === "critical" || level === "high" ? "intense red and amber warning tones, pulsing energy" : "cool blue and teal analytical tones, structured grid"}. Holographic HUD aesthetic, 16:9 aspect ratio. ${STYLE_BASE}`;
  },

  situational_map: (ctx) => {
    const locations = ctx.locations?.slice(0, 5).join(", ") || "North America";
    return `A stylized tactical intelligence map showing the region of ${locations}. Dark satellite-view base with glowing markers at key locations, connecting lines showing relationships, concentric risk zones radiating outward. Military command center aesthetic, topographic contour lines, digital coordinate overlays. Deep blue-black background with cyan and amber tactical markers. 16:9 aspect ratio. ${STYLE_BASE}`;
  },

  risk_heatmap: (ctx) => {
    const level = ctx.riskLevel || "moderate";
    const colorMap = {
      low: "predominantly cool greens and blues",
      moderate: "mixed yellows and light oranges",
      elevated: "warming oranges transitioning to amber",
      high: "intense oranges and reds",
      critical: "deep reds and pulsing crimson hotspots"
    };
    return `An abstract risk heat map visualization, ${colorMap[level]}. Grid-based data visualization with intensity gradients showing threat concentration areas. Dark background, holographic data display aesthetic. Clean geometric layout suggesting professional intelligence analysis. 16:9 aspect ratio. ${STYLE_BASE}`;
  },

  timeline: (ctx) => {
    const period = ctx.period || "the past week";
    return `An abstract timeline visualization spanning ${period}, showing a horizontal flow of events as luminous nodes connected by glowing lines. Dark background, each node pulses with different intensity representing severity. Left-to-right chronological flow, branching pathways showing cascading effects. Futuristic command center data display aesthetic, deep navy with cyan and violet accents. 16:9 aspect ratio. ${STYLE_BASE}`;
  },

  incident_scene: (ctx) => {
    const incidentType = ctx.incidentTypes?.[0] || "security breach";
    const sceneMap: Record<string, string> = {
      "cyber": "Abstract visualization of a digital network breach, data streams fragmenting, firewall barriers cracking with light. Neon blue and red.",
      "physical": "A dramatic wide-angle view of a corporate building perimeter at dusk, security lighting casting long shadows, surveillance cameras visible. Moody atmospheric.",
      "fraud": "Abstract financial data streams with corrupted nodes highlighted in red, flowing through golden transaction pathways. Dark luxury aesthetic.",
      "terrorism": "A stark surveillance-style wide angle of critical infrastructure at twilight, dramatic clouds, security perimeter fencing. Somber, high-contrast.",
      "natural_disaster": "Dramatic wide-angle landscape showing converging weather systems, emergency response lighting in the distance. Epic cinematic scale.",
    };
    const scene = Object.entries(sceneMap).find(([key]) => incidentType.toLowerCase().includes(key))?.[1]
      || `A dramatic cinematic visualization representing a ${incidentType} scenario. Dark atmospheric tones, professional security context.`;
    return `${scene} 16:9 aspect ratio. ${STYLE_BASE}`;
  },
};

// ═══════════════════════════════════════════════════════════════
//  CORE GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Generate an AI-powered visual for a report.
 * Stores the result in the osint-media bucket and returns a URL.
 */
export async function generateReportVisual(
  request: GenerateVisualRequest
): Promise<GenerateVisualResult> {
  const startTime = Date.now();
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return { imageUrl: null, base64Url: null, error: "LOVABLE_API_KEY not configured", durationMs: 0 };
  }

  // Build prompt
  const prompt = request.context.customPrompt || PROMPT_TEMPLATES[request.type](request.context);
  const model = request.highQuality 
    ? "google/gemini-3-pro-image-preview" 
    : "google/gemini-2.5-flash-image";

  console.log(`[ReportVisuals] Generating ${request.type} image via ${model}...`);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ReportVisuals] AI gateway error ${response.status}: ${errText.substring(0, 200)}`);
      return { 
        imageUrl: null, base64Url: null, 
        error: `Image generation failed (${response.status})`, 
        durationMs: Date.now() - startTime 
      };
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      console.warn("[ReportVisuals] No image data in response");
      return { 
        imageUrl: null, base64Url: null, 
        error: "No image generated", 
        durationMs: Date.now() - startTime 
      };
    }

    // Store in osint-media bucket
    const storedUrl = await storeGeneratedImage(imageData, request);
    
    console.log(`[ReportVisuals] ${request.type} image generated in ${Date.now() - startTime}ms`);
    
    return {
      imageUrl: storedUrl,
      base64Url: imageData,
      error: null,
      durationMs: Date.now() - startTime,
    };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ReportVisuals] Generation error: ${errMsg}`);
    return { 
      imageUrl: null, base64Url: null, 
      error: errMsg, 
      durationMs: Date.now() - startTime 
    };
  }
}

/**
 * Generate multiple visuals in parallel for a report.
 */
export async function generateReportVisuals(
  requests: GenerateVisualRequest[]
): Promise<Map<ReportVisualType, GenerateVisualResult>> {
  const results = new Map<ReportVisualType, GenerateVisualResult>();
  
  // Run all generations in parallel
  const promises = requests.map(async (req) => {
    const result = await generateReportVisual(req);
    results.set(req.type, result);
  });

  await Promise.allSettled(promises);
  return results;
}

// ═══════════════════════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════════════════════

async function storeGeneratedImage(
  base64Url: string,
  request: GenerateVisualRequest
): Promise<string | null> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Extract binary from base64 data URL
    const base64Match = base64Url.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!base64Match) return null;

    const imageFormat = base64Match[1];
    const base64Data = base64Match[2];
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const prefix = request.storagePrefix || "report-visuals";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${prefix}/${request.type}_${timestamp}.${imageFormat}`;

    const { error: uploadErr } = await supabase.storage
      .from("osint-media")
      .upload(filename, binaryData, {
        contentType: `image/${imageFormat}`,
        upsert: false,
      });

    if (uploadErr) {
      console.warn(`[ReportVisuals] Storage upload failed: ${uploadErr.message}`);
      return null;
    }

    const { data: pubUrl } = supabase.storage.from("osint-media").getPublicUrl(filename);
    return pubUrl?.publicUrl || null;

  } catch (err) {
    console.warn(`[ReportVisuals] Storage error: ${err}`);
    return null;
  }
}
