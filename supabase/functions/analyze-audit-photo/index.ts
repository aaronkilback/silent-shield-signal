/**
 * analyze-audit-photo — vision analysis on an audit photo.
 *
 * Phase 2E. Operator uploads a photo of a fence segment / camera /
 * gate / etc. The wizard fires this function, which:
 *
 *   1. Loads the media_assets row + its EXIF (so we know feature_type
 *      if linked, and lat/lng for context)
 *   2. Generates a signed URL for the storage object
 *   3. Sends to OpenAI gpt-4o-vision with a tight, anti-fabrication
 *      prompt scoped to the feature_type
 *   4. Parses structured JSON output → list of findings
 *   5. Updates media_assets.ai_findings + ai_analysis_status
 *
 * The findings render as PROPOSALS in the wizard — operator taps
 * Accept/Dismiss. Operator override always wins.
 *
 * Anti-fabrication guardrails:
 *   • Each finding must cite a specific visible cue ("gap at base
 *     between two posts left of frame center")
 *   • Severity grounded: informational | monitor | concerning. No
 *     "critical" allowed from a single photo.
 *   • If image is too dark/blurry/cropped → zero findings, ask for
 *     re-shoot
 *   • Refuse to invent off-frame context
 *
 * Cost: ~$0.01/photo (gpt-4o-mini vision). 30-photo audit = ~$0.30.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getSignedUrl } from "../_shared/storage.ts";

const MODEL = "gpt-4o-mini";   // cheap + capable enough for this task
const MAX_FINDINGS = 6;
// Bucket hardcoded here rather than added to _shared/BUCKETS — keeps
// the deploy blast radius to just this function instead of forcing a
// redeploy-all on the _shared module change.
const SITE_AUDIT_MEDIA_BUCKET = "site-audit-media" as const;

interface Finding {
  category: string;
  severity: "informational" | "monitor" | "concerning";
  description: string;
  visual_cue: string;
  suggested_observation_field?: string;
}

interface AnalysisResult {
  model: string;
  version: string;
  image_quality: "good" | "acceptable" | "poor" | "too_dark" | "blurry" | "cropped";
  findings: Finding[];
  // For signage photos: the literal text the operator can see on the
  // sign. Used to auto-fill the FeatureCaptureCard's text_summary field
  // so the operator doesn't have to type "PRIVATE PROPERTY NO TRESPASSING".
  // Null when feature_type != signage OR no text was readable.
  extracted_text?: string | null;
  extracted_text_language?: string | null;
  analyzed_at: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { media_asset_id } = await req.json();
    if (!media_asset_id) return errorResponse("media_asset_id required", 400);

    const supabase = createServiceClient();

    // Load the media row — need feature_type if linked, EXIF for context.
    const { data: media, error: mediaErr } = await supabase
      .from("media_assets")
      .select("*, feature:site_features(feature_type, label, attributes), audit:site_audits(id, asset_id)")
      .eq("id", media_asset_id)
      .maybeSingle();

    if (mediaErr || !media) {
      return errorResponse(`Media asset ${media_asset_id} not found`, 404);
    }
    if (media.kind !== "photo") {
      // Documents / videos — no vision analysis.
      await markStatus(supabase, media_asset_id, "skipped", null, null);
      return successResponse({ status: "skipped", reason: "not a photo" });
    }
    if (media.ai_analysis_status === "complete" || media.ai_analysis_status === "running") {
      return successResponse({ status: "already_done_or_running", existing: media.ai_findings });
    }

    await markStatus(supabase, media_asset_id, "running", null, null);

    // Sign URL for the LLM to fetch.
    const url = await getSignedUrl(supabase, SITE_AUDIT_MEDIA_BUCKET as never, media.storage_path, 300);
    if (!url) {
      await markStatus(supabase, media_asset_id, "failed", "could not sign storage url", null);
      return errorResponse("could not sign storage url", 500);
    }

    // Build the prompt — feature-type-aware.
    const featureType = (media as { feature?: { feature_type?: string } | null }).feature?.feature_type ?? null;
    const prompt = buildPrompt(featureType, media);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      await markStatus(supabase, media_asset_id, "failed", "OPENAI_API_KEY not configured", null);
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
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url, detail: "high" } },
            ],
          },
        ],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error("OpenAI vision error:", apiResp.status, errText);
      await markStatus(supabase, media_asset_id, "failed", `openai ${apiResp.status}: ${errText.substring(0, 300)}`, null);
      return errorResponse(`openai error: ${apiResp.status}`, 502);
    }

    const apiData = await apiResp.json();
    const rawContent = apiData.choices?.[0]?.message?.content ?? "{}";

    let parsed: Partial<AnalysisResult> = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      console.error("Failed to parse LLM JSON:", rawContent.substring(0, 500));
      await markStatus(supabase, media_asset_id, "failed", "json parse error", null);
      return errorResponse("LLM returned invalid JSON", 502);
    }

    const result: AnalysisResult = {
      model: MODEL,
      version: "v1",
      image_quality: parsed.image_quality ?? "acceptable",
      extracted_text: featureType === "signage" && parsed.extracted_text
        ? String(parsed.extracted_text).substring(0, 500)
        : null,
      extracted_text_language: featureType === "signage" && parsed.extracted_text_language
        ? String(parsed.extracted_text_language).substring(0, 30)
        : null,
      findings: sanitizeFindings(parsed.findings ?? []),
      analyzed_at: new Date().toISOString(),
    };

    await markStatus(supabase, media_asset_id, "complete", null, result);

    return successResponse({
      status: "complete",
      findings_count: result.findings.length,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("analyze-audit-photo error:", e);
    return errorResponse(msg, 500);
  }
});

async function markStatus(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  status: "pending" | "running" | "complete" | "failed" | "skipped",
  error: string | null,
  findings: AnalysisResult | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    ai_analysis_status: status,
    ai_analysis_error: error,
  };
  if (status === "complete" || status === "skipped") {
    patch.ai_analyzed_at = new Date().toISOString();
  }
  if (findings) {
    patch.ai_findings = findings;
  }
  await supabase.from("media_assets").update(patch).eq("id", id);
}

function sanitizeFindings(findings: unknown[]): Finding[] {
  if (!Array.isArray(findings)) return [];
  return findings
    .slice(0, MAX_FINDINGS)
    .map((f) => {
      const obj = (f ?? {}) as Partial<Finding>;
      const sev = obj.severity;
      // Drop "critical" silently — we don't allow it from a single photo
      // per anti-fabrication policy.
      const safeSev: Finding["severity"] =
        sev === "informational" || sev === "monitor" || sev === "concerning" ? sev : "monitor";
      return {
        category: String(obj.category ?? "general").substring(0, 80),
        severity: safeSev,
        description: String(obj.description ?? "").substring(0, 400),
        visual_cue: String(obj.visual_cue ?? "").substring(0, 200),
        suggested_observation_field: obj.suggested_observation_field
          ? String(obj.suggested_observation_field).substring(0, 80)
          : undefined,
      };
    })
    .filter((f) => f.description.length > 8 && f.visual_cue.length > 4);
}

const SYSTEM_PROMPT = `You are a security audit assistant analyzing photos taken at oil/gas, healthcare, and infrastructure sites by a field operator. Your job is to flag things the operator may have missed.

CRITICAL ANTI-FABRICATION RULES:
1. Only describe what is CLEARLY visible in the image. Never infer about things off-frame.
2. Every finding MUST cite a specific visual cue (where in the frame, what specifically you can see).
3. If image quality is poor (too dark, blurry, cropped wrong, lens obstructed), return image_quality:"poor" or "too_dark" etc. with ZERO findings, and recommend a re-shoot.
4. Do NOT use severity "critical". The highest severity from a single photo is "concerning". Humans decide what is critical.
5. Be conservative. A clean fence panel is fine — say so by returning zero findings, not by manufacturing concerns.
6. If a feature is mounted correctly, photographed clearly, and shows no visible damage — return zero findings. Empty findings arrays are PERFECTLY ACCEPTABLE.

OUTPUT FORMAT (JSON only):
{
  "image_quality": "good" | "acceptable" | "poor" | "too_dark" | "blurry" | "cropped",
  "findings": [
    {
      "category": "fence_integrity" | "lock_status" | "camera_obstruction" | "lighting_failure" | "signage_legibility" | "vegetation_overgrowth" | "tampering_evidence" | "unauthorized_object" | "documentation_quality" | "other",
      "severity": "informational" | "monitor" | "concerning",
      "description": "one sentence describing what you observed",
      "visual_cue": "where in the frame; what specifically you can see",
      "suggested_observation_field": "snake_case field name suggesting where this could be recorded"
    }
  ],
  "extracted_text": "READABLE TEXT FROM THE SIGN, verbatim, preserving line breaks as \\n. Null if no text is readable or this is not a signage photo. Keep punctuation. Do NOT paraphrase.",
  "extracted_text_language": "ISO 639-1 code of the primary language on the sign (e.g. 'en', 'fr', 'multi' if bilingual). Null if extracted_text is null."
}

Return ONLY the JSON object, no prose.`;

function buildPrompt(featureType: string | null, media: {
  audit_id?: string | null;
  asset_id: string;
  bearing_deg: number | null;
  altitude_m: number | null;
  software_app: string | null;
  pitch_deg: number | null;
  roll_deg: number | null;
}): string {
  const ctx = [];
  if (featureType) ctx.push(`Operator is photographing a ${featureType.replace(/_/g, " ")}.`);
  if (media.bearing_deg !== null) ctx.push(`Camera bearing: ${media.bearing_deg.toFixed(0)}° true.`);
  if (media.altitude_m !== null) ctx.push(`Altitude: ${media.altitude_m.toFixed(0)}m ASL.`);
  if (media.software_app && /theodolite/i.test(media.software_app)) {
    ctx.push("Photo captured with Theodolite (operator should have full geo + bearing chain).");
  }
  if ((Math.abs(media.pitch_deg ?? 0) > 10) || (Math.abs(media.roll_deg ?? 0) > 10)) {
    ctx.push("Note: photo was taken at an off-axis angle, which may distort observations.");
  }

  const focus = featureFocus(featureType);

  return `${ctx.join(" ")}

What to look for in this photo specifically:
${focus}

Return your findings as JSON per the schema. If the photo shows no concerns, return findings: []. Empty arrays are CORRECT and EXPECTED for clean installations.`;
}

function featureFocus(featureType: string | null): string {
  switch (featureType) {
    case "fence_segment":
      return [
        "- Gaps at base, between posts, or near the top",
        "- Leaning or sagging posts",
        "- Broken / missing wires or panels",
        "- Visible rust, corrosion, or rot",
        "- Climb aids (debris, vegetation, stacked materials) within 1m",
        "- Missing top treatment (barbed wire, razor wire, Y-arm)",
      ].join("\n");
    case "gate":
      return [
        "- Padlock visible / engaged / broken",
        "- Gate sagging, latch damage, broken hinges",
        "- Signage faded or missing",
        "- Gap when closed (vehicle could squeeze through)",
      ].join("\n");
    case "camera":
      return [
        "- Lens obstructed by vegetation, debris, stickers, weather",
        "- Dome cracked or fogged",
        "- Power / network cable cut, exposed, or improperly run",
        "- Mounted angle clearly off (pointing at sky, ground, or wall)",
        "- Weatherproofing degraded (open enclosure, missing gasket)",
      ].join("\n");
    case "lighting_fixture":
      return [
        "- Bulb visibly out, broken, or yellowed (end-of-life)",
        "- Lens / housing broken",
        "- Wiring exposed",
        "- Mounted angle wrong (lighting sky instead of ground)",
      ].join("\n");
    case "scada_node":
    case "plc":
    case "engineering_workstation":
      return [
        "- Cabinet / rack door open or unlocked",
        "- USB drive plugged in",
        "- Sticky-note credentials visible",
        "- Cable ID labels missing or unreadable",
        "- Loose / hanging cables",
        "- Vendor laptop or unauthorized device connected",
      ].join("\n");
    case "signage":
      return [
        "PRIMARY TASK: Read the sign's text verbatim and return it in 'extracted_text' (preserve line breaks as \\n, keep punctuation, do NOT paraphrase or shorten).",
        "Also identify the primary language (en/fr/multi) in 'extracted_text_language'.",
        "Additionally flag if any of these apply (these are 'findings', not the extracted_text):",
        "- Faded or unreadable text",
        "- Knocked down, missing, or damaged",
        "- Wrong language (English-only when bilingual required)",
        "- Out-of-date warnings",
      ].join("\n");
    case "intrusion_sensor":
      return [
        "- Sensor visibly bypassed, taped over, or damaged",
        "- Status light off or wrong color",
        "- Mounting compromised",
      ].join("\n");
    default:
      return [
        "- Anything obviously broken, damaged, or out of place",
        "- Unauthorized objects in frame",
        "- Tampering evidence (cut wires, removed fasteners, pry marks)",
        "- Privacy concerns (people captured in frame)",
      ].join("\n");
  }
}
