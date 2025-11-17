import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, X, Plus, Mail } from "lucide-react";

export const NotificationSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState('');
  const [emailList, setEmailList] = useState<string[]>([]);
  const [settings, setSettings] = useState({
    emailNotifications: true,
    incidentAlerts: true,
    entityMentions: true,
    weeklyReports: false,
    alertFrequency: 'immediate',
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
        slackWebhook: preferences.slack_webhook || '',
        teamsWebhook: preferences.teams_webhook || ''
      });
      
      // Parse email addresses from comma-separated string or array
      if (preferences.email_address) {
        const emails = typeof preferences.email_address === 'string' 
          ? preferences.email_address.split(',').map(e => e.trim()).filter(Boolean)
          : [];
        setEmailList(emails);
      }
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
        email_address: emailList.join(',') || null,
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

  const handleAddEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      toast({ 
        title: "Email Required", 
        description: "Please enter an email address",
        variant: "destructive" 
      });
      return;
    }
    
    if (!emailRegex.test(email)) {
      toast({ 
        title: "Invalid Email", 
        description: "Please enter a valid email address",
        variant: "destructive" 
      });
      return;
    }
    
    if (emailList.includes(email)) {
      toast({ 
        title: "Duplicate Email", 
        description: "This email is already in the list",
        variant: "destructive" 
      });
      return;
    }
    
    setEmailList([...emailList, email]);
    setNewEmail('');
    toast({ title: "Email Added", description: "Remember to save your settings" });
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setEmailList(emailList.filter(email => email !== emailToRemove));
    toast({ title: "Email Removed", description: "Remember to save your settings" });
  };

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (settings.emailNotifications && emailList.length === 0) {
      toast({ 
        title: "No Email Addresses", 
        description: "Please add at least one email address or disable email notifications",
        variant: "destructive" 
      });
      return;
    }
    
    saveMutation.mutate();
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
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
          <div className="space-y-4 pl-6">
            <div>
              <Label>Email Addresses</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Add email addresses to receive notifications
              </p>
              
              <form onSubmit={handleAddEmail} className="flex gap-2 mb-3">
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </form>

              {emailList.length > 0 ? (
                <div className="space-y-2">
                  {emailList.map((email, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{email}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveEmail(email)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-lg border border-dashed text-center">
                  <Mail className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No email addresses configured
                  </p>
                </div>
              )}
            </div>
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
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </form>
  );
};
