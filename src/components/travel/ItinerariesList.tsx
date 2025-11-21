import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar, MapPin, Plane, AlertCircle, Pencil, Trash2 } from "lucide-react";
import { CreateItineraryDialog } from "./CreateItineraryDialog";
import { EditItineraryDialog } from "./EditItineraryDialog";
import { format } from "date-fns";
import { toast } from "sonner";

export function ItinerariesList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingItinerary, setEditingItinerary] = useState<any>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("itineraries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["itineraries"] });
      toast.success("Itinerary deleted");
    },
  });

  const { data: itineraries, isLoading } = useQuery({
    queryKey: ["itineraries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("itineraries")
        .select(`
          *,
          travelers:traveler_id (name, map_color)
        `)
        .order("departure_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const getRiskColor = (level: string) => {
    switch (level) {
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "secondary";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "upcoming":
        return "secondary";
      case "completed":
        return "outline";
      default:
        return "secondary";
    }
  };

  if (isLoading) {
    return <div>Loading itineraries...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Itineraries</h2>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Itinerary
        </Button>
      </div>

      <div className="grid gap-4">
        {itineraries?.map((itinerary) => (
          <Card key={itinerary.id} className="p-4">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-lg">{itinerary.trip_name}</h3>
                  <Badge variant={getStatusColor(itinerary.status)}>
                    {itinerary.status}
                  </Badge>
                  <Badge variant={getRiskColor(itinerary.risk_level || "low")}>
                    {itinerary.risk_level} risk
                  </Badge>
                  {itinerary.monitoring_enabled && (
                    <Badge variant="outline" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Monitoring Active
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: (itinerary.travelers as any)?.map_color }}
                  />
                  <span>{(itinerary.travelers as any)?.name}</span>
                  <span>•</span>
                  <Badge variant="outline">{itinerary.trip_type}</Badge>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Departure:</span>
                  <span>{format(new Date(itinerary.departure_date), "PPP")}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {itinerary.origin_city}, {itinerary.origin_country}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Return:</span>
                  <span>{format(new Date(itinerary.return_date), "PPP")}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {itinerary.destination_city}, {itinerary.destination_country}
                  </span>
                </div>
              </div>
            </div>

            {itinerary.flight_numbers && itinerary.flight_numbers.length > 0 && (
              <div className="flex items-center gap-2 text-sm mb-2">
                <Plane className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Flights:</span>
                <span>{itinerary.flight_numbers.join(", ")}</span>
              </div>
            )}

            {itinerary.hotel_name && (
              <div className="text-sm text-muted-foreground mb-3">
                <span className="font-medium">Hotel:</span> {itinerary.hotel_name}
                {itinerary.hotel_address && ` - ${itinerary.hotel_address}`}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingItinerary(itinerary)}
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm("Are you sure you want to delete this itinerary?")) {
                    deleteMutation.mutate(itinerary.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </div>
          </Card>
        ))}

        {itineraries?.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No itineraries found. Create one to start tracking travel.
          </Card>
        )}
      </div>

      <CreateItineraryDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      {editingItinerary && (
        <EditItineraryDialog
          open={!!editingItinerary}
          onOpenChange={(open) => !open && setEditingItinerary(null)}
          itinerary={editingItinerary}
        />
      )}
    </div>
  );
}
