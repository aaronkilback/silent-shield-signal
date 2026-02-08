import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface GenerateAudioRequest {
  content: string;
  title: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    let userId: string;
    
    // Allow service-role calls (server-to-server from dashboard-ai-assistant)
    if (token === serviceRoleKey) {
      // Parse user_id from request body instead
      const bodyText = await req.text();
      const body: GenerateAudioRequest & { user_id?: string } = JSON.parse(bodyText);
      userId = body.user_id || "system";
      // Re-assign body vars since we consumed the stream
      var content = body.content;
      var title = body.title;
    } else {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return errorResponse("Unauthorized", 401);
      }
      userId = user.id;
      const body: GenerateAudioRequest = await req.json();
      content = body.content;
      title = body.title;
    }

    // content and title already extracted above

    if (!content) {
      return errorResponse("Content is required", 400);
    }

    // Clean content for TTS - remove markdown, special characters
    const cleanContent = content
      .replace(/#+\s*/g, "") // Remove markdown headers
      .replace(/\*\*/g, "") // Remove bold
      .replace(/\*/g, "") // Remove italics
      .replace(/`[^`]*`/g, "") // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convert links to text
      .replace(/\n{3,}/g, "\n\n") // Reduce multiple newlines
      .trim();

    // OpenAI TTS has a limit of ~4096 characters, chunk if needed
    const maxChunkSize = 2000;
    const chunks: string[] = [];
    
    // Split by paragraphs first to maintain natural breaks
    const paragraphs = cleanContent.split("\n\n");
    let currentChunk = "";
    
    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    // Generate audio for each chunk using OpenAI TTS-1-HD with "onyx" voice
    const audioBuffers: Uint8Array[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          voice: "onyx", // Deep, authoritative male voice
          input: chunk,
          response_format: "mp3",
          speed: 0.95, // Slightly slower for briefing clarity
        }),
      });

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text();
        console.error(`TTS error for chunk ${i}:`, errorText);
        throw new Error(`TTS API error: ${ttsResponse.status}`);
      }

      const audioBuffer = new Uint8Array(await ttsResponse.arrayBuffer());
      audioBuffers.push(audioBuffer);
    }

    // Combine audio buffers (simple concatenation for MP3)
    const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of audioBuffers) {
      combinedBuffer.set(buffer, offset);
      offset += buffer.length;
    }

    // Upload to storage
    const serviceClient = createServiceClient();
    
    const fileName = `briefings/${userId}/${Date.now()}-${title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}.mp3`;
    
    const { data: uploadData, error: uploadError } = await serviceClient.storage
      .from("tenant-files")
      .upload(fileName, combinedBuffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload error: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = serviceClient.storage
      .from("tenant-files")
      .getPublicUrl(fileName);

    return successResponse({
      audio_url: urlData.publicUrl,
      duration_estimate: Math.ceil(cleanContent.length / 15), // Rough estimate: ~15 chars/second
      chunks_processed: chunks.length,
    });
  } catch (error) {
    console.error("Error generating audio:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
