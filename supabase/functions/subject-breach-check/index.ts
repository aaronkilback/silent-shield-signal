// subject-breach-check — per-SUBJECT breach exposure via HIBP account API against the subject's actual
// PERSONAL emails, writing to subject_exposure_items so breaches render in the exposure set alongside
// reputational findings. This is NOT monitor-darkweb: that derives a corporate DOMAIN from the client's
// contact_email (meaningless for a personal client — "hotmail.com") and writes to `signals`. This checks
// the real personal accounts and is owner-scoped exposure.
//
// Requires the HIBP paid API key (Deno secret HIBP_API_KEY). Without it, returns an honest
// not-configured refusal — it never fabricates a clean result.
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";

const HIBP = "https://haveibeenpwned.com/api/v3/breachedaccount";
const CRITICAL_CLASSES = ["Social security numbers", "Credit cards", "Bank account numbers", "Government issued IDs", "Passport numbers"];

function severityFor(dataClasses: string[], isSensitive: boolean): string {
  if (dataClasses.some((c) => CRITICAL_CLASSES.includes(c))) return "critical";
  if (isSensitive || dataClasses.includes("Passwords")) return "high";
  return "medium";
}

// CLAUDE.md canonical email merge: contact_info.email (string|array) + legacy emails.
function entityEmails(attrs: any): string[] {
  const legacy = Array.isArray(attrs?.emails) ? attrs.emails : (attrs?.emails ? [attrs.emails] : []);
  const ce = attrs?.contact_info?.email;
  const contact = Array.isArray(ce) ? ce : (ce ? [ce] : []);
  return [...new Set([...contact, ...legacy].map((e: string) => String(e).trim().toLowerCase()).filter(Boolean))];
}

async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "super_admin").maybeSingle();
  return !!data;
}
async function authorize(supabase: any, caller: any, clientId: string | null): Promise<boolean> {
  if (caller.kind !== "user") return true;
  if (clientId && await userCanAccessClient(supabase, caller.userId, clientId)) return true;
  return isSuperAdmin(supabase, caller.userId);
}

async function hibpAccount(email: string, key: string): Promise<{ ok: true; breaches: any[] } | { ok: false; status: number; error: string }> {
  const resp = await fetch(`${HIBP}/${encodeURIComponent(email)}?truncateResponse=false`, {
    headers: { "hibp-api-key": key, "user-agent": "SilentShield-Fortress-BreachCheck" },
  });
  if (resp.status === 404) return { ok: true, breaches: [] };   // clean — no breach
  if (resp.status === 200) return { ok: true, breaches: await resp.json() };
  if (resp.status === 429) return { ok: false, status: 429, error: `rate_limited (retry-after ${resp.headers.get("retry-after")})` };
  return { ok: false, status: resp.status, error: `HIBP HTTP ${resp.status}` };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);
    const key = Deno.env.get("HIBP_API_KEY");
    if (!key) return errorResponse("HIBP_API_KEY not configured — breach check cannot run (honest refusal, not a clean result)", 503);

    const body = await req.json().catch(() => null);
    const entityId = body?.entityId;
    if (!entityId) return errorResponse("entityId required", 400);
    const supabase = createServiceClient();
    const { data: entity } = await supabase.from("entities").select("id, name, client_id, tenant_id, attributes").eq("id", entityId).maybeSingle();
    if (!entity) return errorResponse("entity not found", 404);
    if (!(await authorize(supabase, caller, entity.client_id))) return errorResponse("NOT_AUTHORIZED", 403);

    // emails: explicit (intake personal emails) ∪ entity's canonical contact emails
    const passed = Array.isArray(body?.emails) ? body.emails : [];
    const emails = [...new Set([...passed, ...entityEmails(entity.attributes)].map((e: string) => String(e).trim().toLowerCase()).filter((e) => e.includes("@")))];
    if (emails.length === 0) return errorResponse("no personal emails available for this subject (intake emails or entity contact_info.email)", 400);

    // HIBP lookups — sequential w/ a delay (lower tiers rate-limit ~1 req / 1.5s). breach → item keyed by name.
    const scanId = crypto.randomUUID();
    const byBreach = new Map<string, { breach: any; emails: string[] }>();
    const errors: Array<{ email: string; error: string }> = [];
    for (let i = 0; i < emails.length; i++) {
      if (i > 0) await sleep(1600);
      const r = await hibpAccount(emails[i], key);
      if (!r.ok) { errors.push({ email: emails[i], error: r.error }); continue; }
      for (const b of r.breaches) {
        const cur = byBreach.get(b.Name) ?? { breach: b, emails: [] };
        cur.emails.push(emails[i]); byBreach.set(b.Name, cur);
      }
    }

    // Persist one exposure item per breach (owner-scoped, category data_breach, third_party).
    let written = 0;
    for (const [name, { breach, emails: affected }] of byBreach) {
      const dc: string[] = breach.DataClasses ?? [];
      const { data: item } = await supabase.from("subject_exposure_items").upsert({
        subject_entity_id: entityId, client_id: entity.client_id ?? null, tenant_id: entity.tenant_id ?? null,
        category: "data_breach", source_class: "third_party",
        title: `Data breach: ${breach.Title ?? name}`,
        summary: `Affected account(s): ${affected.join(", ")}. Breach date ${breach.BreachDate ?? "unknown"}. Data exposed: ${dc.join(", ") || "unspecified"}.${breach.IsSensitive ? " (sensitive breach)" : ""}`,
        severity: severityFor(dc, !!breach.IsSensitive),
        fingerprint: `breach-${String(name).toLowerCase()}`,
        first_seen_date: breach.BreachDate ?? null,
        scan_id: scanId, matcher_version: "subject-breach-check-v1", created_by: caller.kind === "user" ? caller.userId : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "subject_entity_id,fingerprint" }).select("id").single();
      if (!item) continue;
      await supabase.from("subject_exposure_locations").upsert({
        exposure_item_id: item.id,
        url: `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(name)}`,
        domain: breach.Domain || "haveibeenpwned.com", platform: "breach",
        title: `${breach.Title ?? name} — ${breach.PwnCount ? `${breach.PwnCount.toLocaleString()} accounts` : "breach"}`,
        snippet: (breach.Description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
        published_date: breach.BreachDate ?? null, date_captured: new Date().toISOString(),
        found_by_query: `HIBP breachedaccount:${affected.join("|")}`, phase: 1,
      }, { onConflict: "exposure_item_id,url" });
      written++;
    }

    return successResponse({
      scanId, emails_checked: emails.length, breaches_found: byBreach.size, items_written: written,
      errors, note: byBreach.size === 0 && errors.length === 0 ? "No breaches found for the checked personal emails (a genuine clean result from HIBP)." : undefined,
    });
  } catch (e) {
    console.error("[subject-breach-check] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});
