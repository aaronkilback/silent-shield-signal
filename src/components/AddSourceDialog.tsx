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
  const [configJson, setConfigJson] = useState("");
  const queryClient = useQueryClient();

  const addSourceMutation = useMutation({
    mutationFn: async () => {
      // Validate inputs
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
        .insert({
          name: name.trim(),
          type: type.trim(),
          config_json: parsedConfig,
          is_active: true,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source added successfully");
      setName("");
      setType("");
      setConfigJson("");
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error adding source:", error);
      toast.error(error instanceof Error ? error.message : "Failed to add source");
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
            <Select value={type} onValueChange={setType} required>
              <SelectTrigger>
                <SelectValue placeholder="Select source type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="social_media">Social Media</SelectItem>
                <SelectItem value="news">News</SelectItem>
                <SelectItem value="threat_intel">Threat Intelligence</SelectItem>
                <SelectItem value="darkweb">Dark Web</SelectItem>
                <SelectItem value="domain">Domain Monitoring</SelectItem>
                <SelectItem value="public_records">Public Records</SelectItem>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="rss">RSS Feed</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="config">Configuration (Optional JSON)</Label>
            <Textarea
              id="config"
              placeholder='{"api_key": "...", "endpoint": "..."}'
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={4}
              className="font-mono text-sm"
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
