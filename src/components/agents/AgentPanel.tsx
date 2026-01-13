import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Settings,
  Target,
  MessageSquare,
  Database,
  FileOutput,
  Wand2,
  Loader2,
  Upload,
  Shield,
  Radio,
} from "lucide-react";
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
  avatar_image?: string | null;
}

interface AgentPanelProps {
  agent: AIAgent;
  onEdit: () => void;
  canEdit: boolean;
  onAvatarUpdate?: () => void;
}

export function AgentPanel({ agent, onEdit, canEdit, onAvatarUpdate }: AgentPanelProps) {
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);

  const generateAvatar = async () => {
    setIsGeneratingAvatar(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-agent-avatar", {
        body: {
          agent_id: agent.id,
          agent_name: agent.header_name || agent.codename,
          persona: agent.persona,
          specialty: agent.specialty,
        },
      });

      if (error) throw error;

      if (data?.avatar_url) {
        toast.success("Agent avatar generated successfully");
        onAvatarUpdate?.();
      }
    } catch (error) {
      console.error("Error generating avatar:", error);
      toast.error("Failed to generate avatar");
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const displayName = agent.header_name || agent.codename;

  return (
    <Card className="h-full bg-zinc-950 border-zinc-800 overflow-hidden relative">
      {/* Scan lines overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.1)_2px,rgba(255,255,255,0.1)_4px)]" />
      
      {/* Grid pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,200,0,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,200,0,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />

      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-amber-500" />
      <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-amber-500" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-l-2 border-b-2 border-amber-500" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-r-2 border-b-2 border-amber-500" />

      <CardContent className="p-6 relative z-10">
        {/* Header with settings */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-amber-500/80 text-xs font-mono uppercase tracking-wider">
            <Shield className="h-3 w-3" />
            <span>Agent Dossier</span>
          </div>
          {canEdit && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onEdit}
              className="h-8 w-8 text-zinc-500 hover:text-amber-500 hover:bg-amber-500/10"
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Avatar Section */}
        <div className="relative mb-6">
          {/* Avatar frame */}
          <div className="relative mx-auto w-48 h-48">
            {/* Outer frame */}
            <div className="absolute inset-0 border-2 border-amber-500/50 bg-zinc-900/80" />
            
            {/* Corner brackets */}
            <div className="absolute -top-1 -left-1 w-4 h-4 border-l-2 border-t-2 border-amber-500" />
            <div className="absolute -top-1 -right-1 w-4 h-4 border-r-2 border-t-2 border-amber-500" />
            <div className="absolute -bottom-1 -left-1 w-4 h-4 border-l-2 border-b-2 border-amber-500" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 border-r-2 border-b-2 border-amber-500" />

            {/* Avatar content */}
            <div className="absolute inset-2 bg-zinc-900 flex items-center justify-center overflow-hidden">
              {agent.avatar_image ? (
                <img 
                  src={agent.avatar_image} 
                  alt={displayName}
                  className="w-full h-full object-cover grayscale-[30%]"
                />
              ) : (
                <Bot 
                  className="h-20 w-20 opacity-30" 
                  style={{ color: agent.avatar_color }} 
                />
              )}
            </div>

            {/* Scan line animation */}
            <div className="absolute inset-2 overflow-hidden pointer-events-none">
              <div className="absolute inset-0 animate-[scan_3s_linear_infinite] bg-gradient-to-b from-transparent via-amber-500/10 to-transparent" />
            </div>
          </div>

          {/* Generate avatar button */}
          {canEdit && (
            <div className="flex justify-center mt-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={generateAvatar}
                disabled={isGeneratingAvatar}
                className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400 text-xs"
              >
                {isGeneratingAvatar ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3 mr-1.5" />
                )}
                {isGeneratingAvatar ? "Generating..." : "Generate Avatar"}
              </Button>
            </div>
          )}
        </div>

        {/* Agent Info */}
        <div className="text-center mb-6">
          <div className="text-xs font-mono text-amber-500/60 uppercase tracking-widest mb-1">
            @{agent.call_sign.toLowerCase().replace("-", "_")}
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide mb-1">
            {displayName}
          </h2>
          <div className="text-sm text-zinc-500 font-mono">
            CODENAME: {agent.codename.toUpperCase()}
          </div>
        </div>

        {/* Status indicators */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
              Status
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${agent.is_active ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-sm font-mono text-white">
                {agent.is_active ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
          </div>
          <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
              Clearance
            </div>
            <span className="text-sm font-mono text-amber-500">
              {agent.is_client_facing ? "CLIENT" : "INTERNAL"}
            </span>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-6">
          <Badge 
            variant="outline" 
            className="border-amber-500/30 text-amber-500 bg-amber-500/5 capitalize text-xs"
          >
            <Radio className="h-3 w-3 mr-1" />
            {agent.interaction_style}
          </Badge>
        </div>

        <Separator className="bg-zinc-800 mb-4" />

        {/* Persona */}
        <div className="mb-4">
          <h4 className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3" />
            Persona
          </h4>
          <p className="text-sm text-zinc-300 leading-relaxed">{agent.persona}</p>
        </div>

        {/* Specialty */}
        <div className="mb-4">
          <h4 className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Target className="h-3 w-3" />
            Specialty
          </h4>
          <p className="text-sm text-zinc-400">{agent.specialty}</p>
        </div>

        {/* Mission */}
        <div className="mb-4">
          <h4 className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2">
            Mission Scope
          </h4>
          <p className="text-sm text-zinc-500">{agent.mission_scope}</p>
        </div>

        <Separator className="bg-zinc-800 mb-4" />

        {/* Input Sources */}
        <div className="mb-4">
          <h4 className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Database className="h-3 w-3" />
            Input Sources
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.input_sources.map((source) => (
              <Badge 
                key={source} 
                variant="secondary" 
                className="text-[10px] bg-zinc-800 text-zinc-400 border-zinc-700"
              >
                {source}
              </Badge>
            ))}
          </div>
        </div>

        {/* Output Types */}
        <div>
          <h4 className="text-[10px] font-mono text-amber-500/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FileOutput className="h-3 w-3" />
            Output Types
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.output_types.map((output) => (
              <Badge 
                key={output} 
                variant="outline" 
                className="text-[10px] border-zinc-700 text-zinc-500"
              >
                {output}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>

      {/* Custom scan animation */}
      <style>{`
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </Card>
  );
}