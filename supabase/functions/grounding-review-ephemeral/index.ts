// WO-GROUNDING-01 — EPHEMERAL REVIEW HARNESS. Deploy → invoke → capture → DELETE, same session. NOT a permanent
// function; registered in drift-baseline.json only for the deployed window. Produces the flag-gated side-by-side
// (existing prose path untouched — this NEVER modifies generate-executive-report) + the judge inputs.
//
// HARD CONSTRAINTS (operator conditions, 2026-07-31):
//   1. AUTH: requireInternalCaller FIRST — before service client, before body read. verify_jwt=false + this gate.
//   2. READ-ONLY: this function performs ONLY .select()/.rpc() reads. It NEVER inserts/updates signals, entities,
//      reports, claims, or any prod table. All output is returned in the response; the caller captures it.
//      Legal hold over the entity population is respected — nothing is written, nothing is mutated.
//   3. EPHEMERAL: torn down (undeploy + repo-remove + baseline-remove) in the same session.
//
// TWO MODES (one deploy, two invocations):
//   mode "derive" (default): side-by-side on the window. Runs the NEW binding-at-derivation path (real LLM) AND a
//     faithful representative of the OLD prose path (same model, prose-then-cite), plus the denominator chain, the
//     Flash each path selects, and GENERATED candidate inference pairs (anchors + conclusion, NO verdict) for the
//     operator to hand-label. It does NOT label them.
//   mode "judge": body { pairs: [{id, anchors[], conclusion}] } (the EXACT pairs from stage 1, after the operator
//     has labelled them elsewhere). Runs the live entailment judge (Gemini, decorrelated) + the structural anchor
//     check on each. Returns per-pair verdicts. Labels are the operator's; this only produces the judge's calls.

import { requireInternalCaller } from "../_shared/require-internal-caller.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { buildGroundingDeps } from "../_shared/grounding/resolvers.ts";
import { deriveClaimsFromSignal, clientClaims } from "../_shared/grounding/derivation.ts";
import { makeLlmDeriveCandidates } from "../_shared/grounding/derivation-llm.ts";
import { selectFlash, type TaggedClaim } from "../_shared/grounding/assembly.ts";
import { inferenceAnchorCheck, type DerivedClaim } from "../_shared/grounding/derived-claim.ts";
import { makeLlmEntailmentJudge } from "../_shared/grounding/inference-llm.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-fortress-internal, content-type", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: cors });

const PECL = "0f5c809d-60ec-4252-b94b-1f4b6c8ac95d";
const DERIVE_MODEL = "gpt-4o-mini"; // same family the real derivation/deductions feature would use

