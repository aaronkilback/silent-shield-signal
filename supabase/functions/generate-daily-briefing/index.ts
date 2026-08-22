/**
 * Generate Daily Briefing
 *
 * Generates a daily intelligence briefing for a given client. Accepts either
 * clientId (camelCase) or client_id (snake_case). When test=true it returns a
 * lightweight health-check response so QA can verify the function is reachable
 * without triggering a full AI generation cycle.
 */

import { createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, getAccessibleClientIds } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { excludeDeletedSignals, excludeDeletedIncidents } from "../_shared/soft-delete-filters.ts";

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

    // ── GENERIC TOOL PATH CLEARANCE — Wave 2 caller→scope gate ──────────────────
    // Reads operational data (signals/incidents/…) via service-role under verify_jwt=false.
    // Every read is already clientId-scoped and clientId is required above; here we validate
    // the CALLER may access it. service_role (scheduled briefings) trusted; a user must have
    // clientId in getAccessibleClientIds (or be super_admin) — else reject (fail closed).
    {
      const _caller = await getCallerIdentity(req);
      if (_caller.kind === 'unauthorized') {
        return errorResponse(_caller.error, _caller.status);
      }
      if (_caller.kind === 'user') {
        const _accessible = await getAccessibleClientIds(supabase, _caller.userId);
        let _allowed = _accessible.includes(clientId);
        if (!_allowed) {
          const { data: _sa } = await supabase.from('user_roles').select('role').eq('user_id', _caller.userId).eq('role', 'super_admin').maybeSingle();
          _allowed = !!_sa;
        }
        if (!_allowed) {
          return errorResponse('CLIENT_NOT_AUTHORIZED: caller cannot access the requested client_id', 403);
        }
      }
    }

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
      { data: recentDebates },
    ] = await Promise.all([
      supabase.from("clients").select("id, name, industry, locations").eq("id", clientId).single(),
      excludeDeletedSignals(supabase
        .from("signals")
        .select("id, title, category, severity, normalized_text, created_at, relevance_score"))
        .eq("client_id", clientId)
        .gte("created_at", cutoff24h)
        .neq("status", "false_positive")
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(30),
      excludeDeletedIncidents(supabase
        .from("incidents")
        .select("id, title, priority, status, opened_at"))
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
      // 2026-05-29 — Layer 1 fix per operator directive after signal_agent_analyses
      // scope audit. Pre-fix this query had no client/tenant filter and no JOIN, so
      // service-role bypassed RLS and returned rows across all tenants. Historical
      // realization on prod: 2026-05-27 / 24 / 19 each had multi-tenant exposure in
      // the 24h window — every tenant's daily briefing prompt received the other
      // tenant's LLM-derived analysis prose.
      //
      // The fix uses signals!inner so PostgREST emits an INNER JOIN; the
      // .eq("signals.client_id", clientId) constrains the join's outer table.
      // Rows whose parent signal is owned by a different client are excluded.
      // Rows with NULL signal_id (none on prod today; FK enforced) cannot match.
      //
      // See docs/platform-operations/audits/signal-agent-analyses-scope-audit-2026-05-29.md
      supabase
        .from("signal_agent_analyses")
        .select(
          "agent_call_sign, trigger_reason, analysis, created_at, signals!inner(client_id)"
        )
        .eq("signals.client_id", clientId)
        .ilike("trigger_reason", "entity_mention:%")
        .gte("created_at", cutoff24h)
        .order("created_at", { ascending: false })
        .limit(8),
      // Multi-agent debate syntheses for this client's incidents.
      // These are AEGIS-CMD's command syntheses + specialist
      // contributions — primary analytical content for the briefing.
      // The reports must USE these (not regenerate analysis) so the
      // operator-facing brief reflects the actual reasoning trail
      // produced by the platform, not LLM paraphrase.
      supabase
        .from("agent_debate_records")
        .select(`
          id,
          debate_type,
          judge_agent,
          participating_agents,
          consensus_score,
          final_assessment,
          created_at,
          incident_id,
          incidents!inner(id, title, priority, client_id)
        `)
        .eq("incidents.client_id", clientId)
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

    // Multi-agent debate syntheses — primary analytical content for
    // the briefing. The LLM is instructed below to USE these as
    // source material rather than regenerate analysis from raw signals.
    // Each entry surfaces: incident title, judge, consensus, the actual
    // synthesis text. This is the authored reasoning trail; the
    // briefing should quote/paraphrase rather than re-imagine.
    // Dedup per incident — keep only the most recent debate per
    // incident_id. Same reasoning as in generate-executive-report:
    // multiple chat-triggered debates on the same incident produce
    // near-duplicate synthesis content; the newest one also tends
    // to have the best specialty-routed participants.
    const seenDailyIncidents = new Set<string>();
    const dedupedDebates = (recentDebates ?? []).filter((d: any) => {
      if (!d?.incident_id) return false;
      if (seenDailyIncidents.has(d.incident_id)) return false;
      seenDailyIncidents.add(d.incident_id);
      return true;
    });
    const debatesSummary = dedupedDebates
      .map((d: any) => {
        const incTitle = d.incidents?.title || `Incident ${String(d.incident_id).slice(0, 8)}`;
        const participants = Array.isArray(d.participating_agents) ? d.participating_agents.join(', ') : 'unknown';
        const consensus = typeof d.consensus_score === 'number' ? `${Math.round(d.consensus_score * 100)}%` : 'n/a';
        const assessment = String(d.final_assessment || '').slice(0, 800);
        return `── DEBATE on "${incTitle}" (judge: ${d.judge_agent || 'AEGIS-CMD'} · participants: ${participants} · consensus: ${consensus}) ──
${assessment}`;
      })
      .join("\n\n");

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

══ MULTI-AGENT DEBATE SYNTHESES (last 24h, ${(recentDebates ?? []).length}) ══
${debatesSummary || "No multi-agent debates in the last 24 hours."}

Write the memo as AEGIS-CMD addressing the operator directly. Structure:

## Bottom line up front (BLUF)
Two sentences: what's the most important thing to know today, and why it matters. **If multi-agent debate syntheses exist above, use the most operationally consequential one to anchor the BLUF — don't paraphrase the synthesis, distill its judgment.**

## What changed in the last 24 hours
Concrete events with [SIGNAL: title] citations. Tie new signals to ongoing entity narratives where applicable.

## Multi-agent assessments completed
For each debate synthesis above, write a 2-3 sentence summary that PRESERVES the synthesis's actual judgment. Cite the judge (e.g. "AEGIS-CMD synthesis with FININT/CHAIN-WATCH/MERIDIAN, 86% consensus") so the operator can audit the reasoning trail. **Do NOT regenerate analysis the agents already produced — quote or paraphrase the synthesis text directly.** If no debates ran, write "No multi-agent assessments in this period."

## Recurring patterns we're tracking
Reference the entity-pattern narratives above. Note any patterns gaining or losing momentum.

## Open incidents requiring action
Per-incident: status, what's blocking resolution, recommended next move. Where a debate synthesis exists for the incident, use its recommended actions; don't invent new ones.

## Watch list for the coming week
3-5 specific things to watch for, derived from beliefs, narratives, and debate findings. Be predictive without being speculative — say what evidence would confirm or refute each watch item.

Be factual. Only reference information provided above. If a section has no material content, write "Nothing material to report" — do not pad.

CRITICAL: Multi-agent debate syntheses are AUTHORED REASONING produced by the platform's specialist agents under AEGIS-CMD adjudication. They are the platform's primary analytical output. When they exist, the briefing must use them as source material rather than generating independent analysis from raw signals. Re-imagining analysis the agents already produced breaks the audit trail and undermines the platform's reasoning-trail value proposition.`;

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
