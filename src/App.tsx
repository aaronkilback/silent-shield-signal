// build: 2026-03-16
import { lazy, Suspense, useState } from "react";
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

// Lazy-loaded pages
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Clients = lazy(() => import("./pages/Clients"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Signals = lazy(() => import("./pages/Signals"));
const Sources = lazy(() => import("./pages/Sources"));
const Entities = lazy(() => import("./pages/Entities"));
const Reports = lazy(() => import("./pages/Reports"));
const Investigations = lazy(() => import("./pages/Investigations"));
const InvestigationDetail = lazy(() => import("./pages/InvestigationDetail"));
const Travel = lazy(() => import("./pages/Travel"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const BugReports = lazy(() => import("./pages/BugReports"));
const RuleApprovals = lazy(() => import("./pages/RuleApprovals"));
const Benchmark = lazy(() => import("./pages/Benchmark"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const TaskForce = lazy(() => import("./pages/TaskForce"));
const ThreatRadar = lazy(() => import("./pages/ThreatRadar"));
const Integrations = lazy(() => import("./pages/Integrations"));
const MatchingDashboard = lazy(() => import("./pages/MatchingDashboard"));
const Workspace = lazy(() => import("./pages/Workspace"));
const NotFound = lazy(() => import("./pages/NotFound"));
const InviteRequired = lazy(() => import("./pages/InviteRequired"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const TenantAdmin = lazy(() => import("./pages/TenantAdmin"));
const Welcome = lazy(() => import("./pages/Welcome"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const VIPDeepScan = lazy(() => import("./pages/VIPDeepScan"));
const Consortia = lazy(() => import("./pages/Consortia"));
const IntelligenceHub = lazy(() => import("./pages/IntelligenceHub"));
const BriefingFeedback = lazy(() => import("./pages/BriefingFeedback"));
const NeuralConstellation = lazy(() => import("./pages/NeuralConstellation"));
const KnowledgeBank = lazy(() => import("./pages/KnowledgeBank"));
const SecurityAdvisor = lazy(() => import("./pages/SecurityAdvisor"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Agents = lazy(() => import("./pages/Agents"));
const Intelligence = lazy(() => import("./pages/Intelligence"));
const ThreatIntel = lazy(() => import("./pages/ThreatIntel"));
const Operations = lazy(() => import("./pages/Operations"));

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
                      <Route path="/intelligence" element={<ProtectedRoute><Intelligence /></ProtectedRoute>} />
                      <Route path="/threat-intel" element={<ProtectedRoute><ThreatIntel /></ProtectedRoute>} />
                      <Route path="/operations" element={<ProtectedRoute><Operations /></ProtectedRoute>} />
                      <Route path="/neural-constellation" element={<ProtectedRoute><NeuralConstellation /></ProtectedRoute>} />
                      <Route path="/knowledge-bank" element={<ProtectedRoute><KnowledgeBank /></ProtectedRoute>} />
                      <Route path="/briefing-feedback" element={<ProtectedRoute><BriefingFeedback /></ProtectedRoute>} />
                      <Route path="/security-advisor" element={<ProtectedRoute><SecurityAdvisor /></ProtectedRoute>} />
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
