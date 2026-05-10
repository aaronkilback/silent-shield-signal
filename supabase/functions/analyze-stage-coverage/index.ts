/**
 * analyze-stage-coverage — meta-analysis across all photos in a stage.
 *
 * Phase 2E. Operator finishes a stage (or hits Stage 9). The wizard
 * fires this function for the stage of interest. The function:
 *
 *   1. Pulls all media_assets photos for the audit, filtered to the
 *      stage (via observation linkage or feature linkage)
 *   2. Pulls each photo's already-completed ai_findings
 *   3. Asks the LLM a meta-question: "given these N photos and their
 *      individual findings, what coverage gaps exist? what feature
 *      types are missing? what hasn't been documented?"
 *   4. Stores the result in audit_stage_analyses
 *
 * Output is a flat list of stage-level observations:
 *   [
 *     { type: "coverage_gap", description: "No camera photographed on
 *        the south-facing approach" },
 *     { type: "verification_needed", description: "Fence segment 3
 *        shows possible damage in photo IMG_0042 — recommend close-up
 *        re-shoot" },
 *     ...
 *   ]
 *
 * Cost: 1 call per stage with low-detail thumbnails. ~$0.02 per call.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getSignedUrl, BUCKETS } from "../_shared/storage.ts";

const MODEL = "gpt-4o-mini";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { audit_id, stage } = await req.json();
    if (!audit_id || !stage) return errorResponse("audit_id + stage required", 400);

    const supabase = createServiceClient();

    // Mark running.
    await supabase.from("audit_stage_analyses").upsert({
      audit_id, stage,
      findings: [], photos_analyzed: 0,
      status: "running", model: MODEL,
    } as never, { onConflict: "audit_id,stage" });

    // Pull photos linked to this audit. We don't strictly enforce
    // stage filtering at the photo level since photos can be linked
    // to features (which belong to stages) or observations (which
    // explicitly carry stage). For the MVP we look at all photos
    // for the audit and let the LLM segment by feature_type.
    const { data: photos } = await supabase
      .from("media_assets")
      .select("id, storage_path, bearing_deg, ai_findings, feature_id, feature:site_features(feature_type, label)")
      .eq("audit_id", audit_id)
      .eq("kind", "photo")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: true });

    const photoList = (photos ?? []) as Array<{
      id: string;
      storage_path: string;
      bearing_deg: number | null;
      ai_findings: { findings?: Array<{ description: string; severity: string; visual_cue: string }> } | null;
      feature?: { feature_type?: string; label?: string } | null;
    }>;

    if (photoList.length === 0) {
      const noResult = {
        audit_id, stage,
        findings: [{
          type: "no_photos",
          description: `No photos uploaded for ${stage}. Stage-level coverage analysis requires at least one photo.`,
        }],
        photos_analyzed: 0,
        status: "complete",
        model: MODEL,
      };
      await supabase.from("audit_stage_analyses").upsert(noResult as never, { onConflict: "audit_id,stage" });
      return successResponse({ status: "complete", findings_count: 1, ...noResult });
    }

    // Compose the meta-prompt — text-only, includes summaries of each
    // photo's existing findings + the feature_type. We don't send the
    // images again (would burn tokens for marginal value); the per-
    // photo analyzer already has those views.
    const summary = photoList.map((p, i) => {
      const ft = p.feature?.feature_type ?? "unknown";
      const label = p.feature?.label ?? "(unlabelled)";
      const bearing = p.bearing_deg !== null ? ` bearing ${p.bearing_deg.toFixed(0)}°` : "";
      const findings = (p.ai_findings?.findings ?? []).map((f) =>
        `${f.severity}: ${f.description}`,
      ).join("; ");
      return `${i + 1}. ${ft} "${label}"${bearing}${findings ? ` — flagged: ${findings}` : ""}`;
    }).join("\n");

    const prompt = `Stage: ${stage}

Photos captured this audit (${photoList.length}):
${summary}

Look at the inventory above for the ${stage.replace(/_/g, " ")} stage of a security audit. What coverage gaps or follow-ups should the operator address?

Examples of useful findings:
- Coverage gap: "No camera covers the south fence approach" (when fence_segment shows south but no camera does)
- Re-shoot recommendation: "Camera 3 photo flagged lens obstruction — close-up re-shoot needed"
- Inventory completeness: "Only 1 fence segment captured — typical wellsite has 4 corners + gate run"
- Pattern: "Multiple fence segments flagged for sagging — recommend perimeter walk with maintenance"

Anti-fabrication rules:
- Only reference what is in the inventory above
- Do not invent feature types not listed
- If coverage is complete and no follow-ups needed, return findings: []
- Maximum 6 findings; pick the most actionable

Output JSON only:
{
  "findings": [
    {
      "type": "coverage_gap" | "re_shoot_needed" | "inventory_incomplete" | "pattern_observed" | "verification_needed",
      "description": "one sentence",
      "rationale": "brief rationale citing specific photos by number"
    }
  ]
}`;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 500);
    }

    const apiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You analyze coverage of security audit photo inventories. You only reference what is provided. Empty findings are correct when coverage is complete." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      const failResult = {
        audit_id, stage, findings: [], photos_analyzed: photoList.length,
        status: "failed", model: MODEL, error: `openai ${apiResp.status}`,
      };
      await supabase.from("audit_stage_analyses").upsert(failResult as never, { onConflict: "audit_id,stage" });
      return errorResponse(`openai error: ${apiResp.status}: ${errText.substring(0, 200)}`, 502);
    }

    const apiData = await apiResp.json();
    const rawContent = apiData.choices?.[0]?.message?.content ?? "{}";

    let parsed: { findings?: Array<{ type: string; description: string; rationale?: string }> } = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      const failResult = {
        audit_id, stage, findings: [], photos_analyzed: photoList.length,
        status: "failed", model: MODEL, error: "json parse error",
      };
      await supabase.from("audit_stage_analyses").upsert(failResult as never, { onConflict: "audit_id,stage" });
      return errorResponse("LLM returned invalid JSON", 502);
    }

    const findings = (parsed.findings ?? []).slice(0, 6).map((f) => ({
      type: String(f.type ?? "other"),
      description: String(f.description ?? "").substring(0, 400),
      rationale: f.rationale ? String(f.rationale).substring(0, 200) : undefined,
    }));

    const result = {
      audit_id, stage, findings, photos_analyzed: photoList.length,
      status: "complete", model: MODEL,
    };
    await supabase.from("audit_stage_analyses").upsert(result as never, { onConflict: "audit_id,stage" });

    return successResponse({ status: "complete", findings_count: findings.length, findings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("analyze-stage-coverage error:", e);
    return errorResponse(msg, 500);
  }
});