/** Run tasks with bounded concurrency (keeps the whole thing well under the 150s edge ceiling). */
async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  // CONDITION 1 — internal gate FIRST, before any service client or body read.
  const gate = requireInternalCaller(req);
  if (gate) return gate;

  const supabase = createServiceClient();
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body = derive defaults */ }
  const mode = body.mode === "judge" ? "judge" : "derive";

  try {
    // ───────────────────────────── mode: judge (stage 2) ─────────────────────────────
    if (mode === "judge") {
      const pairs: Array<{ id: string; anchors: string[]; conclusion: string }> = Array.isArray(body.pairs) ? body.pairs : [];
      if (!pairs.length) return json({ error: "judge mode requires body.pairs [{id, anchors[], conclusion}]" }, 400);
      const judge = makeLlmEntailmentJudge(); // gemini-2.5-flash (decorrelated from derivation)
      const verdicts = await pool(pairs, 6, async (p) => {
        const structural = inferenceAnchorCheck(p.conclusion, p.anchors);
        const ent = await judge(p.conclusion, p.anchors);
        return {
          id: p.id,
          structural_grounded: structural.grounded,
          structural_ungrounded: structural.ungrounded,
          entailed: ent.entailed,
          reason: ent.reason,
        };
      });
      return json({ mode, judge_model: "gemini-2.5-flash", count: verdicts.length, verdicts });
    }

    // ───────────────────────────── mode: derive (stage 1) ─────────────────────────────
    const client_id: string = body.client_id || PECL;
    const since: string = body.since || "2026-07-23T00:00:00Z";
    const until: string = body.until || "2026-07-31T00:00:00Z";

    const { data: clientRow } = await supabase.from("clients").select("name").eq("id", client_id).maybeSingle();
    const clientName: string = clientRow?.name || "the client";

    // Window fetch (client + window + active). READ-ONLY.
    const { data: sigs, error: sigErr } = await supabase
      .from("signals")
      .select("id, signal_number, normalized_text, relevance_score, quality_status, category, severity, received_at, event_date, created_at, source_url")
      .eq("client_id", client_id)
      .gte("received_at", since).lt("received_at", until)
      .eq("quality_status", "active")
      .order("received_at", { ascending: true });
    if (sigErr) throw new Error(`signal fetch: ${sigErr.message}`);
    const all = sigs ?? [];
    const relOf = (s: any) => { const v = parseFloat(s?.relevance_score); return Number.isFinite(v) ? v : 0; };
    const mainTier = all.filter((s) => relOf(s) >= 0.60);

    // Denominator chain (shared input for BOTH paths). NOTE: raw relevance_score — this review omits the
    // hazard-pathway cap the live generator applies, so main-tier here is a slight over-count for hazard classes.
    const denominator_chain = {
      client_window_all: all.length,
      active: all.length,
      main_tier_rel_ge_060: mainTier.length,
      has_url: all.filter((s) => !!s.source_url).length,
      note: "single unit = signals; raw relevance_score (no hazard-pathway cap); shared input to both paths",
    };

    const numOf = (s: any) => s.signal_number || s.id?.slice(0, 8);

    // ── NEW PATH — binding-at-derivation (real LLM) ──
    const mainIds = mainTier.map((s) => s.id);
    const deps = await buildGroundingDeps(supabase, client_id, mainIds); // read-only: selects + RPC
    const derive = makeLlmDeriveCandidates(clientName, DERIVE_MODEL);
    const perSignal = await pool(mainTier, 8, async (s) => {
      try {
        const r = await deriveClaimsFromSignal(s.id, s.normalized_text || "", deps, derive);
        return { s, r };
      } catch (e) {
        return { s, r: { signal_id: s.id, accepted: [], rejected: [{ text: "", reason: "derivation_error", detail: String(e).slice(0, 120) }] } };
      }
    });
    const newAccepted: Array<{ claim: DerivedClaim; signal_number: string }> = [];
    const newRejected: Array<{ signal: string; text: string; reason: string; detail: string }> = [];
    for (const { s, r } of perSignal) {
      for (const c of r.accepted) newAccepted.push({ claim: c, signal_number: numOf(s) });
      for (const rej of r.rejected) newRejected.push({ signal: numOf(s), text: rej.text, reason: rej.reason, detail: rej.detail });
    }
    const clientOnly = perSignal.flatMap(({ r }) => clientClaims(r, deps.clientAliases));
    const tagged: TaggedClaim[] = newAccepted.map((a, i) => ({ claim_id: `c${i}`, claim: a.claim }));
    const newFlash = selectFlash(tagged);

    // ── OLD PATH representative — prose-then-cite over the SAME main-tier signals (faithful representative of the
    //    ungrounded prose approach; NOT the full 2373-line generate-executive-report, which is untouched). Same
    //    model. Then each emitted claim is grounding-checked against its OWN cited signal text — the value delta. ──
    const SIGDIGEST = mainTier.slice(0, 40).map((s, i) => `[SIG ${i}] ${(s.normalized_text || "").replace(/\s+/g, " ").slice(0, 240)}`).join("\n");
    const proseRes = await callAiGatewayJson<{ claims?: Array<{ text: string; cites: number[] }>; flash?: string }>({
      model: DERIVE_MODEL,
      functionName: "grounding-review-oldpath",
      messages: [
        { role: "system", content: "You are an intelligence analyst writing an executive brief. Return JSON only." },
        { role: "user", content: `From these signals for ${clientName}, write the analytic claims for the brief and one flash headline. Each claim MUST cite the [SIG N] numbers it draws from.\n\n${SIGDIGEST}\n\nReturn {"claims":[{"text":"...","cites":[N]}],"flash":"..."}` },
      ],
      extraContext: { phase: "grounding-review-oldpath" },
    });
    const oldClaimsRaw = Array.isArray(proseRes.data?.claims) ? proseRes.data!.claims! : [];
    const old_claims = oldClaimsRaw.map((c) => {
      const citedTexts = (Array.isArray(c.cites) ? c.cites : []).map((n) => mainTier[n]?.normalized_text || "").filter(Boolean);
      const chk = inferenceAnchorCheck(c.text || "", citedTexts.length ? citedTexts : [""]);
      return { text: c.text, cites: c.cites, grounded: citedTexts.length > 0 && chk.grounded, ungrounded_terms: chk.ungrounded };
    });
    const old_path = {
      note: "faithful representative of the prose path's claim step (same model, prose-then-cite); NOT the live generator",
      flash: proseRes.data?.flash ?? null,
      counts: { claims: old_claims.length, grounded: old_claims.filter((c) => c.grounded).length, ungrounded: old_claims.filter((c) => !c.grounded).length },
      claims: old_claims,
    };

    // ── Candidate inference pairs (the side-by-side generates the pairs). 2-claim sliding windows over accepted
    //    claims → one analytic conclusion each. Conclusions are MODEL-GENERATED (the deductions feature output).
    //    Returned with NO verdict — the operator hand-labels them. This function does NOT label them. ──
    const anchorClaims = newAccepted.length >= 2 ? newAccepted : [];
    const sets: DerivedClaim[][] = [];
    for (let i = 0; i + 1 < anchorClaims.length && sets.length < 28; i++) sets.push([anchorClaims[i].claim, anchorClaims[i + 1].claim]);
    // if sparse, add single-anchor sets to reach a usable count
    if (sets.length < 20) for (let i = 0; i < anchorClaims.length && sets.length < 24; i++) sets.push([anchorClaims[i].claim]);
    const genPairs = await pool(sets, 6, async (set, i) => {
      const anchors = set.map((c) => c.text);
      const g = await callAiGatewayJson<{ conclusion?: string }>({
        model: DERIVE_MODEL,
        functionName: "grounding-review-infgen",
        messages: [
          { role: "system", content: "You are an intelligence analyst. Given established facts, state ONE analytic conclusion you would draw. Return JSON only." },
          { role: "user", content: `ESTABLISHED FACTS:\n${anchors.map((a, k) => `F${k + 1}: ${a}`).join("\n")}\n\nReturn {"conclusion":"<one analytic conclusion>"}` },
        ],
        extraContext: { phase: "grounding-review-infgen" },
      });
      const conclusion = (g.data?.conclusion || "").trim();
      return conclusion ? { id: `P${i + 1}`, anchors, conclusion } : null;
    });
    const inference_pairs = genPairs.filter(Boolean);

    return json({
      mode,
      window: { client_id, client_name: clientName, since, until },
      denominator_chain,
      new_path: {
        input_signals: mainTier.length,
        client_aliases: deps.clientAliases,
        counts: { accepted: newAccepted.length, client_claims: clientOnly.length, rejected: newRejected.length },
        accepted_claims: newAccepted.map((a) => ({ text: a.claim.text, signal: a.signal_number, source_signal_ids: a.claim.source_signal_ids })),
        client_claims: clientOnly.map((c) => ({ text: c.text, source_signal_ids: c.source_signal_ids })),
        rejected: newRejected,
        flash: newFlash ? { text: newFlash.claim.text, source_signal_ids: newFlash.claim.source_signal_ids } : null,
      },
      old_path,
      inference_pairs,
      pairs_for_labelling: inference_pairs.map((p: any) => ({ id: p.id, anchors: p.anchors, conclusion: p.conclusion })),
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
