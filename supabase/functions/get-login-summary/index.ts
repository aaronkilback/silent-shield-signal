/**
 * get-login-summary
 *
 * Called by dashboard-ai-assistant on each session load.
 * Reads the gap since the previous session, queries platform activity
 * during that window, and returns a formatted "since you last logged in" block.
 *
 * Also updates user_last_seen so the next call gets the correct gap.
 *
 * Returns null if gap < 1 hour (page refresh, not a real new session).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const MIN_GAP_HOURS = 1; // ignore gaps smaller than this — just a page refresh

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { user_id } = await req.json();
    if (!user_id) return errorResponse("user_id required", 400);

    const supabase = createServiceClient();
    const now = new Date();

    // ── Read + update last_seen in one round-trip ──────────────────
    const { data: existing } = await supabase
      .from("user_last_seen")
      .select("last_seen_at, previous_seen_at")
      .eq("user_id", user_id)
      .maybeSingle();

    const previousSeen = existing?.last_seen_at ? new Date(existing.last_seen_at) : null;
    const gapHours = previousSeen
      ? (now.getTime() - previousSeen.getTime()) / 3600000
      : null;

    // Upsert the new last_seen — fire and forget after we have the previous value
    supabase.from("user_last_seen").upsert({
      user_id,
      last_seen_at: now.toISOString(),
      previous_seen_at: existing?.last_seen_at ?? null,
    }, { onConflict: "user_id" }).then(() => {}).catch(() => {});

    // Too recent to be a new session — skip summary
    if (!previousSeen || !gapHours || gapHours < MIN_GAP_HOURS) {
      return successResponse({ summary: null, gap_hours: gapHours });
    }

    const since = previousSeen.toISOString();
    const gapLabel = gapHours < 24
      ? `${Math.round(gapHours)} hour${Math.round(gapHours) === 1 ? "" : "s"}`
      : `${Math.round(gapHours / 24)} day${Math.round(gapHours / 24) === 1 ? "" : "s"}`;

    // ── Query platform activity since previous session ─────────────
    const [
      { data: newBeliefs },
      { data: contradictions },
      { data: meshMessages },
      { data: newIncidents },
      { data: missionUpdates },
      { data: signalCounts },
      { data: highSeveritySignals },
    ] = await Promise.all([
      supabase
        .from("agent_beliefs")
        .select("agent_call_sign, hypothesis, confidence, belief_type")
        .gte("created_at", since)
        .eq("is_active", true)
        .gte("confidence", 0.78)
        .order("confidence", { ascending: false })
        .limit(5),

      supabase
        .from("agent_beliefs")
        .select("agent_call_sign, hypothesis, contradiction_note")
        .gte("updated_at", since)
        .eq("has_contradiction", true)
        .eq("is_active", true)
        .limit(3),

      supabase
        .from("agent_mesh_messages")
        .select("from_agent, to_agent, subject")
        .gte("created_at", since)
        .limit(20),

      supabase
        .from("incidents")
        .select("id, title, priority, status, opened_at")
        .gte("opened_at", since)
        .order("opened_at", { ascending: false })
        .limit(5),

      supabase
        .from("agent_missions")
        .select("title, assigned_agent, progress_log")
        .eq("status", "active")
        .gt("updated_at", since)
        .limit(5),

      supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("is_test", false),

      supabase
        .from("signals")
        .select("id, normalized_text, category, severity")
        .gte("created_at", since)
        .in("severity", ["critical", "high"])
        .eq("is_test", false)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const signalTotal = (signalCounts as any)?.length ?? 0;

    // ── Build summary sections ────────────────────────────────────
    const lines: string[] = [];

    // Signals
    if (signalTotal > 0) {
      const highCount = highSeveritySignals?.length || 0;
      const signalLine = highCount > 0
        ? `• **${signalTotal} signals ingested** — ${highCount} high/critical severity`
        : `• **${signalTotal} signals ingested**`;
      lines.push(signalLine);
      if (highSeveritySignals?.length) {
        highSeveritySignals.slice(0, 2).forEach((s: any) => {
          lines.push(`  ↳ [${s.severity?.toUpperCase()}] ${(s.normalized_text || s.category || "Signal").substring(0, 80)}`);
        });
      }
    }

    // New incidents
    if (newIncidents?.length) {
      lines.push(`• **${newIncidents.length} new incident${newIncidents.length > 1 ? "s" : ""} opened**`);
      newIncidents.slice(0, 2).forEach((i: any) => {
        lines.push(`  ↳ [${i.priority?.toUpperCase()}] ${i.title?.substring(0, 70)}`);
      });
    }

    // New agent beliefs
    if (newBeliefs?.length) {
      const byAgent = new Map<string, number>();
      newBeliefs.forEach((b: any) => byAgent.set(b.agent_call_sign, (byAgent.get(b.agent_call_sign) || 0) + 1));
      const agentSummary = Array.from(byAgent.entries()).map(([a, n]) => `${a} (${n})`).join(", ");
      lines.push(`• **${newBeliefs.length} new belief${newBeliefs.length > 1 ? "s" : ""} formed** — ${agentSummary}`);
      // Show the highest confidence one
      const top = newBeliefs[0];
      if (top) {
        lines.push(`  ↳ ${top.agent_call_sign}: "${top.hypothesis.substring(0, 90)}${top.hypothesis.length > 90 ? "…" : ""}" (${Math.round(top.confidence * 100)}%)`);
      }
    }

    // Contradictions
    if (contradictions?.length) {
      lines.push(`• **${contradictions.length} belief contradiction${contradictions.length > 1 ? "s" : ""} detected**`);
      contradictions.slice(0, 2).forEach((c: any) => {
        lines.push(`  ↳ ${c.agent_call_sign}: ${c.contradiction_note?.substring(0, 80) || c.hypothesis?.substring(0, 60)}`);
      });
    }

    // Agent mesh activity
    if (meshMessages?.length) {
      const uniquePairs = new Set(meshMessages.map((m: any) => `${m.from_agent}→${m.to_agent}`));
      lines.push(`• **${meshMessages.length} agent mesh message${meshMessages.length > 1 ? "s" : ""}** across ${uniquePairs.size} channel${uniquePairs.size > 1 ? "s" : ""}`);
      meshMessages.slice(0, 2).forEach((m: any) => {
        lines.push(`  ↳ ${m.from_agent} → ${m.to_agent}: "${m.subject?.substring(0, 60)}"`);
      });
    }

    // Mission updates
    if (missionUpdates?.length) {
      lines.push(`• **${missionUpdates.length} active mission${missionUpdates.length > 1 ? "s" : ""} updated**`);
      missionUpdates.slice(0, 2).forEach((m: any) => {
        const recent = (m.progress_log || []).at(-1);
        lines.push(`  ↳ ${m.assigned_agent} — "${m.title}"${recent ? `: ${recent.update?.substring(0, 60)}` : ""}`);
      });
    }

    if (lines.length === 0) {
      return successResponse({ summary: null, gap_hours: gapHours });
    }

    const summary = `═══ SINCE YOUR LAST SESSION (${gapLabel} ago) ═══\n${lines.join("\n")}\n`;

    return successResponse({ summary, gap_hours: gapHours, sections: lines.length });

  } catch (err) {
    console.error("[get-login-summary] Error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unknown error", 500);
  }
});
