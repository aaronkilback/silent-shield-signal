import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Clock } from "lucide-react";
import { format } from "date-fns";
import { useMyTravel } from "@/hooks/useMyTravel";
import { MyAlerts } from "@/components/traveller/MyAlerts";
import { TravellerJourneyStatus } from "@/components/traveller/TravellerJourneyStatus";

/**
 * Traveller Portal v1 — My Itinerary Detail (screen 2). Read-only.
 * Passes itineraryId as a FILTER-ONLY param to get-my-travel; ownership is
 * re-established server-side, so an unowned id simply yields nothing.
 */
export default function MyItineraryDetail() {
  const { itineraryId } = useParams();
  const { data, isLoading, isError } = useMyTravel(itineraryId);
  const fmt = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy") : "—"; } catch { return "—"; } };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  const itin = !isError && data?.linked ? (data.itineraries ?? []).find((i) => i.id === itineraryId) : undefined;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3 flex items-center gap-2">
        <Link to="/my-travel" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-lg font-semibold">Trip detail</h1>
      </header>
      <main className="max-w-2xl mx-auto p-4 space-y-6">
        {!itin ? (
          <p className="text-sm text-muted-foreground">This trip isn't available.</p>
        ) : (
          <>
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{itin.trip_name ?? "Trip"}</div>
                {itin.status && <Badge variant="secondary">{itin.status}</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">{itin.trip_type ?? "trip"}</div>
              <div className="text-sm">{[itin.origin_city, itin.origin_country].filter(Boolean).join(", ")} → {[itin.destination_city, itin.destination_country].filter(Boolean).join(", ")}</div>
              <div className="text-sm text-muted-foreground">{fmt(itin.departure_date)} – {fmt(itin.return_date)}</div>
              {itin.hotel_name && <div className="text-sm">Hotel: {itin.hotel_name}</div>}
              {itin.trip_type === "ground" && (
                <div className="text-sm flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {itin.journey_overdue ? "Check-in overdue" : `Next check-in: ${fmt(itin.next_check_in_due_at)}`}
                </div>
              )}
            </Card>
            <TravellerJourneyStatus itinerary={itin} />
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Alerts for this trip</h2>
              <MyAlerts alerts={(data!.alerts ?? []).filter((a) => a.itinerary_id === itineraryId)} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
