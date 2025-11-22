import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ClientSelectionProvider } from "@/hooks/useClientSelection";
import SupportChatWidget from "@/components/SupportChatWidget";
import { RealtimeNotifications } from "@/components/RealtimeNotifications";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary context="Application Root">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ClientSelectionProvider>
            <RealtimeNotifications />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              {/* Temporarily hidden */}
              {/* <Route path="/clients" element={<Clients />} /> */}
              {/* <Route path="/client/:id" element={<ClientDetail />} /> */}
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
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <SupportChatWidget />
          </ClientSelectionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
