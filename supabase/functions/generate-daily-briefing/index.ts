/**
 * Generate Daily Briefing
 *
 * Generates a daily intelligence briefing for a given client. Accepts either
 * clientId (camelCase) or client_id (snake_case). When test=true it returns a
 * lightweight health-check response so QA can verify the function is reachable
 * without triggering a full AI generation cycle.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const clientId = body.clientId ?? body.client_id;
    const isTest = !!body.test;

    if (!clientId) {
      return errorResponse("clientId is required", 400);
    }

    const supabase = createServiceClient();

    // Lightweight test / health-check path — no AI call needed
    if (isTest) {
      const { data: client } = await supabase
        .from("clients")
        .select("id, name")
        .eq("id", clientId)
        .single();

      return successResponse({
        success: true,
        test: true,
        clientId,
        clientName: client?.name ?? null,
        message: "Daily briefing function healthy",
        generatedAt: new Date().toISOString(),
      });
    }

    // Full briefing generation
    const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();

    const [
      { data: client },
      { data: recentSignals },
      { data: openIncidents },
    ] = await Promise.all([
      supabase.from("clients").select("id, name, industry, country").eq("id", clientId).single(),
      supabase
        .from("signals")
        .select("id, title, category, severity, normalized_text, created_at, relevance_score")
        .eq("client_id", clientId)
        .gte("created_at", cutoff24h)
        .neq("status", "false_positive")
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("incidents")
        .select("id, title, priority, status, opened_at")
        .eq("client_id", clientId)
        .eq("status", "open")
        .limit(20),
    ]);

    if (!client) {
      return errorResponse("Client not found", 404);
    }

    const signalSummary = (recentSignals ?? [])
      .map((s: any) => `[${s.severity?.toUpperCase() ?? "INFO"}] ${s.title ?? s.normalized_text?.slice(0, 120) ?? ""}`)
      .join("\n");

    const incidentSummary = (openIncidents ?? [])
      .map((i: any) => `[${i.priority?.toUpperCase() ?? "MEDIUM"}] ${i.title ?? "Untitled incident"}`)
      .join("\n");

    const prompt = `You are a security intelligence analyst preparing a daily briefing for ${client.name} (${client.industry ?? "energy"} sector, ${client.country ?? "Canada"}).

Date: ${new Date().toISOString().split("T")[0]}

Signals from the last 24 hours (${(recentSignals ?? []).length} total):
${signalSummary || "No signals in the last 24 hours."}

Open incidents (${(openIncidents ?? []).length} total):
${incidentSummary || "No open incidents."}

Write a concise daily security briefing (3-5 paragraphs) covering:
1. Overall threat posture
2. Key signals and what they indicate
3. Open incident status
4. Recommended priorities for today

Be factual. Only reference information provided above.`;

    const gatewayResult = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      functionName: "generate-daily-briefing",
      extraBody: { temperature: 0.2, max_tokens: 1200 },
    });

    if (gatewayResult.error) {
      throw new Error(gatewayResult.error);
    }

    const briefingText = gatewayResult.content ?? "";

    return successResponse({
      success: true,
      clientId,
      clientName: client.name,
      briefing: briefingText,
      signalCount: (recentSignals ?? []).length,
      openIncidentCount: (openIncidents ?? []).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[generate-daily-briefing] Error:", error);
    return errorResponse(`Failed to generate daily briefing: ${error.message}`, 500);
  }
});
