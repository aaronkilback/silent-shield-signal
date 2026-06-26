import { DashboardAIAssistant, type AegisActivity } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useUserRole } from "@/hooks/useUserRole";
import { useOrientationEmail } from "@/hooks/useOrientationEmail";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
import { AegisCoreCanvas } from "@/components/aegis/AegisCoreCanvas";
import { AegisAtmosphere } from "@/components/aegis/AegisAtmosphere";
import { Loader2 } from "lucide-react";

// P0 temporary diagnostics. Dev-console only (never rendered). Flip off / remove after the
// iPhone tenant-context capture.
const TENANT_DX = true;

// Slice 1a — local-only helpers; no data queries, no external fonts, no layout restructure.
function greetingPrefix() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function firstNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const full = (meta.full_name || meta.name || meta.first_name) as string | undefined;
  if (typeof full === "string" && full.trim()) return full.trim().split(/\s+/)[0];
  if (user?.email) return user.email.split("@")[0];
  return "Operator";
}

const Index = () => {
  const { user, loading } = useAuth();
  const { currentTenant, isAllTenantsView, isHydrating, tenants, setCurrentTenant } = useTenant();
  // P0: Aegis client-context authorization is GLOBAL-app-role only (server-authoritative
  // via user_roles RLS). super_admin OR admin may (eventually) change client context through
  // Aegis. Tenant 'owner' alone does NOT — it's a tenant-membership role, not an Aegis grant.
  const { roles: globalRoles, isSuperAdmin, isAdmin } = useUserRole();
  const canChangeClientContextViaAegis = isSuperAdmin || isAdmin;
  const navigate = useNavigate();

  // P0 tenant/context readiness gate. Until tenant resolution completes we do NOT query
  // clients, form voice client scope, claim a client context, or show selection UI.
  // Missing tenant after resolution = fail-closed (no auto-select).
  const tenantResolving = isHydrating;
  const tenantReady = !isHydrating && (!!currentTenant || isAllTenantsView);
  const tenantUnavailable = !isHydrating && !currentTenant && !isAllTenantsView;

  // Slice 4A (Option C): real session-local Aegis activity, emitted by DashboardAIAssistant.
  // Drives the decorative canvas/atmosphere only — no data binding, no roster, no claims.
  const [aegisActivity, setAegisActivity] = useState<AegisActivity>({ thinking: false, streaming: false, uploading: false, voice: "off" });
  const aegisActive = aegisActivity.thinking || aegisActivity.streaming || (aegisActivity.voice !== "off" && aegisActivity.voice !== "idle");

  // Fire orientation email (Email 2) on first successful dashboard landing.
  // Idempotent server-side — only sends once per first-login acceptance.
  // Skipped in platform-admin / all-tenants view (super_admin viewing globally).
  useOrientationEmail({
    userId: user?.id,
    tenantId: currentTenant?.id,
    skip: isAllTenantsView || currentTenant?.access_mode === "platform_admin",
  });

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // P0 temporary diagnostics (dev console only — never rendered in production UI).
  useEffect(() => {
    if (!TENANT_DX || !user) return;
    const tenantState = tenantResolving ? "resolving" : tenantReady ? "ready" : "unavailable";
    const voiceScope = tenantUnavailable ? "absent (no tenant)" : tenantReady ? "tenant-valid (client TBD)" : "withheld (resolving)";
    console.log("[TenantDx]", {
      userId: user.id,
      globalRoles,
      tenantState,
      currentTenantId: currentTenant?.id ?? null,
      isAllTenantsView,
      canChangeClientContextViaAegis,
      voiceScope,
    });
  }, [user, globalRoles, tenantResolving, tenantReady, tenantUnavailable, currentTenant?.id, isAllTenantsView, canChangeClientContextViaAegis]);

  if (!user && !loading) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-v="2">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // P0 voice-first Home: NO persistent client-context claim and NO selection UI by default.
  // The only context-relevant line shown is a truthful, fail-closed tenant-state note — and
  // only when tenant scope is genuinely unavailable after resolution. No client claim here.
  const tenantNote = tenantResolving
    ? null
    : tenantUnavailable
      ? "No active context. Select a tenant to begin."
      : null; // tenantReady → stay minimal; client context is summoned/conversational, not persistent

  return (
    // Slice 1b: paint-only premium polish. Subtle vertical gradient on the EXISTING wrapper
    // (theme palette, not a deep-space radial); structure unchanged (min-h-screen flex flex-col).
    <div
      className="relative isolate overflow-hidden min-h-screen flex flex-col"
      style={{ background: "linear-gradient(180deg, hsl(222 47% 7%) 0%, hsl(222 47% 5%) 60%, hsl(222 47% 4%) 100%)" }}
    >
      {/* Slice 2A "Aegis Magical Core": decorative Canvas 2D core + CSS environment lighting,
          both behind content (-z-10) and pointer-events-none (cannot collapse layout or block
          chat/voice/palette). AegisCoreCanvas = the living particle-sphere hero (ported from
          the v9 handoff, abstract only — no agents/labels/data). AegisAtmosphere = the
          command-bar light coupling + attention pulse. No data/labels/operational claims. */}
      <AegisCoreCanvas className="absolute inset-x-0 top-0 h-[82vh] -z-10" activity={aegisActivity} />
      <AegisAtmosphere className="absolute inset-0 -z-10" active={aegisActive} />
      <MinimalHeader aegisHome />
      <ThreatStatusBar />
      {/* Slice 1b presence band — shrink-0 sibling (same structural role as ThreatStatusBar);
          type/spacing polish only. Does NOT wrap/constrain the assistant; no overlay, no
          deep-space wrapper, no external fonts, no min-height. Assistant container unchanged. */}
      {/* P0 voice-first Home: greeting only by default — NO persistent client selector, chip,
          list, or client-context claim. The sole context line is a truthful, fail-closed
          tenant note shown ONLY when tenant scope is unavailable after resolution. Client
          context is summoned/conversational (deferred), never a persistent control. */}
      <section className="relative z-10 shrink-0 px-4 sm:px-6 pt-2.5 sm:pt-3 pb-1 text-center">
        <h1 className="font-serif text-base sm:text-lg font-normal text-foreground/70 leading-tight tracking-tight">
          {greetingPrefix()}, {firstNameOf(user)}.
        </h1>
        {/* Persistent tenant/context selector for global roles (super_admin/admin).
            EXPLICIT selection only — no auto-select across tenants. Selecting a tenant
            establishes context (setCurrentTenant) BEFORE voice can start, and the
            selection stays visibly shown here. Non-global roles auto-hydrate their
            single tenant and see only the truthful fail-closed note. */}
        {!tenantResolving && canChangeClientContextViaAegis && tenants.length > 0 ? (
          <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" aria-hidden="true" />
            <label htmlFor="home-tenant-select">Context:</label>
            <select
              id="home-tenant-select"
              className="bg-secondary/60 border border-border rounded px-2 py-1 text-foreground max-w-[60vw]"
              value={currentTenant?.id ?? ""}
              onChange={(e) => {
                const t = tenants.find((x) => x.id === e.target.value) ?? null;
                setCurrentTenant(t);
              }}
            >
              <option value="">Select a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {currentTenant
              ? <span className="text-primary/80">· {currentTenant.name} active</span>
              : <span>· voice waits for selection</span>}
          </div>
        ) : tenantNote ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" aria-hidden="true" />
            {tenantNote}
          </p>
        ) : null}
      </section>
      {/* Slice 2A-R2: chat seated INSIDE the canvas. Centered command-surface width; canvasMode
          de-chromes the assistant (transparent card, slimmed internal header, command-bar input)
          so the backdrop core shows through and the page reads as one interface, not stacked
          sections. relative z-10 keeps content above the -z-10 backdrop. */}
      <main className="relative z-10 flex-1 flex flex-col overflow-hidden">
        {/* pb-24 below lg lifts the command bar above the global SupportChatWidget FAB
            (fixed bottom-6 right-6, h-14) so Send/Mic stay fully visible + tappable on
            mobile/tablet/narrow widths. At lg+ the centered max-w-3xl pill never reaches the
            bottom-right corner, so pb-3 is safe and desktop spacing is unchanged. */}
        <div className="w-full max-w-3xl mx-auto flex-1 flex flex-col min-h-0 px-2 sm:px-4 pb-24 lg:pb-3">
          <DashboardAIAssistant fullScreen canvasMode onActivity={setAegisActivity} />
        </div>
      </main>
    </div>
  );
};

export default Index;
