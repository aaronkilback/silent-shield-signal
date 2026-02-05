import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Generating learning context from historical data...');

    // 1. Get approved entity suggestions (successful extractions)
    const { data: approvedSuggestions, error: suggestionsError } = await supabase
      .from('entity_suggestions')
      .select('suggested_name, suggested_type, context, confidence, source_type')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(100);

    if (suggestionsError) throw suggestionsError;

    // 2. Get false positive signals (to learn what NOT to flag)
    const { data: falsePositives, error: fpError } = await supabase
      .from('incident_outcomes')
      .select(`
        incident_id,
        incidents!inner(signal_id, signals!inner(normalized_text, category, severity))
      `)
      .eq('false_positive', true)
      .limit(50);

    if (fpError) throw fpError;

    // 3. Get accurate incidents (to learn what patterns work)
    const { data: accurateIncidents, error: accurateError } = await supabase
      .from('incident_outcomes')
      .select(`
        incident_id,
        incidents!inner(signal_id, signals!inner(normalized_text, category, severity))
      `)
      .eq('was_accurate', true)
      .limit(50);

    if (accurateError) throw accurateError;

    // 4. Get positively rated entity relationships
    const { data: goodRelationships, error: relError } = await supabase
      .from('entity_relationships')
      .select(`
        relationship_type,
        description,
        entity_a:entity_a_id(name, type),
        entity_b:entity_b_id(name, type)
      `)
      .gte('feedback_rating', 4)
      .limit(50);

    if (relError) throw relError;

    // 5. Get highly rated entity content
    const { data: goodContent, error: contentError } = await supabase
      .from('entity_content')
      .select('entity_id, content_type, title, excerpt, relevance_score, entities!inner(name, type)')
      .gte('feedback_rating', 4)
      .limit(30);

    if (contentError) throw contentError;

    // 6. Calculate source reliability
    const { data: reliability, error: reliabilityError } = await supabase
      .from('source_reliability_metrics')
      .select('source_name, reliability_score, total_signals, false_positives')
      .order('reliability_score', { ascending: false });

    if (reliabilityError) throw reliabilityError;

    // Build learning examples
    const learningExamples = {
      successfulEntityExtractions: approvedSuggestions?.map(s => ({
        name: s.suggested_name,
        type: s.suggested_type,
        context: s.context,
        confidence: s.confidence
      })) || [],
      
      falsePositivePatterns: falsePositives?.map((fp: any) => ({
        text: fp.incidents?.signals?.normalized_text,
        category: fp.incidents?.signals?.category,
        why_false: 'User marked as false positive'
      })) || [],
      
      accurateSignalPatterns: accurateIncidents?.map((inc: any) => ({
        text: inc.incidents?.signals?.normalized_text,
        category: inc.incidents?.signals?.category,
        severity: inc.incidents?.signals?.severity
      })) || [],
      
      validatedRelationships: goodRelationships?.map((rel: any) => ({
        type: rel.relationship_type,
        entity_a: `${rel.entity_a?.name} (${rel.entity_a?.type})`,
        entity_b: `${rel.entity_b?.name} (${rel.entity_b?.type})`,
        description: rel.description
      })) || [],
      
      relevantContent: goodContent?.map((c: any) => ({
        entity: `${c.entities?.name} (${c.entities?.type})`,
        content_type: c.content_type,
        title: c.title,
        relevance: c.relevance_score
      })) || [],
      
      sourceReliability: reliability?.map(s => ({
        source: s.source_name,
        score: s.reliability_score,
        total: s.total_signals,
        false_positives: s.false_positives
      })) || []
    };

    // Calculate improvement metrics
    const totalApproved = approvedSuggestions?.length || 0;
    const totalFalsePositives = falsePositives?.length || 0;
    const totalAccurate = accurateIncidents?.length || 0;
    const avgConfidence = approvedSuggestions?.reduce((sum, s) => sum + (s.confidence || 0), 0) / totalApproved || 0;

    const metrics = {
      approved_suggestions: totalApproved,
      false_positive_incidents: totalFalsePositives,
      accurate_incidents: totalAccurate,
      avg_approved_confidence: avgConfidence,
      accuracy_rate: totalAccurate / (totalAccurate + totalFalsePositives) || 0,
      validated_relationships: goodRelationships?.length || 0,
      highly_rated_content: goodContent?.length || 0
    };

    // Generate improvement recommendations
    const recommendations = [];
    
    if (metrics.false_positive_incidents > metrics.accurate_incidents) {
      recommendations.push({
        area: 'Signal Detection',
        issue: 'High false positive rate',
        action: 'Increase confidence threshold or refine detection patterns'
      });
    }

    if (metrics.avg_approved_confidence < 0.7) {
      recommendations.push({
        area: 'Entity Extraction',
        issue: 'Low confidence in approved entities',
        action: 'Review and improve entity extraction prompts'
      });
    }

    const unreliableSources = reliability?.filter(s => s.reliability_score < 0.5) || [];
    if (unreliableSources.length > 0) {
      recommendations.push({
        area: 'Source Management',
        issue: `${unreliableSources.length} sources with low reliability`,
        action: 'Review or disable unreliable sources',
        sources: unreliableSources.map(s => s.source_name)
      });
    }

    console.log(`Generated learning context: ${totalApproved} approved extractions, ${totalAccurate} accurate incidents`);

    return successResponse({
      success: true,
      learningExamples,
      metrics,
      recommendations,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating learning context:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
