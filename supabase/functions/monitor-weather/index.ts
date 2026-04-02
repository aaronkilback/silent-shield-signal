import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

// Map Canadian province/territory names to Environment Canada feed codes
const CA_PROVINCE_CODES: Record<string, string> = {
  alberta: "ab",
  "british columbia": "bc",
  manitoba: "mb",
  "new brunswick": "nb",
  "newfoundland": "nl",
  "nova scotia": "ns",
  ontario: "on",
  "prince edward island": "pe",
  quebec: "qc",
  saskatchewan: "sk",
  "northwest territories": "nt",
  nunavut: "nu",
  yukon: "yt",
};

// Cities → province code for common Canadian cities
const CA_CITY_PROVINCE: Record<string, string> = {
  calgary: "ab",
  edmonton: "ab",
  "red deer": "ab",
  lethbridge: "ab",
  vancouver: "bc",
  victoria: "bc",
  winnipeg: "mb",
  toronto: "on",
  ottawa: "on",
  montreal: "qc",
  regina: "sk",
  saskatoon: "sk",
  halifax: "ns",
  fredericton: "nb",
  "saint john": "nb",
};

function getCanadianProvinceCode(locations: string[]): string | null {
  const locs = locations.map((l) => l.toLowerCase());
  for (const loc of locs) {
    if (CA_PROVINCE_CODES[loc]) return CA_PROVINCE_CODES[loc];
    if (CA_CITY_PROVINCE[loc]) return CA_CITY_PROVINCE[loc];
  }
  return null;
}

function isCanadianClient(locations: string[]): boolean {
  const locs = locations.map((l) => l.toLowerCase());
  if (locs.includes("canada")) return true;
  return getCanadianProvinceCode(locations) !== null;
}

// Parse Environment Canada Atom feed (XML) — extract warning entries
function parseEnvironmentCanadaFeed(xml: string): Array<{ title: string; summary: string; id: string; updated: string }> {
  const entries: Array<{ title: string; summary: string; id: string; updated: string }> = [];
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const match of entryMatches) {
    const entry = match[1];
    const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim() ?? "";
    const summary = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/<[^>]+>/g, " ").trim() ?? "";
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
    const updated = entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1]?.trim() ?? new Date().toISOString();
    // Skip the feed-level "no watches or warnings" entry
    if (title.toLowerCase().includes("no watches") || title.toLowerCase().includes("no warnings")) continue;
    if (title && (title.toLowerCase().includes("warning") || title.toLowerCase().includes("watch") || title.toLowerCase().includes("advisory") || title.toLowerCase().includes("statement"))) {
      entries.push({ title, summary, id, updated });
    }
  }
  return entries;
}

function envCanadaSeverity(title: string): "critical" | "high" | "medium" {
  const t = title.toLowerCase();
  if (t.includes("tornado") || t.includes("extreme") || t.includes("blizzard")) return "critical";
  if (t.includes("warning")) return "high";
  return "medium";
}

