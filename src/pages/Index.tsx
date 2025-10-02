import { Header } from "@/components/Header";
import { MetricsPanel } from "@/components/MetricsPanel";
import { EventFeed } from "@/components/EventFeed";
import { TripwireAlerts } from "@/components/TripwireAlerts";
import { RiskSnapshot } from "@/components/RiskSnapshot";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <MetricsPanel />
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <TripwireAlerts />
            <EventFeed />
          </div>
          <div>
            <RiskSnapshot />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
