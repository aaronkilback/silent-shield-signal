import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemanticSearchPanel } from "@/components/intelligence/SemanticSearchPanel";
import { EmbeddingManager } from "@/components/intelligence/EmbeddingManager";
import { AudioBriefingPanel } from "@/components/intelligence/AudioBriefingPanel";
import { Search, Database, Volume2 } from "lucide-react";

const IntelligenceHub = () => {
  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intelligence Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Semantic search across all documents and signals · AI-powered audio briefings
          </p>
        </div>

        <Tabs defaultValue="search" className="space-y-4">
          <TabsList>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-3.5 w-3.5" />
              Semantic Search
            </TabsTrigger>
            <TabsTrigger value="embeddings" className="gap-2">
              <Database className="h-3.5 w-3.5" />
              Embeddings
            </TabsTrigger>
            <TabsTrigger value="audio" className="gap-2">
              <Volume2 className="h-3.5 w-3.5" />
              Audio Briefings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search">
            <SemanticSearchPanel />
          </TabsContent>

          <TabsContent value="embeddings">
            <EmbeddingManager />
          </TabsContent>

          <TabsContent value="audio">
            <AudioBriefingPanel />
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
};

export default IntelligenceHub;
