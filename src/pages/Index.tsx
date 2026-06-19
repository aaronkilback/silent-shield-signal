import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useOrientationEmail } from "@/hooks/useOrientationEmail";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
import { AegisCore } from "@/components/aegis/AegisCore";
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
  const presenceLine = selectedClientId
    ? "Watching the selected client context."
    : "Standing by — select a client to begin operational context.";

  return (
    // Slice 1b: paint-only premium polish. Subtle vertical gradient on the EXISTING wrapper
    // (theme palette, not a deep-space radial); structure unchanged (min-h-screen flex flex-col).
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(180deg, hsl(222 47% 7%) 0%, hsl(222 47% 5%) 60%, hsl(222 47% 4%) 100%)" }}
    >
      <MinimalHeader aegisHome />
      <ThreatStatusBar />
      {/* Slice 1b presence band — shrink-0 sibling (same structural role as ThreatStatusBar);
          type/spacing polish only. Does NOT wrap/constrain the assistant; no overlay, no
          deep-space wrapper, no external fonts, no min-height. Assistant container unchanged. */}
      {/* Slice 1c: mobile/responsive polish — tighten the band's base (mobile) padding and
          greeting size so it doesn't dominate small screens or push chat below the fold.
          All sm: values unchanged → desktop renders identically. No new classes/fonts. */}
      <section className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-8 pb-3 sm:pb-4 text-center border-b border-border/40">
        <h1 className="font-serif text-2xl sm:text-4xl text-foreground leading-tight tracking-tight">
          {greetingPrefix()}, {firstNameOf(user)}.
        </h1>
        <p className="inline-flex items-center gap-2 text-sm text-primary/90 mt-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-pulse" aria-hidden="true" />
          {presenceLine}
        </p>
      </section>
      {/* Slice 2A: contained, decorative Aegis Core. Bounded height (shrink-0) so it never
          overlaps the chat; pointer-events-none + aria-hidden so it can't intercept chat/
          voice/⌘K; small on mobile to keep the chat reachable (1c discipline). No data,
          no labels, no operational claims, no overlay, no full-page wrapper. */}
      <AegisCore className="shrink-0 h-24 sm:h-44 md:h-52" />
      <main className="flex-1 flex flex-col overflow-hidden">
        <DashboardAIAssistant fullScreen />
      </main>
    </div>
  );
};

export default Index;