async function processCanadianClient(
  supabase: ReturnType<typeof createServiceClient>,
  client: { id: string; name: string; locations: string[] },
  clientLocations: string[],
): Promise<number> {
  const provinceCode = getCanadianProvinceCode(clientLocations);
  if (!provinceCode) {
    console.log(`No province code found for ${client.name} — skipping Canadian feed`);
    return 0;
  }

  const feedUrl = `https://www.weather.gc.ca/rss/warning/${provinceCode}_e.xml`;
  console.log(`Fetching Environment Canada feed for ${client.name}: ${feedUrl}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let feedXml: string;
  try {
    const resp = await fetch(feedUrl, {
      headers: { "User-Agent": "Fortress-AI-Security-Platform/1.0" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!resp.ok) {
      console.log(`Environment Canada feed error for ${client.name}: ${resp.status}`);
      return 0;
    }
    feedXml = await resp.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.log(`Environment Canada feed timeout for ${client.name}`);
    } else {
      console.error(`Error fetching Environment Canada feed for ${client.name}:`, err);
    }
    return 0;
  }

  const entries = parseEnvironmentCanadaFeed(feedXml);
  console.log(`Parsed ${entries.length} warning entries for ${client.name}`);

  // Filter entries that mention any of the client's locations, then limit to 3
  const relevant = entries
    .filter((e) =>
      clientLocations.some(
        (loc) =>
          e.title.toLowerCase().includes(loc.toLowerCase()) ||
          e.summary.toLowerCase().includes(loc.toLowerCase()),
      ),
    )
    .slice(0, 3);

  console.log(`${relevant.length} relevant entries for ${client.name} after location filter`);

  let created = 0;
  for (const entry of relevant) {
    const signalText = `Weather Warning: ${entry.title}`;
    const { error: signalError } = await supabase.from("signals").insert({
      source_key: "weather-monitor",
      event: entry.title,
      text: signalText,
      location: clientLocations.join(", "),
      severity: envCanadaSeverity(entry.title),
      category: "weather",
      normalized_text: `${entry.title}. ${entry.summary}`,
      entity_tags: ["weather", "warning", "canada", provinceCode],
      confidence: 0.9,
      raw_json: { id: entry.id, title: entry.title, summary: entry.summary, updated: entry.updated },
      client_id: client.id,
    });

    if (!signalError) {
      created++;
      console.log(`Created Environment Canada signal for ${client.name}: ${entry.title}`);
      await correlateSignalEntities({
        supabase,
        signalText,
        clientId: client.id,
        additionalContext: entry.summary,
      });
    } else {
      console.error(`Signal insert error for ${client.name}:`, signalError.message);
    }
  }
  return created;
}

async function processUSClient(
  supabase: ReturnType<typeof createServiceClient>,
  client: { id: string; name: string; locations: string[] },
  clientLocations: string[],
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let weatherData: any;
  try {
    const weatherResponse = await fetch("https://api.weather.gov/alerts/active", {
      headers: {
        "User-Agent": "(Fortress-AI-Security-Platform, security@fortressai.com)",
        Accept: "application/geo+json",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!weatherResponse.ok) {
      console.log(`Weather API error for ${client.name}: ${weatherResponse.status} - ${await weatherResponse.text().catch(() => "no details")}`);
      return 0;
    }
    weatherData = await weatherResponse.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.log(`Weather API timeout for ${client.name}`);
    } else {
      console.error(`Error processing weather for ${client.name}:`, err instanceof Error ? err.message : err);
    }
    return 0;
  }

  if (!weatherData.features || weatherData.features.length === 0) return 0;

  // Filter ALL alerts for location match and high severity first, THEN limit to 3
  const relevant = weatherData.features
    .filter((alert: any) => {
      const props = alert.properties;
      const isHighSeverity = props.severity === "Extreme" || props.severity === "Severe";
      const affectsLocation = clientLocations.some((loc) =>
        props.areaDesc?.toLowerCase().includes(loc.toLowerCase()),
      );
      return isHighSeverity && affectsLocation;
    })
    .slice(0, 3);

  let created = 0;
  for (const alert of relevant) {
    const properties = alert.properties;
    const signalText = `Weather Alert: ${properties.event} - ${properties.headline}`;

    const { error: signalError } = await supabase.from("signals").insert({
      source_key: "weather-monitor",
      event: properties.event,
      text: signalText,
      location: properties.areaDesc,
      severity: properties.severity === "Extreme" ? "critical" : properties.severity === "Severe" ? "high" : "medium",
      category: "weather",
      normalized_text: `${properties.event}: ${properties.description}`,
      entity_tags: ["weather", "alert", properties.event.toLowerCase()],
      confidence: 0.95,
      raw_json: alert,
      client_id: client.id,
    });

    if (!signalError) {
      created++;
      console.log(`Created weather signal for ${client.name}: ${properties.event}`);
      await correlateSignalEntities({
        supabase,
        signalText,
        clientId: client.id,
        additionalContext: `${properties.description || ""}. Area: ${properties.areaDesc}`,
      });
    }
  }
  return created;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const { data: historyEntry, error: historyError } = await supabase
      .from("monitoring_history")
      .insert({
        source_name: "Weather Monitor",
        status: "running",
        scan_metadata: { source: "Weather.gov + Environment Canada" },
      })
      .select()
      .single();

    if (historyError) {
      console.error("Failed to create monitoring history:", historyError);
    }

    console.log("Starting weather monitoring scan...");

    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, locations")
      .not("locations", "is", null);

    if (clientsError) throw clientsError;

    console.log(`Found ${clients?.length || 0} clients to monitor`);

    let signalsCreated = 0;

    for (const client of clients || []) {
      const clientLocations = (client.locations || []) as string[];
      if (clientLocations.length === 0) {
        console.log(`Skipping ${client.name} — no locations configured`);
        continue;
      }

      if (isCanadianClient(clientLocations)) {
        signalsCreated += await processCanadianClient(supabase, client, clientLocations);
      } else {
        signalsCreated += await processUSClient(supabase, client, clientLocations);
      }
    }

    console.log(`Weather monitoring complete. Created ${signalsCreated} signals.`);

    if (historyEntry) {
      await supabase
        .from("monitoring_history")
        .update({
          status: "completed",
          scan_completed_at: new Date().toISOString(),
          signals_created: signalsCreated,
          scan_metadata: {
            source: "Weather.gov + Environment Canada",
            clients_scanned: clients?.length || 0,
          },
        })
        .eq("id", historyEntry.id);
    }

    return successResponse({
      success: true,
      clients_scanned: clients?.length || 0,
      signals_created: signalsCreated,
      source: "weather",
    });
  } catch (error) {
    console.error("Error in weather monitoring:", error);

    const supabase = createServiceClient();

    try {
      const { data: failedEntry } = await supabase
        .from("monitoring_history")
        .select("id")
        .eq("source_name", "Weather Monitor")
        .eq("status", "running")
        .order("scan_started_at", { ascending: false })
        .limit(1)
        .single();

      if (failedEntry) {
        await supabase
          .from("monitoring_history")
          .update({
            status: "failed",
            scan_completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", failedEntry.id);
      }
    } catch (updateError) {
      console.error("Failed to update monitoring history:", updateError);
    }

    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
