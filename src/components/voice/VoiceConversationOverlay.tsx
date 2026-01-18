import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, RotateCcw } from "lucide-react";
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
  const [transcriptHistory, setTranscriptHistory] = useState<Array<{ role: 'user' | 'agent'; text: string; time: string }>>([]);
  const [currentText, setCurrentText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
        setTranscriptHistory(prev => [...prev, { role: 'user', text, time: formatTime(elapsedTime) }]);
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
        setStatusMessage('Reconnecting...');
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

  // Timer for elapsed time
  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  // Map internal status to UI state
  useEffect(() => {
    if (status === 'listening') {
      setUiState('listening');
      setStatusMessage('Listening...');
    } else if (status === 'speaking' || isAgentSpeaking) {
      setUiState('responding');
      setStatusMessage('Responding...');
    } else if (status === 'connected') {
      setUiState('idle');
      setStatusMessage('');
    } else if (status === 'connecting') {
      setStatusMessage('Connecting...');
    }
  }, [status, isAgentSpeaking]);

  // When agent stops speaking, save response to history
  useEffect(() => {
    if (!isAgentSpeaking && currentText.trim() && uiState === 'responding') {
      setTranscriptHistory(prev => [...prev, { role: 'agent', text: currentText, time: formatTime(elapsedTime) }]);
      setCurrentText('');
    }
  }, [isAgentSpeaking, currentText, uiState, elapsedTime]);

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

  const handleRestart = useCallback(() => {
    disconnect();
    setTranscriptHistory([]);
    setCurrentText('');
    setElapsedTime(0);
    setStatusMessage('Reconnecting...');
    setTimeout(() => connect(), 500);
  }, [disconnect, connect]);

  const handleMicClick = () => {
    if (!isConnected) {
      connect();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #1a1f2e 0%, #0d1117 50%, #0a0d12 100%)' }}>
      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }} />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-center py-4 px-6">
        <span className="text-[11px] tracking-[0.2em] text-slate-500 uppercase font-medium">
          AEGIS — Strategic Voice Assistant for Silent Shield
        </span>
      </div>

      {/* Top right controls */}
      <div className="absolute top-4 right-6 flex items-center gap-4 z-20">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
        >
          <MicOff className="w-4 h-4" />
          <span>Mute</span>
        </button>
        <button
          onClick={handleRestart}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Restart</span>
        </button>
      </div>

      {/* Close button (X) - top left */}
      <button
        onClick={onClose}
        className="absolute top-4 left-6 z-20 w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 2L14 14M14 2L2 14" />
        </svg>
      </button>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10">
        
        {/* Shield with glow */}
        <div className="relative mb-8">
          {/* Green glow behind shield */}
          <div className={cn(
            "absolute inset-0 rounded-full blur-3xl transition-all duration-700",
            uiState === 'responding' 
              ? "bg-emerald-500/20 scale-150" 
              : uiState === 'listening'
              ? "bg-emerald-500/15 scale-125 animate-pulse"
              : "bg-emerald-500/10 scale-110"
          )} style={{ width: '200px', height: '200px', left: '-30px', top: '-30px' }} />
          
          {/* Shield SVG */}
          <div className="relative">
            <svg width="140" height="160" viewBox="0 0 140 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Shield body with gradient */}
              <defs>
                <linearGradient id="shieldGradient" x1="70" y1="0" x2="70" y2="160" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#4a5568" />
                  <stop offset="50%" stopColor="#2d3748" />
                  <stop offset="100%" stopColor="#1a202c" />
                </linearGradient>
                <linearGradient id="shieldBorder" x1="70" y1="0" x2="70" y2="160" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#718096" />
                  <stop offset="100%" stopColor="#2d3748" />
                </linearGradient>
              </defs>
              
              {/* Shield shape */}
              <path 
                d="M70 8L12 32V72C12 112 38 148 70 156C102 148 128 112 128 72V32L70 8Z" 
                fill="url(#shieldGradient)"
                stroke="url(#shieldBorder)"
                strokeWidth="2"
              />
              
              {/* Inner chevron / A symbol */}
              <path 
                d="M70 50L45 95H55L70 70L85 95H95L70 50Z" 
                fill="#1a202c"
                stroke="#4a5568"
                strokeWidth="1"
              />
              
              {/* Chevron below */}
              <path 
                d="M50 100L70 120L90 100" 
                fill="none"
                stroke="#4a5568"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Talk to Aegis button */}
        <button
          onClick={handleMicClick}
          disabled={isConnected || isReconnecting}
          className={cn(
            "px-12 py-4 rounded-full text-lg font-medium transition-all duration-300 mb-4",
            "bg-gradient-to-b from-slate-700/80 to-slate-800/90",
            "border border-slate-600/50",
            "text-slate-200 hover:text-white",
            "hover:from-slate-600/80 hover:to-slate-700/90",
            "shadow-lg shadow-black/30",
            isConnected && "opacity-50 cursor-not-allowed"
          )}
        >
          Talk to Aegis
        </button>

        {/* Subtitle */}
        <p className="text-slate-500 text-sm mb-8">
          Press Spacebar or Tap to Speak
        </p>
      </div>

      {/* Transcript area */}
      <div className="relative z-10 px-6 pb-4">
        {/* Transcript bubbles */}
        {(transcriptHistory.length > 0 || currentText) && (
          <div className="max-w-2xl mx-auto mb-6 space-y-3">
            {transcriptHistory.slice(-4).map((item, i) => (
              <div 
                key={i} 
                className={cn(
                  "flex items-center gap-3",
                  item.role === 'user' ? "justify-start" : "justify-end"
                )}
              >
                <div className={cn(
                  "px-4 py-2.5 rounded-lg text-sm max-w-[70%]",
                  item.role === 'user' 
                    ? "bg-slate-800/70 text-slate-300 border border-slate-700/50" 
                    : "bg-slate-800/50 text-slate-400 border border-slate-700/30"
                )}>
                  {item.text}
                </div>
                <span className="text-[11px] text-slate-600 font-mono shrink-0">
                  {item.time}
                </span>
              </div>
            ))}
            
            {/* Current live text */}
            {currentText && (
              <div className={cn(
                "flex items-center gap-3",
                uiState === 'listening' ? "justify-start" : "justify-end"
              )}>
                <div className={cn(
                  "px-4 py-2.5 rounded-lg text-sm max-w-[70%]",
                  uiState === 'listening'
                    ? "bg-slate-800/70 text-slate-300 border border-slate-700/50" 
                    : "bg-slate-800/50 text-emerald-400/80 border border-emerald-800/30"
                )}>
                  {currentText}
                  {uiState === 'responding' && (
                    <span className="inline-block w-0.5 h-4 ml-1 bg-emerald-500/60 animate-pulse" />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status line with "Listening..." */}
        {statusMessage && (
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-slate-700" />
            <span className={cn(
              "text-sm font-medium tracking-wide",
              uiState === 'responding' ? "text-emerald-500/70" : "text-slate-500"
            )}>
              {statusMessage}
            </span>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-slate-700" />
          </div>
        )}

        {/* Mic button */}
        <div className="flex justify-center pb-6">
          <button
            onClick={handleMicClick}
            disabled={isReconnecting}
            className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
              "border-2",
              "shadow-lg shadow-black/40",
              uiState === 'listening' 
                ? "bg-emerald-900/60 border-emerald-600/60 text-emerald-400" 
                : uiState === 'responding'
                ? "bg-emerald-900/40 border-emerald-700/40 text-emerald-500"
                : "bg-slate-800/80 border-slate-600/50 text-emerald-500 hover:bg-slate-700/80 hover:border-slate-500/60"
            )}
          >
            <Mic className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Reconnection overlay */}
      {isReconnecting && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-30">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Reconnecting to Aegis...</p>
          </div>
        </div>
      )}
    </div>
  );
}
