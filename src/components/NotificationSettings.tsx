import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const NotificationSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState({
    emailNotifications: true,
    incidentAlerts: true,
    entityMentions: true,
    weeklyReports: false,
    alertFrequency: 'immediate',
    emailAddress: '',
    slackWebhook: '',
    teamsWebhook: ''
  });

  // Fetch user preferences
  const { data: preferences } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
  });

  // Update form when preferences are loaded
  useEffect(() => {
    if (preferences) {
      setSettings({
        emailNotifications: preferences.email_notifications,
        incidentAlerts: preferences.incident_alerts,
        entityMentions: preferences.entity_mentions,
        weeklyReports: preferences.weekly_reports,
        alertFrequency: preferences.alert_frequency,
        emailAddress: preferences.email_address || '',
        slackWebhook: preferences.slack_webhook || '',
        teamsWebhook: preferences.teams_webhook || ''
      });
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const upsertData = {
        user_id: user.id,
        email_notifications: settings.emailNotifications,
        incident_alerts: settings.incidentAlerts,
        entity_mentions: settings.entityMentions,
        weekly_reports: settings.weeklyReports,
        alert_frequency: settings.alertFrequency,
        email_address: settings.emailAddress || null,
        slack_webhook: settings.slackWebhook || null,
        teams_webhook: settings.teamsWebhook || null
      };

      const { data, error } = await supabase
        .from('notification_preferences')
        .upsert(upsertData, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Notification preferences updated" });
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Save Failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Notification Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure how and when you receive alerts
        </p>
      </div>

      <Separator />

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Email Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive alerts via email
            </p>
          </div>
          <Switch
            checked={settings.emailNotifications}
            onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: checked })}
          />
        </div>

        {settings.emailNotifications && (
          <div className="space-y-2 pl-6">
            <Label>Email Address</Label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={settings.emailAddress}
              onChange={(e) => setSettings({ ...settings, emailAddress: e.target.value })}
            />
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Incident Alerts</Label>
            <p className="text-sm text-muted-foreground">
              Get notified when new incidents are created
            </p>
          </div>
          <Switch
            checked={settings.incidentAlerts}
            onCheckedChange={(checked) => setSettings({ ...settings, incidentAlerts: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Entity Mentions</Label>
            <p className="text-sm text-muted-foreground">
              Alert when tracked entities are mentioned
            </p>
          </div>
          <Switch
            checked={settings.entityMentions}
            onCheckedChange={(checked) => setSettings({ ...settings, entityMentions: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Weekly Reports</Label>
            <p className="text-sm text-muted-foreground">
              Receive weekly summary reports
            </p>
          </div>
          <Switch
            checked={settings.weeklyReports}
            onCheckedChange={(checked) => setSettings({ ...settings, weeklyReports: checked })}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Alert Frequency</Label>
          <Select value={settings.alertFrequency} onValueChange={(value) => setSettings({ ...settings, alertFrequency: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate</SelectItem>
              <SelectItem value="hourly">Hourly Digest</SelectItem>
              <SelectItem value="daily">Daily Digest</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Slack Webhook URL (Optional)</Label>
          <Input
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={settings.slackWebhook}
            onChange={(e) => setSettings({ ...settings, slackWebhook: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>Microsoft Teams Webhook URL (Optional)</Label>
          <Input
            type="url"
            placeholder="https://outlook.office.com/webhook/..."
            value={settings.teamsWebhook}
            onChange={(e) => setSettings({ ...settings, teamsWebhook: e.target.value })}
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
};
