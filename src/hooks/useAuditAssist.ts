/**
 * useAuditAssist — agent-prefill + targeted-prompt engine.
 *
 * Phase 2C: for each stage the operator opens, recompute live:
 *   • known_facts          — what we already know about this asset
 *                            (from substrate, from prior audits, from
 *                            the current audit's earlier stages)
 *   • targeted_prompts     — questions the agent wants the operator
 *                            to answer because the answer is missing,
 *                            stale, or contradicts another source
 *   • prefill_suggestions  — values the agent proposes for fields in
 *                            this stage, each with a citation. The
 *                            operator confirms with an explicit Apply
 *                            button — no auto-apply.
 *
 * Pure-frontend by design. The inputs (substrate, prior audits, this
 * audit's observations) all come from existing query endpoints, so
 * recomputing on every stage open is cheap. No new edge function
 * surface; no per-prompt dismissal table to drift out of sync.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  type AuditStage,
  type ClientAsset,
  type SiteAudit,
  type SiteObservation,
} from "@/hooks/useSiteAudit";

export interface KnownFact {
  field_key: string;
  label: string;
  value: string;
  source: "substrate" | "prior_audit" | "this_audit" | "asset_record";
  confidence: number;          // 0-1
  staleness_days?: number;     // days since last verified, if known
  citation?: string;           // source detail (e.g. "Peace River RD")
}

export interface TargetedPrompt {
  field_key: string;
  question: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

export interface PrefillSuggestion {
  field_key: string;
  label: string;
  suggested_value: unknown;
  citation: string;          // where the value came from
  confidence: number;        // 0-1
}

export interface AuditAssistResult {
  known_facts: KnownFact[];
  targeted_prompts: TargetedPrompt[];
  prefill_suggestions: PrefillSuggestion[];
  substrate_summary: string | null;   // 1-line summary of geographic context
}

interface SubstrateContext {
  point: { lat: number; lng: number };
  containing: Array<{
    layer: string;
    name: string;
    confidence: number;
  }>;
  nearby: Array<{
    layer: string;
    name: string;
    distance_km: number;
  }>;
  summary_text: string;
}

const ASSIST_KEY = (auditId: string, stage: AuditStage) =>
  ["audit-assist", auditId, stage] as const;

/**
 * Most-recent completed audit for the asset, EXCLUDING the current
 * one. Returns null if this is the asset's first audit.
 */
async function fetchPriorAuditObservations(
  assetId: string,
  excludeAuditId: string,
): Promise<{ audit: SiteAudit; observations: SiteObservation[] } | null> {
  const { data: prior, error: priorErr } = await supabase
    .from("site_audits")
    .select("*")
    .eq("asset_id", assetId)
    .eq("status", "completed")
    .neq("id", excludeAuditId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorErr || !prior) return null;

  const { data: obs, error: obsErr } = await supabase
    .from("site_observations")
    .select("*")
    .eq("audit_id", (prior as SiteAudit).id);
  if (obsErr) return null;

  return {
    audit: prior as SiteAudit,
    observations: (obs ?? []) as SiteObservation[],
  };
}

/**
 * Hit get-site-context if the asset has a known lat/lng in attributes
 * OR has had a geom_capture observation in this audit. Returns null
 * silently if no coords are known yet.
 */
async function fetchSubstrateContext(
  asset: ClientAsset,
  thisAuditObservations: SiteObservation[],
): Promise<SubstrateContext | null> {
  // Prefer a captured-in-this-audit lat/lng over the asset's stored
  // value — operator-verified beats stale.
  const gpsObs = thisAuditObservations.find(
    (o) => o.stage === "identity" && o.field_key === "gps_coords",
  );
  let lat: number | null = null;
  let lng: number | null = null;

  if (gpsObs?.value && typeof gpsObs.value === "object") {
    const v = gpsObs.value as { lat?: number; lng?: number };
    if (typeof v.lat === "number" && typeof v.lng === "number") {
      lat = v.lat; lng = v.lng;
    }
  }
  if (lat === null || lng === null) {
    const attrs = asset.attributes as { lat?: number; lng?: number };
    if (typeof attrs.lat === "number" && typeof attrs.lng === "number") {
      lat = attrs.lat; lng = attrs.lng;
    }
  }
  if (lat === null || lng === null) return null;

  const { data, error } = await supabase.functions.invoke("get-site-context", {
    body: { lat, lng, radius_km: 25 },
  });
  if (error || !data) return null;
  return data as SubstrateContext;
}

