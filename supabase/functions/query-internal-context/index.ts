import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QueryRequest {
  query_type: 'assets' | 'vulnerabilities' | 'business_criticality' | 'comprehensive';
  asset_id?: string;
  asset_name?: string;
  asset_type?: string;
  vulnerability_id?: string;
  business_criticality_level?: 'mission_critical' | 'high' | 'medium' | 'low';
  keywords?: string[];
  client_id?: string;
  limit?: number;
}

interface AssetResult {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  description?: string;
  location?: string;
  owner_team?: string;
  business_criticality: string;
  configuration_details: {
    os?: string;
    software_installed?: string[];
    network_segment?: string;
    cloud_provider_service?: string;
    last_patched_date?: string;
    [key: string]: unknown;
  };
  known_vulnerabilities: {
    vulnerability_id: string;
    severity: string;
    cvss_score?: number;
    description?: string;
    is_active_exploit_known: boolean;
    remediation_status: string;
  }[];
  last_scanned?: string;
  tags: string[];
  is_internet_facing: boolean;
}

interface QueryResponse {
  query_type: string;
  results: AssetResult[];
  summary: string;
  total_count: number;
  filters_applied: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const request: QueryRequest = await req.json();
    const {
      query_type = 'assets',
      asset_id,
      asset_name,
      asset_type,
      vulnerability_id,
      business_criticality_level,
      keywords,
      client_id,
      limit = 10
    } = request;

    console.log('[query-internal-context] Processing request:', JSON.stringify(request));

    const filtersApplied: Record<string, unknown> = { query_type };
    let results: AssetResult[] = [];

    // Build base query for assets
    let assetsQuery = supabase
      .from('internal_assets')
      .select(`
        id,
        asset_name,
        asset_type,
        description,
        location,
        owner_team,
        business_criticality,
        configuration_details,
        network_segment,
        cloud_provider,
        cloud_service,
        is_internet_facing,
        is_active,
        last_patched_date,
        last_scanned,
        tags,
        metadata,
        asset_vulnerabilities (
          id,
          vulnerability_id,
          severity,
          cvss_score,
          description,
          affected_component,
          is_active_exploit_known,
          remediation_status,
          discovered_at
        )
      `)
      .eq('is_active', true);

    // Apply filters
    if (asset_id) {
      assetsQuery = assetsQuery.eq('id', asset_id);
      filtersApplied.asset_id = asset_id;
    }

    if (asset_name) {
      assetsQuery = assetsQuery.ilike('asset_name', `%${asset_name}%`);
      filtersApplied.asset_name = asset_name;
    }

    if (asset_type) {
      assetsQuery = assetsQuery.eq('asset_type', asset_type);
      filtersApplied.asset_type = asset_type;
    }

    if (business_criticality_level) {
      assetsQuery = assetsQuery.eq('business_criticality', business_criticality_level);
      filtersApplied.business_criticality_level = business_criticality_level;
    }

    if (client_id) {
      assetsQuery = assetsQuery.eq('client_id', client_id);
      filtersApplied.client_id = client_id;
    }

    if (keywords && keywords.length > 0) {
      // Search in asset_name, description, and tags
      const keywordFilters = keywords.map(kw => 
        `asset_name.ilike.%${kw}%,description.ilike.%${kw}%`
      ).join(',');
      assetsQuery = assetsQuery.or(keywordFilters);
      filtersApplied.keywords = keywords;
    }

