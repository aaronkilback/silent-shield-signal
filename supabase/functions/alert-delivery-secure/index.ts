import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SecureAlertPayload {
  incident_id?: string;
  signal_id?: string;
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  title: string;
  summary: string;
  threat_level: string;
  location?: string;
  client_id?: string;
  client_name?: string;
  recommended_actions?: string[];
  dashboard_url?: string;
  channels: ('teams' | 'slack' | 'sms')[];
  recipients?: {
    teams_webhook?: string;
    slack_webhook?: string;
    sms_numbers?: string[];
  };
}

// Format alert for Microsoft Teams Adaptive Card
function formatTeamsCard(alert: SecureAlertPayload): object {
  const priorityColors: Record<string, string> = {
    p1: 'attention',
    p2: 'warning', 
    p3: 'accent',
    p4: 'good'
  };

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: priorityColors[alert.priority] || 'attention',
            items: [
              {
                type: 'TextBlock',
                text: `🚨 ${alert.priority.toUpperCase()} SECURITY ALERT`,
                weight: 'bolder',
                size: 'large',
                color: 'light'
              }
            ]
          },
          {
            type: 'TextBlock',
            text: alert.title,
            weight: 'bolder',
            size: 'medium',
            wrap: true
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Threat Level', value: alert.threat_level.toUpperCase() },
              { title: 'Client', value: alert.client_name || 'Unknown' },
              { title: 'Location', value: alert.location || 'Unknown' },
              { title: 'Time', value: new Date().toISOString() }
            ]
          },
          {
            type: 'TextBlock',
            text: 'Summary',
            weight: 'bolder',
            spacing: 'medium'
          },
          {
            type: 'TextBlock',
            text: alert.summary,
            wrap: true
          },
          ...(alert.recommended_actions?.length ? [
            {
              type: 'TextBlock',
              text: 'Recommended Actions',
              weight: 'bolder',
              spacing: 'medium'
            },
            {
              type: 'TextBlock',
              text: alert.recommended_actions.map((a, i) => `${i + 1}. ${a}`).join('\n'),
              wrap: true
            }
          ] : [])
        ],
        actions: alert.dashboard_url ? [
          {
            type: 'Action.OpenUrl',
            title: 'View in Dashboard',
            url: alert.dashboard_url
          }
        ] : []
      }
    }]
  };
}

