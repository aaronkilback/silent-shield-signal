// attribution-nexus-gate (WO-ATTRIBUTION-PERSIST-02, 2026-08-25)
// Venue attribution tiebreaker. Enqueued by trg_signals_attribution_persist for a VENUE-class
// client name-only match, which was born provisional attribution_type='none'. This gate decides
// whether the venue is the SUBJECT/affected party of a security concern (=> promote to 'direct')
// or the signal is routine event/sports/business coverage that merely names it (=> stays 'none').
//
// Order (deterministic-first, per validator-before-prompt-tuning):
//   1. deterministic security-nexus lexicon (HIGH precision, sports-metaphor terms deliberately
//      EXCLUDED) — a clean hit => 'direct'.
//   2. otherwise the LLM tiebreaker (binary, gates the LABEL only). Unavailable/uncertain/error
//      => 'none' (downgrade) — a false 'direct' on a client-facing brief is the expensive error.
// Every evaluation is logged to attribution_gate_decisions (downgrade reviewability + drift evidence).
import { createServiceClient, getCallerIdentity } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";

const MATCHER_VERSION = "attribution-nexus-gate WO-ATTRIBUTION-PERSIST-02 2026-08-25";
const LLM_MODEL = "gpt-4o-mini";

// High-precision, UNAMBIGUOUS security/safety nexus terms, matched on WORD BOUNDARIES.
// Substring matching false-positived on team names ("Calgary Stampeders"->stampede,
// "Blue Bombers"->bomb) — the same class as home->homeless. Sports-metaphor overlaps
// (shot, attack, strike, clash, fight, defense, collapse, sudden death) are intentionally
// OMITTED; a clean hit here should be a real security nexus, not a box score. The ambiguous
// middle is what the LLM tiebreaker is for. Stems use a leading boundary only (arrest ->
// arrested); collision-prone terms use full boundaries (\bbomb\b) or distinctive forms
// (\bstabb for stabbed/stabbing, not \bstab which hits "stable").
const NEXUS_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\barrest/i, label: "arrest" },
  { re: /\bevacuat/i, label: "evacuat" },
  { re: /\bprotest/i, label: "protest" },
  { re: /\bdemonstrat/i, label: "demonstration" },
  { re: /\bterror/i, label: "terror" },
  { re: /\briot/i, label: "riot" },
  { re: /\bvandal/i, label: "vandal" },
  { re: /\bsabotage/i, label: "sabotage" },
  { re: /\btrespass/i, label: "trespass" },
  { re: /\bintrud/i, label: "intruder" },
  { re: /\bintrus/i, label: "intrusion" },
  { re: /\bkidnap/i, label: "kidnap" },
  { re: /\bhostage/i, label: "hostage" },
  { re: /\bhazmat/i, label: "hazmat" },
  { re: /\bfirearm/i, label: "firearm" },
  { re: /\bgunman/i, label: "gunman" },
  { re: /\bweapon/i, label: "weapon" },
  { re: /\bdetonat/i, label: "detonat" },
  { re: /\bexplosive/i, label: "explosive" },
  { re: /\bstabb/i, label: "stabbing" },
  { re: /\bbomb\b/i, label: "bomb" },
  { re: /\bbombing/i, label: "bombing" },
  { re: /bomb threat/i, label: "bomb threat" },
  { re: /active shooter/i, label: "active shooter" },
  { re: /shots fired/i, label: "shots fired" },
  { re: /suspicious package/i, label: "suspicious package" },
  { re: /suspicious device/i, label: "suspicious device" },
  { re: /death threat/i, label: "death threat" },
  { re: /security threat/i, label: "security threat" },
  { re: /threat against/i, label: "threat against" },
  { re: /\bstampede\b/i, label: "stampede" },
  { re: /crowd crush/i, label: "crowd crush" },
  { re: /chemical spill/i, label: "chemical spill" },
  { re: /mass casualt/i, label: "mass casualt" },
  { re: /\bdoxx/i, label: "doxx" },
  { re: /\bstalking/i, label: "stalking" },
  { re: /\bassault/i, label: "assault" },
  { re: /\blockdown/i, label: "lockdown" },
];

function deterministicNexus(text: string): string[] {
  const t = text || "";
  return NEXUS_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.label);
}

