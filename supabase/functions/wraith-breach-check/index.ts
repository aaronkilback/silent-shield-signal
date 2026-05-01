import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FORTRESS_URL = "https://kpuqukppbmwebiptqmog.supabase.co";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate via Lovable Cloud JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = claimsData.claims.email as string;
    if (!email) {
      return new Response(JSON.stringify({ error: "No email in token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Fortress api-v1-security with the FORTRESS_API_KEY
    const fortressApiKey = Deno.env.get("FORTRESS_API_KEY");
    if (!fortressApiKey) {
      return new Response(
        JSON.stringify({ error: "Fortress API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const fortressResponse = await fetch(
      `${FORTRESS_URL}/functions/v1/api-v1-security`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": fortressApiKey,
        },
        body: JSON.stringify({
          action: "full_exposure_check",
          email: email,
        }),
      }
    );

    if (!fortressResponse.ok) {
      const errText = await fortressResponse.text();
      console.error("Fortress api-v1-security error:", fortressResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Fortress security check failed", details: errText }),
        {
          status: fortressResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const securityData = await fortressResponse.json();

    // Transform breach data into WraithFinding format
    const findings: any[] = [];

    // Process breaches
    if (securityData.breaches && Array.isArray(securityData.breaches)) {
      securityData.breaches.forEach((breach: any, i: number) => {
        const dataClasses = breach.DataClasses || breach.data_classes || [];
        const hasPasswords = dataClasses.some(
          (dc: string) => dc.toLowerCase().includes("password")
        );
        const severity = hasPasswords ? "critical" : breach.IsSensitive ? "high" : "medium";

        findings.push({
          id: `breach-${breach.Name || i}`,
          title: `Data Breach: ${breach.Title || breach.Name || "Unknown"}`,
          description: `Your email was found in the ${breach.Title || breach.Name} breach (${breach.BreachDate || "unknown date"}). Compromised data: ${dataClasses.join(", ") || "unknown"}.`,
          severity,
          threat_type: "data_breach",
          vector: "network",
          created_at: breach.AddedDate || breach.BreachDate || new Date().toISOString(),
          status: "confirmed",
          recommendation: hasPasswords
            ? "CRITICAL: Passwords were exposed. Change your password for this service immediately and any other accounts using the same password. Enable 2FA where possible."
            : "Review the compromised data types and update any affected credentials. Enable 2FA where possible.",
          raw: breach,
        });
      });
    }

    // Process pastes
    if (securityData.pastes && Array.isArray(securityData.pastes)) {
      securityData.pastes.forEach((paste: any, i: number) => {
        findings.push({
          id: `paste-${paste.Id || i}`,
          title: `Paste Exposure: ${paste.Source || "Unknown Source"}`,
          description: `Your email appeared in a paste on ${paste.Source || "an unknown source"} (${paste.Date || "unknown date"}). ${paste.EmailCount || "Unknown number of"} emails were in this paste.`,
          severity: "high",
          threat_type: "paste_exposure",
          vector: "network",
          created_at: paste.Date || new Date().toISOString(),
          status: "confirmed",
          recommendation:
            "Your email address was found in a data dump. Monitor for phishing attempts and ensure your credentials are unique per service.",
          raw: paste,
        });
      });
    }

    // Add CISA threat feed items if present
    if (securityData.threat_feed && Array.isArray(securityData.threat_feed)) {
      securityData.threat_feed.slice(0, 5).forEach((threat: any, i: number) => {
        findings.push({
          id: `cisa-${threat.cveID || i}`,
          title: `Active Exploit: ${threat.cveID || threat.vulnerabilityName || "Unknown"}`,
          description: threat.shortDescription || threat.vulnerabilityName || "Active exploit detected by CISA.",
          severity: "high",
          threat_type: "active_exploit",
          vector: "device",
          created_at: threat.dateAdded || new Date().toISOString(),
          status: "active",
          recommendation: threat.requiredAction || "Apply vendor patches immediately.",
          raw: threat,
        });
      });
    }

    return new Response(JSON.stringify({ findings, email, checked_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("wraith-breach-check error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
