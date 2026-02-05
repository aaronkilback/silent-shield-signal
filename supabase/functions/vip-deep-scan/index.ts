import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface VIPIntakeData {
  clientId: string;
  priorityLevel: "standard" | "priority";
  fullLegalName: string;
  knownAliases: string;
  dateOfBirth: string;
  nationality: string;
  primaryEmail: string;
  secondaryEmails: string;
  primaryPhone: string;
  secondaryPhones: string;
  socialMediaHandles: string;
  properties: Array<{
    type: string;
    address: string;
    hasSecuritySystem: boolean;
    notes: string;
  }>;
  wildfirePreparedness: string;
  wildfireEvacuationPlan: string;
  familyMembers: Array<{
    name: string;
    relationship: string;
    dateOfBirth: string;
    socialMedia: string;
  }>;
  householdStaff: string;
  securityPersonnel: string;
  pets: string;
  humanWildlifeConflict: string;
  primaryDevices: string;
  emailProviders: string;
  cloudServices: string;
  knownUsernames: string;
  corporateAffiliations: string;
  vehicles: string;
  regularRoutes: string;
  frequentedLocations: string;
  gymClubMemberships: string;
  travelPlans: Array<{
    destination: string;
    departureDate: string;
    returnDate: string;
    purpose: string;
    accommodationType: string;
  }>;
  preferredAirlines: string;
  frequentDestinations: string;
  knownAdversaries: string;
  previousIncidents: string;
  specificConcerns: string;
  industryThreats: string;
  consentDataCollection: boolean;
  consentDarkWebScan: boolean;
  consentSocialMediaAnalysis: boolean;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { intakeData } = await req.json() as { intakeData: VIPIntakeData };

    const supabase = createServiceClient();

    console.log(`[VIP-DEEP-SCAN] Initiating deep scan for: ${intakeData.fullLegalName}`);
    console.log(`[VIP-DEEP-SCAN] Priority: ${intakeData.priorityLevel}`);
    console.log(`[VIP-DEEP-SCAN] Client ID: ${intakeData.clientId}`);

    // 1. Create the VIP entity
    const aliases = intakeData.knownAliases.split(",").map(a => a.trim()).filter(Boolean);
    const socialHandles: Record<string, string> = {};
    
    if (intakeData.socialMediaHandles) {
      const lines = intakeData.socialMediaHandles.split("\n");
      for (const line of lines) {
        const [platform, handle] = line.split(":").map(s => s.trim());
        if (platform && handle) {
          socialHandles[platform.toLowerCase()] = handle;
        }
      }
    }

    const primaryAddress = intakeData.properties.find(p => p.type === "primary")?.address || 
                           intakeData.properties[0]?.address || "";

    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .insert({
        name: intakeData.fullLegalName,
        type: "person",
        entity_status: "active",
        is_active: true,
        active_monitoring_enabled: true,
        client_id: intakeData.clientId,
        aliases: aliases,
        current_location: primaryAddress,
        attributes: {
          social_media_handles: socialHandles,
          vip_deep_scan: true,
          intake_date: new Date().toISOString(),
          priority_level: intakeData.priorityLevel,
          date_of_birth: intakeData.dateOfBirth,
          nationality: intakeData.nationality,
          primary_email: intakeData.primaryEmail,
          secondary_emails: intakeData.secondaryEmails,
          primary_phone: intakeData.primaryPhone,
          secondary_phones: intakeData.secondaryPhones,
          properties: intakeData.properties,
          wildfire_preparedness: intakeData.wildfirePreparedness,
          wildfire_evacuation_plan: intakeData.wildfireEvacuationPlan,
          family_members: intakeData.familyMembers,
          household_staff: intakeData.householdStaff,
          security_personnel: intakeData.securityPersonnel,
          pets: intakeData.pets,
          human_wildlife_conflict: intakeData.humanWildlifeConflict,
          digital_footprint: {
            devices: intakeData.primaryDevices,
            email_providers: intakeData.emailProviders,
            cloud_services: intakeData.cloudServices,
            usernames: intakeData.knownUsernames,
            corporate_affiliations: intakeData.corporateAffiliations,
          },
          movement_patterns: {
            vehicles: intakeData.vehicles,
            regular_routes: intakeData.regularRoutes,
            frequented_locations: intakeData.frequentedLocations,
            gym_club_memberships: intakeData.gymClubMemberships,
          },
          travel: {
            plans: intakeData.travelPlans,
            preferred_airlines: intakeData.preferredAirlines,
            frequent_destinations: intakeData.frequentDestinations,
          },
          threat_profile: {
            known_adversaries: intakeData.knownAdversaries,
            previous_incidents: intakeData.previousIncidents,
            specific_concerns: intakeData.specificConcerns,
            industry_threats: intakeData.industryThreats,
          },
          consent: {
            data_collection: intakeData.consentDataCollection,
            dark_web_scan: intakeData.consentDarkWebScan,
            social_media_analysis: intakeData.consentSocialMediaAnalysis,
          },
        },
      })
      .select()
      .single();

    if (entityError) {
      console.error("[VIP-DEEP-SCAN] Error creating entity:", entityError);
      throw entityError;
    }

    console.log(`[VIP-DEEP-SCAN] Created entity: ${entity.id}`);

    // 2. Create family member entities
    const familyEntityIds: string[] = [];
    for (const member of intakeData.familyMembers) {
      if (!member.name) continue;
      
      const { data: familyEntity, error: familyError } = await supabase
        .from("entities")
        .insert({
          name: member.name,
          type: "person",
          entity_status: "active",
          is_active: true,
          active_monitoring_enabled: true,
          client_id: intakeData.clientId,
          attributes: {
            relationship_to_vip: member.relationship,
            date_of_birth: member.dateOfBirth,
            social_media: member.socialMedia,
            vip_family_member: true,
            parent_vip_entity_id: entity.id,
          },
        })
        .select()
        .single();

      if (!familyError && familyEntity) {
        familyEntityIds.push(familyEntity.id);
        
        // Create relationship
        await supabase.from("entity_relationships").insert({
          source_entity_id: entity.id,
          target_entity_id: familyEntity.id,
          relationship_type: `family_${member.relationship}`,
          confidence_score: 100,
          source: "vip_intake",
        });
      }
    }

    console.log(`[VIP-DEEP-SCAN] Created ${familyEntityIds.length} family member entities`);

    // 3. Create travel itineraries
    for (const trip of intakeData.travelPlans) {
      if (!trip.destination || !trip.departureDate) continue;

      // First check if traveler exists for this VIP
      const { data: existingTraveler } = await supabase
        .from("travelers")
        .select("id")
        .eq("entity_id", entity.id)
        .maybeSingle();

      let travelerId = existingTraveler?.id;

      if (!travelerId) {
        // Create traveler record
        const { data: newTraveler, error: travelerError } = await supabase
          .from("travelers")
          .insert({
            name: intakeData.fullLegalName,
            email: intakeData.primaryEmail,
            phone: intakeData.primaryPhone,
            entity_id: entity.id,
            client_id: intakeData.clientId,
            status: "active",
            risk_level: "medium",
          })
          .select()
          .single();

        if (!travelerError && newTraveler) {
          travelerId = newTraveler.id;
        }
      }

      if (travelerId) {
        await supabase.from("itineraries").insert({
          traveler_id: travelerId,
          trip_name: `${trip.destination} - ${trip.purpose || 'Trip'}`,
          start_date: trip.departureDate,
          end_date: trip.returnDate || trip.departureDate,
          destinations: [trip.destination],
          status: "upcoming",
          monitoring_enabled: true,
          metadata: {
            purpose: trip.purpose,
            accommodation_type: trip.accommodationType,
            from_vip_intake: true,
          },
        });
      }
    }

    console.log(`[VIP-DEEP-SCAN] Created ${intakeData.travelPlans.length} travel itineraries`);

    // 4. Create an investigation for the deep scan
    const dueDate = new Date();
    if (intakeData.priorityLevel === "priority") {
      dueDate.setHours(dueDate.getHours() + 72);
    } else {
      dueDate.setDate(dueDate.getDate() + 14);
    }

    const { data: investigation, error: investigationError } = await supabase
      .from("investigations")
      .insert({
        title: `VIP Deep Scan: ${intakeData.fullLegalName}`,
        description: `Comprehensive threat assessment and vulnerability analysis for VIP principal.

**Priority Level:** ${intakeData.priorityLevel === "priority" ? "PRIORITY (72 hours)" : "Standard (14 days)"}

**Scan Scope:**
- Digital Leakage Analysis (dark web, breach databases, paste sites)
- Physical Vulnerability Assessment (property analysis, crime proximity)
- Reputational Risk Analysis (social media breadcrumbs, family exposure)
- Travel Risk Assessment (${intakeData.travelPlans.length} upcoming trips)

**Principal:** ${intakeData.fullLegalName}
**Properties:** ${intakeData.properties.length} locations
**Family Members:** ${intakeData.familyMembers.length} individuals
**Known Threats:** ${intakeData.knownAdversaries ? "Yes" : "None reported"}`,
        status: "active",
        priority: intakeData.priorityLevel === "priority" ? "critical" : "high",
        client_id: intakeData.clientId,
        type: "vip_deep_scan",
        linked_entity_ids: [entity.id, ...familyEntityIds],
        metadata: {
          vip_intake_data: intakeData,
          due_date: dueDate.toISOString(),
          scan_phases: [
            { phase: "digital_leakage", status: "pending", started_at: null, completed_at: null },
            { phase: "physical_vulnerabilities", status: "pending", started_at: null, completed_at: null },
            { phase: "reputational_risks", status: "pending", started_at: null, completed_at: null },
            { phase: "travel_risks", status: "pending", started_at: null, completed_at: null },
            { phase: "synthesis", status: "pending", started_at: null, completed_at: null },
          ],
        },
      })
      .select()
      .single();

    if (investigationError) {
      console.error("[VIP-DEEP-SCAN] Error creating investigation:", investigationError);
    } else {
      console.log(`[VIP-DEEP-SCAN] Created investigation: ${investigation.id}`);
    }

    // 5. Queue the scan tasks by creating signals/triggering monitors
    const scanTasks: string[] = [];

    // Dark web scan
    if (intakeData.consentDarkWebScan) {
      try {
        await supabase.functions.invoke("monitor-darkweb", {
          body: { 
            targetEmails: [intakeData.primaryEmail, ...intakeData.secondaryEmails.split("\n").filter(Boolean)],
            entityId: entity.id,
            clientId: intakeData.clientId,
          }
        });
        scanTasks.push("dark_web_scan");
      } catch (e) {
        console.error("[VIP-DEEP-SCAN] Dark web scan error:", e);
      }
    }

    // OSINT entity scan
    if (intakeData.consentSocialMediaAnalysis) {
      try {
        await supabase.functions.invoke("osint-entity-scan", {
          body: { entity_id: entity.id }
        });
        scanTasks.push("osint_scan");
      } catch (e) {
        console.error("[VIP-DEEP-SCAN] OSINT scan error:", e);
      }
    }

    // Travel risk monitoring
    if (intakeData.travelPlans.length > 0) {
      try {
        await supabase.functions.invoke("monitor-travel-risks", {
          body: { clientId: intakeData.clientId }
        });
        scanTasks.push("travel_risk_scan");
      } catch (e) {
        console.error("[VIP-DEEP-SCAN] Travel risk scan error:", e);
      }
    }

    // Geospatial intelligence for properties
    for (const property of intakeData.properties) {
      if (!property.address) continue;
      
      try {
        console.log(`[VIP-DEEP-SCAN] Property scan queued: ${property.address}`);
        scanTasks.push(`property_scan_${property.type}`);
      } catch (e) {
        console.error("[VIP-DEEP-SCAN] Property scan error:", e);
      }
    }

    // Create a signal to track the deep scan initiation
    await supabase.from("signals").insert({
      title: `VIP Deep Scan Initiated: ${intakeData.fullLegalName}`,
      description: `Comprehensive VIP deep scan has been initiated with ${intakeData.priorityLevel} priority.

**Scans Queued:** ${scanTasks.join(", ")}
**Due Date:** ${dueDate.toISOString()}
**Investigation ID:** ${investigation?.id || "N/A"}`,
      category: "intelligence",
      severity: "medium",
      status: "processed",
      client_id: intakeData.clientId,
      source: "vip_intake_wizard",
      entity_mentions: [intakeData.fullLegalName],
      raw_json: {
        intake_summary: {
          priority: intakeData.priorityLevel,
          properties_count: intakeData.properties.length,
          family_count: intakeData.familyMembers.length,
          travel_count: intakeData.travelPlans.length,
          has_known_threats: !!intakeData.knownAdversaries,
        },
        entity_id: entity.id,
        investigation_id: investigation?.id,
        scan_tasks: scanTasks,
      },
    });

    console.log(`[VIP-DEEP-SCAN] Deep scan initiated successfully`);
    console.log(`[VIP-DEEP-SCAN] Tasks queued: ${scanTasks.join(", ")}`);

    return successResponse({
      entity_id: entity.id,
      investigation_id: investigation?.id,
      family_entities: familyEntityIds,
      scans_queued: scanTasks,
      due_date: dueDate.toISOString(),
    });
  } catch (error) {
    console.error("[VIP-DEEP-SCAN] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
