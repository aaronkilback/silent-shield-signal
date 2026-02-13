import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { objectType, objectId, feedback, notes, userId, correction, feedbackContext, sourceFunction } = await req.json();
    
    const supabase = createServiceClient();

    console.log(`Processing ${feedback} feedback for ${objectType} ${objectId}`);

    // Store feedback event with enriched context
    const { data: feedbackEvent, error: feedbackError } = await supabase
      .from('feedback_events')
      .insert({
        object_type: objectType,
        object_id: objectId,
        feedback,
        user_id: userId,
        notes,
        correction,
        source_function: sourceFunction,
        feedback_context: feedbackContext || {},
      })
      .select('id')
      .single();

    if (feedbackError) throw feedbackError;

    // Route to type-specific handler
    const learningActions: string[] = [];

    switch (objectType) {
      case 'signal':
        await handleSignalFeedback(supabase, objectId, feedback);
        learningActions.push(...await updateSignalLearning(supabase, objectId, feedback, feedbackContext));
        break;

      case 'incident':
        await handleIncidentFeedback(supabase, objectId, feedback);
        learningActions.push(...await updateIncidentLearning(supabase, objectId, feedback));
        break;

      case 'entity':
        await handleEntityFeedback(supabase, objectId, feedback);
        break;

      case 'entity_suggestion':
        await handleEntitySuggestionFeedback(supabase, objectId, feedback);
        break;

      case 'daily_briefing':
        learningActions.push(...await updateBriefingLearning(supabase, objectId, feedback, feedbackContext, correction));
        break;

      case 'report':
        learningActions.push(...await updateReportLearning(supabase, objectId, feedback, feedbackContext, correction));
        break;

      case 'travel_alert':
        learningActions.push(...await updateTravelAlertLearning(supabase, objectId, feedback, feedbackContext));
        break;

      case 'audio_briefing':
        learningActions.push(...await updateAudioBriefingLearning(supabase, objectId, feedback, feedbackContext));
        break;

      case 'entity_photo':
        learningActions.push(...await updateEntityPhotoLearning(supabase, objectId, feedback));
        break;

      default:
        // Generic learning — still extract patterns
        learningActions.push(...await updateGenericLearning(supabase, objectType, objectId, feedback, feedbackContext));
        break;
    }

    // ── Cross-domain learning propagation ──
    if (objectType === 'signal' && feedbackContext?.category) {
      const crossDomainActions = await propagateCrossDomainLearning(supabase, feedbackContext.category as string, feedback);
      learningActions.push(...crossDomainActions);
    }

    // Log learning actions
    if (feedbackEvent?.id && learningActions.length > 0) {
      await supabase.from('universal_learning_log').insert({
        feedback_event_id: feedbackEvent.id,
        object_type: objectType,
        learning_action: learningActions.join(', '),
        profile_types_updated: learningActions,
        details: { feedback, correction: correction || null, context: feedbackContext || null },
      });
    }

    console.log(`Feedback processed: ${objectType}/${objectId} → ${learningActions.length} learning actions`);

    return successResponse({ success: true, learning_actions: learningActions });

  } catch (error) {
    console.error('Error in process-feedback:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

// ═══════════════════════════════════════════════════════════
// OBJECT-SPECIFIC HANDLERS
// ═══════════════════════════════════════════════════════════

async function handleSignalFeedback(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string) {
  const updates: Record<string, unknown> = {};
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
  if (Object.keys(updates).length > 0) {
    await supabase.from('signals').update(updates).eq('id', objectId);
  }
}

async function handleIncidentFeedback(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string) {
  if (feedback === 'irrelevant') {
    await supabase.from('incidents').update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    }).eq('id', objectId);
  }
}

async function handleEntityFeedback(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string) {
  if (feedback === 'confirmed') {
    await supabase.from('entities').update({ entity_status: 'confirmed', confidence_score: 1.0 }).eq('id', objectId);
  } else if (feedback === 'rejected') {
    await supabase.from('entities').update({ entity_status: 'rejected', is_active: false }).eq('id', objectId);
  }
}

