import { Header } from "@/components/Header";
import { SignalHistory } from "@/components/SignalHistory";
import { UnifiedDocumentUpload } from "@/components/UnifiedDocumentUpload";
import { ArchivalDocumentsList } from "@/components/ArchivalDocumentsList";
import { ReprocessDocuments } from "@/components/ReprocessDocuments";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Signals = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Signals & Archives</h1>
          <p className="text-muted-foreground mt-2">
            Intelligence signals and archival document management
          </p>
        </div>

        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">Upload Documents</TabsTrigger>
            <TabsTrigger value="signals">Signal Feed</TabsTrigger>
            <TabsTrigger value="documents">Document Library</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <UnifiedDocumentUpload />
          </TabsContent>

          <TabsContent value="signals" className="space-y-6">
            <SignalHistory />
          </TabsContent>

          <TabsContent value="documents" className="space-y-6">
            <ReprocessDocuments />
            <ArchivalDocumentsList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Signals;
