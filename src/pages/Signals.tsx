import { PageLayout } from "@/components/PageLayout";
import { SignalHistory } from "@/components/SignalHistory";
import { UnifiedDocumentUpload } from "@/components/UnifiedDocumentUpload";
import { ArchivalDocumentsList } from "@/components/ArchivalDocumentsList";
import { ReprocessDocuments } from "@/components/ReprocessDocuments";
import { DashboardClientSelector } from "@/components/DashboardClientSelector";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Signals = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (!user && !loading) {
    return null;
  }

  return (
    <PageLayout 
      loading={loading}
      title="Signals & Archives"
      description="Intelligence signals and archival document management"
    >
      <DashboardClientSelector />

      <Tabs defaultValue="signals" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upload">Upload Documents</TabsTrigger>
          <TabsTrigger value="signals">Signal Feed</TabsTrigger>
          <TabsTrigger value="documents">Document Library</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Document Upload">
            <UnifiedDocumentUpload />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="signals" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Signal History">
            <SignalHistory />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="documents" className="space-y-6 min-h-[400px]">
          <ErrorBoundary context="Document Library">
            <ReprocessDocuments />
            <ArchivalDocumentsList />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
};

export default Signals;
