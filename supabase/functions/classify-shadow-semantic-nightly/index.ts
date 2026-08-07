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
const ITEM_CAP = 2000;
const SPEND_CEILING_USD = 1.00;

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
    let classified = 0, matchedRows = 0, errors = 0;
    let tokensIn = 0, tokensOut = 0, spendUsd = 0;
    let capped: string | null = null;
    if ((availableCandidates ?? 0) > ITEM_CAP) capped = "item_cap";

    // 3. One classifier call per item. Spend tracked from real token usage; ceiling enforced mid-run.
    for (const item of items) {
      if (spendUsd >= SPEND_CEILING_USD) { capped = "spend_ceiling"; break; }

      const nowIso = new Date().toISOString();
      let matches: Array<{ client_id: string; confidence: number }> = [];
      try {
        const res = await callAiGateway({
          model: MODEL,
          functionName: "classify-shadow-semantic-nightly",
          messages: [{ role: "user", content: buildPrompt(ctx, item.item_title || "", item.item_text || "") }],
          skipGuardrails: true,
        });
        // Measured spend from the provider usage block (not an estimate).
        const usage = (res.raw as any)?.usage || {};
        const tIn = usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const tOut = usage.completion_tokens ?? usage.output_tokens ?? 0;
        tokensIn += tIn; tokensOut += tOut;
        spendUsd += (tIn / 1e6) * PRICE_IN_PER_1M + (tOut / 1e6) * PRICE_OUT_PER_1M;

        if (!res.content) { errors++; continue; } // leave unclassified → retried next run; systemic failure surfaces via the assertion
        const parsed = JSON.parse((res.content.match(/[\[{][\s\S]*[\]}]/) || [res.content])[0]);
        const raw = Array.isArray(parsed?.matches) ? parsed.matches : [];
        matches = raw
          .filter((m: any) => m && validClientIds.has(m.client_id) && typeof m.confidence === "number" && m.confidence >= CONF_THRESHOLD)
          .map((m: any) => ({ client_id: m.client_id, confidence: m.confidence }));
      } catch (e) {
        errors++;
        console.warn(`[shadow-semantic] item ${item.id} classify error:`, e instanceof Error ? e.message : String(e));
        continue; // do NOT mark classified — retry next run
      }

      if (matches.length > 0) {
        const topConf = Math.max(...matches.map((m) => m.confidence));
        const composite = shadowComposite({ matchConfidence: topConf });
        const sev = shadowSeverity({ modelSeverity: null, compositeConfidence: composite, corroborationCount: 0 });
        const { error: upErr } = await supabase.from("ingest_shadow").update({
          shadow_matched: true,
          shadow_client_ids: matches.map((m) => m.client_id),
          shadow_match_basis: "semantic",
          shadow_match_confidence: topConf,
          shadow_composite_confidence: composite,
          shadow_tier2_eligible: tier2Eligible(composite),
          shadow_severity: sev.severity,
          shadow_severity_basis: `${sev.basis} (semantic-recovered, no model severity)`,
          semantic_classified_at: nowIso,
        }).eq("id", item.id);
        if (upErr) { errors++; continue; }
        matchedRows++;
      } else {
        const { error: upErr } = await supabase.from("ingest_shadow").update({ semantic_classified_at: nowIso }).eq("id", item.id);
        if (upErr) { errors++; continue; }
      }
      classified++;
    }

    const spendRounded = Math.round(spendUsd * 10000) / 10000;
    const summary = {
      available_candidates: availableCandidates ?? 0,
      items_loaded: items.length,
      classified,
      matched_rows: matchedRows,
      errors,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      spend_usd: spendRounded,
      capped,               // null | 'item_cap' | 'spend_ceiling'
      item_cap: ITEM_CAP,
      spend_ceiling_usd: SPEND_CEILING_USD,
    };

    // OUTPUT ASSERTION: candidates existed but nothing got classified = FAILURE, not a quiet night.
    if ((availableCandidates ?? 0) > 0 && classified === 0) {
      await failHeartbeat(supabase, hb, new Error(
        `output assertion: ${availableCandidates} candidate(s) present but 0 classified (errors=${errors}) — dead classifier or broken run`));
      return errorResponse(`output assertion failed: 0 classified of ${availableCandidates} candidates`, 500);
    }

    await completeHeartbeat(supabase, hb, summary);
    return successResponse({ success: true, ...summary });
  } catch (err) {
    await failHeartbeat(supabase, hb, err instanceof Error ? err : new Error(String(err)));
    return errorResponse(err instanceof Error ? err.message : String(err), 500);
  }
});
