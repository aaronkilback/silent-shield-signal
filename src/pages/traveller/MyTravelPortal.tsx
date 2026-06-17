import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plane, Clock, MapPin } from "lucide-react";
import { format } from "date-fns";
import { useMyTravel } from "@/hooks/useMyTravel";
import { MyAlerts } from "@/components/traveller/MyAlerts";
import { TravellerEmptyState } from "@/components/traveller/TravellerEmptyState";

/**
 * Traveller Portal v1 — My Travel Overview (screen 1).
 * Read-only. Only data source = get-my-travel (via useMyTravel). No tenant/client
 * selector, no operator nav, no Aegis chat, no mutation buttons.
 */
export default function MyTravelPortal() {
  const { data, isLoading, isError } = useMyTravel();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return <Shell><p className="text-sm text-muted-foreground">Couldn't load your travel right now. Please try again later.</p></Shell>;
  }
  if (!data?.linked) {
    return <Shell><TravellerEmptyState /></Shell>;
  }

  const itineraries = data.itineraries ?? [];
  const now = Date.now();
  const fmt = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy") : "—"; } catch { return "—"; } };

  return (
    <Shell>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upcoming trips</h2>
        {itineraries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming trips.</p>
        ) : itineraries.map((i) => {
          const overdue = i.journey_overdue || (i.next_check_in_due_at && new Date(i.next_check_in_due_at).getTime() < now);
          return (
            <Link key={i.id} to={`/my-travel/itinerary/${i.id}`} className="block">
              <Card className="p-4 hover:bg-accent/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium flex items-center gap-2"><Plane className="h-4 w-4" />{i.trip_name ?? "Trip"}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{[i.origin_city, i.destination_city].filter(Boolean).join(" → ")}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{fmt(i.departure_date)} – {fmt(i.return_date)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {i.status && <Badge variant="secondary">{i.status}</Badge>}
                    {i.journey_status && (
                      <span className="text-xs text-muted-foreground">
                        {({ safe: "Safe", arrived: "Arrived", at_pickup: "At pickup", in_vehicle: "In the vehicle", need_assistance: "Assistance requested" } as Record<string, string>)[i.journey_status.event_type] ?? i.journey_status.event_type}
                      </span>
                    )}
                    {i.trip_type === "ground" && (
                      <span className={`text-xs flex items-center gap-1 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                        <Clock className="h-3 w-3" />{overdue ? "Check-in overdue" : "Check-in ok"}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Active alerts</h2>
        <MyAlerts alerts={data.alerts ?? []} />
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3"><h1 className="text-lg font-semibold">My Travel</h1></header>
      <main className="max-w-2xl mx-auto p-4 space-y-8">{children}</main>
    </div>
  );
}
