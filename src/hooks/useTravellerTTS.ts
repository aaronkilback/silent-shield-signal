import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTravellerTTS — speaks traveller-safe text via the AUTHENTICATED traveller-aegis-tts function
 * (Onyx voice). Interface only: it synthesizes provided deterministic text; it writes nothing,
 * retrieves nothing, and chooses no scope.
 *
 * Browser autoplay policy: programmatic audio.play() is blocked unless the audio element has been
 * "unlocked" by a user gesture. We keep ONE reusable <audio> element and unlock it on a gesture
 * (the Start Voice / mic tap). speak()/replayLast() report an OUTCOME so the caller's voice-session
 * state machine knows whether to resume listening:
 *   'played'      — audio finished playing
 *   'blocked'     — browser blocked autoplay (show "Hear Aegis" for a manual gesture replay)
 *   'unavailable' — TTS could not produce audio (text was still shown)
 */
export type SpeakOutcome = "played" | "blocked" | "unavailable";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function base64ToBlob(b64: string, type: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

export function useTravellerTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);

  const getEl = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const revoke = useCallback(() => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  // Call from a USER GESTURE (Start Voice / mic tap) to bless the reusable element so later
  // programmatic play() is permitted. Idempotent.
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const el = getEl();
    try {
      el.src = SILENT_WAV;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => { try { el.pause(); el.currentTime = 0; } catch { /* noop */ } }).catch(() => { /* retry via replayLast */ });
      }
      unlockedRef.current = true;
    } catch { /* noop */ }
  }, [getEl]);

  const stop = useCallback(() => {
    try { audioRef.current?.pause(); } catch { /* noop */ }
    revoke();
    setIsSpeaking(false);
  }, [revoke]);

  // Play `text` on the (unlocked) reusable element. Resolves with the outcome. Never throws.
  const speak = useCallback(async (text: string): Promise<SpeakOutcome> => {
    const clean = (text ?? "").trim();
    if (!clean) return "unavailable";
    setError(null);
    const el = getEl();
    try { el.pause(); } catch { /* noop */ }
    revoke();

    let audioB64: string | undefined;
    try {
      const { data, error: invErr } = await supabase.functions.invoke("traveller-aegis-tts", { body: { text: clean } });
      if (invErr) { setError("Aegis voice is unavailable right now."); return "unavailable"; }
      audioB64 = (data as { audio?: string } | null)?.audio;
    } catch {
      setError("Aegis voice is unavailable right now.");
      return "unavailable";
    }
    if (!audioB64) { setError("Aegis voice is unavailable right now."); return "unavailable"; }

    const url = URL.createObjectURL(base64ToBlob(audioB64, "audio/mpeg"));
    urlRef.current = url;
    el.src = url;
    return await new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      const done = (o: SpeakOutcome) => { if (settled) return; settled = true; setIsSpeaking(false); resolve(o); };
      el.onplaying = () => setIsSpeaking(true);
      el.onended = () => done("played");
      el.onerror = () => { setError("Aegis voice playback failed."); done("unavailable"); };
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => setIsSpeaking(true)).catch((err: unknown) => {
          console.warn("[traveller-tts] play() blocked:", (err as { name?: string })?.name ?? err);
          setError("Aegis voice was blocked by the browser. Tap “Hear Aegis”.");
          done("blocked");
        });
      }
    });
  }, [getEl, revoke]);

  // Replay the last audio from a REAL user gesture (the retry button). Resolves with the outcome.
  const replayLast = useCallback(async (): Promise<SpeakOutcome> => {
    const el = audioRef.current;
    if (!el || !el.src) return "unavailable";
    unlockedRef.current = true;
    setError(null);
    return await new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      const done = (o: SpeakOutcome) => { if (settled) return; settled = true; setIsSpeaking(false); resolve(o); };
      el.onplaying = () => setIsSpeaking(true);
      el.onended = () => done("played");
      el.onerror = () => done("unavailable");
      try { el.currentTime = 0; } catch { /* noop */ }
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => setIsSpeaking(true)).catch(() => { setError("Aegis voice was blocked by the browser."); done("blocked"); });
      }
    });
  }, []);

  return { speak, replayLast, stop, unlock, isSpeaking, error, hasAudio: () => !!audioRef.current?.src };
}
