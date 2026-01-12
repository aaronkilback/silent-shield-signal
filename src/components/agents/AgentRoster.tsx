import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, Bot, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AIAgent {
  id: string;
  codename: string;
  call_sign: string;
  persona: string;
  specialty: string;
  avatar_color: string;
  is_active: boolean;
  is_client_facing: boolean;
}

interface AgentRosterProps {
  agents: AIAgent[];
  selectedAgent: AIAgent | null;
  onSelectAgent: (agent: AIAgent) => void;
  onAddAgent: () => void;
  isLoading: boolean;
  canManage: boolean;
}

export function AgentRoster({
  agents,
  selectedAgent,
  onSelectAgent,
  onAddAgent,
  isLoading,
  canManage,
}: AgentRosterProps) {
  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading agents...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Roster
        </h2>
        {canManage && (
          <Button variant="outline" size="sm" onClick={onAddAgent}>
            <Plus className="h-4 w-4 mr-1" />
            Add Agent
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg border transition-all",
              "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring",
              selectedAgent?.id === agent.id
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-background"
            )}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-full"
              style={{ backgroundColor: agent.avatar_color + "20" }}
            >
              <Bot
                className="h-5 w-5"
                style={{ color: agent.avatar_color }}
              />
            </div>
            <div className="text-left">
              <div className="font-medium text-sm">{agent.call_sign}</div>
              <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                {agent.codename}
              </div>
            </div>
            {agent.is_client_facing && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Client
              </Badge>
            )}
          </button>
        ))}

        {agents.length === 0 && (
          <div className="text-sm text-muted-foreground py-4">
            No agents configured. {canManage && "Add your first agent to get started."}
          </div>
        )}
      </div>
    </div>
  );
}
