import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { 
      source_id, 
      new_url, 
      update_user_agent, 
      toggle_status, 
      force_ssl_validation,
      reason 
    } = await req.json();

    if (!source_id) {
      return errorResponse('source_id is required', 400);
    }

    const supabase = createServiceClient();

    // Get current source configuration
    const { data: source, error: fetchError } = await supabase
      .from('sources')
      .select('*')
      .eq('id', source_id)
      .single();

    if (fetchError || !source) {
      return errorResponse('Source not found', 404);
    }

    const config = source.config || {};
    const changes: string[] = [];
    const oldConfig = { ...config };

    // Apply updates
    if (new_url) {
      if (config.url) {
        config.url = new_url;
      } else if (config.feedUrl) {
        config.feedUrl = new_url;
      }
      changes.push(`Updated URL to: ${new_url}`);
    }

    if (update_user_agent) {
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ];
      const currentUA = config.userAgent || '';
      const currentIndex = userAgents.indexOf(currentUA);
      const newUA = userAgents[(currentIndex + 1) % userAgents.length];
      config.userAgent = newUA;
      changes.push(`Updated User-Agent to: ${newUA.substring(0, 50)}...`);
    }

    let newStatus = source.status;
    if (toggle_status !== undefined) {
      if (toggle_status) {
        newStatus = 'active';
        changes.push('Enabled source');
      } else {
        newStatus = 'paused';
        changes.push('Disabled source');
      }
    }

    if (force_ssl_validation !== undefined) {
      config.validateSSL = force_ssl_validation;
      changes.push(`${force_ssl_validation ? 'Enabled' : 'Disabled'} SSL validation`);
    }

    // Create audit record
    const auditEntry = {
      timestamp: new Date().toISOString(),
      changes,
      reason: reason || 'AI-assisted source remediation',
      old_config: oldConfig,
      new_config: config,
      old_status: source.status,
      new_status: newStatus,
    };

    // Store audit in config metadata
    if (!config._audit_log) {
      config._audit_log = [];
    }
    config._audit_log.push(auditEntry);
    
    // Keep only last 10 audit entries
    if (config._audit_log.length > 10) {
      config._audit_log = config._audit_log.slice(-10);
    }

    // Update source
    const { error: updateError } = await supabase
      .from('sources')
      .update({ 
        config,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', source_id);

    if (updateError) {
      console.error('Error updating source:', updateError);
      return errorResponse(`Failed to update source: ${updateError.message}`, 500);
    }

    console.log(`Updated source ${source_id}:`, changes);

    return successResponse({
      source_id,
      source_name: source.name,
      changes,
      audit_entry: auditEntry,
      reversible: true,
      message: `Successfully updated source configuration with ${changes.length} change(s)`
    });

  } catch (error) {
    console.error('Error in update-osint-source-config:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
