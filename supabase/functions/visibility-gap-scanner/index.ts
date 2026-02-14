/**
 * Visibility Gap Scanner
 * 
 * Closes intelligence coverage gaps by:
 * 1. Supply chain monitoring — uses client.supply_chain_entities
 * 2. CISA KEV feed ingestion — auto-ingest known exploited vulnerabilities  
 * 3. Insider threat cross-referencing — correlates auth anomalies with signals
 * 4. Confidence calibration — tracks prediction accuracy over time
 * 5. Cross-domain learning — feedback in one category influences related categories
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

// Related category mapping for cross-domain learning
const RELATED_CATEGORIES: Record<string, string[]> = {
  'protest': ['civil_unrest', 'demonstration', 'strike', 'social_movement'],
  'civil_unrest': ['protest', 'riot', 'demonstration', 'political_instability'],
  'cyber_attack': ['data_breach', 'ransomware', 'phishing', 'cyber_threat'],
  'data_breach': ['cyber_attack', 'insider_threat', 'information_leak'],
  'terrorism': ['extremism', 'radicalization', 'bomb_threat', 'active_shooter'],
  'natural_disaster': ['earthquake', 'wildfire', 'flood', 'severe_weather'],
  'fraud': ['financial_crime', 'embezzlement', 'money_laundering'],
  'insider_threat': ['data_breach', 'sabotage', 'espionage', 'unauthorized_access'],
  'supply_chain': ['logistics_disruption', 'vendor_risk', 'trade_disruption'],
  'political_instability': ['civil_unrest', 'regime_change', 'sanctions'],
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const results: Record<string, unknown> = {};

    console.log('[VisibilityGap] Starting comprehensive visibility gap scan...');

    // ═══════════════════════════════════════════════════════════
    // MODULE 1: Supply Chain Monitoring
    // ═══════════════════════════════════════════════════════════

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, supply_chain_entities, monitoring_keywords')
      .eq('status', 'active');

    let supplyChainGaps = 0;
    const supplyChainAlerts: Array<{ client: string; entity: string; issue: string }> = [];

    for (const client of (clients || [])) {
      const entities = client.supply_chain_entities || [];
      if (entities.length === 0) continue;

      // Check if we have recent signals mentioning supply chain entities
      for (const entity of entities) {
        const { data: mentions, error } = await supabase
          .from('signals')
          .select('id')
          .eq('client_id', client.id)
          .ilike('normalized_text', `%${entity}%`)
          .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
          .limit(1);

        if (!error && (!mentions || mentions.length === 0)) {
          supplyChainGaps++;
          supplyChainAlerts.push({
            client: client.name,
            entity,
            issue: 'No signals detected in 30 days — potential blind spot',
          });
        }
      }
    }

    results.supply_chain = {
      clients_scanned: (clients || []).length,
      gaps_found: supplyChainGaps,
      alerts: supplyChainAlerts.slice(0, 20),
    };

    console.log(`[VisibilityGap] Supply chain: ${supplyChainGaps} gaps across ${(clients || []).length} clients`);

    // ═══════════════════════════════════════════════════════════
    // MODULE 2: CISA KEV Feed Ingestion
    // ═══════════════════════════════════════════════════════════

    let kevIngested = 0;
    try {
      const kevResponse = await fetch(CISA_KEV_URL, {
        headers: { 'Accept': 'application/json' },
      });

      if (kevResponse.ok) {
        const kevData = await kevResponse.json();
        const recentVulns = (kevData.vulnerabilities || [])
          .filter((v: any) => {
            const addedDate = new Date(v.dateAdded);
            return Date.now() - addedDate.getTime() < 7 * 86400000; // Last 7 days
          })
          .slice(0, 20);

        for (const vuln of recentVulns) {
          // Check if we already have this CVE
          const { data: existing } = await supabase
            .from('signals')
            .select('id')
            .eq('source_type', 'cisa_kev')
            .ilike('normalized_text', `%${vuln.cveID}%`)
            .limit(1);

          if (!existing || existing.length === 0) {
            const { error } = await supabase.from('signals').insert({
              title: `CISA KEV: ${vuln.cveID} — ${vuln.vulnerabilityName || 'Unknown'}`,
              normalized_text: `Known Exploited Vulnerability ${vuln.cveID}. ${vuln.vulnerabilityName || ''}. Vendor: ${vuln.vendorProject || 'Unknown'}. Product: ${vuln.product || 'Unknown'}. ${vuln.shortDescription || ''}. Required action: ${vuln.requiredAction || 'Patch immediately'}. Due date: ${vuln.dueDate || 'ASAP'}.`,
              signal_type: 'cyber',
              category: 'cybersecurity',
              severity: 'high',
              confidence: 1.0,
              relevance_score: 0.9,
              status: 'new',
              raw_json: { cve: vuln.cveID, vendor: vuln.vendorProject, product: vuln.product, date_added: vuln.dateAdded, source_url: `https://nvd.nist.gov/vuln/detail/${vuln.cveID}` },
            });

            if (!error) kevIngested++;
          }
        }
      }
    } catch (e) {
      console.error('[VisibilityGap] CISA KEV fetch error:', e);
    }

    results.cisa_kev = { vulnerabilities_ingested: kevIngested };
    console.log(`[VisibilityGap] CISA KEV: ${kevIngested} new vulnerabilities ingested`);

    // ═══════════════════════════════════════════════════════════
    // MODULE 3: Insider Threat Cross-Reference
    // ═══════════════════════════════════════════════════════════

    // Check for anomalous patterns from cyber sentinel
    const { data: recentTripwires } = await supabase
      .from('autonomous_scan_results')
      .select('findings, created_at, risk_score')
      .eq('agent_call_sign', 'CYBER-SENTINEL')
      .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
      .order('risk_score', { ascending: false })
      .limit(10);

    const insiderRiskIndicators: string[] = [];
    for (const scan of (recentTripwires || [])) {
      const findings = scan.findings as any;
      if (findings?.brute_force_detected || findings?.credential_stuffing) {
        insiderRiskIndicators.push(`Auth anomaly detected (risk: ${scan.risk_score}) at ${scan.created_at}`);
      }
      if (findings?.unusual_access_patterns) {
        insiderRiskIndicators.push(`Unusual access pattern: ${JSON.stringify(findings.unusual_access_patterns).substring(0, 200)}`);
      }
    }

    results.insider_threat = {
      scans_reviewed: (recentTripwires || []).length,
      risk_indicators: insiderRiskIndicators,
    };

    // ═══════════════════════════════════════════════════════════
    // MODULE 4: Confidence Calibration
    // ═══════════════════════════════════════════════════════════

    // Track how well our predictions match outcomes
    const { data: predictions } = await supabase
      .from('predictive_incident_scores')
      .select('signal_id, escalation_probability, predicted_severity, scored_at')
      .gte('scored_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .limit(500);

    const { data: actualIncidents } = await supabase
      .from('incidents')
      .select('signal_id, priority, status')
      .gte('opened_at', new Date(Date.now() - 30 * 86400000).toISOString());

    const incidentSignalIds = new Set((actualIncidents || []).map(i => i.signal_id).filter(Boolean));
    
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const pred of (predictions || [])) {
      const predicted = pred.escalation_probability >= 0.5;
      const actual = incidentSignalIds.has(pred.signal_id);
      
      if (predicted && actual) truePositives++;
      else if (predicted && !actual) falsePositives++;
      else if (!predicted && actual) falseNegatives++;
    }

    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    // Store calibration metrics
    await supabase.from('learning_profiles').upsert({
      profile_type: 'confidence_calibration',
      features: {
        precision: Math.round(precision * 1000) / 1000,
        recall: Math.round(recall * 1000) / 1000,
        f1_score: Math.round(f1Score * 1000) / 1000,
        true_positives: truePositives,
        false_positives: falsePositives,
        false_negatives: falseNegatives,
        total_predictions: (predictions || []).length,
        calibrated_at: new Date().toISOString(),
      },
      sample_count: (predictions || []).length,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'profile_type' });

    results.confidence_calibration = {
      predictions_analyzed: (predictions || []).length,
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1_score: Math.round(f1Score * 100) / 100,
    };

    console.log(`[VisibilityGap] Confidence: precision=${precision.toFixed(2)}, recall=${recall.toFixed(2)}, F1=${f1Score.toFixed(2)}`);

    // ═══════════════════════════════════════════════════════════
    // MODULE 5: Cross-Domain Learning
    // ═══════════════════════════════════════════════════════════

    const { data: categoryProfiles } = await supabase
      .from('learning_profiles')
      .select('profile_type, features, sample_count')
      .like('profile_type', 'category:%');

    let crossDomainUpdates = 0;

    for (const profile of (categoryProfiles || [])) {
      const category = profile.profile_type.replace('category:', '');
      const related = RELATED_CATEGORIES[category] || [];
      
      if (related.length === 0 || (profile.sample_count || 0) < 5) continue;

      const features = profile.features as Record<string, any>;
      if (!features?.approved_features) continue;

      // Propagate learning to related categories at 30% weight
      for (const relatedCat of related) {
        const { data: existing } = await supabase
          .from('learning_profiles')
          .select('id, features, sample_count')
          .eq('profile_type', `category:${relatedCat}`)
          .single();

        if (existing) {
          // Merge: add cross-domain signals at reduced weight
          const existingFeatures = (existing.features as Record<string, any>) || {};
          const crossFeatures = existingFeatures.cross_domain_signals || {};
          crossFeatures[`from:${category}`] = {
            weight: 0.3,
            sample_count: profile.sample_count,
            updated: new Date().toISOString(),
          };

          await supabase.from('learning_profiles').update({
            features: { ...existingFeatures, cross_domain_signals: crossFeatures },
            last_updated: new Date().toISOString(),
          }).eq('id', existing.id);
          
          crossDomainUpdates++;
        }
      }
    }

    results.cross_domain_learning = {
      category_profiles_analyzed: (categoryProfiles || []).length,
      cross_domain_updates: crossDomainUpdates,
    };

    console.log(`[VisibilityGap] Cross-domain: ${crossDomainUpdates} profile cross-links created`);

    return successResponse({
      success: true,
      results,
      scanned_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[VisibilityGap] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
