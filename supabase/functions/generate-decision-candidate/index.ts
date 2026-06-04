// generate-decision-candidate — THIN trigger resolver/composer.
// Resolves incident|cluster|analysis|sequence, composes payload+provenance,
// and DELEGATES persistence to recordDecisionCandidate / recordRecommendation.
// NO direct aegis_recommendations insert here (DG-11: single write path).
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
const VERSION = "0.2-widened";
const DEFAULT_LRM_HOURS = 72;
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
  litigation: "Account / Operations Lead",
  regulatory: "Account / Operations Lead",
  activism: "Account / Operations Lead",
  protest: "Account / Operations Lead",
  malware: "IT / Security Lead",
  vulnerability: "IT / Security Lead",
  intrusion: "IT / Security Lead",
  cybersecurity: "IT / Security Lead",
  active_threat: "Operations Lead",
  crime: "Operations Lead",
};

const CYBER = new Set(["malware", "vulnerability", "intrusion", "cybersecurity"]);
const PROX = new Set(["wildfire", "natural_disaster", "weather"]);
const ACTION_RE = /(recommend|deploy|evacuat|harden|isolate|patch|notify|pre-position|lock ?down|suspend|liaison|restrict|increase (the )?posture|escalate)/i;
const MONITOR_RE = /(continue to monitor|monitor only|no action|routine|no immediate)/i;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid json body", 400);
  }

  const { trigger_type, trigger_id, dry_run = false, force = false } = body ?? {};
  if (!["incident", "cluster", "analysis", "sequence"].includes(trigger_type)) {
    return errorResponse("trigger_type must be incident|cluster|analysis|sequence", 400);
  }
  if (!trigger_id) return errorResponse("trigger_id required", 400);

  const sb = createServiceClient();

  let ctx: any;
  try {
    ctx = await resolveTrigger(trigger_type, trigger_id, sb);
  } catch (e) {
    return errorResponse("trigger resolve failed: " + String(e), 500);
  }
  if (ctx.error) return errorResponse(ctx.error.msg, ctx.error.status);

  const now = Date.now();
  const sigs: any[] = (ctx.signals ?? []).filter(
    (s: any) => !s.event_date || new Date(s.event_date).getTime() <= now,
  );
  if (!sigs.length) {
    return successResponse({ skipped: true, reason: "no live (non-future-dated) source signals" });
  }

  const tenants = [...new Set(sigs.map((s: any) => s.tenant_id).filter(Boolean))];
  const tenantId = ctx.tenant_id ?? tenants[0];
  if (!tenantId) return errorResponse("no tenant_id resolvable", 409);
  if (tenants.length > 1) return errorResponse("cross-tenant source — refused (DG-11)", 409);

  const clientId = ctx.client_id ?? sigs[0].client_id ?? null;
  const supporting = sigs.map((s: any) => s.signal_number).filter(Boolean);
  if (!supporting.length) {
    return successResponse({ skipped: true, reason: "no supporting signal_numbers (DG-8)" });
  }
  const category = ctx.category ?? sigs[0].category ?? "activity";

  const A: any[] = ctx.analyses ?? [];
  const redTeam = A.find((a: any) => /red[- ]?team|dr-house|inside-eye/i.test(a.agent_call_sign ?? ""));
  const topNonRed = A
    .filter((a: any) => a !== redTeam && a.confidence_score != null)
    .sort((x: any, y: any) => y.confidence_score - x.confidence_score)[0];
  const confs = sigs.map((s: any) => Number(s.composite_confidence) || 0);
  const repConf = Math.max(topNonRed?.confidence_score ?? 0, ...confs);
  let band = toBand(repConf);
  const redCapped = !!(redTeam && (redTeam.confidence_score ?? 0) >= 0.7);
  if (redCapped) band = capBand(band, "POSSIBLE");

  const recommendation = (
    ctx.recommendation ||
    ctx.debate?.final_assessment ||
    topNonRed?.analysis ||
    A[0]?.analysis ||
    "No specialist recommendation available."
  ).trim().slice(0, MAX_RECO);

  let kind = "decision_candidate";
  let downgrade_reason: string | null = null;
  let ask_question: string | null = null;
  const singleNews =
    sigs.length === 1 &&
    (category === "litigation" || category === "regulatory") &&
    A.length < 2;

  if (PROX.has(category)) {
    kind = "ask";
    downgrade_reason = "asset proximity unknown";
    ask_question = `Confirm proximity of "${ctx.anchor_label}" to client assets.`;
  } else if (CYBER.has(category)) {
    kind = "ask";
    downgrade_reason = "system exposure unconfirmed";
    ask_question = `Confirm whether we operate the system(s) affected by "${ctx.anchor_label}".`;
  } else if (MONITOR_RE.test(recommendation) && !ACTION_RE.test(recommendation)) {
    kind = "know_item";
    downgrade_reason = "recommendation is monitor-only";
  } else if (singleNews) {
    kind = "know_item";
    downgrade_reason = "single-source litigation/regulatory news, uncorroborated";
  }

  let decide_by: string;
  let lrm_basis: string;
  const seq = ctx.sequence;
  const cadence =
    trigger_type === "sequence" &&
    seq?.started_at &&
    seq?.last_event_at &&
    (ctx.signals?.length ?? 0) >= 2;
  if (cadence) {
    const span = new Date(seq.last_event_at).getTime() - new Date(seq.started_at).getTime();
    const step = span / Math.max(1, ctx.signals.length - 1);
    decide_by = new Date(new Date(seq.last_event_at).getTime() + step).toISOString();
    lrm_basis = "next-event projection from sequence cadence";
  } else {
    decide_by = new Date(Date.now() + DEFAULT_LRM_HOURS * 3.6e6).toISOString();
    lrm_basis = `default +${DEFAULT_LRM_HOURS}h review horizon`;
  }

  let owner = OWNER[category] ?? "Duty Watch";
  const { data: cfg } = await sb
    .from("intelligence_config")
    .select("value")
    .eq("key", "decision_owner_roles")
    .limit(1);
  if (cfg?.[0]?.value) {
    const m = cfg[0].value;
    owner = m?.[clientId]?.[category] ?? m?.default?.[category] ?? owner;
  }

  const unknowns: string[] = [];
  if (sigs.length === 1) {
    unknowns.push("Single-signal basis — limited corroboration.");
  }
  if (sigs.some((s: any) => s.temporal_grounding === "unknown" || !s.event_date)) {
    unknowns.push("Event timing unconfirmed (temporal_grounding=unknown).");
  }
  if (redTeam) {
    unknowns.push("Red-team dissent on file — confidence capped.");
  }
  if (downgrade_reason) {
    unknowns.push("Downgrade: " + downgrade_reason + ".");
  }
  if (!unknowns.length) {
    unknowns.push("No explicit gaps captured; treat confidence as provisional.");
  }

  const decision_required = kind === "decision_candidate"
    ? `Does the ${ctx.anchor_label} ${category} situation require an operational response?`
    : (ask_question ?? `Clarify the ${ctx.anchor_label} ${category} situation before any decision.`);
  const kindLabel = kind === "decision_candidate" ? "Decision" : kind === "ask" ? "Question" : "Know";
  const title = `${kindLabel}: ${ctx.anchor_label} (${category})`;
  const trigger_ref = `${trigger_type}:${trigger_id}`;

  const payload = {
    card_status: "NASCENT",
    decision_required,
    owner,
    decide_by,
    lrm_basis,
    confidence_band: band,
    confidence_basis: {
      representative_score: repConf,
      source: topNonRed?.agent_call_sign ?? "composite_confidence",
      red_team_capped: redCapped,
    },
    recommendation,
    unknowns,
    tripwires: [
      "A concrete, dated escalation",
      "A change in the protected asset's exposure",
    ],
    supporting_signals: supporting,
    outcome: null,
  };

  const provenance = {
    generator: GENERATOR,
    version: VERSION,
    trigger: trigger_type,
    trigger_id,
    trigger_ref,
    trigger_ids: ctx.trigger_ids ?? [trigger_id],
    source_signal_numbers: supporting,
    analysis_agents: [...new Set(A.map((a: any) => a.agent_call_sign))],
    debate_record_id: ctx.debate?.id ?? null,
    downgrade_reason,
    derived_at: new Date().toISOString(),
  };

  if (!force) {
    const { data: dup } = await sb
      .from("aegis_recommendations")
      .select("id,status")
      .eq("kind", kind)
      .eq("provenance->>trigger_ref", trigger_ref)
      .not("status", "in", "(rejected,superseded)")
      .limit(1);
    if (dup?.length) {
      return successResponse({ deduped: true, existing_id: dup[0].id, kind });
    }
  }

  if (dry_run) {
    return successResponse({
      dry_run: true,
      kind,
      would_record: { tenantId, clientId, title, payload, provenance },
    });
  }

  try {
    let result: any;
    if (kind === "decision_candidate") {
      result = await recordDecisionCandidate(sb, {
        tenantId,
        clientId,
        title,
        payload,
        provenance,
        rationale: recommendation.slice(0, 500),
      });
    } else {
      result = await recordRecommendation(sb, {
        kind,
        tenantId,
        clientId,
        title,
        payload: { ...payload, outcome: payload.outcome ?? null },
        rationale: recommendation.slice(0, 500),
        actorSurface: "aegis",
        provenance,
      });
    }
    return successResponse({
      ok: true,
      kind,
      downgraded: kind !== "decision_candidate",
      downgrade_reason,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse("persist failed: " + msg, 422);
  }
});