    // If querying by vulnerability_id, we need a different approach
    if (vulnerability_id) {
      filtersApplied.vulnerability_id = vulnerability_id;
      
      // First find assets with this vulnerability
      const { data: vulnData, error: vulnError } = await supabase
        .from('asset_vulnerabilities')
        .select('asset_id')
        .ilike('vulnerability_id', `%${vulnerability_id}%`);

      if (vulnError) throw vulnError;

      if (vulnData && vulnData.length > 0) {
        const assetIds = [...new Set(vulnData.map(v => v.asset_id))];
        assetsQuery = assetsQuery.in('id', assetIds);
      } else {
        // No assets found with this vulnerability
        return new Response(JSON.stringify({
          query_type,
          results: [],
          summary: `No assets found with vulnerability ${vulnerability_id}`,
          total_count: 0,
          filters_applied: filtersApplied
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Apply limit
    assetsQuery = assetsQuery.limit(limit);

    // Execute query
    const { data: assetsData, error: assetsError } = await assetsQuery;

    if (assetsError) {
      console.error('[query-internal-context] Query error:', assetsError);
      throw assetsError;
    }

    // Transform results
    results = (assetsData || []).map(asset => {
      const configDetails = asset.configuration_details || {};
      
      return {
        asset_id: asset.id,
        asset_name: asset.asset_name,
        asset_type: asset.asset_type,
        description: asset.description,
        location: asset.location,
        owner_team: asset.owner_team,
        business_criticality: asset.business_criticality,
        configuration_details: {
          os: configDetails.os,
          software_installed: configDetails.software_installed || [],
          network_segment: asset.network_segment,
          cloud_provider_service: asset.cloud_provider ? `${asset.cloud_provider}/${asset.cloud_service || ''}` : undefined,
          last_patched_date: asset.last_patched_date,
          ...configDetails
        },
        known_vulnerabilities: (asset.asset_vulnerabilities || []).map((vuln: any) => ({
          vulnerability_id: vuln.vulnerability_id,
          severity: vuln.severity,
          cvss_score: vuln.cvss_score,
          description: vuln.description,
          is_active_exploit_known: vuln.is_active_exploit_known,
          remediation_status: vuln.remediation_status
        })),
        last_scanned: asset.last_scanned,
        tags: asset.tags || [],
        is_internet_facing: asset.is_internet_facing
      };
    });

    // Generate summary based on query type
    let summary = '';
    const totalAssets = results.length;
    const criticalAssets = results.filter(r => r.business_criticality === 'mission_critical').length;
    const highAssets = results.filter(r => r.business_criticality === 'high').length;
    const totalVulns = results.reduce((acc, r) => acc + r.known_vulnerabilities.length, 0);
    const criticalVulns = results.reduce((acc, r) => 
      acc + r.known_vulnerabilities.filter(v => v.severity === 'critical').length, 0);
    const activeExploits = results.reduce((acc, r) => 
      acc + r.known_vulnerabilities.filter(v => v.is_active_exploit_known).length, 0);
    const internetFacing = results.filter(r => r.is_internet_facing).length;

    switch (query_type) {
      case 'assets':
        summary = `Found ${totalAssets} assets matching your criteria. ` +
          `${criticalAssets} mission-critical, ${highAssets} high-criticality. ` +
          `${internetFacing} are internet-facing. ` +
          `Total of ${totalVulns} known vulnerabilities across these assets.`;
        break;
      
      case 'vulnerabilities':
        summary = `Found ${totalAssets} assets with ${totalVulns} total vulnerabilities. ` +
          `${criticalVulns} critical vulnerabilities identified. ` +
          `${activeExploits} vulnerabilities have known active exploits in the wild. ` +
          `Prioritize patching internet-facing assets (${internetFacing}) and mission-critical systems (${criticalAssets}).`;
        break;
      
      case 'business_criticality':
        summary = `Business criticality analysis: ${criticalAssets} mission-critical assets, ` +
          `${highAssets} high-criticality assets found. ` +
          `These assets have ${totalVulns} combined vulnerabilities, with ${criticalVulns} rated critical. ` +
          `${activeExploits} vulnerabilities have active exploits - immediate remediation recommended.`;
        break;
      
      case 'comprehensive':
        summary = `Comprehensive context: ${totalAssets} assets analyzed. ` +
          `Criticality breakdown: ${criticalAssets} mission-critical, ${highAssets} high, ` +
          `${results.filter(r => r.business_criticality === 'medium').length} medium. ` +
          `Vulnerability posture: ${totalVulns} total, ${criticalVulns} critical, ${activeExploits} with active exploits. ` +
          `Attack surface: ${internetFacing} internet-facing assets. ` +
          `Immediate action required for critical vulnerabilities on mission-critical and internet-facing systems.`;
        break;
      
      default:
        summary = `Query completed with ${totalAssets} results.`;
    }

    const response: QueryResponse = {
      query_type,
      results,
      summary,
      total_count: results.length,
      filters_applied: filtersApplied
    };

    console.log('[query-internal-context] Returning', results.length, 'results');

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[query-internal-context] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An error occurred processing the query';
    return new Response(JSON.stringify({
      error: errorMessage,
      query_type: 'error',
      results: [],
      summary: 'Query failed due to an error',
      total_count: 0,
      filters_applied: {}
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
