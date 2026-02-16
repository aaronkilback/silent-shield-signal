import { Shield, LogOut, Menu, Activity, Settings, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { EntityNotifications } from "@/components/EntityNotifications";
import { TravelNotificationBell } from "@/components/travel/TravelNotificationBell";
import { SettingsSheet } from "@/components/SettingsSheet";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
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
} from "@/components/ui/dropdown-menu";

/**
 * Minimal header for the AEGIS-centric home page.
 * Shows only: logo, status, notifications, quick-nav menu, settings, logout.
 * All operational pages accessible via the "More" dropdown or by asking AEGIS.
 */
export const MinimalHeader = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isSuperAdmin, isAdmin } = useUserRole();

  const quickNavItems = [
    { path: "/signals", label: "Signals" },
    { path: "/incidents", label: "Incidents" },
    { path: "/intelligence-hub", label: "Intel Hub" },
    { path: "/threat-radar", label: "Threat Radar" },
    { path: "/entities", label: "Entities" },
    { path: "/investigations", label: "Investigations" },
    { path: "/command-center", label: "Agents" },
    { path: "/sources", label: "Sources" },
    { path: "/reports", label: "Reports" },
    { path: "/travel", label: "Travel" },
    { path: "/clients", label: "Clients" },
    { path: "/security-advisor", label: "Security Advisor" },
    { path: "/consortia", label: "Intel Sharing" },
    ...(isSuperAdmin ? [
      { path: "/vip-deep-scan", label: "VIP Deep Scan" },
      { path: "/neural-constellation", label: "Neural Constellation" },
      { path: "/super-admin", label: "Super Admin" },
    ] : []),
    ...((isSuperAdmin || isAdmin) ? [
      { path: "/user-management", label: "Users" },
    ] : []),
    { path: "/bug-reports", label: "Bug Reports" },
    { path: "/integrations", label: "Integrations" },
  ];

  return (
    <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-50">
      <div className="px-4 sm:px-6 py-2 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <span className="font-semibold text-foreground tracking-tight hidden sm:inline">
            Fortress AI
          </span>
          <EnvironmentBadge />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5">
          {/* Status indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/30 mr-1">
            <Activity className="w-3 h-3 text-status-active animate-pulse" />
            <span className="text-[11px] text-muted-foreground font-medium">Live</span>
          </div>
          
          {/* ⌘K shortcut hint */}
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/30 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span>⌘K</span>
          </button>

          <EntityNotifications />
          <TravelNotificationBell />

          {/* Quick nav dropdown */}
          {!isMobile ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                  <MoreHorizontal className="w-4 h-4" />
                  <span className="hidden lg:inline text-xs">Pages</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px] max-h-[400px] overflow-y-auto">
                {quickNavItems.map((item) => (
                  <DropdownMenuItem
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className="cursor-pointer text-sm"
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[260px]">
                <div className="flex flex-col gap-1 mt-6">
                  <p className="text-xs text-muted-foreground font-medium px-3 mb-2">Navigate to</p>
                  {quickNavItems.map((item) => (
                    <Button
                      key={item.path}
                      onClick={() => { navigate(item.path); setMobileMenuOpen(false); }}
                      variant="ghost"
                      className="justify-start text-sm"
                      size="sm"
                    >
                      {item.label}
                    </Button>
                  ))}
                  <div className="pt-4 border-t border-border mt-2">
                    <SettingsSheet />
                    <Button
                      variant="outline"
                      onClick={() => { signOut(); setMobileMenuOpen(false); }}
                      className="justify-start gap-2 w-full mt-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}

          {!isMobile && (
            <>
              <SettingsSheet />
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-muted-foreground hover:text-foreground px-2"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
