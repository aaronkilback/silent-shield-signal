import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Access EdgeRuntime from global scope for background tasks
// (In some runtimes this may be undefined, so we guard usage.)
declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filename, storagePath, fileSize, mimeType, tags, clientId, userId, dateOfDocument } = await req.json();
    
    if (!filename || !storagePath || !fileSize) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Creating archival record for: ${filename}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const sizeKB = (fileSize / 1024).toFixed(1);
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    const dateInfo = dateOfDocument ? ` from ${new Date(dateOfDocument).toLocaleDateString()}` : '';
    const fileType = mimeType?.split('/')[1]?.toUpperCase() || 'Document';
    
    // Generate simple content hash from metadata
    const hashInput = `${filename}-${sizeKB}-${mimeType}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(hashInput));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Check for duplicates
    const { data: existingHash } = await supabase
      .from('document_hashes')
      .select('filename')
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (existingHash) {
      return new Response(
        JSON.stringify({ 
          error: `Duplicate of ${existingHash.filename} (already uploaded)`,
          isDuplicate: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create metadata text and summary for large files
    const text = `${fileType}: ${filename}${dateInfo}\nSize: ${sizeKB} KB (${sizeMB} MB)\nDirect upload - content not processed`;
    const cleanSummary = `${fileType}${dateInfo} - ${sizeMB} MB`;

    // Insert into archival_documents table
    const { data: document, error: insertError } = await supabase
      .from('archival_documents')
      .insert({
        filename: filename,
        file_type: mimeType || 'application/octet-stream',
        file_size: fileSize,
        storage_path: storagePath,
        content_text: text,
        content_hash: contentHash,
        tags: tags || ['archival', 'large-file'],
        client_id: clientId || null,
        uploaded_by: userId || null,
        date_of_document: dateOfDocument || null,
        is_archival: true,
        entity_mentions: [],
        keywords: [],
        summary: cleanSummary,
        metadata: {
          original_filename: filename,
          upload_timestamp: new Date().toISOString(),
          size_mb: sizeMB,
          direct_upload: true,
          processed: false
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error(`Database insert error:`, insertError);
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // Record document hash
    await supabase.from('document_hashes').insert({
      content_hash: contentHash,
      filename: filename,
      file_size: fileSize,
      archival_document_id: document.id
    });

    console.log(`Successfully created record for: ${filename}`);

    // Trigger entity processing in background (don't await)
    const processEntities = async () => {
      try {
        console.log(`Starting background entity processing for: ${document.id}`);
        
        const response = await fetch(`${supabaseUrl}/functions/v1/process-stored-document`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ documentId: document.id })
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`Entity processing failed for ${document.id}:`, error);
        } else {
          const result = await response.json();
          console.log(`Entity processing complete for ${document.id}:`, result);
        }
      } catch (error) {
        console.error(`Error in background entity processing for ${document.id}:`, error);
      }
    };

    // Use EdgeRuntime.waitUntil when available to keep the background task alive.
    try {
      if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime?.waitUntil === 'function') {
        EdgeRuntime.waitUntil(processEntities());
      } else {
        processEntities();
      }
    } catch {
      processEntities();
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        documentId: document.id,
        filename: filename
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-archival-record function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
