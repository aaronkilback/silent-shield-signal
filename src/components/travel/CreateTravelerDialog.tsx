import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useClientSelection } from "@/hooks/useClientSelection";

interface CreateTravelerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLORS = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

export function CreateTravelerDialog({ open, onOpenChange }: CreateTravelerDialogProps) {
  const queryClient = useQueryClient();
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const { selectedClientId } = useClientSelection();

  const createMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase.from("travelers").insert({
        name: formData.get("name") as string,
        email: formData.get("email") as string,
        phone: formData.get("phone") as string,
        passport_number: formData.get("passport_number") as string,
        passport_expiry: formData.get("passport_expiry") as string || null,
        emergency_contact_name: formData.get("emergency_contact_name") as string,
        emergency_contact_phone: formData.get("emergency_contact_phone") as string,
        notes: formData.get("notes") as string,
        map_color: selectedColor,
        created_by: user?.id,
        client_id: selectedClientId || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["travelers"] });
      toast.success("Traveler created successfully");
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Failed to create traveler: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Traveler</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="passport_number">Passport Number</Label>
              <Input id="passport_number" name="passport_number" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="passport_expiry">Passport Expiry</Label>
            <Input id="passport_expiry" name="passport_expiry" type="date" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="emergency_contact_name">Emergency Contact Name</Label>
              <Input id="emergency_contact_name" name="emergency_contact_name" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="emergency_contact_phone">Emergency Contact Phone</Label>
              <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Map Marker Color</Label>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-full border-2 ${
                    selectedColor === color ? "border-primary" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Traveler"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
