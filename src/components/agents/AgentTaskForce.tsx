import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Users,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Swords,
  Lightbulb,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface AIAgent {
  id: string;
  codename: string;
  call_sign: string;
  header_name: string | null;
  specialty: string;
  avatar_color: string;
  is_active: boolean;
}

interface AgentAnalysis {
  agent: string;
  specialty: string;
  overall_assessment: string;
  hypotheses: Array<{ claim: string; confidence: number; strength: string; evidence_summary: string }>;
  counter_arguments: Array<{ claim: string; confidence: number; strength: string }>;
  confidence: number;
  error: boolean;
}

interface DebateResult {
  mode: string;
  question: string;
  agents_participated: number;
  individual_analyses: AgentAnalysis[];
  synthesis: { final_assessment?: string; content?: string };
  consensus_score: number;
  consensus_hypotheses: Array<{ claim: string; combined_confidence: number; strength: string; supporting_agents: string[] }>;
  contested_findings: Array<{ topic: string; positions: Array<{ agent: string; position: string; confidence: number }>; ruling: string }>;
  unique_insights: Array<{ insight: string; discovered_by: string; importance: string }>;
  recommended_actions: Array<{ action: string; priority: string; owner_suggestion?: string }>;
}

interface AgentTaskForceProps {
  agents: AIAgent[];
}

const STRENGTH_COLORS: Record<string, string> = {
  definitive: "text-green-400 border-green-500/40 bg-green-500/10",
  strong: "text-blue-400 border-blue-500/40 bg-blue-500/10",
  moderate: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  weak: "text-zinc-400 border-zinc-600 bg-zinc-800/50",
};

const PRIORITY_COLORS: Record<string, string> = {
  immediate: "bg-red-500/20 text-red-400 border-red-500/40",
  urgent: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  routine: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  deferred: "bg-zinc-700 text-zinc-400 border-zinc-600",
};

