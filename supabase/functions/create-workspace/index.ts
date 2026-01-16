import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreateWorkspacePayload = {
  title?: string;
  description?: string | null;
  incidentId?: string | null;
  investigationId?: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Verify the caller is an authenticated user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Use service client for DB writes (bypasses RLS), but we still enforce access rules here
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await req.json()) as CreateWorkspacePayload;
    const title = (body.title ?? "").trim() || "Investigation Workspace";
    const description = body.description ?? null;
    const incidentId = body.incidentId ?? null;
    const investigationId = body.investigationId ?? null;

    if (!incidentId && !investigationId) {
      return new Response(
        JSON.stringify({ error: "Workspace must be linked to an incident or investigation" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create workspace
    const { data: workspace, error: workspaceError } = await serviceClient
      .from("investigation_workspaces")
      .insert({
        title,
        description,
        incident_id: incidentId,
        investigation_id: investigationId,
        created_by_user_id: user.id,
        status: "active",
      })
      .select("id, title")
      .single();

    if (workspaceError) throw workspaceError;

    // Add creator as owner
    const { error: memberError } = await serviceClient.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner",
    });
    if (memberError) throw memberError;

    // Initial system message
    const { error: msgError } = await serviceClient.from("workspace_messages").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      content: "Workspace created. Welcome to the collaborative investigation space!",
      message_type: "system_event",
    });
    if (msgError) throw msgError;

    // Audit log
    const { error: auditError } = await serviceClient.from("workspace_audit_log").insert({
      workspace_id: workspace.id,
      user_id: user.id,
      action: "WORKSPACE_CREATED",
      details: { title: workspace.title, incident_id: incidentId, investigation_id: investigationId },
    });
    if (auditError) throw auditError;

    return new Response(JSON.stringify({ workspace }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in create-workspace:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
