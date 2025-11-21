import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TravelersList } from "@/components/travel/TravelersList";
import { ItinerariesList } from "@/components/travel/ItinerariesList";
import { TravelAlertsPanel } from "@/components/travel/TravelAlertsPanel";
import { TravelersMap } from "@/components/travel/TravelersMap";
import { Plane, Users, AlertTriangle, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function Travel() {
  const [activeTab, setActiveTab] = useState("travelers");

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

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Travel Management</h1>
        <p className="text-muted-foreground">
          Monitor and manage business travel with AI-powered risk detection
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
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

        <TabsContent value="map" className="space-y-4">
          <TravelersMap />
        </TabsContent>
      </Tabs>
    </div>
  );
}
