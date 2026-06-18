import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTravellerAegisChat — calls the authenticated, traveller-scoped traveller-aegis-chat function
 * (V1 read-only + itinerary-bound risk awareness). Real multi-turn Aegis conversation; scope is
 * server-derived from auth.uid(). The client only passes the message + prior turns for context —
 * it cannot widen scope. Returns the assistant reply text; throws on error so the caller can fall
 * back to the deterministic router when the LLM/voice is unavailable.
 */
export type ChatTurn = { role: "user" | "assistant"; content: string };

export function useTravellerAegisChat() {
  return useCallback(async (message: string, history: ChatTurn[]): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("traveller-aegis-chat", {
      body: { message, conversation_history: history },
    });
    if (error) throw error;
    const reply = (data as { reply?: string } | null)?.reply;
    if (typeof reply !== "string" || !reply.trim()) throw new Error("empty reply");
    return reply;
  }, []);
}
