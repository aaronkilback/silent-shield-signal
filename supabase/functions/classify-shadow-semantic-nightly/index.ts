// classify-shadow-semantic-nightly — WO-GATE-PHASE3 slice 4b (semantic recall leg, OFF the hot path).
//
// Nightly LLM multi-class classifier over the day's ingest_shadow rows that BOTH gates dropped
// (live_matched=false AND shadow_matched=false — the recall-opportunity set). One call per item asks
// which active client(s), if any, the item genuinely concerns; matches promote the shadow row to
// basis='semantic'. Write-isolated: updates ONLY ingest_shadow, never signals, never the live engine.
//
// Operator requirements (2026-08-07):
//   • Registered cron (declared expectation), NOT a hook.
//   • Attempt heartbeat BEFORE the gate (Mode-2 doctrine).
//   • Output assertion: candidates present but ZERO classified = FAILURE (failHeartbeat), not a quiet
//     night. A dead API or broken run surfaces instead of masquerading as "nothing to do."
//   • Hard per-run ITEM cap and SPEND ceiling (a surprise bill happened once this week).
//   • MEASURED spend per run (from the gateway's token usage), logged in the heartbeat, so actual
//     can be compared to the $3/mo estimate rather than assumed.

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { startHeartbeat, completeHeartbeat, failHeartbeat } from "../_shared/heartbeat.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { shadowComposite, tier2Eligible, shadowSeverity } from "../_shared/shadow-scorer.ts";

// ── Caps (see the WO for the rationale I reported to the operator) ────────────────────────────────
// Normal day ≈ 511 no_client_match items; ITEM_CAP=2000 is ~4× that — absorbs the initial ~48h
// backlog + spikes, bounds a runaway (e.g. a marker regression re-classifying old rows). Monthly
// worst-case AT the cap ≈ 2000×30×$0.00021 ≈ $12.6. SPEND_CEILING is the "surprise bill" backstop:
// $1.00/run hard stop = $30/mo absolute, whatever the per-item token count turns out to be. Under
// normal token counts the ITEM cap binds first; the spend ceiling only bites if per-item cost runs
// ~2.4× the estimate. Both are logged when hit — no silent cap.
// FINDING (2026-08-08, recorded): the first real run SIGKILLed at ~198s edge wall-clock after 317
// items. ITEM_CAP was a SPEND governor for a problem we did not have — the binding constraint was
// WALL-CLOCK, and nothing in the original design accounted for it. Same class as the other "the
// number we watched was not the number that mattered" findings. The real governor is BUDGET_MS; the
// spend ceiling stays as a backstop; ITEM_CAP is now just a sane load cap (≈ what one budgeted run
// can process at CONCURRENCY).
const BUDGET_MS = 150_000;        // wall-clock budget — the REAL governor (safety margin under the ~200s edge kill)
const CONCURRENCY = 8;            // classify in concurrent batches so ~500/day + backlog clears in one run
const ITEM_CAP = 2000;            // load cap / backstop (≈ CONCURRENCY × BUDGET throughput); not the primary governor
const SPEND_CEILING_USD = 1.00;   // hard spend backstop

const MODEL = "gpt-4o-mini";
const PRICE_IN_PER_1M = 0.15;   // gpt-4o-mini input  $/1M tokens
const PRICE_OUT_PER_1M = 0.60;  // gpt-4o-mini output $/1M tokens
const CONF_THRESHOLD = 0.60;    // a semantic match must clear this to count (mirrors shadow-matcher)

interface ClientRow {
  id: string;
  name: string;
  monitoring_keywords?: string[] | null;
  competitor_names?: string[] | null;
  high_value_assets?: string[] | null;
  locations?: string[] | null;
}

function clientContext(clients: ClientRow[]): string {
  return clients.map((c) => {
    const kw = (c.monitoring_keywords || []).slice(0, 20).join(", ");
    const assets = (c.high_value_assets || []).slice(0, 10).join(", ");
    const locs = (c.locations || []).slice(0, 10).join(", ");
    return `- id=${c.id} | name="${c.name}"${kw ? ` | keywords: ${kw}` : ""}${assets ? ` | assets: ${assets}` : ""}${locs ? ` | locations: ${locs}` : ""}`;
  }).join("\n");
}

