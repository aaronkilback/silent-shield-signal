/**
 * useAuditReport — risk ratings + recommendations + adjacent incidents
 *                  + SRA report generation.
 *
 * Phase 2F. Shapes the data the operator's SRA report requires:
 *   • 5x5 risk matrix per audit (Likelihood 1-5 × Impact A-E)
 *   • Time-bucketed recommendations (short / medium / long term)
 *   • Adjacent incidents (sister-site audits + signals within 25km)
 *   • generate-sra-report edge function call → returns HTML +
 *     signed PDF URL
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ─────────────────────────────────────────────────────────
export type RiskCategory =
  | "theft_vandalism"
  | "sabotage"
  | "environmental_damage"
  | "insider_threat"
  | "tampering_supply_chain"
  | "physical_intrusion"
  | "cyber_ot_compromise"
  | "protest_disruption"
  | "wildlife_force_majeure"
  | "wildfire_exposure";

export type ImpactLetter = "A" | "B" | "C" | "D" | "E";
export type RatingBand = "low" | "medium" | "high" | "severe" | "catastrophic";

export interface RiskRating {
  id: string;
  audit_id: string;
  risk_category: RiskCategory;
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: ImpactLetter;
  rating_label: string;       // e.g. "Medium 2C"
  rating_band: RatingBand;
  rationale: string | null;
  derived_by: "operator" | "ai" | "ai_then_human_edited";
  source_features: string[];
  created_at: string;
  updated_at: string;
}

export type RecommendationBucket = "short_term" | "medium_term" | "long_term";

export interface AuditRecommendation {
  id: string;
  audit_id: string;
  bucket: RecommendationBucket;
  description: string;
  rationale: string | null;
  source: "operator" | "ai" | "ai_then_human_edited";
  priority: number;
  related_feature_ids: string[];
  related_risk_categories: string[];
  status: "open" | "in_progress" | "complete" | "dismissed";
  created_at: string;
}

export interface AdjacentIncidents {
  asset_id: string;
  radius_km: number;
  audits: Array<{
    id: string;
    completed_at: string;
    summary_text: string | null;
    asset_name: string;
    asset_class: string;
    distance_km: number;
  }>;
  signals: Array<{
    id: string;
    created_at: string;
    title: string;
    severity: string;
    signal_type: string;
  }>;
  note?: string;
}

// ─── Risk-rating UI labels ─────────────────────────────────────────
export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  theft_vandalism: "Theft / Vandalism",
  sabotage: "Sabotage",
  environmental_damage: "Environmental Damage (spill, leak)",
  insider_threat: "Insider Threat",
  tampering_supply_chain: "Tampering / Supply Chain",
  physical_intrusion: "Physical Intrusion",
  cyber_ot_compromise: "Cyber / OT Compromise",
  protest_disruption: "Protest / Operational Disruption",
  wildlife_force_majeure: "Wildlife Encounter (bear, wolf, moose)",
  wildfire_exposure: "Wildfire Exposure",
};

export const LIKELIHOOD_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Rare",
  2: "Unlikely",
  3: "Possible",
  4: "Likely",
  5: "Almost Certain",
};

export const IMPACT_LABEL: Record<ImpactLetter, string> = {
  A: "Insignificant",
  B: "Minor",
  C: "Moderate",
  D: "Major",
  E: "Catastrophic",
};

/** Compute the SRA-format rating label "Medium 2C" + band. */
export function deriveRating(
  likelihood: number,
  impact: ImpactLetter,
): { label: string; band: RatingBand } {
  // Convert impact letter to numeric (A=1..E=5) for matrix lookup
  const impactNum = ({ A: 1, B: 2, C: 3, D: 4, E: 5 } as const)[impact];
  const score = likelihood * impactNum;
  // 5x5 matrix bands — typical industrial scoring:
  //   1-3   → Low
  //   4-7   → Medium
  //   8-12  → High
  //   13-19 → Severe
  //   20-25 → Catastrophic
  let band: RatingBand;
  if (score <= 3)       band = "low";
  else if (score <= 7)  band = "medium";
  else if (score <= 12) band = "high";
  else if (score <= 19) band = "severe";
  else                  band = "catastrophic";

  const bandTitle = band[0].toUpperCase() + band.slice(1);
  return { label: `${bandTitle} ${likelihood}${impact}`, band };
}

