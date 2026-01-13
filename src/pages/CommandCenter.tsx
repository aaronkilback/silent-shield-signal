import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { AgentRoster } from "@/components/agents/AgentRoster";
import { AgentPanel } from "@/components/agents/AgentPanel";
import { AgentInteraction } from "@/components/agents/AgentInteraction";
import { AgentAdminDialog } from "@/components/agents/AgentAdminDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { Shield } from "lucide-react";

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
  avatar_image: string | null;
  system_prompt: string | null;
}

export default function CommandCenter() {
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const handleSelectAgent = (agent: AIAgent) => setSelectedAgent(agent);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false);
  const { isAdmin, isSuperAdmin } = useUserRole();

  const { data: agents, isLoading, refetch } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as AIAgent[];
    },
    // Agents can be provisioned by backend tools outside the UI; poll to keep the roster in sync.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const handleAddAgent = () => {
    setEditingAgent(null);
    setIsAdminDialogOpen(true);
  };

  const handleEditAgent = (agent: AIAgent) => {
    setEditingAgent(agent);
    setIsAdminDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fortress AI Command Center</h1>
            <p className="text-sm text-muted-foreground">
              Multi-Agent Intelligence Operations
            </p>
          </div>
        </div>

        {/* Agent Roster */}
        <AgentRoster
          agents={agents || []}
          selectedAgent={selectedAgent}
          onSelectAgent={handleSelectAgent}
          onAddAgent={handleAddAgent}
          isLoading={isLoading}
          canManage={isAdmin || isSuperAdmin}
        />

        {/* Main Content Grid */}
        {selectedAgent ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Agent Panel */}
            <div className="lg:col-span-1">
              <AgentPanel
                agent={selectedAgent}
                onEdit={() => handleEditAgent(selectedAgent)}
                canEdit={isAdmin || isSuperAdmin}
                onAvatarUpdate={refetch}
              />
            </div>

            {/* Agent Interaction */}
            <div className="lg:col-span-2">
              <AgentInteraction agent={selectedAgent} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 border border-dashed border-border rounded-lg">
            <div className="text-center text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Select an agent to begin</p>
              <p className="text-sm">Choose from the roster above</p>
            </div>
          </div>
        )}

        {/* Admin Dialog */}
        <AgentAdminDialog
          open={isAdminDialogOpen}
          onOpenChange={setIsAdminDialogOpen}
          agent={editingAgent}
          onSuccess={() => {
            refetch();
            setIsAdminDialogOpen(false);
          }}
        />
      </main>
    </div>
  );
}
