import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file, filename, mimeType, location } = await req.json();
    
    if (!file || !filename) {
      return new Response(
        JSON.stringify({ error: 'File and filename are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing document:', filename, mimeType);

    // Decode base64 file
    const binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    let text = '';

    // Handle different file types
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown' || filename.endsWith('.txt') || filename.endsWith('.csv') || filename.endsWith('.md')) {
      // Plain text files - decode directly
      text = new TextDecoder().decode(binaryData);
    } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      // For PDFs, we'll extract basic text
      // Note: This is a simplified extraction. For better results, consider using a PDF parsing library
      const pdfText = new TextDecoder().decode(binaryData);
      // Try to extract readable text from PDF (basic approach)
      text = pdfText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        text = `PDF document uploaded: ${filename}. Content extraction limited. Please review manually.`;
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      // DOCX files - basic text extraction
      const docxText = new TextDecoder().decode(binaryData);
      text = docxText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        text = `DOCX document uploaded: ${filename}. Content extraction limited. Please review manually.`;
      }
    } else {
      // Unknown file type
      text = `Document uploaded: ${filename}. File type: ${mimeType}. Please review manually.`;
    }

    console.log('Extracted text length:', text.length);

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Ingest the document content as a signal
    const { data, error } = await supabase.functions.invoke('ingest-signal', {
      body: {
        text: text,
        location: location,
        raw_json: {
          source: 'document_upload',
          filename: filename,
          mimeType: mimeType,
        }
      }
    });

    if (error) {
      console.error('Error ingesting signal:', error);
      throw error;
    }

    console.log('Document processed successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Document processed and ingested' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in parse-document function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
