import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export const NotificationSettings = () => {
  const { toast } = useToast();
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

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Notification preferences updated" });
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
        <Button onClick={handleSave}>
          Save Settings
        </Button>
      </div>
    </div>
  );
};
