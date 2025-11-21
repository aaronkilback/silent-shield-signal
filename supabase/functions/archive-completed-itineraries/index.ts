import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Get all itineraries that should be archived
    const { data: itineraries, error: fetchError } = await supabaseClient
      .from("itineraries")
      .select("id, trip_type, departure_date, return_date, trip_name, status")
      .neq("status", "completed")
      .or(`return_date.lt.${now},and(trip_type.eq.one_way,departure_date.lt.${now})`);

    if (fetchError) throw fetchError;

    console.log(`Found ${itineraries?.length || 0} itineraries to archive`);

    let archivedCount = 0;

    // Update each itinerary to completed status
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
          console.error(`Failed to archive itinerary ${itinerary.id}:`, updateError);
        } else {
          console.log(`Archived itinerary: ${itinerary.trip_name} (${itinerary.id})`);
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
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error archiving itineraries:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
