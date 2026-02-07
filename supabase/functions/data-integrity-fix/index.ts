import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify caller is admin/super_admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    const userRoles = roles?.map(r => r.role) || [];
    if (!userRoles.includes('super_admin') && !userRoles.includes('admin')) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: Record<string, unknown> = {};

    // Fix 1: Backfill missing signal titles
    const { data: missingTitles, error: e1 } = await supabase
      .from('signals')
      .select('id, normalized_text')
      .is('title', null)
      .not('normalized_text', 'is', null)
      .limit(500);

    if (!e1 && missingTitles && missingTitles.length > 0) {
      let fixed = 0;
      for (const s of missingTitles) {
        const { error } = await supabase
          .from('signals')
          .update({ title: (s.normalized_text || '').slice(0, 100) })
          .eq('id', s.id);
        if (!error) fixed++;
      }
      results.backfilled_titles = { found: missingTitles.length, fixed };
    } else {
      results.backfilled_titles = { found: 0, fixed: 0 };
    }

    // Fix 2: Clean orphaned feedback events
    const { data: feedback } = await supabase
      .from('feedback_events')
      .select('id, object_id')
      .eq('object_type', 'signal');

    if (feedback && feedback.length > 0) {
      const { data: signals } = await supabase.from('signals').select('id');
      const validIds = new Set(signals?.map(s => s.id) || []);
      const orphaned = feedback.filter(f => f.object_id && !validIds.has(f.object_id));
      
      let deleted = 0;
      for (const f of orphaned) {
        const { error } = await supabase.from('feedback_events').delete().eq('id', f.id);
        if (!error) deleted++;
      }
      results.orphaned_feedback = { found: orphaned.length, deleted };
    } else {
      results.orphaned_feedback = { found: 0, deleted: 0 };
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
