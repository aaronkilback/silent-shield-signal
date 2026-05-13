/**
 * activate-dormant-specialists
 *
 * Forces breadth in specialist activity. Each run:
 *   1. Compute the lower-quartile of active agents by 7-day analysis
 *      volume — these are the specialists the platform isn't using.
 *   2. For each dormant agent, ask agent-router which recent admitted
 *      signals are in their lane (semantic cosine similarity over
 *      agent_specialty_embeddings, top_k against the past 14 days).
 *   3. For up to MAX_DISPATCHES_PER_RUN (agent, signal) pairs, fire a
 *      consult to agent-chat and persist the result to
 *      signal_agent_analyses with trigger_reason='dormant_activation'.
 *
 * Why: data-driven debate routing (May 10) only widens the specialist
 * surface for *debates*. Most enrichment writes still happen via the
 * tier-2 review path (always TIER2-REVIEW pseudo-agent), entity-mention
 * dispatch (a small fixed set), and speculative-dispatch (top-3 agent-
 * router hits). That leaves ~25 specialists writing zero analyses per
 * week. The Brier calibration loop (Scope B) can't grade an agent
 * that never makes a prediction. This job ensures every active
 * specialist gets at least one in-lane shot per week, so calibration
 * accumulates evidence across the whole fleet.
 *
 * Cost ceiling: MAX_DISPATCHES_PER_RUN × ~$0.002/agent-chat call. At
 * default 8/run × 1 run/day = ~$0.50/month. Cheap.
 *
 * Idempotent: skips (agent, signal) pairs that already have an
 * analysis row, so re-running within the day is a no-op.
 */

import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";

