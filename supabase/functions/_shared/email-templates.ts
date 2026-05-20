// Shared email chrome for Fortress AEGIS transactional mail.
//
// Voice: calm, executive, operator-grade. No emoji. No exclamation points.
// No sales copy. The reader is a senior protection operator who knows their job.
//
// Branding is intentionally minimal — a thin colored bar, the wordmark, and
// the body. Tenants do not get custom logos in MVP; tenant identity is
// conveyed via `tenant_name` in the body copy.

export interface EmailChromeArgs {
  /** What appears in the browser title bar / search results when an email
   *  client renders the message. Keep ~50 chars. */
  preheader: string;
  /** Body content (already HTML-formatted via templates below). */
  bodyHtml: string;
}

/**
 * Wrap body content in the standard Fortress AEGIS email chrome.
 * The chrome is inlined; no external CSS / fonts / images. Renders cleanly in
 * Gmail, Outlook web/desktop, Apple Mail, mobile clients.
 */
export function renderEmail({ preheader, bodyHtml }: EmailChromeArgs): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>Fortress AEGIS</title>
  </head>
  <body style="margin:0; padding:0; background:#f4f5f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#111; -webkit-font-smoothing:antialiased;">
    <!-- preheader (hidden from view; surfaces in inbox preview) -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f5f6;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background:#ffffff; max-width:600px; border:1px solid #e5e7eb; border-radius:6px;">
            <!-- Wordmark bar -->
            <tr>
              <td style="background:#0b0d10; padding:18px 28px;">
                <div style="font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:#cfd6dd; font-weight:600;">
                  Fortress AEGIS &middot; Silent Shield Security
                </div>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:28px 32px; font-size:15px; line-height:1.55; color:#1f2328;">
                ${bodyHtml}
              </td>
            </tr>
            <!-- Footer rule + legal block -->
            <tr>
              <td style="padding:20px 32px 28px; border-top:1px solid #e5e7eb; font-size:12px; line-height:1.55; color:#5b6573;">
                Silent Shield Security &middot; Fortress AEGIS &middot; Operational Intelligence<br>
                Material visible inside this environment is confidential and operational. Treat it accordingly.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** HTML-escape user-supplied strings to defend against injection in
 *  email body interpolation. Use for ALL caller-supplied values. */
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

/** Small section header used inside body content. */
export function sectionHeading(label: string): string {
  return `<div style="margin:24px 0 8px; font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5b6573; font-weight:600;">${escapeHtml(label)}</div>`;
}

/** Primary CTA button. Inline-styled so it renders in Outlook. */
export function ctaButton(label: string, href: string): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="border-radius:4px; background:#0b0d10;">
          <a href="${escapeHtml(href)}" style="display:inline-block; padding:13px 22px; font-size:14px; font-weight:600; letter-spacing:0.02em; color:#ffffff; text-decoration:none; border-radius:4px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Format an ISO timestamp for human-readable expiry display.
 *  Example: "Friday, 22 May 2026, 23:45 UTC". */
export function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }) + " UTC";
  } catch {
    return iso;
  }
}
