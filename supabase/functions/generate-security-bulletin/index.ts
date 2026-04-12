import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const {
      entity,         // { name, type, description, risk_level, threat_score, current_location, address_city, address_province }
      incident,       // { title, priority, status, opened_at, description } | null
      signals,        // [{ normalized_text, severity, category, created_at, source_url }] max 5
      analystNotes,   // string
      location,       // string — place name for the bulletin
      severity,       // 'critical' | 'high' | 'medium' | 'low'
      bulletinType,   // 'incident_report' | 'threat_advisory' | 'security_notice' | 'site_safety'
      clientName,     // string
    } = body;

    // Build context block for the AI
    const contextParts: string[] = [];

    if (entity) {
      contextParts.push(
        `SUBJECT ENTITY\nName: ${entity.name}\nType: ${entity.type}\nRisk Level: ${entity.risk_level?.toUpperCase() || 'UNKNOWN'}\nThreat Score: ${entity.threat_score ?? 'N/A'}/100\n${entity.description ? `Profile: ${entity.description.substring(0, 600)}` : ''}`
      );
    }

    if (incident) {
      contextParts.push(
        `LINKED INCIDENT\nTitle: ${incident.title}\nPriority: ${incident.priority?.toUpperCase()}\nStatus: ${incident.status}\nOpened: ${new Date(incident.opened_at).toLocaleDateString('en-CA')}`
      );
    }

    if (signals && signals.length > 0) {
      const sigText = signals.map((s: any, i: number) =>
        `${i + 1}. [${s.severity?.toUpperCase()} | ${s.category}] ${s.normalized_text?.substring(0, 250)} (${new Date(s.created_at).toLocaleDateString('en-CA')})`
      ).join('\n');
      contextParts.push(`SUPPORTING SIGNALS\n${sigText}`);
    }

    if (analystNotes) {
      contextParts.push(`ANALYST NOTES\n${analystNotes}`);
    }

    if (location) {
      contextParts.push(`LOCATION\n${location}`);
    }

    const fullContext = contextParts.join('\n\n---\n\n');

    // Bulletin type shapes the AI's framing and structure
    const typeInstructions: Record<string, string> = {
      incident_report: `This is an INCIDENT REPORT bulletin. Focus on what happened: timeline, subject entity details, immediate impacts, and response actions taken or required. Situation overview should read as a factual account of events in chronological order.`,
      threat_advisory: `This is a THREAT ADVISORY bulletin. The analyst has identified an emerging threat, trend, or risk driver — not necessarily a specific incident. Your job is to:
1. Explain the threat mechanism clearly (e.g. "Rising fuel prices historically correlate with a X% increase in site theft across remote oil & gas operations")
2. Apply it specifically to ${clientName || 'the client'}'s operational context and assets
3. Assess likelihood and potential impact
4. Give concrete, practical preventive actions
Write for a security manager who needs to brief site supervisors. Situation overview should connect the macro trend to operational risk. Recommended actions should be preventive/preparatory, not reactive.`,
      security_notice: `This is a SECURITY NOTICE — a brief awareness bulletin for staff and site personnel. Use plain, direct language suitable for field staff. Keep it concise. Situation overview should be 1 paragraph. Recommended actions should be specific behaviours staff should follow.`,
      site_safety: `This is a SITE SAFETY bulletin. Focus on physical safety, access control, and procedural compliance at the affected location. Recommended actions should be operational and specific to site supervisors.`,
    };

    const typeInstruction = typeInstructions[bulletinType] || typeInstructions.threat_advisory;

    const result = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional security intelligence analyst producing a formal bulletin for ${clientName || 'the client'}, an LNG and natural gas producer operating in northeast BC, the Kitimat corridor, and Calgary.

${typeInstruction}

Write in clear, direct, professional security language. Use SURNAME in CAPITALS for named individuals (e.g. John SMITH). Severity: ${severity?.toUpperCase() || 'MEDIUM'}.

Return ONLY a JSON object with these exact keys:
{
  "executive_summary": "1-2 sentences. Bottom line up front — the single most important thing the reader needs to know.",
  "situation_overview": "The full narrative — see type instructions above for framing.",
  "threat_assessment": "Analytical assessment: likelihood, potential impact, and confidence level. Be specific about which assets or operations are most exposed.",
  "recommended_actions": ["Concrete, specific action 1 — one sentence, no preamble", "Concrete, specific action 2", "Concrete, specific action 3", "Concrete, specific action 4"],
  "distribution_guidance": "Who should receive this (e.g. Site Supervisors, Security Operations, Senior Leadership, All Staff).",
  "classification": "CONFIDENTIAL — SECURITY SENSITIVE"
}`,
        },
        {
          role: 'user',
          content: fullContext || 'No additional context provided — generate a general security awareness bulletin.',
        },
      ],
      functionName: 'generate-security-bulletin',
      retries: 2,
      extraBody: { max_tokens: 1800 },
      skipGuardrails: true,
    });

    if (result.error || !result.content) {
      throw new Error(result.error || 'AI generation failed');
    }

    // Extract JSON from the response — handles code fences and trailing text
    let parsed: any;
    const raw = result.content.trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error(`No JSON object found in AI response: ${raw.substring(0, 200)}`);
    }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error(`JSON parse failed: ${raw.substring(0, 200)}`);
    }

    return successResponse({ content: parsed });
  } catch (error) {
    console.error('generate-security-bulletin error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
