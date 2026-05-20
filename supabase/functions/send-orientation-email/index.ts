// send-orientation-email
// ─────────────────────────────────────────────────────────────────────────────
// EMAIL 2 in the onboarding chain. Fired from the dashboard (Index page) on
// first successful authenticated landing AFTER the user has cleared:
//   1. password set
//   2. SMS MFA
//   3. acceptance gate (writes onboarding_acceptances row, source='first_login')
//   4. tenant confirmation screen
//
// The function is IDEMPOTENT — safe to invoke repeatedly. It only sends when:
//   - the caller has a `source='first_login'` acceptance row, AND
//   - that row has `orientation_email_sent_at IS NULL`.
// On success it atomically marks the row as sent. Subsequent calls return
// `{email_sent: false, reason: 'already_sent'}` and do not contact Resend.
//
// This design closes the failure mode where the gate writes the acceptance
// row but routing breaks before the dashboard renders — the email would have
// been misleading. By gating on dashboard mount + idempotent server check,
// the email reflects successful activation, not partial onboarding.
//
// Authorization model: deployed with verify_jwt = true. Caller must be
// authenticated; we re-derive the recipient from the caller's JWT, not from
// a client-supplied address. Prevents abuse where a malicious caller could
// trigger an orientation email to a third party.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { renderEmail, sectionHeading, ctaButton, escapeHtml } from "../_shared/email-templates.ts";

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL")
  || "Fortress AEGIS <onboarding@silentshieldsecurity.com>";
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://fortress.silentshieldsecurity.com";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "support@silentshieldsecurity.com";

interface OrientationRequest {
  tenantId: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const { tenantId }: OrientationRequest = await req.json();
    if (!tenantId) {
      return errorResponse("tenantId is required", 400);
    }

