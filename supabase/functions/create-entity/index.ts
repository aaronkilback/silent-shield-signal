import { createClient } from "npm:@supabase/supabase-js@2";

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
  direct_create?: boolean;
  confidence_score?: number;
  source_context?: string;
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

    const { data: existing } = await supabase
      .from("entities")
      .select("id, name, type, risk_level, is_active")
      .ilike("name", body.name)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Entity "${existing.name}" already exists`,
          existing_entity: existing,
          suggestion: "Use update-entity or enrich-entity to modify existing entities"
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const directCreate = body.direct_create ?? true;

    if (directCreate) {
      const entityData = {
        name: body.name,
        type: body.type,
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
        client_id: body.client_id || null,
        confidence_score: body.confidence_score ?? 0.85,
        is_active: true,
        entity_status: "active"
      };

      const { data: newEntity, error: createError } = await supabase
        .from("entities")
        .insert(entityData)
        .select("id, name, type, risk_level, description, aliases, is_active, active_monitoring_enabled, created_at")
        .single();

      if (createError) {
        console.error("[CreateEntity] Failed to create entity:", createError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to create entity: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[CreateEntity] Created: ${newEntity.name} (${newEntity.type}) - ID: ${newEntity.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Entity "${newEntity.name}" created successfully`,
          entity: newEntity,
          workflow: "direct_creation",
          next_steps: [
            "Use 'enrich-entity' to gather additional intelligence",
            "Use 'osint-entity-scan' to collect web content and photos",
            "Configure monitoring keywords via 'update-osint-source-config'"
          ]
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const suggestionData = {
        suggested_name: body.name,
        suggested_type: body.type,
        suggested_aliases: body.aliases || null,
        suggested_attributes: {
          description: body.description,
          risk_level: body.risk_level,
          threat_score: body.threat_score,
          threat_indicators: body.threat_indicators,
          associations: body.associations,
          ...body.attributes
        },
        source_type: "aegis_ai",
        source_id: crypto.randomUUID(),
        confidence: body.confidence_score ?? 0.85,
        context: body.source_context || `Created via create-entity function`,
        status: "pending"
      };

      const { data: newSuggestion, error: suggestionError } = await supabase
        .from("entity_suggestions")
        .insert(suggestionData)
        .select("id, suggested_name, suggested_type, status, created_at")
        .single();

      if (suggestionError) {
        console.error("[CreateEntity] Failed to create suggestion:", suggestionError);
        return new Response(
          JSON.stringify({ success: false, error: `Failed to create entity suggestion: ${suggestionError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Entity suggestion "${newSuggestion.suggested_name}" created for analyst review`,
          suggestion: newSuggestion,
          workflow: "suggestion_review"
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[CreateEntity] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