async function handleEntitySuggestionFeedback(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string) {
  const { data: suggestion } = await supabase.from('entity_suggestions').select('*').eq('id', objectId).single();
  if (suggestion) {
    await updateEntitySuggestionLearning(supabase, suggestion, feedback);
  }
}

// ═══════════════════════════════════════════════════════════
// UNIVERSAL LEARNING FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function updateSignalLearning(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string, context?: Record<string, unknown>): Promise<string[]> {
  const { data } = await supabase.from('signals').select('title, description, signal_type, severity_score, normalized_text, source_type, rule_category, category, source_id').eq('id', objectId).single();
  if (!data) return [];

  const text = `${data.title || ''} ${data.description || ''} ${data.normalized_text || ''}`.toLowerCase();
  const profileType = (feedback === 'relevant' || feedback === 'confirmed') ? 'approved_signal_patterns' : 'rejected_signal_patterns';
  
  const keywords = extractKeywords(text);
  
  // Enrich with contextual reason from the analyst
  const reason = context?.reason as string | undefined;
  if (reason) {
    keywords[`reason:${reason}`] = 3; // Weight reasons heavily
  }

  await upsertLearningProfile(supabase, profileType, keywords);

  const profiles: string[] = [profileType];

  // Source-specific learning
  if (data.source_type) {
    const sourceProfile = `source:${data.source_type}_${feedback === 'relevant' ? 'approved' : 'rejected'}`;
    await upsertLearningProfile(supabase, sourceProfile, keywords);
    profiles.push(`source:${data.source_type}`);
  }

  // Category-specific learning
  if (data.rule_category || data.category) {
    const cat = data.rule_category || data.category;
    const catFeatures: Record<string, number> = {
      [`${feedback}_count`]: 1,
      total_feedback: 1,
    };
    if (reason) catFeatures[`reason:${reason}`] = 1;
    await upsertLearningProfile(supabase, `category:${cat}`, catFeatures);
    profiles.push(`category:${cat}`);
  }

  // Reason-specific pattern tracking (e.g. "too many duplicates from this source")
  if (reason && feedback === 'irrelevant') {
    await upsertLearningProfile(supabase, `rejection_reason:${reason}`, {
      total: 1,
      ...(data.source_type ? { [`source:${data.source_type}`]: 1 } : {}),
      ...(data.category ? { [`category:${data.category}`]: 1 } : {}),
      ...extractKeywords(text),
    });
    profiles.push(`rejection_reason:${reason}`);
  }

  return profiles;
}

async function updateIncidentLearning(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string): Promise<string[]> {
  const { data } = await supabase.from('incidents').select('title, summary, incident_type, severity_level').eq('id', objectId).single();
  if (!data) return [];

  const text = `${data.title || ''} ${data.summary || ''}`.toLowerCase();
  const profileType = feedback === 'relevant' ? 'approved_incident_patterns' : 'rejected_incident_patterns';
  
  await upsertLearningProfile(supabase, profileType, extractKeywords(text));
  return [profileType];
}

