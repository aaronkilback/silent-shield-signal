import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plane, Clock, ShieldCheck, Plus, ArrowRight, LifeBuoy, ListChecks } from "lucide-react";
import { format } from "date-fns";
import { useMyTravel } from "@/hooks/useMyTravel";
import { MyAlerts } from "@/components/traveller/MyAlerts";
import { TravellerEmptyState } from "@/components/traveller/TravellerEmptyState";
import { AegisCore, type AegisCoreState } from "@/components/traveller/AegisCore";

/**
 * Traveller Aegis Home (Slice D2.1) — Aegis-first primary interface at /my-travel.
 *
 * Aegis (animated, presence-led) is the front door; the trip card + alerts are secondary.
 * Everything here is DETERMINISTIC and frontend-only: data comes from get-my-travel (read);
 * the command input does local keyword→intent routing (NO LLM, NO network AI, NO retrieval);
 * quick actions route into the already-proven safe flows — trip intake (/my-travel/new-trip →
 * traveller-trip-intake) and check-in/assistance (trip detail → traveller-journey-status). No
 * operator chrome, no tenant/client selector, no other travellers, no operator data, no
 * operational writes, and no "monitored" claim before operator approval.
 */
const BG = "radial-gradient(95% 70% at 50% 8%, #0e1626, #0a0e18 46%, #050609)";
const chip = "inline-flex items-center gap-1.5 rounded-full border border-[#28406f] bg-[#0b1424] px-3 py-2 text-xs text-[#cfe0ff] hover:border-[#5e9bff] hover:bg-[#11203a] transition-colors disabled:opacity-40";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function MyTravelPortal() {
  const { data, isLoading, isError } = useMyTravel();
  const navigate = useNavigate();
  const [focused, setFocused] = useState(false);
  const [cmd, setCmd] = useState("");
  const [aegisLine, setAegisLine] = useState<string | null>(null);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}><Loader2 className="h-6 w-6 animate-spin text-[#5e9bff]" /></div>;
  }

  const linked = !!data?.linked && !isError;
  const itineraries = data?.itineraries ?? [];
  const alerts = data?.alerts ?? [];
  const nextTrip = itineraries[0];
  const fmt = (d: string | null) => { try { return d ? format(new Date(d), "MMM d, yyyy") : "—"; } catch { return "—"; } };

  const coreState: AegisCoreState = focused ? "listening" : "idle";

  // Calm status summary (computed from get-my-travel only).
  const overdue = itineraries.filter((i) => i.journey_overdue === true).length;
  const activeAlerts = alerts.filter((a) => a.is_active !== false).length;
  const status = !linked
    ? "Your profile isn't linked yet."
    : overdue > 0 ? `${overdue} trip${overdue > 1 ? "s" : ""} need a check-in.`
    : activeAlerts > 0 ? `${activeAlerts} active alert${activeAlerts > 1 ? "s" : ""}.`
    : itineraries.length > 0 ? `${itineraries.length} upcoming trip${itineraries.length > 1 ? "s" : ""}. All clear.`
    : "No upcoming trips. All clear.";

  const goCheckIn = () => { if (nextTrip) navigate(`/my-travel/itinerary/${nextTrip.id}`); else setAegisLine("You don't have a trip yet — tell me about one first."); };
  const whatsMissing = () => {
    const bits: string[] = [];
    if (overdue > 0) bits.push(`${overdue} trip${overdue > 1 ? "s" : ""} overdue for check-in`);
    const noStatus = itineraries.filter((i) => !i.journey_status).length;
    if (noStatus > 0) bits.push(`${noStatus} trip${noStatus > 1 ? "s" : ""} with no check-in yet`);
    if (!itineraries.length) bits.push("no trips on file yet");
    setAegisLine(bits.length ? `Here's what needs attention: ${bits.join("; ")}.` : "Nothing's missing right now — you're all set.");
  };

  // Deterministic command routing — local keyword match, NO LLM / NO network.
  const runCommand = () => {
    const q = cmd.trim().toLowerCase();
    if (!q) return;
    setCmd("");
    if (/(trip|travel|europe|plan|going)/.test(q)) navigate("/my-travel/new-trip");
    else if (/(help|assist|sos|emergency|danger)/.test(q)) { if (nextTrip) navigate(`/my-travel/itinerary/${nextTrip.id}`); else setAegisLine("Tell me about a trip first, then I can help with assistance."); }
    else if (/(check|safe|arriv|pickup|vehicle|status)/.test(q)) goCheckIn();
    else if (/(missing|incomplete|need)/.test(q)) whatsMissing();
    else if (/(next|upcoming)/.test(q)) setAegisLine(nextTrip ? `Your next trip: ${nextTrip.trip_name ?? "Trip"}.` : "No upcoming trips yet.");
    else setAegisLine("I can help you add a trip, check in, request assistance, or tell you what's missing. Try one of those.");
  };

  return (
    <div className="min-h-screen" style={{ background: BG, color: "#e8eef2" }}>
      <header className="px-4 py-3 border-b border-[#1a2740]">
        <span className="font-mono text-xs tracking-[0.3em] text-[#8fb0ff]">AEGIS · FORTRESS</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16 pt-6 space-y-6">
        {/* Aegis presence */}
        <section className="flex flex-col items-center text-center gap-2">
          <AegisCore state={coreState} />
          <p className="font-serif text-2xl text-[#f4f1ea] mt-1">{greeting()}{linked && nextTrip ? "" : "."}{linked && nextTrip ? "." : ""}</p>
          <p className="text-sm text-[#8fb0ff] max-w-sm">{status}</p>
          {aegisLine && <p className="font-serif text-[15px] text-[#cfe0ff] max-w-sm mt-1">{aegisLine}</p>}
        </section>

        {linked ? (
          <>
            {/* command bar (deterministic) */}
            <div className="flex items-center gap-2">
              <input
                value={cmd} onChange={(e) => setCmd(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={(e) => { if (e.key === "Enter") runCommand(); }}
                placeholder="Ask Aegis… (e.g. “I'm going to Europe in September”)"
                className="flex-1 h-12 rounded-[32px] bg-[#0b1424] border border-[#28406f] px-5 text-sm text-[#e8eef2] placeholder:text-[#5e6c86] focus:outline-none focus:border-[#5e9bff]"
              />
            </div>

            {/* quick actions */}
            <div className="flex flex-wrap gap-2 justify-center">
              <Link to="/my-travel/new-trip" className={chip}><Plus className="h-3.5 w-3.5" />Tell Fortress about a trip</Link>
              <button className={chip} onClick={() => setAegisLine(nextTrip ? `Your next trip: ${nextTrip.trip_name ?? "Trip"} (${fmt(nextTrip.departure_date)}).` : "No upcoming trips yet.")}><ArrowRight className="h-3.5 w-3.5" />What's next?</button>
              <button className={chip} onClick={goCheckIn} disabled={!nextTrip}><ShieldCheck className="h-3.5 w-3.5" />Check in</button>
              <button className={chip} onClick={goCheckIn} disabled={!nextTrip}><LifeBuoy className="h-3.5 w-3.5" />I need assistance</button>
              <button className={chip} onClick={whatsMissing}><ListChecks className="h-3.5 w-3.5" />What's missing?</button>
            </div>

            {/* secondary: trips */}
            <section className="space-y-2">
              <h2 className="font-mono text-[11px] tracking-[0.28em] text-[#5e6c86]">YOUR TRIPS</h2>
              {itineraries.length === 0 ? (
                <p className="text-sm text-[#5e6c86]">No upcoming trips. Tell Aegis about one to get started.</p>
              ) : itineraries.map((i) => (
                <Link key={i.id} to={`/my-travel/itinerary/${i.id}`} className="block">
                  <div className="rounded-xl p-4 border border-[#1a2740] bg-[#0b1424]/60 hover:border-[#28406f] transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium flex items-center gap-2 text-[#e8eef2]"><Plane className="h-4 w-4 text-[#5e9bff]" />{i.trip_name ?? "Trip"}</div>
                        <div className="text-xs text-[#8fb0ff] mt-1">{[i.origin_city, i.destination_city].filter(Boolean).join(" → ")}</div>
                        <div className="text-xs text-[#5e6c86] mt-0.5">{fmt(i.departure_date)} – {fmt(i.return_date)}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {i.journey_status && <span className="text-xs text-[#8fb0ff]">{({ safe: "Safe", arrived: "Arrived", at_pickup: "At pickup", in_vehicle: "In the vehicle", need_assistance: "Assistance requested" } as Record<string, string>)[i.journey_status.event_type] ?? i.journey_status.event_type}</span>}
                        {i.journey_overdue === true && <span className="text-xs text-[#ff8a52] flex items-center gap-1"><Clock className="h-3 w-3" />Check-in due</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </section>

            {/* secondary: alerts */}
            <section className="space-y-2">
              <h2 className="font-mono text-[11px] tracking-[0.28em] text-[#5e6c86]">ACTIVE ALERTS</h2>
              <MyAlerts alerts={alerts} />
            </section>
          </>
        ) : (
          <div className="pt-2"><TravellerEmptyState /></div>
        )}
      </main>
    </div>
  );
}
