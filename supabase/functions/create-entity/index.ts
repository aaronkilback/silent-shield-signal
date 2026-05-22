import { createClient } from "npm:@supabase/supabase-js@2";
// #179 Entity governance + tenant-context resolution
import {
  validateAndClassify as governanceValidateAndClassify,
  recordGovernanceEvent as governanceRecordEvent,
  type BypassMetadata,
} from "../_shared/entity-governance.ts";
import { assertCallerInTenant } from "../_shared/auth-tenant-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CreateEntityRequest {
  name: string;
  type: "person" | "organization" | "location" | "vehicle" | "asset" | "event" | "threat_group";
  description?: string;
  aliases?: string[];
  risk_level?: "low" | "medium" | "high" | "critical";
  threat_score?: number;
  threat_indicators?: string[];
  associations?: string[];
  attributes?: Record<string, unknown>;
  address_street?: string;
  address_city?: string;
  address_province?: string;
  address_postal_code?: string;
  address_country?: string;
  current_location?: string;
  active_monitoring_enabled?: boolean;
  monitoring_radius_km?: number;
  client_id?: string;
  /**
   * @deprecated #179 — direct_create semantics removed. Now routed through governance.
   * To create an entity directly (operator-mediated path), set promote=true AND supply
   * promotion_reason. Otherwise the request is routed to entity_suggestions for review.
   */
  direct_create?: boolean;
  promote?: boolean;            // #179 — explicit operator promotion request
  promotion_reason?: string;    // #179 — required audit reason when promote=true
  confidence_score?: number;
  source_context?: string;
  tenant_id: string;            // #134 + #179 — REQUIRED. Server validates caller membership.
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: CreateEntityRequest = await req.json();

    if (!body.name || !body.type) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: 'name' and 'type' are required",
          valid_types: ["person", "organization", "location", "vehicle", "asset", "event", "threat_group"]
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes = ["person", "organization", "location", "vehicle", "asset", "event", "threat_group"];
    if (!validTypes.includes(body.type)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid entity type: '${body.type}'`, valid_types: validTypes }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // #179 — REQUIRED tenant_id + caller-membership validation
    if (!body.tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: "tenant_id is required (per #179 doctrine: no global fallback, no guess)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract caller JWT subject for auth-tenant guard
    let callerJwtSub: string | null = null;
    try {
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          callerJwtSub = payload.sub ?? null;
        }
      }
    } catch (_) { /* tolerate parse errors; auth gate will reject */ }

    if (!callerJwtSub) {
      return new Response(
        JSON.stringify({ success: false, error: "AUTH_REQUIRED: caller JWT could not be parsed" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authCheck = await assertCallerInTenant(supabase, callerJwtSub, body.tenant_id, { allowSuperAdmin: true });
    if (!authCheck.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `TENANT_BOUNDARY: ${authCheck.reason}` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // #179 — Promotion gate: explicit promote=true + reason; otherwise route to suggestion_queue.
    // Legacy `direct_create=true` semantics REMOVED — no longer bypasses governance.
    if (body.direct_create === true && !body.promote) {
      console.warn("[CreateEntity] #179: direct_create=true is deprecated; rerouting through governance. Set promote=true with promotion_reason for operator-promoted path.");
    }
    const wantsPromotion = body.promote === true;
    const promotionReason = (body.promotion_reason || "").trim();
    if (wantsPromotion && promotionReason.length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: "promotion_reason ≥10 chars required when promote=true (per #179 audit doctrine)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default client resolution (unchanged behavior, just no longer drives writes directly)
    let resolvedClientId = body.client_id || null;
    if (!resolvedClientId) {
      const { data: defaultClient } = await supabase
        .from("clients")
        .select("id")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      resolvedClientId = defaultClient?.id || null;
    }

    // Build governance candidate
    const bypassMetadata: BypassMetadata | undefined = wantsPromotion ? {
      bypass_type: "operator_promoted",
      operator_id: callerJwtSub,
      reason: promotionReason,
      caller_kind: authCheck.kind,
    } : undefined;

    const candidate = {
      name: body.name,
      type: body.type,
      description: body.description ?? null,
      aliases: body.aliases ?? null,
      confidence: body.confidence_score ?? 0.7,
      origin: "human" as const,
      context: body.source_context ?? null,
      sourceRef: { kind: "conversation" as const, id: crypto.randomUUID() },
      requestPromotion: wantsPromotion,
      bypassMetadata,
    };

    const verdict = await governanceValidateAndClassify(supabase, body.tenant_id, candidate);

    // auto_link — entity exists, return link
    if (verdict.verdict === "auto_link") {
      governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: verdict });
      return new Response(
        JSON.stringify({ success: false, error: `Entity already exists`, existing_entity_id: verdict.matchedEntityId, workflow: "auto_link" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // auto_reject — governance refused
    if (verdict.verdict === "auto_reject") {
      governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: verdict });
      return new Response(
        JSON.stringify({ success: false, governance_rejected: true, rejection_reasons: verdict.rejectionReasons, error: `Rejected by governance: ${verdict.rejectionReasons.join(", ")}` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // operator_promoted — direct entity creation with audit
    if (verdict.verdict === "operator_promoted") {
      const entityData = {
        name: verdict.normalizedName,
        type: verdict.resolvedType,
        description: body.description || null,
        aliases: body.aliases || null,
        risk_level: body.risk_level || "medium",
        threat_score: body.threat_score || null,
        threat_indicators: body.threat_indicators || null,
        associations: body.associations || null,
        attributes: body.attributes || null,
        address_street: body.address_street || null,
        address_city: body.address_city || null,
        address_province: body.address_province || null,
        address_postal_code: body.address_postal_code || null,
        address_country: body.address_country || null,
        current_location: body.current_location || null,
        active_monitoring_enabled: body.active_monitoring_enabled ?? false,
        monitoring_radius_km: body.monitoring_radius_km || null,
        client_id: resolvedClientId,
        tenant_id: body.tenant_id,                 // #179 — explicit tenant_id (caller-validated above)
        confidence_score: verdict.effectiveConfidence,
        is_active: true,
        entity_status: "confirmed",
        visibility_class: "curated",
      };
      const { data: newEntity, error: createError } = await supabase
        .from("entities")
        .insert(entityData)
        .select("id, name, type, risk_level, description, aliases, is_active, active_monitoring_enabled, created_at")
        .single();
      if (createError) {
        governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: { ...verdict, verdict: "auto_reject", rejectionReasons: ["persistence_error"] } });
        return new Response(
          JSON.stringify({ success: false, error: `Failed to create entity: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: verdict, linkedEntityId: newEntity.id });
      return new Response(
        JSON.stringify({ success: true, message: `Entity "${newEntity.name}" promoted by operator`, entity: newEntity, workflow: "operator_promoted", audit: { operator_id: callerJwtSub, reason: promotionReason } }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // suggestion_queue — default path
    const suggestionData = {
      tenant_id: body.tenant_id,
      suggested_name: verdict.normalizedName,
      suggested_type: verdict.resolvedType,
      suggested_aliases: body.aliases || null,
      suggested_attributes: {
        description: body.description,
        risk_level: body.risk_level,
        threat_score: body.threat_score,
        threat_indicators: body.threat_indicators,
        associations: body.associations,
        ...body.attributes,
      },
      source_type: "aegis_ai",
      source_id: crypto.randomUUID(),
      confidence: verdict.effectiveConfidence,
      context: body.source_context || `Created via create-entity function`,
      status: "pending",
    };
    const { data: newSuggestion, error: suggestionError } = await supabase
      .from("entity_suggestions")
      .insert(suggestionData)
      .select("id, suggested_name, suggested_type, status, created_at")
      .single();
    if (suggestionError) {
      governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: { ...verdict, verdict: "auto_reject", rejectionReasons: ["persistence_error"] } });
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create entity suggestion: ${suggestionError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    governanceRecordEvent(supabase, { tenantId: body.tenant_id, sourceWriter: "other", candidate, result: verdict, suggestionId: newSuggestion.id });
    return new Response(
      JSON.stringify({ success: true, message: `Entity suggestion "${newSuggestion.suggested_name}" queued for review`, suggestion: newSuggestion, workflow: "suggestion_review" }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[CreateEntity] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