async function updateBriefingLearning(
  supabase: ReturnType<typeof createServiceClient>, 
  objectId: string, 
  feedback: string, 
  context?: Record<string, unknown>,
  correction?: string
): Promise<string[]> {
  const profiles: string[] = [];
  
  // Track briefing quality preferences
  const features: Record<string, number> = {
    [`feedback_${feedback}`]: 1,
    total_briefing_feedback: 1,
  };

  // If context has specific sections rated
  if (context?.rated_section) {
    features[`section_${context.rated_section}_${feedback}`] = 1;
  }

  // Track what recipients like/dislike about briefings
  if (context?.too_long) features['complaint_too_long'] = 1;
  if (context?.too_short) features['complaint_too_short'] = 1;
  if (context?.not_relevant) features['complaint_not_relevant'] = 1;
  if (context?.too_technical) features['complaint_too_technical'] = 1;
  if (context?.missing_info) features['complaint_missing_info'] = 1;

  // Store correction text as a negative pattern
  if (correction && (feedback === 'negative' || feedback === 'irrelevant')) {
    features[`correction_provided`] = 1;
  }

  await upsertLearningProfile(supabase, 'briefing_quality', features);
  profiles.push('briefing_quality');

  // Track positive briefing patterns to replicate
  if (feedback === 'positive' || feedback === 'relevant') {
    await upsertLearningProfile(supabase, 'approved_briefing_patterns', {
      good_briefing_count: 1,
      ...(context?.date ? { [`date:${context.date}`]: 1 } : {}),
    });
    profiles.push('approved_briefing_patterns');
  } else {
    await upsertLearningProfile(supabase, 'rejected_briefing_patterns', {
      bad_briefing_count: 1,
      ...(context?.date ? { [`date:${context.date}`]: 1 } : {}),
    });
    profiles.push('rejected_briefing_patterns');
  }

  return profiles;
}

async function updateReportLearning(
  supabase: ReturnType<typeof createServiceClient>,
  objectId: string,
  feedback: string,
  context?: Record<string, unknown>,
  correction?: string
): Promise<string[]> {
  const features: Record<string, number> = {
    [`feedback_${feedback}`]: 1,
    total_report_feedback: 1,
  };

  if (context?.report_type) {
    features[`type_${context.report_type}_${feedback}`] = 1;
  }

  await upsertLearningProfile(supabase, 'report_quality', features);
  return ['report_quality'];
}

async function updateTravelAlertLearning(
  supabase: ReturnType<typeof createServiceClient>,
  objectId: string,
  feedback: string,
  context?: Record<string, unknown>
): Promise<string[]> {
  const features: Record<string, number> = {
    [`feedback_${feedback}`]: 1,
    total_travel_alert_feedback: 1,
  };

  // Track alert type accuracy
  if (context?.alert_type) {
    features[`alert_type_${context.alert_type}_${feedback}`] = 1;
  }

  // Track destination accuracy
  if (context?.destination) {
    features[`dest_${String(context.destination).toLowerCase().replace(/\s+/g, '_')}_${feedback}`] = 1;
  }

  await upsertLearningProfile(supabase, 'travel_alert_quality', features);

  // If irrelevant, suppress similar alerts in future
  if (feedback === 'irrelevant' && context?.alert_type) {
    await upsertLearningProfile(supabase, 'rejected_travel_alert_patterns', {
      [`type:${context.alert_type}`]: 1,
      ...(context?.destination ? { [`dest:${context.destination}`]: 1 } : {}),
    });
    return ['travel_alert_quality', 'rejected_travel_alert_patterns'];
  }

  return ['travel_alert_quality'];
}

async function updateAudioBriefingLearning(
  supabase: ReturnType<typeof createServiceClient>,
  objectId: string,
  feedback: string,
  context?: Record<string, unknown>
): Promise<string[]> {
  const features: Record<string, number> = {
    [`feedback_${feedback}`]: 1,
    total_audio_feedback: 1,
  };

  if (context?.too_long) features['complaint_too_long'] = 1;
  if (context?.too_short) features['complaint_too_short'] = 1;
  if (context?.unclear_audio) features['complaint_unclear_audio'] = 1;

  await upsertLearningProfile(supabase, 'audio_briefing_quality', features);
  return ['audio_briefing_quality'];
}

async function updateEntityPhotoLearning(
  supabase: ReturnType<typeof createServiceClient>,
  objectId: string,
  feedback: string
): Promise<string[]> {
  // Entity photos already have their own feedback_rating system
  // but we unify it into the learning profiles too
  const features: Record<string, number> = {
    [`feedback_${feedback}`]: 1,
    total_photo_feedback: 1,
  };

  await upsertLearningProfile(supabase, 'entity_photo_quality', features);
  return ['entity_photo_quality'];
}

