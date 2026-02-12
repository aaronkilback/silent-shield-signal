/**
 * Persist Report Edge Function
 * 
 * Archives generated reports to the database and optionally stores 
 * a server-side PDF in storage. Called after any report generation.
 */

import { createServiceClient, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const auth = await getUserFromRequest(req);
    if (!auth.userId) return errorResponse('Unauthorized', 401);

    const supabase = createServiceClient();
    const { report_type, title, client_id, period_start, period_end, html_content, metadata } = await req.json();

    if (!report_type || !title || !html_content) {
      return errorResponse('Missing required fields: report_type, title, html_content');
    }

    // Persist the report record
    const { data: report, error: insertError } = await supabase
      .from('generated_reports')
      .insert({
        user_id: auth.userId,
        client_id: client_id || null,
        report_type,
        title,
        period_start: period_start || null,
        period_end: period_end || null,
        html_content,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (insertError) throw insertError;

    console.log(`[PersistReport] Archived report ${report.id} (${report_type}) for user ${auth.userId}`);

    return successResponse({ 
      success: true, 
      report_id: report.id,
      message: 'Report archived successfully' 
    });
  } catch (error) {
    console.error('[PersistReport] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to persist report', 500);
  }
});
