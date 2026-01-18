import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, RotateCcw, X } from "lucide-react";
import { useOpenAIRealtime } from "./useOpenAIRealtime";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface VoiceConversationOverlayProps {
  onClose: () => void;
  agentContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

type UIState = 'idle' | 'listening' | 'responding';

export function VoiceConversationOverlay({
  onClose,
  agentContext,
  conversationHistory = []
}: VoiceConversationOverlayProps) {
  const { toast } = useToast();
  const [uiState, setUiState] = useState<UIState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);
  const [currentText, setCurrentText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
        setTranscriptHistory(prev => [...prev, { role: 'user', text }]);
        setCurrentText('');
      } else {
        setCurrentText(text);
      }
    },
    onAgentResponse: (delta) => {
      setCurrentText(prev => prev + delta);
    },
    onError: (error) => {
      if (error.includes('microphone') || error.includes('Microphone')) {
        setStatusMessage("Can't access microphone. Check permissions.");
      } else {
        setStatusMessage('Connection issue. Reconnecting...');
        setIsReconnecting(true);
        setTimeout(() => {
          connect();
          setIsReconnecting(false);
        }, 2000);
      }
    },
    onStatusChange: (newStatus) => {
      if (newStatus === 'connected') {
        setStatusMessage('');
        setUiState('idle');
      }
    }
  });

  // Map internal status to UI state
  useEffect(() => {
    if (status === 'listening') {
      setUiState('listening');
      setStatusMessage('Listening...');
    } else if (status === 'speaking' || isAgentSpeaking) {
      setUiState('responding');
      setStatusMessage('Responding');
    } else if (status === 'connected') {
      setUiState('idle');
      setStatusMessage('');
    } else if (status === 'connecting') {
      setStatusMessage('Connecting to Aegis...');
    }
  }, [status, isAgentSpeaking]);

  // When agent stops speaking, save response to history
  useEffect(() => {
    if (!isAgentSpeaking && currentText.trim() && uiState === 'responding') {
      setTranscriptHistory(prev => [...prev, { role: 'agent', text: currentText }]);
      setCurrentText('');
    }
  }, [isAgentSpeaking, currentText, uiState]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcriptHistory, currentText]);

  // Spacebar-to-talk support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        if (!isConnected) {
          connect();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConnected, connect]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  const handleClose = () => {
    disconnect();
    onClose();
  };

  const handleRestart = useCallback(() => {
    disconnect();
    setTranscriptHistory([]);
    setCurrentText('');
    setStatusMessage('Reconnecting to Aegis...');
    setTimeout(() => connect(), 500);
  }, [disconnect, connect]);

  const handleMicClick = () => {
    if (!isConnected) {
      connect();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0b] flex flex-col overflow-hidden select-none">
      
      {/* Subtle top banner */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-center py-3 z-20">
        <span className="text-[10px] tracking-[0.3em] text-slate-600 uppercase font-medium">
          Aegis — Strategic Voice Assistant
        </span>
      </div>

      {/* Top right controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        <Button 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
          onClick={() => setIsMuted(!isMuted)}
        >
          {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Button 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
          onClick={handleRestart}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon"
          className="h-9 w-9 text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-32">
        
        {/* Aegis Icon / Shield */}
        <div className="relative mb-12">
          {/* Outer glow ring - only visible when responding */}
          <div className={cn(
            "absolute inset-0 rounded-full transition-all duration-700",
            uiState === 'responding' 
              ? "bg-emerald-500/10 scale-150 blur-xl" 
              : "bg-transparent scale-100"
          )} />
          
          {/* Shield container */}
          <div className={cn(
            "relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500",
            "border border-slate-800",
            uiState === 'idle' && "bg-slate-900/50",
            uiState === 'listening' && "bg-slate-800/50",
            uiState === 'responding' && "bg-emerald-950/30 border-emerald-900/50"
          )}>
            {/* Shield icon with breathing animation */}
            <svg 
              viewBox="0 0 24 24" 
              className={cn(
                "w-12 h-12 transition-all duration-500",
                uiState === 'idle' && "text-slate-600",
                uiState === 'listening' && "text-slate-400 animate-pulse",
                uiState === 'responding' && "text-emerald-500"
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" className={cn(
                "transition-opacity duration-300",
                uiState === 'responding' ? "opacity-100" : "opacity-0"
              )} />
            </svg>
            
            {/* Ripple effect for listening */}
            {uiState === 'listening' && (
              <>
                <div className="absolute inset-0 rounded-full border border-slate-600 animate-ping opacity-20" />
                <div className="absolute inset-0 rounded-full border border-slate-700 animate-pulse" />
              </>
            )}
          </div>
        </div>

        {/* Status message */}
        <div className="h-6 mb-4">
          {statusMessage && (
            <p className={cn(
              "text-sm font-medium tracking-wide transition-all duration-300",
              uiState === 'responding' ? "text-emerald-500/80" : "text-slate-500"
            )}>
              {statusMessage}
            </p>
          )}
        </div>

        {/* Idle state prompt */}
        {uiState === 'idle' && !statusMessage && isConnected && (
          <p className="text-slate-600 text-sm">
            Press spacebar or tap mic to speak
          </p>
        )}
      </div>

      {/* Transcript strip - bottom */}
      <div className="absolute bottom-28 left-0 right-0 px-6">
        <div 
          ref={transcriptRef}
          className="max-w-2xl mx-auto max-h-40 overflow-y-auto scrollbar-hide"
        >
          {transcriptHistory.length > 0 || currentText ? (
            <div className="space-y-3">
              {transcriptHistory.slice(-4).map((item, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex",
                    item.role === 'user' ? "justify-start" : "justify-end"
                  )}
                >
                  <div className={cn(
                    "max-w-[80%] px-4 py-2.5 rounded-2xl text-sm",
                    item.role === 'user' 
                      ? "bg-slate-800/60 text-slate-300 rounded-bl-sm" 
                      : "bg-slate-800/40 text-slate-400 rounded-br-sm border border-slate-700/50"
                  )}>
                    {item.text}
                  </div>
                </div>
              ))}
              
              {/* Current live text */}
              {currentText && (
                <div className={cn(
                  "flex",
                  uiState === 'listening' ? "justify-start" : "justify-end"
                )}>
                  <div className={cn(
                    "max-w-[80%] px-4 py-2.5 rounded-2xl text-sm",
                    uiState === 'listening'
                      ? "bg-slate-800/60 text-slate-300 rounded-bl-sm border border-slate-600/30" 
                      : "bg-emerald-950/30 text-emerald-400/90 rounded-br-sm border border-emerald-800/30"
                  )}>
                    {currentText}
                    {uiState === 'responding' && (
                      <span className="inline-block w-1.5 h-4 ml-1 bg-emerald-500/60 animate-pulse" />
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom mic button */}
      <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center">
        <Button
          size="lg"
          className={cn(
            "h-16 w-16 rounded-full transition-all duration-300 shadow-lg",
            "border-2",
            uiState === 'idle' && "bg-slate-800 border-slate-700 hover:bg-slate-700 hover:border-slate-600 text-slate-400",
            uiState === 'listening' && "bg-slate-700 border-slate-500 text-white scale-105",
            uiState === 'responding' && "bg-emerald-900/50 border-emerald-700/50 text-emerald-400",
            !isConnected && "bg-slate-900 border-slate-800 text-slate-600"
          )}
          onClick={handleMicClick}
          disabled={isReconnecting}
        >
          <Mic className="h-6 w-6" />
        </Button>
        
        {!isConnected && !statusMessage && (
          <p className="mt-4 text-slate-600 text-sm">Talk to Aegis</p>
        )}
      </div>

      {/* Error/reconnection overlay */}
      {isReconnecting && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Reconnecting to Aegis...</p>
          </div>
        </div>
      )}
    </div>
  );
}
