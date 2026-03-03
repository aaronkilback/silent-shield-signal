import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { Settings, Plug, CheckCircle, Bug, UserCog, Building2, Shield, Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EmbeddedProvider } from "@/hooks/useIsEmbedded";

const IntegrationsContent = lazy(() => import("./Integrations"));
const RuleApprovalsContent = lazy(() => import("./RuleApprovals"));
const BugReportsContent = lazy(() => import("./BugReports"));
const UserManagementContent = lazy(() => import("./UserManagement"));
const TenantAdminContent = lazy(() => import("./TenantAdmin"));
const SuperAdminContent = lazy(() => import("./SuperAdminDashboard"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const Admin = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "integrations";
  const { isSuperAdmin, isAdmin } = useUserRole();

  const { data: pendingApprovals } = useQuery({
    queryKey: ['admin-pending-approvals-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('monitoring_proposals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count || 0;
    },
    enabled: isAdmin || isSuperAdmin,
    refetchInterval: 30000,
  });

  const handleTabChange = (value: string) => {
    setSearchParams(value === "integrations" ? {} : { tab: value });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <Settings className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Administration</h1>
            <p className="text-muted-foreground">
              System configuration, approvals, and user management
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="integrations" className="gap-2">
              <Plug className="h-3.5 w-3.5" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="approvals" className="gap-2">
              <CheckCircle className="h-3.5 w-3.5" />
              Approvals
              {pendingApprovals && pendingApprovals > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {pendingApprovals}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="bugs" className="gap-2">
              <Bug className="h-3.5 w-3.5" />
              System Stability
            </TabsTrigger>
            {(isAdmin || isSuperAdmin) && (
              <TabsTrigger value="users" className="gap-2">
                <UserCog className="h-3.5 w-3.5" />
                Users
              </TabsTrigger>
            )}
            {isSuperAdmin && (
              <>
                <TabsTrigger value="tenant" className="gap-2">
                  <Building2 className="h-3.5 w-3.5" />
                  Tenant Settings
                </TabsTrigger>
                <TabsTrigger value="super-admin" className="gap-2">
                  <Shield className="h-3.5 w-3.5" />
                  Super Admin
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="integrations">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider><IntegrationsContent /></EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="approvals">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider><RuleApprovalsContent /></EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="bugs">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider><BugReportsContent /></EmbeddedProvider>
            </Suspense>
          </TabsContent>

          {(isAdmin || isSuperAdmin) && (
            <TabsContent value="users">
              <Suspense fallback={<TabLoader />}>
                <EmbeddedProvider><UserManagementContent /></EmbeddedProvider>
              </Suspense>
            </TabsContent>
          )}

          {isSuperAdmin && (
            <>
              <TabsContent value="tenant">
                <Suspense fallback={<TabLoader />}>
                  <EmbeddedProvider><TenantAdminContent /></EmbeddedProvider>
                </Suspense>
              </TabsContent>

              <TabsContent value="super-admin">
                <Suspense fallback={<TabLoader />}>
                  <EmbeddedProvider><SuperAdminContent /></EmbeddedProvider>
                </Suspense>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default Admin;
