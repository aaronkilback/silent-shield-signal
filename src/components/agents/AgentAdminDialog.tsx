import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AIAgent {
  id: string;
  header_name: string | null;
  codename: string;
  call_sign: string;
  persona: string;
  specialty: string;
  mission_scope: string;
  interaction_style: string;
  input_sources: string[];
  output_types: string[];
  is_client_facing: boolean;
  is_active: boolean;
  avatar_color: string;
  system_prompt: string | null;
}

interface AgentAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AIAgent | null;
  onSuccess: () => void;
}

const AVATAR_COLORS = [
  "#1E40AF", // Blue
  "#7C3AED", // Purple
  "#059669", // Green
  "#DC2626", // Red
  "#D97706", // Amber
  "#0891B2", // Cyan
  "#4F46E5", // Indigo
  "#BE185D", // Pink
];

const INPUT_SOURCE_OPTIONS = [
  "OSINT",
  "signals",
  "incidents",
  "entities",
  "clients",
  "playbooks",
  "escalation_rules",
  "onboarding",
  "tasks",
  "documents",
];

const OUTPUT_TYPE_OPTIONS = [
  "Intelligence Briefings",
  "Signal Confidence Scores",
  "Pattern Alerts",
  "Incident Playbooks",
  "Drill Schedules",
  "Recovery Plans",
  "Setup Checklists",
  "Progress Reports",
  "Reminder Alerts",
  "Vulnerability Snapshots",
];

