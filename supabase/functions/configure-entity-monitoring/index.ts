import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConfigureMonitoringRequest {
  // Entity identification (one required)
  entity_id?: string;
  entity_name?: string;
  
  // Monitoring configuration
  active_monitoring_enabled?: boolean;
  monitoring_radius_km?: number;
  current_location?: string;
  
  // Keywords and content targeting
  monitoring_keywords?: string[];
  threat_indicators?: string[];
  
  // Platform-specific configuration
  platforms?: {
    twitter?: boolean;
    facebook?: boolean;
    instagram?: boolean;
    linkedin?: boolean;
    news?: boolean;
    rss?: boolean;
    darkweb?: boolean;
  };
  
  // Content type filters
  content_types?: ("news" | "social" | "blog" | "forum" | "academic" | "legal" | "government")[];
  
  // Alert thresholds
  alert_on_mention?: boolean;
  alert_on_proximity?: boolean;
  proximity_alert_km?: number;
  sentiment_threshold?: "negative" | "very_negative" | "any";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: ConfigureMonitoringRequest = await req.json();

    // Validate entity identification
    if (!body.entity_id && !body.entity_name) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Either 'entity_id' or 'entity_name' is required"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find entity
    let entity: any = null;
    if (body.entity_id) {
      const { data, error } = await supabase
        .from("entities")
        .select("*")
        .eq("id", body.entity_id)
        .single();
      
      if (error || !data) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Entity not found with ID: ${body.entity_id}`
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      entity = data;
    } else if (body.entity_name) {
      const { data, error } = await supabase
        .from("entities")
        .select("*")
        .ilike("name", body.entity_name)
        .limit(1)
        .maybeSingle();
      
      if (error || !data) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Entity not found with name: ${body.entity_name}`
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      entity = data;
    }

    // Build update payload
    const updateData: Record<string, unknown> = {};
    const attributesUpdate: Record<string, unknown> = entity.attributes || {};

    // Core monitoring fields
    if (body.active_monitoring_enabled !== undefined) {
      updateData.active_monitoring_enabled = body.active_monitoring_enabled;
    }
    if (body.monitoring_radius_km !== undefined) {
      updateData.monitoring_radius_km = body.monitoring_radius_km;
    }
    if (body.current_location !== undefined) {
      updateData.current_location = body.current_location;
    }
    if (body.threat_indicators !== undefined) {
      updateData.threat_indicators = body.threat_indicators;
    }

    // Store advanced config in attributes
    if (body.monitoring_keywords) {
      attributesUpdate.monitoring_keywords = body.monitoring_keywords;
    }
    if (body.platforms) {
      attributesUpdate.monitoring_platforms = body.platforms;
    }
    if (body.content_types) {
      attributesUpdate.content_types = body.content_types;
    }
    if (body.alert_on_mention !== undefined) {
      attributesUpdate.alert_on_mention = body.alert_on_mention;
    }
    if (body.alert_on_proximity !== undefined) {
      attributesUpdate.alert_on_proximity = body.alert_on_proximity;
    }
    if (body.proximity_alert_km !== undefined) {
      attributesUpdate.proximity_alert_km = body.proximity_alert_km;
    }
    if (body.sentiment_threshold) {
      attributesUpdate.sentiment_threshold = body.sentiment_threshold;
    }

    // Include attributes in update if modified
    if (Object.keys(attributesUpdate).length > 0) {
      updateData.attributes = attributesUpdate;
    }

    // Apply update
    const { data: updatedEntity, error: updateError } = await supabase
      .from("entities")
      .update(updateData)
      .eq("id", entity.id)
      .select("id, name, type, active_monitoring_enabled, monitoring_radius_km, current_location, threat_indicators, attributes")
      .single();

    if (updateError) {
      console.error("Failed to update entity monitoring:", updateError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to update monitoring configuration: ${updateError.message}`
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Monitoring configured for entity: ${updatedEntity.name} (${updatedEntity.id})`);

    // Build response summary
    const configSummary = {
      monitoring_enabled: updatedEntity.active_monitoring_enabled,
      location: updatedEntity.current_location,
      radius_km: updatedEntity.monitoring_radius_km,
      keywords: attributesUpdate.monitoring_keywords || [],
      platforms: attributesUpdate.monitoring_platforms || {},
      content_types: attributesUpdate.content_types || [],
      alerts: {
        on_mention: attributesUpdate.alert_on_mention,
        on_proximity: attributesUpdate.alert_on_proximity,
        proximity_km: attributesUpdate.proximity_alert_km
      }
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: `Monitoring configuration updated for "${updatedEntity.name}"`,
        entity: {
          id: updatedEntity.id,
          name: updatedEntity.name,
          type: updatedEntity.type
        },
        configuration: configSummary,
        next_steps: [
          body.active_monitoring_enabled ? "Monitoring is now active - signals will be generated on matches" : "Enable active_monitoring_enabled to start collecting signals",
          "Use 'osint-entity-scan' to perform immediate intelligence collection",
          "Check 'entity_mentions' table for detected references",
          "View alerts in 'entity_notifications' table"
        ]
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("configure-entity-monitoring error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
