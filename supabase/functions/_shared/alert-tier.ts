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

/**
 * REFUSE-TO-EMIT gate for pageable alerts (INC-ALERT-DELIVERY item 2). A delivery-tier alert
 * is NOT materialized (no unroutable placeholder in `alerts`) when: (a) no active+verified
 * recipient exists for the client, or (b) the subject is fixture/benchmark origin. Refusals
 * land in `alert_emission_refusals` (visible log), never silence. Returns the recipients to
 * emit to when it IS allowed. Quarantine now covers alerting, not just retrieval.
 */
export async function resolveAlertEmission(
  supabase: any,
  opts: { tier: AlertTier; clientId: string | null | undefined; isFixture: boolean; incidentId?: string | null; signalId?: string | null; subject?: string | null; emittedBy: string },
): Promise<{ emit: boolean; recipients: string[]; reason: string }> {
  if (!isDeliveryTier(opts.tier)) return { emit: false, recipients: [], reason: "non_delivery_tier" };

  const logRefusal = async (reason: string) => {
    try {
      await supabase.from("alert_emission_refusals").insert({
        tier: opts.tier, reason, client_id: opts.clientId ?? null,
        incident_id: opts.incidentId ?? null, signal_id: opts.signalId ?? null,
        subject: opts.subject ?? null, emitted_by: opts.emittedBy,
      });
    } catch (e) { console.warn("[alert-tier] refusal log failed:", (e as Error).message); }
    console.log(`[alert-tier] REFUSE-TO-EMIT ${opts.tier}: ${reason} (client=${opts.clientId ?? "none"}, by=${opts.emittedBy})`);
  };

  if (opts.isFixture) {
    await logRefusal("fixture_or_benchmark_origin");
    return { emit: false, recipients: [], reason: "fixture_or_benchmark_origin" };
  }
  const verified = await fetchVerifiedRecipientEmails(supabase, opts.clientId);
  if (verified.length === 0) {
    await logRefusal("no_verified_recipient");
    return { emit: false, recipients: [], reason: "no_verified_recipient" };
  }
  return { emit: true, recipients: verified, reason: "ok" };
}