// Format alert for Slack Block Kit
function formatSlackBlocks(alert: SecureAlertPayload): object {
  const priorityEmojis: Record<string, string> = {
    p1: '🔴',
    p2: '🟠',
    p3: '🟡',
    p4: '🟢'
  };

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${priorityEmojis[alert.priority] || '🚨'} ${alert.priority.toUpperCase()} Security Alert`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${alert.title}*`
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Threat Level:*\n${alert.threat_level.toUpperCase()}` },
          { type: 'mrkdwn', text: `*Client:*\n${alert.client_name || 'Unknown'}` },
          { type: 'mrkdwn', text: `*Location:*\n${alert.location || 'Unknown'}` },
          { type: 'mrkdwn', text: `*Time:*\n${new Date().toLocaleString()}` }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Summary:*\n${alert.summary}`
        }
      },
      ...(alert.recommended_actions?.length ? [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Recommended Actions:*\n${alert.recommended_actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
          }
        }
      ] : []),
      ...(alert.dashboard_url ? [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in Dashboard', emoji: true },
              url: alert.dashboard_url,
              style: 'primary'
            }
          ]
        }
      ] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Incident: ${alert.incident_id || 'N/A'} | Signal: ${alert.signal_id || 'N/A'}`
          }
        ]
      }
    ]
  };
}

// Format SMS message (concise for character limits)
function formatSMSMessage(alert: SecureAlertPayload): string {
  const lines = [
    `🚨 ${alert.priority.toUpperCase()} ALERT: ${alert.title}`,
    `Threat: ${alert.threat_level.toUpperCase()}`,
    alert.client_name ? `Client: ${alert.client_name}` : null,
    alert.location ? `Location: ${alert.location}` : null,
    alert.recommended_actions?.[0] ? `Action: ${alert.recommended_actions[0]}` : null,
    alert.dashboard_url ? `Details: ${alert.dashboard_url}` : null
  ].filter(Boolean);
  
  return lines.join('\n').slice(0, 1600); // SMS limit
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: SecureAlertPayload = await req.json();
    console.log('Secure alert delivery:', JSON.stringify({ 
      priority: payload.priority,
      channels: payload.channels,
      incident_id: payload.incident_id 
    }));

    // Get configured webhooks from intelligence_config if not provided
    let teamsWebhook = payload.recipients?.teams_webhook;
    let slackWebhook = payload.recipients?.slack_webhook;
    let smsNumbers = payload.recipients?.sms_numbers || [];

    // Load default webhooks from config if not provided in payload
    if (payload.channels.includes('teams') && !teamsWebhook) {
      const { data: teamsConfig } = await supabase
        .from('intelligence_config')
        .select('value')
        .eq('key', 'teams_webhook_url')
        .single();
      teamsWebhook = teamsConfig?.value?.url;
    }

    if (payload.channels.includes('slack') && !slackWebhook) {
      const { data: slackConfig } = await supabase
        .from('intelligence_config')
        .select('value')
        .eq('key', 'slack_webhook_url')
        .single();
      slackWebhook = slackConfig?.value?.url;
    }

    if (payload.channels.includes('sms') && smsNumbers.length === 0) {
      const { data: smsConfig } = await supabase
        .from('intelligence_config')
        .select('value')
        .eq('key', 'sms_alert_numbers')
        .single();
      smsNumbers = smsConfig?.value?.numbers || [];
    }

    // Build dashboard URL
    const baseUrl = Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '') || '';
    const projectId = baseUrl.split('//')[1]?.split('.')[0] || '';
    const appUrl = Deno.env.get('APP_URL') || 'https://fortress.silentshieldsecurity.com';
    payload.dashboard_url = payload.incident_id
      ? `${appUrl}/incidents?id=${payload.incident_id}`
      : `${appUrl}/incidents`;

    const deliveryResults: Record<string, { success: boolean; error?: string; duration_ms?: number }> = {};

    // Parallel delivery to all channels
    const deliveryPromises: Promise<void>[] = [];

    // Microsoft Teams delivery
    if (payload.channels.includes('teams') && teamsWebhook) {
      deliveryPromises.push((async () => {
        const channelStart = Date.now();
        try {
          const teamsPayload = formatTeamsCard(payload);
          const response = await fetch(teamsWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(teamsPayload)
          });

          if (!response.ok) {
            throw new Error(`Teams webhook failed: ${response.status}`);
          }

          deliveryResults.teams = { 
            success: true, 
            duration_ms: Date.now() - channelStart 
          };
          console.log('Teams alert delivered successfully');
        } catch (error) {
          deliveryResults.teams = { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error',
            duration_ms: Date.now() - channelStart
          };
          console.error('Teams delivery failed:', error);
        }
      })());
    } else if (payload.channels.includes('teams')) {
      deliveryResults.teams = { success: false, error: 'No webhook configured' };
    }

    // Slack delivery
    if (payload.channels.includes('slack') && slackWebhook) {
      deliveryPromises.push((async () => {
        const channelStart = Date.now();
        try {
          const slackPayload = formatSlackBlocks(payload);
          const response = await fetch(slackWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slackPayload)
          });

          if (!response.ok) {
            throw new Error(`Slack webhook failed: ${response.status}`);
          }

          deliveryResults.slack = { 
            success: true, 
            duration_ms: Date.now() - channelStart 
          };
          console.log('Slack alert delivered successfully');
        } catch (error) {
          deliveryResults.slack = { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error',
            duration_ms: Date.now() - channelStart
          };
          console.error('Slack delivery failed:', error);
        }
      })());
    } else if (payload.channels.includes('slack')) {
      deliveryResults.slack = { success: false, error: 'No webhook configured' };
    }

    // SMS delivery via Twilio
    if (payload.channels.includes('sms') && smsNumbers.length > 0) {
      const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
      const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
      const twilioFromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

      if (twilioAccountSid && twilioAuthToken && twilioFromNumber) {
        deliveryPromises.push((async () => {
          const channelStart = Date.now();
          const smsMessage = formatSMSMessage(payload);
          const smsResults: { number: string; success: boolean; error?: string }[] = [];

          await Promise.all(smsNumbers.map(async (phoneNumber) => {
            try {
              const response = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: new URLSearchParams({
                    To: phoneNumber,
                    From: twilioFromNumber,
                    Body: smsMessage
                  })
                }
              );

              if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Twilio error: ${response.status} - ${errorBody}`);
              }

              smsResults.push({ number: phoneNumber, success: true });
              console.log(`SMS sent to ${phoneNumber}`);
            } catch (error) {
              smsResults.push({ 
                number: phoneNumber, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
              });
              console.error(`SMS to ${phoneNumber} failed:`, error);
            }
          }));

          const successCount = smsResults.filter(r => r.success).length;
          deliveryResults.sms = { 
            success: successCount > 0,
            error: successCount < smsNumbers.length 
              ? `${smsNumbers.length - successCount}/${smsNumbers.length} failed` 
              : undefined,
            duration_ms: Date.now() - channelStart
          };
        })());
      } else {
        deliveryResults.sms = { success: false, error: 'Twilio credentials not configured' };
      }
    } else if (payload.channels.includes('sms')) {
      deliveryResults.sms = { success: false, error: 'No phone numbers configured' };
    }

    // Wait for all deliveries
    await Promise.all(deliveryPromises);

    const totalDuration = Date.now() - startTime;

    // Log delivery to database
    if (payload.incident_id) {
      await supabase
        .from('alerts')
        .insert({
          incident_id: payload.incident_id,
          channel: 'secure_messaging',
          recipient: JSON.stringify(payload.channels),
          status: Object.values(deliveryResults).some(r => r.success) ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          response_json: {
            delivery_results: deliveryResults,
            total_duration_ms: totalDuration,
            payload_summary: {
              priority: payload.priority,
              title: payload.title,
              channels: payload.channels
            }
          }
        });
    }

    const successCount = Object.values(deliveryResults).filter(r => r.success).length;
    const totalChannels = Object.keys(deliveryResults).length;

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        timestamp: new Date().toISOString(),
        total_duration_ms: totalDuration,
        summary: {
          channels_attempted: totalChannels,
          channels_succeeded: successCount,
          channels_failed: totalChannels - successCount
        },
        results: deliveryResults
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Secure alert delivery error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
