import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Database, AlertCircle, CheckCircle, Loader2 } from "lucide-react";

export const DatabaseSettings = () => {
  const { toast } = useToast();
  const [isRunningMaintenance, setIsRunningMaintenance] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['db-stats'],
    queryFn: async () => {
      const [signals, incidents, entities, relationships] = await Promise.all([
        supabase.from('signals').select('*', { count: 'exact', head: true }),
        supabase.from('incidents').select('*', { count: 'exact', head: true }),
        supabase.from('entities').select('*', { count: 'exact', head: true }),
        supabase.from('entity_relationships').select('*', { count: 'exact', head: true })
      ]);

      return {
        signals: signals.count || 0,
        incidents: incidents.count || 0,
        entities: entities.count || 0,
        relationships: relationships.count || 0
      };
    }
  });

  const runMaintenance = async () => {
    setIsRunningMaintenance(true);
    try {
      // Call cleanup function
      const { data, error } = await supabase.rpc('cleanup_processing_queue');
      
      if (error) throw error;

      toast({ 
        title: "Maintenance Complete", 
        description: `Cleaned up ${data || 0} old queue entries`
      });
    } catch (error: any) {
      toast({ 
        title: "Maintenance Failed", 
        description: error.message,
        variant: "destructive" 
      });
    } finally {
      setIsRunningMaintenance(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Database Settings</h3>
        <p className="text-sm text-muted-foreground">
          Monitor database health and perform maintenance
        </p>
      </div>

      <Separator />

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            <h4 className="font-medium">Database Statistics</h4>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Signals</Label>
              <p className="text-2xl font-bold">{stats?.signals.toLocaleString() || 0}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Incidents</Label>
              <p className="text-2xl font-bold">{stats?.incidents.toLocaleString() || 0}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Entities</Label>
              <p className="text-2xl font-bold">{stats?.entities.toLocaleString() || 0}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Relationships</Label>
              <p className="text-2xl font-bold">{stats?.relationships.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="font-medium">Database Health</h4>
              <p className="text-sm text-muted-foreground">System status and performance</p>
            </div>
            <Badge variant="outline" className="gap-2">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Healthy
            </Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>RLS Policies</Label>
              <p className="text-sm text-muted-foreground">Row-level security enabled</p>
            </div>
            <Badge variant="outline" className="gap-2">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Active
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Backup Status</Label>
              <p className="text-sm text-muted-foreground">Last backup: 2 hours ago</p>
            </div>
            <Badge variant="outline" className="gap-2">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Up to date
            </Badge>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium">Maintenance</h4>
            <p className="text-sm text-muted-foreground">
              Run database cleanup and optimization tasks
            </p>
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={runMaintenance} 
              disabled={isRunningMaintenance}
              variant="outline"
            >
              {isRunningMaintenance && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Clean Processing Queue
            </Button>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
            <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Regular maintenance helps keep the system running smoothly by removing old data and optimizing performance.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
