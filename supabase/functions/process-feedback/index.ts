import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { objectType, objectId, feedback, notes, userId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing ${feedback} feedback for ${objectType} ${objectId}`);

    // Store feedback event
    const { error: feedbackError } = await supabase
      .from('feedback_events')
      .insert({
        object_type: objectType,
        object_id: objectId,
        feedback,
        user_id: userId,
        notes
      });

    if (feedbackError) throw feedbackError;

    // Update object based on feedback
    if (objectType === 'signal') {
      const updates: any = {};
      
      if (feedback === 'relevant') {
        updates.relevance_score = 1.0;
        updates.status = 'triaged';
      } else if (feedback === 'irrelevant') {
        updates.relevance_score = 0.0;
        updates.status = 'false_positive';
      } else if (feedback === 'too_minor') {
        updates.relevance_score = 0.3;
        updates.status = 'resolved';
      }

      await supabase
        .from('signals')
        .update(updates)
        .eq('id', objectId);

      // Update learning profiles
      await updateLearningProfiles(supabase, objectType, objectId, feedback);
      
    } else if (objectType === 'incident') {
      if (feedback === 'relevant') {
        await supabase
          .from('incidents')
          .update({ 
            timeline_json: supabase.rpc('jsonb_array_append', {
              arr: 'timeline_json',
              elem: {
                timestamp: new Date().toISOString(),
                action: 'feedback',
                note: 'Confirmed as relevant incident'
              }
            })
          })
          .eq('id', objectId);
      } else if (feedback === 'irrelevant') {
        await supabase
          .from('incidents')
          .update({ 
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            timeline_json: supabase.rpc('jsonb_array_append', {
              arr: 'timeline_json',
              elem: {
                timestamp: new Date().toISOString(),
                action: 'closed',
                note: 'Marked as irrelevant / false positive'
              }
            })
          })
          .eq('id', objectId);
      }

      await updateLearningProfiles(supabase, objectType, objectId, feedback);
      
    } else if (objectType === 'entity') {
      if (feedback === 'confirmed') {
        await supabase
          .from('entities')
          .update({ 
            entity_status: 'confirmed',
            confidence_score: 1.0
          })
          .eq('id', objectId);
      } else if (feedback === 'rejected') {
        await supabase
          .from('entities')
          .update({ 
            entity_status: 'rejected',
            is_active: false
          })
          .eq('id', objectId);
      }
    }

    console.log(`Feedback processed successfully`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in process-feedback:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function updateLearningProfiles(supabase: any, objectType: string, objectId: string, feedback: string) {
  try {
    // Fetch the object
    let objectData: any = null;
    
    if (objectType === 'signal') {
      const { data } = await supabase
        .from('signals')
        .select('title, description, signal_type, severity_score, normalized_text')
        .eq('id', objectId)
        .single();
      objectData = data;
    } else if (objectType === 'incident') {
      const { data } = await supabase
        .from('incidents')
        .select('title, summary, incident_type, severity_level')
        .eq('id', objectId)
        .single();
      objectData = data;
    }

    if (!objectData) return;

    // Extract features (simple keyword extraction)
    const text = `${objectData.title || ''} ${objectData.description || objectData.summary || ''} ${objectData.normalized_text || ''}`.toLowerCase();
    const words = text.split(/\s+/).filter(w => w.length > 3);
    const keywords = [...new Set(words)].slice(0, 20);

    const profileType = feedback === 'relevant' || feedback === 'confirmed' 
      ? 'approved_signal_patterns' 
      : 'rejected_signal_patterns';

    // Get existing profile
    const { data: existingProfile } = await supabase
      .from('learning_profiles')
      .select('*')
      .eq('profile_type', profileType)
      .single();

    if (existingProfile) {
      // Update existing
      const currentFeatures = existingProfile.features || {};
      keywords.forEach(kw => {
        currentFeatures[kw] = (currentFeatures[kw] || 0) + 1;
      });

      await supabase
        .from('learning_profiles')
        .update({
          features: currentFeatures,
          sample_count: (existingProfile.sample_count || 0) + 1,
          last_updated: new Date().toISOString()
        })
        .eq('id', existingProfile.id);
    } else {
      // Create new
      const features: Record<string, number> = {};
      keywords.forEach(kw => {
        features[kw] = 1;
      });

      await supabase
        .from('learning_profiles')
        .insert({
          profile_type: profileType,
          features,
          sample_count: 1
        });
    }

    console.log(`Updated learning profile: ${profileType}`);
  } catch (error: any) {
    console.error('Error updating learning profiles:', error?.message);
  }
}