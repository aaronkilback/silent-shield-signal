import { Header } from "@/components/Header";
import { MetricsPanel } from "@/components/MetricsPanel";
import { SignalIngestForm } from "@/components/SignalIngestForm";
import AutonomousSystemStatus from "@/components/AutonomousSystemStatus";
import LearningDashboard from "@/components/LearningDashboard";
import { SignalHistory } from "@/components/SignalHistory";
import { DashboardClientSelector } from "@/components/DashboardClientSelector";
import { MonitoringHistory } from "@/components/MonitoringHistory";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <DashboardClientSelector />
        <AutonomousSystemStatus />
        <MonitoringHistory />
        <SignalHistory />
        <MetricsPanel />
        
        <div className="grid grid-cols-1 gap-6">
          <LearningDashboard />
        </div>
        
        <div className="grid grid-cols-1 gap-6">
          <SignalIngestForm />
        </div>
      </main>
    </div>
  );
};

export default Index;
