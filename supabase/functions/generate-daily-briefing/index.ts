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

    // Full briefing — assembled from multiple analytical layers:
    // raw signals, active incidents, client-scoped agent beliefs (#5 fix),
    // entity narratives (#6), and recent entity-mention dispatches (#4).
    const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();

    const [
      { data: client },
      { data: recentSignals },
      { data: openIncidents },
      { data: clientBeliefs },
      { data: entityNarratives },
      { data: recentDispatches },
    ] = await Promise.all([
      supabase.from("clients").select("id, name, industry, locations").eq("id", clientId).single(),
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
      supabase
        .from("agent_beliefs")
        .select("agent_call_sign, hypothesis, confidence, belief_type, last_updated_at")
        .eq("client_id", clientId)
        .gte("confidence", 0.7)
        .gte("last_updated_at", cutoff7d)
        .neq("belief_type", "entity_narrative")
        .order("confidence", { ascending: false })
        .limit(15),
      supabase
        .from("agent_beliefs")
        .select("hypothesis, confidence, last_updated_at")
        .eq("client_id", clientId)
        .eq("belief_type", "entity_narrative")
        .gte("last_updated_at", cutoff7d)
        .order("last_updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("signal_agent_analyses")
        .select("agent_call_sign, trigger_reason, analysis, created_at")
        .ilike("trigger_reason", "entity_mention:%")
        .gte("created_at", cutoff24h)
        .order("created_at", { ascending: false })
        .limit(8),
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

    const beliefsSummary = (clientBeliefs ?? [])
      .map((b: any) => `• [${b.agent_call_sign} | conf ${(b.confidence * 100).toFixed(0)}%] ${b.hypothesis}`)
      .join("\n");

    const narrativesSummary = (entityNarratives ?? [])
      .map((n: any) => `• [conf ${(n.confidence * 100).toFixed(0)}%] ${n.hypothesis}`)
      .join("\n");

    const dispatchSummary = (recentDispatches ?? [])
      .map((d: any) => `• ${d.agent_call_sign} on ${d.trigger_reason.replace('entity_mention:', '')}: ${String(d.analysis).slice(0, 220)}…`)
      .join("\n");

    const locationStr = Array.isArray(client.locations) && client.locations.length > 0
      ? client.locations.slice(0, 3).join(', ')
      : 'Canada';
    const prompt = `You are AEGIS-CMD writing a "you should know about this" daily memo for ${client.name} (${client.industry ?? "energy"} sector, ${locationStr}).

Date: ${new Date().toISOString().split("T")[0]}

══ RAW SIGNALS (last 24h, ${(recentSignals ?? []).length} total) ══
${signalSummary || "No signals in the last 24 hours."}

══ OPEN INCIDENTS (${(openIncidents ?? []).length}) ══
${incidentSummary || "No open incidents."}

══ AGENT ANALYTICAL BELIEFS (client-scoped, last 7d, conf ≥ 70%, ${(clientBeliefs ?? []).length}) ══
${beliefsSummary || "No high-confidence beliefs in the last 7 days."}

══ ENTITY-PATTERN NARRATIVES (recurring patterns, last 7d, ${(entityNarratives ?? []).length}) ══
${narrativesSummary || "No entity narratives in the last 7 days."}

══ ENTITY-MENTION ANALYSES (per-entity context from last 24h, ${(recentDispatches ?? []).length}) ══
${dispatchSummary || "No entity-mention dispatches in the last 24 hours."}

Write the memo as AEGIS-CMD addressing the operator directly. Structure:

## Bottom line up front (BLUF)
Two sentences: what's the most important thing to know today, and why it matters.

## What changed in the last 24 hours
Concrete events with [SIGNAL: title] citations. Tie new signals to ongoing entity narratives where applicable.

## Recurring patterns we're tracking
Reference the entity-pattern narratives above. Note any patterns gaining or losing momentum.

## Open incidents requiring action
Per-incident: status, what's blocking resolution, recommended next move.

## Watch list for the coming week
3-5 specific things to watch for, derived from beliefs and narratives. Be predictive without being speculative — say what evidence would confirm or refute each watch item.

Be factual. Only reference information provided above. If a section has no material content, write "Nothing material to report" — do not pad.`;

    const gatewayResult = await callAiGateway({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      functionName: "generate-daily-briefing",
      extraBody: { temperature: 0.2, max_tokens: 2400 },
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
