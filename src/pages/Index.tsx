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

// Slice 1 (presence-led home) — local-only helpers; no data queries.
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

  // Truthful presence line — derived only from the EXISTING selectedClientId state.
  // No new data query, no tenant-wide fallback, no fabricated status.
  const presenceLine = selectedClientId
    ? "Watching the selected client context."
    : "Standing by — select a client to begin operational context.";

  return (
    <div className="min-h-screen aegis-deepspace flex flex-col" style={{ color: "#e8eef2" }}>
      <MinimalHeader aegisHome />
      <ThreatStatusBar />
      {/* Aegis presence band — compact, presence-led (Slice 1). Visual only. */}
      <section className="px-4 sm:px-6 pt-5 pb-3 text-center shrink-0">
        <h1 className="font-aegis-serif text-3xl sm:text-4xl text-[#f4f1ea] leading-tight">
          {greetingPrefix()}, {firstNameOf(user)}.
        </h1>
        <p className="font-aegis-ui text-sm text-[#8fb0ff] mt-1">{presenceLine}</p>
      </section>
      <main className="flex-1 flex flex-col overflow-hidden">
        <DashboardAIAssistant fullScreen />
      </main>
    </div>
  );
};

export default Index;
