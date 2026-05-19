import { ShieldAlert } from "lucide-react";
import { useTenant } from "@/hooks/useTenant";

// Operator-integrity indicator. Renders any time a super_admin is
// operating in a non-default scope (a specific tenant OR the "All
// Tenants" view), regardless of whether the super_admin is also a
// tenant member of that tenant. The point is the operator must never
// be unsure what scope their actions are landing in.
//
// Bug 2 (2026-05-19): the prior version gated solely on
// `isPlatformAdminView` (true only when the super_admin had no
// tenant_users row for the viewed tenant). That hid the banner for
// the common case of a super_admin viewing a tenant they own,
// leaving silent scope drift invisible.
//
// The sub-line about limited tenant-action UI is still keyed on
// `isPlatformAdminView` — that part is about RBAC and only applies
// when the super_admin is not a member of the viewed tenant.
export const PlatformAdminBanner = () => {
  const {
    isSuperAdmin,
    isPlatformAdminView,
    isHydrating,
    currentTenant,
    isAllTenantsView,
  } = useTenant();

  if (isHydrating) return null;
  if (!isSuperAdmin) return null;
  if (!currentTenant && !isAllTenantsView) return null;

  const scopeLabel = isAllTenantsView ? "ALL TENANTS" : currentTenant?.name;

  return (
    <div
      role="status"
      aria-label="super-admin scope indicator"
      data-testid="super-admin-scope-banner"
      className="w-full bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-b border-amber-300 dark:border-amber-700 px-4 py-2 text-xs sm:text-sm flex items-center gap-2"
    >
      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
      <span>
        <strong>Super-admin scope:</strong>{" "}
        <code className="font-mono">{scopeLabel}</code>
        {isPlatformAdminView && currentTenant && (
          <> &middot; You are not a tenant member; tenant membership&ndash;based actions may be limited.</>
        )}
      </span>
    </div>
  );
};
