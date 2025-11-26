import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { source_id, auto_fix = true, dry_run = false } = await req.json();

    console.log(`[autonomous-source-health-manager] Checking source ${source_id || 'all'}`);

    let sourcesToCheck = [];

    if (source_id) {
      // Check specific source
      const { data: source, error: sourceError } = await supabase
        .from("sources")
        .select("*")
        .eq("id", source_id)
        .single();

      if (sourceError || !source) {
        throw new Error(`Source not found: ${source_id}`);
      }
      sourcesToCheck = [source];
    } else {
      // Check all sources with recent failures
      const { data: sources, error: sourcesError } = await supabase
        .from("sources")
        .select("*")
        .eq("source_type", "rss")
        .eq("is_active", true);

      if (sourcesError) {
        console.error("[autonomous-source-health-manager] Sources fetch error:", sourcesError);
      }

      // Get recent monitoring history to identify problematic sources
      const { data: history, error: historyError } = await supabase
        .from("monitoring_history")
        .select("source_name, status, error_message")
        .eq("status", "error")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(100);

      if (!historyError && history) {
        const failedSourceNames = new Set(history.map(h => h.source_name));
        sourcesToCheck = (sources || []).filter(s => failedSourceNames.has(s.name));
      } else {
        sourcesToCheck = sources || [];
      }
    }

    const results = [];

    for (const source of sourcesToCheck) {
      console.log(`[autonomous-source-health-manager] Testing source: ${source.name}`);

      // Test connectivity
      let testResult;
      try {
        const testResponse = await supabase.functions.invoke("test-osint-source-connectivity", {
          body: { source_id: source.id },
        });

        testResult = testResponse.data;
      } catch (testError) {
        console.error(`[autonomous-source-health-manager] Test failed for ${source.name}:`, testError);
        testResult = { success: false, error: testError instanceof Error ? testError.message : String(testError) };
      }

      const sourceResult = {
        source_id: source.id,
        source_name: source.name,
        url: source.url,
        test_result: testResult,
        actions_taken: [] as any[],
        recommendations: [] as any[],
      };

      // Analyze error and attempt auto-fix
      if (!testResult.success && auto_fix && !dry_run) {
        const error = testResult.error || "";
        let fixAttempted = false;

        // Common fixable issues
        if (error.includes("403") || error.includes("Forbidden") || error.includes("User-Agent")) {
          console.log(`[autonomous-source-health-manager] Attempting User-Agent fix for ${source.name}`);
          
          const newConfig = {
            ...source.config,
            headers: {
              ...source.config?.headers,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          };

          const { error: updateError } = await supabase
            .from("sources")
            .update({ config: newConfig })
            .eq("id", source.id);

          if (!updateError) {
            sourceResult.actions_taken.push({
              action: "updated_user_agent",
              reason: "403/Forbidden error detected",
              new_config: newConfig,
            });
            fixAttempted = true;
          }
        }

        if (error.includes("SSL") || error.includes("certificate") || error.includes("TLS")) {
          console.log(`[autonomous-source-health-manager] Attempting SSL verification bypass for ${source.name}`);
          
          const newConfig = {
            ...source.config,
            verify_ssl: false,
          };

          const { error: updateError } = await supabase
            .from("sources")
            .update({ config: newConfig })
            .eq("id", source.id);

          if (!updateError) {
            sourceResult.actions_taken.push({
              action: "disabled_ssl_verification",
              reason: "SSL/certificate error detected",
              warning: "SSL verification disabled - monitor for security implications",
            });
            fixAttempted = true;
          }
        }

        if (error.includes("timeout") || error.includes("ETIMEDOUT")) {
          console.log(`[autonomous-source-health-manager] Increasing timeout for ${source.name}`);
          
          const newConfig = {
            ...source.config,
            timeout: 30000, // 30 seconds
          };

          const { error: updateError } = await supabase
            .from("sources")
            .update({ config: newConfig })
            .eq("id", source.id);

          if (!updateError) {
            sourceResult.actions_taken.push({
              action: "increased_timeout",
              reason: "Timeout error detected",
              new_timeout: 30000,
            });
            fixAttempted = true;
          }
        }

        if (error.includes("301") || error.includes("302") || error.includes("redirect")) {
          sourceResult.recommendations.push({
            type: "url_update_needed",
            reason: "URL redirect detected - manual URL update may be required",
            suggestion: "Check for new feed URL and update manually",
          });
        }

        if (!fixAttempted) {
          sourceResult.recommendations.push({
            type: "manual_review_required",
            reason: "Unable to auto-fix error",
            error_details: error,
            suggestion: "Review source configuration manually or contact feed provider",
          });
        }

      } else if (!testResult.success) {
        // Provide recommendations without auto-fix
        const error = testResult.error || "";
        
        if (error.includes("403") || error.includes("Forbidden")) {
          sourceResult.recommendations.push({
            type: "user_agent_update",
            reason: "403 Forbidden - likely User-Agent blocking",
            suggestion: "Update User-Agent header in source config",
          });
        }

        if (error.includes("SSL") || error.includes("certificate")) {
          sourceResult.recommendations.push({
            type: "ssl_issue",
            reason: "SSL/certificate error",
            suggestion: "Verify SSL certificate or temporarily disable SSL verification",
          });
        }

        if (error.includes("timeout")) {
          sourceResult.recommendations.push({
            type: "timeout",
            reason: "Request timeout",
            suggestion: "Increase timeout setting or check network connectivity",
          });
        }

        if (error.includes("redirect")) {
          sourceResult.recommendations.push({
            type: "url_redirect",
            reason: "URL redirect detected",
            suggestion: "Update source URL to final destination",
          });
        }
      } else {
        sourceResult.actions_taken.push({
          action: "health_check_passed",
          status: "operational",
        });
      }

      results.push(sourceResult);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sources_checked: sourcesToCheck.length,
        results,
        dry_run,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[autonomous-source-health-manager] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
