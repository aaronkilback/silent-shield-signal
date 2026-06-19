import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useOrientationEmail } from "@/hooks/useOrientationEmail";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, loading } = useAuth();
  const { currentTenant, isAllTenantsView } = useTenant();
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MinimalHeader />
      <ThreatStatusBar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <DashboardAIAssistant fullScreen />
      </main>
    </div>
  );
};

export default Index;
