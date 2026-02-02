import { useState } from "react";
import { PageLayout } from "@/components/PageLayout";
import { ConsortiumDashboard, IntelBriefingGenerator, SharedIntelDashboard } from "@/components/consortium";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useUserConsortia } from "@/hooks/useConsortia";
import { Shield, FileText, Share2, BarChart3 } from "lucide-react";

const Consortia = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState("consortia");
  const { data: consortia } = useUserConsortia();
  const firstConsortiumId = consortia?.[0]?.id;

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (!user && !loading) {
    return null;
  }

  return (
    <PageLayout loading={loading}>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-lg bg-primary/10">
          <Share2 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Intelligence Sharing</h1>
          <p className="text-muted-foreground">
            Secure consortium-based intelligence dissemination
          </p>
        </div>
      </div>
      
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="consortia" className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Consortia
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="flex items-center gap-2" disabled={!firstConsortiumId}>
            <BarChart3 className="w-4 h-4" />
            Intel Dashboard
          </TabsTrigger>
          <TabsTrigger value="briefings" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Briefings
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="consortia">
          <ConsortiumDashboard />
        </TabsContent>
        
        <TabsContent value="dashboard">
          {firstConsortiumId && <SharedIntelDashboard consortiumId={firstConsortiumId} />}
        </TabsContent>
        
        <TabsContent value="briefings">
          <IntelBriefingGenerator />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
};

export default Consortia;
