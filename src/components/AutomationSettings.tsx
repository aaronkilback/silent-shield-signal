import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const AutomationSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState({
    autoEscalation: true,
    autoIncidentCreation: true,
    aiDecisionEngine: true,
    osintScanning: true,
    signalProcessingThreshold: 0.7,
    incidentAutoClose: false,
    autoCloseAfterDays: 30
  });

  const updateSettings = useMutation({
    mutationFn: async (newSettings: typeof settings) => {
      // In a real app, this would save to a settings table
      console.log('Updating automation settings:', newSettings);
      return newSettings;
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Automation settings updated successfully" });
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
    updateSettings.mutate(settings);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Automation Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure automated system behaviors and thresholds
        </p>
      </div>

      <Separator />

      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Auto Entity Creation</Label>
            <p className="text-sm text-muted-foreground">
              Automatically create entities from scans (only high confidence ≥80%)
            </p>
          </div>
          <Switch
            checked={settings.autoEscalation}
            onCheckedChange={(checked) => setSettings({ ...settings, autoEscalation: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Auto Escalation</Label>
            <p className="text-sm text-muted-foreground">
              Automatically escalate incidents based on priority rules
            </p>
          </div>
          <Switch
            checked={settings.autoEscalation}
            onCheckedChange={(checked) => setSettings({ ...settings, autoEscalation: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Auto Incident Creation</Label>
            <p className="text-sm text-muted-foreground">
              Create incidents automatically from high-priority signals
            </p>
          </div>
          <Switch
            checked={settings.autoIncidentCreation}
            onCheckedChange={(checked) => setSettings({ ...settings, autoIncidentCreation: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>AI Decision Engine</Label>
            <p className="text-sm text-muted-foreground">
              Use AI to analyze signals and recommend actions
            </p>
          </div>
          <Switch
            checked={settings.aiDecisionEngine}
            onCheckedChange={(checked) => setSettings({ ...settings, aiDecisionEngine: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>OSINT Scanning</Label>
            <p className="text-sm text-muted-foreground">
              Weekly automated OSINT scans for entity relationships
            </p>
          </div>
          <Switch
            checked={settings.osintScanning}
            onCheckedChange={(checked) => setSettings({ ...settings, osintScanning: checked })}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Signal Processing Threshold</Label>
          <p className="text-sm text-muted-foreground">
            Minimum confidence score (0-1) to process signals
          </p>
          <Input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={settings.signalProcessingThreshold}
            onChange={(e) => setSettings({ ...settings, signalProcessingThreshold: parseFloat(e.target.value) })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Auto-Close Resolved Incidents</Label>
            <p className="text-sm text-muted-foreground">
              Automatically close incidents after resolution period
            </p>
          </div>
          <Switch
            checked={settings.incidentAutoClose}
            onCheckedChange={(checked) => setSettings({ ...settings, incidentAutoClose: checked })}
          />
        </div>

        {settings.incidentAutoClose && (
          <div className="space-y-2">
            <Label>Auto-Close After (Days)</Label>
            <Input
              type="number"
              min="1"
              max="365"
              value={settings.autoCloseAfterDays}
              onChange={(e) => setSettings({ ...settings, autoCloseAfterDays: parseInt(e.target.value) })}
            />
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
};