/**
 * Compute known_facts + targeted_prompts + prefill_suggestions for a
 * given stage. Pure function over (asset, this-audit obs, prior obs,
 * substrate). No I/O — easy to test.
 */
function computeAssist(
  stage: AuditStage,
  asset: ClientAsset,
  thisAuditObs: SiteObservation[],
  prior: { audit: SiteAudit; observations: SiteObservation[] } | null,
  substrate: SubstrateContext | null,
): AuditAssistResult {
  const known: KnownFact[] = [];
  const prompts: TargetedPrompt[] = [];
  const prefills: PrefillSuggestion[] = [];

  const daysSince = (iso: string | null): number | undefined => {
    if (!iso) return undefined;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  };

  // ─── Identity stage ─────────────────────────────────────────────
  if (stage === "identity") {
    // Always-known: name + class from the asset row.
    known.push({
      field_key: "name",
      label: "Site name",
      value: asset.name,
      source: "asset_record",
      confidence: 1.0,
    });
    known.push({
      field_key: "asset_class",
      label: "Asset class",
      value: asset.asset_class,
      source: "asset_record",
      confidence: 1.0,
    });

    // Prior values from the asset row — propose as prefill.
    if (asset.criticality_tier) {
      const staleness = daysSince(asset.last_verified_at);
      known.push({
        field_key: "criticality_tier",
        label: "Criticality tier",
        value: asset.criticality_tier,
        source: "asset_record",
        confidence: asset.confidence,
        staleness_days: staleness,
      });
      prefills.push({
        field_key: "criticality_tier",
        label: "Criticality tier (from last visit)",
        suggested_value: asset.criticality_tier,
        citation: staleness !== undefined
          ? `Last confirmed ${staleness} day${staleness === 1 ? "" : "s"} ago`
          : "Stored on asset record",
        confidence: asset.confidence,
      });
      if (staleness !== undefined && staleness > 90) {
        prompts.push({
          field_key: "criticality_tier",
          question: "Is the criticality tier still correct?",
          rationale: `Last verified ${staleness} days ago.`,
          priority: "medium",
        });
      }
    } else {
      prompts.push({
        field_key: "criticality_tier",
        question: "What criticality tier is this site? (1=mission-critical, 4=peripheral)",
        rationale: "No tier on file. Required for downstream risk weighting.",
        priority: "high",
      });
    }

    if (asset.operational_status) {
      known.push({
        field_key: "operational_status",
        label: "Operational status",
        value: asset.operational_status,
        source: "asset_record",
        confidence: asset.confidence,
        staleness_days: daysSince(asset.last_verified_at),
      });
    }

    const attrs = asset.attributes as { lat?: number; lng?: number };
    if (typeof attrs.lat === "number" && typeof attrs.lng === "number") {
      known.push({
        field_key: "gps_coords",
        label: "GPS",
        value: `${attrs.lat.toFixed(4)}, ${attrs.lng.toFixed(4)}`,
        source: "asset_record",
        confidence: asset.confidence,
      });
    } else {
      prompts.push({
        field_key: "gps_coords",
        question: "Capture GPS at the site.",
        rationale: "No coordinates on file — substrate jurisdictional lookups depend on this.",
        priority: "high",
      });
    }
  }

  // ─── Adjacency stage ───────────────────────────────────────────
  if (stage === "adjacency") {
    if (substrate) {
      known.push({
        field_key: "geographic_context",
        label: "Geographic context",
        value: substrate.summary_text,
        source: "substrate",
        confidence: 0.9,
        citation: "BC GeoBC / canvas substrate",
      });
      // Jurisdictional prefills — each containing polygon proposes
      // the right field.
      for (const c of substrate.containing) {
        if (c.layer === "bc_regional_district") {
          prefills.push({
            field_key: "regional_district",
            label: "Regional district",
            suggested_value: c.name,
            citation: "Canvas substrate (BC GeoBC ABMS)",
            confidence: c.confidence,
          });
        }
        if (c.layer === "bc_fire_service_area") {
          prefills.push({
            field_key: "fire_service_area",
            label: "BC fire centre",
            suggested_value: c.name,
            citation: "Canvas substrate",
            confidence: c.confidence,
          });
        }
        if (c.layer === "bc_health_authority") {
          prefills.push({
            field_key: "health_authority",
            label: "Health authority",
            suggested_value: c.name,
            citation: "Canvas substrate",
            confidence: c.confidence,
          });
        }
      }
      // High-value targeted prompts — what substrate CAN'T tell us
      // (response times, mutual aid).
      prompts.push({
        field_key: "rcmp_field_tested_response_min",
        question: "Field-tested RCMP response time (minutes)?",
        rationale: "Canvas knows the nearest detachment polygon but not actual response performance.",
        priority: "high",
      });
      prompts.push({
        field_key: "mutual_aid_agreements",
        question: "Are there mutual-aid agreements with neighbouring operators?",
        rationale: "Not derivable from public substrate.",
        priority: "medium",
      });
    } else {
      prompts.push({
        field_key: "gps_coords",
        question: "Capture GPS first — substrate prefill is blocked without it.",
        rationale: "Adjacency stage depends on geographic context which needs lat/lng.",
        priority: "high",
      });
    }
  }

  // ─── Stages with prior-audit deltas ─────────────────────────────
  // For perimeter/access/ot_ics/comms/external_intel/docs_compliance,
  // surface anything captured in the prior audit so the operator can
  // confirm or note changes.
  if (prior && stage !== "identity" && stage !== "action_synthesis") {
    const priorForStage = prior.observations.filter((o) => o.stage === stage);
    const priorDate = prior.audit.completed_at
      ? new Date(prior.audit.completed_at).toLocaleDateString()
      : "earlier";
    for (const o of priorForStage.slice(0, 5)) {
      const text = o.freeform_notes
        ? o.freeform_notes.substring(0, 140)
        : JSON.stringify(o.value ?? "").substring(0, 80);
      known.push({
        field_key: o.field_key,
        label: o.field_key.replace(/_/g, " "),
        value: text,
        source: "prior_audit",
        confidence: 0.7,
        citation: `Captured ${priorDate}`,
      });
    }
    if (priorForStage.length > 0) {
      prompts.push({
        field_key: "delta_from_prior",
        question: `Anything changed since the ${priorDate} visit?`,
        rationale: "Confirming no-change is as valuable as flagging change.",
        priority: "medium",
      });
    }
  }

  return {
    known_facts: known,
    targeted_prompts: prompts,
    prefill_suggestions: prefills,
    substrate_summary: substrate?.summary_text ?? null,
  };
}

