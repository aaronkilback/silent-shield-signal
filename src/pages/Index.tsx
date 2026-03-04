import { DashboardAIAssistant } from "@/components/DashboardAIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { MinimalHeader } from "@/components/MinimalHeader";
import { ThreatStatusBar } from "@/components/ThreatStatusBar";
import { Loader2 } from "lucide-react";

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MinimalHeader />
      <ThreatStatusBar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <DashboardAIAssistant fullScreen />
      </main>
    </div>
  );
};

export default Index;
