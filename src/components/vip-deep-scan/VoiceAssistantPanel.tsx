import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, MessageSquare, Loader2, Volume2, VolumeX, Sparkles } from "lucide-react";
import { useOpenAIRealtime } from "@/components/voice/useOpenAIRealtime";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VoiceAssistantPanelProps {
  formData: Record<string, any>;
  onUpdateField: (field: string, value: any) => void;
  onAddFamilyMember?: (member: { name: string; relationship: string; dateOfBirth: string; socialMedia: string }) => void;
  onAddProperty?: (property: { type: string; address: string; hasSecuritySystem: boolean; notes: string }) => void;
  onAddTravelPlan?: (plan: { destination: string; departureDate: string; returnDate: string; purpose: string; accommodationType: string }) => void;
  currentStep: number;
  stepTitle: string;
}

interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const STEP_CONTEXTS: Record<number, string> = {
  1: "You're helping with client selection and priority level for a VIP security assessment.",
  2: "You're collecting principal profile information: full name, aliases, DOB, nationality, emails, phones, social media.",
  3: "You're gathering property information: residences, vacation homes, offices. Ask for addresses and security system status.",
  4: "You're collecting family and staff information: household members, relationships, security personnel.",
  5: "You're documenting digital footprint: devices, email providers, cloud services, usernames, corporate affiliations.",
  6: "You're recording vehicles and movement patterns: vehicle descriptions, regular routes, frequented locations.",
  7: "You're capturing travel plans for the next 90 days: destinations, dates, purposes, accommodations.",
  8: "You're documenting threat concerns: known adversaries, previous incidents, specific worries, industry threats.",
  9: "You're on the review step. Help summarize the collected information and confirm consent checkboxes.",
};

export function VoiceAssistantPanel({
  formData,
  onUpdateField,
  onAddFamilyMember,
  onAddProperty,
  onAddTravelPlan,
  currentStep,
  stepTitle,
}: VoiceAssistantPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveAgentResponse, setLiveAgentResponse] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const systemPrompt = `You are AEGIS, assisting with a Vulnerability Scan intake form for corporate security.

CURRENT STEP: ${currentStep} - ${stepTitle}
CONTEXT: ${STEP_CONTEXTS[currentStep] || "Collecting VIP security information."}

CURRENT FORM DATA:
${JSON.stringify(formData, null, 2)}

YOUR ROLE:
- Help the user fill out this security assessment form conversationally
- Ask clarifying questions about the current step's fields
- When the user provides information, acknowledge it and confirm what you understood
- Be professional, concise, and security-minded
- Guide them through required fields for this step

IMPORTANT:
- Focus on the current step's fields
- If information is unclear, ask for clarification
- Summarize what you've captured at the end of each exchange`;

  const {
    status: voiceStatus,
    isAgentSpeaking,
    connect: connectVoice,
    disconnect: disconnectVoice,
  } = useOpenAIRealtime({
    agentContext: systemPrompt,
    conversationHistory: transcripts.slice(-6).map((t) => ({
      role: t.role,
      content: t.content,
    })),
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setTranscripts((prev) => [
          ...prev,
          { role: "user", content: text, timestamp: new Date() },
        ]);
        setLiveTranscript("");
      } else {
        setLiveTranscript(text);
      }
    },
    onAgentResponse: (delta) => {
      setLiveAgentResponse((prev) => prev + delta);
    },
    onAgentResponseComplete: (fullText) => {
      if (fullText?.trim()) {
        setTranscripts((prev) => [
          ...prev,
          { role: "assistant", content: fullText.trim(), timestamp: new Date() },
        ]);
      }
      setLiveAgentResponse("");
    },
    onError: (error) => {
      toast.error(error);
      setIsVoiceActive(false);
    },
    onStatusChange: (status) => {
      console.log("[VIP Voice] Status:", status);
    },
  });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, liveTranscript, liveAgentResponse]);

  const toggleVoice = useCallback(async () => {
    if (isVoiceActive) {
      disconnectVoice();
      setIsVoiceActive(false);
    } else {
      try {
        await connectVoice();
        setIsVoiceActive(true);
        setIsExpanded(true);
      } catch (error) {
        console.error("Failed to connect voice:", error);
        toast.error("Failed to start voice assistant");
      }
    }
  }, [isVoiceActive, connectVoice, disconnectVoice]);

  const getStatusText = () => {
    if (!isVoiceActive) return "Voice assistant inactive";
    switch (voiceStatus) {
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Listening...";
      case "speaking":
        return "AEGIS speaking...";
      case "listening":
        return "Hearing you...";
      case "thinking":
        return "Processing...";
      default:
        return "Ready";
    }
  };

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={() => setIsExpanded(true)}
          className="rounded-full h-14 w-14 shadow-lg"
          size="icon"
        >
          <MessageSquare className="h-6 w-6" />
        </Button>
      </div>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 z-50 shadow-2xl border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AEGIS Voice Assistant
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={isVoiceActive ? "default" : "secondary"}
              className="text-xs"
            >
              {getStatusText()}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                if (isVoiceActive) disconnectVoice();
                setIsVoiceActive(false);
                setIsExpanded(false);
              }}
            >
              ×
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Step {currentStep}: {stepTitle}
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Transcript Area */}
        <ScrollArea className="h-48 border rounded-md p-2 bg-muted/30">
          <div ref={scrollRef} className="space-y-2">
            {transcripts.length === 0 && !liveTranscript && !liveAgentResponse && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Click the microphone to start a voice conversation with AEGIS
              </p>
            )}

            {transcripts.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "text-xs p-2 rounded",
                  msg.role === "user"
                    ? "bg-primary/10 ml-4"
                    : "bg-secondary mr-4"
                )}
              >
                <span className="font-medium">
                  {msg.role === "user" ? "You" : "AEGIS"}:
                </span>{" "}
                {msg.content}
              </div>
            ))}

            {liveTranscript && (
              <div className="text-xs p-2 rounded bg-primary/10 ml-4 opacity-70">
                <span className="font-medium">You:</span> {liveTranscript}...
              </div>
            )}

            {liveAgentResponse && (
              <div className="text-xs p-2 rounded bg-secondary mr-4 opacity-70">
                <span className="font-medium">AEGIS:</span> {liveAgentResponse}
                <span className="animate-pulse">▊</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Voice Controls */}
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={toggleVoice}
            variant={isVoiceActive ? "destructive" : "default"}
            size="lg"
            className={cn(
              "rounded-full h-12 w-12",
              isVoiceActive && isAgentSpeaking && "ring-2 ring-primary ring-offset-2 animate-pulse"
            )}
          >
            {voiceStatus === "connecting" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isVoiceActive ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>

          {isVoiceActive && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {isAgentSpeaking ? (
                <>
                  <Volume2 className="h-3 w-3 animate-pulse" />
                  Speaking
                </>
              ) : (
                <>
                  <Mic className="h-3 w-3" />
                  Listening
                </>
              )}
            </div>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground text-center">
          Speak naturally to describe VIP details. AEGIS will guide you through the form.
        </p>
      </CardContent>
    </Card>
  );
}
