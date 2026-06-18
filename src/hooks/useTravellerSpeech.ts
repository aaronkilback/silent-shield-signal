import { useCallback, useEffect, useRef, useState } from "react";
import { isSpeechRecognitionSupported } from "@/components/traveller/TravellerVoiceCapture";

/**
 * useTravellerSpeech — headless browser-native SpeechRecognition for the Home Voice Mode session.
 * Interface only: produces a transcript; no backend, no tools, no scope, no writes.
 *
 * Each start() listens for ONE utterance (continuous=false) and stops the moment a final transcript
 * arrives, so the mic is never open while Aegis is speaking. The parent state machine decides when
 * to start() again (after Aegis finishes speaking) — this hook never auto-loops by itself.
 */
export { isSpeechRecognitionSupported };

export function useTravellerSpeech({ onFinal, onEnd }: { onFinal: (text: string) => void; onEnd?: (hadFinal: boolean) => void }) {
  const [isListening, setIsListening] = useState(false);
  const recRef = useRef<any>(null);
  const onFinalRef = useRef(onFinal);
  const onEndRef = useRef(onEnd);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);
  const supported = isSpeechRecognitionSupported();

  const stop = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    try { r?.abort?.(); } catch { /* noop */ }
    try { r?.stop?.(); } catch { /* noop */ }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    try { recRef.current?.abort?.(); } catch { /* noop */ }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    recRef.current = rec;
    rec.continuous = false;     // one utterance per start — mic ends itself after a final
    rec.interimResults = true;
    rec.lang = "en-US";
    let hadFinal = false;

    rec.onstart = () => setIsListening(true);
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += String(result[0]?.transcript ?? "");
      }
      if (finalText.trim() && !hadFinal) {
        hadFinal = true;
        try { rec.stop(); } catch { /* noop */ } // stop the mic BEFORE handing off (no echo)
        onFinalRef.current(finalText.trim());
      }
    };
    rec.onerror = () => { /* no-speech / aborted / network — onend handles state */ };
    rec.onend = () => { setIsListening(false); onEndRef.current?.(hadFinal); };

    try { rec.start(); } catch { /* already started */ }
  }, [supported]);

  useEffect(() => () => { try { recRef.current?.abort?.(); } catch { /* noop */ } }, []);

  return { supported, isListening, start, stop };
}