const JOB_NAME = "activate-dormant-specialists-daily";
const ANALYSIS_LOOKBACK_DAYS = 7;
const SIGNAL_LOOKBACK_DAYS = 14;
const MAX_DISPATCHES_PER_RUN = 8;
// Quartile cutoff — agents below this analysis-count percentile are
// considered dormant. 0.25 = bottom 25%. Easy to widen if you want
// even mid-tier agents to get auto-prompts.
const DORMANT_QUANTILE = 0.25;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, JOB_NAME);

  try {
    const analysisSince = new Date(Date.now() - ANALYSIS_LOOKBACK_DAYS * 86400_000).toISOString();
    const signalSince = new Date(Date.now() - SIGNAL_LOOKBACK_DAYS * 86400_000).toISOString();

    // 1. Active fleet
    const { data: agents } = await supabase
      .from("ai_agents")
      .select("id, call_sign, specialty")
      .eq("is_active", true);
    if (!agents || agents.length === 0) {
      await completeHeartbeat(supabase, hb, { dispatched: 0, dormant: 0 });
      return successResponse({ success: true, dispatched: 0, dormant: 0 });
    }

    // 2. Per-agent 7-day analysis count (count rows; absence = 0)
    const { data: analysesRaw } = await supabase
      .from("signal_agent_analyses")
      .select("agent_call_sign")
      .gte("created_at", analysisSince);
    const counts = new Map<string, number>();
    for (const row of analysesRaw ?? []) {
      const cs = row.agent_call_sign;
      if (cs) counts.set(cs, (counts.get(cs) ?? 0) + 1);
    }
    const fleetCounts = agents.map((a: any) => ({
      ...a,
      n_analyses: counts.get(a.call_sign) ?? 0,
    }));

    // 3. Quartile cutoff — sort ascending, take the bottom DORMANT_QUANTILE.
    fleetCounts.sort((a, b) => a.n_analyses - b.n_analyses);
    const cutoffIdx = Math.max(1, Math.floor(fleetCounts.length * DORMANT_QUANTILE));
    const dormant = fleetCounts.slice(0, cutoffIdx);
    console.log(`[${JOB_NAME}] ${dormant.length} dormant of ${fleetCounts.length} active agents`);

    // 4. Pull recent admitted signals (real clients only — sandbox
    // traffic shouldn't activate fleet specialists).
    const { data: recentSignals } = await supabase
      .from("signals")
      .select(`
        id, title, normalized_text, category, severity, composite_confidence, client_id,
        clients!inner ( name )
      `)
      .gte("created_at", signalSince)
      .gte("composite_confidence", 0.45)
      .not("clients.name", "ilike", "_benchmark%")
      .not("clients.name", "ilike", "_qa%")
      .order("created_at", { ascending: false })
      .limit(80);

    if (!recentSignals || recentSignals.length === 0) {
      await completeHeartbeat(supabase, hb, { dispatched: 0, dormant: dormant.length, signals_available: 0 });
      return successResponse({ success: true, dispatched: 0, dormant: dormant.length, signals_available: 0 });
    }

    // 5. Existing (signal, agent) pairs — skip these
    const dormantCallSigns = new Set(dormant.map((d: any) => d.call_sign));
    const { data: existingPairs } = await supabase
      .from("signal_agent_analyses")
      .select("signal_id, agent_call_sign")
      .in("agent_call_sign", Array.from(dormantCallSigns))
      .in("signal_id", recentSignals.map((s: any) => s.id));
    const seenKey = new Set((existingPairs ?? []).map((p: any) => `${p.signal_id}::${p.agent_call_sign}`));

    // 6. For each candidate signal, ask agent-router which agents
    // are in its lane (pgvector cosine over agent_specialty_embeddings).
    // If a dormant agent appears in the top-K and we haven't already
    // analyzed this signal with that agent, queue the dispatch.
    //
    // We invert the loop direction (signals × top_k routes, not agents
    // × all signals × keyword match) because agent-router is one
    // gateway call per signal and works on semantic similarity rather
    // than keyword overlap. Dormant agents' specialty texts are
    // analytical jargon ("Pattern Detection, Behavioral Analysis")
    // that rarely appears verbatim in news content — embeddings
    // bridge that vocabulary gap.
    const ROUTER_TOP_K = 5;
    const dispatches: Array<{ agent: any; signal: any }> = [];
    const dormantByCallSign = new Map<string, any>(dormant.map((d: any) => [d.call_sign, d]));

    for (const signal of recentSignals as any[]) {
      if (dispatches.length >= MAX_DISPATCHES_PER_RUN) break;

      const question = `${signal.category ?? ""} signal: ${signal.title ?? ""} ${(signal.normalized_text ?? "").slice(0, 600)}`.trim();
      try {
        const routerResp = await supabase.functions.invoke("agent-router", {
          body: { question, top_k: ROUTER_TOP_K },
        });
        const routedAgents: Array<{ call_sign: string }> =
          (routerResp?.data as any)?.agents ?? [];
        for (const r of routedAgents) {
          if (dispatches.length >= MAX_DISPATCHES_PER_RUN) break;
          const dormantAgent = dormantByCallSign.get(r.call_sign);
          if (!dormantAgent) continue;
          const key = `${signal.id}::${r.call_sign}`;
          if (seenKey.has(key)) continue;
          dispatches.push({ agent: dormantAgent, signal });
          seenKey.add(key);
        }
      } catch (e) {
        console.warn(`[${JOB_NAME}] agent-router failed for signal ${signal.id}:`, e);
      }
    }

    if (dispatches.length === 0) {
      await completeHeartbeat(supabase, hb, { dispatched: 0, dormant: dormant.length, signals_available: recentSignals.length });
      return successResponse({ success: true, dispatched: 0, dormant: dormant.length, signals_available: recentSignals.length });
    }

    // 7. Fire agent-chat for each (agent, signal). Sequential so we
    // stay under the 150s edge-function timeout — 8 dispatches × ~6s =
    // ~48s. If MAX_DISPATCHES_PER_RUN ever rises above ~20, parallelize.
    let dispatched = 0;
    const results: Array<{ agent: string; signal_id: string; ok: boolean; error?: string }> = [];
    for (const { agent, signal } of dispatches) {
      try {
        const userMsg =
          `An admitted signal is in your specialty lane but no analysis from you exists yet — make one.\n\n` +
          `Signal title: ${signal.title}\n` +
          `Category: ${signal.category}\n` +
          `Severity: ${signal.severity}\n` +
          `Composite confidence: ${signal.composite_confidence}\n\n` +
          `Content:\n${String(signal.normalized_text ?? "").slice(0, 1500)}\n\n` +
          `Apply your specialty (${agent.specialty}) to this signal in 3–5 sentences. Cite the incident text directly. ` +
          `Acknowledge if it isn't operationally actionable for your lane — saying "no direct nexus" with one-sentence reasoning is a valid output.\n\n` +
          `END YOUR RESPONSE WITH A LINE EXACTLY IN THIS FORMAT:\n` +
          `CONFIDENCE: 0.X\n` +
          `where 0.X is your probability estimate (0.0–1.0) that this signal will resolve as a real, actionable threat for the client.\n\n` +
          `IMPORTANT — choose a meaningful value:\n` +
          `  0.5 = genuinely uncertain, could go either way\n` +
          `  0.1 = probably not actionable, but not impossible\n` +
          `  0.3 = leans not-actionable but watchable\n` +
          `  0.7 = leans actionable — worth analyst attention\n` +
          `  0.9 = very likely real and worth acting on\n` +
          `DO NOT output CONFIDENCE: 0 — that's the "I refuse to answer" value. If your assessment is "no nexus to my lane",\n` +
          `say so in the body and still output CONFIDENCE: 0.1 (low but not refusing).\n` +
          `Without a meaningful 0.0–1.0 value your analysis cannot be graded by calibration. Your confidence is the input the learning loop uses to improve you.`;

        const resp = await supabase.functions.invoke("agent-chat", {
          body: {
            agent_id: agent.id,
            message: userMsg,
            client_id: signal.client_id ?? null,
            stream: false,
          },
        });
        const respData = resp?.data as any;
        const analysis = respData?.response ?? respData?.message ?? "";
        // Parse trailing CONFIDENCE: 0.X line. Regex tolerates whitespace,
        // markdown bolding, and 0–100 percent shorthand. If missing or
        // unparseable, leave null — calibration treats null as "abstained."
        let confidence: number | null = null;
        const m = String(analysis).match(/CONFIDENCE\s*[:=]?\s*\**\s*(0?\.\d+|[01](?:\.0+)?|\d{1,3})\s*%?\s*$/im);
        if (m) {
          let v = parseFloat(m[1]);
          if (!Number.isFinite(v)) v = NaN;
          if (v > 1) v = v / 100; // accept "85" → 0.85
          if (Number.isFinite(v) && v >= 0 && v <= 1) confidence = Math.round(v * 1000) / 1000;
        }
        if (typeof respData?.confidence === "number" && confidence == null) {
          confidence = respData.confidence;
        }

        if (analysis && analysis.length > 50) {
          await supabase.from("signal_agent_analyses").insert({
            signal_id: signal.id,
            agent_call_sign: agent.call_sign,
            analysis: analysis.slice(0, 6000),
            confidence_score: confidence,
            trigger_reason: "dormant_activation",
            analysis_tier: "dormant_activation",
          });
          dispatched++;
          results.push({ agent: agent.call_sign, signal_id: signal.id, ok: true });
        } else {
          results.push({ agent: agent.call_sign, signal_id: signal.id, ok: false, error: "empty response" });
        }
      } catch (e: any) {
        results.push({ agent: agent.call_sign, signal_id: signal.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    const summary = {
      dispatched,
      dormant: dormant.length,
      signals_available: recentSignals.length,
      attempted: dispatches.length,
    };
    await completeHeartbeat(supabase, hb, summary);
    console.log(`[${JOB_NAME}] ${JSON.stringify(summary)}`);
    return successResponse({ success: true, ...summary, results });
  } catch (e: any) {
    console.error(`[${JOB_NAME}] Fatal:`, e);
    await failHeartbeat(supabase, hb, e instanceof Error ? e : new Error(String(e)));
    return errorResponse(e?.message ?? "activate-dormant-specialists failed", 500);
  }
});
