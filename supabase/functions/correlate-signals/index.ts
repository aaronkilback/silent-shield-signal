import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { signal_id, time_window_hours = 24 } = await req.json();
    
    if (!signal_id) {
      return new Response(
        JSON.stringify({ error: 'signal_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Using correlation window: ${time_window_hours} hours`);

    console.log('Correlating signal:', signal_id);

    // Get the new signal
    const { data: newSignal, error: signalError } = await supabase
      .from('signals')
      .select('*')
      .eq('id', signal_id)
      .single();

    if (signalError || !newSignal) {
      console.error('Error fetching signal:', signalError);
      return new Response(
        JSON.stringify({ error: 'Signal not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Skip if already correlated
    if (newSignal.correlation_group_id) {
      console.log('Signal already correlated, skipping');
      return new Response(
        JSON.stringify({ message: 'Signal already correlated', correlated: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get signals from configurable time window (default 24 hours, excluding this one)
    const timeWindowAgo = new Date(Date.now() - time_window_hours * 60 * 60 * 1000).toISOString();
    const { data: recentSignals } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, location, confidence, source_id, created_at, correlation_group_id, is_primary_signal')
      .gte('created_at', timeWindowAgo)
      .neq('id', signal_id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!recentSignals || recentSignals.length === 0) {
      console.log('No recent signals to correlate with');
      return new Response(
        JSON.stringify({ message: 'No recent signals found', correlated: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Checking similarity against ${recentSignals.length} recent signals`);

    // Use AI to check semantic similarity
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const similarityResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a security signal correlation analyzer. Compare signals to determine if they describe the same event or related events.

Signals should be correlated if they:
- Describe the same incident/event (e.g., same protest, same breach, same threat)
- Have similar location and timeframe
- Share key entities or indicators
- Are different perspectives of the same situation

Respond with JSON array of objects containing signal_id and similarity_score (0-100).
Only include signals with similarity >= 70.

Format: [{"signal_id": "uuid", "similarity_score": 85, "reason": "brief explanation"}]`
          },
          {
            role: 'user',
            content: `NEW SIGNAL:
Text: ${newSignal.normalized_text}
Category: ${newSignal.category}
Severity: ${newSignal.severity}
Location: ${newSignal.location || 'unknown'}

RECENT SIGNALS (last 24h):
${recentSignals.map((s, i) => `
${i + 1}. ID: ${s.id}
   Text: ${s.normalized_text?.substring(0, 300)}
   Category: ${s.category}
   Severity: ${s.severity}
   Location: ${s.location || 'unknown'}
   Confidence: ${s.confidence}
`).join('\n')}

Which signals describe the same or highly related event? Return similarity scores >= 70 only.`
          }
        ],
      }),
    });

    let similarSignals: Array<{ signal_id: string; similarity_score: number; reason: string }> = [];
    
    if (similarityResponse.ok) {
      const aiData = await similarityResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      
      if (aiContent) {
        try {
          let jsonStr = aiContent.trim();
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          similarSignals = JSON.parse(jsonStr);
          console.log(`Found ${similarSignals.length} similar signals:`, similarSignals);
        } catch (e) {
          console.error('Failed to parse AI similarity response:', e);
        }
      }
    }

    // If no similar signals found, return
    if (similarSignals.length === 0) {
      console.log('No similar signals found');
      return new Response(
        JSON.stringify({ message: 'No similar signals found', correlated: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the actual signal records for similar signals
    const similarSignalIds = similarSignals.map(s => s.signal_id);
    const { data: matchedSignals } = await supabase
      .from('signals')
      .select('*, sources(name)')
      .in('id', similarSignalIds);

    if (!matchedSignals || matchedSignals.length === 0) {
      console.log('No matched signals found in database');
      return new Response(
        JSON.stringify({ message: 'No matched signals', correlated: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if any of the similar signals already belong to a correlation group
    const existingGroupSignal = matchedSignals.find(s => s.correlation_group_id);
    
    let correlationGroupId: string;
    let isNewGroup = false;

    if (existingGroupSignal) {
      // Add to existing group
      correlationGroupId = existingGroupSignal.correlation_group_id;
      console.log('Adding to existing correlation group:', correlationGroupId);
      
      // Update group stats
      const allGroupSignals = [...matchedSignals.filter(s => s.correlation_group_id === correlationGroupId), newSignal];
      const avgConfidence = allGroupSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / allGroupSignals.length;
      
      const sources = [...new Set(allGroupSignals.map(s => ({
        id: s.source_id,
        name: s.sources?.name || 'Unknown'
      })))];

      await supabase
        .from('signal_correlation_groups')
        .update({
          signal_count: allGroupSignals.length,
          avg_confidence: avgConfidence,
          sources_json: sources,
          updated_at: new Date().toISOString()
        })
        .eq('id', correlationGroupId);
        
    } else {
      // Create new correlation group
      isNewGroup = true;
      const allSignals = [...matchedSignals, newSignal];
      const avgConfidence = allSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / allSignals.length;
      
      // Get source info for new signal
      const { data: newSignalSource } = await supabase
        .from('sources')
        .select('name')
        .eq('id', newSignal.source_id)
        .single();
      
      const sources = [...new Set(allSignals.map(s => ({
        id: s.source_id,
        name: s.sources?.name || newSignalSource?.name || 'Unknown'
      })))];

      const { data: newGroup, error: groupError } = await supabase
        .from('signal_correlation_groups')
        .insert({
          primary_signal_id: newSignal.id,
          category: newSignal.category,
          severity: newSignal.severity,
          location: newSignal.location,
          normalized_text: newSignal.normalized_text,
          signal_count: allSignals.length,
          avg_confidence: avgConfidence,
          sources_json: sources
        })
        .select()
        .single();

      if (groupError || !newGroup) {
        console.error('Error creating correlation group:', groupError);
        return new Response(
          JSON.stringify({ error: 'Failed to create correlation group' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      correlationGroupId = newGroup.id;
      console.log('Created new correlation group:', correlationGroupId);
      
      // Mark all similar signals as part of this group
      await supabase
        .from('signals')
        .update({ 
          correlation_group_id: correlationGroupId,
          correlated_count: allSignals.length 
        })
        .in('id', similarSignalIds);
    }

    // Update the new signal
    const avgSimilarity = similarSignals.reduce((sum, s) => sum + s.similarity_score, 0) / similarSignals.length;
    const boostedConfidence = Math.min(1, (newSignal.confidence || 0.5) * (1 + (similarSignals.length * 0.1)));

    await supabase
      .from('signals')
      .update({
        correlation_group_id: correlationGroupId,
        is_primary_signal: isNewGroup,
        correlated_count: similarSignals.length + 1,
        correlation_confidence: avgSimilarity / 100,
        confidence: boostedConfidence
      })
      .eq('id', signal_id);

    console.log(`Signal correlated successfully. Group: ${correlationGroupId}, Matched: ${similarSignals.length}, Boosted confidence: ${boostedConfidence.toFixed(2)}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        correlated: true,
        correlation_group_id: correlationGroupId,
        matched_signals: similarSignals.length,
        new_confidence: boostedConfidence,
        similarity_scores: similarSignals
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in correlate-signals:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});