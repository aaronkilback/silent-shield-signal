import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ClientSelectionProvider } from "@/hooks/useClientSelection";
import SupportChatWidget from "@/components/SupportChatWidget";
import { RealtimeNotifications } from "@/components/RealtimeNotifications";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import Incidents from "./pages/Incidents";
import Entities from "./pages/Entities";
import Reports from "./pages/Reports";
import Investigations from "./pages/Investigations";
import InvestigationDetail from "./pages/InvestigationDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
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
            <Route path="/clients" element={<Clients />} />
            <Route path="/client/:id" element={<ClientDetail />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/entities" element={<Entities />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/investigation/:id" element={<InvestigationDetail />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <SupportChatWidget />
        </ClientSelectionProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
