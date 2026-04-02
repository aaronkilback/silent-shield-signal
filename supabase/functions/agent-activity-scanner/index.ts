/**
 * Agent Activity Scanner v2
 *
 * Runs every 15 min via cron. Each invocation scans ONE agent —
 * the active agent with the oldest last scan (round-robin, excludes AUTO-SENTINEL).
 * Uses callAiGateway for anti-hallucination guardrails + retry resilience.
 *
 * With 28 agents and a 15-min cron, every agent gets scanned roughly every 7 hours.
 * This will move all agents from "idle" to "standby" on the Neural Constellation.
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const dateContext = getCriticalDateContext();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── 1. Pick the agent to scan ────────────────────────────────────────────
    // Caller can force a specific agent; otherwise we pick the stalest one.
    let targetCallSign: string | null = body.agent_call_sign ?? null;

    if (!targetCallSign) {
      const { data: agents } = await supabase
        .from("ai_agents")
        .select("call_sign")
        .eq("is_active", true)
        .neq("call_sign", "AUTO-SENTINEL");

      if (!agents || agents.length === 0) {
        return successResponse({ message: "No active agents to scan" });
      }

      const callSigns = agents.map((a) => a.call_sign);

      // Get the most recent scan per agent
      const { data: recentScans } = await supabase
        .from("autonomous_scan_results")
        .select("agent_call_sign, created_at")
        .in("agent_call_sign", callSigns)
        .order("created_at", { ascending: false })
        .limit(callSigns.length * 3);

      const lastScanMap = new Map<string, Date>();
      for (const scan of recentScans ?? []) {
        if (!lastScanMap.has(scan.agent_call_sign)) {
          lastScanMap.set(scan.agent_call_sign, new Date(scan.created_at));
        }
      }

      // Pick the agent with the oldest (or no) last scan
      let stalestCallSign = callSigns[0];
      let stalestTime = lastScanMap.get(stalestCallSign) ?? new Date(0);
      for (const cs of callSigns) {
        const t = lastScanMap.get(cs) ?? new Date(0);
        if (t < stalestTime) {
          stalestTime = t;
          stalestCallSign = cs;
        }
      }
      targetCallSign = stalestCallSign;
    }

    console.log(`[AgentScanner] Scanning: ${targetCallSign}`);

    // ── 2. Fetch agent config ────────────────────────────────────────────────
    const { data: agentRow } = await supabase
      .from("ai_agents")
      .select("call_sign, name, description, capabilities, focus_areas, updated_at")
      .eq("call_sign", targetCallSign)
      .single();

    const focusAreas: string[] =
      agentRow?.focus_areas ?? agentRow?.capabilities ?? [];

    // ── 3. Gather environment data ───────────────────────────────────────────
    const cutoff48h = new Date(Date.now() - 48 * 3600_000).toISOString();
    const cutoff7d  = new Date(Date.now() -  7 * 86400_000).toISOString();

    const [
      { data: recentSignals },
      { data: weekSignals },
      { data: openIncidents },
      { data: priorScans },
    ] = await Promise.all([
      supabase
        .from("signals")
        .select("id, category, severity, normalized_text, entity_tags, confidence, created_at")
        .gte("created_at", cutoff48h)
        .order("created_at", { ascending: false })
        .limit(150),
      supabase
        .from("signals")
        .select("id, category, severity, created_at")
        .gte("created_at", cutoff7d)
        .limit(500),
      supabase
        .from("incidents")
        .select("id, priority, status, opened_at")
        .eq("status", "open")
        .limit(20),
      supabase
        .from("autonomous_scan_results")
        .select("risk_score, signals_analyzed, created_at")
        .eq("agent_call_sign", targetCallSign)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    // ── 4. Compute metrics ───────────────────────────────────────────────────
    const signals48h = recentSignals ?? [];
    const signals7d  = weekSignals   ?? [];
    const incidents  = openIncidents ?? [];

    const catCounts: Record<string, number> = {};
    let critCount = 0, highCount = 0;
    for (const s of signals48h) {
      catCounts[s.category ?? "unknown"] = (catCounts[s.category ?? "unknown"] ?? 0) + 1;
      if (s.severity === "critical") critCount++;
      if (s.severity === "high")     highCount++;
    }

    const critIncidents = incidents.filter((i) => i.priority === "critical").length;
    const highIncidents = incidents.filter((i) => i.priority === "high").length;

    const riskScore = Math.min(
      100,
      critCount * 12 +
      highCount  *  6 +
      critIncidents * 10 +
      highIncidents *  5 +
      Math.min(signals48h.length / 5, 20),
    );

    const priorAvgRisk =
      priorScans && priorScans.length > 0
        ? Math.round(priorScans.reduce((s, r) => s + (r.risk_score ?? 0), 0) / priorScans.length)
        : null;

    // ── 5. AI synthesis via gateway (anti-hallucination + retries) ───────────
    const scanContext = {
      agent: {
        call_sign: targetCallSign,
        name: agentRow?.name,
        focus_areas: focusAreas,
        },
      period: "48 hours",
      total_signals_48h: signals48h.length,
      total_signals_7d: signals7d.length,
      open_incidents: incidents.length,
      severity_breakdown: { critical: critCount, high: highCount },
      category_distribution: catCounts,
      current_risk_score: riskScore,
      prior_avg_risk_score: priorAvgRisk,
      top_signals: signals48h.slice(0, 6).map((s) => ({
        category: s.category,
        severity: s.severity,
        entity_tags: s.entity_tags?.slice(0, 3),
        age_hours: Math.round((Date.now() - new Date(s.created_at).getTime()) / 3_600_000),
      })),
    };

    const { content: aiFindings } = await callAiGateway({
      model: "gpt-4o-mini",
      functionName: "agent-activity-scanner",
      messages: [
        {
          role: "system",
          content: `You are ${targetCallSign} (${agentRow?.name ?? ""}), an autonomous AI security agent with focus areas: ${focusAreas.join(", ") || "general security"}. Write a concise operational status report (120 words max). Cover: 1) Current threat environment relevant to your focus, 2) Notable signals or patterns in last 48h, 3) Risk trend (prior avg: ${priorAvgRisk ?? "N/A"} → now: ${riskScore}), 4) One specific recommended action. Be direct and factual. Current date: ${dateContext.currentDateISO}.`,
        },
        {
          role: "user",
          content: JSON.stringify(scanContext, null, 2),
        },
      ],
      extraBody: { max_tokens: 300, temperature: 0.3 },
    });

    // ── 6. Write scan result ──────────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from("autonomous_scan_results")
      .insert({
        scan_type: "agent_activity_scan",
        agent_call_sign: targetCallSign,
        findings: {
          ai_findings: aiFindings ?? "",
          focus_areas: focusAreas,
          category_distribution: catCounts,
          open_incidents: incidents.length,
          prior_avg_risk: priorAvgRisk,
          top_signals: signals48h.slice(0, 5).map((s) => ({
            category: s.category,
            severity: s.severity,
            entity_tags: s.entity_tags?.slice(0, 3),
          })),
        },
        risk_score: riskScore,
        signals_analyzed: signals48h.length,
        alerts_generated: critCount + highCount,
      });

    if (insertError) throw insertError;

    console.log(
      `[AgentScanner] ✓ ${targetCallSign} | risk=${riskScore} | signals=${signals48h.length}`,
    );

    return successResponse({
      success: true,
      agent_scanned: targetCallSign,
      risk_score: riskScore,
      signals_analyzed: signals48h.length,
      scanned_at: dateContext.currentDateTimeISO,
    });
  } catch (error) {
    console.error("[AgentScanner] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      500,
    );
  }
});
