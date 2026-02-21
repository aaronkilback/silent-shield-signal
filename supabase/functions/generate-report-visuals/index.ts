/**
 * Generate Report Visuals - Standalone Edge Function
 * 
 * On-demand generation of AI-powered visuals for reports, briefings,
 * and intelligence products. Can be called independently or by AEGIS.
 * 
 * Actions:
 *   - generate: Create one or more visuals
 *   - types: List available visual types
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateReportVisual, generateReportVisuals, type ReportVisualType } from "../_shared/report-image-generator.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { action = "generate" } = body;

    if (action === "types") {
      return new Response(JSON.stringify({
        types: [
          { id: "header", name: "Report Header", description: "Cinematic banner image for report covers" },
          { id: "threat_landscape", name: "Threat Landscape", description: "Abstract threat environment visualization" },
          { id: "situational_map", name: "Situational Map", description: "Stylized tactical map of incident locations" },
          { id: "risk_heatmap", name: "Risk Heatmap", description: "Visual risk intensity representation" },
          { id: "timeline", name: "Event Timeline", description: "Chronological event flow visualization" },
          { id: "incident_scene", name: "Incident Scene", description: "Dramatic scene representing an incident type" },
        ]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Generate action
    const {
      types = ["header"],
      client_name,
      report_title,
      threat_categories = [],
      locations = [],
      risk_level = "moderate",
      incident_types = [],
      period,
      custom_prompt,
      high_quality = false,
    } = body;

    const visualTypes = (Array.isArray(types) ? types : [types]) as ReportVisualType[];
    
    const requests = visualTypes.map(type => ({
      type,
      context: {
        clientName: client_name,
        reportTitle: report_title,
        threatCategories: threat_categories,
        locations,
        riskLevel: risk_level,
        incidentTypes: incident_types,
        period,
        customPrompt: type === visualTypes[0] ? custom_prompt : undefined,
      },
      highQuality: high_quality,
    }));

    console.log(`[generate-report-visuals] Generating ${requests.length} visuals for user ${user.id}`);

    const results = await generateReportVisuals(requests);

    // Format response
    const output: Record<string, any> = {};
    for (const [type, result] of results.entries()) {
      output[type] = {
        success: !!result.imageUrl || !!result.base64Url,
        url: result.imageUrl,
        base64_url: result.base64Url,
        error: result.error,
        duration_ms: result.durationMs,
      };
    }

    return new Response(JSON.stringify({ 
      success: true, 
      visuals: output,
      total_generated: Object.values(output).filter(v => v.success).length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[generate-report-visuals] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