Deno.serve(async (req) => {
  // Internal-only: called by job-worker with a service-role bearer.
  const caller = await getCallerIdentity(req);
  if (caller.kind !== "service_role") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: caller.kind === "unauthorized" ? 401 : 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { signal_id?: string; client_id?: string; provisional_attribution_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const { signal_id, client_id, provisional_attribution_id } = body;
  if (!signal_id || !client_id) {
    return new Response(JSON.stringify({ error: "signal_id and client_id are required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createServiceClient();

  const { data: signal, error: sErr } = await supabase
    .from("signals")
    .select("id, title, normalized_text, raw_json, client_id")
    .eq("id", signal_id)
    .maybeSingle();
  if (sErr || !signal) {
    return new Response(JSON.stringify({ error: "Signal not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  const { data: client } = await supabase
    .from("clients").select("name").eq("id", client_id).maybeSingle();
  const clientName = client?.name ?? "the client";

  const text = `${signal.title || ""}\n${signal.normalized_text || ""}`.trim();

  // ── 1. deterministic nexus ──
  let verdict: "direct" | "none";
  let gatePath: string;
  let reason: string;
  let nexusTerms: string[] = deterministicNexus(text);
  let llmInput: string | null = null;
  let llmOutput: Record<string, unknown> | null = null;
  let llmModel: string | null = null;

  if (nexusTerms.length > 0) {
    verdict = "direct";
    gatePath = "deterministic_nexus";
    reason = `Deterministic security-nexus term(s): ${nexusTerms.join(", ")}`;
  } else {
    // ── 2. LLM tiebreaker (label only; unavailable => downgrade) ──
    const excerpt = text.slice(0, 1500);
    const system = `You decide whether a news/intelligence signal is a SECURITY or SAFETY concern involving a specific venue/organization, or merely routine coverage that names it. Venues like stadiums appear constantly in sports scores, roster moves, ticketing and event notices — those are NOT security signals. Answer ONLY with JSON: {"nexus": true|false, "reason": "<one short sentence>"}. nexus=true ONLY if "${clientName}" is the subject or directly affected party of a threat, crime, protest, emergency, safety hazard, or security incident.`;
    const user = `Client/venue: ${clientName}\n\nSignal text:\n"""${excerpt}"""\n\nIs this a security/safety concern involving ${clientName}, or routine coverage?`;
    llmInput = `[system]\n${system}\n\n[user]\n${user}`;
    llmModel = LLM_MODEL;

    const { data, error, circuitOpen } = await callAiGatewayJson<{ nexus: boolean; reason: string }>({
      model: LLM_MODEL,
      functionName: "attribution-nexus-gate",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });

    if (error || circuitOpen || !data || typeof data.nexus !== "boolean") {
      // Unavailable / uncertain => DOWNGRADE (fail-safe).
      verdict = "none";
      gatePath = circuitOpen || error ? "llm_unavailable_downgrade" : "llm_error_downgrade";
      reason = `LLM tiebreaker unavailable/uncertain (${error || (circuitOpen ? "circuit_open" : "malformed")}) — downgraded to none`;
      llmOutput = data ? (data as unknown as Record<string, unknown>) : { error: error ?? "circuit_open" };
    } else {
      llmOutput = data as unknown as Record<string, unknown>;
      if (data.nexus === true) {
        verdict = "direct";
        gatePath = "llm_tiebreaker";
        reason = `LLM confirmed security nexus: ${data.reason || "(no reason given)"}`;
      } else {
        verdict = "none";
        gatePath = "llm_tiebreaker";
        reason = `LLM: routine coverage, no security nexus: ${data.reason || "(no reason given)"}`;
      }
    }
  }

  // ── verdict-complete write (handles trigger-provisional, 27-backfill, and 167-re-attribution) ──
  // Find the current authoritative row for (signal, client). Write only when the verdict CHANGES it,
  // as an append-only superseding row (the promote-on-supersede trigger demotes the old row to history).
  // Covers all cases: provisional none -> direct, existing direct -> none (the 167 sports-noise
  // downgrade), unattributed -> direct|none, and no-op when the verdict already matches.
  const { data: current } = await supabase
    .from("signal_client_attributions")
    .select("id, attribution_type")
    .eq("signal_id", signal_id).eq("client_id", client_id).eq("is_authoritative", true)
    .maybeSingle();

  let attributionId: string | null = current?.id ?? provisional_attribution_id ?? null;
  const supersededType = current?.attribution_type ?? null;
  const changed = !current || current.attribution_type !== verdict;

  if (changed) {
    const { data: written, error: wErr } = await supabase
      .from("signal_client_attributions")
      .insert({
        signal_id, client_id,
        attribution_type: verdict,
        is_authoritative: true,
        supersedes: current?.id ?? null,
        basis: {
          basis_label: verdict === "direct"
            ? (gatePath === "deterministic_nexus" ? "venue_security_nexus_deterministic" : "venue_security_nexus_llm")
            : "venue_name_only_downgrade",
          kind: verdict === "direct" ? "venue_nexus_confirmed" : "venue_no_security_nexus",
          all_matched_keywords: signal.raw_json?.matched_keywords ?? [],
          nexus_terms: nexusTerms,
          gate_path: gatePath,
          reason,
          superseded_type: supersededType,
          matcher_version: MATCHER_VERSION,
          actor: "system:attribution-nexus-gate",
        },
        created_by: null,
      })
      .select("id")
      .single();
    if (wErr) {
      // Never poison-loop the job over a ledger write; leave the current row in place, log the miss.
      console.warn(`[attribution-nexus-gate] write failed for signal ${signal_id}: ${wErr.message}`);
    } else {
      attributionId = written?.id ?? attributionId;
    }
  }

  // ── audit EVERY evaluation (downgrade reviewability + tiebreaker drift evidence) ──
  await supabase.from("attribution_gate_decisions").insert({
    signal_id, client_id,
    attribution_id: attributionId,
    gate_path: gatePath,
    verdict,
    downgraded: verdict !== "direct",
    reason,
    deterministic_nexus_terms: nexusTerms.length > 0 ? nexusTerms : null,
    llm_input: llmInput,
    llm_output: llmOutput,
    llm_model: llmModel,
    matcher_version: MATCHER_VERSION,
  });

  return new Response(JSON.stringify({ ok: true, signal_id, verdict, gate_path: gatePath, reason }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
