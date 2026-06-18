import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTravellerTTS — speaks traveller-safe text via the AUTHENTICATED traveller-aegis-tts function
 * (Onyx voice). Interface only: it synthesizes provided deterministic text; it writes nothing,
 * retrieves nothing, and chooses no scope.
 *
 * Browser autoplay policy: programmatic audio.play() is blocked unless the audio element has been
 * "unlocked" by a user gesture. The Aegis reply is played from a SpeechRecognition callback after
 * an awaited fetch — NOT a gesture stack — so we (a) keep ONE reusable <audio> element and unlock
 * it on the mic tap (unlock()), and (b) if a play() still rejects, surface it via `error` and let
 * the traveller replay with a real gesture (replayLast()). isSpeaking reflects REAL playback only.
 */
// Valid empty WAV — used only to "bless" the audio element during a user gesture.
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
      el.onplaying = () => setIsSpeaking(true);
      el.onended = () => setIsSpeaking(false);
      el.onpause = () => setIsSpeaking(false);
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const revoke = useCallback(() => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  // Call from a USER GESTURE (e.g. the mic tap) to bless the reusable audio element so later
  // programmatic play() is permitted by the browser. Idempotent; safe to call repeatedly.
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const el = getEl();
    try {
      el.src = SILENT_WAV;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => { try { el.pause(); el.currentTime = 0; } catch { /* noop */ } }).catch(() => { /* will retry via replayLast */ });
      }
      unlockedRef.current = true;
    } catch { /* noop */ }
  }, [getEl]);

  const stop = useCallback(() => {
    try { audioRef.current?.pause(); } catch { /* noop */ }
    revoke();
    setIsSpeaking(false);
  }, [revoke]);

  // Fetch Onyx audio for `text` and play it on the (unlocked) reusable element. Resolves when
  // playback ends or fails. Never throws; sets `error` instead of swallowing rejections.
  const speak = useCallback(async (text: string): Promise<void> => {
    const clean = (text ?? "").trim();
    if (!clean) return;
    setError(null);
    const el = getEl();
    try { el.pause(); } catch { /* noop */ }
    revoke();

    let audioB64: string | undefined;
    try {
      const { data, error: invErr } = await supabase.functions.invoke("traveller-aegis-tts", { body: { text: clean } });
      if (invErr) { setError("Aegis voice is unavailable right now."); return; }
      audioB64 = (data as { audio?: string } | null)?.audio;
    } catch {
      setError("Aegis voice is unavailable right now.");
      return;
    }
    if (!audioB64) { setError("Aegis voice is unavailable right now."); return; }

    const url = URL.createObjectURL(base64ToBlob(audioB64, "audio/mpeg"));
    urlRef.current = url;
    el.src = url;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(); };
      el.onended = () => { setIsSpeaking(false); finish(); };
      el.onerror = () => { setError("Aegis voice playback failed."); setIsSpeaking(false); finish(); };
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => { setIsSpeaking(true); }).catch((err: unknown) => {
          // Autoplay/gesture rejection — surface it; keep the audio so the traveller can replay.
          console.warn("[traveller-tts] play() blocked:", (err as { name?: string })?.name ?? err);
          setError("Aegis voice was blocked by the browser. Tap “Hear Aegis”.");
          setIsSpeaking(false);
          finish();
        });
      }
    });
  }, [getEl, revoke]);

  // Replay the last fetched audio from a REAL user gesture (the retry button). Also blesses the
  // element so subsequent automatic playback works for the rest of the session.
  const replayLast = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !el.src) return;
    unlockedRef.current = true;
    setError(null);
    try { el.currentTime = 0; await el.play(); setIsSpeaking(true); }
    catch { setError("Aegis voice was blocked by the browser."); }
  }, []);

  return { speak, stop, unlock, replayLast, isSpeaking, error, hasAudio: () => !!audioRef.current?.src };
}
