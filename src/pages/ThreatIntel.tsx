import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { Radar, Brain, BarChart3, ScanEye, Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { EmbeddedProvider } from "@/hooks/useIsEmbedded";

const ThreatRadarContent = lazy(() => import("./ThreatRadar"));
const IntelligenceHubContent = lazy(() => import("./IntelligenceHub"));
const MatchingDashboardContent = lazy(() => import("./MatchingDashboard"));
const VIPDeepScanContent = lazy(() => import("./VIPDeepScan"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const ThreatIntel = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "radar";
  const { isSuperAdmin } = useUserRole();

  const handleTabChange = (value: string) => {
    setSearchParams(value === "radar" ? {} : { tab: value });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <Radar className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Threat Intelligence</h1>
            <p className="text-muted-foreground">
              Proactive threat analysis, intelligence search, and signal matching
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="radar" className="gap-2">
              <Radar className="h-3.5 w-3.5" />
              Threat Radar
            </TabsTrigger>
            <TabsTrigger value="intel-hub" className="gap-2">
              <Brain className="h-3.5 w-3.5" />
              Intelligence Hub
            </TabsTrigger>
            <TabsTrigger value="matching" className="gap-2">
              <BarChart3 className="h-3.5 w-3.5" />
              Signal Matching
            </TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="vip-scan" className="gap-2">
                <ScanEye className="h-3.5 w-3.5" />
                VIP Deep Scan
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="radar">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <ThreatRadarContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="intel-hub">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <IntelligenceHubContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="matching">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <MatchingDashboardContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent value="vip-scan">
              <Suspense fallback={<TabLoader />}>
                <EmbeddedProvider>
                  <VIPDeepScanContent />
                </EmbeddedProvider>
              </Suspense>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default ThreatIntel;
