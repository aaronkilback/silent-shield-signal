import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Zap, Play, Square, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown,
  Brain, Search, GitBranch, Calendar, Shield
} from "lucide-react";

interface AutopilotTask {
  id: string;
  task_type: string;
  task_label: string;
  agent_call_sign: string | null;
  status: string;
  sort_order: number;
  findings: any[];
  summary: string | null;
  confidence_score: number | null;
  entities_found: string[];
  signals_correlated: string[];
  review_status: string;
  reviewer_notes: string | null;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface AutopilotSession {
  id: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  overall_summary: string | null;
  risk_score: number | null;
  key_findings: any[];
  recommendations: any[];
  started_at: string | null;
  completed_at: string | null;
}

const TASK_ICONS: Record<string, React.ReactNode> = {
  entity_extraction: <Brain className="h-4 w-4" />,
  signal_crossref: <Search className="h-4 w-4" />,
  pattern_matching: <GitBranch className="h-4 w-4" />,
  timeline_construction: <Calendar className="h-4 w-4" />,
  risk_assessment: <Shield className="h-4 w-4" />,
};

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="h-3.5 w-3.5" />, color: "text-muted-foreground", label: "Queued" },
  running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, color: "text-primary", label: "Running" },
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-green-500", label: "Complete" },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, color: "text-destructive", label: "Failed" },
  skipped: { icon: <XCircle className="h-3.5 w-3.5" />, color: "text-muted-foreground", label: "Skipped" },
};

