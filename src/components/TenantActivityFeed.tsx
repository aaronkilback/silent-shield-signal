import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Activity, 
  MessageSquare, 
  FileText, 
  AlertTriangle, 
  Users, 
  Radio,
  Clock
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

interface TenantActivityItem {
  id: string;
  activity_type: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  description: string | null;
  user_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  user_name?: string;
}

const getActivityIcon = (type: string) => {
  switch (type) {
    case 'chat': return MessageSquare;
    case 'signal': return Radio;
    case 'incident': return AlertTriangle;
    case 'document': return FileText;
    case 'entity': return Users;
    default: return Activity;
  }
};

const getActivityColor = (type: string) => {
  switch (type) {
    case 'create': return 'bg-green-500/10 text-green-600';
    case 'update': return 'bg-blue-500/10 text-blue-600';
    case 'delete': return 'bg-red-500/10 text-red-600';
    case 'share': return 'bg-purple-500/10 text-purple-600';
    default: return 'bg-muted text-muted-foreground';
  }
};

export function TenantActivityFeed() {
  const { currentTenant } = useTenant();
  const [realtimeActivities, setRealtimeActivities] = useState<TenantActivityItem[]>([]);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['tenant-activity', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant?.id) return [];

      const { data, error } = await supabase
        .from('tenant_activity')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as TenantActivityItem[];
    },
    enabled: !!currentTenant?.id,
    refetchInterval: 30000,
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!currentTenant?.id) return;

    const channel = supabase
      .channel('tenant-activity')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tenant_activity',
          filter: `tenant_id=eq.${currentTenant.id}`,
        },
        (payload) => {
          setRealtimeActivities(prev => [payload.new as TenantActivityItem, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant?.id]);

  const allActivities = [...realtimeActivities, ...activities].slice(0, 50);

  if (!currentTenant) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="w-5 h-5 text-primary" />
          Team Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Loading activity...
            </div>
          ) : allActivities.length === 0 ? (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No recent activity
            </div>
          ) : (
            <div className="space-y-3">
              {allActivities.map((activity) => {
                const Icon = getActivityIcon(activity.resource_type);
                return (
                  <div 
                    key={activity.id} 
                    className="flex items-start gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors"
                  >
                    <div className={`p-2 rounded-full ${getActivityColor(activity.activity_type)}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[10px]">
                            {activity.user_name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                          {activity.description || `${activity.activity_type} ${activity.resource_type}`}
                        </span>
                      </div>
                      {activity.resource_name && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {activity.resource_name}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {activity.resource_type}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
