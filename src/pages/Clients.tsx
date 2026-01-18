import { PageLayout } from "@/components/PageLayout";
import { ClientOnboarding } from "@/components/ClientOnboarding";
import { ClientRiskSnapshot } from "@/components/ClientRiskSnapshot";
import { ClientSelector } from "@/components/ClientSelector";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

const Clients = () => {
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
      <ClientOnboarding />
      <ClientSelector mode="navigate" />
      <ClientRiskSnapshot />
    </PageLayout>
  );
};

export default Clients;
