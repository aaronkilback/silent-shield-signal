import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useOrientationEmail } from "@/hooks/useOrientationEmail";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
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
    <div className="min-h-screen bg-background flex flex-col">
      <MinimalHeader aegisHome />
      <ThreatStatusBar />
      {/* Slice 1a greeting — a shrink-0 sibling (same structural role as ThreatStatusBar);
          does NOT wrap or constrain the assistant. No deep-space, no fonts, no min-height. */}
      <section className="shrink-0 px-4 sm:px-6 pt-4 pb-2 text-center">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground leading-tight">
          {greetingPrefix()}, {firstNameOf(user)}.
        </h1>
        <p className="text-sm text-primary mt-0.5">{presenceLine}</p>
      </section>
      <main className="flex-1 flex flex-col overflow-hidden">
        <DashboardAIAssistant fullScreen />
      </main>
    </div>
  );
};

export default Index;
