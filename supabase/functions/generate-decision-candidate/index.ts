// generate-decision-candidate — THIN trigger resolver/composer + ACT predicate.
// ACT = Stake ∧ Trajectory ∧ Window ∧ Owner ∧ Choice ∧ Leverage.
// Stake guard: a specific protected object is required (CARVER asset / client_asset /
//   monitored entity-POI). Category/intent-priority alone NEVER satisfies Stake.
// Window refinement: uncertain timing ⇒ not ACT (ASK if timing knowable, else KNOW).
// Persistence delegated to recordDecisionCandidate / recordRecommendation (DG-11).
import {
  createServiceClient,
  handleCors,
  successResponse,
  errorResponse,
} from "../_shared/supabase-client.ts";
import {
  recordDecisionCandidate,
  recordRecommendation,
  DECISION_BANDS,
} from "../_shared/aegis-recommendations.ts";

const GENERATOR = "generate-decision-candidate";
const VERSION = "0.3-act-predicate";
const DEFAULT_LRM_HOURS = 72;
const RECENCY_DAYS = 21; // window-recency horizon (NOT a confidence threshold)
const MAX_RECO = 1200;
const ORDER = [...DECISION_BANDS].reverse();

function toBand(s: number | null): string {
  if (s == null) return "UNKNOWN";
  if (s >= 0.8) return "CONFIRMED";
  if (s >= 0.6) return "PROBABLE";
  if (s >= 0.4) return "POSSIBLE";
  if (s >= 0.2) return "UNCERTAIN";
  return "UNKNOWN";
}
function capBand(b: string, cap: string): string {
  return ORDER.indexOf(b) > ORDER.indexOf(cap) ? cap : b;
}

const OWNER: Record<string, string> = {
  theft: "Operations Lead",
  wildfire: "Site / Operations Lead",
  natural_disaster: "Operations Lead",
  activism: "Account / Operations Lead",
  protest: "Account / Operations Lead",
  protest_posture: "Account / Operations Lead",
  malware: "IT / Security Lead",
  vulnerability: "IT / Security Lead",
  intrusion: "IT / Security Lead",
  cybersecurity: "IT / Security Lead",
  active_threat: "Operations Lead",
  crime: "Operations Lead",
  sabotage: "Operations Lead",
  civil_emergency: "Operations Lead",
};

const HAZARD = new Set(["wildfire", "natural_disaster", "weather", "civil_emergency"]);
const CYBER = new Set(["malware", "vulnerability", "intrusion", "cybersecurity"]);
const AWARENESS = new Set(["social_sentiment", "community_outreach", "general", "public_statement", "economic_impact", "regulatory", "litigation", "legal"]);
const RESPONSE_CATS = new Set(["activism", "protest", "protest_posture", "theft", "active_threat", "crime", "sabotage", "intrusion"]);

const ESCALATION_RE = /(open letter|blockade|occupation|arrest|anticipat|planned|escalat|mobiliz|filed|advanc|issued|called|spread|out of control|exploit|breach|injunction|notice to proceed|sabotage|threat to|march|rally|encampment)/i;
const ANTICIPATORY_RE = /(anticipat|planned|upcoming|scheduled|to proceed|pre-?mobiliz|expected|will (occur|take place)|ahead of)/i;
const ACTION_RE = /(recommend|deploy|evacuat|harden|isolate|patch|notify|pre-position|lock ?down|suspend|liaison|restrict|increase (the )?posture|escalate|engage|coordinate)/i;
const MONITOR_RE = /(continue to monitor|monitor only|no action|routine|no immediate|low threat|not (a )?(significant|immediate|real))/i;

const STOP = new Set(["the", "and", "of", "for", "bc", "british", "columbia", "canada", "energy", "gas", "ltd", "inc", "corp"]);

