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

        // Calculate approximate size from base64 string (without decoding yet)
        const base64Size = file.length * 0.75; // base64 to binary ratio
        const sizeKB = (base64Size / 1024).toFixed(1);
        
        // For large files, use minimal processing
        let text = '';
        let cleanSummary = '';
        let binaryData: Uint8Array;

        if (base64Size > 5000000) { // > 5MB
          // Don't decode large files into memory - just create metadata
          console.log(`Large file detected (${sizeKB} KB), using minimal processing`);
          const dateInfo = dateOfDocument ? ` from ${new Date(dateOfDocument).toLocaleDateString()}` : '';
          text = `Large Document: ${filename}${dateInfo}\nSize: ${sizeKB} KB\nType: ${mimeType}`;
          cleanSummary = `Large ${mimeType.split('/')[1] || 'document'}${dateInfo} - ${sizeKB} KB`;
          
          // Decode in chunks for upload only
          try {
            binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
          } catch (error) {
            console.error(`Failed to decode large file ${filename}:`, error);
            throw new Error(`File too large or corrupt: ${filename}`);
          }
        } else {
          // Decode smaller files normally
          try {
            binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
          } catch (error) {
            console.error(`Failed to decode file ${filename}:`, error);
            throw new Error(`File decoding failed: ${filename}`);
          }

          // Extract text based on file type
          if (mimeType === 'text/plain' || mimeType === 'text/csv' || filename.endsWith('.txt') || filename.endsWith('.csv')) {
            const maxBytes = Math.min(binaryData.length, 50000); // 50KB max
            const subset = binaryData.slice(0, maxBytes);
            text = new TextDecoder().decode(subset);
            if (binaryData.length > maxBytes) {
              text += '\n\n[Content truncated]';
            }
            cleanSummary = text.substring(0, 200).trim();
          } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
            const dateInfo = dateOfDocument ? ` from ${new Date(dateOfDocument).toLocaleDateString()}` : '';
            text = `PDF Document: ${filename}${dateInfo}\nSize: ${sizeKB} KB`;
            cleanSummary = `PDF report${dateInfo} - ${sizeKB} KB`;
          } else if (mimeType.startsWith('image/')) {
            text = `Image: ${filename}\nSize: ${sizeKB} KB`;
            cleanSummary = `Image - ${sizeKB} KB`;
          } else {
            text = `Document: ${filename}\nType: ${mimeType}\nSize: ${sizeKB} KB`;
            cleanSummary = `${mimeType.split('/')[1] || 'File'} - ${sizeKB} KB`;
          }
        }

        // Limit text length (50KB max)
        const MAX_TEXT_LENGTH = 50000;
        if (text.length > MAX_TEXT_LENGTH) {
          text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Content truncated]';
        }

        // Check for duplicates before processing
        const { data: dupCheck } = await supabase.functions.invoke('detect-duplicates', {
          body: {
            type: 'document',
            content: text,
            autoCheck: false
          }
        });

        if (dupCheck?.isDuplicate && dupCheck?.exactMatch) {
          errors.push({
            filename: fileData.filename,
            error: `Duplicate: ${dupCheck.message}`
          });
          console.log(`Skipping duplicate: ${filename}`);
          continue;
        }

        // Calculate content hash
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

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

        // Simple keyword extraction (minimal processing)
        const words = text.toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 4);
        const wordFreq = new Map<string, number>();
        words.slice(0, 200).forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));
        const keywords = Array.from(wordFreq.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([word]) => word);

        // Minimal entity detection (first 500 chars only)
        const entityMentions: string[] = [];
        if (entities && entities.length > 0) {
          const checkText = text.toLowerCase().substring(0, 500);
          for (const entity of entities.slice(0, 20)) {
            const name = entity.name.toLowerCase();
            if (checkText.includes(name)) {
              entityMentions.push(entity.name);
              if (entityMentions.length >= 3) break;
            }
          }
        }

        // Use the clean summary generated earlier (or fallback)
        const summary = cleanSummary || text.substring(0, 200).trim();

        // Insert into archival_documents table
        const { data: document, error: insertError } = await supabase
          .from('archival_documents')
          .insert({
            filename: filename,
            file_type: mimeType,
            file_size: binaryData.length,
            storage_path: storagePath,
            content_text: text,
            content_hash: contentHash,
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

        // Record document hash for future duplicate detection
        await supabase.from('document_hashes').insert({
          content_hash: contentHash,
          filename: filename,
          file_size: binaryData.length,
          archival_document_id: document.id
        });

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
