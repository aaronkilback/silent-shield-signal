import { Header } from "@/components/Header";
import { SignalHistory } from "@/components/SignalHistory";
import { SignalIngestForm } from "@/components/SignalIngestForm";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const Signals = () => {
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
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Signals</h1>
          <p className="text-muted-foreground mt-2">
            All intelligence signals detected across OSINT sources
          </p>
        </div>
        <SignalHistory />
        <SignalIngestForm />
      </main>
    </div>
  );
};

export default Signals;
