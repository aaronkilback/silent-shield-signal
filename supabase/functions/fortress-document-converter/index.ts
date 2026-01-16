import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supported MIME types and their handlers
const SUPPORTED_MIME_TYPES = {
  // PDF types
  'application/pdf': 'pdf',
  // DOCX types
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  // Plain text types
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  // Image types (for OCR)
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/tiff': 'image',
} as const;

type ConversionResult = {
  success: boolean;
  documentId: string;
  extractedTextLength?: number;
  extractedText?: string;
  message?: string;
  error?: string;
  details?: string;
};

interface ConversionRequest {
  documentId: string;
  filePath: string;
  mimeType: string;
  directFileContentBase64?: string;
  targetTable?: 'archival_documents' | 'ingested_documents';
  updateDatabase?: boolean;
}

// Initialize Supabase client
function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseKey);
}

// Generate SHA-256 hash of text
async function generateTextHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Retrieve file from Supabase Storage
async function getFileFromStorage(
  supabase: ReturnType<typeof getSupabaseClient>,
  filePath: string
): Promise<{ data: Blob | null; error: string | null }> {
  try {
    // Parse bucket and path
    const pathParts = filePath.split('/');
    const bucketName = pathParts[0];
    const objectPath = pathParts.slice(1).join('/');

    console.log(`Retrieving file from bucket: ${bucketName}, path: ${objectPath}`);

    const { data, error } = await supabase.storage
      .from(bucketName)
      .download(objectPath);

    if (error) {
      console.error('Storage download error:', error);
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('File retrieval error:', err);
    return { data: null, error: `Failed to retrieve file: ${errorMessage}` };
  }
}

// Extract text from plain text files
async function extractTextFromPlainText(content: Blob): Promise<string> {
  return await content.text();
}

// Extract text using Lovable AI Vision (for PDFs and images)
async function extractTextWithVisionAI(
  content: Blob,
  mimeType: string,
  filename?: string
): Promise<{ text: string; error?: string }> {
  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      return { text: '', error: 'LOVABLE_API_KEY not configured' };
    }

    // Convert blob to base64
    const arrayBuffer = await content.arrayBuffer();
    const base64Content = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );
    
    // Use Lovable AI with vision capabilities
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are a document text extraction specialist. Extract ALL text content from this document image/file. 
                
Instructions:
- Extract every piece of readable text, including headers, footers, tables, and captions
- Preserve the logical reading order and structure
- For tables, use markdown table format
- Include any metadata visible (dates, document numbers, etc.)
- If the document is multi-page, note page breaks with "--- Page Break ---"
- Do NOT add any commentary or analysis - only extract the raw text

Return ONLY the extracted text content, nothing else.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Content}`
                }
              }
            ]
          }
        ],
        max_tokens: 16000,
        temperature: 0
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Vision AI error:', errorText);
      return { text: '', error: `Vision AI request failed: ${response.status}` };
    }

    const result = await response.json();
    const extractedText = result.choices?.[0]?.message?.content || '';
    
    console.log(`Vision AI extracted ${extractedText.length} characters`);
    return { text: extractedText };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Vision AI extraction error:', err);
    return { text: '', error: `Vision extraction failed: ${errorMessage}` };
  }
}

// Extract text from DOCX files
async function extractTextFromDocx(content: Blob): Promise<{ text: string; error?: string }> {
  try {
    // DOCX is a ZIP file containing XML
    // We'll extract the document.xml which contains the main content
    
    const arrayBuffer = await content.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Use JSZip-like approach or parse manually
    // For now, we'll use Lovable AI to extract from the raw content
    // This is more reliable than parsing DOCX XML manually
    
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      // Fallback: try to extract any readable text from the binary
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = textDecoder.decode(uint8Array);
      
      // Extract text between XML tags (crude but works for simple docs)
      const textMatches = rawText.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const extractedText = textMatches
        .map(match => match.replace(/<[^>]+>/g, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (extractedText.length > 50) {
        return { text: extractedText };
      }
      
      return { text: '', error: 'LOVABLE_API_KEY not configured and fallback extraction failed' };
    }

    // Convert to base64 and use AI
    const base64Content = btoa(String.fromCharCode(...uint8Array));
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all text content from this DOCX document. 
Preserve structure, headings, lists, and tables (use markdown format for tables).
Return ONLY the extracted text, no commentary.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Content}`
                }
              }
            ]
          }
        ],
        max_tokens: 16000,
        temperature: 0
      }),
    });

    if (!response.ok) {
      // Fallback to XML extraction
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = textDecoder.decode(uint8Array);
      const textMatches = rawText.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const extractedText = textMatches
        .map(match => match.replace(/<[^>]+>/g, ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      return { text: extractedText || '', error: 'AI extraction failed, used fallback' };
    }

    const result = await response.json();
    return { text: result.choices?.[0]?.message?.content || '' };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('DOCX extraction error:', err);
    return { text: '', error: `DOCX extraction failed: ${errorMessage}` };
  }
}

