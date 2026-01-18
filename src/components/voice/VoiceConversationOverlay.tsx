import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useOpenAIRealtime } from "./useOpenAIRealtime";
import { cn } from "@/lib/utils";

interface VoiceConversationOverlayProps {
  onClose: () => void;
  agentContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

type UIState = 'idle' | 'listening' | 'responding';

// Audio waveform visualization component
function AudioWaveform({ isActive, isResponding }: { isActive: boolean; isResponding: boolean }) {
  const bars = 40;
  
  return (
    <div className="flex items-center justify-center gap-[2px] h-12 px-8">
      {Array.from({ length: bars }).map((_, i) => {
        const centerDistance = Math.abs(i - bars / 2) / (bars / 2);
        const baseHeight = isActive ? (1 - centerDistance * 0.7) : 0.15;
        
        return (
          <div
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-all",
              isResponding ? "bg-emerald-500" : "bg-emerald-600/60"
            )}
            style={{
              height: `${baseHeight * 100}%`,
              animationName: isActive ? 'waveform' : 'none',
              animationDuration: `${0.3 + Math.random() * 0.4}s`,
              animationIterationCount: 'infinite',
              animationDirection: 'alternate',
              animationTimingFunction: 'ease-in-out',
              animationDelay: `${i * 0.02}s`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes waveform {
          0% { transform: scaleY(0.3); }
          100% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

export function VoiceConversationOverlay({
  onClose,
  agentContext,
  conversationHistory = []
}: VoiceConversationOverlayProps) {
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
    isConnected,
    setOutputMuted,
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
      if (error.includes('Audio playback blocked')) {
        setStatusMessage('Tap once to enable audio.');
        return;
      }
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

  // Auto-connect when overlay opens
  useEffect(() => {
    console.log('VoiceConversationOverlay mounted, auto-connecting...');
    connect();
    return () => {
      console.log('VoiceConversationOverlay unmounting, disconnecting...');
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setStatusMessage('Ready — speak anytime');
    } else if (status === 'connecting') {
      setStatusMessage('Connecting to Aegis...');
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

  const isWaveformActive = uiState === 'listening' || uiState === 'responding';

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
          onClick={() => {
            const next = !isMuted;
            setIsMuted(next);
            setOutputMuted(next);
          }}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          <span>{isMuted ? 'Unmute' : 'Mute'}</span>
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

      {/* Main content */}
      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        
        {/* Shield with glow - positioned at top */}
        <div className="flex justify-center pt-8 pb-4">
          <div className="relative">
            {/* Green glow behind shield */}
            <div className={cn(
              "absolute inset-0 rounded-full blur-3xl transition-all duration-700",
              uiState === 'responding' 
                ? "bg-emerald-500/25 scale-150" 
                : uiState === 'listening'
                ? "bg-emerald-500/20 scale-125 animate-pulse"
                : "bg-emerald-500/10 scale-110"
            )} style={{ width: '160px', height: '160px', left: '-20px', top: '-20px' }} />
            
            {/* Shield SVG */}
            <div className="relative">
              <svg width="120" height="140" viewBox="0 0 140 160" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                <path 
                  d="M70 8L12 32V72C12 112 38 148 70 156C102 148 128 112 128 72V32L70 8Z" 
                  fill="url(#shieldGradient)"
                  stroke="url(#shieldBorder)"
                  strokeWidth="2"
                />
                <path 
                  d="M70 50L45 95H55L70 70L85 95H95L70 50Z" 
                  fill="#1a202c"
                  stroke="#4a5568"
                  strokeWidth="1"
                />
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
        </div>

        {/* Scrollable transcript area */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Transcript bubbles */}
            {transcriptHistory.map((item, i) => (
              <div 
                key={i} 
                className={cn(
                  "flex items-start gap-3",
                  item.role === 'user' ? "justify-start" : "justify-end"
                )}
              >
                {item.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-slate-700/80 flex items-center justify-center shrink-0">
                    <Mic className="w-4 h-4 text-slate-400" />
                  </div>
                )}
                
                <div className={cn(
                  "relative px-4 py-3 rounded-2xl text-sm max-w-[75%]",
                  item.role === 'user' 
                    ? "bg-slate-800/80 text-slate-200 rounded-tl-sm" 
                    : "bg-slate-800/60 text-slate-300 rounded-tr-sm border border-emerald-900/30"
                )}>
                  <p className="leading-relaxed">{item.text}</p>
                  <span className="absolute -right-12 bottom-1 text-[10px] text-slate-600 font-mono whitespace-nowrap">
                    {item.time}
                  </span>
                </div>
                
                {item.role === 'agent' && (
                  <div className="w-8 h-8 rounded-full bg-emerald-900/40 flex items-center justify-center shrink-0 border border-emerald-800/50">
                    <svg width="16" height="18" viewBox="0 0 140 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M70 8L12 32V72C12 112 38 148 70 156C102 148 128 112 128 72V32L70 8Z" fill="#2d3748" stroke="#4a5568" strokeWidth="8"/>
                    </svg>
                  </div>
                )}
              </div>
            ))}
            
            {/* Current live text */}
            {currentText && (
              <div className={cn(
                "flex items-start gap-3",
                uiState === 'listening' ? "justify-start" : "justify-end"
              )}>
                {uiState === 'listening' && (
                  <div className="w-8 h-8 rounded-full bg-slate-700/80 flex items-center justify-center shrink-0 animate-pulse">
                    <Mic className="w-4 h-4 text-emerald-400" />
                  </div>
                )}
                
                <div className={cn(
                  "px-4 py-3 rounded-2xl text-sm max-w-[75%]",
                  uiState === 'listening'
                    ? "bg-slate-800/80 text-slate-200 rounded-tl-sm" 
                    : "bg-slate-800/60 text-emerald-300 rounded-tr-sm border border-emerald-800/40"
                )}>
                  <p className="leading-relaxed">
                    {currentText}
                    {uiState === 'responding' && (
                      <span className="inline-block w-0.5 h-4 ml-1 bg-emerald-500/60 animate-pulse align-middle" />
                    )}
                  </p>
                </div>
                
                {uiState === 'responding' && (
                  <div className="w-8 h-8 rounded-full bg-emerald-900/40 flex items-center justify-center shrink-0 border border-emerald-700/50 animate-pulse">
                    <svg width="16" height="18" viewBox="0 0 140 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M70 8L12 32V72C12 112 38 148 70 156C102 148 128 112 128 72V32L70 8Z" fill="#2d3748" stroke="#10b981" strokeWidth="8"/>
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status line */}
        {statusMessage && (
          <div className="flex items-center justify-center gap-4 px-6 py-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-slate-700 max-w-24" />
            <span className={cn(
              "text-sm font-medium tracking-wide",
              uiState === 'responding' ? "text-emerald-500/80" : "text-slate-500"
            )}>
              {statusMessage}
            </span>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-slate-700 max-w-24" />
          </div>
        )}

        {/* Audio waveform */}
        <div className="py-4">
          <AudioWaveform isActive={isWaveformActive} isResponding={uiState === 'responding'} />
        </div>

        {/* Mic button */}
        <div className="flex justify-center pb-8 pt-2">
          <button
            onClick={handleMicClick}
            disabled={isReconnecting}
            className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
              "border-2 shadow-xl",
              uiState === 'listening' 
                ? "bg-emerald-900/70 border-emerald-500/70 text-emerald-400 shadow-emerald-900/40" 
                : uiState === 'responding'
                ? "bg-emerald-900/50 border-emerald-600/50 text-emerald-500 shadow-emerald-900/30"
                : "bg-slate-800/90 border-emerald-700/40 text-emerald-500 hover:bg-slate-700/90 hover:border-emerald-600/60 shadow-black/40"
            )}
          >
            <Mic className="w-8 h-8" />
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