// ─── Hooks ─────────────────────────────────────────────────────────
const RATINGS_KEY = (auditId: string) => ["audit-risk-ratings", auditId] as const;
const RECS_KEY = (auditId: string) => ["audit-recommendations", auditId] as const;
const ADJACENT_KEY = (assetId: string) => ["adjacent-incidents", assetId] as const;

export function useRiskRatings(auditId: string | null) {
  return useQuery({
    queryKey: RATINGS_KEY(auditId ?? "_none"),
    enabled: !!auditId,
    queryFn: async (): Promise<RiskRating[]> => {
      if (!auditId) return [];
      const { data, error } = await supabase
        .from("audit_risk_ratings")
        .select("*")
        .eq("audit_id", auditId);
      if (error) throw error;
      return (data ?? []) as RiskRating[];
    },
    staleTime: 10_000,
  });
}

export function useUpsertRiskRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      audit_id: string;
      risk_category: RiskCategory;
      likelihood: 1 | 2 | 3 | 4 | 5;
      impact: ImpactLetter;
      rationale?: string;
      derived_by?: RiskRating["derived_by"];
      source_features?: string[];
    }): Promise<void> => {
      const { label, band } = deriveRating(input.likelihood, input.impact);
      const row = {
        audit_id: input.audit_id,
        risk_category: input.risk_category,
        likelihood: input.likelihood,
        impact: input.impact,
        rating_label: label,
        rating_band: band,
        rationale: input.rationale ?? null,
        derived_by: input.derived_by ?? "operator",
        source_features: input.source_features ?? [],
      };
      const { error } = await supabase
        .from("audit_risk_ratings")
        .upsert(row as never, { onConflict: "audit_id,risk_category" });
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: RATINGS_KEY(vars.audit_id) });
    },
  });
}

export function useRecommendations(auditId: string | null) {
  return useQuery({
    queryKey: RECS_KEY(auditId ?? "_none"),
    enabled: !!auditId,
    queryFn: async (): Promise<AuditRecommendation[]> => {
      if (!auditId) return [];
      const { data, error } = await supabase
        .from("audit_recommendations")
        .select("*")
        .eq("audit_id", auditId)
        .order("bucket")
        .order("priority", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AuditRecommendation[];
    },
    staleTime: 10_000,
  });
}

export function useUpsertRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      audit_id: string;
      bucket: RecommendationBucket;
      description: string;
      rationale?: string;
      source?: AuditRecommendation["source"];
      priority?: number;
      related_feature_ids?: string[];
      related_risk_categories?: string[];
    }): Promise<void> => {
      const row = {
        ...(input.id ? { id: input.id } : {}),
        audit_id: input.audit_id,
        bucket: input.bucket,
        description: input.description,
        rationale: input.rationale ?? null,
        source: input.source ?? "operator",
        priority: input.priority ?? 0,
        related_feature_ids: input.related_feature_ids ?? [],
        related_risk_categories: input.related_risk_categories ?? [],
      };
      if (input.id) {
        const { error } = await supabase
          .from("audit_recommendations")
          .update(row as never)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("audit_recommendations")
          .insert(row as never);
        if (error) throw error;
      }
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: RECS_KEY(vars.audit_id) });
    },
  });
}

export function useDeleteRecommendation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; audit_id: string }): Promise<void> => {
      const { error } = await supabase.from("audit_recommendations").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: RECS_KEY(vars.audit_id) });
    },
  });
}

export function useAdjacentIncidents(assetId: string | null) {
  return useQuery({
    queryKey: ADJACENT_KEY(assetId ?? "_none"),
    enabled: !!assetId,
    queryFn: async (): Promise<AdjacentIncidents | null> => {
      if (!assetId) return null;
      const { data, error } = await supabase.rpc(
        "get_adjacent_incidents",
        { p_asset_id: assetId, p_radius_km: 25 } as never,
      );
      if (error) throw error;
      return (data as AdjacentIncidents) ?? null;
    },
    staleTime: 60_000,
  });
}

/** Generate the SRA report. Returns HTML + view URL (renders inline) +
 *  signed URL (raw bytes, can download) + storage path. */
export function useGenerateSRAReport() {
  return useMutation({
    mutationFn: async (input: { audit_id: string }): Promise<{
      html: string;
      view_url: string | null;     // preferred — renders in browser
      signed_url: string | null;   // raw bytes from storage
      storage_path: string;
    }> => {
      const { data, error } = await supabase.functions.invoke("generate-sra-report", {
        body: input,
      });
      if (error) throw error;
      return data as never;
    },
  });
}