    // Tenant lookup (RLS confines to caller's tenants — implicit boundary).
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found or not visible to caller", 404);
    }

    // ── Idempotency check ────────────────────────────────────────────────────
    // Find the caller's most recent acceptance row for this tenant. Only send
    // when:
    //   (a) source = 'first_login'  — never on re-accepts
    //   (b) orientation_email_sent_at IS NULL — not already sent
    // Service-role client used for the read+atomic-update (caller's JWT-scoped
    // client cannot UPDATE orientation_email_sent_at by design).
    const admin = createClient(supabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

    const { data: latest, error: latestErr } = await admin
      .from("onboarding_acceptances")
      .select("id, source, orientation_email_sent_at")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) {
      console.error("[send-orientation-email] latest lookup error:", latestErr);
      return errorResponse("Could not look up acceptance status", 500);
    }
    if (!latest) {
      return successResponse({ email_sent: false, reason: "no_acceptance_row" });
    }
    if (latest.source !== "first_login") {
      return successResponse({ email_sent: false, reason: "not_first_login" });
    }
    if (latest.orientation_email_sent_at) {
      return successResponse({ email_sent: false, reason: "already_sent" });
    }

    // Recipient email is the caller's own — never a client-supplied address.
    const toEmail = user.email;
    if (!toEmail) {
      return errorResponse("Caller has no email on record; cannot send orientation", 400);
    }

    // Display name preference: profiles.name -> auth metadata -> email local-part.
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const displayName: string =
      profile?.name?.trim()
      || (user.user_metadata?.display_name as string | undefined)?.trim()
      || (user.user_metadata?.name as string | undefined)?.trim()
      || toEmail.split("@")[0];

    const dashboardUrl = `${PUBLIC_APP_URL}/`;

    // ── Compose EMAIL 2 ─────────────────────────────────────────────────────
    // Tone: short paragraphs, declarative, no exclamation points. The reader
    // already accepted terms; this is the "now operate well" message.
    const bodyHtml = `
      <p style="margin:0 0 14px; font-size:17px; font-weight:600; color:#0b0d10;">Welcome to Fortress.</p>
      <p style="margin:0 0 14px;">
        ${escapeHtml(displayName)} — you have completed activation under <strong>${escapeHtml(tenant.name)}</strong>. This message is your short orientation to AEGIS, the intelligence operations engine inside Fortress, written so you can work effectively from day one.
      </p>

      ${sectionHeading("What AEGIS is")}
      <p style="margin:0 0 14px;">
        AEGIS is the intelligence operations engine inside Fortress. It synthesizes signals from monitored sources, surfaces correlations across entities and events, and produces summaries, briefings, and reports under your direction. It is built for the operating environment of a protective operations cell: high signal volume, incomplete information, real decisions on a clock.
      </p>

      ${sectionHeading("What AEGIS is not")}
      <p style="margin:0 0 14px;">
        AEGIS does not establish fact. Its outputs are inferences — patterns and correlations drawn from third-party source data, not adjudicated truth. AEGIS is not legal advice, not law enforcement, and not a guarantee of detection or prevention.
      </p>
      <p style="margin:0 0 14px;">
        You retain operational judgment. Validate consequential decisions against primary sources before acting.
      </p>

      ${sectionHeading("Investigative uploads")}
      <ul style="margin:0 0 14px 18px; padding:0;">
        <li style="margin-bottom:8px;">
          Confirm you have lawful authority to process the material. You acknowledged this on first sign-in; the same standard applies to every upload.
        </li>
        <li style="margin-bottom:8px;">
          Treat uploaded content as evidence: avoid editing originals, retain the source.
        </li>
        <li style="margin-bottom:0;">
          Expect AEGIS to extract entities, summaries, and indicators. Review its output before circulating it.
        </li>
      </ul>

      ${sectionHeading("Account cycling")}
      <p style="margin:0 0 14px;">
        For sensitive matters — for example, a principal protection investigation that may later require evidentiary separation — use account cycling. Open a dedicated investigation, complete it, then archive. Each cycle keeps the audit trail clean and limits cross-matter contamination.
      </p>
      <p style="margin:0 0 14px;">
        If you are unsure whether a matter warrants its own cycle, ask your administrator before opening it inside an existing investigation.
      </p>

      ${sectionHeading("A note on attribution language")}
      <p style="margin:0 0 14px;">
        AEGIS expresses confidence carefully. When two signals look related, AEGIS will use phrasing such as:
      </p>
      <ul style="margin:0 0 14px 18px; padding:0;">
        <li style="margin-bottom:4px;">behavioral correlation</li>
        <li style="margin-bottom:4px;">confidence-based similarity</li>
        <li style="margin-bottom:0;">pattern consistency</li>
      </ul>
      <p style="margin:0 0 14px;">
        It will not say "confirmed actor", "same individual", or "definitive attribution" without evidence beyond signal correlation. This distinction is operationally and legally meaningful. When you draft reports or briefings using AEGIS output, hold the same standard.
      </p>

      ${sectionHeading("Effective prompts")}
      <p style="margin:0 0 8px;"><strong>Good</strong></p>
      <ul style="margin:0 0 14px 18px; padding:0;">
        <li style="margin-bottom:6px;">
          "Summarize signals related to [Principal] from the last 72 hours. Highlight any pattern consistency with prior incidents."
        </li>
        <li style="margin-bottom:6px;">
          "Draft a briefing on transit-route risk for [Principal], citing sources."
        </li>
        <li style="margin-bottom:0;">
          "Compare these two accounts for behavioral correlation. Confidence rating only."
        </li>
      </ul>

      <p style="margin:0 0 8px;"><strong>Less effective</strong></p>
      <ul style="margin:0 0 14px 18px; padding:0;">
        <li style="margin-bottom:6px;">
          "Is this the same person?" — AEGIS will reframe in confidence terms.
        </li>
        <li style="margin-bottom:6px;">
          "Tell me who is threatening [Principal]." — too broad; specify timeframe and source scope.
        </li>
        <li style="margin-bottom:0;">
          "Generate the final incident report." — AEGIS drafts; you finalize.
        </li>
      </ul>

      ${ctaButton("Open your dashboard", dashboardUrl)}

      ${sectionHeading("Concierge support")}
      <p style="margin:0 0 14px;">
        For onboarding questions, investigative workflow advice, or escalation guidance during your first 30 days, contact <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#0b0d10;">${escapeHtml(SUPPORT_EMAIL)}</a>.
      </p>
      <p style="margin:0;">
        We expect Fortress to feel quiet, fast, and reliable. If it does not, tell us.
      </p>
    `;

    const html = renderEmail({
      preheader: `What AEGIS does, what it doesn't, and how to operate it.`,
      bodyHtml,
    });

    // Fail-soft: missing Resend key is a config issue, not a user-facing fail.
    // Orientation is supplementary content — the user already passed the gate
    // and is on the dashboard. Log and return success with email_sent=false.
    if (!RESEND_API_KEY) {
      console.warn("[send-orientation-email] RESEND_API_KEY not set; skipping send");
      return successResponse({
        email_sent: false,
        warning: "RESEND_API_KEY not configured; orientation email skipped.",
      });
    }

    try {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: RESEND_FROM,
        to: [toEmail],
        subject: `Fortress orientation — ${tenant.name}`,
        html,
      });
    } catch (mailErr) {
      console.error("[send-orientation-email] resend error:", mailErr);
      return successResponse({
        email_sent: false,
        error: mailErr instanceof Error ? mailErr.message : "Resend send failed",
      });
    }

    // Atomically mark this acceptance as orientation-sent. Done AFTER Resend
    // succeeds so a Resend failure doesn't poison the idempotency check —
    // next invocation will retry. Service-role client; no RLS interference.
    const { error: markErr } = await admin
      .from("onboarding_acceptances")
      .update({ orientation_email_sent_at: new Date().toISOString() })
      .eq("id", latest.id)
      .is("orientation_email_sent_at", null);  // belt-and-braces: don't overwrite if another caller raced us
    if (markErr) {
      // Email was sent but bookkeeping failed. Log loudly so we can investigate;
      // duplicate-send risk on next mount is acceptable vs. failing the call.
      console.error("[send-orientation-email] mark-sent error after successful send:", markErr);
    }

    return successResponse({ email_sent: true });
  } catch (e) {
    console.error("[send-orientation-email] unexpected error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
