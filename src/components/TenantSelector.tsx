import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useTenant, Tenant } from "@/hooks/useTenant";
import { useState } from "react";

export function TenantSelector() {
  const { tenants, currentTenant, setCurrentTenant, isLoading } = useTenant();
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

  // If only one tenant, just show it without dropdown
  if (tenants.length === 1) {
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

  const handleSelect = (tenant: Tenant) => {
    setCurrentTenant(tenant);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-auto max-w-[180px] justify-between"
          size="sm"
        >
          <div className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-sm">{currentTenant?.name || "Tenant..."}</span>
          </div>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0">
        <Command>
          <CommandInput placeholder="Search tenants..." />
          <CommandList>
            <CommandEmpty>No tenant found.</CommandEmpty>
            <CommandGroup>
              {tenants.map((tenant) => (
                <CommandItem
                  key={tenant.id}
                  value={tenant.name}
                  onSelect={() => handleSelect(tenant)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Check
                      className={cn(
                        "h-4 w-4",
                        currentTenant?.id === tenant.id ? "opacity-100" : "opacity-0"
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
