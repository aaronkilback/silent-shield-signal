import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationEmailRequest {
  to: string;
  type: 'incident' | 'entity_mention' | 'weekly_report';
  data: any;
}

const getEmailContent = (type: string, data: any) => {
  switch (type) {
    case 'incident':
      return {
        subject: `🚨 New Incident: ${data.priority.toUpperCase()} Priority`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #dc2626;">New Security Incident</h1>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Priority:</strong> <span style="color: #dc2626;">${data.priority.toUpperCase()}</span></p>
              <p><strong>Status:</strong> ${data.status}</p>
              <p><strong>Client:</strong> ${data.client_name || 'N/A'}</p>
              <p><strong>Opened:</strong> ${new Date(data.opened_at).toLocaleString()}</p>
            </div>
            ${data.signal_text ? `
              <div style="margin: 20px 0;">
                <h3>Signal Details:</h3>
                <p style="background: #f9fafb; padding: 15px; border-left: 4px solid #3b82f6; border-radius: 4px;">
                  ${data.signal_text}
                </p>
              </div>
            ` : ''}
            <div style="margin: 30px 0;">
              <a href="${data.app_url}/incidents" 
                 style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View Incident Details
              </a>
            </div>
            <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
              This is an automated notification from Fortress AI Security Intelligence Platform
            </p>
          </div>
        `
      };

    case 'entity_mention':
      return {
        subject: `🔍 Entity Detected: ${data.entity_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #f59e0b;">Entity Mention Alert</h1>
            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Entity:</strong> ${data.entity_name}</p>
              <p><strong>Type:</strong> ${data.entity_type}</p>
              <p><strong>Confidence:</strong> ${(data.confidence * 100).toFixed(0)}%</p>
              <p><strong>Detected:</strong> ${new Date(data.detected_at).toLocaleString()}</p>
            </div>
            ${data.context ? `
              <div style="margin: 20px 0;">
                <h3>Context:</h3>
                <p style="background: #f9fafb; padding: 15px; border-left: 4px solid #f59e0b; border-radius: 4px;">
                  ${data.context}
                </p>
              </div>
            ` : ''}
            <div style="margin: 30px 0;">
              <a href="${data.app_url}/entities" 
                 style="background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View Entity Details
              </a>
            </div>
            <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
              This is an automated notification from Fortress AI Security Intelligence Platform
            </p>
          </div>
        `
      };

    case 'weekly_report':
      return {
        subject: `📊 Weekly Security Report - ${data.week_ending}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #059669;">Weekly Security Summary</h1>
            <p style="color: #6b7280;">Week ending ${data.week_ending}</p>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
              <div style="background: #dbeafe; padding: 15px; border-radius: 8px;">
                <h3 style="margin: 0; color: #1e40af;">Signals</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 10px 0; color: #1e40af;">${data.signals_count}</p>
              </div>
              <div style="background: #fee2e2; padding: 15px; border-radius: 8px;">
                <h3 style="margin: 0; color: #991b1b;">Incidents</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 10px 0; color: #991b1b;">${data.incidents_count}</p>
              </div>
              <div style="background: #fef3c7; padding: 15px; border-radius: 8px;">
                <h3 style="margin: 0; color: #92400e;">Entities</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 10px 0; color: #92400e;">${data.entities_count}</p>
              </div>
              <div style="background: #d1fae5; padding: 15px; border-radius: 8px;">
                <h3 style="margin: 0; color: #065f46;">Resolved</h3>
                <p style="font-size: 32px; font-weight: bold; margin: 10px 0; color: #065f46;">${data.resolved_count}</p>
              </div>
            </div>

            <div style="margin: 30px 0;">
              <a href="${data.app_url}" 
                 style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View Full Dashboard
              </a>
            </div>
            <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
              This is an automated weekly report from Fortress AI Security Intelligence Platform
            </p>
          </div>
        `
      };

    default:
      return {
        subject: 'Notification from Fortress AI',
        html: '<p>You have a new notification.</p>'
      };
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, type, data }: NotificationEmailRequest = await req.json();

    if (!to) {
      throw new Error('Recipient email is required');
    }

    const { subject, html } = getEmailContent(type, data);

    const emailResponse = await resend.emails.send({
      from: "Fortress AI <notifications@updates.lovableproject.com>",
      to: [to],
      subject,
      html,
    });

    console.log(`Email sent successfully to ${to}:`, emailResponse);

    return new Response(
      JSON.stringify({ success: true, data: emailResponse }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error sending notification email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
