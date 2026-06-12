import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useClientSelection } from "@/hooks/useClientSelection";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; }

// Journey Management create form. L1C: passenger picker + insert scoped to the
// selected client; fail closed if none selected.
export function CreateJourneyDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { selectedClientId } = useClientSelection();
  const [riskLevel, setRiskLevel] = useState("low");
  const [selectedPassengers, setSelectedPassengers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: travelers = [] } = useQuery({
    queryKey: ["travelers", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data, error } = await supabase
        .from("travelers").select("id, name").eq("client_id", selectedClientId).order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedClientId && open,
  });

  const togglePassenger = (id: string) =>
    setSelectedPassengers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const createMutation = useMutation({
    mutationFn: async (form: FormData) => {
      if (!selectedClientId) throw new Error("Select a client before creating a journey.");
      if (selectedPassengers.length === 0) throw new Error("Select at least one traveller (the lead).");
      const interval = parseInt(form.get("check_in_interval_minutes") as string) || null;
      const departure = form.get("departure_date") as string;
      const lead = selectedPassengers[0];
      const journey_plan = {
        driver: (form.get("driver") as string) || null,
        vehicle: (form.get("vehicle") as string) || null,
        journey_manager: (form.get("journey_manager") as string) || null,
        route: (form.get("route") as string) || null,
        no_go: (form.get("no_go") as string) || null,
      };
      const next_due = interval && departure
        ? new Date(new Date(departure).getTime() + interval * 60 * 1000).toISOString()
        : null;

      const { data: itin, error } = await supabase.from("itineraries").insert({
        client_id: selectedClientId,
        traveler_id: lead,
        trip_name: form.get("trip_name") as string,
        trip_type: "ground",
        departure_date: departure,
        return_date: (form.get("return_date") as string) || departure,
        origin_city: form.get("origin_city") as string,
        origin_country: form.get("origin_country") as string,
        destination_city: form.get("destination_city") as string,
        destination_country: form.get("destination_country") as string,
        status: "active",
        monitoring_enabled: true,
        risk_level: riskLevel,
        journey_plan,
        check_in_interval_minutes: interval,
        next_check_in_due_at: next_due,
      }).select("id").single();
      if (error) throw error;

      // Passenger party (L1C: stamp client_id). Lead first, rest as passengers.
      const rows = selectedPassengers.map((tid, i) => ({
        itinerary_id: itin.id,
        traveler_id: tid,
        role: i === 0 ? "lead" : "passenger",
        client_id: selectedClientId,
      }));
      const { error: pErr } = await supabase.from("itinerary_travelers").insert(rows);
      if (pErr) throw pErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ground-journeys", selectedClientId] });
      toast.success("Journey created");
      setSelectedPassengers([]); setRiskLevel("low");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to create journey"),
  });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    try { await createMutation.mutateAsync(new FormData(e.currentTarget)); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Ground Journey</DialogTitle></DialogHeader>
        {!selectedClientId ? (
          <p className="text-muted-foreground py-6">Select a client first.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="trip_name">Journey name</Label>
              <Input id="trip_name" name="trip_name" required placeholder="e.g. Camp resupply run" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Origin city</Label><Input name="origin_city" required /></div>
              <div><Label>Origin country</Label><Input name="origin_country" required /></div>
              <div><Label>Destination city</Label><Input name="destination_city" required /></div>
              <div><Label>Destination country</Label><Input name="destination_country" required /></div>
            </div>
            <div><Label>Route / waypoints</Label><Input name="route" placeholder="e.g. Hwy 97 via Fort St. John" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Departure</Label><Input type="datetime-local" name="departure_date" required /></div>
              <div><Label>ETA / return</Label><Input type="datetime-local" name="return_date" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Driver</Label><Input name="driver" placeholder="Driver name" /></div>
              <div><Label>Vehicle</Label><Input name="vehicle" placeholder="Truck / plate / tracker" /></div>
              <div><Label>Journey manager</Label><Input name="journey_manager" placeholder="Who monitors check-ins" /></div>
              <div>
                <Label>Risk level</Label>
                <Select value={riskLevel} onValueChange={setRiskLevel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Check-in interval (minutes)</Label><Input type="number" name="check_in_interval_minutes" min={5} placeholder="e.g. 60 (blank = none)" /></div>
            </div>
            <div><Label>No-go windows / constraints</Label><Textarea name="no_go" placeholder="e.g. No night driving after 20:00" rows={2} /></div>

            <div>
              <Label>Passengers (first = lead) — {selectedClientId ? "this client only" : ""}</Label>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                {travelers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No travellers for this client yet — add one in the Travellers tab first.</p>
                ) : travelers.map((t: any) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selectedPassengers.includes(t.id)} onCheckedChange={() => togglePassenger(t.id)} />
                    <span>{t.name}{selectedPassengers[0] === t.id ? " (lead)" : ""}</span>
                  </label>
                ))}
              </div>
            </div>


            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create Journey"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
