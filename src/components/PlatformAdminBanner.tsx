import { ShieldAlert } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";

// Renders a warning strip when a super_admin is observing a tenant they have
// no explicit tenant_users row for. Tenant-action UI is still gated on
// tenant_role (see useTenant), so this banner is informational — it tells the
// operator why owner/admin controls may be hidden.
export const PlatformAdminBanner = () => {
  const { isPlatformAdminView, currentTenant } = useTenant();
  if (!isPlatformAdminView || !currentTenant) return null;

  return (
    <div className="w-full bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-b border-amber-300 dark:border-amber-700 px-4 py-2 text-xs sm:text-sm flex items-center gap-2">
      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
      <span>
        <strong>Platform admin view —</strong> you are not a tenant member of{" "}
        <code className="font-mono">{currentTenant.name}</code>. Tenant
        membership–based actions may be limited. Platform-admin actions remain
        available where permitted.
      </span>
    </div>
  );
};
