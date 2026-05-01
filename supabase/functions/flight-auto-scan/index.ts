import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

    if (!PERPLEXITY_API_KEY) {
      throw new Error("PERPLEXITY_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get all flights with status 'scheduled' or 'delayed' departing within the next 72 hours
    const now = new Date();
    const horizon = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const { data: flights, error: fetchError } = await supabase
      .from("travel_flights")
      .select("*")
      .in("status", ["scheduled", "delayed", "departed"])
      .gte("departure_time", now.toISOString())
      .lte("departure_time", horizon.toISOString())
      .order("departure_time", { ascending: true });

    if (fetchError) {
      console.error("Failed to fetch flights:", fetchError);
      throw fetchError;
    }

    if (!flights || flights.length === 0) {
      return new Response(
        JSON.stringify({ message: "No upcoming flights to scan", scanned: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Scanning ${flights.length} upcoming flights...`);

    let updated = 0;
    let alertsCreated = 0;

    for (const flight of flights) {
      try {
        // Rate limit: small delay between API calls
        if (updated > 0) {
          await new Promise((r) => setTimeout(r, 1500));
        }

        const searchPrompt = `Current real-time flight status for ${flight.flight_number} on ${new Date(flight.departure_time).toLocaleDateString()}. Include:
- Current flight status (on time, delayed, cancelled, in-flight, landed)
- If delayed: delay duration in minutes and reason if known
- Gate and terminal if available

IMPORTANT: At the end of your response, include a JSON block in this exact format:
\`\`\`json
{"status":"scheduled|delayed|cancelled|departed|arrived","gate":"","terminal":"","delay_minutes":0,"delay_reason":""}
\`\`\``;

        const response = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              {
                role: "system",
                content: "You are a flight status assistant. Provide accurate real-time status. Always end with the JSON block.",
              },
              { role: "user", content: searchPrompt },
            ],
            search_recency_filter: "day",
          }),
        });

        if (!response.ok) {
          console.error(`Perplexity error for ${flight.flight_number}: ${response.status}`);
          if (response.status === 429) {
            console.log("Rate limited, stopping scan early.");
            break;
          }
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";

        // Parse structured JSON
        const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (!jsonMatch) continue;

        let parsed;
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          continue;
        }

        const validStatuses = ["scheduled", "delayed", "cancelled", "departed", "arrived"];
        if (parsed.status && !validStatuses.includes(parsed.status)) {
          parsed.status = flight.status;
        }
        parsed.delay_minutes = parseInt(parsed.delay_minutes) || 0;

        // Determine if status changed
        const statusChanged = parsed.status && parsed.status !== flight.status;
        const delayChanged = parsed.delay_minutes !== (flight.delay_minutes || 0);

        // Update flight record
        const updates: Record<string, unknown> = {
          last_checked_at: new Date().toISOString(),
        };
        if (parsed.status) updates.status = parsed.status;
        if (parsed.gate) updates.gate = parsed.gate;
        if (parsed.terminal) updates.terminal = parsed.terminal;
        if (parsed.delay_minutes !== undefined) updates.delay_minutes = parsed.delay_minutes;
        if (parsed.delay_reason) updates.delay_reason = parsed.delay_reason;

        await supabase
          .from("travel_flights")
          .update(updates)
          .eq("id", flight.id);

        updated++;

        // Create alert if newly delayed or cancelled
        if (statusChanged && (parsed.status === "delayed" || parsed.status === "cancelled")) {
          const severity = parsed.status === "cancelled" ? "critical" : "warning";
          const title =
            parsed.status === "cancelled"
              ? `⚠️ ${flight.flight_number} CANCELLED`
              : `${flight.flight_number} Delayed${parsed.delay_minutes ? ` ${parsed.delay_minutes}min` : ""}`;

          const description = parsed.delay_reason
            ? `${parsed.delay_reason}. Route: ${flight.departure_airport} → ${flight.arrival_airport}`
            : `Flight ${flight.flight_number} (${flight.departure_airport} → ${flight.arrival_airport}) is now ${parsed.status}`;

          await supabase.from("travel_alerts").insert({
            user_id: flight.user_id,
            itinerary_id: flight.itinerary_id,
            title,
            description,
            severity,
            category: "aviation",
            location: flight.departure_airport,
          });
          alertsCreated++;
          console.log(`Alert created: ${title}`);
        } else if (delayChanged && parsed.delay_minutes > 0 && parsed.delay_minutes > (flight.delay_minutes || 0)) {
          // Delay increased
          await supabase.from("travel_alerts").insert({
            user_id: flight.user_id,
            itinerary_id: flight.itinerary_id,
            title: `${flight.flight_number} delay increased to ${parsed.delay_minutes}min`,
            description: parsed.delay_reason || `Delay on ${flight.departure_airport} → ${flight.arrival_airport}`,
            severity: "warning",
            category: "aviation",
            location: flight.departure_airport,
          });
          alertsCreated++;
        }
      } catch (err) {
        console.error(`Error scanning ${flight.flight_number}:`, err);
      }
    }

    console.log(`Scan complete: ${updated} flights updated, ${alertsCreated} alerts created`);

    return new Response(
      JSON.stringify({ scanned: updated, alerts_created: alertsCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Flight scan error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
