import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import pdfParse from "https://esm.sh/pdf-parse@1.1.1";
import { createHash } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 4000; // characters per chunk
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceType, sourceData, sourceId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing ${sourceType} ingestion`);

    let extractedText = '';
    let title = 'Untitled Document';
    let metadata: any = {};

    // Extract content based on source type
    switch (sourceType) {
      case 'url':
        const url = sourceData.url;
        title = url;
        
        try {
          const response = await fetch(url);
          const html = await response.text();
          
          // Basic HTML text extraction (strip tags)
          extractedText = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          metadata = { url, fetch_date: new Date().toISOString() };
        } catch (error: any) {
          throw new Error(`Failed to fetch URL: ${error?.message || 'Unknown error'}`);
        }
        break;

      case 'text':
        extractedText = sourceData.text;
        title = sourceData.title || 'Manual Text Entry';
        metadata = { source: 'manual_entry' };
        break;

      case 'file':
        const { fileData, fileName, fileType } = sourceData;
        title = fileName;
        metadata = { fileName, fileType, size: fileData.length };

        // Decode base64 file
        const binaryData = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));

        if (fileType === 'application/pdf') {
          try {
            const pdfData = await pdfParse(binaryData);
            extractedText = pdfData.text;
            metadata.pages = pdfData.numpages;
          } catch (error: any) {
            throw new Error(`PDF parsing failed: ${error?.message || 'Unknown error'}`);
          }
        } else if (fileType.includes('text') || fileType.includes('document')) {
          const decoder = new TextDecoder();
          extractedText = decoder.decode(binaryData);
        } else {
          throw new Error(`Unsupported file type: ${fileType}`);
        }
        break;

      default:
        throw new Error(`Unknown source type: ${sourceType}`);
    }

    if (!extractedText || extractedText.length < 10) {
      throw new Error('Insufficient text extracted from source');
    }

    // Calculate content hash
    const contentHash = createHash('sha256').update(extractedText).digest('hex');

    // Check for duplicate
    const { data: existingDoc } = await supabase
      .from('ingested_documents')
      .select('id')
      .eq('content_hash', contentHash)
      .single();

    if (existingDoc) {
      return new Response(
        JSON.stringify({ 
          success: true,
          duplicate: true,
          documentId: existingDoc.id,
          message: 'Document already exists'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine if chunking is needed
    const needsChunking = extractedText.length > CHUNK_SIZE;
    const chunks: string[] = [];

    if (needsChunking) {
      // Split into chunks
      for (let i = 0; i < extractedText.length; i += CHUNK_SIZE) {
        chunks.push(extractedText.substring(i, i + CHUNK_SIZE));
      }
      console.log(`Document split into ${chunks.length} chunks`);
    } else {
      chunks.push(extractedText);
    }

    // Create parent document
    const { data: parentDoc, error: parentError } = await supabase
      .from('ingested_documents')
      .insert({
        source_id: sourceId,
        title,
        raw_text: chunks[0], // Store first chunk in parent
        content_hash: contentHash,
        metadata,
        chunk_index: 0,
        total_chunks: chunks.length,
        processing_status: 'pending'
      })
      .select()
      .single();

    if (parentError) throw parentError;

    // Create child chunks if needed
    const chunkIds = [parentDoc.id];
    
    if (chunks.length > 1) {
      const childChunks = chunks.slice(1).map((chunkText, index) => ({
        source_id: sourceId,
        title: `${title} (Part ${index + 2})`,
        raw_text: chunkText,
        content_hash: contentHash,
        metadata: { ...metadata, is_chunk: true },
        chunk_index: index + 1,
        total_chunks: chunks.length,
        parent_document_id: parentDoc.id,
        processing_status: 'pending'
      }));

      const { data: insertedChunks, error: chunksError } = await supabase
        .from('ingested_documents')
        .insert(childChunks)
        .select('id');

      if (chunksError) {
        console.error('Error creating chunks:', chunksError);
      } else {
        chunkIds.push(...insertedChunks.map(c => c.id));
      }
    }

    // Trigger processing for each chunk
    for (const documentId of chunkIds) {
      await supabase.functions.invoke('process-intelligence-document', {
        body: { documentId }
      });
    }

    console.log(`Successfully ingested document: ${parentDoc.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: parentDoc.id,
        chunks: chunkIds.length,
        message: `Document ingested successfully with ${chunkIds.length} chunk(s)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ingest-intelligence:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});