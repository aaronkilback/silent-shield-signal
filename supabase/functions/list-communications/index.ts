import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * List Communications Edge Function
 * 
 * Returns all communication threads for an investigation,
 * grouped by contact and filterable by investigator.
 * 
 * Used by both the main platform and the mobile app via API.
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const investigationId = url.searchParams.get("investigation_id");
    const contactIdentifier = url.searchParams.get("contact");
    const investigatorId = url.searchParams.get("investigator_id");
    const channel = url.searchParams.get("channel");

    if (!investigationId) {
      return new Response(
        JSON.stringify({ error: "investigation_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build query
    let query = supabase
      .from("investigation_communications")
      .select("*")
      .eq("investigation_id", investigationId)
      .order("message_timestamp", { ascending: true });

    if (contactIdentifier) {
      query = query.eq("contact_identifier", contactIdentifier);
    }
    if (investigatorId) {
      query = query.eq("investigator_user_id", investigatorId);
    }
    if (channel) {
      query = query.eq("channel", channel);
    }

    const { data: communications, error } = await query;

    if (error) {
      console.error("[ListComms] Query error:", error);
      throw error;
    }

    // Build contact summary (unique contacts with last message)
    const contactMap = new Map<string, {
      contact_identifier: string;
      contact_name: string | null;
      channel: string;
      last_message: string;
      last_timestamp: string;
      message_count: number;
      investigators: string[];
    }>();

    for (const comm of communications || []) {
      const key = `${comm.contact_identifier}_${comm.channel}`;
      const existing = contactMap.get(key);
      if (existing) {
        existing.message_count++;
        existing.last_message = comm.message_body;
        existing.last_timestamp = comm.message_timestamp;
        if (!existing.investigators.includes(comm.investigator_user_id)) {
          existing.investigators.push(comm.investigator_user_id);
        }
        if (comm.contact_name && !existing.contact_name) {
          existing.contact_name = comm.contact_name;
        }
      } else {
        contactMap.set(key, {
          contact_identifier: comm.contact_identifier,
          contact_name: comm.contact_name,
          channel: comm.channel,
          last_message: comm.message_body,
          last_timestamp: comm.message_timestamp,
          message_count: 1,
          investigators: [comm.investigator_user_id],
        });
      }
    }

    return new Response(
      JSON.stringify({
        communications: communications || [],
        contacts: Array.from(contactMap.values()),
        total: communications?.length || 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[ListComms] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
