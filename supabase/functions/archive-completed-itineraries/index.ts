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
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const now = new Date().toISOString();

    const { data: itineraries, error: fetchError } = await supabaseClient
      .from("itineraries")
      .select("id, trip_type, departure_date, return_date, trip_name, status")
      .neq("status", "completed")
      .or(`return_date.lt.${now},and(trip_type.eq.one_way,departure_date.lt.${now})`);

    if (fetchError) throw fetchError;

    console.log(`[ArchiveItineraries] Found ${itineraries?.length || 0} itineraries to archive`);

    let archivedCount = 0;

    for (const itinerary of itineraries || []) {
      const shouldArchive = 
        itinerary.trip_type === "one_way" 
          ? new Date(itinerary.departure_date) < new Date()
          : new Date(itinerary.return_date) < new Date();

      if (shouldArchive) {
        const { error: updateError } = await supabaseClient
          .from("itineraries")
          .update({ status: "completed" })
          .eq("id", itinerary.id);

        if (updateError) {
          console.error(`[ArchiveItineraries] Failed to archive ${itinerary.id}:`, updateError);
        } else {
          console.log(`[ArchiveItineraries] Archived: ${itinerary.trip_name}`);
          archivedCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        archivedCount,
        message: `Successfully archived ${archivedCount} itineraries`,
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
