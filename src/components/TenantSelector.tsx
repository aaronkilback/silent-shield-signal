import { Check, ChevronsUpDown, Building2, Globe, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useTenant, Tenant } from "@/hooks/useTenant";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { useState } from "react";

export function TenantSelector() {
  const { 
    tenants, 
    currentTenant, 
    setCurrentTenant, 
    isLoading, 
    isAllTenantsView, 
    setAllTenantsView,
    hasTenantSelection 
  } = useTenant();
  const { isSuperAdmin } = useIsSuperAdmin();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <Button variant="outline" className="w-[200px] justify-between" disabled>
        <span className="truncate">Loading...</span>
      </Button>
    );
  }

  if (tenants.length === 0) {
    return null;
  }

  // If only one tenant and not super admin, just show it without dropdown
  if (tenants.length === 1 && !isSuperAdmin) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{currentTenant?.name}</span>
        <Badge variant="secondary" className="text-xs">
          {currentTenant?.role}
        </Badge>
      </div>
    );
  }

  const handleSelectTenant = (tenant: Tenant) => {
    setAllTenantsView(false);
    setCurrentTenant(tenant);
    setOpen(false);
  };

  const handleSelectAllTenants = () => {
    setAllTenantsView(true);
    setOpen(false);
  };

  const handleClearSelection = () => {
    setAllTenantsView(false);
    setCurrentTenant(null);
    setOpen(false);
  };

  // Determine display state
  const getDisplayContent = () => {
    if (isAllTenantsView) {
      return (
        <>
          <Globe className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">All Tenants</span>
        </>
      );
    }
    if (hasTenantSelection && currentTenant) {
      return (
        <>
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-sm">{currentTenant.name}</span>
        </>
      );
    }
    // Super admin with no selection
    return (
      <>
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-muted-foreground">Select tenant...</span>
      </>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-auto max-w-[200px] justify-between"
          size="sm"
        >
          <div className="flex items-center gap-1.5 truncate">
            {getDisplayContent()}
          </div>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder="Search tenants..." />
          <CommandList>
            <CommandEmpty>No tenant found.</CommandEmpty>
            {isSuperAdmin && (
              <>
                <CommandGroup heading="Super Admin">
                  <CommandItem
                    value="all-tenants"
                    onSelect={handleSelectAllTenants}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Check
                        className={cn(
                          "h-4 w-4",
                          isAllTenantsView ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Globe className="h-4 w-4 text-primary" />
                      <span className="font-medium">All Tenants</span>
                    </div>
                    <Badge variant="default" className="text-xs">
                      global
                    </Badge>
                  </CommandItem>
                  {hasTenantSelection && (
                    <CommandItem
                      value="clear-selection"
                      onSelect={handleClearSelection}
                      className="flex items-center justify-between text-muted-foreground"
                    >
                      <div className="flex items-center gap-2">
                        <X className="h-4 w-4 opacity-0" />
                        <X className="h-4 w-4" />
                        <span>Clear Selection</span>
                      </div>
                    </CommandItem>
                  )}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Tenants">
              {tenants.map((tenant) => (
                <CommandItem
                  key={tenant.id}
                  value={tenant.name}
                  onSelect={() => handleSelectTenant(tenant)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Check
                      className={cn(
                        "h-4 w-4",
                        !isAllTenantsView && hasTenantSelection && currentTenant?.id === tenant.id 
                          ? "opacity-100" 
                          : "opacity-0"
                      )}
                    />
                    <span className="truncate">{tenant.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {tenant.role}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}