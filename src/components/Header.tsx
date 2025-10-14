import { Shield, Activity, LogOut, Building2, Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";

export const Header = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
              <Button
                onClick={() => navigate("/clients")}
                variant={location.pathname === "/clients" ? "default" : "ghost"}
                size="sm"
              >
                <Building2 className="w-4 h-4 mr-2" />
                Clients
              </Button>
            </nav>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
              <Activity className="w-4 h-4 text-status-active animate-pulse" />
              <span className="text-sm text-foreground font-medium">Systems Operational</span>
            </div>
            <Badge variant="outline" className="text-primary border-primary/50 font-mono">
              {new Date().toLocaleTimeString()}
            </Badge>
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
