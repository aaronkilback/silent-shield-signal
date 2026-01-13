import { Shield, Activity, LogOut, Building2, Home, AlertTriangle, Users, FileText, ClipboardList, Radio, Rss, Plane, Bug, Database, Menu, CheckCircle, UserCog, Crosshair, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import { EntityNotifications } from "@/components/EntityNotifications";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserRole } from "@/hooks/useUserRole";

export const Header = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isSuperAdmin, isAdmin } = useUserRole();

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

  const navItems = [
    { path: "/", icon: Home, label: "Dashboard" },
    { path: "/signals", icon: Radio, label: "Signals" },
    { path: "/incidents", icon: AlertTriangle, label: "Incidents" },
    { path: "/investigations", icon: ClipboardList, label: "Investigations", matchPrefix: true },
    { path: "/travel", icon: Plane, label: "Travel" },
    { path: "/entities", icon: Users, label: "Entities", badge: pendingSuggestions },
    { path: "/sources", icon: Database, label: "Sources" },
    { path: "/reports", icon: FileText, label: "Reports" },
    { path: "/clients", icon: Building2, label: "Clients" },
    { path: "/rule-approvals", icon: CheckCircle, label: "Rules" },
    { path: "/bug-reports", icon: Bug, label: "Bugs" },
    { path: "/command-center", icon: Bot, label: "Agents" },
    { path: "/task-force", icon: Crosshair, label: "Task Force" },
    ...((isSuperAdmin || isAdmin) ? [{ path: "/user-management", icon: UserCog, label: "Users" }] : []),
  ];

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const isActive = (item: typeof navItems[0]) => {
    if (item.matchPrefix) {
      return location.pathname.startsWith(item.path);
    }
    return location.pathname === item.path;
  };

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-lg bg-primary/10">
              <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Fortress AI</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Security Intelligence Platform</p>
            </div>
            <h1 className="sm:hidden text-lg font-bold text-foreground">Fortress</h1>
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-2 lg:gap-4">
              <nav className="flex items-center gap-1 lg:gap-2">
                {navItems.map((item) => (
                  <Button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    variant={isActive(item) ? "default" : "ghost"}
                    size="sm"
                    className="relative"
                  >
                    <item.icon className="w-4 h-4 lg:mr-2" />
                    <span className="hidden lg:inline">{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <Badge 
                        variant="destructive" 
                        className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </Button>
                ))}
              </nav>
              <EntityNotifications />
              <div className="hidden xl:flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
                <Activity className="w-4 h-4 text-status-active animate-pulse" />
                <span className="text-sm text-foreground font-medium">Systems Operational</span>
              </div>
              <Badge variant="outline" className="hidden lg:flex text-primary border-primary/50 font-mono">
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
                <span className="hidden lg:inline">Sign Out</span>
              </Button>
            </div>
          )}

          {/* Mobile Navigation */}
          {isMobile && (
            <div className="flex items-center gap-2">
              <EntityNotifications />
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px] sm:w-[350px]">
                  <div className="flex flex-col gap-4 mt-8">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
                      <Activity className="w-4 h-4 text-status-active animate-pulse" />
                      <span className="text-sm text-foreground font-medium">Systems Operational</span>
                    </div>
                    
                    <nav className="flex flex-col gap-2">
                      {navItems.map((item) => (
                        <Button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          variant={isActive(item) ? "default" : "ghost"}
                          className="justify-start relative"
                        >
                          <item.icon className="w-4 h-4 mr-3" />
                          {item.label}
                          {item.badge && item.badge > 0 && (
                            <Badge 
                              variant="destructive" 
                              className="ml-auto h-5 px-2 flex items-center justify-center text-xs"
                            >
                              {item.badge}
                            </Badge>
                          )}
                        </Button>
                      ))}
                    </nav>

                    <div className="pt-4 border-t border-border flex flex-col gap-2">
                      <SettingsSheet />
                      <Button
                        variant="outline"
                        onClick={() => {
                          signOut();
                          setMobileMenuOpen(false);
                        }}
                        className="justify-start gap-2"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
