import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { files, tags, clientId, userId } = await req.json();
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return errorResponse('Files array is required', 400);
    }

    console.log(`Processing ${files.length} archival documents`);

    const supabase = createServiceClient();

    const results = [];
    const errors = [];

    for (const fileData of files) {
      try {
        const { file, filename, mimeType, dateOfDocument } = fileData;
        
        console.log(`Processing: ${filename}`);

        // Size check - reject files over 1.5MB
        const estimatedSize = file.length * 0.75;
        const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
        
        if (estimatedSize > 1.5 * 1024 * 1024) {
          console.error(`File ${filename} is ${sizeMB}MB - exceeds 1.5MB limit`);
          throw new Error(`File too large (${sizeMB}MB). Maximum 1.5MB per file.`);
        }
        
        const sizeKB = (estimatedSize / 1024).toFixed(1);
        console.log(`File size: ${sizeKB} KB - proceeding with upload`);

        console.log(`Processing content for ${filename}`);
        const binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));

        let text = '';
        let cleanSummary = '';
        let keywords: string[] = [];

        if (mimeType === 'text/plain' || filename.endsWith('.txt')) {
          const maxBytes = Math.min(binaryData.length, 20000);
          text = new TextDecoder().decode(binaryData.slice(0, maxBytes));
          cleanSummary = text.substring(0, 150).trim();
          
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

        // Generate simple content hash from metadata
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
            entity_mentions: [],
            keywords: keywords,
            summary: cleanSummary,
            metadata: {
              original_filename: filename,
              upload_timestamp: new Date().toISOString(),
              size_kb: sizeKB
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

        console.log(`Document ${filename} saved - entity processing will happen in background`);
        
        results.push({
          filename: filename,
          documentId: document.id,
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

    return successResponse({ 
      success: true,
      processed: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    });
  } catch (error) {
    console.error('Error in process-archival-documents function:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
