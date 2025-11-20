import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { files, tags, clientId, userId } = await req.json();
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Files array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${files.length} archival documents`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results = [];
    const errors = [];

    // Get all entities for cross-referencing
    const { data: entities } = await supabase
      .from('entities')
      .select('id, name, aliases')
      .eq('is_active', true);

    for (const fileData of files) {
      try {
        const { file, filename, mimeType, dateOfDocument } = fileData;
        
        console.log(`Processing: ${filename}`);

        // Decode base64 file
        const binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
        let text = '';

        // Extract text based on file type (simplified to avoid memory issues)
        if (mimeType === 'text/plain' || mimeType === 'text/csv' || filename.endsWith('.txt') || filename.endsWith('.csv')) {
          text = new TextDecoder().decode(binaryData);
        } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
          // For PDFs, create a placeholder - full text extraction causes memory issues
          text = `PDF Document: ${filename}\nSize: ${(binaryData.length / 1024).toFixed(1)} KB\nType: ${mimeType}\n\nThis is an archival document. Full text extraction is available upon request.`;
        } else if (mimeType.startsWith('image/')) {
          text = `Image file: ${filename}. Size: ${binaryData.length} bytes. Type: ${mimeType}`;
        } else {
          text = `Document: ${filename} (${mimeType}). Size: ${binaryData.length} bytes.`;
        }

        // Limit text to prevent memory issues (reduced from 5MB to 1MB)
        const MAX_TEXT_LENGTH = 1000000; // 1MB
        if (text.length > MAX_TEXT_LENGTH) {
          text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Content truncated - exceeds 1MB limit]';
        }

        // Upload file to storage
        const timestamp = Date.now();
        const storagePath = `${clientId || 'unassigned'}/${timestamp}_${filename}`;
        
        const { error: uploadError } = await supabase
          .storage
          .from('archival-documents')
          .upload(storagePath, binaryData, {
            contentType: mimeType,
            upsert: false
          });

        if (uploadError) {
          console.error(`Storage upload error for ${filename}:`, uploadError);
          throw uploadError;
        }

        // Extract keywords (simplified - top 10 instead of 20)
        const words = text.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 4);
        const wordFreq = new Map<string, number>();
        words.slice(0, 500).forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1)); // Only process first 500 words
        const keywords = Array.from(wordFreq.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([word]) => word);

        // Simple entity mention detection (no complex processing)
        const entityMentions: string[] = [];
        if (entities && entities.length > 0) {
          const textLower = text.toLowerCase();
          // Only check first 1000 characters to avoid performance issues
          const checkText = textLower.substring(0, 1000);
          for (const entity of entities) {
            const names = [entity.name, ...(entity.aliases || [])].slice(0, 3); // Max 3 names per entity
            for (const name of names) {
              if (checkText.includes(name.toLowerCase())) {
                entityMentions.push(entity.name);
                break;
              }
            }
            if (entityMentions.length >= 5) break; // Max 5 entity mentions
          }
        }

        // Generate summary (reduced from 500 to 200 chars)
        const summary = text.substring(0, 200).trim() + (text.length > 200 ? '...' : '');

        // Insert into archival_documents table
        const { data: document, error: insertError } = await supabase
          .from('archival_documents')
          .insert({
            filename: filename,
            file_type: mimeType,
            file_size: binaryData.length,
            storage_path: storagePath,
            content_text: text,
            tags: tags || ['archival', 'historical'],
            client_id: clientId || null,
            uploaded_by: userId || null,
            date_of_document: dateOfDocument || null,
            is_archival: true,
            entity_mentions: entityMentions,
            keywords: keywords,
            summary: summary,
            metadata: {
              original_filename: filename,
              upload_timestamp: new Date().toISOString(),
            }
          })
          .select()
          .single();

        if (insertError) {
          console.error(`Database insert error for ${filename}:`, insertError);
          throw insertError;
        }

        // Skip AI correlation for archival uploads to save resources
        // Entity correlation will be done separately if needed
        
        results.push({
          filename: filename,
          documentId: document.id,
          entityMentions: entityMentions.length,
          success: true
        });

        console.log(`Successfully processed: ${filename}`);
      } catch (error) {
        console.error(`Error processing file:`, error);
        errors.push({
          filename: fileData.filename,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`Batch complete: ${results.length} succeeded, ${errors.length} failed`);

    return new Response(
      JSON.stringify({ 
        success: true,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-archival-documents function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
