import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useOrientationEmail } from "@/hooks/useOrientationEmail";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
import { AegisCoreCanvas } from "@/components/aegis/AegisCoreCanvas";
import { AegisAtmosphere } from "@/components/aegis/AegisAtmosphere";
import { Loader2 } from "lucide-react";

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
  const { currentTenant, isAllTenantsView } = useTenant();
  const { selectedClientId } = useClientSelection();
  const navigate = useNavigate();

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

  // Truthful presence line from EXISTING selectedClientId state — no new query, no fallback.
  // Honesty pass: no active-monitoring claim; "standing by" reflects what is actually true.
  const presenceLine = selectedClientId
    ? "Standing by in selected client context."
    : "Standing by — select a client to begin operational context.";

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
      <AegisCoreCanvas className="absolute inset-x-0 top-0 h-[82vh] -z-10" />
      <AegisAtmosphere className="absolute inset-0 -z-10" />
      <MinimalHeader aegisHome />
      <ThreatStatusBar />
      {/* Slice 1b presence band — shrink-0 sibling (same structural role as ThreatStatusBar);
          type/spacing polish only. Does NOT wrap/constrain the assistant; no overlay, no
          deep-space wrapper, no external fonts, no min-height. Assistant container unchanged. */}
      {/* Slice 2A-Reframe v2 (polish): greeting demoted further to a QUIET caption so it does
          not compete with the core hero. Smaller/lighter type + minimal footprint; presence
          line stays truthful/non-operational. */}
      <section className="relative z-10 shrink-0 px-4 sm:px-6 pt-2.5 sm:pt-3 pb-1 text-center">
        <h1 className="font-serif text-base sm:text-lg font-normal text-foreground/70 leading-tight tracking-tight">
          {greetingPrefix()}, {firstNameOf(user)}.
        </h1>
        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
          <span className="w-1 h-1 rounded-full bg-primary/70 motion-safe:animate-pulse" aria-hidden="true" />
          {presenceLine}
        </p>
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
          <DashboardAIAssistant fullScreen canvasMode />
        </div>
      </main>
    </div>
  );
};

export default Index;
