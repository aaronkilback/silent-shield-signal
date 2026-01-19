import { PageLayout } from "@/components/PageLayout";
import { VIPDeepScanWizard } from "@/components/vip-deep-scan";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

const VIPDeepScan = () => {
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
      <VIPDeepScanWizard />
    </PageLayout>
  );
};

export default VIPDeepScan;
