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

    // Actively learn from irrelevant feedback — extract title/location patterns to suppress future similar signals
    try {
      const { data: signal } = await supabase
        .from('signals')
        .select('title, location, signal_type, category, normalized_text, source_id')
        .eq('id', objectId)
        .single();

      if (signal) {
        // Extract suppression patterns from the rejected signal
        const titleWords = (signal.title || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
        const locationStr = (signal.location || '').toLowerCase().trim();
        
        // Build a location-based suppression pattern if location is outside client area
        const clientRelevantLocations = ['fort st. john', 'dawson creek', 'prince george', 'kitimat', 'terrace', 'northeast bc', 'ne bc', 'coastal gaslink', 'lng canada', 'pipeline'];
        const isOutsideClientArea = locationStr && !clientRelevantLocations.some(loc => locationStr.includes(loc));
        
        if (isOutsideClientArea || titleWords.length > 2) {
          const suppressionFeatures: Record<string, number> = {};
          if (isOutsideClientArea) suppressionFeatures[`location:${locationStr}`] = 3;
          titleWords.slice(0, 10).forEach((w: string) => { suppressionFeatures[w] = 1; });
          if (signal.signal_type) suppressionFeatures[`type:${signal.signal_type}`] = 1;
          
          await upsertLearningProfile(supabase, 'rejected_signal_patterns', suppressionFeatures);
          console.log(`[FeedbackLearning] Extracted suppression patterns from rejected signal: location=${locationStr}, keywords=${titleWords.slice(0, 5).join(',')}`);
        }
      }
    } catch (err) {
      console.error('[FeedbackLearning] Error extracting rejection patterns:', err);
    }
  } else if (feedback === 'too_minor') {
    updates.relevance_score = 0.3;
    updates.status = 'resolved';
  }
  if (Object.keys(updates).length > 0) {
    await supabase.from('signals').update(updates).eq('id', objectId);
  }

  // Update source_reliability_metrics so scoreSignalRelevance Phase 2 has data
  if (feedback === 'relevant' || feedback === 'irrelevant') {
    try {
      const { data: signal } = await supabase
        .from('signals')
        .select('source_id')
        .eq('id', objectId)
        .single();

      if (signal?.source_id) {
        const { data: src } = await supabase
          .from('sources')
          .select('name')
          .eq('id', signal.source_id)
          .single();

        if (src?.name) {
          const isAccurate = feedback === 'relevant';
          // Upsert: increment the relevant counter and recompute reliability_score
          const { data: existing } = await supabase
            .from('source_reliability_metrics')
            .select('total_signals, accurate_signals, false_positives')
            .eq('source_name', src.name)
            .maybeSingle();

          const total = (existing?.total_signals ?? 0) + 1;
          const accurate = (existing?.accurate_signals ?? 0) + (isAccurate ? 1 : 0);
          const fp = (existing?.false_positives ?? 0) + (isAccurate ? 0 : 1);
          const reliability = total > 0 ? accurate / total : 0.5;

          await supabase.from('source_reliability_metrics').upsert({
            source_name: src.name,
            total_signals: total,
            accurate_signals: accurate,
            false_positives: fp,
            reliability_score: reliability,
            last_updated: new Date().toISOString(),
          }, { onConflict: 'source_name' });

          // ═══ PHASE 2 CONNECTION: also update source_credibility_scores ═══
          // ai-decision-engine composite gate reads from source_credibility_scores.
          // Signal feedback must update this table too, or signal-level learning
          // never reaches the incident creation threshold.
          // Bayesian update: accurate → score rises toward 0.98; inaccurate → falls toward 0.05
          try {
            const { data: existingCred } = await supabase
              .from('source_credibility_scores')
              .select('current_credibility, total_signals, confirmed_signals, refuted_signals')
              .eq('source_key', src.name)
              .maybeSingle();

            const oldCred = existingCred?.current_credibility ?? 0.65;
            const newCred = isAccurate
              ? Math.min(0.98, oldCred + (1 - oldCred) * 0.15)
              : Math.max(0.05, oldCred - oldCred * 0.20);
            const credTotal = (existingCred?.total_signals ?? 0) + 1;
            const credConfirmed = (existingCred?.confirmed_signals ?? 0) + (isAccurate ? 1 : 0);
            const credRefuted = (existingCred?.refuted_signals ?? 0) + (isAccurate ? 0 : 1);

            await supabase.from('source_credibility_scores').upsert({
              source_key: src.name,
              prior_credibility: existingCred?.current_credibility ?? 0.65,
              current_credibility: Math.round(newCred * 1000) / 1000,
              total_signals: credTotal,
              confirmed_signals: credConfirmed,
              refuted_signals: credRefuted,
              last_updated_at: new Date().toISOString(),
            }, { onConflict: 'source_key' });

            console.log(`[Phase2] source_credibility_scores updated for ${src.name}: ${oldCred.toFixed(3)} → ${newCred.toFixed(3)}`);
          } catch (credErr) {
            console.error('[Phase2] Failed to update source_credibility_scores:', credErr);
            // Non-blocking — source_reliability_metrics update succeeded, this is additive
          }

          console.log(`[SourceReliability] Updated ${src.name}: reliability=${reliability.toFixed(2)} (${accurate}/${total})`);
        }
      }
    } catch (err) {
      console.error('[SourceReliability] Error updating source metrics:', err);
    }
  }
}

