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
  const [isParsing, setIsParsing] = useState(false);

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

  const parseItinerary = async (file: File) => {
    setIsParsing(true);
    try {
      // Upload file temporarily for parsing
      const fileExt = file.name.split(".").pop();
      const fileName = `temp-${crypto.randomUUID()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("travel-documents")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Parse with AI
      const { data, error } = await supabase.functions.invoke("parse-travel-itinerary", {
        body: { filePath: fileName },
      });

      if (error) throw error;

      if (data?.success && data?.data) {
        const parsed = data.data;
        
        // Auto-fill form fields from segment-based structure
        const form = document.getElementById("itinerary-form") as HTMLFormElement;
        if (form) {
          // Use trip_title for trip_name
          (form.elements.namedItem("trip_name") as HTMLInputElement).value = parsed.trip_title || "";
          
          // Extract origin/destination from first/last flight segments
          const flightSegments = parsed.segments?.filter((s: any) => s.type === "flight") || [];
          const hotelSegments = parsed.segments?.filter((s: any) => s.type === "hotel") || [];
          
          // Determine trip type based on origin/destination
          let tripType = "international";
          if (flightSegments.length > 0) {
            const firstFlight = flightSegments[0];
            const lastFlight = flightSegments[flightSegments.length - 1];
            
            // If origin and destination airports are both Canadian, it's domestic
            const canadianAirports = ["YYC", "YVR", "YYZ", "YUL", "YOW", "YHZ", "YWG", "YEG"];
            if (canadianAirports.includes(firstFlight.origin_airport_code) && 
                canadianAirports.includes(lastFlight.destination_airport_code)) {
              tripType = "domestic";
            }
            
            // Fill origin/destination from flights
            (form.elements.namedItem("origin_city") as HTMLInputElement).value = 
              firstFlight.origin_city || "";
            (form.elements.namedItem("origin_country") as HTMLInputElement).value = 
              tripType === "domestic" ? "Canada" : "";
            (form.elements.namedItem("destination_city") as HTMLInputElement).value = 
              firstFlight.destination_city || "";
            (form.elements.namedItem("destination_country") as HTMLInputElement).value = 
              tripType === "domestic" ? "Canada" : "";
          }
          
          (form.elements.namedItem("trip_type") as HTMLSelectElement).value = tripType;
          
          // Format dates for datetime-local input (YYYY-MM-DDTHH:MM)
          if (parsed.start_date) {
            // Convert YYYY-MM-DD to datetime-local format
            const startSegment = parsed.segments?.[0];
            if (startSegment?.start_datetime) {
              // Format: "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM"
              const formatted = startSegment.start_datetime.replace(" ", "T");
              (form.elements.namedItem("departure_date") as HTMLInputElement).value = formatted;
            } else {
              (form.elements.namedItem("departure_date") as HTMLInputElement).value = 
                parsed.start_date + "T00:00";
            }
          }
          
          if (parsed.end_date) {
            const lastSegment = parsed.segments?.[parsed.segments.length - 1];
            if (lastSegment?.end_datetime) {
              const formatted = lastSegment.end_datetime.replace(" ", "T");
              (form.elements.namedItem("return_date") as HTMLInputElement).value = formatted;
            } else {
              (form.elements.namedItem("return_date") as HTMLInputElement).value = 
                parsed.end_date + "T23:59";
            }
          }
          
          // Extract hotel info from hotel segments
          if (hotelSegments.length > 0) {
            const hotel = hotelSegments[0];
            (form.elements.namedItem("hotel_name") as HTMLInputElement).value = hotel.hotel_name || "";
            (form.elements.namedItem("hotel_address") as HTMLInputElement).value = hotel.hotel_address || "";
          }
          
          // Build flight numbers from all flight segments
          const flightNumbers = flightSegments
            .map((f: any) => f.flight_number)
            .filter((n: string) => n)
            .join(", ");
          if (flightNumbers) {
            (form.elements.namedItem("flight_numbers") as HTMLInputElement).value = flightNumbers;
          }
          
          // Combine notes from all segments
          const notes = parsed.segments
            ?.map((s: any) => s.notes)
            .filter((n: string) => n)
            .join("\n") || "";
          if (notes) {
            (form.elements.namedItem("notes") as HTMLTextAreaElement).value = notes;
          }
        }

        toast.success("Itinerary parsed successfully! Review and submit.");
      }

      // Clean up temporary file
      await supabase.storage.from("travel-documents").remove([fileName]);
    } catch (error) {
      console.error("Parse error:", error);
      toast.error("Failed to parse itinerary. Please fill manually.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadedFile(file);
    
    // Auto-parse PDF files
    if (file && file.type === "application/pdf") {
      await parseItinerary(file);
    }
  };

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

        <form id="itinerary-form" onSubmit={handleSubmit} className="space-y-4">
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
            <Label htmlFor="itinerary_file">Upload Itinerary (PDF auto-fills form)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="itinerary_file"
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileChange}
                disabled={isParsing}
              />
              {uploadedFile && (
                <span className="text-sm text-muted-foreground">{uploadedFile.name}</span>
              )}
            </div>
            {isParsing && (
              <p className="text-sm text-muted-foreground animate-pulse">
                Parsing document with AI...
              </p>
            )}
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
            <Button type="submit" disabled={createMutation.isPending || isParsing}>
              {isParsing ? "Parsing..." : createMutation.isPending ? "Creating..." : "Create Itinerary"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
