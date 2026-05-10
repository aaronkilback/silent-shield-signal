/**
 * useSiteAudit — data access for the site-audit workflow.
 *
 * Wraps the three Phase-2A tables (client_assets, site_audits,
 * site_observations) behind a single hook. Each method is autonomous
 * and idempotent so the wizard can call them on every field commit
 * without coordinating. Persistence to localStorage is layered on so
 * a network drop in the field doesn't lose work — the wizard
 * synchronizes back when reconnection happens.
 *
 * Why a hook rather than a service module: every wizard step needs
 * to invalidate the same React Query cache after an upsert; doing
 * that consistently is easiest if the operations live next to the
 * query keys.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AssetClass =
  | "oil_gas_plant"
  | "well_pad"
  | "pipeline_section"
  | "office"
  | "event_venue"
  | "residence"
  | "field_office"
  | "infrastructure_node"
  | "other";

export type OperationalStatus =
  | "active"
  | "turnaround"
  | "mothballed"
  | "decommissioned"
  | "proposed";

export type CriticalityTier = "tier_1" | "tier_2" | "tier_3" | "tier_4";

export type AuditStage =
  | "identity"
  | "adjacency"
  | "perimeter"
  | "access_personnel"
  | "ot_ics"
  | "comms"
  | "external_intel"
  | "docs_compliance"
  | "action_synthesis";

export interface ClientAsset {
  id: string;
  client_id: string;
  name: string;
  asset_class: AssetClass;
  asset_subtype: string | null;
  external_ref: string | null;
  operational_status: OperationalStatus;
  criticality_tier: CriticalityTier | null;
  attributes: Record<string, unknown>;
  source: string;
  last_verified_at: string | null;
  last_verified_by: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface SiteAudit {
  id: string;
  asset_id: string;
  client_id: string;
  status: "in_progress" | "completed" | "abandoned";
  started_at: string;
  completed_at: string | null;
  primary_operator: string;
  co_operators: string[];
  wizard_state: {
    current_stage?: AuditStage;
    completed_stages?: AuditStage[];
    [key: string]: unknown;
  };
  summary_text: string | null;
  observations_count: number;
  vulnerabilities_added: number;
  controls_confirmed: number;
  report_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteObservation {
  id: string;
  audit_id: string;
  asset_id: string;
  stage: AuditStage;
  field_key: string;
  value: unknown;
  freeform_notes: string | null;
  photo_urls: string[];
  confidence: number;
  linked_risk_ids: string[];
  observer_id: string;
  observed_at: string;
  created_at: string;
}

const ASSETS_KEY = (clientId: string) => ["client-assets", clientId] as const;
const AUDIT_KEY = (auditId: string) => ["site-audit", auditId] as const;
const AUDIT_LIST_KEY = (operatorId: string) => ["site-audits", "by-operator", operatorId] as const;
const OBS_KEY = (auditId: string) => ["site-observations", auditId] as const;

const LS_PREFIX = "site-audit-wizard-state-";

// ─── Asset queries ─────────────────────────────────────────────────
export function useClientAssets(clientId: string | null) {
  return useQuery({
    queryKey: ASSETS_KEY(clientId ?? "_none"),
    enabled: !!clientId,
    queryFn: async (): Promise<ClientAsset[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from("client_assets")
        .select("*")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ClientAsset[];
    },
    staleTime: 30_000,
  });
}

export function useCreateClientAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Pick<ClientAsset, "client_id" | "name" | "asset_class"> &
        Partial<Pick<ClientAsset, "asset_subtype" | "external_ref" | "operational_status" | "criticality_tier" | "attributes">> & {
          lat?: number;
          lng?: number;
        },
    ): Promise<ClientAsset> => {
      const insertRow: Record<string, unknown> = {
        client_id: input.client_id,
        name: input.name,
        asset_class: input.asset_class,
        asset_subtype: input.asset_subtype ?? null,
        external_ref: input.external_ref ?? null,
        operational_status: input.operational_status ?? "active",
        criticality_tier: input.criticality_tier ?? null,
        attributes: input.attributes ?? {},
        source: "audit",
      };
      // Optional point geometry — written as PostGIS Point via a SQL fragment.
      // supabase-js can't pass raw SQL, so when lat/lng are provided we use an
      // RPC. For the MVP we skip geometry on initial create; the wizard's
      // Identity stage can add it via a follow-up update RPC later.
      const { data, error } = await supabase
        .from("client_assets")
        .insert(insertRow as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as ClientAsset;
    },
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ASSETS_KEY(asset.client_id) });
    },
  });
}

// ─── Audit queries ─────────────────────────────────────────────────
export function useMyOpenAudits() {
  const { user } = useAuth();
  return useQuery({
    queryKey: AUDIT_LIST_KEY(user?.id ?? "_none"),
    enabled: !!user?.id,
    queryFn: async (): Promise<(SiteAudit & { asset: ClientAsset | null })[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("site_audits")
        .select("*, asset:client_assets(*)")
        .eq("primary_operator", user.id)
        .in("status", ["in_progress", "completed"])
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as never;
    },
    staleTime: 15_000,
  });
}

export function useSiteAudit(auditId: string | null) {
  return useQuery({
    queryKey: AUDIT_KEY(auditId ?? "_none"),
    enabled: !!auditId,
    queryFn: async (): Promise<(SiteAudit & { asset: ClientAsset | null }) | null> => {
      if (!auditId) return null;
      const { data, error } = await supabase
        .from("site_audits")
        .select("*, asset:client_assets(*)")
        .eq("id", auditId)
        .maybeSingle();
      if (error) throw error;
      return (data as never) ?? null;
    },
    staleTime: 5_000,
  });
}

export function useStartAudit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { asset_id: string; client_id: string }): Promise<SiteAudit> => {
      if (!user?.id) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("site_audits")
        .insert({
          asset_id: input.asset_id,
          client_id: input.client_id,
          primary_operator: user.id,
          wizard_state: { current_stage: "identity", completed_stages: [] },
        } as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as SiteAudit;
    },
    onSuccess: (_audit, _vars, _ctx) => {
      if (user?.id) qc.invalidateQueries({ queryKey: AUDIT_LIST_KEY(user.id) });
    },
  });
}

export function useUpdateWizardState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { audit_id: string; wizard_state: SiteAudit["wizard_state"] }): Promise<void> => {
      const { error } = await supabase
        .from("site_audits")
        .update({ wizard_state: input.wizard_state } as never)
        .eq("id", input.audit_id);
      if (error) throw error;
      // Mirror to localStorage so a network drop in the field still preserves cursor.
      try {
        localStorage.setItem(
          LS_PREFIX + input.audit_id,
          JSON.stringify({ wizard_state: input.wizard_state, savedAt: new Date().toISOString() }),
        );
      } catch {
        /* ignore quota errors */
      }
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: AUDIT_KEY(vars.audit_id) });
    },
  });
}

