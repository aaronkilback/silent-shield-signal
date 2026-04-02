import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface GenerateBriefingRequest {
  consortium_id: string;
  product_type: string;
  period_days: number;
  classification: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const body: GenerateBriefingRequest = await req.json();
    const { consortium_id, product_type, period_days, classification } = body;

    // Fetch consortium details
    const { data: consortium, error: consortiumError } = await supabase
      .from("consortia")
      .select("*")
      .eq("id", consortium_id)
      .single();

    if (consortiumError) {
      throw new Error(`Consortium not found: ${consortiumError.message}`);
    }

    // Fetch shared incidents for the period
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - period_days);

    const { data: sharedIncidents } = await supabase
      .from("shared_incidents")
      .select("*")
      .eq("consortium_id", consortium_id)
      .gte("shared_at", periodStart.toISOString())
      .order("shared_at", { ascending: false });

    const { data: sharedSignals } = await supabase
      .from("shared_signals")
      .select("*")
      .eq("consortium_id", consortium_id)
      .gte("shared_at", periodStart.toISOString())
      .order("shared_at", { ascending: false });

    // Build context for the briefing
    const incidentSummary = sharedIncidents?.map(i => ({
      title: i.title,
      region: i.region,
      severity: i.severity,
      threat_category: i.threat_category,
      occurred_at: i.occurred_at,
    })) || [];

    const signalSummary = sharedSignals?.map(s => ({
      title: s.title,
      region: s.region,
      threat_type: s.threat_type,
      confidence_level: s.confidence_level,
    })) || [];

    // Generate briefing using Lovable AI Gateway
    const productTypePrompts: Record<string, string> = {
      blof: `Generate a Business Level Operational Focus (BLOF) report. This is an executive summary focused on:
- Key operational impacts and business risks
- Resource allocation recommendations
- Strategic decision points
Keep it concise (500-800 words), executive-friendly, with clear recommendations.`,

      intel_briefing: `Generate a detailed Intelligence Briefing following the SFIF standard with sections:
1. Core Signal - Primary threat/opportunity
2. Key Observations - 3-5 bullet points
3. Analytical Assessment (Momentum/Confidence/Readiness)
4. Near-Term Outlook (48-72 hours)
5. Operational Implications
6. Recommended Actions (Primary/Secondary/Baseline)
7. Escalation Triggers
8. Executive Summary (2-3 sentences)
Use measured, probability-based language. Avoid alarmist phrasing.`,

      incident_digest: `Generate an Incident Digest summarizing recent incidents:
- Incident count by category
- Geographic distribution
- Severity breakdown
- Notable patterns or trends
- Recommended awareness items
Format as a quick-reference document for security teams.`,

      threat_assessment: `Generate a formal Threat Assessment including:
- Threat actors and their capabilities
- Intent analysis
- Vulnerability exposure
- Probability assessment
- Impact analysis
- Risk rating matrix
- Recommended mitigations`,

      situational_report: `Generate a Situational Report (SITREP):
- Current situation overview
- Recent developments
- Active threats
- Resource status
- Recommended actions
- Next reporting period focus`,

      warning_order: `Generate a Warning Order (WARNORD):
- Situation
- Nature of the operation/threat
- Time of event
- Units involved
- Reconnaissance to be conducted
- Initial timeline
- Instructions`,

      flash_report: `Generate a FLASH (urgent priority) intelligence traffic:
- IMMEDIATE attention required
- Core threat/situation
- Required actions NOW
- Who needs to know
- Timeline critical information
Keep under 200 words - this is urgent communication.`,
    };

    const systemPrompt = `You are a senior intelligence analyst producing classified intelligence products for an energy sector security consortium. Your audience is security directors and executives at major energy companies.

Consortium: ${consortium.name}
Region: ${consortium.region || "Not specified"}
Sector: ${consortium.sector}
Classification: ${classification}

Reporting Period: Last ${period_days} days

${productTypePrompts[product_type] || productTypePrompts.intel_briefing}

Important guidelines:
- Use professional, measured language
- Include specific data points from the provided incidents and signals
- Avoid speculation - stick to assessed facts
- Include confidence levels where appropriate
- Format for executive readability
- Include the classification marking at the top and bottom`;

    const userPrompt = `Generate the ${product_type.replace('_', ' ')} based on the following intelligence data:

SHARED INCIDENTS (${incidentSummary.length} total):
${JSON.stringify(incidentSummary, null, 2)}

SHARED SIGNALS (${signalSummary.length} total):
${JSON.stringify(signalSummary, null, 2)}

If there are no incidents or signals, generate a report noting the quiet period but maintaining vigilance for emerging threats in the ${consortium.region || "operational"} area.`;

    const aiResult = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      functionName: "generate-consortium-briefing",
      extraBody: { temperature: 0.7, max_tokens: 2500 },
    });

    if (aiResult.error) {
      throw new Error(`AI Gateway error: ${aiResult.error}`);
    }

    const generatedContent = aiResult.content || "";

    // Convert to basic HTML
    const contentHtml = generatedContent
      .split("\n\n")
      .map((p: string) => {
        if (p.startsWith("# ")) return `<h1 class="text-xl font-bold mb-3">${p.slice(2)}</h1>`;
        if (p.startsWith("## ")) return `<h2 class="text-lg font-semibold mb-2">${p.slice(3)}</h2>`;
        if (p.startsWith("### ")) return `<h3 class="font-semibold mb-2">${p.slice(4)}</h3>`;
        if (p.startsWith("- ")) return `<ul class="list-disc pl-5 mb-3">${p.split("\n").map((li: string) => `<li>${li.slice(2)}</li>`).join("")}</ul>`;
        if (p.match(/^\d+\./)) return `<ol class="list-decimal pl-5 mb-3">${p.split("\n").map((li: string) => `<li>${li.replace(/^\d+\.\s*/, "")}</li>`).join("")}</ol>`;
        return `<p class="mb-3">${p}</p>`;
      })
      .join("");

    // Generate suggested title
    const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const typeLabels: Record<string, string> = {
      blof: "BLOF Report",
      intel_briefing: "Intelligence Briefing",
      incident_digest: "Incident Digest",
      threat_assessment: "Threat Assessment",
      situational_report: "SITREP",
      warning_order: "WARNORD",
      flash_report: "FLASH",
    };

    const suggestedTitle = `${typeLabels[product_type] || "Intelligence Report"} - ${consortium.region || consortium.name} - ${dateStr}`;

    return successResponse({
      content: generatedContent,
      content_html: contentHtml,
      suggested_title: suggestedTitle,
      incidents_included: incidentSummary.length,
      signals_included: signalSummary.length,
    });
  } catch (error) {
    console.error("Error generating briefing:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
