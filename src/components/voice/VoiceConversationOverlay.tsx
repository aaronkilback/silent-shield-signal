import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff, MessageSquare } from "lucide-react";
import { useOpenAIRealtime } from "./useOpenAIRealtime";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface VoiceConversationOverlayProps {
  onClose: () => void;
  agentContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export function VoiceConversationOverlay({
  onClose,
  agentContext,
  conversationHistory = []
}: VoiceConversationOverlayProps) {
  const { toast } = useToast();
  const [showTranscript, setShowTranscript] = useState(true);
  const [transcriptHistory, setTranscriptHistory] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);

  const {
    status,
    isAgentSpeaking,
    transcript,
    agentResponse,
    connect,
    disconnect,
    isConnected
  } = useOpenAIRealtime({
    agentContext,
    conversationHistory,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setTranscriptHistory(prev => [...prev, { role: 'user', text }]);
      }
    },
    onAgentResponse: (delta) => {
      // Accumulate agent response
      setTranscriptHistory(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'agent') {
          return [...prev.slice(0, -1), { role: 'agent', text: last.text + delta }];
        }
        return [...prev, { role: 'agent', text: delta }];
      });
    },
    onError: (error) => {
      toast({
        title: "Voice Error",
        description: error,
        variant: "destructive"
      });
    },
    onStatusChange: (newStatus) => {
      console.log('Voice status:', newStatus);
    }
  });

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const handleClose = () => {
    disconnect();
    onClose();
  };

  const getStatusText = () => {
    switch (status) {
      case 'connecting': return 'Connecting...';
      case 'connected': return 'Connected - Speak now';
      case 'speaking': return 'FORTRESS is speaking...';
      case 'listening': return 'Listening...';
      default: return 'Disconnected';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connecting': return 'text-yellow-500';
      case 'connected': return 'text-green-500';
      case 'speaking': return 'text-blue-500';
      case 'listening': return 'text-primary';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-3 h-3 rounded-full animate-pulse",
            status === 'connected' || status === 'listening' ? "bg-green-500" :
            status === 'speaking' ? "bg-blue-500" :
            status === 'connecting' ? "bg-yellow-500" : "bg-muted"
          )} />
          <span className={cn("text-sm font-medium", getStatusColor())}>
            {getStatusText()}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowTranscript(!showTranscript)}>
          <MessageSquare className="h-4 w-4 mr-2" />
          {showTranscript ? 'Hide' : 'Show'} Transcript
        </Button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {/* Animated orb */}
        <div className="relative mb-8">
          <div className={cn(
            "w-32 h-32 rounded-full transition-all duration-300",
            isAgentSpeaking 
              ? "bg-gradient-to-br from-blue-500 to-primary animate-pulse scale-110" 
              : status === 'listening'
              ? "bg-gradient-to-br from-green-500 to-emerald-600 animate-pulse"
              : "bg-gradient-to-br from-muted to-muted-foreground/20"
          )} />
          <div className={cn(
            "absolute inset-0 rounded-full transition-all duration-500",
            isAgentSpeaking && "animate-ping bg-blue-500/30"
          )} />
        </div>

        {/* Voice visualization placeholder */}
        <div className="flex items-center gap-1 h-16 mb-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1 bg-primary/60 rounded-full transition-all duration-100",
                isAgentSpeaking || status === 'listening' ? "animate-pulse" : ""
              )}
              style={{
                height: isAgentSpeaking || status === 'listening' 
                  ? `${Math.random() * 40 + 10}px` 
                  : '4px',
                animationDelay: `${i * 50}ms`
              }}
            />
          ))}
        </div>

        {/* Current transcript */}
        {showTranscript && (
          <div className="w-full max-w-2xl bg-muted/50 rounded-lg p-4 mb-8 max-h-48 overflow-y-auto">
            {transcriptHistory.length === 0 ? (
              <p className="text-muted-foreground text-center text-sm">
                Start speaking to begin the conversation...
              </p>
            ) : (
              <div className="space-y-2">
                {transcriptHistory.slice(-6).map((item, i) => (
                  <div key={i} className={cn(
                    "text-sm",
                    item.role === 'user' ? "text-foreground" : "text-primary"
                  )}>
                    <span className="font-medium">
                      {item.role === 'user' ? 'You: ' : 'FORTRESS: '}
                    </span>
                    {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-8 flex items-center justify-center gap-4">
        {!isConnected ? (
          <Button
            size="lg"
            className="h-16 w-16 rounded-full"
            onClick={connect}
            disabled={status === 'connecting'}
          >
            <Phone className="h-6 w-6" />
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="lg"
              className="h-14 w-14 rounded-full"
              disabled
            >
              {status === 'listening' ? (
                <Mic className="h-5 w-5 text-green-500" />
              ) : (
                <MicOff className="h-5 w-5" />
              )}
            </Button>
            
            <Button
              variant="destructive"
              size="lg"
              className="h-16 w-16 rounded-full"
              onClick={handleClose}
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-4 text-center text-xs text-muted-foreground">
        Powered by OpenAI Realtime • WebRTC • Ephemeral Token Authentication
      </div>
    </div>
  );
}
