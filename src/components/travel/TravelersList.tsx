import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Phone, Mail, Pencil, Trash2 } from "lucide-react";
import { CreateTravelerDialog } from "./CreateTravelerDialog";
import { EditTravelerDialog } from "./EditTravelerDialog";
import { toast } from "sonner";
import { useClientSelection } from "@/hooks/useClientSelection";

export function TravelersList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTraveler, setEditingTraveler] = useState<any>(null);
  const queryClient = useQueryClient();
  const { selectedClientId } = useClientSelection();

  const { data: travelers, isLoading } = useQuery({
    queryKey: ["travelers", selectedClientId],
    queryFn: async () => {
      let query = supabase
        .from("travelers")
        .select("*");
      
      if (selectedClientId) {
        query = query.eq("client_id", selectedClientId);
      }
      
      const { data, error } = await query.order("name");
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("travelers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travelers"] });
      toast.success("Traveler deleted");
    },
  });

  const isActive = (status: string) => {
    return status === "traveling" || status === "at-risk";
  };

  const activeTravelers = travelers?.filter((t) => isActive(t.status)) || [];
  const inactiveTravelers = travelers?.filter((t) => !isActive(t.status)) || [];

  if (isLoading) {
    return <div>Loading travelers...</div>;
  }

  const renderTravelerCard = (traveler: any) => (
    <Card key={traveler.id} className="p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              isActive(traveler.status) ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <h3 className="font-semibold">{traveler.name}</h3>
        </div>
        <Badge variant="outline">{traveler.status}</Badge>
      </div>

      <div className="space-y-2 text-sm text-muted-foreground">
        {traveler.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {traveler.email}
          </div>
        )}
        {traveler.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            {traveler.phone}
          </div>
        )}
        {traveler.current_location && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {traveler.current_location}
          </div>
        )}
      </div>

      {traveler.last_location_update && (
        <div className="text-xs text-muted-foreground">
          Last updated: {new Date(traveler.last_location_update).toLocaleString()}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <div
          className="w-6 h-6 rounded-full border-2 border-border"
          style={{ backgroundColor: traveler.map_color }}
          title="Map marker color"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditingTraveler(traveler)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm("Are you sure you want to delete this traveler?")) {
                deleteMutation.mutate(traveler.id);
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Travelers</h2>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Traveler
        </Button>
      </div>

      {/* Active Travelers Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <h3 className="text-lg font-semibold">
            Active ({activeTravelers.length})
          </h3>
        </div>
        {activeTravelers.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeTravelers.map(renderTravelerCard)}
          </div>
        ) : (
          <Card className="p-6 text-center text-muted-foreground">
            No active travelers
          </Card>
        )}
      </div>

      {/* Inactive Travelers Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <h3 className="text-lg font-semibold">
            Inactive ({inactiveTravelers.length})
          </h3>
        </div>
        {inactiveTravelers.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inactiveTravelers.map(renderTravelerCard)}
          </div>
        ) : (
          <Card className="p-6 text-center text-muted-foreground">
            No inactive travelers
          </Card>
        )}
      </div>

      <CreateTravelerDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
      
      {editingTraveler && (
        <EditTravelerDialog
          open={!!editingTraveler}
          onOpenChange={(open) => !open && setEditingTraveler(null)}
          traveler={editingTraveler}
        />
      )}
    </div>
  );
}
