import { Header } from "@/components/Header";
import { ExecutiveReportGenerator } from "@/components/ExecutiveReportGenerator";
import { RiskSnapshotExport } from "@/components/RiskSnapshotExport";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2, FileText } from "lucide-react";

const Reports = () => {
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
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-lg bg-primary/10">
            <FileText className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Reports</h1>
            <p className="text-muted-foreground">Generate and export security intelligence reports</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <ExecutiveReportGenerator />
          <RiskSnapshotExport />
        </div>
      </main>
    </div>
  );
};

export default Reports;
