import { useState } from "react";
import { Header } from "@/components/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Key, Webhook, FileJson, Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ApiKeysManager } from "@/components/integrations/ApiKeysManager";
import { WebhooksManager } from "@/components/integrations/WebhooksManager";
import { ApiDocumentation } from "@/components/integrations/ApiDocumentation";
import { ApiUsageLogs } from "@/components/integrations/ApiUsageLogs";

const Integrations = () => {
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
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="text-muted-foreground mt-2">
            Manage API access, webhooks, and external system integrations
          </p>
        </div>

        <Tabs defaultValue="api-keys" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="flex items-center gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="documentation" className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              API Docs
            </TabsTrigger>
            <TabsTrigger value="usage" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Usage Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys">
            <ErrorBoundary context="API Keys Manager">
              <ApiKeysManager />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="webhooks">
            <ErrorBoundary context="Webhooks Manager">
              <WebhooksManager />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="documentation">
            <ErrorBoundary context="API Documentation">
              <ApiDocumentation />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="usage">
            <ErrorBoundary context="API Usage Logs">
              <ApiUsageLogs />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Integrations;
