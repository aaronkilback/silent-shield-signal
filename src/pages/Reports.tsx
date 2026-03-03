import { Header } from "@/components/Header";
import { useIsEmbedded } from "@/hooks/useIsEmbedded";
import { ExecutiveReportGenerator } from "@/components/ExecutiveReportGenerator";
import { RiskSnapshotExport } from "@/components/RiskSnapshotExport";
import { SecurityBulletinGenerator } from "@/components/SecurityBulletinGenerator";
import { ReportArchive } from "@/components/reports/ReportArchive";
import { ReportScheduleManager } from "@/components/reports/ReportScheduleManager";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2, FileText, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Reports = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isEmbedded = useIsEmbedded();

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

  const reportsContent = (
    <>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <FileText className="w-6 h-6 text-primary" />
          </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reports</h1>
              <p className="text-muted-foreground">Generate, archive, and schedule intelligence reports</p>
            </div>
          </div>
          <Link to="/benchmark">
            <Button variant="outline">
              <Target className="w-4 h-4 mr-2" />
              Benchmark Extraction
            </Button>
          </Link>
        </div>

        {/* Report Archive */}
        <ReportArchive />

        {/* Scheduled Reports */}
        <ReportScheduleManager />

        {/* Generators */}
        <div className="grid grid-cols-1 gap-6">
          <SecurityBulletinGenerator />
          <ExecutiveReportGenerator />
          <RiskSnapshotExport />
        </div>
    </>
  );

  if (isEmbedded) {
    return <div className="space-y-6">{reportsContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {reportsContent}
      </main>
    </div>
  );
};

export default Reports;
