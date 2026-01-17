import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, 
  Search, 
  Filter,
  Clock,
  User,
  Database,
  Key,
  LogIn,
  LogOut,
  Settings,
  AlertTriangle,
  ChevronDown
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AuditEvent {
  id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const getActionIcon = (action: string) => {
  switch (action.toLowerCase()) {
    case 'login': return LogIn;
    case 'logout': return LogOut;
    case 'create': return Database;
    case 'update': return Settings;
    case 'delete': return AlertTriangle;
    case 'access': return Key;
    default: return Shield;
  }
};

const getActionColor = (action: string) => {
  switch (action.toLowerCase()) {
    case 'login': return 'text-green-600 bg-green-500/10';
    case 'logout': return 'text-gray-600 bg-gray-500/10';
    case 'create': return 'text-blue-600 bg-blue-500/10';
    case 'update': return 'text-amber-600 bg-amber-500/10';
    case 'delete': return 'text-red-600 bg-red-500/10';
    default: return 'text-muted-foreground bg-muted';
  }
};

export function AuditLogViewer() {
  const { currentTenant } = useTenant();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const { data: auditEvents = [], isLoading } = useQuery({
    queryKey: ['audit-events', currentTenant?.id, selectedActions],
    queryFn: async () => {
      if (!currentTenant?.id) return [];

      let query = supabase
        .from('audit_events')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (selectedActions.length > 0) {
        query = query.in('action', selectedActions);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AuditEvent[];
    },
    enabled: !!currentTenant?.id,
  });

  const actionTypes = ['login', 'logout', 'create', 'update', 'delete', 'access'];

  const filteredEvents = auditEvents.filter(event => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      event.action.toLowerCase().includes(query) ||
      event.resource.toLowerCase().includes(query) ||
      event.resource_id?.toLowerCase().includes(query)
    );
  });

  if (!currentTenant) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="w-5 h-5 text-primary" />
            Audit Log
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 w-48 text-sm"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="w-4 h-4" />
                  Filter
                  {selectedActions.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {selectedActions.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actionTypes.map((action) => (
                  <DropdownMenuCheckboxItem
                    key={action}
                    checked={selectedActions.includes(action)}
                    onCheckedChange={(checked) => {
                      setSelectedActions(prev =>
                        checked
                          ? [...prev, action]
                          : prev.filter(a => a !== action)
                      );
                    }}
                  >
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Loading audit log...
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No audit events found
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEvents.map((event) => {
                const Icon = getActionIcon(event.action);
                return (
                  <Dialog key={event.id}>
                    <DialogTrigger asChild>
                      <div 
                        className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-accent/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className={`p-2 rounded-full ${getActionColor(event.action)}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {event.action.toUpperCase()}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {event.resource}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                            </div>
                            {event.ip_address && (
                              <div className="flex items-center gap-1">
                                <span>IP:</span>
                                <code className="bg-muted px-1 rounded">{event.ip_address}</code>
                              </div>
                            )}
                          </div>
                        </div>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Icon className="w-5 h-5" />
                          Audit Event Details
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 mt-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Action</p>
                            <p className="font-medium">{event.action}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Resource</p>
                            <p className="font-medium">{event.resource}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Resource ID</p>
                            <p className="font-mono text-xs">{event.resource_id || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">User ID</p>
                            <p className="font-mono text-xs">{event.user_id || 'System'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">IP Address</p>
                            <p className="font-mono text-xs">{event.ip_address || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Timestamp</p>
                            <p className="text-xs">{format(new Date(event.created_at), 'PPpp')}</p>
                          </div>
                        </div>
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <div>
                            <p className="text-muted-foreground text-sm mb-2">Metadata</p>
                            <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-48">
                              {JSON.stringify(event.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
