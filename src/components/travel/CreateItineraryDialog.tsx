import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Upload } from "lucide-react";

interface CreateItineraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateItineraryDialog({ open, onOpenChange }: CreateItineraryDialogProps) {
  const queryClient = useQueryClient();
  const [selectedTraveler, setSelectedTraveler] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

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

  const createMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      let filePath = null;
      if (uploadedFile) {
        const fileExt = uploadedFile.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('travel-documents')
          .upload(fileName, uploadedFile);
        
        if (uploadError) throw uploadError;
        filePath = fileName;
      }

      const flightNumbers = (formData.get("flight_numbers") as string)
        .split(",")
        .map(f => f.trim())
        .filter(Boolean);

      const { error } = await supabase.from("itineraries").insert({
        traveler_id: selectedTraveler,
        trip_name: formData.get("trip_name") as string,
        trip_type: formData.get("trip_type") as string,
        departure_date: formData.get("departure_date") as string,
        return_date: formData.get("return_date") as string,
        origin_city: formData.get("origin_city") as string,
        origin_country: formData.get("origin_country") as string,
        destination_city: formData.get("destination_city") as string,
        destination_country: formData.get("destination_country") as string,
        flight_numbers: flightNumbers,
        hotel_name: formData.get("hotel_name") as string,
        hotel_address: formData.get("hotel_address") as string,
        notes: formData.get("notes") as string,
        file_path: filePath,
        monitoring_enabled: monitoringEnabled,
        created_by: user?.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["itineraries"] });
      toast.success("Itinerary created successfully");
      onOpenChange(false);
      setUploadedFile(null);
    },
    onError: (error) => {
      toast.error("Failed to create itinerary: " + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Travel Itinerary</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="trip_name">Trip Name *</Label>
              <Input id="trip_name" name="trip_name" required />
            </div>

            <div className="space-y-2">
              <Label>Traveler *</Label>
              <Select value={selectedTraveler} onValueChange={setSelectedTraveler} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select traveler" />
                </SelectTrigger>
                <SelectContent>
                  {travelers?.map((traveler) => (
                    <SelectItem key={traveler.id} value={traveler.id}>
                      {traveler.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Trip Type *</Label>
              <Select name="trip_type" defaultValue="international" required>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="international">International</SelectItem>
                  <SelectItem value="domestic">Domestic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flight_numbers">Flight Numbers (comma-separated)</Label>
              <Input id="flight_numbers" name="flight_numbers" placeholder="AA123, BA456" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="departure_date">Departure Date *</Label>
              <Input id="departure_date" name="departure_date" type="datetime-local" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="return_date">Return Date *</Label>
              <Input id="return_date" name="return_date" type="datetime-local" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="origin_city">Origin City *</Label>
              <Input id="origin_city" name="origin_city" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="origin_country">Origin Country *</Label>
              <Input id="origin_country" name="origin_country" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="destination_city">Destination City *</Label>
              <Input id="destination_city" name="destination_city" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination_country">Destination Country *</Label>
              <Input id="destination_country" name="destination_country" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hotel_name">Hotel Name</Label>
              <Input id="hotel_name" name="hotel_name" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hotel_address">Hotel Address</Label>
              <Input id="hotel_address" name="hotel_address" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="itinerary_file">Upload Itinerary Document</Label>
            <div className="flex items-center gap-2">
              <Input
                id="itinerary_file"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
              />
              {uploadedFile && (
                <span className="text-sm text-muted-foreground">{uploadedFile.name}</span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="monitoring">Enable AI Monitoring</Label>
              <p className="text-sm text-muted-foreground">
                Automatically monitor for risks and disruptions
              </p>
            </div>
            <Switch
              id="monitoring"
              checked={monitoringEnabled}
              onCheckedChange={setMonitoringEnabled}
            />
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
              {createMutation.isPending ? "Creating..." : "Create Itinerary"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
