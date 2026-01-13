import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Play,
  FileText,
  Download,
  Copy,
  Bot,
  Loader2,
  CheckCircle2,
  Clock,
  Target,
  Users,
  Eye,
  EyeOff,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import { ValidationStatusPill } from "./ValidationStatusPill";
import { LintResultsPanel } from "./LintResultsPanel";

interface MissionViewProps {
  missionId: string;
  onBack: () => void;
}

const PHASE_STEPS = [
  { key: "intake", label: "Intake", icon: Clock },
  { key: "briefing", label: "Briefing", icon: Target },
  { key: "execution", label: "Execution", icon: Users },
  { key: "synthesis", label: "Synthesis", icon: FileText },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
];

const ROLE_LABELS: Record<string, string> = {
  leader: "Task Force Leader",
  intelligence_analyst: "Intelligence Analyst",
  operations_officer: "Operations Officer",
  client_liaison: "Client Liaison",
};

export function MissionView({ missionId, onBack }: MissionViewProps) {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);

  const { data: mission, isLoading: missionLoading } = useQuery({
    queryKey: ["mission", missionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_force_missions")
        .select("*, clients(name)")
        .eq("id", missionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: agents } = useQuery({
    queryKey: ["mission-agents", missionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_force_agents")
        .select("*, ai_agents(*)")
        .eq("mission_id", missionId);
      if (error) throw error;
      return data;
    },
  });

  const { data: contributions } = useQuery({
    queryKey: ["mission-contributions", missionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_force_contributions")
        .select("*, ai_agents(codename, call_sign, avatar_color)")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: isRunning ? 3000 : false,
  });

  const runMission = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-task-force", {
        body: { mission_id: missionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission", missionId] });
      queryClient.invalidateQueries({ queryKey: ["mission-contributions", missionId] });
      toast.success("Mission execution started");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to run mission");
    },
  });

  const handleRunMission = async () => {
    setIsRunning(true);
    try {
      await runMission.mutateAsync();
    } finally {
      setIsRunning(false);
    }
  };

  const copyFinalOutput = () => {
    if (mission?.final_output) {
      navigator.clipboard.writeText(mission.final_output);
      toast.success("Copied to clipboard");
    }
  };

  const currentPhaseIndex = PHASE_STEPS.findIndex((p) => p.key === mission?.phase);

  if (missionLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{mission?.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="capitalize">
                  {mission?.mission_type?.replace("_", " ")}
                </Badge>
                <Badge className={`bg-${mission?.priority === "P1" ? "red" : mission?.priority === "P2" ? "orange" : "yellow"}-500/20`}>
                  {mission?.priority}
                </Badge>
                {mission?.is_stealth_mode ? (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <EyeOff className="h-3 w-3" />
                    Stealth
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    Transparent
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRunMission}
              disabled={isRunning || mission?.phase === "completed"}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Strike Team
            </Button>
          </div>
        </div>

        {/* Phase Progress */}
        <div className="flex items-center justify-between bg-card border rounded-lg p-4">
          {PHASE_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.key === mission?.phase;
            const isCompleted = index < currentPhaseIndex;
            return (
              <div key={step.key} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-green-500/20 text-green-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span
                  className={`text-sm font-medium ${
                    isActive ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
                {index < PHASE_STEPS.length - 1 && (
                  <div
                    className={`w-12 h-0.5 mx-2 ${
                      isCompleted ? "bg-green-500" : "bg-border"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Main 3-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel - Mission Details */}
          <div className="lg:col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Mission Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Description</p>
                  <p>{mission?.description || "—"}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-muted-foreground mb-1">Desired Outcome</p>
                  <p>{mission?.desired_outcome || "—"}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-muted-foreground mb-1">Constraints</p>
                  <p>{mission?.constraints || "—"}</p>
                </div>
                {mission?.clients?.name && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-muted-foreground mb-1">Client</p>
                      <p>{mission.clients.name}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Assigned Agents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {agents?.map((assignment) => (
                  <div key={assignment.id} className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: assignment.ai_agents?.avatar_color + "20" }}
                    >
                      <Bot
                        className="h-4 w-4"
                        style={{ color: assignment.ai_agents?.avatar_color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {assignment.ai_agents?.call_sign}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[assignment.role] || assignment.role}
                      </p>
                    </div>
                    <Badge
                      variant={assignment.status === "completed" ? "default" : "secondary"}
                      className="text-xs capitalize"
                    >
                      {assignment.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Center Panel - Team Feed */}
          <div className="lg:col-span-5">
            <Card className="h-[600px] flex flex-col">
              <CardHeader className="pb-2 flex-shrink-0">
                <CardTitle className="text-sm">Team Feed</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6">
                  {!contributions?.length ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p>No contributions yet</p>
                        <p className="text-sm">Run the strike team to begin</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 py-4">
                      {contributions?.map((contribution) => (
                        <div
                          key={contribution.id}
                          className="border rounded-lg p-4 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Bot
                                className="h-4 w-4"
                                style={{ color: contribution.ai_agents?.avatar_color }}
                              />
                              <span className="font-medium text-sm">
                                {contribution.ai_agents?.call_sign}
                              </span>
                              <Badge variant="outline" className="text-xs capitalize">
                                {contribution.role.replace("_", " ")}
                              </Badge>
                            </div>
                            {contribution.confidence_score && (
                              <Badge variant="secondary" className="text-xs">
                                {Math.round(contribution.confidence_score * 100)}% conf
                              </Badge>
                            )}
                          </div>
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <ReactMarkdown>{contribution.content}</ReactMarkdown>
                          </div>
                          {contribution.assumptions?.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              <strong>Assumptions:</strong> {contribution.assumptions.join(", ")}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(contribution.created_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Final Output */}
          <div className="lg:col-span-4 space-y-4">
            {/* Validation Status */}
            {mission?.validation_status && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4" />
                      Output Gate
                    </CardTitle>
                    <ValidationStatusPill 
                      status={mission.validation_status as "PASS" | "WARN" | "FAIL" | "PENDING"} 
                      errors={mission.validation_errors as string[] | undefined}
                    />
                  </div>
                </CardHeader>
                {mission.validation_errors && (mission.validation_errors as string[]).length > 0 && (
                  <CardContent className="pt-0">
                    <LintResultsPanel
                      results={(mission.validation_errors as string[]).map((err: string) => {
                        const ruleMatch = err.match(/\[([A-Z-]+)\]/);
                        const autoFixed = err.includes('[AUTO-FIXED]');
                        return {
                          rule_id: ruleMatch?.[1] || 'UNKNOWN',
                          severity: err.includes('Evidence too low') ? 'BLOCK' as const : 
                                   (ruleMatch?.[1]?.includes('WARN') ? 'WARN' as const : 'BLOCK' as const),
                          message: err.replace(/\[[A-Z-]+\]\s*/, '').replace(' [AUTO-FIXED]', ''),
                          suggested_fix: 'See RoE documentation',
                          match: '',
                          auto_fixed: autoFixed,
                        };
                      })}
                      blockCount={(mission.validation_errors as string[]).filter((e: string) => !e.includes('[AUTO-FIXED]') && !e.includes('WARN')).length}
                      warnCount={(mission.validation_errors as string[]).filter((e: string) => e.includes('WARN')).length}
                      infoCount={0}
                    />
                  </CardContent>
                )}
              </Card>
            )}

            <Card className="h-[500px] flex flex-col">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Final Output</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={copyFinalOutput}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6">
                  {mission?.final_output ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none py-4">
                      <ReactMarkdown>{mission.final_output}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p>No final output yet</p>
                        <p className="text-sm">Complete the mission to generate</p>
                      </div>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
