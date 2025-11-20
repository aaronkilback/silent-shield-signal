import { Header } from "@/components/Header";
import { SignalHistory } from "@/components/SignalHistory";
import { SignalIngestForm } from "@/components/SignalIngestForm";
import { ArchivalDocumentUpload } from "@/components/ArchivalDocumentUpload";
import { ArchivalDocumentsList } from "@/components/ArchivalDocumentsList";
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

        <Tabs defaultValue="signals" className="space-y-6">
          <TabsList>
            <TabsTrigger value="signals">Current Signals</TabsTrigger>
            <TabsTrigger value="archival">Archival Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="signals" className="space-y-6">
            <SignalHistory />
            <SignalIngestForm />
          </TabsContent>

          <TabsContent value="archival" className="space-y-6">
            <ArchivalDocumentUpload />
            <ArchivalDocumentsList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Signals;
