import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTravellerTTS — speaks traveller-safe text via the AUTHENTICATED traveller-aegis-tts function
 * (Onyx voice). Interface only: it synthesizes provided deterministic text; it writes nothing,
 * retrieves nothing, and chooses no scope. If TTS is unavailable it fails quietly — the caller
 * always still shows the text on screen, so voice never gates the conversation.
 */
function base64ToBlob(b64: string, type: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

export function useTravellerTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    try { audioRef.current?.pause(); } catch { /* noop */ }
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    audioRef.current = null;
    setIsSpeaking(false);
  }, []);

  // Resolves when playback ends (or immediately if TTS is unavailable). Never throws.
  const speak = useCallback(async (text: string): Promise<void> => {
    stop();
    const clean = (text ?? "").trim();
    if (!clean) return;
    try {
      const { data, error } = await supabase.functions.invoke("traveller-aegis-tts", { body: { text: clean } });
      const audioB64 = (data as { audio?: string } | null)?.audio;
      if (error || !audioB64) return; // graceful: text already shown by caller
      const blob = base64ToBlob(audioB64, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      setIsSpeaking(true);
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
    } catch {
      /* graceful — caller still shows the text */
    } finally {
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      audioRef.current = null;
      setIsSpeaking(false);
    }
  }, [stop]);

  return { speak, stop, isSpeaking };
}
