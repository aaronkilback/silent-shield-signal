import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Shield, AlertTriangle, Check, X, Plus } from "lucide-react";
import { toast } from "sonner";

interface RoEEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roeId?: string;
  onSuccess?: () => void;
}

const EVIDENCE_LEVELS = [
  { value: "E0", label: "E0 - No evidence (hypothesis only)" },
  { value: "E1", label: "E1 - User-provided statement only" },
  { value: "E2", label: "E2 - Single internal source" },
  { value: "E3", label: "E3 - Two independent sources" },
  { value: "E4", label: "E4 - Confirmed (multi-source)" },
];

export function RoEEditor({ open, onOpenChange, roeId, onSuccess }: RoEEditorProps) {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  const { data: roe, isLoading: roeLoading } = useQuery({
    queryKey: ["roe", roeId],
    queryFn: async () => {
      if (!roeId) return null;
      const { data, error } = await supabase
        .from("rules_of_engagement")
        .select("*")
        .eq("id", roeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!roeId,
  });

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    mode: "STRICT",
    audience: "INTERNAL",
    classification: "CONFIDENTIAL",
    permissions: {
      can_read_sources: true,
      can_use_external_web: false,
      can_access_client_profile: true,
      can_access_internal_logs: true,
      can_generate_recommendations: true,
      can_issue_directives: false,
      can_schedule_actions: false,
      can_export_reports: true,
    },
    evidence_policy: {
      require_evidence_for_claims: true,
      minimum_evidence_for_client_output: "E2",
      minimum_evidence_for_directive: "E3",
    },
    uncertainty_protocol: {
      must_label_hypotheses: true,
    },
    scope_control: {
      must_stay_within_mission_objective: true,
      must_not_invent_data: true,
      max_questions_before_proceeding: 3,
    },
    validation_gate: {
      run_before_publish: true,
    },
  });

  // Update form when roe loads
  useState(() => {
    if (roe) {
      setFormData({
        name: roe.name || "",
        description: roe.description || "",
        mode: roe.mode || "STRICT",
        audience: roe.audience || "INTERNAL",
        classification: roe.classification || "CONFIDENTIAL",
        permissions: (roe.permissions as any) || formData.permissions,
        evidence_policy: (roe.evidence_policy as any) || formData.evidence_policy,
        uncertainty_protocol: (roe.uncertainty_protocol as any) || formData.uncertainty_protocol,
        scope_control: (roe.scope_control as any) || formData.scope_control,
        validation_gate: (roe.validation_gate as any) || formData.validation_gate,
      });
    }
  });

  const handleSave = async () => {
    if (!formData.name) {
      toast.error("Please enter a name");
      return;
    }

    setIsLoading(true);
    try {
      if (roeId) {
        const { error } = await supabase
          .from("rules_of_engagement")
          .update({
            name: formData.name,
            description: formData.description,
            mode: formData.mode as any,
            audience: formData.audience as any,
            classification: formData.classification as any,
            permissions: formData.permissions,
            evidence_policy: formData.evidence_policy,
            uncertainty_protocol: formData.uncertainty_protocol,
            scope_control: formData.scope_control,
            validation_gate: formData.validation_gate,
          })
          .eq("id", roeId);
        if (error) throw error;
        toast.success("RoE updated successfully");
      } else {
        const { error } = await supabase.from("rules_of_engagement").insert({
          name: formData.name,
          description: formData.description,
          mode: formData.mode as any,
          audience: formData.audience as any,
          classification: formData.classification as any,
          permissions: formData.permissions,
          evidence_policy: formData.evidence_policy,
          uncertainty_protocol: formData.uncertainty_protocol,
          scope_control: formData.scope_control,
          validation_gate: formData.validation_gate,
        });
        if (error) throw error;
        toast.success("RoE created successfully");
      }
      queryClient.invalidateQueries({ queryKey: ["rules-of-engagement"] });
      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving RoE:", error);
      toast.error(error.message || "Failed to save RoE");
    } finally {
      setIsLoading(false);
    }
  };

  const togglePermission = (key: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key as keyof typeof prev.permissions],
      },
    }));
  };

  if (roeLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {roeId ? "Edit Rules of Engagement" : "Create Rules of Engagement"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <Tabs defaultValue="general" className="space-y-4">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="scope">Scope</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Client-Facing STRICT RoE"
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Rules for client-facing outputs..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select
                    value={formData.mode}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, mode: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRICT">STRICT</SelectItem>
                      <SelectItem value="STANDARD">STANDARD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select
                    value={formData.audience}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, audience: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INTERNAL">Internal</SelectItem>
                      <SelectItem value="CLIENT">Client</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Classification</Label>
                  <Select
                    value={formData.classification}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, classification: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PUBLIC">Public</SelectItem>
                      <SelectItem value="CONFIDENTIAL">Confidential</SelectItem>
                      <SelectItem value="RESTRICTED">Restricted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            {/* Permissions Tab */}
            <TabsContent value="permissions" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Agent Permissions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(formData.permissions).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between py-2">
                      <Label className="capitalize">
                        {key.replace(/_/g, " ")}
                      </Label>
                      <Switch
                        checked={value}
                        onCheckedChange={() => togglePermission(key)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Evidence Tab */}
            <TabsContent value="evidence" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Evidence Policy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Require evidence for claims</Label>
                    <Switch
                      checked={formData.evidence_policy.require_evidence_for_claims}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          evidence_policy: {
                            ...prev.evidence_policy,
                            require_evidence_for_claims: checked,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Minimum evidence for client output</Label>
                    <Select
                      value={formData.evidence_policy.minimum_evidence_for_client_output}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          evidence_policy: {
                            ...prev.evidence_policy,
                            minimum_evidence_for_client_output: value,
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVIDENCE_LEVELS.map((level) => (
                          <SelectItem key={level.value} value={level.value}>
                            {level.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Minimum evidence for directives</Label>
                    <Select
                      value={formData.evidence_policy.minimum_evidence_for_directive}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          evidence_policy: {
                            ...prev.evidence_policy,
                            minimum_evidence_for_directive: value,
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVIDENCE_LEVELS.map((level) => (
                          <SelectItem key={level.value} value={level.value}>
                            {level.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="pt-2 border-t">
                    <Label className="text-muted-foreground text-sm">Evidence Levels Reference</Label>
                    <div className="mt-2 space-y-1 text-sm">
                      {EVIDENCE_LEVELS.map((level) => (
                        <div key={level.value} className="flex items-center gap-2">
                          <Badge variant="outline" className="w-8 justify-center">
                            {level.value}
                          </Badge>
                          <span className="text-muted-foreground">
                            {level.label.split(" - ")[1]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Scope Tab */}
            <TabsContent value="scope" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Scope Control</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Must stay within mission objective</Label>
                      <p className="text-xs text-muted-foreground">
                        Agents cannot go outside their assigned scope
                      </p>
                    </div>
                    <Switch
                      checked={formData.scope_control.must_stay_within_mission_objective}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          scope_control: {
                            ...prev.scope_control,
                            must_stay_within_mission_objective: checked,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Must not invent data</Label>
                      <p className="text-xs text-muted-foreground">
                        Prevents hallucination of facts
                      </p>
                    </div>
                    <Switch
                      checked={formData.scope_control.must_not_invent_data}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          scope_control: {
                            ...prev.scope_control,
                            must_not_invent_data: checked,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Max questions before proceeding</Label>
                    <Select
                      value={String(formData.scope_control.max_questions_before_proceeding)}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          scope_control: {
                            ...prev.scope_control,
                            max_questions_before_proceeding: parseInt(value),
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 question</SelectItem>
                        <SelectItem value="2">2 questions</SelectItem>
                        <SelectItem value="3">3 questions</SelectItem>
                        <SelectItem value="5">5 questions</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Validation Tab */}
            <TabsContent value="validation" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Validation Gate</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Run validation before publish</Label>
                      <p className="text-xs text-muted-foreground">
                        All outputs must pass validation checks
                      </p>
                    </div>
                    <Switch
                      checked={formData.validation_gate.run_before_publish}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          validation_gate: {
                            ...prev.validation_gate,
                            run_before_publish: checked,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Must label hypotheses</Label>
                      <p className="text-xs text-muted-foreground">
                        Unverified claims must be marked
                      </p>
                    </div>
                    <Switch
                      checked={formData.uncertainty_protocol.must_label_hypotheses}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          uncertainty_protocol: {
                            ...prev.uncertainty_protocol,
                            must_label_hypotheses: checked,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="pt-3 border-t">
                    <Label className="text-muted-foreground text-sm">Active Validation Checks</Label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {["ScopeCheck", "EvidenceCheck", "UncertaintyFieldsCheck", "PermissionsCheck", "NoInventedFactsCheck"].map(
                        (check) => (
                          <Badge key={check} variant="secondary" className="justify-start">
                            <Check className="h-3 w-3 mr-1" />
                            {check}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {roeId ? "Update RoE" : "Create RoE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