export function AgentTaskForce({ agents }: AgentTaskForceProps) {
  const [selectedCallSigns, setSelectedCallSigns] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [routingSuggestions, setRoutingSuggestions] = useState<Array<{ call_sign: string; similarity: number }> | null>(null);
  const [result, setResult] = useState<DebateResult | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const toggleAgent = (callSign: string) => {
    setSelectedCallSigns(prev => {
      const next = new Set(prev);
      if (next.has(callSign)) next.delete(callSign);
      else if (next.size < 6) next.add(callSign);
      else toast.warning("Maximum 6 agents per task force");
      return next;
    });
  };

  const handleAutoRoute = async () => {
    if (!question.trim()) {
      toast.error("Enter a question first so we can route to the best agents");
      return;
    }
    setIsRouting(true);
    setRoutingSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-router", {
        body: { question: question.trim(), top_k: 5 },
      });
      if (error) throw error;
      const suggested: Array<{ call_sign: string; similarity: number }> = data?.agents || [];
      if (suggested.length === 0) {
        toast.info("No routing suggestions — select agents manually");
        return;
      }
      setRoutingSuggestions(suggested);
      // Auto-select the top 4 suggested agents
      const topCallSigns = suggested.slice(0, 4).map(a => a.call_sign);
      setSelectedCallSigns(new Set(topCallSigns));
      toast.success(`Auto-routed to ${topCallSigns.length} best-matched agents`);
    } catch (_err) {
      toast.error("Auto-routing unavailable — select agents manually");
    } finally {
      setIsRouting(false);
    }
  };

  const handleRun = async () => {
    if (selectedCallSigns.size < 2) {
      toast.error("Select at least 2 agents");
      return;
    }
    if (!question.trim()) {
      toast.error("Enter a question or scenario for the task force");
      return;
    }

    setIsRunning(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("multi-agent-debate", {
        body: {
          call_signs: Array.from(selectedCallSigns),
          question: question.trim(),
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Debate failed");

      setResult(data as DebateResult);
      toast.success(`Task force complete — ${data.agents_participated} agents responded`);
    } catch (err) {
      console.error("[TaskForce] Error:", err);
      const msg = err instanceof Error ? err.message : "Task force failed";
      if (msg.includes("credits")) {
        toast.error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsRunning(false);
    }
  };

  const agentMap = new Map(agents.map(a => [a.call_sign, a]));

  return (
    <div className="space-y-6">
      {/* Agent Selection */}
      <Card className="bg-zinc-950 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-amber-500/80 uppercase tracking-wider flex items-center gap-2">
            <Users className="h-4 w-4" />
            Assemble Task Force
            <span className="text-zinc-500 font-normal normal-case">
              — select 2–6 agents
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            {agents.filter(a => a.is_active).map(agent => {
              const selected = selectedCallSigns.has(agent.call_sign);
              return (
                <button
                  key={agent.call_sign}
                  onClick={() => toggleAgent(agent.call_sign)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
                    selected
                      ? "border-amber-500 bg-amber-500/10 text-amber-400"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
                  )}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: agent.avatar_color + "30" }}
                  >
                    <Bot className="h-3 w-3" style={{ color: agent.avatar_color }} />
                  </div>
                  <span className="font-mono text-xs">
                    {agent.header_name || agent.codename}
                  </span>
                  {selected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {selectedCallSigns.size > 0 && (
            <div className="text-xs text-zinc-500 font-mono mb-4">
              Selected: {Array.from(selectedCallSigns).join(" · ")}
            </div>
          )}

          <Textarea
            value={question}
            onChange={e => { setQuestion(e.target.value); setRoutingSuggestions(null); }}
            placeholder="Enter a question, scenario, or intelligence problem for the task force to debate..."
            className="min-h-[80px] bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-600 resize-none mb-3"
            disabled={isRunning}
          />

          {/* Routing suggestions */}
          {routingSuggestions && routingSuggestions.length > 0 && (
            <div className="mb-3 p-3 bg-blue-950/30 border border-blue-800/40 rounded-lg">
              <p className="text-[10px] font-mono text-blue-400/70 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Semantic routing — best matched agents
              </p>
              <div className="flex flex-wrap gap-2">
                {routingSuggestions.map(s => {
                  const agent = agents.find(a => a.call_sign === s.call_sign);
                  if (!agent) return null;
                  const pct = Math.round(s.similarity * 100);
                  return (
                    <div key={s.call_sign} className="flex items-center gap-1.5 text-xs bg-blue-900/20 border border-blue-700/30 rounded px-2 py-1">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: agent.avatar_color + '40' }}>
                        <Bot className="h-3 w-3 m-0.5" style={{ color: agent.avatar_color }} />
                      </div>
                      <span className="text-blue-300 font-mono">{agent.header_name || agent.codename}</span>
                      <span className="text-blue-500/60">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleAutoRoute}
              disabled={isRunning || isRouting || !question.trim()}
              variant="outline"
              className="border-blue-700/50 text-blue-400 hover:bg-blue-900/20 hover:border-blue-600"
            >
              {isRouting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="ml-2 text-sm">Auto-Route</span>
            </Button>

            <Button
              onClick={handleRun}
              disabled={isRunning || selectedCallSigns.size < 2 || !question.trim()}
              className="bg-amber-600 hover:bg-amber-500 text-black font-semibold flex-1"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Task force deliberating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Launch Task Force Debate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isRunning && (
        <Card className="bg-zinc-950 border-zinc-800">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-10 w-10 mx-auto mb-4 animate-spin text-amber-500" />
            <p className="text-zinc-400 font-mono text-sm">
              {Array.from(selectedCallSigns).join(", ")} are deliberating independently...
            </p>
            <p className="text-zinc-600 text-xs mt-1">Each agent analyzes without seeing the others' work</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Question recap */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3">
            <p className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-1">Debate Question</p>
            <p className="text-sm text-zinc-300">{result.question}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-zinc-500">{result.agents_participated} agents responded</span>
              <span className="text-xs text-zinc-500">·</span>
              <span className="text-xs text-zinc-500">Consensus: {result.consensus_score}%</span>
            </div>
          </div>

          {/* Individual Analyses */}
          <div>
            <h3 className="text-xs font-mono text-amber-500/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Bot className="h-3.5 w-3.5" />
              Individual Agent Analyses
            </h3>
            <div className="space-y-3">
              {result.individual_analyses.map(analysis => {
                const agentDef = agentMap.get(analysis.agent);
                const isExpanded = expandedAgent === analysis.agent;

                return (
                  <Card
                    key={analysis.agent}
                    className={cn(
                      "bg-zinc-900 border-zinc-800 overflow-hidden",
                      analysis.error && "opacity-60"
                    )}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => setExpandedAgent(isExpanded ? null : analysis.agent)}
                    >
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: (agentDef?.avatar_color || "#6B7280") + "30" }}
                          >
                            <Bot
                              className="h-4 w-4"
                              style={{ color: agentDef?.avatar_color || "#6B7280" }}
                            />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-zinc-200">
                              {agentDef?.header_name || agentDef?.codename || analysis.agent}
                            </div>
                            <div className="text-xs text-zinc-500 font-mono">{analysis.agent}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {analysis.confidence != null && (
                            <span className="text-xs text-zinc-400 font-mono">
                              {Math.round(analysis.confidence * 100)}% conf
                            </span>
                          )}
                          {analysis.hypotheses?.length > 0 && (
                            <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-500">
                              {analysis.hypotheses.length} hypotheses
                            </Badge>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-zinc-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-4">
                        {/* Overall assessment */}
                        <div>
                          <p className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2">Assessment</p>
                          <div className="text-sm text-zinc-300 prose prose-sm prose-invert max-w-none">
                            <ReactMarkdown>{analysis.overall_assessment}</ReactMarkdown>
                          </div>
                        </div>

                        {/* Hypotheses */}
                        {analysis.hypotheses?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2">Hypotheses</p>
                            <div className="space-y-2">
                              {analysis.hypotheses.map((h, i) => (
                                <div key={i} className={cn("border rounded px-3 py-2 text-xs", STRENGTH_COLORS[h.strength] || STRENGTH_COLORS.moderate)}>
                                  <div className="flex items-start justify-between gap-2 mb-1">
                                    <span className="font-medium">{h.claim}</span>
                                    <span className="flex-shrink-0 font-mono opacity-70">{Math.round(h.confidence * 100)}%</span>
                                  </div>
                                  {h.evidence_summary && (
                                    <p className="opacity-70 mt-1">{h.evidence_summary}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Counter arguments */}
                        {analysis.counter_arguments?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2">Counter-Arguments</p>
                            <div className="space-y-2">
                              {analysis.counter_arguments.map((ca, i) => (
                                <div key={i} className="border border-red-500/30 bg-red-500/5 rounded px-3 py-2 text-xs text-red-300">
                                  {ca.claim}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          {/* Consensus Hypotheses */}
          {result.consensus_hypotheses?.length > 0 && (
            <div>
              <h3 className="text-xs font-mono text-green-500/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Consensus Findings
              </h3>
              <div className="space-y-2">
                {result.consensus_hypotheses.map((h, i) => (
                  <div key={i} className={cn("border rounded px-3 py-3", STRENGTH_COLORS[h.strength] || STRENGTH_COLORS.moderate)}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-medium">{h.claim}</p>
                      <span className="text-xs font-mono flex-shrink-0 opacity-70">{Math.round(h.combined_confidence * 100)}%</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {h.supporting_agents?.map(a => (
                        <Badge key={a} variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contested Findings */}
          {result.contested_findings?.length > 0 && (
            <div>
              <h3 className="text-xs font-mono text-red-500/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Swords className="h-3.5 w-3.5" />
                Contested Findings
              </h3>
              <div className="space-y-3">
                {result.contested_findings.map((cf, i) => (
                  <Card key={i} className="bg-zinc-900 border-red-500/20">
                    <CardContent className="p-4">
                      <p className="text-sm font-semibold text-zinc-200 mb-3">{cf.topic}</p>
                      <div className="space-y-2 mb-3">
                        {cf.positions?.map((pos, j) => {
                          const agentDef = agentMap.get(pos.agent);
                          return (
                            <div key={j} className="flex items-start gap-2 text-xs">
                              <Bot
                                className="h-3 w-3 mt-0.5 flex-shrink-0"
                                style={{ color: agentDef?.avatar_color || "#6B7280" }}
                              />
                              <span className="font-mono text-zinc-400 flex-shrink-0">{pos.agent}:</span>
                              <span className="text-zinc-300">{pos.position}</span>
                              <span className="text-zinc-500 flex-shrink-0">({Math.round(pos.confidence * 100)}%)</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2 text-xs text-amber-300">
                        <span className="font-semibold">Judge ruling: </span>{cf.ruling}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Unique Insights */}
          {result.unique_insights?.length > 0 && (
            <div>
              <h3 className="text-xs font-mono text-purple-500/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5" />
                Unique Insights
              </h3>
              <div className="space-y-2">
                {result.unique_insights.map((ui, i) => (
                  <div
                    key={i}
                    className={cn(
                      "border rounded px-3 py-2 text-xs",
                      ui.importance === 'critical' ? "border-red-500/40 bg-red-500/10 text-red-300" :
                      ui.importance === 'high' ? "border-orange-500/40 bg-orange-500/10 text-orange-300" :
                      "border-zinc-700 bg-zinc-900 text-zinc-400"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-zinc-500 flex-shrink-0">{ui.discovered_by}:</span>
                      <span>{ui.insight}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Actions */}
          {result.recommended_actions?.length > 0 && (
            <div>
              <h3 className="text-xs font-mono text-blue-500/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <ClipboardList className="h-3.5 w-3.5" />
                Recommended Actions
              </h3>
              <div className="space-y-2">
                {result.recommended_actions.map((ra, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] flex-shrink-0 mt-0.5", PRIORITY_COLORS[ra.priority] || PRIORITY_COLORS.routine)}
                    >
                      {ra.priority}
                    </Badge>
                    <span className="text-zinc-300">{ra.action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final Synthesis */}
          <Card className="bg-zinc-950 border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-amber-500/80 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                Judge Synthesis — Final Assessment
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 ml-auto">
                  {result.consensus_score}% consensus
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-zinc-300 prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>
                  {result.synthesis?.final_assessment || result.synthesis?.content || "No synthesis available"}
                </ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
