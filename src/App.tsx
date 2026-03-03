import { lazy, Suspense } from "react";
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
import { Loader2 } from "lucide-react";

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

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <ErrorBoundary context="Application Root">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/invite/accept" element={<AcceptInvite />} />
                  <Route path="/invite-required" element={<InviteRequired />} />
                  <Route path="/tenant-admin" element={<TenantAdmin />} />
                  <Route path="/super-admin" element={<SuperAdminDashboard />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/client/:id" element={<ClientDetail />} />
                  <Route path="/incidents" element={<Incidents />} />
                  <Route path="/signals" element={<Signals />} />
                  <Route path="/sources" element={<Sources />} />
                  <Route path="/entities" element={<Entities />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/investigations" element={<Investigations />} />
                  <Route path="/investigation/:id" element={<InvestigationDetail />} />
                  <Route path="/travel" element={<Travel />} />
                  <Route path="/knowledge-base" element={<KnowledgeBase />} />
                  <Route path="/bug-reports" element={<BugReports />} />
                  <Route path="/rule-approvals" element={<RuleApprovals />} />
                  <Route path="/user-management" element={<UserManagement />} />
                  <Route path="/command-center" element={<CommandCenter />} />
                  <Route path="/task-force" element={<TaskForce />} />
                  <Route path="/threat-radar" element={<ThreatRadar />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/benchmark" element={<Benchmark />} />
                  <Route path="/matching-dashboard" element={<MatchingDashboard />} />
                  <Route path="/workspace/:id" element={<Workspace />} />
                  <Route path="/vip-deep-scan" element={<VIPDeepScan />} />
                  <Route path="/consortia" element={<Consortia />} />
                  <Route path="/intelligence-hub" element={<IntelligenceHub />} />
                  <Route path="/neural-constellation" element={<NeuralConstellation />} />
                  <Route path="/knowledge-bank" element={<KnowledgeBank />} />
                  <Route path="/briefing-feedback" element={<BriefingFeedback />} />
                  <Route path="/security-advisor" element={<SecurityAdvisor />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <SupportChatWidget />
            </ClientSelectionProvider>
          </TenantProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
