import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface EditTravelerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  traveler: any;
}

export function EditTravelerDialog({
  open,
  onOpenChange,
  traveler,
}: EditTravelerDialogProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const updates = {
      name: formData.get("name") as string,
      email: formData.get("email") as string || null,
      phone: formData.get("phone") as string || null,
      passport_number: formData.get("passport_number") as string || null,
      passport_expiry: formData.get("passport_expiry") as string || null,
      emergency_contact_name: formData.get("emergency_contact_name") as string || null,
      emergency_contact_phone: formData.get("emergency_contact_phone") as string || null,
      current_location: formData.get("current_location") as string || null,
      current_country: formData.get("current_country") as string || null,
      status: formData.get("status") as string,
      map_color: formData.get("map_color") as string,
      notes: formData.get("notes") as string || null,
    };

    const { error } = await supabase
      .from("travelers")
      .update(updates)
      .eq("id", traveler.id);

    setIsSubmitting(false);

    if (error) {
      toast.error("Failed to update traveler: " + error.message);
      return;
    }

    toast.success("Traveler updated successfully");
    queryClient.invalidateQueries({ queryKey: ["travelers"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Traveler</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                name="name"
                defaultValue={traveler.name}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={traveler.status}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="traveling">Traveling</SelectItem>
                  <SelectItem value="at-risk">At Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={traveler.email || ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={traveler.phone || ""}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="current_location">Current Location</Label>
              <Input
                id="current_location"
                name="current_location"
                defaultValue={traveler.current_location || ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="current_country">Current Country</Label>
              <Input
                id="current_country"
                name="current_country"
                defaultValue={traveler.current_country || ""}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="passport_number">Passport Number</Label>
              <Input
                id="passport_number"
                name="passport_number"
                defaultValue={traveler.passport_number || ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="passport_expiry">Passport Expiry</Label>
              <Input
                id="passport_expiry"
                name="passport_expiry"
                type="date"
                defaultValue={traveler.passport_expiry || ""}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_name">Emergency Contact Name</Label>
              <Input
                id="emergency_contact_name"
                name="emergency_contact_name"
                defaultValue={traveler.emergency_contact_name || ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="emergency_contact_phone">Emergency Contact Phone</Label>
              <Input
                id="emergency_contact_phone"
                name="emergency_contact_phone"
                type="tel"
                defaultValue={traveler.emergency_contact_phone || ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="map_color">Map Marker Color</Label>
            <Input
              id="map_color"
              name="map_color"
              type="color"
              defaultValue={traveler.map_color}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={traveler.notes || ""}
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