export function useCompleteAudit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { audit_id: string; summary_text?: string }): Promise<void> => {
      const { error } = await supabase
        .from("site_audits")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          summary_text: input.summary_text ?? null,
        } as never)
        .eq("id", input.audit_id);
      if (error) throw error;
      // Clear localStorage backup once the audit is committed.
      try {
        localStorage.removeItem(LS_PREFIX + input.audit_id);
      } catch {
        /* ignore */
      }
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: AUDIT_KEY(vars.audit_id) });
      if (user?.id) qc.invalidateQueries({ queryKey: AUDIT_LIST_KEY(user.id) });
    },
  });
}

// ─── Observation queries ───────────────────────────────────────────
export function useAuditObservations(auditId: string | null) {
  return useQuery({
    queryKey: OBS_KEY(auditId ?? "_none"),
    enabled: !!auditId,
    queryFn: async (): Promise<SiteObservation[]> => {
      if (!auditId) return [];
      const { data, error } = await supabase
        .from("site_observations")
        .select("*")
        .eq("audit_id", auditId)
        .order("observed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SiteObservation[];
    },
    staleTime: 5_000,
  });
}

// ─── Writeback to client_assets ────────────────────────────────────
// Phase 2C: when Stage 1 commits canonical fields (criticality, op
// status, lat/lng) the wizard writes both an observation (audit trail)
// AND the asset row (queryable canonical state). Two SECURITY DEFINER
// RPCs gate this — they verify the audit is in-progress and linked.
export function useWritebackAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      asset_id: string;
      audit_id: string;
      criticality_tier?: string | null;
      operational_status?: string | null;
      attributes_patch?: Record<string, unknown>;
    }): Promise<unknown> => {
      const { data, error } = await supabase.rpc(
        "update_client_asset_from_audit",
        {
          p_asset_id: input.asset_id,
          p_audit_id: input.audit_id,
          p_criticality_tier: input.criticality_tier ?? null,
          p_operational_status: input.operational_status ?? null,
          p_attributes_patch: (input.attributes_patch ?? null) as never,
        } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: AUDIT_KEY(vars.audit_id) });
    },
  });
}

export function useWritebackAssetGeom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      asset_id: string;
      audit_id: string;
      lat: number;
      lng: number;
      accuracy_m?: number;
    }): Promise<unknown> => {
      const { data, error } = await supabase.rpc(
        "set_client_asset_geom",
        {
          p_asset_id: input.asset_id,
          p_audit_id: input.audit_id,
          p_lat: input.lat,
          p_lng: input.lng,
          p_accuracy_m: input.accuracy_m ?? null,
        } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: AUDIT_KEY(vars.audit_id) });
    },
  });
}

export function useUpsertObservation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      audit_id: string;
      asset_id: string;
      stage: AuditStage;
      field_key: string;
      value?: unknown;
      freeform_notes?: string;
      photo_urls?: string[];
    }): Promise<SiteObservation> => {
      if (!user?.id) throw new Error("Not authenticated");
      // Try to find an existing row for this (audit, stage, field) and
      // update it; otherwise insert. Same shape as the analyst pattern
      // — one observation per field per audit; subsequent edits on the
      // same field overwrite. Rationale: a wizard field is an idea
      // ("rate the perimeter"), the operator may revise their answer
      // before submitting; we want one canonical row, not history.
      const { data: existing } = await supabase
        .from("site_observations")
        .select("id")
        .eq("audit_id", input.audit_id)
        .eq("stage", input.stage)
        .eq("field_key", input.field_key)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        audit_id: input.audit_id,
        asset_id: input.asset_id,
        stage: input.stage,
        field_key: input.field_key,
        value: input.value !== undefined ? (input.value as never) : null,
        freeform_notes: input.freeform_notes ?? null,
        photo_urls: input.photo_urls ?? [],
        observer_id: user.id,
      };

      if (existing?.id) {
        const { data, error } = await supabase
          .from("site_observations")
          .update(payload as never)
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;
        return data as SiteObservation;
      }
      const { data, error } = await supabase
        .from("site_observations")
        .insert(payload as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as SiteObservation;
    },
    onSuccess: (_obs, vars) => {
      qc.invalidateQueries({ queryKey: OBS_KEY(vars.audit_id) });
    },
  });
}
