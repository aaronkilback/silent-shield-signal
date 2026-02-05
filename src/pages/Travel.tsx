import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TravelersList } from "@/components/travel/TravelersList";
import { ItinerariesList } from "@/components/travel/ItinerariesList";
import { TravelAlertsPanel } from "@/components/travel/TravelAlertsPanel";
import { TravelersMap } from "@/components/travel/TravelersMap";
import { SecurityReportUpload } from "@/components/travel/SecurityReportUpload";
import { GenerateSecurityBriefing } from "@/components/travel/GenerateSecurityBriefing";
import { Plane, Users, AlertTriangle, MapPin, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

export default function Travel() {
  const [activeTab, setActiveTab] = useState("travelers");
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Archive completed itineraries on page load
  useEffect(() => {
    const archiveCompletedItineraries = async () => {
      try {
        await supabase.functions.invoke("archive-completed-itineraries");
      } catch (error) {
        console.error("Error archiving itineraries:", error);
      }
    };
    
    archiveCompletedItineraries();
  }, []);

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
      <div>
        <h1 className="text-3xl font-bold">Travel Management</h1>
        <p className="text-muted-foreground">
          Monitor and manage business travel with AI-powered risk detection
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="travelers" className="gap-2">
            <Users className="h-4 w-4" />
            Travelers
          </TabsTrigger>
          <TabsTrigger value="itineraries" className="gap-2">
            <Plane className="h-4 w-4" />
            Itineraries
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Alerts
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-2">
            <MapPin className="h-4 w-4" />
            Live Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="travelers" className="space-y-4">
          <TravelersList />
        </TabsContent>

        <TabsContent value="itineraries" className="space-y-4">
          <ItinerariesList />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <TravelAlertsPanel />
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <Tabs defaultValue="upload" className="w-full">
            <TabsList>
              <TabsTrigger value="upload">Upload Third-Party Report</TabsTrigger>
              <TabsTrigger value="generate">Generate Briefing</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="pt-4">
              <SecurityReportUpload />
            </TabsContent>
            <TabsContent value="generate" className="pt-4">
              <GenerateSecurityBriefing />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="map" className="space-y-4">
          <TravelersMap />
        </TabsContent>
      </Tabs>
      </main>
    </div>
  );
}
