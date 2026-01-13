import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateEntityRequest {
  // Required fields
  name: string;
  type: "person" | "organization" | "location" | "vehicle" | "asset" | "event" | "threat_group";
  
  // Optional fields
  description?: string;
  aliases?: string[];
  risk_level?: "low" | "medium" | "high" | "critical";
  threat_score?: number;
  threat_indicators?: string[];
  associations?: string[];
  attributes?: Record<string, unknown>;
  
  // Address fields (for locations)
  address_street?: string;
  address_city?: string;
  address_province?: string;
  address_postal_code?: string;
  address_country?: string;
  
  // Monitoring configuration
  current_location?: string;
  active_monitoring_enabled?: boolean;
  monitoring_radius_km?: number;
  
  // Client association
  client_id?: string;
  
  // Workflow options
  direct_create?: boolean; // If true, create entity directly. If false, create as suggestion.
  confidence_score?: number;
  source_context?: string; // Context about why this entity is being created
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: CreateEntityRequest = await req.json();

    // Validate required fields
    if (!body.name || !body.type) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: 'name' and 'type' are required",
          required_fields: ["name", "type"],
          valid_types: ["person", "organization", "location", "vehicle", "asset", "event", "threat_group"]
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize type to match database enum
    const validTypes = ["person", "organization", "location", "vehicle", "asset", "event", "threat_group"];
    if (!validTypes.includes(body.type)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid entity type: '${body.type}'`,
          valid_types: validTypes
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if entity already exists (case-insensitive)
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
          existing_entity: {
            id: existing.id,
            name: existing.name,
            type: existing.type,
            risk_level: existing.risk_level,
            is_active: existing.is_active
          },
          suggestion: "Use update-entity or enrich-entity to modify existing entities"
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check aliases for potential duplicates
    if (body.aliases && body.aliases.length > 0) {
      for (const alias of body.aliases) {
        const { data: aliasMatch } = await supabase
          .from("entities")
          .select("id, name, aliases")
          .or(`name.ilike.${alias},aliases.cs.{${alias}}`)
          .limit(1)
          .maybeSingle();

        if (aliasMatch) {
          console.log(`Warning: Alias "${alias}" may match existing entity "${aliasMatch.name}"`);
        }
      }
    }

    // Determine workflow: direct creation or suggestion-based
    const directCreate = body.direct_create ?? true; // Default to direct creation for Aegis

    if (directCreate) {
      // Direct entity creation
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
        console.error("Failed to create entity:", createError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to create entity: ${createError.message}`,
            details: createError
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Entity created: ${newEntity.name} (${newEntity.type}) - ID: ${newEntity.id}`);

      // If monitoring is enabled, trigger initial OSINT scan suggestion
      let osintNote = null;
      if (body.active_monitoring_enabled) {
        osintNote = "Active monitoring enabled. Use 'osint-entity-scan' to perform initial intelligence collection.";
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Entity "${newEntity.name}" created successfully`,
          entity: newEntity,
          workflow: "direct_creation",
          osint_note: osintNote,
          next_steps: [
            "Use 'enrich-entity' to gather additional intelligence",
            "Use 'osint-entity-scan' to collect web content and photos",
            "Configure monitoring keywords via 'update-osint-source-config'",
            "Link to signals/incidents as they are detected"
          ]
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Suggestion-based workflow (for human review)
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
        source_id: "create-entity-function",
        confidence: body.confidence_score ?? 0.85,
        context: body.source_context || `Created via create-entity function: ${body.description || 'No description provided'}`,
        status: "pending"
      };

      const { data: newSuggestion, error: suggestionError } = await supabase
        .from("entity_suggestions")
        .insert(suggestionData)
        .select("id, suggested_name, suggested_type, status, created_at")
        .single();

      if (suggestionError) {
        console.error("Failed to create entity suggestion:", suggestionError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to create entity suggestion: ${suggestionError.message}`,
            details: suggestionError
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Entity suggestion created: ${newSuggestion.suggested_name} - ID: ${newSuggestion.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Entity suggestion "${newSuggestion.suggested_name}" created for analyst review`,
          suggestion: newSuggestion,
          workflow: "suggestion_review",
          next_steps: [
            "Suggestion will appear in the Entities → Suggestions tab",
            "Analyst can approve, reject, or merge with existing entity",
            "Once approved, entity will be active in the system"
          ]
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("create-entity error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
