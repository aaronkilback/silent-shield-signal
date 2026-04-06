import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bot, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AgentInteraction } from "@/components/agents/AgentInteraction";

interface AskAegisButtonProps {
  context: string;
  initialMessage?: string;
  size?: "sm" | "default";
  variant?: "ghost" | "outline" | "default";
  label?: string;
}

export function AskAegisButton({
  context,
  initialMessage,
  size = "sm",
  variant = "ghost",
  label = "Ask Aegis",
}: AskAegisButtonProps) {
  const [open, setOpen] = useState(false);

  const { data: agent, isLoading } = useQuery({
    queryKey: ["ask-aegis-agent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, header_name, codename, call_sign, avatar_color, system_prompt")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Bot className="w-3.5 h-3.5" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              Ask Aegis
            </DialogTitle>
            {context && (
              <p className="text-sm text-muted-foreground truncate">
                Context: {context}
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-hidden px-6 pb-6">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            )}
            {agent && <AgentInteraction agent={agent} initialMessage={initialMessage} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
