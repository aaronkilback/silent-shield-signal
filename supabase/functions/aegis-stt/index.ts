import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "STT service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the audio file from the request
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof File)) {
      return new Response(
        JSON.stringify({ error: "Audio file is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create form data for OpenAI
    const openAIFormData = new FormData();
    // Preserve the original filename/type from the client. Whisper accepts many audio formats
    // (mp4/webm/wav/etc) and iOS Safari commonly records mp4.
    openAIFormData.append("file", audioFile, audioFile.name || "audio");
    openAIFormData.append("model", "whisper-1");
    openAIFormData.append("language", "en");
    openAIFormData.append("response_format", "json");

    // Call OpenAI Whisper API
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: openAIFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Whisper error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Transcription failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    
    return new Response(
      JSON.stringify({ text: result.text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("STT error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "STT failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
