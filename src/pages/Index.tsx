import { Header } from "@/components/Header";
import { MetricsPanel } from "@/components/MetricsPanel";
import { LiveEventFeed } from "@/components/LiveEventFeed";
import { TripwireAlerts } from "@/components/TripwireAlerts";
import { RiskSnapshot } from "@/components/RiskSnapshot";
import { SignalIngestForm } from "@/components/SignalIngestForm";
import { SLAMetrics } from "@/components/SLAMetrics";
import { RiskSnapshotExport } from "@/components/RiskSnapshotExport";
import AutonomousSystemStatus from "@/components/AutonomousSystemStatus";
import LearningDashboard from "@/components/LearningDashboard";
import EscalationRulesManager from "@/components/EscalationRulesManager";
import { ExecutiveReportGenerator } from "@/components/ExecutiveReportGenerator";
import { TestSignalGenerator } from "@/components/TestSignalGenerator";
import { SignalHistory } from "@/components/SignalHistory";
import { DashboardClientSelector } from "@/components/DashboardClientSelector";
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
        <SignalHistory />
        <MetricsPanel />
        
        <div className="grid grid-cols-1 gap-6">
          <LearningDashboard />
          <EscalationRulesManager />
        </div>
        
        <div className="grid grid-cols-1 gap-6">
          <ExecutiveReportGenerator />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <TestSignalGenerator />
            <SignalIngestForm />
            <SLAMetrics />
            <TripwireAlerts />
            <LiveEventFeed />
          </div>
          <div className="space-y-6">
            <RiskSnapshotExport />
            <RiskSnapshot />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