function stakeTerms(rows: any[]): string[] {
  const terms: string[] = [];
  for (const r of rows) {
    const raw = String(r?.asset_name ?? r?.name ?? "").toLowerCase().replace(/\(.*?\)/g, " ").trim();
    if (!raw) continue;
    const toks = raw.split(/[^a-z0-9']+/).filter((t) => t.length > 2 && !STOP.has(t));
    if (toks.length >= 2) terms.push(toks.slice(0, 2).join(" ")); // distinctive two-token phrase
    else if (toks.length === 1 && toks[0].length > 4) terms.push(toks[0]); // long single proper noun (POI surname)
  }
  return [...new Set(terms)];
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("invalid json body", 400); }

  const { trigger_type, trigger_id, dry_run = false, force = false } = body ?? {};
  if (!["incident", "cluster", "analysis", "sequence"].includes(trigger_type)) {
    return errorResponse("trigger_type must be incident|cluster|analysis|sequence", 400);
  }
  if (!trigger_id) return errorResponse("trigger_id required", 400);

  const sb = createServiceClient();

  let ctx: any;
  try { ctx = await resolveTrigger(trigger_type, trigger_id, sb); }
  catch (e) { return errorResponse("trigger resolve failed: " + String(e), 500); }
  if (ctx.error) return errorResponse(ctx.error.msg, ctx.error.status);

  const now = Date.now();
  const sigs: any[] = (ctx.signals ?? []).filter(
    (s: any) => !s.event_date || new Date(s.event_date).getTime() <= now,
  );

  // SKIP — no evaluable signal
  if (!sigs.length) {
    return successResponse({ skipped: true, route: "SKIP", routing_reason: "no live (non-future-dated) source signals" });
  }

  const tenants = [...new Set(sigs.map((s: any) => s.tenant_id).filter(Boolean))];
  const tenantId = ctx.tenant_id ?? tenants[0];
  if (!tenantId) return errorResponse("no tenant_id resolvable", 409);
  if (tenants.length > 1) return errorResponse("cross-tenant source — refused (DG-11)", 409);

  const clientId = ctx.client_id ?? sigs[0].client_id ?? null;
  const supporting = sigs.map((s: any) => s.signal_number).filter(Boolean);
  if (!supporting.length) {
    return successResponse({ skipped: true, route: "SKIP", routing_reason: "no supporting signal_numbers (DG-8)" });
  }
  const category = ctx.category ?? sigs[0].category ?? "activity";

  // recommendation (rendered verbatim; for predicate text-tests only)
  const A: any[] = ctx.analyses ?? [];
  const redTeam = A.find((a: any) => /red[- ]?team|dr-house|inside-eye/i.test(a.agent_call_sign ?? ""));
  const topNonRed = A.filter((a: any) => a !== redTeam && a.confidence_score != null)
    .sort((x: any, y: any) => y.confidence_score - x.confidence_score)[0];
  const recommendation = (
    ctx.recommendation || ctx.debate?.final_assessment || topNonRed?.analysis || A[0]?.analysis ||
    "No specialist recommendation available."
  ).trim().slice(0, MAX_RECO);

  // confidence band (the recommendation HEDGE — never drives routing; unchanged)
  const confs = sigs.map((s: any) => Number(s.composite_confidence) || 0);
  const repConf = Math.max(topNonRed?.confidence_score ?? 0, ...confs);
  let band = toBand(repConf);
  const redCapped = !!(redTeam && (redTeam.confidence_score ?? 0) >= 0.7);
  if (redCapped) band = capBand(band, "POSSIBLE");

  // ===================== ACT PREDICATE =====================
  const haystack = (String(ctx.anchor_label ?? "") + " " + sigs.map((s: any) => s.title ?? "").join(" ") + " " + recommendation).toLowerCase();

  // --- Stake: SPECIFIC protected object only (guard: category/intent never satisfies S) ---
  const { data: carver } = await sb.from("asset_carver_scores").select("asset_name").eq("client_id", clientId);
  const { data: cassets } = await sb.from("client_assets").select("name").eq("client_id", clientId).is("deleted_at", null);
  const { data: ents } = await sb.from("entities").select("name").eq("client_id", clientId).limit(300);
  const terms = stakeTerms([...(carver ?? []), ...(cassets ?? []), ...(ents ?? [])]);
  const stakeObject = terms.find((t) => t && haystack.includes(t)) ?? null;
  const clientHasAssets = ((carver?.length ?? 0) + (cassets?.length ?? 0)) > 0;
  const S = stakeObject ? "TRUE" : "FALSE";

  // --- Trajectory: moving vector, not static state ---
  const escalatedSeq = trigger_type === "sequence" && (ctx.sequence?.matched_stages?.length ?? 0) >= 2;
  const isPattern = /\[pattern\]/i.test(String(ctx.anchor_label ?? ""));
  const clustered = sigs.length > 1;
  const hasMomentum = sigs.some((s: any) => Number(s.momentum) > 0);
  const escEvent = ESCALATION_RE.test(haystack);
  const T = (escalatedSeq || isPattern || clustered || hasMomentum || escEvent) ? "TRUE" : "FALSE";

  // --- Window: OPEN | OPENING | CLOSED | UNCERTAIN (refinement) ---
  const anticipatory = ANTICIPATORY_RE.test(haystack);
  const anyUnknownTime = sigs.some((s: any) => s.temporal_grounding === "unknown" || !s.event_date);
  let W: string;
  if (anticipatory) W = "OPENING";
  else if (anyUnknownTime) W = "UNCERTAIN";
  else {
    const newest = Math.max(...sigs.map((s: any) => (s.event_date ? new Date(s.event_date).getTime() : 0)));
    const ageDays = (now - newest) / 86400000;
    W = ageDays <= RECENCY_DAYS ? "OPEN" : "CLOSED";
  }
  const timingKnowable = sigs.some((s: any) => !!s.event_date) || anticipatory;

  // --- Owner (category role map; RESOLVED unless generic fallback) ---
  const O = OWNER[category] != null ? "RESOLVED" : "DEFAULT";
  let owner = OWNER[category] ?? "Duty Watch";
  const { data: cfg } = await sb.from("intelligence_config").select("value").eq("key", "decision_owner_roles").limit(1);
  if (cfg?.[0]?.value) {
    const m = cfg[0].value;
    owner = m?.[clientId]?.[category] ?? m?.default?.[category] ?? owner;
  }

  // --- Choice: >1 non-trivial COA ---
  const monitorOnly = MONITOR_RE.test(recommendation) && !ACTION_RE.test(recommendation);
  const hasRepertoire = RESPONSE_CATS.has(category) || HAZARD.has(category) || CYBER.has(category);
  const C = (!AWARENESS.has(category) && hasRepertoire && !monitorOnly) ? "TRUE" : "FALSE";

  // --- Leverage: could the choice materially alter the outcome? ---
  let L: string;
  if (HAZARD.has(category) || CYBER.has(category)) {
    L = stakeObject ? "TRUE" : "BLOCKED"; // proximity/exposure link known only if a specific object is named
  } else if (AWARENESS.has(category)) {
    L = "FALSE"; // no operational action alters a regulatory/sentiment outcome
  } else {
    L = C === "TRUE" ? "TRUE" : "FALSE";
  }

  const predicate_result = { stake: S, trajectory: T, window: W, owner: O, choice: C, leverage: L };

  // ===================== ROUTING (ordered; first match wins) =====================
  const failed_conjuncts: string[] = [];
  const blocked_conjuncts: string[] = [];
  let route = "KNOW";
  let routing_reason = "";

  if (S === "FALSE") {
    if ((HAZARD.has(category) || CYBER.has(category)) && clientHasAssets) {
      blocked_conjuncts.push(HAZARD.has(category) ? "stake:proximity_unknown" : "stake:exposure_unknown");
      route = "ASK"; routing_reason = "stake unconfirmed (proximity/exposure) but knowable → ASK";
    } else {
      failed_conjuncts.push("stake"); route = "SKIP"; routing_reason = "no specific protected object → SKIP";
    }
  } else if (T === "FALSE") {
    failed_conjuncts.push("trajectory"); route = "KNOW"; routing_reason = "static, no movement toward stake → KNOW";
  } else if (W === "UNCERTAIN") {
    if (timingKnowable) { blocked_conjuncts.push("window:timing_unresolved"); route = "ASK"; routing_reason = "window uncertain, timing knowable → ASK"; }
    else { failed_conjuncts.push("window"); route = "KNOW"; routing_reason = "window uncertain, timing unresolvable → KNOW"; }
  } else if (W === "CLOSED") {
    failed_conjuncts.push("window"); route = "KNOW"; routing_reason = "decision window closed → KNOW";
  } else if (L === "BLOCKED") {
    blocked_conjuncts.push(HAZARD.has(category) ? "leverage:proximity_unknown" : "leverage:exposure_unknown");
    route = "ASK"; routing_reason = "leverage blocked (proximity/exposure) but knowable → ASK";
  } else if (O !== "RESOLVED") {
    blocked_conjuncts.push("owner:unassigned"); route = "ASK"; routing_reason = "owner unresolved but knowable → ASK";
  } else if (C === "FALSE") {
    failed_conjuncts.push("choice"); route = "KNOW"; routing_reason = "no non-trivial course of action → KNOW";
  } else if (L === "FALSE") {
    failed_conjuncts.push("leverage"); route = "KNOW"; routing_reason = "no action alters the outcome → KNOW";
  } else {
    route = "ACT"; routing_reason = "all conjuncts satisfied → ACT";
  }

  if (route === "SKIP") {
    return successResponse({ skipped: true, route, routing_reason, predicate_result, failed_conjuncts, blocked_conjuncts });
  }

  const kind = route === "ACT" ? "decision_candidate" : route === "ASK" ? "ask" : "know_item";

  // decide_by
  let decide_by: string;
  let lrm_basis: string;
  const seq = ctx.sequence;
  if (trigger_type === "sequence" && seq?.started_at && seq?.last_event_at && (ctx.signals?.length ?? 0) >= 2) {
    const span = new Date(seq.last_event_at).getTime() - new Date(seq.started_at).getTime();
    decide_by = new Date(new Date(seq.last_event_at).getTime() + span / Math.max(1, ctx.signals.length - 1)).toISOString();
    lrm_basis = "next-event projection from sequence cadence";
  } else {
    decide_by = new Date(now + DEFAULT_LRM_HOURS * 3.6e6).toISOString();
    lrm_basis = `default +${DEFAULT_LRM_HOURS}h review horizon`;
  }

  const unknowns: string[] = [];
  if (sigs.length === 1) unknowns.push("Single-signal basis — limited corroboration.");
  if (anyUnknownTime) unknowns.push("Event timing unconfirmed (temporal_grounding=unknown).");
  if (redTeam) unknowns.push("Red-team dissent on file — confidence capped.");
  for (const b of blocked_conjuncts) unknowns.push("Blocked: " + b + ".");
  if (!unknowns.length) unknowns.push("No explicit gaps captured; treat confidence as provisional.");

  const verb = route === "ACT" ? "require an operational response"
    : route === "ASK" ? "need clarification before a decision"
    : "be tracked for awareness";
  const decision_required = `Does the ${ctx.anchor_label} ${category} situation ${verb}?`;
  const kindLabel = route === "ACT" ? "Decision" : route === "ASK" ? "Question" : "Know";
  const title = `${kindLabel}: ${ctx.anchor_label} (${category})`;
  const trigger_ref = `${trigger_type}:${trigger_id}`;

  const payload: Record<string, unknown> = {
    card_status: "NASCENT",
    decision_required,
    owner,
    decide_by,
    lrm_basis,
    confidence_band: band,
    confidence_basis: { representative_score: repConf, source: topNonRed?.agent_call_sign ?? "composite_confidence", red_team_capped: redCapped },
    recommendation,
    unknowns,
    tripwires: ["A concrete, dated escalation", "A change in the protected asset's exposure"],
    supporting_signals: supporting,
    stake_object: stakeObject,
    predicate_result,
    failed_conjuncts,
    blocked_conjuncts,
    routing_reason,
    outcome: null,
  };
  const provenance: Record<string, unknown> = {
    generator: GENERATOR, version: VERSION, trigger: trigger_type, trigger_id, trigger_ref,
    trigger_ids: ctx.trigger_ids ?? [trigger_id], source_signal_numbers: supporting,
    analysis_agents: [...new Set(A.map((a: any) => a.agent_call_sign))],
    debate_record_id: ctx.debate?.id ?? null, route, routing_reason, derived_at: new Date().toISOString(),
  };

  if (!force) {
    const { data: dup } = await sb.from("aegis_recommendations").select("id,status")
      .eq("kind", kind).eq("provenance->>trigger_ref", trigger_ref)
      .not("status", "in", "(rejected,superseded)").limit(1);
    if (dup?.length) return successResponse({ deduped: true, existing_id: dup[0].id, kind, route });
  }

  if (dry_run) {
    return successResponse({ dry_run: true, route, kind, predicate_result, failed_conjuncts, blocked_conjuncts, routing_reason, would_record: { tenantId, clientId, title, payload } });
  }

  try {
    let result: any;
    if (route === "ACT") {
      result = await recordDecisionCandidate(sb, { tenantId, clientId, title, payload, provenance, rationale: recommendation.slice(0, 500) });
    } else {
      result = await recordRecommendation(sb, {
        kind, tenantId, clientId, title, payload, rationale: recommendation.slice(0, 500), actorSurface: "aegis", provenance,
      });
    }
    return successResponse({ ok: true, route, kind, predicate_result, failed_conjuncts, blocked_conjuncts, routing_reason, result });
  } catch (e) {
    return errorResponse("persist failed: " + (e instanceof Error ? e.message : String(e)), 422);
  }
});

