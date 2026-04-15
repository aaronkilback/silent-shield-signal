import { PageLayout } from "@/components/PageLayout";
import { VIPDeepScanWizard } from "@/components/vip-deep-scan";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { Shield, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const VIPDeepScan = () => {
  const { user, loading } = useAuth();
  const { isSuperAdmin, isLoading: roleLoading } = useIsSuperAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (!user && !loading) {
    return null;
  }

  const isPageLoading = loading || roleLoading;

  // Access denied for non-super_admin users
  if (!isPageLoading && !isSuperAdmin) {
    return (
      <PageLayout loading={false}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md w-full border-destructive/50">
            <CardHeader className="text-center">
              <div className="mx-auto p-3 rounded-full bg-destructive/10 w-fit mb-4">
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <CardTitle className="text-xl">Access Restricted</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                Vulnerability Scan is only available to Super Admin users. This feature handles sensitive executive protection data and requires elevated privileges.
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Shield className="w-4 h-4" />
                <span>Super Admin access required</span>
              </div>
              <Button onClick={() => navigate("/")} className="mt-4">
                Return to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout loading={isPageLoading} contentOverflow="auto">
      <VIPDeepScanWizard />
    </PageLayout>
  );
};

export default VIPDeepScan;
