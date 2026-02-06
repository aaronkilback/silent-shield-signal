import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Shield, AlertTriangle, Radio, Search, Users, FileText,
  Map, Plane, Bug, Settings, Zap, Globe, UserCheck, Layers,
  Activity, Target, Link, MessageSquare,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  keywords: string[];
  group: "core" | "intelligence" | "operations" | "admin";
}

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isSuperAdmin, isAdmin } = useUserRole();

  // Listen for ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const navItems: NavItem[] = useMemo(() => [
    // Core
    { path: "/", label: "AEGIS Home", icon: Shield, keywords: ["home", "dashboard", "aegis", "chat"], group: "core" },
    { path: "/signals", label: "Signals", icon: Radio, keywords: ["signals", "feeds", "monitoring", "alerts"], group: "core" },
    { path: "/incidents", label: "Incidents", icon: AlertTriangle, keywords: ["incidents", "cases", "events"], group: "core" },
    { path: "/entities", label: "Entities", icon: Users, keywords: ["entities", "people", "organizations", "vip"], group: "core" },
    { path: "/threat-radar", label: "Threat Radar", icon: Target, keywords: ["threats", "radar", "risk", "assessment"], group: "core" },

    // Intelligence
    { path: "/intelligence-hub", label: "Intelligence Hub", icon: Globe, keywords: ["intel", "intelligence", "hub", "analysis"], group: "intelligence" },
    { path: "/investigations", label: "Investigations", icon: Search, keywords: ["investigations", "cases", "research"], group: "intelligence" },
    { path: "/sources", label: "Sources", icon: Layers, keywords: ["sources", "feeds", "rss", "osint"], group: "intelligence" },
    { path: "/reports", label: "Reports", icon: FileText, keywords: ["reports", "briefings", "documents"], group: "intelligence" },
    { path: "/consortia", label: "Intel Sharing", icon: Link, keywords: ["consortia", "sharing", "collaboration"], group: "intelligence" },

    // Operations
    { path: "/travel", label: "Travel Security", icon: Plane, keywords: ["travel", "itineraries", "trips", "security"], group: "operations" },
    { path: "/clients", label: "Clients", icon: UserCheck, keywords: ["clients", "accounts", "organizations"], group: "operations" },
    { path: "/command-center", label: "AI Agents", icon: Zap, keywords: ["agents", "command", "automation", "ai"], group: "operations" },
    { path: "/integrations", label: "Integrations", icon: Settings, keywords: ["integrations", "api", "connections"], group: "operations" },

    // Admin (conditional)
    ...(isSuperAdmin ? [
      { path: "/vip-deep-scan", label: "VIP Deep Scan", icon: Activity, keywords: ["vip", "scan", "deep", "osint"], group: "admin" as const },
      { path: "/super-admin", label: "Super Admin", icon: Shield, keywords: ["admin", "super", "system"], group: "admin" as const },
    ] : []),
    ...((isSuperAdmin || isAdmin) ? [
      { path: "/user-management", label: "User Management", icon: Users, keywords: ["users", "roles", "management"], group: "admin" as const },
    ] : []),
    { path: "/bug-reports", label: "Bug Reports", icon: Bug, keywords: ["bugs", "issues", "reports"], group: "admin" },
  ], [isSuperAdmin, isAdmin]);

  const groupLabels: Record<string, string> = {
    core: "Core",
    intelligence: "Intelligence",
    operations: "Operations",
    admin: "Administration",
  };

  const groups = useMemo(() => {
    const grouped: Record<string, NavItem[]> = {};
    for (const item of navItems) {
      if (!grouped[item.group]) grouped[item.group] = [];
      grouped[item.group].push(item);
    }
    return grouped;
  }, [navItems]);

  const handleSelect = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, features..." />
      <CommandList>
        <CommandEmpty>No results found. Try asking AEGIS instead.</CommandEmpty>
        {Object.entries(groups).map(([group, items], idx) => (
          <div key={group}>
            {idx > 0 && <CommandSeparator />}
            <CommandGroup heading={groupLabels[group] || group}>
              {items.map((item) => (
                <CommandItem
                  key={item.path}
                  value={`${item.label} ${item.keywords.join(" ")}`}
                  onSelect={() => handleSelect(item.path)}
                  className="cursor-pointer"
                >
                  <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}

        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="ask aegis ai assistant chat"
            onSelect={() => {
              setOpen(false);
              navigate("/");
              // Focus chat input after navigation
              setTimeout(() => {
                const input = document.querySelector<HTMLInputElement>('input[placeholder*="Ask about"]');
                input?.focus();
              }, 300);
            }}
            className="cursor-pointer"
          >
            <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Ask AEGIS...</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
