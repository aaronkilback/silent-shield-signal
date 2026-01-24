import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DiscoveryItem {
  id: string;
  type: "social_media" | "photo" | "news" | "property" | "corporate" | "family" | "contact" | "other";
  label: string;
  value: string;
  source: string;
  confidence: number;
  timestamp: Date;
  fieldMapping?: string; // Which form field this maps to
}

export interface OSINTDiscoveryState {
  isRunning: boolean;
  phase: "idle" | "searching" | "analyzing" | "complete" | "error";
  discoveries: DiscoveryItem[];
  sourcesScanned: string[];
  progress: number;
  error: string | null;
  startedAt: Date | null;
}

const initialState: OSINTDiscoveryState = {
  isRunning: false,
  phase: "idle",
  discoveries: [],
  sourcesScanned: [],
  progress: 0,
  error: null,
  startedAt: null,
};

export function useOSINTDiscovery() {
  const [state, setState] = useState<OSINTDiscoveryState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addDiscovery = useCallback((item: Omit<DiscoveryItem, "id" | "timestamp">) => {
    setState((prev) => ({
      ...prev,
      discoveries: [
        ...prev.discoveries,
        {
          ...item,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ],
    }));
  }, []);

  const startDiscovery = useCallback(
    async (params: {
      name: string;
      email?: string;
      dateOfBirth?: string;
      location?: string;
      socialMediaHandles?: string;
    }) => {
      // Reset state
      setState({
        isRunning: true,
        phase: "searching",
        discoveries: [],
        sourcesScanned: [],
        progress: 0,
        error: null,
        startedAt: new Date(),
      });

      abortControllerRef.current = new AbortController();

      try {
        // Call the discovery edge function
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vip-osint-discovery`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify(params),
            signal: abortControllerRef.current.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Discovery failed: ${response.status}`);
        }

        // Process SSE stream for live updates
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error("No response body");

        let buffer = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const event = JSON.parse(jsonStr);
              handleDiscoveryEvent(event);
            } catch {
              // Ignore parse errors
            }
          }
        }

        setState((prev) => ({ ...prev, phase: "complete", isRunning: false, progress: 100 }));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setState((prev) => ({ ...prev, phase: "idle", isRunning: false }));
        } else {
          setState((prev) => ({
            ...prev,
            phase: "error",
            isRunning: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      }
    },
    []
  );

  const handleDiscoveryEvent = useCallback(
    (event: {
      type: "source_started" | "source_complete" | "discovery" | "progress" | "phase" | "error";
      data: any;
    }) => {
      switch (event.type) {
        case "source_started":
          setState((prev) => ({
            ...prev,
            sourcesScanned: [...prev.sourcesScanned, event.data.source],
          }));
          break;

        case "source_complete":
          // Already tracked in source_started
          break;

        case "discovery":
          setState((prev) => ({
            ...prev,
            discoveries: [
              ...prev.discoveries,
              {
                id: crypto.randomUUID(),
                timestamp: new Date(),
                ...event.data,
              },
            ],
          }));
          break;

        case "progress":
          setState((prev) => ({ ...prev, progress: event.data.percent }));
          break;

        case "phase":
          setState((prev) => ({ ...prev, phase: event.data.phase }));
          break;

        case "error":
          setState((prev) => ({ ...prev, error: event.data.message }));
          break;
      }
    },
    []
  );

  const stopDiscovery = useCallback(() => {
    abortControllerRef.current?.abort();
    eventSourceRef.current?.close();
    setState((prev) => ({ ...prev, isRunning: false, phase: "idle" }));
  }, []);

  const clearDiscoveries = useCallback(() => {
    setState(initialState);
  }, []);

  const applyDiscovery = useCallback(
    (discoveryId: string): DiscoveryItem | undefined => {
      return state.discoveries.find((d) => d.id === discoveryId);
    },
    [state.discoveries]
  );

  return {
    ...state,
    startDiscovery,
    stopDiscovery,
    clearDiscoveries,
    applyDiscovery,
  };
}