async function updateGenericLearning(
  supabase: ReturnType<typeof createServiceClient>,
  objectType: string,
  objectId: string,
  feedback: string,
  context?: Record<string, unknown>
): Promise<string[]> {
  const profileType = `generic:${objectType}`;
  await upsertLearningProfile(supabase, profileType, {
    [`feedback_${feedback}`]: 1,
    total_feedback: 1,
  });
  return [profileType];
}

// ═══════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════

function extractKeywords(text: string): Record<string, number> {
  const words = text.split(/\s+/).filter(w => w.length > 3);
  const features: Record<string, number> = {};
  [...new Set(words)].slice(0, 20).forEach(kw => { features[kw] = 1; });
  return features;
}

async function upsertLearningProfile(
  supabase: ReturnType<typeof createServiceClient>,
  profileType: string,
  newFeatures: Record<string, number>
) {
  try {
    const { data: existing } = await supabase
      .from('learning_profiles')
      .select('*')
      .eq('profile_type', profileType)
      .single();

    if (existing) {
      const currentFeatures = (existing.features as Record<string, number>) || {};
      Object.entries(newFeatures).forEach(([key, value]) => {
        currentFeatures[key] = (currentFeatures[key] || 0) + value;
      });

      await supabase.from('learning_profiles').update({
        features: currentFeatures,
        sample_count: ((existing.sample_count as number) || 0) + 1,
        last_updated: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_profiles').insert({
        profile_type: profileType,
        features: newFeatures,
        sample_count: 1,
      });
    }
  } catch (error) {
    console.error(`Error upserting profile ${profileType}:`, error instanceof Error ? error.message : error);
  }
}

async function updateEntitySuggestionLearning(supabase: ReturnType<typeof createServiceClient>, suggestion: Record<string, unknown>, feedback: string) {
  try {
    const text = `${suggestion.suggested_name || ''} ${suggestion.context || ''} ${suggestion.suggested_type || ''}`.toLowerCase();
    const features = extractKeywords(text);
    if (suggestion.suggested_type) {
      features[`type:${String(suggestion.suggested_type).toLowerCase()}`] = 2;
    }

    const profileType = feedback === 'approved' ? 'approved_entity_patterns' : 'rejected_entity_patterns';
    await upsertLearningProfile(supabase, profileType, features);
  } catch (error) {
    console.error('Error updating entity learning:', error instanceof Error ? error.message : error);
  }
}

// ═══════════════════════════════════════════════════════════
// CROSS-DOMAIN LEARNING
// ═══════════════════════════════════════════════════════════

const RELATED_CATEGORIES: Record<string, string[]> = {
  'protest': ['civil_unrest', 'demonstration', 'strike'],
  'civil_unrest': ['protest', 'riot', 'demonstration'],
  'cyber_attack': ['data_breach', 'ransomware', 'cyber_threat'],
  'data_breach': ['cyber_attack', 'insider_threat'],
  'terrorism': ['extremism', 'bomb_threat', 'active_shooter'],
  'natural_disaster': ['earthquake', 'wildfire', 'flood', 'severe_weather'],
  'insider_threat': ['data_breach', 'sabotage', 'unauthorized_access'],
  'supply_chain': ['logistics_disruption', 'vendor_risk'],
};

async function propagateCrossDomainLearning(
  supabase: ReturnType<typeof createServiceClient>,
  category: string,
  feedback: string
): Promise<string[]> {
  const related = RELATED_CATEGORIES[category.toLowerCase()];
  if (!related || related.length === 0) return [];

  const profiles: string[] = [];
  const feedbackType = (feedback === 'relevant' || feedback === 'confirmed') ? 'positive' : 'negative';

  for (const relatedCat of related) {
    const profileType = `cross_domain:${relatedCat}`;
    await upsertLearningProfile(supabase, profileType, {
      [`from_${category}_${feedbackType}`]: 0.3, // 30% weight for cross-domain
      cross_domain_total: 1,
    });
    profiles.push(profileType);
  }

  return profiles;
}
