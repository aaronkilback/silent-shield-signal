import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const now = new Date();
    const nowISO = now.toISOString();

    // Fetch all non-completed itineraries
    const { data: itineraries, error: fetchError } = await supabaseClient
      .from("itineraries")
      .select("id, trip_type, departure_date, return_date, trip_name, status");

    if (fetchError) throw fetchError;

    console.log(`[ArchiveItineraries] Processing ${itineraries?.length || 0} itineraries`);

    let archivedCount = 0;
    let activatedCount = 0;

    for (const itinerary of itineraries || []) {
      const departure = new Date(itinerary.departure_date);
      const returnDate = itinerary.return_date ? new Date(itinerary.return_date) : null;
      const isOneWay = itinerary.trip_type === "one_way";

      // Determine correct status based on dates
      let correctStatus: string;
      if (isOneWay) {
        correctStatus = departure < now ? "completed" : "upcoming";
      } else if (!returnDate) {
        correctStatus = departure <= now ? "active" : "upcoming";
      } else if (returnDate < now) {
        correctStatus = "completed";
      } else if (departure <= now) {
        correctStatus = "active";
      } else {
        correctStatus = "upcoming";
      }

      // Only update if status needs changing
      if (itinerary.status !== correctStatus) {
        const { error: updateError } = await supabaseClient
          .from("itineraries")
          .update({ status: correctStatus })
          .eq("id", itinerary.id);

        if (updateError) {
          console.error(`[ArchiveItineraries] Failed to update ${itinerary.id}:`, updateError);
        } else {
          console.log(`[ArchiveItineraries] ${itinerary.trip_name}: ${itinerary.status} → ${correctStatus}`);
          if (correctStatus === "completed") archivedCount++;
          if (correctStatus === "active") activatedCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        archivedCount,
        activatedCount,
        message: `Archived: ${archivedCount}, Activated: ${activatedCount}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ArchiveItineraries] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
