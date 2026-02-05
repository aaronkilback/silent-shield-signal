import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { signal_id, threat_actor_id } = await req.json();

    if (!signal_id) {
      return errorResponse("signal_id is required", 400);
    }

    const supabase = createServiceClient();

    console.log("Performing impact analysis for signal:", signal_id);

    // Fetch signal details
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select(`
        *,
        clients(
          id,
          name,
          industry,
          risk_assessment,
          threat_profile,
          high_value_assets,
          locations,
          employee_count
        )
      `)
      .eq("id", signal_id)
      .single();

    if (signalError || !signal) {
      return errorResponse("Signal not found", 404);
    }

    // Fetch related entities
    const entityIds = signal.correlated_entity_ids || [];
    let entities = [];
    if (entityIds.length > 0) {
      const { data: entityData } = await supabase
        .from("entities")
        .select("*")
        .in("id", entityIds);
      entities = entityData || [];
    }

    // Fetch threat actor details if provided
    let threatActor = null;
    if (threat_actor_id) {
      const { data: actorData } = await supabase
        .from("entities")
        .select("*")
        .eq("id", threat_actor_id)
        .single();
      threatActor = actorData;
    }

    // Calculate base severity score (0-100)
    let severityScore = 0;
    switch (signal.severity?.toLowerCase()) {
      case "critical":
        severityScore = 90;
        break;
      case "high":
        severityScore = 70;
        break;
      case "medium":
        severityScore = 50;
        break;
      case "low":
        severityScore = 30;
        break;
      default:
        severityScore = 50;
    }

    // Adjust based on confidence
    const confidenceMultiplier = (signal.confidence || 0.5);
    severityScore = severityScore * confidenceMultiplier;

    // Client context analysis
    const client = signal.clients;
    const clientRiskProfile = client?.risk_assessment || {};
    const threatProfile = client?.threat_profile || {};
    
    // Asset impact calculation
    const highValueAssets = client?.high_value_assets || [];
    const assetImpactScore = highValueAssets.length > 0 ? 
      Math.min(highValueAssets.length * 10, 30) : 0;

    // Employee impact (for physical threats)
    const isPhysicalThreat = signal.category?.toLowerCase().includes('physical') ||
      signal.normalized_text?.toLowerCase().includes('protest') ||
      signal.normalized_text?.toLowerCase().includes('violence');
    
    const employeeCount = client?.employee_count || 0;
    const employeeImpactScore = isPhysicalThreat && employeeCount > 0 ? 
      Math.min(employeeCount / 100, 20) : 0;

    // Entity threat score contribution
    const entityThreatScore = entities.reduce((sum, entity) => {
      return sum + (entity.threat_score || 0);
    }, 0) / Math.max(entities.length, 1);

    // Calculate final risk score (0-100)
    const riskScore = Math.min(
      severityScore + assetImpactScore + employeeImpactScore + (entityThreatScore * 0.3),
      100
    );

    // Impact assessment categories
    const impactAssessment = {
      // Financial impact (probabilistic range)
      financial_impact: calculateFinancialImpact(signal, client, riskScore),
      
      // Operational impact
      operational_impact: calculateOperationalImpact(signal, client, entities),
      
      // Reputational impact
      reputational_impact: calculateReputationalImpact(signal, client, riskScore),
      
      // People safety impact
      people_safety_impact: calculatePeopleSafetyImpact(signal, client, isPhysicalThreat),
      
      // Cascading effects analysis
      cascading_effects: analyzeCascadingEffects(signal, client, entities),
    };

    // Generate risk level classification
    let riskLevel = "low";
    if (riskScore >= 80) riskLevel = "critical";
    else if (riskScore >= 60) riskLevel = "high";
    else if (riskScore >= 40) riskLevel = "medium";

    const result = {
      signal_id,
      risk_score: Math.round(riskScore * 10) / 10,
      risk_level: riskLevel,
      confidence: signal.confidence,
      impact_assessment: impactAssessment,
      contributing_factors: {
        base_severity: severityScore,
        asset_impact: assetImpactScore,
        employee_impact: employeeImpactScore,
        entity_threat: entityThreatScore,
      },
      client_context: {
        client_id: client?.id,
        client_name: client?.name,
        industry: client?.industry,
        high_value_assets: highValueAssets,
        employee_count: employeeCount,
      },
      threat_actor: threatActor ? {
        id: threatActor.id,
        name: threatActor.name,
        type: threatActor.type,
        threat_score: threatActor.threat_score,
      } : null,
      related_entities: entities.map(e => ({
        id: e.id,
        name: e.name,
        type: e.type,
        risk_level: e.risk_level,
        threat_score: e.threat_score,
      })),
      analysis_timestamp: new Date().toISOString(),
    };

    console.log("Impact analysis completed. Risk score:", riskScore);

    return successResponse(result);
  } catch (error) {
    console.error("Error in perform-impact-analysis:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});

// Helper functions for impact calculation

function calculateFinancialImpact(signal: any, client: any, riskScore: number) {
  const industry = client?.industry?.toLowerCase() || "";
  const baseMultiplier = industry.includes("energy") || industry.includes("financial") ? 
    1.5 : 1.0;
  
  const minImpact = Math.round(riskScore * 1000 * baseMultiplier);
  const maxImpact = Math.round(riskScore * 10000 * baseMultiplier);
  
  return {
    estimated_cost_range: {
      minimum: minImpact,
      maximum: maxImpact,
      currency: "USD",
    },
    cost_categories: [
      "Direct operational disruption",
      "Incident response and remediation",
      "Regulatory compliance and fines",
      "Reputation recovery",
    ],
    confidence: "medium",
  };
}

function calculateOperationalImpact(signal: any, client: any, entities: any[]) {
  const isCyberThreat = signal.category?.toLowerCase().includes('cyber');
  const isPhysicalThreat = signal.category?.toLowerCase().includes('physical');
  
  let estimatedDowntime = 0;
  if (isCyberThreat) {
    estimatedDowntime = signal.severity === "critical" ? 72 : 
                       signal.severity === "high" ? 24 : 8;
  } else if (isPhysicalThreat) {
    estimatedDowntime = signal.severity === "critical" ? 48 : 
                       signal.severity === "high" ? 12 : 4;
  }

  return {
    estimated_downtime_hours: estimatedDowntime,
    affected_operations: client?.locations || [],
    business_continuity_impact: estimatedDowntime > 24 ? "severe" : 
                                estimatedDowntime > 8 ? "moderate" : "minor",
    recovery_complexity: signal.severity === "critical" ? "high" : 
                        signal.severity === "high" ? "medium" : "low",
  };
}

function calculateReputationalImpact(signal: any, client: any, riskScore: number) {
  const isPublicIncident = signal.source?.includes("news") || 
                          signal.source?.includes("social");
  
  let reputationScore = 0;
  if (isPublicIncident) {
    reputationScore = Math.min(riskScore * 1.5, 100);
  } else {
    reputationScore = riskScore * 0.5;
  }

  return {
    reputation_damage_score: Math.round(reputationScore),
    public_visibility: isPublicIncident ? "high" : "low",
    media_exposure_risk: isPublicIncident ? "elevated" : "minimal",
    stakeholder_impact: reputationScore > 70 ? "significant" : 
                       reputationScore > 40 ? "moderate" : "limited",
  };
}

function calculatePeopleSafetyImpact(signal: any, client: any, isPhysicalThreat: boolean) {
  if (!isPhysicalThreat) {
    return {
      risk_to_personnel: "none",
      affected_locations: [],
      evacuation_required: false,
      security_enhancement_needed: false,
    };
  }

  const locations = client?.locations || [];
  const severity = signal.severity?.toLowerCase();

  return {
    risk_to_personnel: severity === "critical" ? "high" : 
                      severity === "high" ? "moderate" : "low",
    affected_locations: locations,
    evacuation_required: severity === "critical",
    security_enhancement_needed: severity === "critical" || severity === "high",
    immediate_actions_required: [
      "Notify security personnel",
      "Alert on-site staff",
      "Activate emergency protocols",
    ],
  };
}

function analyzeCascadingEffects(signal: any, client: any, entities: any[]) {
  const supplyChainEntities = client?.supply_chain_entities || [];
  const competitorNames = client?.competitor_names || [];
  
  const cascadingRisks = [];

  // Check for supply chain impacts
  if (supplyChainEntities.length > 0) {
    const affectedSupplyChain = entities.some(e => 
      supplyChainEntities.includes(e.name)
    );
    if (affectedSupplyChain) {
      cascadingRisks.push({
        type: "supply_chain_disruption",
        severity: "high",
        description: "Potential disruption to supply chain operations",
      });
    }
  }

  // Check for competitive impacts
  if (competitorNames.length > 0) {
    const competitorMentioned = entities.some(e => 
      competitorNames.includes(e.name)
    );
    if (competitorMentioned) {
      cascadingRisks.push({
        type: "competitive_advantage_shift",
        severity: "medium",
        description: "Potential competitive market positioning impact",
      });
    }
  }

  // Infrastructure interdependencies
  const isCriticalInfrastructure = client?.industry?.toLowerCase().includes('energy') ||
                                   client?.industry?.toLowerCase().includes('utility');
  if (isCriticalInfrastructure) {
    cascadingRisks.push({
      type: "infrastructure_interdependency",
      severity: "high",
      description: "Potential cascading impact on critical infrastructure",
    });
  }

  return {
    cascading_risks: cascadingRisks,
    interconnected_systems: client?.high_value_assets || [],
    secondary_impact_probability: cascadingRisks.length > 0 ? "high" : "low",
  };
}
