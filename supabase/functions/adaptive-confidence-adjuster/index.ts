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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Analyzing feedback to adjust confidence thresholds...');

    // Get entity suggestions with detailed information for learning
    const { data: suggestions, error: suggestionsError } = await supabase
      .from('entity_suggestions')
      .select('confidence, status, suggested_name, suggested_type, context, suggested_attributes')
      .in('status', ['approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (suggestionsError) throw suggestionsError;

    // Get incident outcomes
    const { data: outcomes, error: outcomesError } = await supabase
      .from('incident_outcomes')
      .select('was_accurate, false_positive')
      .order('created_at', { ascending: false })
      .limit(200);

    if (outcomesError) throw outcomesError;

    // Analyze rejected entities to extract patterns
    const rejectedEntities = suggestions?.filter(s => s.status === 'rejected') || [];
    const falsePositivePatterns = {
      commonNames: {} as Record<string, number>,
      commonTypes: {} as Record<string, number>,
      commonContextPhrases: {} as Record<string, number>,
      examples: [] as Array<{ name: string; type: string; context: string; confidence: number }>
    };

    rejectedEntities.forEach(entity => {
      // Count common entity names
      if (entity.suggested_name) {
        falsePositivePatterns.commonNames[entity.suggested_name.toLowerCase()] = 
          (falsePositivePatterns.commonNames[entity.suggested_name.toLowerCase()] || 0) + 1;
      }

      // Count common entity types
      if (entity.suggested_type) {
        falsePositivePatterns.commonTypes[entity.suggested_type] = 
          (falsePositivePatterns.commonTypes[entity.suggested_type] || 0) + 1;
      }

      // Extract common phrases from context
      if (entity.context) {
        const words = entity.context.toLowerCase().split(/\s+/);
        words.forEach((word: string) => {
          if (word.length > 4) { // Only meaningful words
            falsePositivePatterns.commonContextPhrases[word] = 
              (falsePositivePatterns.commonContextPhrases[word] || 0) + 1;
          }
        });
      }

      // Keep examples of false positives
      if (falsePositivePatterns.examples.length < 20) {
        falsePositivePatterns.examples.push({
          name: entity.suggested_name || 'Unknown',
          type: entity.suggested_type || 'Unknown',
          context: entity.context?.substring(0, 200) || 'No context',
          confidence: entity.confidence || 0
        });
      }
    });

    // Sort patterns by frequency
    const topFalsePositiveNames = Object.entries(falsePositivePatterns.commonNames)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    const topFalsePositiveTypes = Object.entries(falsePositivePatterns.commonTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    const topFalsePositivePhrases = Object.entries(falsePositivePatterns.commonContextPhrases)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([phrase, count]) => ({ phrase, count }));

    // Calculate accuracy by confidence bucket
    const confidenceBuckets: Record<string, { approved: number; rejected: number }> = {
      '0.6-0.7': { approved: 0, rejected: 0 },
      '0.7-0.8': { approved: 0, rejected: 0 },
      '0.8-0.9': { approved: 0, rejected: 0 },
      '0.9-1.0': { approved: 0, rejected: 0 }
    };

    suggestions?.forEach(s => {
      const conf = s.confidence || 0;
      let bucket = '';
      if (conf >= 0.6 && conf < 0.7) bucket = '0.6-0.7';
      else if (conf >= 0.7 && conf < 0.8) bucket = '0.7-0.8';
      else if (conf >= 0.8 && conf < 0.9) bucket = '0.8-0.9';
      else if (conf >= 0.9) bucket = '0.9-1.0';
      
      if (bucket && confidenceBuckets[bucket]) {
        if (s.status === 'approved') {
          confidenceBuckets[bucket].approved++;
        } else {
          confidenceBuckets[bucket].rejected++;
        }
      }
    });

    // Calculate accuracy rates
    const accuracyByBucket = Object.entries(confidenceBuckets).map(([bucket, counts]) => {
      const total = counts.approved + counts.rejected;
      const accuracy = total > 0 ? counts.approved / total : 0;
      return {
        bucket,
        accuracy,
        total,
        approved: counts.approved,
        rejected: counts.rejected
      };
    });

    // Calculate overall incident accuracy
    const totalIncidents = outcomes?.length || 0;
    const accurateIncidents = outcomes?.filter(o => o.was_accurate).length || 0;
    const falsePositives = outcomes?.filter(o => o.false_positive).length || 0;
    const incidentAccuracy = totalIncidents > 0 ? accurateIncidents / totalIncidents : 0;
    const falsePositiveRate = totalIncidents > 0 ? falsePositives / totalIncidents : 0;

    // Determine recommended threshold
    let recommendedThreshold = 0.6;
    let reason = 'Default threshold';

    // If we have enough data, adjust based on accuracy
    const totalSuggestions = suggestions?.length || 0;
    if (totalSuggestions >= 50) {
      // Find the lowest threshold with >80% accuracy
      for (const bucket of accuracyByBucket.reverse()) {
        if (bucket.accuracy >= 0.8 && bucket.total >= 10) {
          const [low] = bucket.bucket.split('-').map(parseFloat);
          recommendedThreshold = low;
          reason = `${bucket.accuracy.toFixed(1)}% accuracy at ${bucket.bucket} confidence`;
          break;
        }
      }
    }

    // Adjust for high false positive rate
    if (falsePositiveRate > 0.3 && recommendedThreshold < 0.7) {
      recommendedThreshold = 0.7;
      reason = `Increased due to ${(falsePositiveRate * 100).toFixed(1)}% false positive rate`;
    }

    // Adjust for low incident accuracy
    if (incidentAccuracy < 0.6 && recommendedThreshold < 0.75) {
      recommendedThreshold = 0.75;
      reason = `Increased due to ${(incidentAccuracy * 100).toFixed(1)}% incident accuracy`;
    }

    const recommendations = {
      current_threshold: 0.6,
      recommended_threshold: recommendedThreshold,
      reason,
      confidence_analysis: accuracyByBucket.reverse(),
      incident_metrics: {
        total: totalIncidents,
        accurate: accurateIncidents,
        false_positives: falsePositives,
        accuracy_rate: incidentAccuracy,
        false_positive_rate: falsePositiveRate
      },
      suggestion_metrics: {
        total: totalSuggestions,
        approved: suggestions?.filter(s => s.status === 'approved').length || 0,
        rejected: suggestions?.filter(s => s.status === 'rejected').length || 0
      },
      false_positive_patterns: {
        top_names: topFalsePositiveNames,
        top_types: topFalsePositiveTypes,
        top_context_phrases: topFalsePositivePhrases,
        examples: falsePositivePatterns.examples
      },
      learning_guidance: generateLearningGuidance(
        topFalsePositiveNames,
        topFalsePositiveTypes,
        topFalsePositivePhrases,
        falsePositivePatterns.examples,
        falsePositiveRate
      )
    };

    function generateLearningGuidance(
      names: Array<{ name: string; count: number }>,
      types: Array<{ type: string; count: number }>,
      phrases: Array<{ phrase: string; count: number }>,
      examples: Array<{ name: string; type: string; context: string; confidence: number }>,
      fpRate: number
    ): string {
      let guidance = '';

      if (names.length > 0) {
        guidance += `\n⚠️ FREQUENTLY REJECTED ENTITY NAMES (avoid extracting these):\n`;
        names.slice(0, 10).forEach(({ name, count }) => {
          guidance += `  - "${name}" (rejected ${count} times)\n`;
        });
      }

      if (types.length > 0) {
        guidance += `\n⚠️ ENTITY TYPES WITH HIGH FALSE POSITIVE RATES:\n`;
        types.forEach(({ type, count }) => {
          guidance += `  - ${type} (${count} false positives) - Be more conservative\n`;
        });
      }

      if (phrases.length > 0) {
        guidance += `\n⚠️ CONTEXT PHRASES ASSOCIATED WITH FALSE POSITIVES (be cautious when these appear):\n`;
        phrases.slice(0, 15).forEach(({ phrase, count }) => {
          guidance += `  - "${phrase}" (appeared in ${count} false positives)\n`;
        });
      }

      if (examples.length > 0) {
        guidance += `\n❌ EXAMPLES OF REJECTED ENTITIES TO AVOID:\n`;
        examples.slice(0, 5).forEach(({ name, type, context, confidence }) => {
          guidance += `  - Name: "${name}", Type: ${type}, Confidence: ${confidence.toFixed(2)}\n`;
          guidance += `    Context: "${context}"\n`;
        });
      }

      if (fpRate > 0.2) {
        guidance += `\n🔴 HIGH FALSE POSITIVE RATE (${(fpRate * 100).toFixed(1)}%):\n`;
        guidance += `  - Increase confidence thresholds significantly\n`;
        guidance += `  - Be extremely selective about entity extraction\n`;
        guidance += `  - Focus on explicit mentions with strong evidence\n`;
      }

      return guidance;
    }

    console.log(`Recommended threshold: ${recommendedThreshold} (${reason})`);

    return new Response(
      JSON.stringify({
        success: true,
        recommendations,
        analyzed_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error adjusting confidence thresholds:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
