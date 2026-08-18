// vip-deep-scan — REBUILT 2026-08-17 (WO-VIP-DEEP-SCAN-REMEDIATION-01) after the 2026-06-27 P0
// containment. Security remediation of the confirmed authenticated cross-tenant write + integrity
// exposure:
//   • TENANT-MEMBERSHIP VALIDATION on client_id — the body client_id is NEVER trusted; the caller
//     must be a member of that client's tenant (userCanAccessClient) or super_admin. service_role
//     is a trusted internal caller. (Same gate family as generate-executive-report.)
//   • SCHEMA-CURRENT writes — every write matches the CURRENT schema (the original's investigations/
//     entity_relationships/travelers/itineraries/signals writes were all stale and silently failing).
//   • FAIL-LOUD persistence — core-record insert failures abort with an explicit error naming what
//     already exists; enrichment (monitor) + tracking-signal outcomes are SURFACED, never swallowed.
//   • PROVENANCE — created_by / prepared_by = the acting user; origin markers on entity + investigation.
//   • Signals go through ingest-signal per doctrine (NOT a raw signals insert).
// Operator decisions (2026-08-17): investigations file_number continues the shared INV-2026 sequence
// (VIP scans distinguished by a field, not the number); scan phases dropped entirely; itineraries are
// SKIPPED and the gap is reported (intake lacks origin/type the current schema requires — no fabrication).
import {
  createServiceClient, handleCors, successResponse, errorResponse,
  getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";

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
  properties: Array<{ type: string; address: string; hasSecuritySystem: boolean; notes: string }>;
  wildfirePreparedness: string;
  wildfireEvacuationPlan: string;
  familyMembers: Array<{ name: string; relationship: string; dateOfBirth: string; socialMedia: string }>;
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
  travelPlans: Array<{ destination: string; departureDate: string; returnDate: string; purpose: string; accommodationType: string }>;
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
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    // ── AUTH: authenticated caller required ──
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);

    const body = await req.json().catch(() => null);
    const intakeData = body?.intakeData as VIPIntakeData | undefined;
    if (!intakeData || typeof intakeData !== "object") return errorResponse("intakeData is required", 400);
    const clientId = intakeData.clientId;
    if (!clientId || typeof clientId !== "string") {
      return errorResponse("CLIENT_CONTEXT_MISSING: intakeData.clientId is required", 400);
    }

    const supabase = createServiceClient();

    // ── TENANT-MEMBERSHIP VALIDATION on client_id (the P0 fix — never trust body client_id) ──
    let actorUserId: string | null = null;
    let actorEmail: string | null = null;
    if (caller.kind === "user") {
      actorUserId = caller.userId;
      actorEmail = caller.user?.email ?? null;
      let allowed = await userCanAccessClient(supabase, caller.userId, clientId);
      if (!allowed) {
        const { data: sa } = await supabase.from("user_roles")
          .select("role").eq("user_id", caller.userId).eq("role", "super_admin").maybeSingle();
        allowed = !!sa;
      }
      if (!allowed) return errorResponse("CLIENT_NOT_AUTHORIZED: caller cannot access the requested client_id", 403);
    }
    // caller.kind === 'service_role' → trusted internal caller (no membership check)

    // ── COMPLIANCE: server-side consent enforcement (never trust the client alone) ──
    if (intakeData.consentDataCollection !== true) {
      return errorResponse("CONSENT_REQUIRED: data-collection consent is mandatory", 400);
    }

    const nowIso = new Date().toISOString();
    const dueDate = new Date();
    if (intakeData.priorityLevel === "priority") dueDate.setHours(dueDate.getHours() + 72);
    else dueDate.setDate(dueDate.getDate() + 14);
    const dueDateIso = dueDate.toISOString();

    const aliases = (intakeData.knownAliases || "").split(",").map((a) => a.trim()).filter(Boolean);
    const socialHandles: Record<string, string> = {};
    for (const line of (intakeData.socialMediaHandles || "").split("\n")) {
      const [p, h] = line.split(":").map((s) => s.trim());
      if (p && h) socialHandles[p.toLowerCase()] = h;
    }
    const primaryAddress = intakeData.properties?.find((p) => p.type === "primary")?.address
      || intakeData.properties?.[0]?.address || "";
    // Canonical contact location per CLAUDE.md: attributes.contact_info.{email,phone} (string|array)
    // + legacy attributes.{emails,phones}. Readers merge both; primary_/secondary_ alone show as N/A.
    const emailList = [...new Set([intakeData.primaryEmail, ...(intakeData.secondaryEmails || "").split("\n").map((s) => s.trim())].filter(Boolean))];
    const phoneList = [...new Set([intakeData.primaryPhone, ...(intakeData.secondaryPhones || "").split("\n").map((s) => s.trim())].filter(Boolean))];

    // ── 1. VIP entity (fail-loud) ──
    const { data: entity, error: entityError } = await supabase.from("entities").insert({
      name: intakeData.fullLegalName,
      type: "person",
      entity_status: "confirmed",
      is_active: true,
      active_monitoring_enabled: true,
      client_id: clientId,
      visibility_class: "curated",   // deliberately operator-entered/verified, not auto-extracted
      legal_hold: false,
      created_by: actorUserId,       // provenance: acting user
      aliases,
      current_location: primaryAddress,
      attributes: {
        origin: "vip_deep_scan_intake",
        vip_deep_scan: true,
        intake_date: nowIso,
        actor_user_id: actorUserId,
        priority_level: intakeData.priorityLevel,
        social_media_handles: socialHandles,
        date_of_birth: intakeData.dateOfBirth,
        nationality: intakeData.nationality,
        contact_info: { email: emailList, phone: phoneList },  // canonical (CLAUDE.md)
        emails: emailList,   // legacy
        phones: phoneList,   // legacy
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
          devices: intakeData.primaryDevices, email_providers: intakeData.emailProviders,
          cloud_services: intakeData.cloudServices, usernames: intakeData.knownUsernames,
          corporate_affiliations: intakeData.corporateAffiliations,
        },
        movement_patterns: {
          vehicles: intakeData.vehicles, regular_routes: intakeData.regularRoutes,
          frequented_locations: intakeData.frequentedLocations, gym_club_memberships: intakeData.gymClubMemberships,
        },
        travel: {
          plans: intakeData.travelPlans, preferred_airlines: intakeData.preferredAirlines,
          frequent_destinations: intakeData.frequentDestinations,
        },
        threat_profile: {
          known_adversaries: intakeData.knownAdversaries, previous_incidents: intakeData.previousIncidents,
          specific_concerns: intakeData.specificConcerns, industry_threats: intakeData.industryThreats,
        },
        consent: {
          data_collection: intakeData.consentDataCollection, dark_web_scan: intakeData.consentDarkWebScan,
          social_media_analysis: intakeData.consentSocialMediaAnalysis,
        },
      },
    }).select("id").single();

    if (entityError || !entity) {
      return errorResponse(`Failed to create VIP entity: ${entityError?.message ?? "no row returned"}`, 500);
    }
    const vipEntityId = entity.id as string;

    // ── 2. Family entities + relationships (fail-loud on each; provenance via created_by + origin) ──
    const familyEntityIds: string[] = [];
    for (const m of (intakeData.familyMembers || [])) {
      if (!m?.name) continue;
      const { data: fam, error: famErr } = await supabase.from("entities").insert({
        name: m.name, type: "person", entity_status: "confirmed", is_active: true,
        active_monitoring_enabled: true, client_id: clientId,
        visibility_class: "curated", legal_hold: false, created_by: actorUserId,
        attributes: {
          origin: "vip_deep_scan_intake", vip_family_member: true, parent_vip_entity_id: vipEntityId,
          relationship_to_vip: m.relationship, date_of_birth: m.dateOfBirth, social_media: m.socialMedia,
          actor_user_id: actorUserId,
        },
      }).select("id").single();
      if (famErr || !fam) {
        return errorResponse(`Failed to create family entity "${m.name}" (VIP entity ${vipEntityId} already created): ${famErr?.message ?? "no row"}`, 500);
      }
      familyEntityIds.push(fam.id);
      const { error: relErr } = await supabase.from("entity_relationships").insert({
        entity_a_id: vipEntityId, entity_b_id: fam.id,
        relationship_type: `family_${m.relationship || "member"}`,
        strength: 1.0, description: "VIP intake: declared family relationship",
        first_observed: nowIso, last_observed: nowIso,
      });
      if (relErr) return errorResponse(`Failed to create relationship VIP→${m.name}: ${relErr.message}`, 500);
    }

    // ── 3. Investigation (fail-loud; file_number continues the shared INV-2026 sequence; VIP marked
    //       in cross_references.origin, NOT the file_number; NO scan phases) ──
    const information = [
      `Principal: ${intakeData.fullLegalName}`,
      `Priority: ${intakeData.priorityLevel === "priority" ? "PRIORITY (72h)" : "Standard (14d)"}`,
      `Properties: ${intakeData.properties?.length ?? 0}`,
      `Family members: ${familyEntityIds.length}`,
      `Known threats: ${intakeData.knownAdversaries ? "Yes" : "None reported"}`,
      `Scan scope: digital leakage (dark web / breach / paste), physical vulnerability, reputational risk, travel risk.`,
    ].join("\n");

    let investigation: { id: string; file_number: string } | null = null;
    let lastInvErr = "";
    for (let attempt = 0; attempt < 3 && !investigation; attempt++) {
      const { data: existing } = await supabase.from("investigations")
        .select("file_number").like("file_number", "INV-2026-%");
      let maxN = 0, width = 4;
      for (const r of existing || []) {
        const suffix = String(r.file_number).replace(/^INV-2026-/, "");
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > maxN) { maxN = n; width = suffix.length; }
      }
      const fileNumber = `INV-2026-${String(maxN + 1).padStart(width, "0")}`;
      const { data: inv, error: invErr } = await supabase.from("investigations").insert({
        file_number: fileNumber,
        synopsis: `VIP Deep Scan — ${intakeData.fullLegalName} (${intakeData.priorityLevel})`,
        information,
        file_status: "open",
        client_id: clientId,
        prepared_by: actorUserId,
        created_by_name: caller.kind === "user" ? actorEmail : "service_role",
        correlated_entity_ids: [vipEntityId, ...familyEntityIds],
        cross_references: {
          origin: "vip_deep_scan", vip_entity_id: vipEntityId, priority_level: intakeData.priorityLevel,
          actor_user_id: actorUserId, intake_at: nowIso, due_date: dueDateIso,
        },
        legal_hold: false,
      }).select("id, file_number").single();
      if (invErr) {
        lastInvErr = invErr.message;
        if ((invErr as { code?: string }).code === "23505" && attempt < 2) continue; // file_number race → retry
        return errorResponse(`Failed to create investigation (VIP entity ${vipEntityId} + ${familyEntityIds.length} family already created): ${invErr.message}`, 500);
      }
      investigation = inv as { id: string; file_number: string };
    }
    if (!investigation) {
      return errorResponse(`Failed to allocate an investigation file_number after retries (VIP entity ${vipEntityId} already created): ${lastInvErr}`, 500);
    }

    // ── 4. Downstream enrichment monitors — outcomes SURFACED, never swallowed (non-fatal) ──
    const scanResults: Array<{ scan: string; ok: boolean; error?: string }> = [];
    const record = async (name: string, fn: () => Promise<{ error: unknown }>) => {
      try { const { error } = await fn(); scanResults.push({ scan: name, ok: !error, error: (error as { message?: string })?.message }); }
      catch (e) { scanResults.push({ scan: name, ok: false, error: e instanceof Error ? e.message : String(e) }); }
    };
    if (intakeData.consentDarkWebScan) {
      const emails = [intakeData.primaryEmail, ...(intakeData.secondaryEmails || "").split("\n").map((s) => s.trim()).filter(Boolean)].filter(Boolean);
      await record("dark_web_scan", () => supabase.functions.invoke("monitor-darkweb", { body: { targetEmails: emails, entityId: vipEntityId, clientId } }));
    }
    if (intakeData.consentSocialMediaAnalysis) {
      await record("osint_entity_scan", () => supabase.functions.invoke("osint-entity-scan", { body: { entity_id: vipEntityId } }));
    }
    if ((intakeData.travelPlans || []).length > 0) {
      await record("travel_risk_scan", () => supabase.functions.invoke("monitor-travel-risks", { body: { clientId } }));
    }

    // ── 5. Tracking signal — via ingest-signal per doctrine (surfaced, non-fatal) ──
    const scanTasks = scanResults.filter((s) => s.ok).map((s) => s.scan);
    let signalOk = false, signalError: string | undefined;
    try {
      // ingest-signal has verify_jwt=false and gates on its OWN getCallerIdentity (exact service-key
      // match). functions.invoke does not reliably forward the service-role key as Authorization, so
      // pass it explicitly — otherwise ingest-signal 401s (proof run #2, 2026-08-18).
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const { data: sigData, error: sigErr } = await supabase.functions.invoke("ingest-signal", {
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
        body: {
          origin: "vip_deep_scan",
          text: `VIP Deep Scan initiated for ${intakeData.fullLegalName} (${intakeData.priorityLevel} priority). Investigation ${investigation.file_number}. Scans queued: ${scanTasks.join(", ") || "none"}. Due ${dueDateIso}.`,
          client_id: clientId,
          // Internal, consent-vetted intake signal: provenance is the authenticated intake, not an
          // external URL. skip_relevance_gate marks it pre-vetted (satisfies ingest-signal F-034.1,
          // which rejects a null source_url otherwise) and keeps this tracking record from being
          // relevance-dropped. source_url points at the created investigation for auditability.
          source_url: `https://fortress.silentshieldsecurity.com/investigations/${investigation.id}`,
          skip_relevance_gate: true,
          sourceType: "vip_intake_wizard",
          sourceData: { entity_id: vipEntityId, investigation_id: investigation.id, investigation_file_number: investigation.file_number, priority: intakeData.priorityLevel, scan_tasks: scanTasks },
        },
      });
      // ingest-signal returns rejections as HTTP 200 {status:'rejected', reason} — inspect the body,
      // not just sigErr, so a rejection is not misreported as success.
      const rejected = (sigData as { status?: string })?.status === "rejected";
      signalOk = !sigErr && !rejected;
      signalError = sigErr
        ? (sigErr as { message?: string })?.message
        : (rejected ? `ingest-signal rejected: ${(sigData as { reason?: string })?.reason ?? "unknown"}` : undefined);
    } catch (e) { signalError = e instanceof Error ? e.message : String(e); }

    // ── 6. Travel-itinerary gap (decision #3: skip creation, report the gap; NO fabricated origin) ──
    const travelGap = (intakeData.travelPlans || []).length > 0 ? {
      itineraries_created: 0,
      trips_in_intake: intakeData.travelPlans.length,
      reason: "Itinerary records were NOT created: the current itineraries schema requires origin_city/origin_country/trip_type, which the VIP intake does not collect. Client-level travel-risk monitoring was still triggered. To enable per-trip itineraries, extend the intake to capture each trip's origin city/country and type.",
      trips: intakeData.travelPlans.map((t) => ({ destination: t.destination, departure_date: t.departureDate, return_date: t.returnDate, purpose: t.purpose })),
    } : null;

    return successResponse({
      ok: true,
      actor: { kind: caller.kind, user_id: actorUserId, email: actorEmail },
      client_id: clientId,
      entity_id: vipEntityId,
      family_entity_ids: familyEntityIds,
      relationships_created: familyEntityIds.length,
      investigation: { id: investigation.id, file_number: investigation.file_number },
      tracking_signal: { via: "ingest-signal", ok: signalOk, error: signalError },
      enrichment_scans: scanResults,
      travel_itinerary_gap: travelGap,
      due_date: dueDateIso,
    });
  } catch (error) {
    console.error("[VIP-DEEP-SCAN] Unhandled error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
