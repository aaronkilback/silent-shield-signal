import { useState } from "react";
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
import { reportError } from "@/lib/errorReporting";

const sourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be less than 100 characters"),
  type: z.string().min(1, "Type is required"),
  config_json: z.string().optional(),
});

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddSourceDialog = ({ open, onOpenChange }: AddSourceDialogProps) => {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [monitorType, setMonitorType] = useState("");
  const [url, setUrl] = useState("");
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

  const addSourceMutation = useMutation({
    mutationFn: async () => {
      console.log("Starting source addition...");
      
      // Check authentication
      const { data: { user } } = await supabase.auth.getUser();
      console.log("Current user:", user?.id);
      
      if (!user) {
        throw new Error("You must be logged in to add sources");
      }

      // Validate required fields
      if (!name.trim()) {
        throw new Error("Source name is required");
      }
      if (!type.trim()) {
        throw new Error("Source type is required");
      }

      let parsedConfig = null;
      if (configJson.trim()) {
        try {
          parsedConfig = JSON.parse(configJson);
        } catch (e) {
          throw new Error("Invalid JSON configuration - please check your syntax");
        }
      }

      // Add URL to config if provided
      if (url.trim() && parsedConfig) {
        parsedConfig.url = url.trim();
      } else if (url.trim()) {
        parsedConfig = { url: url.trim() };
      }

      console.log("Attempting to insert source:", {
        name: name.trim(),
        type: type.trim(),
        monitor_type: monitorType || null,
        has_config: !!parsedConfig
      });

      const { data, error } = await supabase
        .from("sources")
        .insert({
          name: name.trim(),
          type: type.trim(),
          config: parsedConfig,
          status: 'active',
          monitor_type: monitorType || null,
        })
        .select();

      if (error) {
        console.error("Supabase error details:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw new Error(`Database error: ${error.message}${error.hint ? ' - ' + error.hint : ''}`);
      }

      console.log("Source added successfully:", data);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source added successfully");
      setName("");
      setType("");
      setMonitorType("");
      setUrl("");
      setConfigJson("");
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error adding source:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to add source. Please try again.";
      toast.error(errorMessage);
      
      reportError({
        title: "Source Addition Failed",
        description: `Failed to add new OSINT source: ${name}`,
        severity: "high",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "Source Management - Add Source"
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addSourceMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Source</DialogTitle>
          <DialogDescription>
            Configure a new OSINT source for intelligence gathering
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Source Name</Label>
            <Input
              id="name"
              placeholder="e.g., Twitter Feed, News API"
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

          {(type === 'api' || type === 'rss' || type === 'webhook') && (
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://bc-north.com/"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The URL to monitor or fetch data from
              </p>
            </div>
          )}

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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addSourceMutation.isPending}>
              {addSourceMutation.isPending ? "Adding..." : "Add Source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
