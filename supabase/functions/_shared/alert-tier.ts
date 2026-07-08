// Four-Tier Classification — C-1 writer helper (#76).
// Reference: docs/platform-operations/four-tier-classification-design-2026-05-31.md
// Substrate: migration 20260531185006_c0_tier_column_substrate.sql (C-0). This is C-1:
// writers set alerts.tier at write time from their already-computed threat_level.
//
// Protect-Attention doctrine tiers:
//   log          = no push (awareness / audit; queryable, never emailed)
//   finding      = operator-pull (Neural Constellation UI; never emailed)
//   notification = same-business-day push (Slack/Teams; EMAIL stands in until those ship)
//   interruption = minutes-scale (Teams+Slack+SMS+oncall; EMAIL only for launch, other transports deferred per AV.3)
//
// Only DELIVERY_TIERS are emailable (the claim gate is tier IN ('notification','interruption')).

export type AlertTier = "log" | "finding" | "notification" | "interruption";

export const DELIVERY_TIERS = new Set<AlertTier>(["notification", "interruption"]);

// A non-email sentinel used when a delivery-tier alert has NO active+verified recipient for its
// client. It can never match client_alert_recipients (not an email), so it is never claimed / sent;
// the #69 operator-alert-bridge digest surfaces it so the operator configures a recipient or delivers
// manually. Fail-to-operator-visibility — never silent-drop, never wrong-send.
export const UNROUTED_RECIPIENT = "unrouted:no-verified-recipient";

/**
 * Map a writer's own threat_level to an alert tier per the four-tier master table:
 *   low -> log · medium -> finding · high -> notification · critical -> interruption.
 * Unknown / missing defaults to the most conservative 'log' (never emails).
 */
export function mapThreatLevelToTier(threatLevel: string | null | undefined): AlertTier {
  switch (String(threatLevel ?? "").trim().toLowerCase()) {
    case "critical": return "interruption";
    case "high":     return "notification";
    case "medium":   return "finding";
    case "low":      return "log";
    default:         return "log";
  }
}

export function isDeliveryTier(tier: AlertTier): boolean {
  return DELIVERY_TIERS.has(tier);
}

/**
 * Active + verified recipient emails (lowercased) for a client — the ONLY addresses a delivery-tier
 * alert may be materialized to. Never derived from AI output or contact fields (#71 A doctrine).
 */
export async function fetchVerifiedRecipientEmails(supabase: any, clientId: string | null | undefined): Promise<string[]> {
  if (!clientId) return [];
  const { data } = await supabase
    .from("client_alert_recipients")
    .select("email")
    .eq("client_id", clientId)
    .eq("active", true)
    .not("verified_at", "is", null);
  return (data ?? []).map((r: any) => String(r.email).trim().toLowerCase());
}
