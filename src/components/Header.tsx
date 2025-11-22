import { Shield, Activity, LogOut, Building2, Home, AlertTriangle, Users, FileText, ClipboardList, Radio, Rss, Plane, Bug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import { EntityNotifications } from "@/components/EntityNotifications";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Header = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get pending entity suggestions count
  const { data: pendingSuggestions } = useQuery({
    queryKey: ['pending-entity-suggestions-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('entity_suggestions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000 // Refetch every 30 seconds
  });

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Fortress AI</h1>
                <p className="text-sm text-muted-foreground">Security Intelligence Platform</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-2">
              <Button
                onClick={() => navigate("/")}
                variant={location.pathname === "/" ? "default" : "ghost"}
                size="sm"
              >
                <Home className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
              {/* Temporarily hidden */}
              {/* <Button
                onClick={() => navigate("/clients")}
                variant={location.pathname === "/clients" ? "default" : "ghost"}
                size="sm"
              >
                <Building2 className="w-4 h-4 mr-2" />
                Clients
              </Button> */}
              <Button
                onClick={() => navigate("/incidents")}
                variant={location.pathname === "/incidents" ? "default" : "ghost"}
                size="sm"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Incidents
              </Button>
              <Button
                onClick={() => navigate("/signals")}
                variant={location.pathname === "/signals" ? "default" : "ghost"}
                size="sm"
              >
                <Radio className="w-4 h-4 mr-2" />
                Signals
              </Button>
              <Button
                onClick={() => navigate("/sources")}
                variant={location.pathname === "/sources" ? "default" : "ghost"}
                size="sm"
              >
                <Rss className="w-4 h-4 mr-2" />
                Sources
              </Button>
              <Button
                onClick={() => navigate("/entities")}
                variant={location.pathname === "/entities" ? "default" : "ghost"}
                size="sm"
                className="relative"
              >
                <Users className="w-4 h-4 mr-2" />
                Entities
                {pendingSuggestions && pendingSuggestions > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
                  >
                    {pendingSuggestions}
                  </Badge>
                )}
              </Button>
              <Button
                onClick={() => navigate("/reports")}
                variant={location.pathname === "/reports" ? "default" : "ghost"}
                size="sm"
              >
                <FileText className="w-4 h-4 mr-2" />
                Reports
              </Button>
              <Button
                onClick={() => navigate("/investigations")}
                variant={location.pathname.startsWith("/investigation") ? "default" : "ghost"}
                size="sm"
              >
                <ClipboardList className="w-4 h-4 mr-2" />
                Investigations
              </Button>
              <Button
                onClick={() => navigate("/travel")}
                variant={location.pathname === "/travel" ? "default" : "ghost"}
                size="sm"
              >
                <Plane className="w-4 h-4 mr-2" />
                Travel
              </Button>
              <Button
                onClick={() => navigate("/bug-reports")}
                variant={location.pathname === "/bug-reports" ? "default" : "ghost"}
                size="sm"
              >
                <Bug className="w-4 h-4 mr-2" />
                Bugs
              </Button>
            </nav>
            <EntityNotifications />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
              <Activity className="w-4 h-4 text-status-active animate-pulse" />
              <span className="text-sm text-foreground font-medium">Systems Operational</span>
            </div>
            <Badge variant="outline" className="text-primary border-primary/50 font-mono">
              {new Date().toLocaleTimeString()}
            </Badge>
            <SettingsSheet />
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
