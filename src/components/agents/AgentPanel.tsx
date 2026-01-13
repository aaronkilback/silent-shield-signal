import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Bot, Settings, Target, MessageSquare, Database, FileOutput } from "lucide-react";

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
}

interface AgentPanelProps {
  agent: AIAgent;
  onEdit: () => void;
  canEdit: boolean;
}

export function AgentPanel({ agent, onEdit, canEdit }: AgentPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-12 h-12 rounded-full"
              style={{ backgroundColor: agent.avatar_color + "20" }}
            >
              <Bot className="h-6 w-6" style={{ color: agent.avatar_color }} />
            </div>
            <div>
              <CardTitle className="text-lg">{agent.header_name || agent.codename}</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <code className="font-mono">{agent.call_sign}</code>
                <span>·</span>
                <span>{agent.codename}</span>
              </div>
            </div>
          </div>
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status Badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant={agent.is_active ? "default" : "secondary"}>
            {agent.is_active ? "Active" : "Inactive"}
          </Badge>
          {agent.is_client_facing && (
            <Badge variant="outline">Client-Facing</Badge>
          )}
          <Badge variant="outline" className="capitalize">
            {agent.interaction_style}
          </Badge>
        </div>

        <Separator />

        {/* Persona */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3" />
            Persona
          </h4>
          <p className="text-sm leading-relaxed">{agent.persona}</p>
        </div>

        {/* Specialty */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Target className="h-3 w-3" />
            Specialty
          </h4>
          <p className="text-sm">{agent.specialty}</p>
        </div>

        {/* Mission */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Mission Scope
          </h4>
          <p className="text-sm text-muted-foreground">{agent.mission_scope}</p>
        </div>

        <Separator />

        {/* Input Sources */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Database className="h-3 w-3" />
            Input Sources
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.input_sources.map((source) => (
              <Badge key={source} variant="secondary" className="text-xs">
                {source}
              </Badge>
            ))}
          </div>
        </div>

        {/* Output Types */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <FileOutput className="h-3 w-3" />
            Output Types
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.output_types.map((output) => (
              <Badge key={output} variant="outline" className="text-xs">
                {output}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
