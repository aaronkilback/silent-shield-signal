import { Shield, Activity, LogOut, Home, AlertTriangle, Users, FileText, ClipboardList, Radio, Plane, Menu, Bot, ChevronDown, Settings, Database, Building2, Bug, CheckCircle, UserCog, Crosshair, Radar, Plug, BarChart3, FileSearch, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import { EntityNotifications } from "@/components/EntityNotifications";
import { SettingsSheet } from "@/components/SettingsSheet";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";


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
    refetchInterval: 30000
  });

  // Primary nav items (always visible)
  const primaryItems = [
    { path: "/", icon: Home, label: "Dashboard" },
    { path: "/signals", icon: Radio, label: "Signals" },
    { path: "/incidents", icon: AlertTriangle, label: "Incidents" },
  ];

  // Intelligence dropdown items
  const intelligenceItems = [
    { path: "/threat-radar", icon: Radar, label: "Threat Radar" },
    { path: "/investigations", icon: ClipboardList, label: "Investigations", matchPrefix: true },
    { path: "/entities", icon: Users, label: "Entities", badge: pendingSuggestions },
    { path: "/sources", icon: Database, label: "Sources" },
    { path: "/reports", icon: FileText, label: "Reports" },
    { path: "/matching-dashboard", icon: BarChart3, label: "Match Analytics" },
    { path: "/unmatched-signals", icon: FileSearch, label: "Unmatched Signals" },
  ];

  // Operations dropdown items
  const operationsItems = [
    { path: "/command-center", icon: Bot, label: "Agents" },
    { path: "/task-forces", icon: Swords, label: "AI Task Forces" },
    { path: "/task-force", icon: Crosshair, label: "Mission Planner" },
    { path: "/travel", icon: Plane, label: "Travel" },
    { path: "/clients", icon: Building2, label: "Clients" },
  ];

  // Admin dropdown items (consolidated)
  const adminItems = [
    { path: "/integrations", icon: Plug, label: "Integrations" },
    { path: "/rule-approvals", icon: CheckCircle, label: "Rules" },
    { path: "/bug-reports", icon: Bug, label: "Bugs" },
    ...((isSuperAdmin || isAdmin) ? [{ path: "/user-management", icon: UserCog, label: "Users" }] : []),
    ...(isSuperAdmin ? [
      { path: "/super-admin", icon: Shield, label: "Super Admin" },
      { path: "/tenant-admin", icon: Building2, label: "Tenant Settings" },
    ] : []),
  ];

  // All items for mobile
  const allNavItems = [
    ...primaryItems,
    ...intelligenceItems,
    ...operationsItems,
    ...adminItems,
  ];

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const isActive = (item: { path: string; matchPrefix?: boolean }) => {
    if (item.matchPrefix) {
      return location.pathname.startsWith(item.path);
    }
    return location.pathname === item.path;
  };

  const isGroupActive = (items: typeof primaryItems) => {
    return items.some(item => isActive(item));
  };

  type NavItem = {
    path: string;
    icon: typeof Home;
    label: string;
    matchPrefix?: boolean;
    badge?: number;
  };

  const NavDropdown = ({ 
    label, 
    icon: Icon, 
    items 
  }: { 
    label: string; 
    icon: typeof Home; 
    items: NavItem[];
  }) => {
    const hasActivePath = isGroupActive(items);
    const hasBadge = items.some(item => item.badge && item.badge > 0);
    
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={hasActivePath ? "default" : "ghost"}
            size="sm"
            className="gap-1.5 relative"
          >
            <Icon className="w-4 h-4" />
            <span className="hidden lg:inline">{label}</span>
            <ChevronDown className="w-3 h-3" />
            {hasBadge && (
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-destructive rounded-full" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`gap-2 cursor-pointer ${isActive(item) ? 'bg-accent' : ''}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
              {item.badge && item.badge > 0 && (
                <Badge variant="destructive" className="ml-auto h-5 px-1.5 text-xs">
                  {item.badge}
                </Badge>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
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
            <EnvironmentBadge />
          </div>

          {/* Desktop Navigation */}
          {!isMobile && (
            <div className="flex items-center gap-1 lg:gap-2 flex-wrap justify-end">
              <nav className="flex items-center gap-0.5 lg:gap-1">
                {/* Primary items - icons only on medium screens */}
                {primaryItems.map((item) => (
                  <Button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    variant={isActive(item) ? "default" : "ghost"}
                    size="sm"
                    className="px-2 lg:px-3"
                  >
                    <item.icon className="w-4 h-4 lg:mr-1.5" />
                    <span className="hidden xl:inline text-sm">{item.label}</span>
                  </Button>
                ))}
                
                {/* Grouped dropdowns */}
                <NavDropdown label="Intel" icon={ClipboardList} items={intelligenceItems} />
                <NavDropdown label="Ops" icon={Bot} items={operationsItems} />
                <NavDropdown label="Admin" icon={Settings} items={adminItems} />
              </nav>

              <div className="flex items-center gap-1 lg:gap-2 ml-1 lg:ml-2 pl-1 lg:pl-2 border-l border-border">
                <EntityNotifications />
                <div className="hidden 2xl:flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50">
                  <Activity className="w-3.5 h-3.5 text-status-active animate-pulse" />
                  <span className="text-xs text-foreground font-medium">Online</span>
                </div>
                <SettingsSheet />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={signOut}
                  className="text-muted-foreground hover:text-foreground px-2"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
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

                    <nav className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground font-medium px-3 pt-2">Main</p>
                      {primaryItems.map((item) => (
                        <Button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          variant={isActive(item) ? "default" : "ghost"}
                          className="justify-start"
                          size="sm"
                        >
                          <item.icon className="w-4 h-4 mr-3" />
                          {item.label}
                        </Button>
                      ))}

                      <p className="text-xs text-muted-foreground font-medium px-3 pt-4">Intelligence</p>
                      {intelligenceItems.map((item) => (
                        <Button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          variant={isActive(item) ? "default" : "ghost"}
                          className="justify-start relative"
                          size="sm"
                        >
                          <item.icon className="w-4 h-4 mr-3" />
                          {item.label}
                          {item.badge && item.badge > 0 && (
                            <Badge variant="destructive" className="ml-auto h-5 px-2 text-xs">
                              {item.badge}
                            </Badge>
                          )}
                        </Button>
                      ))}

                      <p className="text-xs text-muted-foreground font-medium px-3 pt-4">Operations</p>
                      {operationsItems.map((item) => (
                        <Button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          variant={isActive(item) ? "default" : "ghost"}
                          className="justify-start"
                          size="sm"
                        >
                          <item.icon className="w-4 h-4 mr-3" />
                          {item.label}
                        </Button>
                      ))}

                      <p className="text-xs text-muted-foreground font-medium px-3 pt-4">Admin</p>
                      {adminItems.map((item) => (
                        <Button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          variant={isActive(item) ? "default" : "ghost"}
                          className="justify-start"
                          size="sm"
                        >
                          <item.icon className="w-4 h-4 mr-3" />
                          {item.label}
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
