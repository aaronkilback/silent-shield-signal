import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

// Ground-travel journey-management overdue monitor. Finds active ground journeys
// whose scheduled check-in has lapsed and raises a travel_alert (escalation).
// Idempotent: sets journey_overdue=true so each overdue event alerts once; a
// driver/operator check-in resets journey_overdue=false (re-alerts if it lapses
// again). Alerts are L1C by construction — travel_alerts link to the journey's
// lead traveler, and the bell/AlertsPanel scope alerts via travelers.client_id.
Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();

    const { data: overdue, error } = await supabase
      .from("itineraries")
      .select("id, trip_name, traveler_id, client_id, destination_city, destination_country, next_check_in_due_at")
      .eq("trip_type", "ground")
      .eq("status", "active")
      .eq("journey_overdue", false)
      .not("check_in_interval_minutes", "is", null)
      .not("next_check_in_due_at", "is", null)
      .lt("next_check_in_due_at", nowIso);
    if (error) throw error;

    let alerted = 0;
    for (const j of overdue || []) {
      const { error: upErr } = await supabase
        .from("itineraries").update({ journey_overdue: true }).eq("id", j.id);
      if (upErr) { console.error("[journey-checkins] flag failed", j.id, upErr.message); continue; }

      const { error: alErr } = await supabase.from("travel_alerts").insert({
        traveler_id: j.traveler_id,
        itinerary_id: j.id,
        alert_type: "journey_overdue",
        title: `OVERDUE check-in: ${j.trip_name}`,
        description: `Ground journey "${j.trip_name}" missed its scheduled check-in (due ${j.next_check_in_due_at}). Escalate per journey-management protocol.`,
        severity: "high",
        location: [j.destination_city, j.destination_country].filter(Boolean).join(", "),
        is_active: true,
        acknowledged: false,
        created_at: nowIso,
      });
      if (alErr) { console.error("[journey-checkins] alert insert failed", j.id, alErr.message); continue; }
      alerted++;
    }

    await recordHeartbeat(supabase, "monitor-journey-checkins-5min", "completed", {
      overdue: overdue?.length || 0, alerted,
    });
    return successResponse({ overdue: overdue?.length || 0, alerted });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