export function AutopilotPanel({ investigationId }: { investigationId: string }) {
  const { user } = useAuth();
  const [session, setSession] = useState<AutopilotSession | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);

  // Load existing session
  const loadSession = useCallback(async () => {
    const { data: sessions } = await supabase
      .from("investigation_autopilot_sessions")
      .select("*")
      .eq("investigation_id", investigationId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (sessions && sessions.length > 0) {
      const s = sessions[0];
      setSession({
        id: s.id,
        status: s.status || "planning",
        total_tasks: s.total_tasks || 0,
        completed_tasks: s.completed_tasks || 0,
        overall_summary: s.overall_summary,
        risk_score: typeof s.risk_score === "number" ? s.risk_score : null,
        key_findings: Array.isArray(s.key_findings) ? s.key_findings : [],
        recommendations: Array.isArray(s.recommendations) ? s.recommendations : [],
        started_at: s.started_at,
        completed_at: s.completed_at,
      });

      // Load tasks
      const { data: taskData } = await supabase
        .from("investigation_autopilot_tasks")
        .select("*")
        .eq("session_id", s.id)
        .order("sort_order", { ascending: true });

      if (taskData) {
        setTasks(taskData.map((t: any) => ({
          id: t.id,
          task_type: t.task_type,
          task_label: t.task_label,
          agent_call_sign: t.agent_call_sign,
          status: t.status || "pending",
          sort_order: t.sort_order || 0,
          findings: Array.isArray(t.findings) ? t.findings : [],
          summary: t.summary,
          confidence_score: typeof t.confidence_score === "number" ? t.confidence_score : null,
          entities_found: Array.isArray(t.entities_found) ? t.entities_found : [],
          signals_correlated: Array.isArray(t.signals_correlated) ? t.signals_correlated : [],
          review_status: t.review_status || "pending_review",
          reviewer_notes: t.reviewer_notes,
          duration_ms: t.duration_ms,
          error_message: t.error_message,
          started_at: t.started_at,
          completed_at: t.completed_at,
        })));
      }
    }
  }, [investigationId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!session?.id) return;

    const taskChannel = supabase
      .channel(`autopilot-tasks-${session.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "investigation_autopilot_tasks",
        filter: `session_id=eq.${session.id}`,
      }, () => { loadSession(); })
      .subscribe();

    const sessionChannel = supabase
      .channel(`autopilot-session-${session.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "investigation_autopilot_sessions",
        filter: `id=eq.${session.id}`,
      }, () => { loadSession(); })
      .subscribe();

    return () => {
      supabase.removeChannel(taskChannel);
      supabase.removeChannel(sessionChannel);
    };
  }, [session?.id, loadSession]);

  const startAutopilot = async () => {
    setIsStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("investigation-autopilot", {
        body: { investigation_id: investigationId, action: "start" },
      });

      if (error) throw error;
      toast.success("Autopilot activated — executing tasks");
      await loadSession();

      // Auto-execute remaining tasks sequentially
      if (data?.tasks) {
        const pendingTasks = data.tasks
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .filter((t: any) => t.status === "pending");

        for (const task of pendingTasks) {
          await executeTask(task.id);
        }
      }
    } catch (e) {
      console.error("Autopilot start failed:", e);
      toast.error("Failed to start autopilot");
    } finally {
      setIsStarting(false);
    }
  };

  const executeTask = async (taskId: string) => {
    setExecutingTaskId(taskId);
    try {
      await supabase.functions.invoke("investigation-autopilot", {
        body: { investigation_id: investigationId, action: "execute_task", task_id: taskId },
      });
      await loadSession();
    } catch (e) {
      console.error("Task execution failed:", e);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const cancelAutopilot = async () => {
    if (!session) return;
    try {
      await supabase.functions.invoke("investigation-autopilot", {
        body: { investigation_id: investigationId, action: "cancel", session_id: session.id },
      });
      toast.info("Autopilot cancelled");
      await loadSession();
    } catch (e) {
      toast.error("Failed to cancel");
    }
  };

  const reviewTask = async (taskId: string, status: "approved" | "rejected") => {
    await supabase
      .from("investigation_autopilot_tasks")
      .update({
        review_status: status,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", taskId);

    toast.success(`Findings ${status}`);
    await loadSession();
  };

  const progress = session ? ((session.completed_tasks / Math.max(session.total_tasks, 1)) * 100) : 0;

  // No session — show start button
  if (!session) {
    return (
      <Card className="border-dashed border-primary/30">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Zap className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">Investigation Autopilot</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Let AI agents autonomously execute investigation steps — entity extraction, signal cross-reference,
              pattern matching, timeline construction, and risk assessment. You review and approve findings.
            </p>
          </div>
          <Button onClick={startAutopilot} disabled={isStarting} className="gap-2">
            {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isStarting ? "Initializing..." : "Activate Autopilot"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                session.status === "running" ? "bg-primary/15 animate-pulse" :
                session.status === "completed" ? "bg-green-500/15" : "bg-muted"
              )}>
                <Zap className={cn(
                  "h-5 w-5",
                  session.status === "running" ? "text-primary" :
                  session.status === "completed" ? "text-green-500" : "text-muted-foreground"
                )} />
              </div>
              <div>
                <CardTitle className="text-base">Investigation Autopilot</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {session.status === "running" ? "Executing tasks..." :
                   session.status === "completed" ? "All tasks completed — review findings below" :
                   session.status === "cancelled" ? "Cancelled" : session.status}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {session.status === "running" && (
                <Button variant="outline" size="sm" onClick={cancelAutopilot} className="gap-1.5">
                  <Square className="h-3 w-3" /> Cancel
                </Button>
              )}
              {session.status === "completed" && session.risk_score !== null && (
                <div className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold",
                  session.risk_score > 0.7 ? "bg-destructive/15 text-destructive" :
                  session.risk_score > 0.4 ? "bg-yellow-500/15 text-yellow-600" :
                  "bg-green-500/15 text-green-600"
                )}>
                  Risk: {(session.risk_score * 100).toFixed(0)}%
                </div>
              )}
            </div>
          </div>
          {(session.status === "running" || session.status === "planning") && (
            <Progress value={progress} className="mt-3 h-2" />
          )}
        </CardHeader>
      </Card>

      {/* Overall summary */}
      {session.status === "completed" && session.overall_summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Executive Summary
            </h4>
            <p className="text-sm text-foreground/90 leading-relaxed">{session.overall_summary}</p>

            {session.key_findings && session.key_findings.length > 0 && (
              <div className="mt-3">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Key Findings</h5>
                <ul className="space-y-1">
                  {(session.key_findings as string[]).map((f, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {session.recommendations && session.recommendations.length > 0 && (
              <div className="mt-3">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Recommendations</h5>
                <ul className="space-y-1">
                  {(session.recommendations as string[]).map((r, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <span className="text-yellow-500 mt-0.5">→</span> {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task) => {
          const statusConfig = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
          const isExpanded = expandedTask === task.id;
          const isExecuting = executingTaskId === task.id || task.status === "running";

          return (
            <Card key={task.id} className={cn(
              "transition-all",
              task.status === "running" && "border-primary/40 shadow-sm",
              task.status === "completed" && "border-green-500/20"
            )}>
              <CardContent className="py-3 px-4">
                {/* Task header */}
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <div className={cn("flex-shrink-0", statusConfig.color)}>
                    {TASK_ICONS[task.task_type] || <Zap className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{task.task_label}</span>
                      {task.agent_call_sign && (
                        <span className="text-[10px] font-mono text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded">
                          {task.agent_call_sign}
                        </span>
                      )}
                    </div>
                    {task.summary && !isExpanded && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{task.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn("flex items-center gap-1 text-xs", statusConfig.color)}>
                      {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : statusConfig.icon}
                      {statusConfig.label}
                    </span>
                    {task.confidence_score !== null && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {(task.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                    {task.findings.length > 0 && (
                      isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> :
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded findings */}
                {isExpanded && task.status === "completed" && (
                  <div className="mt-3 border-t border-border/50 pt-3 space-y-3">
                    {task.summary && (
                      <p className="text-xs text-foreground/80 leading-relaxed">{task.summary}</p>
                    )}

                    {task.findings.length > 0 && (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-thin">
                        {task.findings.map((f: any, i: number) => (
                          <div key={i} className={cn(
                            "text-xs rounded-lg px-3 py-2 border",
                            f.severity === "high" ? "bg-destructive/5 border-destructive/20" :
                            f.severity === "medium" ? "bg-yellow-500/5 border-yellow-500/20" :
                            "bg-muted/30 border-border/30"
                          )}>
                            <div className="font-medium text-foreground/90">{f.title}</div>
                            {f.detail && <div className="text-muted-foreground mt-0.5 whitespace-pre-line">{f.detail}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {task.duration_ms && (
                      <p className="text-[10px] text-muted-foreground/60">
                        Completed in {(task.duration_ms / 1000).toFixed(1)}s
                      </p>
                    )}

                    {/* Review controls */}
                    {task.review_status === "pending_review" && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-green-600 border-green-500/30 hover:bg-green-500/10"
                          onClick={(e) => { e.stopPropagation(); reviewTask(task.id, "approved"); }}
                        >
                          <ThumbsUp className="h-3 w-3" /> Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); reviewTask(task.id, "rejected"); }}
                        >
                          <ThumbsDown className="h-3 w-3" /> Reject
                        </Button>
                      </div>
                    )}

                    {task.review_status !== "pending_review" && (
                      <div className={cn(
                        "text-xs font-medium flex items-center gap-1",
                        task.review_status === "approved" ? "text-green-600" : "text-destructive"
                      )}>
                        {task.review_status === "approved" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {task.review_status === "approved" ? "Approved" : "Rejected"}
                      </div>
                    )}
                  </div>
                )}

                {/* Error display */}
                {isExpanded && task.status === "failed" && task.error_message && (
                  <div className="mt-3 border-t border-border/50 pt-3">
                    <div className="text-xs text-destructive flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      {task.error_message}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Re-run button */}
      {session.status === "completed" || session.status === "cancelled" ? (
        <Button variant="outline" onClick={() => { setSession(null); setTasks([]); }} className="w-full gap-2">
          <Play className="h-4 w-4" /> Run New Autopilot Session
        </Button>
      ) : null}
    </div>
  );
}