// Main conversion dispatcher
async function convertDocument(
  content: Blob,
  mimeType: string,
  filename?: string
): Promise<{ text: string; error?: string }> {
  const handler = SUPPORTED_MIME_TYPES[mimeType as keyof typeof SUPPORTED_MIME_TYPES];
  
  console.log(`Converting document with MIME type: ${mimeType}, handler: ${handler}`);
  
  switch (handler) {
    case 'text':
      return { text: await extractTextFromPlainText(content) };
    
    case 'pdf':
    case 'image':
      return await extractTextWithVisionAI(content, mimeType, filename);
    
    case 'docx':
    case 'doc':
      return await extractTextFromDocx(content);
    
    default:
      return { text: '', error: `Unsupported MIME type: ${mimeType}` };
  }
}

// Update document in database
async function updateDocumentRecord(
  supabase: ReturnType<typeof getSupabaseClient>,
  documentId: string,
  extractedText: string,
  targetTable: string,
  error?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const now = new Date().toISOString();
    const textHash = extractedText ? await generateTextHash(extractedText) : null;
    
    if (targetTable === 'archival_documents') {
      const { error: updateError } = await supabase
        .from('archival_documents')
        .update({
          content_text: extractedText || null,
          content_hash: textHash,
          updated_at: now,
          metadata: error ? { processing_error: error, last_processed_at: now } : { last_processed_at: now }
        })
        .eq('id', documentId);
      
      if (updateError) {
        console.error('Database update error:', updateError);
        return { success: false, error: updateError.message };
      }
    } else if (targetTable === 'ingested_documents') {
      const { error: updateError } = await supabase
        .from('ingested_documents')
        .update({
          raw_text: extractedText || null,
          content_hash: textHash,
          processed_at: now,
          processing_status: error ? 'failed' : 'processed',
          error_message: error || null
        })
        .eq('id', documentId);
      
      if (updateError) {
        console.error('Database update error:', updateError);
        return { success: false, error: updateError.message };
      }
    }
    
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Database update exception:', err);
    return { success: false, error: errorMessage };
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const request: ConversionRequest = await req.json();
    
    // Validate required fields
    if (!request.documentId) {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: '',
          error: 'Missing required field: documentId'
        } as ConversionResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!request.filePath && !request.directFileContentBase64) {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: 'Missing required field: filePath or directFileContentBase64'
        } as ConversionResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!request.mimeType) {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: 'Missing required field: mimeType'
        } as ConversionResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if MIME type is supported
    if (!(request.mimeType in SUPPORTED_MIME_TYPES)) {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: `Unsupported MIME type: ${request.mimeType}`,
          details: `Supported types: ${Object.keys(SUPPORTED_MIME_TYPES).join(', ')}`
        } as ConversionResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document ${request.documentId} with MIME type ${request.mimeType}`);

    const supabase = getSupabaseClient();
    let fileContent: Blob;

    // Get file content
    if (request.directFileContentBase64) {
      // Decode base64 content
      const binaryString = atob(request.directFileContentBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileContent = new Blob([bytes], { type: request.mimeType });
      console.log(`Using direct base64 content, size: ${fileContent.size} bytes`);
    } else {
      // Retrieve from storage
      const { data, error } = await getFileFromStorage(supabase, request.filePath);
      if (error || !data) {
        return new Response(
          JSON.stringify({
            success: false,
            documentId: request.documentId,
            error: 'Failed to retrieve file from storage',
            details: error || 'File not found'
          } as ConversionResult),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      fileContent = data;
      console.log(`Retrieved file from storage, size: ${fileContent.size} bytes`);
    }

    // Convert document
    const { text: extractedText, error: conversionError } = await convertDocument(
      fileContent,
      request.mimeType,
      request.filePath?.split('/').pop()
    );

    if (conversionError && !extractedText) {
      console.error(`Conversion failed for ${request.documentId}:`, conversionError);
      
      // Update database with error if requested
      if (request.updateDatabase !== false) {
        await updateDocumentRecord(
          supabase,
          request.documentId,
          '',
          request.targetTable || 'archival_documents',
          conversionError
        );
      }
      
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: 'Document conversion failed',
          details: conversionError
        } as ConversionResult),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update database if requested
    if (request.updateDatabase !== false) {
      const { success: dbSuccess, error: dbError } = await updateDocumentRecord(
        supabase,
        request.documentId,
        extractedText,
        request.targetTable || 'archival_documents'
      );

      if (!dbSuccess) {
        console.error(`Database update failed for ${request.documentId}:`, dbError);
        return new Response(
          JSON.stringify({
            success: false,
            documentId: request.documentId,
            error: 'Database update failed',
            details: dbError,
            extractedTextLength: extractedText.length
          } as ConversionResult),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`Successfully processed ${request.documentId} in ${processingTime}ms, extracted ${extractedText.length} characters`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: request.documentId,
        extractedTextLength: extractedText.length,
        extractedText: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''),
        message: `Document converted successfully in ${processingTime}ms`
      } as ConversionResult),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        documentId: '',
        error: 'Internal server error',
        details: errorMessage
      } as ConversionResult),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
