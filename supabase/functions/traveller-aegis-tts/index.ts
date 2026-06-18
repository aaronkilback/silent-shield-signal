// traveller-aegis-tts — authenticated, traveller-safe text-to-speech for Traveller Aegis Home
// Voice Mode (Slice D3-Voice / Option A). Speaks ONLY the deterministic text it is given, in the
// same Onyx voice as Fortress, and returns audio. It is a pure TTS utility — NOT an authority.
//
// verify_jwt=true. Requires a real authenticated user (getCallerIdentity); rejects service-role
// callers (consistent with the other traveller user functions). It does NOT read the database,
// retrieve anything, call any tool/agent/LLM, or choose any tenant/client/traveler scope — it
// only synthesizes provided text. Distinct from the unauthenticated operator `aegis-tts`; the
// traveller home must not depend on that unauthenticated function.

import { getCallerIdentity } from "../_shared/supabase-client.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXT = 1500; // spoken replies are short deterministic templates

// Strip markdown / control chars so the spoken output is clean.
function prepareTextForSpeech(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[-•]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Auth: a real authenticated user only. No service-role; no DB read, no scope.
  const caller = await getCallerIdentity(req);
  if (caller.kind === "unauthorized") return json({ error: caller.error }, caller.status);
  if (caller.kind === "service_role") {
    return json({ error: "SERVICE_ROLE_NOT_ALLOWED: traveller-aegis-tts is for authenticated traveller users only" }, 403);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "TTS service not configured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  const rawText = typeof body.text === "string" ? body.text : "";
  const cleanText = prepareTextForSpeech(rawText).slice(0, MAX_TEXT);
  if (!cleanText) return json({ error: "No speakable content" }, 400);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1-hd", voice: "onyx", input: cleanText, response_format: "mp3", speed: 1.0 }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[traveller-aegis-tts] OpenAI TTS error:", response.status, errText.slice(0, 200));
      return json({ error: "TTS_FAILED" }, 502);
    }
    const audioBuffer = await response.arrayBuffer();
    return json({ audio: base64Encode(audioBuffer), format: "mp3" });
  } catch (err) {
    console.error("[traveller-aegis-tts] error:", err);
    return json({ error: "TTS_FAILED" }, 502);
  }
});
