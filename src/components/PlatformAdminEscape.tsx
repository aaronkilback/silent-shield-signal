import { ArrowLeft, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/hooks/useTenant";
import { useSwitchTenant } from "@/hooks/useSwitchTenant";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { toast } from "sonner";

// Always-visible super_admin escape hatch. Strictly hidden from
// non-super_admin users so tenant operators never see platform chrome.
//
// Two modes:
//   1. Observing a tenant (currentTenant set AND !isAllTenantsView):
//      "Exit Tenant View" button. Click calls enterPlatformView() which
//      clears selected client, sets all-tenants view, drops the active
//      tenant, and invalidates queries.
//   2. Already in platform view (no tenant or isAllTenantsView):
//      "Tenants" button. Click navigates to /super-admin so super_admin
//      can pick a tenant to observe.
//
// Mounted in Header (PageLayout) and MinimalHeader (home/aegis pages)
// so it travels with the operator across every page in the app.
export const PlatformAdminEscape = () => {
  const { isSuperAdmin, isLoading } = useIsSuperAdmin();
  const { currentTenant, isAllTenantsView } = useTenant();
  const { enterPlatformView } = useSwitchTenant();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (!isSuperAdmin) return null;

  const inTenantContext = !!currentTenant && !isAllTenantsView;

  if (inTenantContext) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          enterPlatformView();
          toast.success("Exited tenant view — returned to platform admin");
        }}
        className="gap-1.5 border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
        title="Exit tenant context and return to the global platform view"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Exit Tenant View</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate("/super-admin")}
      className="gap-1.5 text-muted-foreground hover:text-foreground"
      title="Open Super Admin dashboard to switch into a tenant"
    >
      <Globe className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Tenants</span>
    </Button>
  );
};