// ---- resolvers ----
async function loadSignals(sb: any, ids: any[]): Promise<any[]> {
  if (!ids?.length) return [];
  const { data } = await sb.from("signals")
    .select("id,signal_number,tenant_id,client_id,title,category,composite_confidence,event_date,temporal_grounding,severity_score,momentum,proximity")
    .in("id", ids).is("deleted_at", null);
  return data ?? [];
}
async function loadAnalyses(sb: any, ids: any[]): Promise<any[]> {
  if (!ids?.length) return [];
  const { data } = await sb.from("signal_agent_analyses")
    .select("id,signal_id,agent_call_sign,confidence_score,analysis,trigger_reason")
    .in("signal_id", ids).order("confidence_score", { ascending: false });
  return data ?? [];
}
function modeCat(sigs: any[]): string | undefined {
  const c: Record<string, number> = {};
  for (const x of sigs) if (x.category) c[x.category] = (c[x.category] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
}
async function resolveTrigger(type: string, id: string, sb: any): Promise<any> {
  if (type === "sequence") {
    const { data } = await sb.from("signal_sequences")
      .select("id,client_id,anchor_label,signal_ids,matched_stages,started_at,last_event_at,sequence_score").eq("id", id).limit(1);
    const s = data?.[0];
    if (!s) return { error: { status: 404, msg: "sequence not found" } };
    const signals = await loadSignals(sb, s.signal_ids ?? []);
    return { signals, analyses: await loadAnalyses(sb, s.signal_ids ?? []), anchor_label: s.anchor_label ?? "sequence", client_id: s.client_id, category: modeCat(signals), sequence: s, trigger_ids: [id] };
  }
  if (type === "cluster") {
    const { data } = await sb.from("signals")
      .select("id,signal_number,tenant_id,client_id,title,category,composite_confidence,event_date,temporal_grounding,severity_score,momentum,proximity")
      .eq("correlation_group_id", id).is("deleted_at", null).order("severity_score", { ascending: false }).limit(50);
    if (!data?.length) return { error: { status: 404, msg: "cluster has no signals" } };
    return { signals: data, analyses: await loadAnalyses(sb, data.map((s: any) => s.id)), anchor_label: (data[0].title ?? "cluster").slice(0, 48), client_id: data[0].client_id, category: modeCat(data), trigger_ids: [id] };
  }
  if (type === "analysis") {
    const { data } = await sb.from("signal_agent_analyses").select("id,signal_id,agent_call_sign,confidence_score,analysis").eq("id", id).limit(1);
    const a = data?.[0];
    if (!a) return { error: { status: 404, msg: "analysis not found" } };
    const signals = await loadSignals(sb, [a.signal_id]);
    if (!signals.length) return { error: { status: 404, msg: "analysis signal missing" } };
    return { signals, analyses: [a], recommendation: a.analysis, anchor_label: (signals[0].title ?? "signal").slice(0, 48), client_id: signals[0].client_id, category: signals[0].category, trigger_ids: [id, signals[0].id] };
  }
  const { data } = await sb.from("incidents").select("id,title,summary,incident_type,signal_id,client_id,tenant_id").eq("id", id).limit(1);
  const i = data?.[0];
  if (!i) return { error: { status: 404, msg: "incident not found" } };
  const idset = new Set<string>();
  if (i.signal_id) idset.add(i.signal_id);
  const { data: links } = await sb.from("incident_signals").select("signal_id").eq("incident_id", id);
  for (const l of (links ?? [])) if (l.signal_id) idset.add(l.signal_id);
  const ids = [...idset];
  const signals = await loadSignals(sb, ids);
  const { data: d } = await sb.from("agent_debate_records").select("id,final_assessment").eq("incident_id", id).order("created_at", { ascending: false }).limit(1);
  return {
    signals, analyses: await loadAnalyses(sb, ids),
    recommendation: i.summary ?? d?.[0]?.final_assessment, debate: d?.[0] ?? null,
    anchor_label: (i.title ?? "incident").slice(0, 60), client_id: i.client_id, tenant_id: i.tenant_id ?? null,
    category: signals[0]?.category ?? i.incident_type ?? "incident", trigger_ids: [id],
  };
}