async function loadSignals(sb: any, ids: any[]): Promise<any[]> {
  if (!ids?.length) return [];
  const { data } = await sb
    .from("signals")
    .select("id,signal_number,tenant_id,client_id,title,category,composite_confidence,event_date,temporal_grounding,severity_score")
    .in("id", ids)
    .is("deleted_at", null);
  return data ?? [];
}

async function loadAnalyses(sb: any, ids: any[]): Promise<any[]> {
  if (!ids?.length) return [];
  const { data } = await sb
    .from("signal_agent_analyses")
    .select("id,signal_id,agent_call_sign,confidence_score,analysis,trigger_reason")
    .in("signal_id", ids)
    .order("confidence_score", { ascending: false });
  return data ?? [];
}

function modeCat(sigs: any[]): string | undefined {
  const c: Record<string, number> = {};
  for (const x of sigs) {
    if (x.category) c[x.category] = (c[x.category] || 0) + 1;
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top?.[0];
}

async function resolveTrigger(type: string, id: string, sb: any): Promise<any> {
  if (type === "sequence") {
    const { data } = await sb
      .from("signal_sequences")
      .select("id,client_id,anchor_label,signal_ids,matched_stages,started_at,last_event_at,sequence_score")
      .eq("id", id)
      .limit(1);
    const s = data?.[0];
    if (!s) return { error: { status: 404, msg: "sequence not found" } };
    const signals = await loadSignals(sb, s.signal_ids ?? []);
    return {
      signals,
      analyses: await loadAnalyses(sb, s.signal_ids ?? []),
      anchor_label: s.anchor_label ?? "sequence",
      client_id: s.client_id,
      category: modeCat(signals),
      sequence: s,
      trigger_ids: [id],
    };
  }

  if (type === "cluster") {
    const { data } = await sb
      .from("signals")
      .select("id,signal_number,tenant_id,client_id,title,category,composite_confidence,event_date,temporal_grounding,severity_score")
      .eq("correlation_group_id", id)
      .is("deleted_at", null)
      .order("severity_score", { ascending: false })
      .limit(50);
    if (!data?.length) return { error: { status: 404, msg: "cluster has no signals" } };
    return {
      signals: data,
      analyses: await loadAnalyses(sb, data.map((s: any) => s.id)),
      anchor_label: (data[0].title ?? "cluster").slice(0, 48),
      client_id: data[0].client_id,
      category: modeCat(data),
      trigger_ids: [id],
    };
  }

  if (type === "analysis") {
    const { data } = await sb
      .from("signal_agent_analyses")
      .select("id,signal_id,agent_call_sign,confidence_score,analysis")
      .eq("id", id)
      .limit(1);
    const a = data?.[0];
    if (!a) return { error: { status: 404, msg: "analysis not found" } };
    const signals = await loadSignals(sb, [a.signal_id]);
    if (!signals.length) return { error: { status: 404, msg: "analysis signal missing" } };
    return {
      signals,
      analyses: [a],
      recommendation: a.analysis,
      anchor_label: (signals[0].title ?? "signal").slice(0, 48),
      client_id: signals[0].client_id,
      category: signals[0].category,
      trigger_ids: [id, signals[0].id],
    };
  }

  const { data } = await sb
    .from("incidents")
    .select("id,title,summary,incident_type,signal_id,client_id,tenant_id")
    .eq("id", id)
    .limit(1);
  const i = data?.[0];
  if (!i) return { error: { status: 404, msg: "incident not found" } };
  const idset = new Set<string>();
  if (i.signal_id) idset.add(i.signal_id);
  const { data: links } = await sb
    .from("incident_signals")
    .select("signal_id")
    .eq("incident_id", id);
  for (const l of (links ?? [])) {
    if (l.signal_id) idset.add(l.signal_id);
  }
  const ids = [...idset];
  const signals = await loadSignals(sb, ids);
  const { data: d } = await sb
    .from("agent_debate_records")
    .select("id,final_assessment")
    .eq("incident_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  return {
    signals,
    analyses: await loadAnalyses(sb, ids),
    recommendation: i.summary ?? d?.[0]?.final_assessment,
    debate: d?.[0] ?? null,
    anchor_label: (i.title ?? "incident").slice(0, 60),
    client_id: i.client_id,
    tenant_id: i.tenant_id ?? null,
    category: signals[0]?.category ?? i.incident_type ?? "incident",
    trigger_ids: [id],
  };
}
