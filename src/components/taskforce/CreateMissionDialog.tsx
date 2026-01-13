import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Loader2, X, Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface CreateMissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (mission: any) => void;
}

const MISSION_TYPES = [
  { value: "risk_snapshot", label: "Risk Snapshot" },
  { value: "incident_response", label: "Incident Response" },
  { value: "site_assessment", label: "Site Assessment" },
  { value: "executive_brief", label: "Executive Brief" },
  { value: "client_onboarding", label: "Client Onboarding" },
  { value: "threat_assessment", label: "Threat Assessment" },
  { value: "custom", label: "Custom" },
];

const TIME_HORIZONS = [
  { value: "immediate", label: "Immediate" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
];

const AGENT_ROLES = [
  { value: "leader", label: "Task Force Leader" },
  { value: "intelligence_analyst", label: "Intelligence Analyst" },
  { value: "operations_officer", label: "Operations Officer" },
  { value: "client_liaison", label: "Client Liaison" },
];

interface AgentAssignment {
  agent_id: string;
  role: string;
}

export function CreateMissionDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateMissionDialogProps) {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    name: "",
    mission_type: "risk_snapshot",
    priority: "P3",
    time_horizon: "24h",
    description: "",
    desired_outcome: "",
    constraints: "",
    audience: "",
    is_stealth_mode: true,
    client_id: null as string | null,
  });

  const [agentAssignments, setAgentAssignments] = useState<AgentAssignment[]>([]);

  const { data: agents } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleSubmit = async () => {
    if (!formData.name) {
      toast.error("Please enter a mission name");
      return;
    }

    if (agentAssignments.length === 0) {
      toast.error("Please assign at least one agent");
      return;
    }

    if (!agentAssignments.some((a) => a.role === "leader")) {
      toast.error("Please assign a Task Force Leader");
      return;
    }

    setIsLoading(true);
    try {
      // Create mission
      const { data: mission, error: missionError } = await supabase
        .from("task_force_missions")
        .insert({
          name: formData.name,
          mission_type: formData.mission_type as any,
          priority: formData.priority,
          time_horizon: formData.time_horizon as any,
          description: formData.description,
          desired_outcome: formData.desired_outcome,
          constraints: formData.constraints,
          audience: formData.audience,
          is_stealth_mode: formData.is_stealth_mode,
          client_id: formData.client_id,
        })
        .select()
        .single();

      if (missionError) throw missionError;

      // Assign agents
      const agentInserts = agentAssignments.map((a) => ({
        mission_id: mission.id,
        agent_id: a.agent_id,
        role: a.role as "leader" | "intelligence_analyst" | "operations_officer" | "client_liaison",
      }));

      const { error: agentsError } = await supabase
        .from("task_force_agents")
        .insert(agentInserts);

      if (agentsError) throw agentsError;

      toast.success("Mission created successfully");
      onSuccess(mission);
      resetForm();
    } catch (error: any) {
      console.error("Error creating mission:", error);
      toast.error(error.message || "Failed to create mission");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      mission_type: "risk_snapshot",
      priority: "P3",
      time_horizon: "24h",
      description: "",
      desired_outcome: "",
      constraints: "",
      audience: "",
      is_stealth_mode: true,
      client_id: null,
    });
    setAgentAssignments([]);
    setStep(1);
  };

  const addAgentAssignment = (agent_id: string, role: string) => {
    if (agentAssignments.some((a) => a.agent_id === agent_id)) {
      toast.error("This agent is already assigned");
      return;
    }
    setAgentAssignments((prev) => [...prev, { agent_id, role }]);
  };

  const removeAgentAssignment = (agent_id: string) => {
    setAgentAssignments((prev) => prev.filter((a) => a.agent_id !== agent_id));
  };

  const getAgentById = (id: string) => agents?.find((a) => a.id === id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Create Mission — Details" : "Create Mission — Assign Agents"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-6 py-4">
            {/* Mission Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Mission Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Operation Thunder Shield"
              />
            </div>

            {/* Type, Priority, Time Horizon */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Mission Type</Label>
                <Select
                  value={formData.mission_type}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, mission_type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MISSION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, priority: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P1">P1 - Critical</SelectItem>
                    <SelectItem value="P2">P2 - High</SelectItem>
                    <SelectItem value="P3">P3 - Medium</SelectItem>
                    <SelectItem value="P4">P4 - Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Time Horizon</Label>
                <Select
                  value={formData.time_horizon}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, time_horizon: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_HORIZONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Client */}
            <div className="space-y-2">
              <Label>Client (Optional)</Label>
              <Select
                value={formData.client_id || "none"}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    client_id: value === "none" ? null : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Mission Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Describe the mission objectives and context..."
                rows={3}
              />
            </div>

            {/* Desired Outcome */}
            <div className="space-y-2">
              <Label htmlFor="desired_outcome">Desired Outcome</Label>
              <Textarea
                id="desired_outcome"
                value={formData.desired_outcome}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, desired_outcome: e.target.value }))
                }
                placeholder="What does success look like?"
                rows={2}
              />
            </div>

            {/* Constraints */}
            <div className="space-y-2">
              <Label htmlFor="constraints">Constraints & Rules of Engagement</Label>
              <Textarea
                id="constraints"
                value={formData.constraints}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, constraints: e.target.value }))
                }
                placeholder="Time limits, budget, scope restrictions..."
                rows={2}
              />
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label className="text-base">Stealth Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Only final output visible to clients
                </p>
              </div>
              <Switch
                checked={formData.is_stealth_mode}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, is_stealth_mode: checked }))
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Agent Selection */}
            <div className="space-y-4">
              <Label>Assign Agents to Roles</Label>
              
              {AGENT_ROLES.map((role) => (
                <div key={role.value} className="space-y-2">
                  <Label className="text-sm text-muted-foreground">{role.label}</Label>
                  <Select
                    onValueChange={(agentId) => addAgentAssignment(agentId, role.value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${role.label}...`} />
                    </SelectTrigger>
                    <SelectContent>
                      {agents
                        ?.filter((a) => !agentAssignments.some((aa) => aa.agent_id === a.id))
                        .map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4" style={{ color: agent.avatar_color }} />
                              {agent.call_sign} — {agent.codename}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Assigned Agents */}
            {agentAssignments.length > 0 && (
              <div className="space-y-2">
                <Label>Assigned Team</Label>
                <div className="flex flex-wrap gap-2">
                  {agentAssignments.map((assignment) => {
                    const agent = getAgentById(assignment.agent_id);
                    const roleLabel = AGENT_ROLES.find((r) => r.value === assignment.role)?.label;
                    return (
                      <Badge
                        key={assignment.agent_id}
                        variant="secondary"
                        className="flex items-center gap-2 py-1.5 px-3"
                      >
                        <Bot className="h-3 w-3" style={{ color: agent?.avatar_color }} />
                        <span>{agent?.call_sign}</span>
                        <span className="text-muted-foreground">({roleLabel})</span>
                        <button
                          onClick={() => removeAgentAssignment(assignment.agent_id)}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!formData.name}>
              Next: Assign Agents
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Mission
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