export function AgentAdminDialog({
  open,
  onOpenChange,
  agent,
  onSuccess,
}: AgentAdminDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    header_name: "",
    codename: "",
    call_sign: "",
    persona: "",
    specialty: "",
    mission_scope: "",
    interaction_style: "chat",
    input_sources: [] as string[],
    output_types: [] as string[],
    is_client_facing: false,
    is_active: true,
    avatar_color: AVATAR_COLORS[0],
    system_prompt: "",
  });

  const [inputSourceInput, setInputSourceInput] = useState("");
  const [outputTypeInput, setOutputTypeInput] = useState("");

  useEffect(() => {
    if (agent) {
      setFormData({
        header_name: agent.header_name || "",
        codename: agent.codename,
        call_sign: agent.call_sign,
        persona: agent.persona,
        specialty: agent.specialty,
        mission_scope: agent.mission_scope,
        interaction_style: agent.interaction_style,
        input_sources: agent.input_sources || [],
        output_types: agent.output_types || [],
        is_client_facing: agent.is_client_facing,
        is_active: agent.is_active,
        avatar_color: agent.avatar_color,
        system_prompt: agent.system_prompt || "",
      });
    } else {
      setFormData({
        header_name: "",
        codename: "",
        call_sign: "",
        persona: "",
        specialty: "",
        mission_scope: "",
        interaction_style: "chat",
        input_sources: [],
        output_types: [],
        is_client_facing: false,
        is_active: true,
        avatar_color: AVATAR_COLORS[0],
        system_prompt: "",
      });
    }
  }, [agent, open]);

  const handleSubmit = async () => {
    if (!formData.codename || !formData.call_sign || !formData.persona) {
      toast.error("Please fill in required fields");
      return;
    }

    setIsLoading(true);
    try {
      if (agent) {
        const { error } = await supabase
          .from("ai_agents")
          .update(formData)
          .eq("id", agent.id);
        if (error) throw error;
        toast.success("Agent updated successfully");
      } else {
        const { error } = await supabase.from("ai_agents").insert(formData);
        if (error) throw error;
        toast.success("Agent created successfully");
      }
      onSuccess();
    } catch (error: any) {
      console.error("Error saving agent:", error);
      toast.error(error.message || "Failed to save agent");
    } finally {
      setIsLoading(false);
    }
  };

  const addInputSource = (source: string) => {
    if (source && !formData.input_sources.includes(source)) {
      setFormData((prev) => ({
        ...prev,
        input_sources: [...prev.input_sources, source],
      }));
    }
    setInputSourceInput("");
  };

  const removeInputSource = (source: string) => {
    setFormData((prev) => ({
      ...prev,
      input_sources: prev.input_sources.filter((s) => s !== source),
    }));
  };

  const addOutputType = (output: string) => {
    if (output && !formData.output_types.includes(output)) {
      setFormData((prev) => ({
        ...prev,
        output_types: [...prev.output_types, output],
      }));
    }
    setOutputTypeInput("");
  };

  const removeOutputType = (output: string) => {
    setFormData((prev) => ({
      ...prev,
      output_types: prev.output_types.filter((o) => o !== output),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {agent ? "Edit Agent" : "Create New Agent"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="header_name">Display Name *</Label>
            <Input
              id="header_name"
              value={formData.header_name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, header_name: e.target.value }))
              }
              placeholder="e.g., McGraw, Jessica Pearson"
            />
            <p className="text-xs text-muted-foreground">
              The primary name shown in chat tabs and headings
            </p>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="codename">Codename *</Label>
              <Input
                id="codename"
                value={formData.codename}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, codename: e.target.value }))
                }
                placeholder="e.g., Pathfinder, Oracle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="call_sign">Call Sign *</Label>
              <Input
                id="call_sign"
                value={formData.call_sign}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    call_sign: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g., LOCUS-INTEL"
              />
            </div>
          </div>

          {/* Avatar Color */}
          <div className="space-y-2">
            <Label>Avatar Color</Label>
            <div className="flex gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, avatar_color: color }))
                  }
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    formData.avatar_color === color
                      ? "border-foreground scale-110"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Persona */}
          <div className="space-y-2">
            <Label htmlFor="persona">Persona *</Label>
            <Textarea
              id="persona"
              value={formData.persona}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, persona: e.target.value }))
              }
              placeholder="Calm CIA-style analyst with quiet authority..."
              rows={2}
            />
          </div>

          {/* Specialty & Mission */}
          <div className="space-y-2">
            <Label htmlFor="specialty">Specialty</Label>
            <Input
              id="specialty"
              value={formData.specialty}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, specialty: e.target.value }))
              }
              placeholder="Threat detection, OSINT analysis..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mission_scope">Mission Scope</Label>
            <Textarea
              id="mission_scope"
              value={formData.mission_scope}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  mission_scope: e.target.value,
                }))
              }
              placeholder="Generate Vulnerability Snapshots, detect emerging threats..."
              rows={2}
            />
          </div>

          {/* Interaction Style */}
          <div className="space-y-2">
            <Label>Interaction Style</Label>
            <Select
              value={formData.interaction_style}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, interaction_style: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="step-by-step">Step-by-Step</SelectItem>
                <SelectItem value="report">Auto-Generated Reports</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Input Sources */}
          <div className="space-y-2">
            <Label>Input Sources</Label>
            <div className="flex gap-2">
              <Select
                value={inputSourceInput}
                onValueChange={(value) => addInputSource(value)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add input source..." />
                </SelectTrigger>
                <SelectContent>
                  {INPUT_SOURCE_OPTIONS.filter(
                    (s) => !formData.input_sources.includes(s)
                  ).map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {formData.input_sources.map((source) => (
                <Badge
                  key={source}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => removeInputSource(source)}
                >
                  {source}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          </div>

          {/* Output Types */}
          <div className="space-y-2">
            <Label>Output Types</Label>
            <div className="flex gap-2">
              <Select
                value={outputTypeInput}
                onValueChange={(value) => addOutputType(value)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add output type..." />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_TYPE_OPTIONS.filter(
                    (o) => !formData.output_types.includes(o)
                  ).map((output) => (
                    <SelectItem key={output} value={output}>
                      {output}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {formData.output_types.map((output) => (
                <Badge
                  key={output}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => removeOutputType(output)}
                >
                  {output}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div className="space-y-2">
            <Label htmlFor="system_prompt">System Prompt</Label>
            <Textarea
              id="system_prompt"
              value={formData.system_prompt}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  system_prompt: e.target.value,
                }))
              }
              placeholder="You are a specialized AI agent..."
              rows={4}
            />
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_active: checked }))
                }
              />
              <Label>Active</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_client_facing}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_client_facing: checked }))
                }
              />
              <Label>Client-Facing</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {agent ? "Update Agent" : "Create Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
