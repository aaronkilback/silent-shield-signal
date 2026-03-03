import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { Bot, Swords, Loader2 } from "lucide-react";
import { EmbeddedProvider } from "@/hooks/useIsEmbedded";

const CommandCenterContent = lazy(() => import("./CommandCenter"));
const TaskForceContent = lazy(() => import("./TaskForce"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const Agents = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "roster";

  const handleTabChange = (value: string) => {
    setSearchParams(value === "roster" ? {} : { tab: value });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Agents</h1>
            <p className="text-muted-foreground">
              AI agent roster and multi-agent task force operations
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="roster" className="gap-2">
              <Bot className="h-3.5 w-3.5" />
              Agent Roster
            </TabsTrigger>
            <TabsTrigger value="task-force" className="gap-2">
              <Swords className="h-3.5 w-3.5" />
              Task Force
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roster">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <CommandCenterContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="task-force">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <TaskForceContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default Agents;
