// Shared handoff helpers for the qualification assistant (WO-AEGIS-QUALIFIER).
// Used by both aegis-qualify (visitor-driven) and aegis-qualify-sweep (cron backstop) so the callback SMS is
// exactly-once and a committed lead can never be lost. send-sms lives on Fortress prod (same project as these
// functions); the CRM lead lives on the CRM project.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function crmClient(): SupabaseClient {
  const url = Deno.env.get("CRM_SUPABASE_URL") || "https://doedbzdgpkkdiubodvzb.supabase.co";
  const key = Deno.env.get("CRM_SERVICE_ROLE_KEY");
  if (!key) throw new Error("CRM_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

// One operator SMS via send-sms operator_alert (first name + callback only; never exposure/transcript).
export async function sendOperatorSms(message: string): Promise<boolean> {
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operator_alert: true, message }),
    });
    if (!resp.ok) { console.error("[qualifier] send-sms failed:", resp.status); return false; }
    return true;
  } catch (e) { console.error("[qualifier] send-sms threw:", e instanceof Error ? e.message : String(e)); return false; }
}

// Create the CRM lead once (idempotent on crm_conversation_id). source='web' for web-originated leads.
export async function ensureCrmLead(crm: SupabaseClient, convo: any, firstName: string, callback: string): Promise<string | null> {
  if (convo.crm_conversation_id) return convo.crm_conversation_id;
  try {
    const { data: admin } = await crm.from("crm_org_members").select("user_id").eq("org_id", convo.org_id).eq("role", "admin").limit(1).maybeSingle();
    const actor = admin?.user_id;
    if (!actor) { console.error("[qualifier] no org admin for CRM lead"); return null; }
    const now = new Date().toISOString();
    const { data: conv, error } = await crm.from("crm_conversations").insert({
      org_id: convo.org_id, created_by: actor, assigned_to: actor,
      platform: "other", handle: callback, source: "web", stage: "lead", last_inbound_at: now, awaiting_reply: true,
    }).select("id").single();
    if (error) throw error;
    await crm.from("crm_conversation_events").insert({
      conversation_id: conv.id, org_id: convo.org_id, actor_user_id: actor,
      event_type: "created", to_stage: "lead",
      metadata: { first_name: firstName, via: "aegis-qualifier", prequalified: true, synthetic: convo.synthetic || false },
    });
    await crm.from("aegis_qualifier_conversations").update({ crm_conversation_id: conv.id }).eq("id", convo.id);
    return conv.id;
  } catch (e) { console.error("[qualifier] ensureCrmLead failed:", e instanceof Error ? e.message : String(e)); return null; }
}

// Idempotent callback delivery — fires the callback SMS at most once (guarded by callback_notified_at).
// [TEST]-prefixed for synthetic conversations so a test alert is never mistaken for a real lead.
export async function fireCallbackOnce(crm: SupabaseClient, convo: any): Promise<boolean> {
  if (convo.callback_notified_at) return true; // already delivered
  const name = convo.first_name || "(no name)";
  const number = convo.contact_value || "(no number)";
  const prefix = convo.synthetic ? "[TEST] " : "";
  const ok = await sendOperatorSms(`${prefix}New qualified lead: ${name}. Callback: ${number}.`);
  if (ok) await crm.from("aegis_qualifier_conversations").update({ callback_notified_at: new Date().toISOString() }).eq("id", convo.id);
  return ok;
}

// Append a system turn (visible to the visitor via the broadcast trigger).
export async function appendSystemTurn(crm: SupabaseClient, convo: any, content: string): Promise<void> {
  const tx = Array.isArray(convo.transcript) ? convo.transcript : [];
  await crm.from("aegis_qualifier_conversations")
    .update({ transcript: [...tx, { role: "system", content, ts: new Date().toISOString() }], updated_at: new Date().toISOString() })
    .eq("id", convo.id);
}