export function useAuditAssist(
  audit: (SiteAudit & { asset: ClientAsset | null }) | null | undefined,
  stage: AuditStage,
  thisAuditObservations: SiteObservation[],
) {
  return useQuery({
    queryKey: ASSIST_KEY(audit?.id ?? "_none", stage),
    enabled: !!audit?.asset,
    queryFn: async (): Promise<AuditAssistResult> => {
      if (!audit?.asset) {
        return { known_facts: [], targeted_prompts: [], prefill_suggestions: [], substrate_summary: null };
      }
      // Fetch prior audit + substrate in parallel.
      const [prior, substrate] = await Promise.all([
        fetchPriorAuditObservations(audit.asset.id, audit.id),
        fetchSubstrateContext(audit.asset, thisAuditObservations),
      ]);
      return computeAssist(stage, audit.asset, thisAuditObservations, prior, substrate);
    },
    staleTime: 30_000,
  });
}

/**
 * Gap analyzer — across ALL stages, what hasn't been captured yet?
 * Powers the "Ask Me What You Need" button. Surfaces a prioritized
 * list of missing fields so the operator can choose what to capture
 * next without paging through every stage.
 */
export function useAuditGapAnalysis(
  audit: (SiteAudit & { asset: ClientAsset | null }) | null | undefined,
  thisAuditObservations: SiteObservation[],
) {
  return useQuery({
    queryKey: ["audit-gaps", audit?.id ?? "_none"],
    enabled: !!audit?.asset,
    queryFn: async (): Promise<{ stage: AuditStage; prompts: TargetedPrompt[] }[]> => {
      if (!audit?.asset) return [];
      // Re-use the assist computation for each stage, returning only
      // the prompts (skip known + prefill).
      const [prior, substrate] = await Promise.all([
        fetchPriorAuditObservations(audit.asset.id, audit.id),
        fetchSubstrateContext(audit.asset, thisAuditObservations),
      ]);
      const stages: AuditStage[] = [
        "identity", "adjacency", "perimeter", "access_personnel",
        "ot_ics", "comms", "external_intel", "docs_compliance",
      ];
      const out: { stage: AuditStage; prompts: TargetedPrompt[] }[] = [];
      for (const s of stages) {
        const r = computeAssist(s, audit.asset, thisAuditObservations, prior, substrate);
        if (r.targeted_prompts.length > 0) {
          out.push({ stage: s, prompts: r.targeted_prompts });
        }
      }
      return out;
    },
    staleTime: 30_000,
  });
}