function buildPrompt(ctx: string, title: string, body: string): string {
  return `You are a relevance classifier for a security-monitoring platform. Decide which monitored client(s), if any, a news item GENUINELY concerns — i.e. it is substantively about that client's organization, people, assets, locations, or monitored topics. Incidental keyword overlap or generic industry news is NOT a match.

MONITORED CLIENTS:
${ctx}

NEWS ITEM:
title: ${title || "(none)"}
body: ${body || "(none)"}

Return STRICT JSON only, no prose:
{"matches":[{"client_id":"<one of the ids above>","confidence":0.0-1.0}]}
Use an empty array when no client genuinely applies. Only include a client at confidence >= 0.6 if you are reasonably sure.`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Attempt heartbeat FIRST (Mode-2): a rejected/failed run is distinguishable from never-invoked.
  const supabase = createServiceClient();
  const hb = await startHeartbeat(supabase, "classify-shadow-semantic-nightly");

  const gate = requireInternalCaller(req);
  if (gate) { await failHeartbeat(supabase, hb, new Error("rejected: internal-caller gate")); return gate; }

  try {
    // 0. REAP-ON-START: an edge isolate SIGKILLed mid-batch can't self-timeout, so its heartbeat sits
    //    'running' forever (this is exactly what left the 08-08 run stuck 7.2h). Mark any earlier
    //    'running' row for this job failed before we begin. Bounded, self-healing.
    if ((hb as any)?.id) {
      await supabase.from("cron_heartbeat").update({
        status: "failed", completed_at: new Date().toISOString(),
        error_message: "reaped: superseded by a newer run (prior run stuck running / SIGKILLed on wall-clock)",
      }).eq("job_name", "classify-shadow-semantic-nightly").eq("status", "running").neq("id", (hb as any).id);
    }

    // 1. Active clients (the label space for the multi-class classifier).
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, monitoring_keywords, competitor_names, high_value_assets, locations")
      .eq("status", "active");
    if (clientsErr) throw new Error(`load clients failed: ${clientsErr.message}`);
    const clientList = (clients || []) as ClientRow[];
    const validClientIds = new Set(clientList.map((c) => c.id));
    const ctx = clientContext(clientList);

    // 2. How many candidates EXIST (for the output assertion) vs how many we'll process (the cap).
    const { count: availableCandidates } = await supabase
      .from("ingest_shadow")
      .select("id", { count: "exact", head: true })
      .eq("live_matched", false).eq("shadow_matched", false)
      .is("semantic_classified_at", null).not("item_text", "is", null);

    const { data: candidates, error: candErr } = await supabase
      .from("ingest_shadow")
      .select("id, item_title, item_text")
      .eq("live_matched", false).eq("shadow_matched", false)
      .is("semantic_classified_at", null).not("item_text", "is", null)
      .order("first_seen_at", { ascending: true })
      .limit(ITEM_CAP);
    if (candErr) throw new Error(`load candidates failed: ${candErr.message}`);

    const items = candidates || [];

    // Per-item classify (pure of loop state). Returns status + MEASURED token usage.
    const classifyOne = async (item: any): Promise<{ status: "matched" | "classified" | "error"; tIn: number; tOut: number }> => {
      try {
        const res = await callAiGateway({
          model: MODEL,
          functionName: "classify-shadow-semantic-nightly",
          messages: [{ role: "user", content: buildPrompt(ctx, item.item_title || "", item.item_text || "") }],
          skipGuardrails: true,
        });
        const usage = (res.raw as any)?.usage || {};
        const tIn = usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const tOut = usage.completion_tokens ?? usage.output_tokens ?? 0;
        if (!res.content) return { status: "error", tIn, tOut }; // leave unclassified → retried next run
        const parsed = JSON.parse((res.content.match(/[\[{][\s\S]*[\]}]/) || [res.content])[0]);
        const raw = Array.isArray(parsed?.matches) ? parsed.matches : [];
        const matches = raw
          .filter((m: any) => m && validClientIds.has(m.client_id) && typeof m.confidence === "number" && m.confidence >= CONF_THRESHOLD)
          .map((m: any) => ({ client_id: m.client_id, confidence: m.confidence }));
        const nowIso = new Date().toISOString();
        if (matches.length > 0) {
          const topConf = Math.max(...matches.map((m: any) => m.confidence));
          const composite = shadowComposite({ matchConfidence: topConf });
          const sev = shadowSeverity({ modelSeverity: null, compositeConfidence: composite, corroborationCount: 0 });
          const { error: upErr } = await supabase.from("ingest_shadow").update({
            shadow_matched: true,
            shadow_client_ids: matches.map((m: any) => m.client_id),
            shadow_match_basis: "semantic",
            shadow_match_confidence: topConf,
            shadow_composite_confidence: composite,
            shadow_tier2_eligible: tier2Eligible(composite),
            shadow_severity: sev.severity,
            shadow_severity_basis: `${sev.basis} (semantic-recovered, no model severity)`,
            semantic_classified_at: nowIso,
          }).eq("id", item.id);
          return upErr ? { status: "error", tIn, tOut } : { status: "matched", tIn, tOut };
        }
        const { error: upErr } = await supabase.from("ingest_shadow").update({ semantic_classified_at: nowIso }).eq("id", item.id);
        return upErr ? { status: "error", tIn, tOut } : { status: "classified", tIn, tOut };
      } catch (e) {
        console.warn(`[shadow-semantic] item ${item.id} classify error:`, e instanceof Error ? e.message : String(e));
        return { status: "error", tIn: 0, tOut: 0 };
      }
    };

    // 3. Process in concurrent batches. WALL-CLOCK budget is the real governor (the 08-08 failure);
    //    spend ceiling is the backstop. Both checked BETWEEN batches so a stop is clean, never a kill.
    const t0 = Date.now();
    let classified = 0, matchedRows = 0, errors = 0, tokensIn = 0, tokensOut = 0, spendUsd = 0;
    let stopReason: string | null = null;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (Date.now() - t0 >= BUDGET_MS) { stopReason = "budget"; break; }
      if (spendUsd >= SPEND_CEILING_USD) { stopReason = "spend_ceiling"; break; }
      const results = await Promise.all(items.slice(i, i + CONCURRENCY).map(classifyOne));
      for (const r of results) {
        tokensIn += r.tIn; tokensOut += r.tOut;
        spendUsd += (r.tIn / 1e6) * PRICE_IN_PER_1M + (r.tOut / 1e6) * PRICE_OUT_PER_1M;
        if (r.status === "matched") { matchedRows++; classified++; }
        else if (r.status === "classified") { classified++; }
        else errors++;
      }
    }

    const elapsedMs = Date.now() - t0;
    const spendRounded = Math.round(spendUsd * 10000) / 10000;
    const remaining = Math.max(0, (availableCandidates ?? 0) - classified);
    const partial = remaining > 0;
    const summary = {
      available_candidates: availableCandidates ?? 0,
      items_loaded: items.length,
      classified, matched_rows: matchedRows, errors,
      remaining, partial, stop_reason: stopReason,
      tokens_in: tokensIn, tokens_out: tokensOut, spend_usd: spendRounded,
      elapsed_ms: elapsedMs, budget_ms: BUDGET_MS, item_cap: ITEM_CAP, spend_ceiling_usd: SPEND_CEILING_USD,
    };

    // OUTPUT ASSERTION 1 — candidates present but 0 classified = FAILURE (dead classifier / broken run).
    if ((availableCandidates ?? 0) > 0 && classified === 0) {
      await failHeartbeat(supabase, hb, new Error(
        `output assertion: ${availableCandidates} candidate(s) present but 0 classified (errors=${errors}) — dead classifier or broken run`));
      return errorResponse(`output assertion failed: 0 classified of ${availableCandidates} candidates`, 500);
    }

    // OUTPUT ASSERTION 2 (operator addition, 2026-08-08) — ASSERT COMPLETION, NOT JUST EXECUTION.
    // A run that ends with remaining > 0 must be a loud FINDING, not a quiet heartbeat field. A nightly
    // job that clears 60% of its queue every night and never catches up is the failure mode we've been
    // eliminating all week. Escalates if the tail is large (>25% of the queue left).
    if (partial) {
      // Severity-band so a trivial transient-error tail is VISIBLE (a finding) without paging, but a
      // genuinely non-draining queue is loud: HIGH if we hit a hard stop (budget/spend — couldn't
      // finish the load) or the tail is >25% of the queue; MEDIUM for a moderate tail; LOW for a
      // small tail with no stop (e.g. a couple of retryable errors). The failure mode we care about
      // is remaining trending flat/up across runs — that shows as repeated HIGH/MEDIUM.
      const bigTail = remaining > (availableCandidates ?? 0) * 0.25;
      const hardStop = stopReason !== null;
      const findingSeverity = (bigTail || hardStop) ? "high" : remaining > 10 ? "medium" : "low";
      await supabase.rpc("record_platform_finding", {
        p_category: "Signal Pipeline",
        p_severity: findingSeverity,
        p_title: `Shadow semantic classifier did not drain its queue: ${remaining} of ${availableCandidates} left unclassified`,
        p_analysis: `Stopped on '${stopReason}' after classifying ${classified} in ${elapsedMs}ms (spend $${spendRounded}, ${errors} errors). ${remaining} carry to the next run. If remaining stays >0 across runs the backlog never catches up — raise CONCURRENCY or run more frequently. Assert completion, not execution.`,
        p_plain_english: `The nightly recall classifier only cleared ${classified} of ${availableCandidates} items before its ${Math.round(BUDGET_MS / 1000)}s budget${stopReason === "spend_ceiling" ? "/spend ceiling" : ""}; ${remaining} are still waiting.`,
        p_action: `Watch remaining across nightly runs. If it does not trend to 0, increase throughput (concurrency/frequency); the queue is not draining.`,
        p_affected_agent: "PHASE3-SHADOW", p_affected_job: "classify-shadow-semantic-nightly",
      }).then(() => null, (e: any) => console.warn("[shadow-semantic] record_platform_finding failed:", e?.message));
    }

    await completeHeartbeat(supabase, hb, summary);
    return successResponse({ success: true, ...summary });
  } catch (err) {
    await failHeartbeat(supabase, hb, err instanceof Error ? err : new Error(String(err)));
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
