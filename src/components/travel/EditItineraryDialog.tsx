import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface EditItineraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itinerary: any;
}

export function EditItineraryDialog({
  open,
  onOpenChange,
  itinerary,
}: EditItineraryDialogProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: travelers } = useQuery({
    queryKey: ["travelers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travelers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const updates = {
      traveler_id: formData.get("traveler_id") as string,
      trip_name: formData.get("trip_name") as string,
      trip_type: formData.get("trip_type") as string,
      origin_city: formData.get("origin_city") as string,
      origin_country: formData.get("origin_country") as string,
      destination_city: formData.get("destination_city") as string,
      destination_country: formData.get("destination_country") as string,
      departure_date: formData.get("departure_date") as string,
      return_date: formData.get("return_date") as string,
      status: formData.get("status") as string,
      hotel_name: formData.get("hotel_name") as string || null,
      hotel_address: formData.get("hotel_address") as string || null,
      flight_numbers: (formData.get("flight_numbers") as string)
        ?.split(",")
        .map(f => f.trim())
        .filter(Boolean) || [],
      monitoring_enabled: formData.get("monitoring_enabled") === "on",
      notes: formData.get("notes") as string || null,
    };

    const { error } = await supabase
      .from("itineraries")
      .update(updates)
      .eq("id", itinerary.id);

    setIsSubmitting(false);

    if (error) {
      toast.error("Failed to update itinerary: " + error.message);
      return;
    }

    toast.success("Itinerary updated successfully");
    queryClient.invalidateQueries({ queryKey: ["itineraries"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Itinerary</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="traveler_id">Traveler *</Label>
              <Select name="traveler_id" defaultValue={itinerary.traveler_id} required>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {travelers?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={itinerary.status}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="trip_name">Trip Name *</Label>
            <Input
              id="trip_name"
              name="trip_name"
              defaultValue={itinerary.trip_name}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="trip_type">Trip Type</Label>
            <Select name="trip_type" defaultValue={itinerary.trip_type}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domestic">Domestic</SelectItem>
                <SelectItem value="international">International</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="origin_city">Origin City *</Label>
              <Input
                id="origin_city"
                name="origin_city"
                defaultValue={itinerary.origin_city}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="origin_country">Origin Country *</Label>
              <Input
                id="origin_country"
                name="origin_country"
                defaultValue={itinerary.origin_country}
                required
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="destination_city">Destination City *</Label>
              <Input
                id="destination_city"
                name="destination_city"
                defaultValue={itinerary.destination_city}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination_country">Destination Country *</Label>
              <Input
                id="destination_country"
                name="destination_country"
                defaultValue={itinerary.destination_country}
                required
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="departure_date">Departure Date *</Label>
              <Input
                id="departure_date"
                name="departure_date"
                type="datetime-local"
                defaultValue={itinerary.departure_date?.replace("Z", "")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="return_date">Return Date *</Label>
              <Input
                id="return_date"
                name="return_date"
                type="datetime-local"
                defaultValue={itinerary.return_date?.replace("Z", "")}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flight_numbers">Flight Numbers (comma-separated)</Label>
            <Input
              id="flight_numbers"
              name="flight_numbers"
              placeholder="AC123, UA456"
              defaultValue={itinerary.flight_numbers?.join(", ") || ""}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hotel_name">Hotel Name</Label>
              <Input
                id="hotel_name"
                name="hotel_name"
                defaultValue={itinerary.hotel_name || ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hotel_address">Hotel Address</Label>
              <Input
                id="hotel_address"
                name="hotel_address"
                defaultValue={itinerary.hotel_address || ""}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="monitoring_enabled"
              name="monitoring_enabled"
              defaultChecked={itinerary.monitoring_enabled}
            />
            <Label htmlFor="monitoring_enabled">Enable Risk Monitoring</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={itinerary.notes || ""}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
