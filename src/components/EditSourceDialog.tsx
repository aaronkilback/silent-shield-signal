import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const sourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be less than 100 characters"),
  type: z.string().min(1, "Type is required"),
  config_json: z.string().optional(),
});

interface EditSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: any;
}

export const EditSourceDialog = ({ open, onOpenChange, source }: EditSourceDialogProps) => {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [monitorType, setMonitorType] = useState("");
  const [configJson, setConfigJson] = useState("");

  const sourceTypes = [
    { value: "api", label: "API", example: '{"url": "https://api.example.com", "api_key": "your-key"}' },
    { value: "rss", label: "RSS Feed", example: '{"feed_url": "https://example.com/feed.xml"}' },
    { value: "drivebc", label: "DriveBC Alerts", example: '{"regions": ["Fort St John", "Pink Mountain"], "event_types": ["closure", "delay", "advisory"]}' },
    { value: "webhook", label: "Webhook", example: '{"endpoint": "/webhook/source-name"}' },
    { value: "manual", label: "Manual Entry", example: '{}' },
  ];

  const monitorTypes = [
    { value: "monitor-canadian-sources-enhanced", label: "Canadian Sources" },
    { value: "monitor-news", label: "News Monitoring" },
    { value: "monitor-social", label: "Social Media" },
    { value: "monitor-threat-intel", label: "Threat Intelligence" },
    { value: "monitor-darkweb", label: "Dark Web" },
    { value: "monitor-domains", label: "Domain Monitoring" },
    { value: "monitor-weather", label: "Weather" },
    { value: "monitor-wildfires", label: "Wildfires" },
    { value: "monitor-earthquakes", label: "Earthquakes" },
    { value: "monitor-github", label: "GitHub" },
    { value: "monitor-linkedin", label: "LinkedIn" },
    { value: "monitor-facebook", label: "Facebook" },
    { value: "monitor-instagram", label: "Instagram" },
  ];

  const selectedSourceType = sourceTypes.find(st => st.value === type);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (source) {
      setName(source.name || "");
      setType(source.type || "");
      setMonitorType(source.monitor_type || "");
      setConfigJson(source.config_json ? JSON.stringify(source.config_json, null, 2) : "");
    }
  }, [source]);

  const updateSourceMutation = useMutation({
    mutationFn: async () => {
      const validation = sourceSchema.safeParse({ name, type, config_json: configJson });
      if (!validation.success) {
        throw new Error(validation.error.issues[0].message);
      }

      let parsedConfig = null;
      if (configJson.trim()) {
        try {
          parsedConfig = JSON.parse(configJson);
        } catch (e) {
          throw new Error("Invalid JSON configuration");
        }
      }

      const { error } = await supabase
        .from("sources")
        .update({
          name: name.trim(),
          type: type.trim(),
          monitor_type: monitorType || null,
          config_json: parsedConfig,
        })
        .eq("id", source.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source updated successfully");
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error updating source:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update source");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSourceMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
          <DialogDescription>
            Update the configuration for this OSINT source
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Source Name</Label>
            <Input
              id="name"
              placeholder="e.g., DriveBC Fort St John Alerts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Source Type</Label>
            <Select value={type} onValueChange={(value) => {
              setType(value);
              const selected = sourceTypes.find(st => st.value === value);
              if (selected && !configJson) {
                setConfigJson(selected.example);
              }
            }} required>
              <SelectTrigger>
                <SelectValue placeholder="Select source type" />
              </SelectTrigger>
              <SelectContent>
                {sourceTypes.map(st => (
                  <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="monitor">Assign to Monitor</Label>
            <Select value={monitorType} onValueChange={setMonitorType}>
              <SelectTrigger>
                <SelectValue placeholder="Select monitor (optional)" />
              </SelectTrigger>
              <SelectContent>
                {monitorTypes.map(mt => (
                  <SelectItem key={mt.value} value={mt.value}>{mt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose which monitoring scan should use this source
            </p>
          </div>

          {selectedSourceType && (
            <div className="p-3 bg-muted rounded-md text-sm space-y-1">
              <p className="font-medium">Example configuration:</p>
              <code className="text-xs block whitespace-pre-wrap break-all font-mono">
                {selectedSourceType.example}
              </code>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="config">Configuration (JSON)</Label>
            <Textarea
              id="config"
              placeholder='{"key": "value"}'
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Optional: Add source-specific configuration in JSON format
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateSourceMutation.isPending}>
              {updateSourceMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
