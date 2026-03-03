import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Database, Globe, Share2, Loader2 } from "lucide-react";
import { EmbeddedProvider } from "@/hooks/useIsEmbedded";

const KnowledgeBaseContent = lazy(() => import("./KnowledgeBase"));
const KnowledgeBankContent = lazy(() => import("./KnowledgeBank"));
const SourcesContent = lazy(() => import("./Sources"));
const ConsortiaContent = lazy(() => import("./Consortia"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const Intelligence = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "knowledge-base";

  const handleTabChange = (value: string) => {
    setSearchParams(value === "knowledge-base" ? {} : { tab: value });
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Intelligence</h1>
            <p className="text-muted-foreground">
              Knowledge management, OSINT sources, and intel sharing
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="knowledge-base" className="gap-2">
              <BookOpen className="h-3.5 w-3.5" />
              Knowledge Base
            </TabsTrigger>
            <TabsTrigger value="knowledge-bank" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              Knowledge Bank
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-2">
              <Globe className="h-3.5 w-3.5" />
              Sources & OSINT
            </TabsTrigger>
            <TabsTrigger value="consortia" className="gap-2">
              <Share2 className="h-3.5 w-3.5" />
              Intel Sharing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="knowledge-base">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <KnowledgeBaseContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="knowledge-bank">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <KnowledgeBankContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="sources">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <SourcesContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>

          <TabsContent value="consortia">
            <Suspense fallback={<TabLoader />}>
              <EmbeddedProvider>
                <ConsortiaContent />
              </EmbeddedProvider>
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default Intelligence;
