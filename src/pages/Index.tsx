import { PageLayout } from "@/components/PageLayout";
import { DashboardClientSelector } from "@/components/ClientSelector";
import { MonitoringHistory } from "@/components/MonitoringHistory";
import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { LiveEventFeed } from "@/components/LiveEventFeed";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (!user && !loading) {
    return null;
  }

  return (
    <PageLayout loading={loading}>
      <DashboardClientSelector />
      <DashboardAIAssistant />
      <LiveEventFeed />
      <MonitoringHistory />
    </PageLayout>
  );
};

export default Index;
