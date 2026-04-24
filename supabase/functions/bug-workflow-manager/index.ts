import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WorkflowAction {
  action: 'get_open_bugs' | 'update_status' | 'propose_fix' | 'verify_fix' | 'notify_user' | 'run_tests' | 'get_bug_details';
  bug_id?: string;
  status?: string;
  workflow_stage?: string;
  fix_proposal?: any;
  test_results?: any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: WorkflowAction = await req.json();

    switch (payload.action) {
      case 'get_open_bugs': {
        const { data: bugs, error } = await supabase
          .from('bug_reports')
          .select(`
            id, title, description, severity, status, 
            workflow_stage, fix_status, fix_proposal,
            page_url, browser_info, screenshots,
            created_at, updated_at, reporter_email,
            user_id, test_results, verification_status
          `)
          .in('status', ['open', 'in_progress'])
          .order('severity', { ascending: true })
          .order('created_at', { ascending: true });

        if (error) throw error;

        // Prioritize by severity
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sorted = bugs?.sort((a, b) => {
          const aPriority = priorityOrder[a.severity as keyof typeof priorityOrder] ?? 4;
          const bPriority = priorityOrder[b.severity as keyof typeof priorityOrder] ?? 4;
          return aPriority - bPriority;
        });

        return new Response(
          JSON.stringify({ 
            bugs: sorted,
            summary: {
              total: sorted?.length || 0,
              critical: sorted?.filter(b => b.severity === 'critical').length || 0,
              high: sorted?.filter(b => b.severity === 'high').length || 0,
              medium: sorted?.filter(b => b.severity === 'medium').length || 0,
              low: sorted?.filter(b => b.severity === 'low').length || 0,
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_bug_details': {
        if (!payload.bug_id) {
          return new Response(
            JSON.stringify({ error: "bug_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: bug, error } = await supabase
          .from('bug_reports')
          .select('*')
          .eq('id', payload.bug_id)
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ bug }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'update_status': {
        if (!payload.bug_id) {
          return new Response(
            JSON.stringify({ error: "bug_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updates: any = { updated_at: new Date().toISOString() };
        if (payload.status) updates.status = payload.status;
        if (payload.workflow_stage) updates.workflow_stage = payload.workflow_stage;
        
        if (payload.status === 'resolved') {
          updates.resolved_at = new Date().toISOString();
        }

        const { data, error } = await supabase
          .from('bug_reports')
          .update(updates)
          .eq('id', payload.bug_id)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, bug: data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'propose_fix': {
        if (!payload.bug_id || !payload.fix_proposal) {
          return new Response(
            JSON.stringify({ error: "bug_id and fix_proposal required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data, error } = await supabase
          .from('bug_reports')
          .update({
            fix_proposal: payload.fix_proposal,
            fix_status: 'proposal_ready',
            workflow_stage: 'fix_proposed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payload.bug_id)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, bug: data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'run_tests': {
        if (!payload.bug_id) {
          return new Response(
            JSON.stringify({ error: "bug_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update status to testing
        await supabase
          .from('bug_reports')
          .update({
            workflow_stage: 'testing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payload.bug_id);

        // Store test results if provided
        if (payload.test_results) {
          const { data, error } = await supabase
            .from('bug_reports')
            .update({
              test_results: payload.test_results,
              verification_status: payload.test_results.passed ? 'passed' : 'failed',
              verified_at: new Date().toISOString(),
              workflow_stage: payload.test_results.passed ? 'verified' : 'fix_implementing',
              fix_verified: payload.test_results.passed,
              updated_at: new Date().toISOString(),
            })
            .eq('id', payload.bug_id)
            .select()
            .single();

          if (error) throw error;

          return new Response(
            JSON.stringify({ success: true, bug: data }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, message: "Testing stage initiated" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'verify_fix': {
        if (!payload.bug_id) {
          return new Response(
            JSON.stringify({ error: "bug_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data, error } = await supabase
          .from('bug_reports')
          .update({
            verification_status: 'passed',
            verified_at: new Date().toISOString(),
            workflow_stage: 'verified',
            fix_verified: true,
            fix_status: 'implemented',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payload.bug_id)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, bug: data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'notify_user': {
        if (!payload.bug_id) {
          return new Response(
            JSON.stringify({ error: "bug_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get bug details
        const { data: bug, error: bugError } = await supabase
          .from('bug_reports')
          .select('*')
          .eq('id', payload.bug_id)
          .single();

        if (bugError) throw bugError;

        // If we have reporter email, send notification
        if (bug.reporter_email) {
          try {
            await supabase.functions.invoke('send-notification-email', {
              body: {
                to: bug.reporter_email,
                type: 'bug_update',
                data: {
                  bug_title: bug.title,
                  status: bug.status,
                  workflow_stage: bug.workflow_stage,
                  fix_verified: bug.fix_verified,
                },
              },
            });
          } catch (emailError) {
            console.error("Failed to send email notification:", emailError);
          }
        }

        // Update notification timestamp
        const { data, error } = await supabase
          .from('bug_reports')
          .update({
            notification_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', payload.bug_id)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, bug: data, notification_sent: !!bug.reporter_email }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Bug workflow error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});