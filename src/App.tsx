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
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import Incidents from "./pages/Incidents";
import Signals from "./pages/Signals";
import Sources from "./pages/Sources";
import Entities from "./pages/Entities";
import Reports from "./pages/Reports";
import Investigations from "./pages/Investigations";
import InvestigationDetail from "./pages/InvestigationDetail";
import Travel from "./pages/Travel";
import KnowledgeBase from "./pages/KnowledgeBase";
import BugReports from "./pages/BugReports";
import RuleApprovals from "./pages/RuleApprovals";
import Benchmark from "./pages/Benchmark";
import UserManagement from "./pages/UserManagement";
import CommandCenter from "./pages/CommandCenter";
import TaskForce from "./pages/TaskForce";
import ThreatRadar from "./pages/ThreatRadar";
import Integrations from "./pages/Integrations";
import MatchingDashboard from "./pages/MatchingDashboard";
import Workspace from "./pages/Workspace";
import NotFound from "./pages/NotFound";
import InviteRequired from "./pages/InviteRequired";
import AcceptInvite from "./pages/AcceptInvite";
import TenantAdmin from "./pages/TenantAdmin";
import Welcome from "./pages/Welcome";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import VIPDeepScan from "./pages/VIPDeepScan";
import Consortia from "./pages/Consortia";
import IntelligenceHub from "./pages/IntelligenceHub";
import BriefingFeedback from "./pages/BriefingFeedback";
import NeuralConstellation from "./pages/NeuralConstellation";
import KnowledgeBank from "./pages/KnowledgeBank";
import { EnsureDefaultRole } from "@/components/EnsureDefaultRole";
import { TenantProvider } from "@/hooks/useTenant";

const queryClient = new QueryClient();

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
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
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
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              <SupportChatWidget />
            </ClientSelectionProvider>
          </TenantProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
