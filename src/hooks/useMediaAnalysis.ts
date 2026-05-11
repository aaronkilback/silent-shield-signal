/**
 * useMediaAnalysis — kick off + poll AI vision analysis on a photo.
 *
 * Phase 2E. After MediaUploadField inserts a row into media_assets,
 * this hook fires the analyze-audit-photo edge function (background)
 * and polls the row's ai_analysis_status until complete or failed.
 *
 * Also exposes useStageCoverageAnalysis for the Stage 9 sweep.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PhotoFinding {
  category: string;
  severity: "informational" | "monitor" | "concerning";
  description: string;
  visual_cue: string;
  suggested_observation_field?: string;
}

export interface PhotoAnalysisResult {
  model: string;
  version: string;
  image_quality: "good" | "acceptable" | "poor" | "too_dark" | "blurry" | "cropped";
  findings: PhotoFinding[];
  // Signage photos only: OCR'd text + language. Used by FeatureCaptureCard
  // to auto-fill the text_summary attribute on signage features.
  extracted_text?: string | null;
  extracted_text_language?: string | null;
  analyzed_at: string;
}

export interface StageFinding {
  type: string;
  description: string;
  rationale?: string;
}

export interface StageAnalysis {
  id: string;
  audit_id: string;
  stage: string;
  findings: StageFinding[];
  photos_analyzed: number;
  status: "running" | "complete" | "failed";
  model: string | null;
  error: string | null;
  created_at: string;
}

/**
 * Fire-and-poll: kicks off analysis on a photo, then polls the row
 * until ai_analysis_status reaches a terminal state. Returns the
 * findings (or null if not yet ready).
 *
 * Designed to be embedded under each photo upload preview.
 */
export function usePhotoAnalysis(mediaAssetId: string | null) {
  const [polling, setPolling] = useState(false);
  const qc = useQueryClient();

  // Kick off the analysis once per mediaAssetId.
  useEffect(() => {
    if (!mediaAssetId) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.functions.invoke("analyze-audit-photo", {
          body: { media_asset_id: mediaAssetId },
        });
        if (!cancelled) {
          setPolling(true);
          // After ~10s of polling, the row should be terminal — invalidate
          // so the wizard's photo lists pick up the new findings.
          setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["media-assets"] });
            qc.invalidateQueries({ queryKey: ["photo-analysis", mediaAssetId] });
          }, 10_000);
        }
      } catch (e) {
        console.error("analyze-audit-photo invoke failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [mediaAssetId, qc]);

  // Poll the media_assets row directly.
  const query = useQuery({
    queryKey: ["photo-analysis", mediaAssetId ?? "_none"] as const,
    enabled: !!mediaAssetId,
    queryFn: async () => {
      if (!mediaAssetId) return null;
      const { data } = await supabase
        .from("media_assets")
        .select("ai_findings, ai_analysis_status, ai_analyzed_at, ai_analysis_error")
        .eq("id", mediaAssetId)
        .maybeSingle();
      return data ?? null;
    },
    refetchInterval: polling ? 2500 : false,
  });

  // Stop polling once terminal.
  useEffect(() => {
    const status = (query.data as { ai_analysis_status?: string } | null)?.ai_analysis_status;
    if (status === "complete" || status === "failed" || status === "skipped") {
      setPolling(false);
    }
  }, [query.data]);

  return {
    status: (query.data as { ai_analysis_status?: string } | null)?.ai_analysis_status ?? "pending",
    findings: ((query.data as { ai_findings?: PhotoAnalysisResult } | null)?.ai_findings ?? null) as PhotoAnalysisResult | null,
    error: (query.data as { ai_analysis_error?: string | null } | null)?.ai_analysis_error ?? null,
  };
}

/**
 * Stage 9 / per-stage coverage analysis. Operator hits a button, we
 * fire analyze-stage-coverage and surface the findings list.
 */
export function useStageCoverageAnalysis(auditId: string, stage: string) {
  return useQuery({
    queryKey: ["stage-coverage", auditId, stage] as const,
    queryFn: async (): Promise<StageAnalysis | null> => {
      const { data } = await supabase
        .from("audit_stage_analyses")
        .select("*")
        .eq("audit_id", auditId)
        .eq("stage", stage)
        .maybeSingle();
      return (data as StageAnalysis) ?? null;
    },
    enabled: !!auditId && !!stage,
    staleTime: 5_000,
  });
}

export function useRunStageCoverageAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { audit_id: string; stage: string }): Promise<StageAnalysis> => {
      const { data, error } = await supabase.functions.invoke("analyze-stage-coverage", {
        body: input,
      });
      if (error) throw error;
      return data as StageAnalysis;
    },
    onSuccess: (_v, vars) => {
      qc.invalidateQueries({ queryKey: ["stage-coverage", vars.audit_id, vars.stage] });
    },
  });
}