async function handleIncidentFeedback(supabase: ReturnType<typeof createServiceClient>, objectId: string, feedback: string) {
  if (feedback === 'irrelevant') {
    await supabase.from('incidents').update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    }).eq('id', objectId);
  }

  // Record incident outcome so calibrate_analyst_accuracy() has data to work with
  try {
    const isFalsePositive = feedback === 'irrelevant' || feedback === 'false_positive';
    const wasAccurate = feedback === 'relevant' || feedback === 'confirmed';
    const outcomeType = feedback === 'irrelevant' ? 'false_alarm'
                      : feedback === 'relevant'   ? 'mitigated'
                      : feedback === 'confirmed'  ? 'contained'
                      : 'dismissed';

    await supabase.from('incident_outcomes').insert({
      incident_id: objectId,
      outcome_type: outcomeType,
      was_accurate: wasAccurate,
      false_positive: isFalsePositive,
    });

    // Recalibrate analyst accuracy weights now that we have new outcome data
    await supabase.rpc('calibrate_analyst_accuracy');
    console.log(`[FeedbackLoop] Recorded incident outcome (${outcomeType}) and recalibrated analyst accuracy`);

    // Phase 3D: Update learning profiles from incident outcomes
    // False positive closures reinforce rejected_signal_patterns.
    // Legitimate incident closures reinforce approved_signal_patterns.
    // This means the AI has real-world outcome validation, not just analyst opinion.
    try {
      const { data: incidentData } = await supabase
        .from('incidents')
        .select('signal_id, category')
        .eq('id', objectId)
        .maybeSingle();

      const linkedSignalId = incidentData?.signal_id;
      if (linkedSignalId) {
        const { data: signal } = await supabase
          .from('signals')
          .select('normalized_text, category, entity_tags')
          .eq('id', linkedSignalId)
          .maybeSingle();

        if (signal?.normalized_text) {
          const text = signal.normalized_text.toLowerCase();
          const words = text.split(/\s+/).filter((w: string) => w.length > 4);
          const keywords: Record<string, number> = {};
          words.slice(0, 15).forEach((w: string) => { keywords[w] = 1; });
          const cat = signal.category || incidentData?.category;
          if (cat) keywords[`category:${cat}`] = 3;
          (signal.entity_tags || []).forEach((tag: string) => {
            keywords[`entity:${tag.toLowerCase()}`] = 2;
          });

          const profileType = isFalsePositive
            ? 'rejected_signal_patterns'
            : 'approved_signal_patterns';
          await upsertLearningProfile(supabase, profileType, keywords);
          console.log(`[Phase3D] Updated ${profileType} from incident outcome (${outcomeType})`);
        }
      }
    } catch (learningErr) {
      // Non-blocking — outcome already recorded, learning is additive
      console.error('[Phase3D] Learning profile update failed:', learningErr);
    }
  } catch (err) {
    console.error('[FeedbackLoop] Error recording incident outcome:', err);
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
  const { data } = await supabase.from('signals').select('title, description, signal_type, severity_score, normalized_text, rule_category, category, source_id').eq('id', objectId).single();
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

  // Source-specific learning via source_id → sources table
  if (data.source_id) {
    const { data: sourceData } = await supabase.from('sources').select('type').eq('id', data.source_id).maybeSingle();
    const sourceType = sourceData?.type || 'unknown';
    const sourceProfile = `source:${sourceType}_${feedback === 'relevant' ? 'approved' : 'rejected'}`;
    await upsertLearningProfile(supabase, sourceProfile, keywords);
    profiles.push(`source:${sourceType}`);
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
      ...(data.source_id ? { [`source:${data.source_id}`]: 1 } : {}),
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
  'protest': ['civil_unrest', 'demonstration', 'strike', 'blockade', 'occupation'],
  'civil_unrest': ['protest', 'riot', 'demonstration', 'coup', 'revolution'],
  'cyber_attack': ['data_breach', 'ransomware', 'cyber_threat', 'ddos', 'malware'],
  'data_breach': ['cyber_attack', 'insider_threat', 'credential_leak', 'exfiltration'],
  'terrorism': ['extremism', 'bomb_threat', 'active_shooter', 'radicalization', 'lone_wolf'],
  'natural_disaster': ['earthquake', 'wildfire', 'flood', 'severe_weather', 'tsunami', 'hurricane'],
  'insider_threat': ['data_breach', 'sabotage', 'unauthorized_access', 'espionage', 'fraud'],
  'supply_chain': ['logistics_disruption', 'vendor_risk', 'third_party_breach', 'counterfeit'],
  'ransomware': ['cyber_attack', 'data_breach', 'extortion', 'malware'],
  'phishing': ['social_engineering', 'credential_theft', 'spear_phishing', 'business_email_compromise'],
  'espionage': ['insider_threat', 'state_actor', 'intellectual_property_theft', 'surveillance'],
  'financial_crime': ['fraud', 'money_laundering', 'sanctions_evasion', 'embezzlement'],
  'disinformation': ['influence_operation', 'deepfake', 'propaganda', 'reputation_attack'],
  'physical_security': ['sabotage', 'trespass', 'vandalism', 'assault', 'stalking'],
  'geopolitical': ['sanctions', 'trade_war', 'diplomatic_crisis', 'armed_conflict'],
  'reputational_risk': ['boycott', 'scandal', 'litigation', 'regulatory_action', 'media_crisis'],
  'environmental': ['oil_spill', 'contamination', 'regulatory_violation', 'climate_activism'],
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
