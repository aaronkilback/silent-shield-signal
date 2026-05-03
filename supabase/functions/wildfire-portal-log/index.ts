/**
 * Tiny server-side logger for the public Wildfire Portal. Client-side
 * events (page_view, report_view) POST here; we hash the visitor IP
 * and insert via the service role (RLS denies anon writes to the
 * usage table).
 *
 * verify_jwt=false. Rate-limited at function-level by Supabase free
 * tier. Payload size capped at ~2KB.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_EVENTS = new Set(["page_view", "report_view"]);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const eventType = String(body?.event_type || "");
    const sessionId = String(body?.session_id || "");
    if (!ALLOWED_EVENTS.has(eventType) || !sessionId) {
      return new Response(JSON.stringify({ error: "invalid event" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_JWT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const fwd = req.headers.get("x-forwarded-for") || "";
    const visitorIp = fwd.split(",")[0]?.trim() || "unknown";
    const ipHash = visitorIp !== "unknown" ? await sha256Hex(visitorIp) : null;

    // Cap payload size to avoid abuse — visitor-supplied JSON.
    let payload = body?.payload ?? {};
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 2000) payload = { truncated: true };

    await supabase.from("wildfire_portal_usage").insert({
      event_type: eventType,
      session_id: sessionId.substring(0, 80),
      ip_hash: ipHash,
      user_agent: (req.headers.get("user-agent") || "").substring(0, 500),
      referrer: (body?.referrer || "").substring(0, 500),
      payload,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
