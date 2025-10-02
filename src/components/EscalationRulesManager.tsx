import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Settings, Clock, AlertTriangle, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

export default function EscalationRulesManager() {
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const { data, error } = await supabase
        .from('escalation_rules')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error('Error loading escalation rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleRule = async (ruleId: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('escalation_rules')
        .update({ is_active: !currentState })
        .eq('id', ruleId);

      if (error) throw error;

      toast({
        title: "Rule updated",
        description: `Escalation rule ${!currentState ? 'enabled' : 'disabled'}`,
      });

      loadRules();
    } catch (error) {
      console.error('Error toggling rule:', error);
      toast({
        title: "Error",
        description: "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'p1': return 'bg-red-500';
      case 'p2': return 'bg-orange-500';
      case 'p3': return 'bg-yellow-500';
      case 'p4': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 animate-pulse" />
            Loading Escalation Rules...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Autonomous Escalation Rules
        </CardTitle>
        <CardDescription>
          Configure automated escalation policies for incident management
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="p-4 border rounded-lg space-y-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{rule.name}</h4>
                    <Badge className={getPriorityColor(rule.priority)}>
                      {rule.priority.toUpperCase()}
                    </Badge>
                    {rule.is_active && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{rule.description}</p>
                </div>
                <Switch
                  checked={rule.is_active}
                  onCheckedChange={() => toggleRule(rule.id, rule.is_active)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Escalate after:</span>
                  <span className="font-medium">{rule.escalate_after_minutes} min</span>
                </div>

                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Recipients:</span>
                  <span className="font-medium">{rule.notify_recipients.length}</span>
                </div>

                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Conditions:</span>
                  <span className="font-medium">{Object.keys(rule.conditions).length}</span>
                </div>
              </div>

              <div className="text-xs space-y-1">
                <div>
                  <span className="font-medium">Actions: </span>
                  <span className="text-muted-foreground">
                    {Object.keys(rule.actions).map(key => key.replace(/_/g, ' ')).join(', ')}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Notify: </span>
                  <span className="text-muted-foreground">
                    {rule.notify_recipients.slice(0, 2).join(', ')}
                    {rule.notify_recipients.length > 2 && ` +${rule.notify_recipients.length - 2} more`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h4 className="font-semibold mb-2">How Escalation Rules Work</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Rules are evaluated automatically by the Auto-Orchestrator every 5 minutes</li>
            <li>• Active rules will trigger escalation actions when conditions are met</li>
            <li>• Multiple rules can apply to the same incident</li>
            <li>• Higher priority incidents escalate faster</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
