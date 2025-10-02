import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import React from 'npm:react@18.3.1';
import { Resend } from 'npm:resend@4.0.0';
import { renderAsync } from 'npm:@react-email/components@0.0.22';
import { SecurityAlertEmail } from './_templates/security-alert.tsx';

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

    const resend = new Resend(Deno.env.get('RESEND_API_KEY') as string);

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
        if (alert.channel === 'email') {
          // Extract email data from response_json
          const emailData = alert.response_json;
          
          // Render React email template
          const html = await renderAsync(
            React.createElement(SecurityAlertEmail, {
              threatLevel: emailData.threat_level || 'medium',
              signalText: emailData.body || 'Security alert',
              location: emailData.location || 'Unknown',
              reasoning: emailData.reasoning || '',
              containmentActions: emailData.containment_actions || [],
              incidentId: alert.incident_id,
              dashboardUrl: `${Deno.env.get('SUPABASE_URL')?.replace('supabase.co', 'lovable.app') || ''}`
            })
          );

          // Send email via Resend
          const { error: sendError } = await resend.emails.send({
            from: 'Security Alert <alerts@resend.dev>',
            to: [alert.recipient],
            subject: emailData.subject || 'Security Alert',
            html,
          });

          if (sendError) {
            throw sendError;
          }

          console.log(`Email sent to ${alert.recipient}`);
        } else {
          // For non-email channels, just log
          console.log(`Alert channel ${alert.channel} not yet implemented`);
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
