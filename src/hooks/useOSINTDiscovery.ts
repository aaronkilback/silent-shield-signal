import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DiscoveryItem {
  id: string;
  type: "social_media" | "photo" | "news" | "property" | "corporate" | "family" | "contact" | "breach" | "threat" | "geospatial" | "dependency" | "other";
  label: string;
  value: string;
  source: string;
  confidence: number;
  timestamp: Date;
  fieldMapping?: string;
  category?: "identity" | "physical" | "digital" | "operational" | "threat" | "consequence";
  riskLevel?: "low" | "medium" | "high" | "critical";
  commentary?: string;
}

export interface ThreatVector {
  vector: string;
  beneficiary: string;
  narrative: string;
  trigger: string;
  momentum: "rising" | "stable" | "declining";
  confidence: number;
}

export interface ExposureTier {
  tier: 1 | 2 | 3;
  exposure: string;
  reason: string;
  exploitMethod: string;
  earlyWarning: string;
  intervention: string;
}

export interface TerrainSummary {
  identityVisibility: number;
  identityObservations: string[];
  physicalExposure: number;
  physicalObservations: string[];
  digitalAttackSurface: number;
  digitalObservations: string[];
  operationalDependencies: number;
  operationalObservations: string[];
}

export interface OSINTDiscoveryState {
  isRunning: boolean;
  phase: "idle" | "terrain_mapping" | "signal_detection" | "analyzing" | "complete" | "error";
  phaseLabel: string;
  currentDomain: string;
  discoveries: DiscoveryItem[];
  sourcesScanned: string[];
  progress: number;
  error: string | null;
  startedAt: Date | null;
  // Deep Scan enhanced data
  terrainSummary: TerrainSummary | null;
  threatVectors: ThreatVector[];
  exposureTiers: ExposureTier[];
  executiveSummary: string | null;
}

const initialState: OSINTDiscoveryState = {
  isRunning: false,
  phase: "idle",
  phaseLabel: "Ready",
  currentDomain: "",
  discoveries: [],
  sourcesScanned: [],
  progress: 0,
  error: null,
  startedAt: null,
  terrainSummary: null,
  threatVectors: [],
  exposureTiers: [],
  executiveSummary: null,
};

export function useOSINTDiscovery() {
  const [state, setState] = useState<OSINTDiscoveryState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startDiscovery = useCallback(
    async (params: {
      name: string;
      email?: string;
      dateOfBirth?: string;
      location?: string;
      socialMediaHandles?: string;
      industry?: string;
    }) => {
      // Reset state
      setState({
        isRunning: true,
        phase: "terrain_mapping",
        phaseLabel: "Initializing Deep Scan...",
        currentDomain: "",
        discoveries: [],
        sourcesScanned: [],
        progress: 0,
        error: null,
        startedAt: new Date(),
        terrainSummary: null,
        threatVectors: [],
        exposureTiers: [],
        executiveSummary: null,
      });

      abortControllerRef.current = new AbortController();

      try {
        // Use the signed-in user's access token so backend can enforce access control.
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          // Helps proxies/browsers treat the response as a stream (SSE-style).
          Accept: "text/event-stream",
        };

        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vip-osint-discovery`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(params),
            signal: abortControllerRef.current.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Discovery failed: ${response.status}`);
        }

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

        setState((prev) => ({ ...prev, phase: "complete", phaseLabel: "Deep Scan Complete", isRunning: false, progress: 100 }));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setState((prev) => ({ ...prev, phase: "idle", phaseLabel: "Cancelled", isRunning: false }));
        } else {
          setState((prev) => ({
            ...prev,
            phase: "error",
            phaseLabel: "Error",
            isRunning: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      }
    },
    []
  );

  const handleDiscoveryEvent = useCallback(
    (event: { type: string; data: any }) => {
      switch (event.type) {
        case "phase":
          setState((prev) => ({
            ...prev,
            phase: event.data.phase,
            phaseLabel: event.data.label || event.data.phase,
          }));
          break;

        case "domain":
          setState((prev) => ({
            ...prev,
            currentDomain: event.data.label,
          }));
          break;

        case "source_started":
          setState((prev) => ({
            ...prev,
            sourcesScanned: prev.sourcesScanned.includes(event.data.source) 
              ? prev.sourcesScanned 
              : [...prev.sourcesScanned, event.data.source],
          }));
          break;

        case "source_complete":
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

        case "terrain_summary":
          setState((prev) => ({ ...prev, terrainSummary: event.data }));
          break;

        case "threat_vector":
          setState((prev) => ({
            ...prev,
            threatVectors: [...prev.threatVectors, event.data],
          }));
          break;

        case "exposure_tier":
          setState((prev) => ({
            ...prev,
            exposureTiers: [...prev.exposureTiers, event.data],
          }));
          break;

        case "executive_summary":
          setState((prev) => ({ ...prev, executiveSummary: event.data.summary }));
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
    setState((prev) => ({ ...prev, isRunning: false, phase: "idle", phaseLabel: "Cancelled" }));
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
