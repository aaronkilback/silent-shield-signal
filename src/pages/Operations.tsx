import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { Radio, AlertTriangle, GitMerge, Loader2 } from "lucide-react";
import { EmbeddedProvider } from "@/hooks/useIsEmbedded";
import { EscalationPipeline } from "@/components/EscalationPipeline";

const SignalsContent = lazy(() => import("./Signals"));
const IncidentsContent = lazy(() => import("./Incidents"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const Operations = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "signals";

  const handleTabChange = (value: string) => {
    setSearchParams(value === "signals" ? {} : { tab: value });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <Radio className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Operations</h1>
            <p className="text-muted-foreground">
              Signal processing, incident management, and escalation
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="signals" className="gap-2">
              <Radio className="h-3.5 w-3.5" />
              Signals
            </TabsTrigger>
            <TabsTrigger value="incidents" className="gap-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              Incidents
            </TabsTrigger>
            <TabsTrigger value="escalation" className="gap-2">
              <GitMerge className="h-3.5 w-3.5" />
              Escalation Pipeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <SignalsContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="incidents">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <IncidentsContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="escalation">
            <EscalationPipeline />
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default Operations;
