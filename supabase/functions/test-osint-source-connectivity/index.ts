import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { source_id } = await req.json();

    if (!source_id) {
      return errorResponse('source_id is required', 400);
    }

    const supabase = createServiceClient();

    // Get source configuration from database
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('*')
      .eq('id', source_id)
      .single();

    if (sourceError || !source) {
      return errorResponse('Source not found', 404);
    }

    const config = source.config || {};
    const url = config.url || config.feedUrl;

    if (!url) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'No URL configured for this source',
          source_id,
          source_name: source.name
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Testing connectivity for source ${source_id}: ${url}`);

    // Test connectivity with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const testResponse = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      clearTimeout(timeout);

      const result = {
        success: testResponse.ok,
        status_code: testResponse.status,
        status_text: testResponse.statusText,
        source_id,
        source_name: source.name,
        tested_url: url,
        headers: Object.fromEntries(testResponse.headers.entries()),
        redirect_url: testResponse.url !== url ? testResponse.url : null,
        ssl_valid: url.startsWith('https'),
      };

      // Diagnose common issues
      const diagnosis: string[] = [];
      if (testResponse.status === 403) {
        diagnosis.push('403 Forbidden - May need User-Agent rotation or authentication');
      } else if (testResponse.status === 301 || testResponse.status === 302) {
        diagnosis.push(`Redirect detected to: ${testResponse.url}`);
      } else if (testResponse.status === 404) {
        diagnosis.push('404 Not Found - URL may have changed or been removed');
      } else if (testResponse.status >= 500) {
        diagnosis.push('Server error - Source may be temporarily down');
      }

      return new Response(
        JSON.stringify({ ...result, diagnosis }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      clearTimeout(timeout);
      
      let errorType = 'unknown';
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const diagnosis: string[] = [];

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorType = 'timeout';
          errorMessage = 'Connection timeout after 10 seconds';
          diagnosis.push('Connection timeout - Source may be slow or unreachable');
        } else if (error.message.includes('certificate')) {
          errorType = 'ssl_error';
          diagnosis.push('SSL certificate error - May need to disable SSL validation');
        } else if (error.message.includes('DNS') || error.message.includes('ENOTFOUND')) {
          errorType = 'dns_error';
          diagnosis.push('DNS resolution failed - Domain may not exist or DNS issues');
        } else if (error.message.includes('ECONNREFUSED')) {
          errorType = 'connection_refused';
          diagnosis.push('Connection refused - Server is not accepting connections');
        }
      }

      return new Response(
        JSON.stringify({
          success: false,
          error_type: errorType,
          error: errorMessage,
          source_id,
          source_name: source.name,
          tested_url: url,
          diagnosis,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in test-osint-source-connectivity:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
