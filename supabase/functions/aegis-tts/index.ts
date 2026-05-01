import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Strip markdown and special characters for clean TTS
function prepareTextForSpeech(text: string): string {
  return text
    .replace(/\*\*/g, "") // Bold
    .replace(/\*/g, "") // Italic
    .replace(/#{1,6}\s/g, "") // Headers
    .replace(/`[^`]*`/g, "") // Inline code
    .replace(/```[\s\S]*?```/g, "") // Code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links - keep text
    .replace(/[-•]/g, "") // Bullets
    .replace(/\n{2,}/g, ". ") // Multiple newlines to pause
    .replace(/\n/g, " ") // Single newlines to space
    .replace(/\s+/g, " ") // Multiple spaces
    .trim();
}

// Chunk text at natural boundaries (max 2000 chars for reliability)
function chunkText(text: string, maxChars = 2000): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find best break point: paragraph > sentence > word
    let breakPoint = remaining.lastIndexOf(". ", maxChars);
    if (breakPoint === -1 || breakPoint < maxChars / 2) {
      breakPoint = remaining.lastIndexOf(" ", maxChars);
    }
    if (breakPoint === -1) {
      breakPoint = maxChars;
    }

    chunks.push(remaining.substring(0, breakPoint + 1).trim());
    remaining = remaining.substring(breakPoint + 1).trim();
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "TTS service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare text for speech
    const cleanText = prepareTextForSpeech(text);
    
    if (!cleanText) {
      return new Response(
        JSON.stringify({ error: "No speakable content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Chunk if needed
    const chunks = chunkText(cleanText);
    const audioBuffers: ArrayBuffer[] = [];

    // Process each chunk with retry logic
    for (const chunk of chunks) {
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "tts-1-hd",
              voice: "onyx",
              input: chunk,
              response_format: "mp3",
              speed: 1.0,
            }),
          });

          if (response.status === 429) {
            // Rate limited - wait and retry
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(r => setTimeout(r, 1000 * attempts));
              continue;
            }
          }

          if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI TTS error:", response.status, errorText);
            throw new Error(`TTS request failed: ${response.status}`);
          }

          const audioBuffer = await response.arrayBuffer();
          audioBuffers.push(audioBuffer);
          break;
        } catch (err) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw err;
          }
          await new Promise(r => setTimeout(r, 1000 * attempts));
        }
      }
    }

    // Combine audio buffers if multiple chunks
    let combinedBuffer: ArrayBuffer;
    if (audioBuffers.length === 1) {
      combinedBuffer = audioBuffers[0];
    } else {
      const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of audioBuffers) {
        combined.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      combinedBuffer = combined.buffer;
    }

    // Return as base64 for easier client handling
    const base64Audio = base64Encode(combinedBuffer);

    return new Response(
      JSON.stringify({ audio: base64Audio, format: "mp3" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("TTS error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "TTS failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
