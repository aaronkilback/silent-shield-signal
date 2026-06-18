import { useState, useCallback, useRef, useEffect } from "react";
import { Mic, Square } from "lucide-react";

/**
 * TravellerVoiceCapture (Slice D3b) — browser-native voice → transcript, INTERFACE ONLY.
 *
 * Uses the same authority-free browser SpeechRecognition pattern as VoiceDictationInput
 * (no backend, no tools, no tenant/client, no realtime stack, no retrieval). It does NOT
 * persist anything and does NOT parse: it only emits finalized speech chunks to the parent,
 * which appends them to the editable transcript. The traveller always sees and can edit the
 * transcript before anything happens; parsing/saving stay behind explicit taps downstream.
 *
 * Voice is an interface layer, not authority: speech → text the traveller confirms.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

interface Props {
  /** Called with each finalized speech chunk; parent appends to the editable transcript. */
  onFinalChunk: (text: string) => void;
  /** Begin listening as soon as the component mounts (e.g. from a "Speak your itinerary" tap). */
  autoStart?: boolean;
  disabled?: boolean;
  /** Notifies the parent when listening starts/stops (e.g. to drive the Aegis Core state). */
  onListeningChange?: (listening: boolean) => void;
  /** Optional label override for the start button. */
  startLabel?: string;
}

export function TravellerVoiceCapture({ onFinalChunk, autoStart = false, disabled = false, onListeningChange, startLabel = "Tell Aegis about your trip" }: Props) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const onFinalRef = useRef(onFinalChunk);
  useEffect(() => { onFinalRef.current = onFinalChunk; }, [onFinalChunk]);
  const onListeningRef = useRef(onListeningChange);
  useEffect(() => { onListeningRef.current = onListeningChange; }, [onListeningChange]);
  const setListening = useCallback((v: boolean) => { setIsListening(v); onListeningRef.current?.(v); }, []);

  const supported = isSpeechRecognitionSupported();

  const stop = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
    setInterim("");
  }, [setListening]);

  const start = useCallback(() => {
    if (!supported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => { setErr(null); setListening(true); setInterim(""); };
    recognition.onresult = (event: any) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const chunk = String(result[0]?.transcript ?? "").trim();
          if (chunk) onFinalRef.current(chunk);
        } else {
          interimText += result[0]?.transcript ?? "";
        }
      }
      setInterim(interimText);
    };
    recognition.onerror = (event: any) => {
      if (event?.error && event.error !== "aborted") {
        setErr(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access is blocked. You can type or paste instead."
          : "Voice had trouble. You can type or paste instead.");
      }
      setListening(false);
      setInterim("");
    };
    recognition.onend = () => { setListening(false); setInterim(""); };

    try { recognition.start(); } catch { /* already started */ }
  }, [supported, setListening]);

  // Auto-start once on mount if requested; always abort on unmount.
  useEffect(() => {
    if (autoStart && supported) start();
    return () => { try { recognitionRef.current?.abort(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) {
    // Calm fallback — intake never breaks; the parent still shows the editable textarea.
    return (
      <p className="text-[12px] text-[#8fb0ff]">
        Voice isn't available in this browser — you can type or paste your itinerary below instead.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={isListening ? stop : start}
        disabled={disabled}
        className={`inline-flex items-center gap-2 h-11 px-4 rounded-[32px] text-sm font-medium transition-colors disabled:opacity-50 ${
          isListening
            ? "bg-[#3a1530] border border-[#ff6b9d]/50 text-[#ffb3d0] animate-pulse"
            : "bg-[#1b3a8a] text-white hover:bg-[#27499e]"
        }`}
      >
        {isListening ? <><Square className="h-4 w-4" />Stop listening</> : <><Mic className="h-4 w-4" />{startLabel}</>}
      </button>
      {isListening && (
        <p className="text-[12px] text-[#8fb0ff]">
          Listening… <span className="text-[#cfe0ff]">{interim || "speak naturally — I'll write it down."}</span>
        </p>
      )}
      {err && <p className="text-[12px] text-[#ff8a52]">{err}</p>}
    </div>
  );
}
