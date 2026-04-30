// build: 2026-03-16
import React, { lazy, Suspense, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ClientSelectionProvider } from "@/hooks/useClientSelection";
import SupportChatWidget from "@/components/SupportChatWidget";
import { RealtimeNotifications } from "@/components/RealtimeNotifications";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProactiveAgentMessages } from "@/components/agents/ProactiveAgentMessages";
import { ContextualKnowledgeWidget } from "@/components/agents/ContextualKnowledgeWidget";
import { CommandPalette } from "@/components/CommandPalette";
import { EnsureDefaultRole } from "@/components/EnsureDefaultRole";
import { TenantProvider } from "@/hooks/useTenant";
import { PasswordExpiryGuard } from "@/components/PasswordExpiryGuard";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// Reload on chunk load failure (stale bundle after new deploy)
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch(() => {
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    })
  );
}

// Lazy-loaded pages
const Index = lazyWithRetry(() => import("./pages/Index"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Clients = lazyWithRetry(() => import("./pages/Clients"));
const ClientDetail = lazyWithRetry(() => import("./pages/ClientDetail"));
const Incidents = lazyWithRetry(() => import("./pages/Incidents"));
const Signals = lazyWithRetry(() => import("./pages/Signals"));
const Sources = lazyWithRetry(() => import("./pages/Sources"));
const Entities = lazyWithRetry(() => import("./pages/Entities"));
const Reports = lazyWithRetry(() => import("./pages/Reports"));
const Investigations = lazyWithRetry(() => import("./pages/Investigations"));
const InvestigationDetail = lazyWithRetry(() => import("./pages/InvestigationDetail"));
const Travel = lazyWithRetry(() => import("./pages/Travel"));
const KnowledgeBase = lazyWithRetry(() => import("./pages/KnowledgeBase"));
const BugReports = lazyWithRetry(() => import("./pages/BugReports"));
const RuleApprovals = lazyWithRetry(() => import("./pages/RuleApprovals"));
const Benchmark = lazyWithRetry(() => import("./pages/Benchmark"));
const UserManagement = lazyWithRetry(() => import("./pages/UserManagement"));
const CommandCenter = lazyWithRetry(() => import("./pages/CommandCenter"));
const TaskForce = lazyWithRetry(() => import("./pages/TaskForce"));
const ThreatRadar = lazyWithRetry(() => import("./pages/ThreatRadar"));
const Integrations = lazyWithRetry(() => import("./pages/Integrations"));
const MatchingDashboard = lazyWithRetry(() => import("./pages/MatchingDashboard"));
const Workspace = lazyWithRetry(() => import("./pages/Workspace"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const InviteRequired = lazyWithRetry(() => import("./pages/InviteRequired"));
const AcceptInvite = lazyWithRetry(() => import("./pages/AcceptInvite"));
const TenantAdmin = lazyWithRetry(() => import("./pages/TenantAdmin"));
const Welcome = lazyWithRetry(() => import("./pages/Welcome"));
const SuperAdminDashboard = lazyWithRetry(() => import("./pages/SuperAdminDashboard"));
const VIPDeepScan = lazyWithRetry(() => import("./pages/VIPDeepScan"));
const Consortia = lazyWithRetry(() => import("./pages/Consortia"));
const IntelligenceHub = lazyWithRetry(() => import("./pages/IntelligenceHub"));
const BriefingFeedback = lazyWithRetry(() => import("./pages/BriefingFeedback"));
const NeuralConstellation = lazyWithRetry(() => import("./pages/NeuralConstellation"));
const KnowledgeBank = lazyWithRetry(() => import("./pages/KnowledgeBank"));
const SecurityAdvisor = lazyWithRetry(() => import("./pages/SecurityAdvisor"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const ClientAuthorization = lazyWithRetry(() => import("./pages/ClientAuthorization"));
const Agents = lazyWithRetry(() => import("./pages/Agents"));
const AgentActions = lazyWithRetry(() => import("./pages/AgentActions"));
const Intelligence = lazyWithRetry(() => import("./pages/Intelligence"));
const ThreatIntel = lazyWithRetry(() => import("./pages/ThreatIntel"));
const Operations = lazyWithRetry(() => import("./pages/Operations"));
const Academy = lazyWithRetry(() => import("./pages/Academy"));
const AcademyCredential = lazyWithRetry(() => import("./pages/AcademyCredential"));

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const App = () => {
  // QueryClient inside component tree — prevents cross-context state sharing
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "An unexpected error occurred");
        },
      },
    },
  }));

  return (
    <ErrorBoundary context="Application Root">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <TenantProvider>
                <ClientSelectionProvider>
                  <RealtimeNotifications />
                  <ProactiveAgentMessages />
                  <ContextualKnowledgeWidget />
                  <EnsureDefaultRole />
                  <CommandPalette />
                  <PasswordExpiryGuard />
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/reset-password" element={<ResetPassword />} />
                      <Route path="/authorize/:token" element={<ClientAuthorization />} />
                      <Route path="/welcome" element={<Welcome />} />
                      <Route path="/invite/accept" element={<AcceptInvite />} />
                      <Route path="/invite-required" element={<InviteRequired />} />
                      <Route path="/tenant-admin" element={<ProtectedRoute><TenantAdmin /></ProtectedRoute>} />
                      <Route path="/super-admin" element={<ProtectedRoute><SuperAdminDashboard /></ProtectedRoute>} />
                      <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
                      <Route path="/client/:id" element={<ProtectedRoute><ClientDetail /></ProtectedRoute>} />
                      <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
                      <Route path="/signals" element={<ProtectedRoute><Signals /></ProtectedRoute>} />
                      <Route path="/sources" element={<ProtectedRoute><Sources /></ProtectedRoute>} />
                      <Route path="/entities" element={<ProtectedRoute><Entities /></ProtectedRoute>} />
                      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
                      <Route path="/investigations" element={<ProtectedRoute><Investigations /></ProtectedRoute>} />
                      <Route path="/investigation/:id" element={<ProtectedRoute><InvestigationDetail /></ProtectedRoute>} />
                      <Route path="/travel" element={<ProtectedRoute><Travel /></ProtectedRoute>} />
                      <Route path="/knowledge-base" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
                      <Route path="/bug-reports" element={<ProtectedRoute><BugReports /></ProtectedRoute>} />
                      <Route path="/rule-approvals" element={<ProtectedRoute><RuleApprovals /></ProtectedRoute>} />
                      <Route path="/user-management" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
                      <Route path="/command-center" element={<ProtectedRoute><CommandCenter /></ProtectedRoute>} />
                      <Route path="/task-force" element={<ProtectedRoute><TaskForce /></ProtectedRoute>} />
                      <Route path="/threat-radar" element={<ProtectedRoute><ThreatRadar /></ProtectedRoute>} />
                      <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
                      <Route path="/benchmark" element={<ProtectedRoute><Benchmark /></ProtectedRoute>} />
                      <Route path="/matching-dashboard" element={<ProtectedRoute><MatchingDashboard /></ProtectedRoute>} />
                      <Route path="/workspace/:id" element={<ProtectedRoute><Workspace /></ProtectedRoute>} />
                      <Route path="/vip-deep-scan" element={<ProtectedRoute><VIPDeepScan /></ProtectedRoute>} />
                      <Route path="/consortia" element={<ProtectedRoute><Consortia /></ProtectedRoute>} />
                      <Route path="/intelligence-hub" element={<ProtectedRoute><IntelligenceHub /></ProtectedRoute>} />
                      <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
                      <Route path="/agent-actions" element={<ProtectedRoute><AgentActions /></ProtectedRoute>} />
                      <Route path="/intelligence" element={<ProtectedRoute><Intelligence /></ProtectedRoute>} />
                      <Route path="/threat-intel" element={<ProtectedRoute><ThreatIntel /></ProtectedRoute>} />
                      <Route path="/operations" element={<ProtectedRoute><Operations /></ProtectedRoute>} />
                      <Route path="/neural-constellation" element={<ProtectedRoute><NeuralConstellation /></ProtectedRoute>} />
                      <Route path="/knowledge-bank" element={<ProtectedRoute><KnowledgeBank /></ProtectedRoute>} />
                      <Route path="/briefing-feedback" element={<ProtectedRoute><BriefingFeedback /></ProtectedRoute>} />
                      <Route path="/security-advisor" element={<ProtectedRoute><SecurityAdvisor /></ProtectedRoute>} />
                      <Route path="/academy" element={<ProtectedRoute><Academy /></ProtectedRoute>} />
                      <Route path="/credential/:id" element={<AcademyCredential />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                  <SupportChatWidget />
                </ClientSelectionProvider>
              </TenantProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
