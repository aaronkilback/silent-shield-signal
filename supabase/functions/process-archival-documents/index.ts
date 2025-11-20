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
    const entitySuggestions = [];

    for (const fileData of files) {
      try {
        const { file, filename, mimeType, dateOfDocument } = fileData;
        
        console.log(`Processing: ${filename}`);

        // CRITICAL: Check size before ANY processing to avoid memory issues
        const estimatedSize = file.length * 0.75; // base64 to bytes
        const sizeKB = (estimatedSize / 1024).toFixed(1);
        const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
        
        console.log(`File size: ${sizeKB} KB (${sizeMB} MB)`);

        // For files > 2MB, skip ALL content processing
        const SAFE_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB
        let shouldProcessContent = estimatedSize <= SAFE_SIZE_LIMIT;
        
        let text = '';
        let cleanSummary = '';
        let binaryData: Uint8Array;
        let keywords: string[] = [];
        let entityMentions: string[] = [];

        if (!shouldProcessContent) {
          // Large file - metadata only, NO decoding yet
          console.log(`Large file (${sizeMB} MB) - using metadata-only mode`);
          const dateInfo = dateOfDocument ? ` from ${new Date(dateOfDocument).toLocaleDateString()}` : '';
          const fileType = mimeType.split('/')[1]?.toUpperCase() || 'Document';
          text = `${fileType}: ${filename}${dateInfo}\nSize: ${sizeKB} KB`;
          cleanSummary = `${fileType}${dateInfo} - ${sizeKB} KB`;
          
          // Decode ONLY for storage upload (unavoidable)
          console.log(`Decoding ${filename} for storage upload only...`);
          binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
          console.log(`Decoded ${filename} successfully`);
        } else {
          // Small file - safe to process
          console.log(`Small file - processing content`);
          binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));

          if (mimeType === 'text/plain' || filename.endsWith('.txt')) {
            // Only first 20KB for text files
            const maxBytes = Math.min(binaryData.length, 20000);
            text = new TextDecoder().decode(binaryData.slice(0, maxBytes));
            cleanSummary = text.substring(0, 150).trim();
            
            // Extract keywords from small text
            const words = text.toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length > 4);
            const wordFreq = new Map<string, number>();
            words.slice(0, 100).forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));
            keywords = Array.from(wordFreq.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([word]) => word);
          } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
            const dateInfo = dateOfDocument ? ` from ${new Date(dateOfDocument).toLocaleDateString()}` : '';
            text = `PDF: ${filename}${dateInfo}\nSize: ${sizeKB} KB`;
            cleanSummary = `PDF${dateInfo} - ${sizeKB} KB`;
          } else {
            const fileType = mimeType.split('/')[1] || 'File';
            text = `${fileType}: ${filename}\nSize: ${sizeKB} KB`;
            cleanSummary = `${fileType} - ${sizeKB} KB`;
          }
        }

        // Generate simple content hash from metadata (not full content)
        const hashInput = `${filename}-${sizeKB}-${mimeType}`;
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(hashInput));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Check for existing file with same hash
        const { data: existingHash } = await supabase
          .from('document_hashes')
          .select('filename')
          .eq('content_hash', contentHash)
          .maybeSingle();

        if (existingHash) {
          errors.push({
            filename: filename,
            error: `Duplicate of ${existingHash.filename} (already uploaded)`
          });
          console.log(`Skipping duplicate: ${filename}`);
          continue;
        }

        // Upload file to storage
        console.log(`Uploading ${filename} to storage...`);
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
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        console.log(`Uploaded ${filename} to storage successfully`);

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
            tags: tags || ['archival'],
            client_id: clientId || null,
            uploaded_by: userId || null,
            date_of_document: dateOfDocument || null,
            is_archival: true,
            entity_mentions: entityMentions,
            keywords: keywords,
            summary: cleanSummary,
            metadata: {
              original_filename: filename,
              upload_timestamp: new Date().toISOString(),
              processed: shouldProcessContent,
              size_mb: sizeMB
            }
          })
          .select()
          .single();

        if (insertError) {
          console.error(`Database insert error for ${filename}:`, insertError);
          throw new Error(`Database insert failed: ${insertError.message}`);
        }

        console.log(`Saved ${filename} to database successfully`);

        // Record document hash
        await supabase.from('document_hashes').insert({
          content_hash: contentHash,
          filename: filename,
          file_size: binaryData.length,
          archival_document_id: document.id
        });

        // Create entity suggestions for text files only
        if (shouldProcessContent && text.length > 50) {
          console.log(`Checking for entity suggestions in ${filename}...`);
          
          // Extract potential entity names (simple pattern matching)
          const potentialEntities = new Set<string>();
          
          // Look for capitalized phrases (potential names/organizations)
          const capitalizedPattern = /\b[A-Z][a-z]+(?: [A-Z][a-z]+){0,3}\b/g;
          const matches = text.match(capitalizedPattern) || [];
          matches.slice(0, 10).forEach(match => {
            if (match.length > 3 && match.length < 50) {
              potentialEntities.add(match);
            }
          });

          // Create entity suggestions
          for (const entityName of potentialEntities) {
            const { data: existing } = await supabase
              .from('entities')
              .select('id, name')
              .ilike('name', entityName)
              .maybeSingle();

            if (!existing) {
              const { data: suggestion, error: suggestionError } = await supabase
                .from('entity_suggestions')
                .insert({
                  source_id: document.id,
                  source_type: 'archival_document',
                  suggested_name: entityName,
                  suggested_type: 'person',
                  confidence: 0.6,
                  context: `Found in archival document: ${filename}`,
                  status: 'pending'
                })
                .select()
                .single();

              if (suggestion) {
                entitySuggestions.push({
                  name: entityName,
                  documentId: document.id,
                  suggestionId: suggestion.id
                });
              }
            }
          }
        }
        
        results.push({
          filename: filename,
          documentId: document.id,
          entitySuggestions: entitySuggestions.length,
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

    console.log(`Batch complete: ${results.length} succeeded, ${errors.length} failed, ${entitySuggestions.length} entity suggestions created`);

    return new Response(
      JSON.stringify({ 
        success: true,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors,
        entitySuggestions: entitySuggestions
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
