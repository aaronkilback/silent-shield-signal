import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PhoneOff, Volume2, VolumeX, Minimize2 } from "lucide-react";
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
  const [isMuted, setIsMuted] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState<Array<{ role: 'user' | 'agent'; text: string; timestamp: Date }>>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [currentAgentText, setCurrentAgentText] = useState('');

  const {
    status,
    isAgentSpeaking,
    connect,
    disconnect,
    isConnected
  } = useOpenAIRealtime({
    agentContext,
    conversationHistory,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setTranscriptHistory(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
      }
    },
    onAgentResponse: (delta) => {
      setCurrentAgentText(prev => prev + delta);
    },
    onError: (error) => {
      toast({
        title: "Connection Error",
        description: error,
        variant: "destructive"
      });
    },
    onStatusChange: (newStatus) => {
      if (newStatus === 'connected') {
        toast({
          title: "Connected",
          description: "FORTRESS AI is listening...",
        });
      }
    }
  });

  // When agent stops speaking, save the full response
  useEffect(() => {
    if (!isAgentSpeaking && currentAgentText.trim()) {
      setTranscriptHistory(prev => [...prev, { role: 'agent', text: currentAgentText, timestamp: new Date() }]);
      setCurrentAgentText('');
    }
  }, [isAgentSpeaking, currentAgentText]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcriptHistory, currentAgentText]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const handleClose = () => {
    disconnect();
    onClose();
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'connecting': 
        return { 
          text: 'Establishing secure connection...', 
          color: 'from-yellow-500/20 to-yellow-600/20',
          pulseColor: 'bg-yellow-500',
          ringColor: 'ring-yellow-500/30'
        };
      case 'connected': 
        return { 
          text: 'Ready — speak anytime', 
          color: 'from-emerald-500/20 to-green-600/20',
          pulseColor: 'bg-emerald-500',
          ringColor: 'ring-emerald-500/30'
        };
      case 'speaking': 
        return { 
          text: 'FORTRESS responding...', 
          color: 'from-blue-500/20 to-indigo-600/20',
          pulseColor: 'bg-blue-500',
          ringColor: 'ring-blue-500/30'
        };
      case 'listening': 
        return { 
          text: 'Listening...', 
          color: 'from-primary/20 to-primary/30',
          pulseColor: 'bg-primary',
          ringColor: 'ring-primary/30'
        };
      default: 
        return { 
          text: 'Disconnected', 
          color: 'from-muted/20 to-muted/30',
          pulseColor: 'bg-muted-foreground',
          ringColor: 'ring-muted/30'
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      {/* Animated background gradient */}
      <div className={cn(
        "absolute inset-0 transition-all duration-1000 opacity-40",
        `bg-gradient-to-br ${statusConfig.color}`
      )} />
      
      {/* Floating orbs background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className={cn(
          "absolute -top-32 -left-32 w-64 h-64 rounded-full blur-3xl transition-all duration-1000",
          isAgentSpeaking ? "bg-blue-500/20 scale-150" : "bg-primary/10 scale-100"
        )} />
        <div className={cn(
          "absolute -bottom-32 -right-32 w-96 h-96 rounded-full blur-3xl transition-all duration-1000",
          status === 'listening' ? "bg-emerald-500/20 scale-125" : "bg-muted/10 scale-100"
        )} />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-4 border-b border-border/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={cn(
              "w-3 h-3 rounded-full transition-colors",
              statusConfig.pulseColor
            )} />
            {(status === 'connected' || status === 'listening' || status === 'speaking') && (
              <div className={cn(
                "absolute inset-0 w-3 h-3 rounded-full animate-ping",
                statusConfig.pulseColor,
                "opacity-75"
              )} />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">FORTRESS Voice</h2>
            <p className="text-xs text-muted-foreground">{statusConfig.text}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsMuted(!isMuted)}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            className="h-8 w-8"
            onClick={handleClose}
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8">
        
        {/* Central visualization */}
        <div className="relative mb-8">
          {/* Outer rings */}
          <div className={cn(
            "absolute inset-0 rounded-full transition-all duration-500",
            statusConfig.ringColor,
            isAgentSpeaking ? "ring-[40px] scale-110" : status === 'listening' ? "ring-[30px] scale-105" : "ring-[20px] scale-100"
          )} />
          
          {/* Main orb */}
          <div className={cn(
            "relative w-40 h-40 rounded-full flex items-center justify-center transition-all duration-300",
            "bg-gradient-to-br from-background via-background to-muted/50",
            "border border-border/50 shadow-2xl",
            isAgentSpeaking && "scale-105"
          )}>
            {/* Inner glow */}
            <div className={cn(
              "absolute inset-4 rounded-full transition-all duration-500",
              isAgentSpeaking 
                ? "bg-gradient-to-br from-blue-500/30 to-indigo-600/30 animate-pulse" 
                : status === 'listening'
                ? "bg-gradient-to-br from-emerald-500/30 to-green-600/30 animate-pulse"
                : "bg-gradient-to-br from-muted/20 to-muted/30"
            )} />
            
            {/* Audio visualization bars */}
            <div className="relative z-10 flex items-end gap-1 h-16">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-2 rounded-full transition-all duration-75",
                    isAgentSpeaking 
                      ? "bg-blue-500" 
                      : status === 'listening' 
                      ? "bg-emerald-500" 
                      : "bg-muted-foreground/30"
                  )}
                  style={{
                    height: (isAgentSpeaking || status === 'listening') 
                      ? `${Math.random() * 48 + 8}px` 
                      : '8px',
                    animationDelay: `${i * 100}ms`
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Live transcript display */}
        <div 
          ref={transcriptRef}
          className="w-full max-w-xl bg-muted/30 backdrop-blur-sm rounded-2xl border border-border/50 p-6 max-h-64 overflow-y-auto"
        >
          {transcriptHistory.length === 0 && !currentAgentText ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">
                {status === 'connecting' 
                  ? 'Initializing secure voice channel...' 
                  : 'Start speaking to begin your briefing...'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {transcriptHistory.map((item, i) => (
                <div key={i} className={cn(
                  "flex gap-3",
                  item.role === 'user' ? "justify-end" : "justify-start"
                )}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2",
                    item.role === 'user' 
                      ? "bg-primary text-primary-foreground rounded-br-sm" 
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}>
                    <p className="text-sm">{item.text}</p>
                    <p className="text-[10px] opacity-60 mt-1">
                      {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Current agent response being streamed */}
              {currentAgentText && (
                <div className="flex gap-3 justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2 bg-muted text-foreground">
                    <p className="text-sm">{currentAgentText}</p>
                    <div className="flex gap-1 mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 p-6 border-t border-border/50 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-6">
          <Button
            variant="destructive"
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg shadow-destructive/25"
            onClick={handleClose}
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
        </div>
        
        <p className="text-center text-xs text-muted-foreground mt-4">
          Secure WebRTC Connection • End-to-End Encrypted
        </p>
      </div>
    </div>
  );
}
