import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Alert delivery: Processing pending alerts...');

    // Get pending alerts
    const { data: alerts, error: alertsError } = await supabase
      .from('alerts')
      .select('*, incidents(*)')
      .eq('status', 'pending')
      .limit(20);

    if (alertsError) throw alertsError;

    console.log(`Found ${alerts?.length || 0} pending alerts`);

    let delivered = 0;
    let failed = 0;

    for (const alert of alerts || []) {
      try {
        // In production, integrate with actual email/SMS services
        // For now, simulate delivery
        console.log(`Delivering alert to ${alert.recipient} via ${alert.channel}`);
        
        // Simulate email delivery
        if (alert.channel === 'email') {
          console.log('Email content:', alert.response_json);
        }

        // Mark as sent
        const { error: updateError } = await supabase
          .from('alerts')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            response_json: {
              ...alert.response_json,
              delivered_at: new Date().toISOString(),
              delivery_status: 'success'
            }
          })
          .eq('id', alert.id);

        if (!updateError) {
          delivered++;
        } else {
          failed++;
        }

      } catch (error) {
        console.error(`Error delivering alert ${alert.id}:`, error);
        
        // Mark as failed
        await supabase
          .from('alerts')
          .update({
            status: 'failed',
            response_json: {
              ...alert.response_json,
              error: error instanceof Error ? error.message : 'Unknown error',
              failed_at: new Date().toISOString()
            }
          })
          .eq('id', alert.id);
        
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        summary: {
          total_alerts: alerts?.length || 0,
          delivered,
          failed
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in alert delivery:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
