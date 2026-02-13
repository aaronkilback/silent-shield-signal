/**
 * Dead Letter Queue Retry Processor
 * 
 * Processes pending items from the dead_letter_queue table,
 * re-invoking the original edge function with the stored payload.
 * 
 * Runs on a schedule (every 5 minutes via pg_cron).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Fetch pending items ready for retry
    const { data: items, error } = await supabase
      .from('dead_letter_queue')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) throw error;
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      try {
        // Mark as retrying
        await supabase
          .from('dead_letter_queue')
          .update({ status: 'retrying', updated_at: new Date().toISOString() })
          .eq('id', item.id);

        // Re-invoke the original function
        const functionUrl = `${supabaseUrl}/functions/v1/${item.function_name}`;
        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(item.payload),
        });

        if (response.ok) {
          // Success — mark completed
          await supabase
            .from('dead_letter_queue')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id);

          // Also resolve the linked error
          if (item.error_id) {
            await supabase
              .from('edge_function_errors')
              .update({ resolved_at: new Date().toISOString() })
              .eq('id', item.error_id);
          }

          successCount++;
        } else {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }
      } catch (retryErr) {
        const newRetryCount = (item.retry_count || 0) + 1;

        if (newRetryCount >= item.max_retries) {
          // Exhausted — mark as exhausted
          await supabase
            .from('dead_letter_queue')
            .update({
              status: 'exhausted',
              retry_count: newRetryCount,
              error_message: String(retryErr),
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id);
        } else {
          // Schedule next retry with exponential backoff
          const backoffMs = 60_000 * Math.pow(5, newRetryCount); // 1min, 5min, 25min
          const nextRetry = new Date(Date.now() + backoffMs).toISOString();

          await supabase
            .from('dead_letter_queue')
            .update({
              status: 'pending',
              retry_count: newRetryCount,
              next_retry_at: nextRetry,
              error_message: String(retryErr),
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id);
        }
        failCount++;
      }
    }

    console.log(`[DLQ] Processed ${items.length} items: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({ processed: items.length, success: successCount, failed: failCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[DLQ] Processor error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
