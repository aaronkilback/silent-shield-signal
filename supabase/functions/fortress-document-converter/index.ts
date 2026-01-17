import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

// pdf.js requires a workerSrc to be configured in some builds even when disableWorker=true.
// In edge runtimes, dynamically importing an external worker URL can fail unless it's in the module graph.
// We import the worker above (so it's bundled) and reference the same URL here.
try {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
} catch (_err) {
  // non-fatal
}
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

// Size thresholds
const MAX_FILE_SIZE_MB = 100; // Increased to support large PDFs via signed URLs
const MAX_MEMORY_LOAD_MB = 20; // Files larger than this use signed URL approach
const RESIZE_THRESHOLD_MB = 5;
const TARGET_RESIZE_MB = 2;

// Safe base64 encoding that handles large buffers
function safeBase64Encode(buffer: ArrayBuffer): string {
  return base64Encode(buffer);
}

type ConversionResult = {
  success: boolean;
  documentId: string;
  extractedTextLength?: number;
  extractedText?: string;
  resizedImage?: string; // Base64 of resized image if applicable
  originalSizeMB?: number;
  resizedSizeMB?: number;
  message?: string;
  error?: string;
  details?: string;
};

interface ConversionRequest {
  documentId: string;
  filePath?: string;
  mimeType: string;
  directFileContentBase64?: string;
  targetTable?: 'archival_documents' | 'ingested_documents';
  updateDatabase?: boolean;
  // Resize options
  resizeIfLarge?: boolean;
  maxWidthPx?: number;
  maxHeightPx?: number;
  targetSizeMB?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  quality?: number; // 0-100 for jpeg/webp
  // Extract text option
  extractText?: boolean;
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
    // Normalize: storage paths are stored unescaped; callers sometimes pass URL-escaped paths.
    const normalized = filePath.includes('%') ? decodeURIComponent(filePath) : filePath;

    const pathParts = normalized.split('/');
    const bucketName = pathParts[0];
    const objectPath = pathParts.slice(1).join('/');

    const tryDownload = async (bucket: string, path: string) => {
      console.log(`Retrieving file from bucket: ${bucket}, path: ${path}`);
      return await supabase.storage.from(bucket).download(path);
    };

    // 1) First attempt: assume caller provided bucket/object
    let { data, error } = await tryDownload(bucketName, objectPath);

    // 2) If it fails, caller may have provided only an object key (no bucket), e.g. "<uuid>/<file>.pdf".
    // In that case, we try the known buckets (storage doesn't expose storage.objects via PostgREST here).
    if (error) {
      console.error('Storage download error:', error);

      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bucketName);
      if (looksLikeUuid) {
        const candidateBuckets = [
          'ai-chat-attachments',
          'archival-documents',
          'investigation-files',
          'travel-documents',
          'bug-screenshots',
          'entity-photos',
          'agent-avatars',
        ];

        for (const b of candidateBuckets) {
          const retry = await tryDownload(b, normalized);
          if (!retry.error && retry.data) {
            data = retry.data;
            error = retry.error;
            break;
          }
        }
      }
    }

    if (error) {
      console.error('Storage download error (final):', error);
      return { data: null, error: (error as any)?.message ?? String(error) };
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

// Extract text from PDFs using pdf.js (no vision; works for large PDFs with embedded text)
async function extractTextFromPdf(content: Blob): Promise<{ text: string; error?: string }> {
  try {
    const arrayBuffer = await content.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // pdf.js in an edge runtime: disable workers and parse in-process
    const pdf = await (pdfjsLib as any).getDocument({ data: uint8, disableWorker: true }).promise;
    const totalPages = Number(pdf?.numPages || 0);

    // Safety cap to avoid very long runs; adjust if needed.
    const maxPages = Math.min(totalPages, 200);

    const out: string[] = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = (textContent?.items ?? [])
        .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
        .filter((s: string) => s.trim().length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) out.push(pageText);
      if (pageNum < maxPages) out.push('--- Page Break ---');
    }

    const text = out.join('\n');

    if (text.trim().length < 50) {
      return {
        text: '',
        error: 'No extractable text found in this PDF (it may be scanned/image-only).',
      };
    }

    console.log(`PDF.js extracted ${text.length} characters from ${maxPages}/${totalPages} pages`);
    return { text };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('PDF extraction (pdf.js) error:', err);
    return { text: '', error: `PDF extraction failed: ${errorMessage}` };
  }
}

// Resize image using Lovable AI image generation model
async function resizeImageWithAI(
  content: Blob,
  mimeType: string,
  options: {
    maxWidthPx?: number;
    maxHeightPx?: number;
    targetSizeMB?: number;
    outputFormat?: 'jpeg' | 'png' | 'webp';
    quality?: number;
  }
): Promise<{ resizedBase64: string; newSizeMB: number; error?: string }> {
  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      return { resizedBase64: '', newSizeMB: 0, error: 'LOVABLE_API_KEY not configured' };
    }

    const arrayBuffer = await content.arrayBuffer();
    const originalSizeBytes = arrayBuffer.byteLength;
    const originalSizeMB = originalSizeBytes / (1024 * 1024);
    
    // Safe base64 encoding
    const base64Content = safeBase64Encode(arrayBuffer);
    
    // Calculate target dimensions based on size reduction needed
    const targetSizeMB = options.targetSizeMB || TARGET_RESIZE_MB;
    const reductionRatio = Math.sqrt(targetSizeMB / originalSizeMB);
    
    const maxWidth = options.maxWidthPx || Math.round(1920 * reductionRatio);
    const maxHeight = options.maxHeightPx || Math.round(1080 * reductionRatio);
    const quality = options.quality || 85;
    const outputFormat = options.outputFormat || 'jpeg';

    console.log(`Resizing image: ${originalSizeMB.toFixed(2)}MB -> target ${targetSizeMB}MB, max ${maxWidth}x${maxHeight}`);

    // Use Lovable AI to resize/optimize the image
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Resize this image to fit within ${maxWidth}x${maxHeight} pixels while maintaining aspect ratio. 
Output as a high-quality ${outputFormat.toUpperCase()} image optimized for web viewing.
Preserve the image content exactly - do not add, remove, or modify any elements.
Just resize and optimize for smaller file size.`
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
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Image resize API error:', errorText);
      return { resizedBase64: '', newSizeMB: 0, error: `Image resize failed: ${response.status}` };
    }

    const result = await response.json();
    const resizedImageUrl = result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (!resizedImageUrl) {
      // Fallback: return original if resize didn't produce an image
      console.warn('No resized image returned, using original');
      return { 
        resizedBase64: base64Content, 
        newSizeMB: originalSizeMB,
        error: 'Resize did not produce output, returning original'
      };
    }

    // Extract base64 from data URL
    const base64Match = resizedImageUrl.match(/^data:image\/\w+;base64,(.+)$/);
    const resizedBase64 = base64Match ? base64Match[1] : resizedImageUrl;
    
    // Calculate new size
    const newSizeBytes = (resizedBase64.length * 3) / 4; // Approximate decoded size
    const newSizeMB = newSizeBytes / (1024 * 1024);
    
    console.log(`Image resized: ${originalSizeMB.toFixed(2)}MB -> ${newSizeMB.toFixed(2)}MB`);
    
    return { resizedBase64, newSizeMB };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Image resize error:', err);
    return { resizedBase64: '', newSizeMB: 0, error: `Image resize failed: ${errorMessage}` };
  }
}

// Simple quality reduction for images (no AI needed)
async function compressImageSimple(
  content: Blob,
  mimeType: string,
  targetSizeMB: number = 2
): Promise<{ compressedBase64: string; newSizeMB: number }> {
  const arrayBuffer = await content.arrayBuffer();
  const originalSizeMB = arrayBuffer.byteLength / (1024 * 1024);
  
  // If already small enough, return as-is
  if (originalSizeMB <= targetSizeMB) {
    const base64 = safeBase64Encode(arrayBuffer);
    return { compressedBase64: base64, newSizeMB: originalSizeMB };
  }
  
  // For larger files, we need AI-based resize
  const result = await resizeImageWithAI(content, mimeType, { targetSizeMB });
  return { compressedBase64: result.resizedBase64, newSizeMB: result.newSizeMB };
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
    
    // Check file size - if too large, return error with guidance
    const fileSizeMB = arrayBuffer.byteLength / (1024 * 1024);
    if (fileSizeMB > 10) {
      return { text: '', error: `File too large for vision processing (${fileSizeMB.toFixed(1)}MB). Consider processing pages individually.` };
    }
    
    // Safe base64 encoding
    const base64Content = safeBase64Encode(arrayBuffer);
    
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

// Extract text from large PDFs using signed URLs with Gemini
async function extractTextFromLargePdfWithSignedUrl(
  supabase: ReturnType<typeof getSupabaseClient>,
  filePath: string,
  mimeType: string
): Promise<{ text: string; error?: string }> {
  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return { text: '', error: 'LOVABLE_API_KEY not configured' };
    }

    console.log(`Processing large PDF via signed URL: ${filePath}`);

    // Parse bucket and path
    const pathParts = filePath.split('/');
    const bucketName = pathParts[0];
    const objectPath = pathParts.slice(1).join('/');

    // Try to create signed URL from the provided bucket
    let signedUrl: string | null = null;
    
    const { data: urlData, error: urlError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(objectPath, 3600); // 1 hour expiry

    if (!urlError && urlData?.signedUrl) {
      signedUrl = urlData.signedUrl;
      console.log(`Created signed URL from bucket: ${bucketName}`);
    } else {
      // Try alternative buckets if the path might be just the object name
      const candidateBuckets = [
        'ai-chat-attachments',
        'archival-documents',
        'investigation-files',
        'travel-documents',
      ];

      for (const bucket of candidateBuckets) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(filePath, 3600);
        
        if (!error && data?.signedUrl) {
          signedUrl = data.signedUrl;
          console.log(`Created signed URL from fallback bucket: ${bucket}`);
          break;
        }
      }
    }

    if (!signedUrl) {
      return { text: '', error: `Could not create signed URL for ${filePath}` };
    }

    // Use Gemini with the signed URL to extract text
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
                text: `You are a document text extraction specialist. Extract ALL text content from this PDF document.

Instructions:
- Extract every piece of readable text, including headers, footers, tables, and captions
- Preserve the logical reading order and structure
- For tables, use markdown table format
- Include any metadata visible (dates, document numbers, page numbers, etc.)
- Note page breaks with "--- Page Break ---" between pages
- Extract text from ALL pages in the document
- Do NOT add any commentary or analysis - only extract the raw text

Return ONLY the extracted text content, nothing else.`
              },
              {
                type: 'file',
                file: {
                  url: signedUrl,
                  mime_type: mimeType
                }
              }
            ]
          }
        ],
        max_tokens: 100000,
        temperature: 0
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini signed URL extraction error:', response.status, errorText);
      return { text: '', error: `AI extraction failed: ${response.status}` };
    }

    const result = await response.json();
    const extractedText = result.choices?.[0]?.message?.content || '';
    
    console.log(`Signed URL extraction complete: ${extractedText.length} characters`);
    return { text: extractedText };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Large PDF extraction error:', err);
    return { text: '', error: `Large PDF extraction failed: ${errorMessage}` };
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
      return await extractTextFromPdf(content);

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
    const isPdf = request.mimeType === 'application/pdf';
    
    // For PDFs from storage, check if we should use signed URL approach
    // This avoids downloading large files into memory
    if (isPdf && request.filePath && !request.directFileContentBase64 && request.extractText !== false) {
      // Try to get file metadata to check size without downloading
      const pathParts = request.filePath.split('/');
      const bucketName = pathParts[0];
      const objectPath = pathParts.slice(1).join('/');
      
      // Check file size via storage API metadata
      let fileSize = 0;
      const candidateBuckets = [
        bucketName,
        'ai-chat-attachments',
        'archival-documents',
        'investigation-files',
        'travel-documents',
      ];
      
      let foundBucket = '';
      let foundPath = '';
      
      for (const bucket of candidateBuckets) {
        const checkPath = bucket === bucketName ? objectPath : request.filePath;
        const { data: files } = await supabase.storage.from(bucket).list(
          checkPath.split('/').slice(0, -1).join('/') || '',
          { search: checkPath.split('/').pop() || '' }
        );
        
        const file = files?.find(f => checkPath.endsWith(f.name));
        if (file?.metadata?.size) {
          fileSize = file.metadata.size;
          foundBucket = bucket;
          foundPath = checkPath;
          break;
        }
      }
      
      const fileSizeMB = fileSize / (1024 * 1024);
      console.log(`PDF file size check: ${fileSizeMB.toFixed(2)} MB`);
      
      // Use signed URL approach for PDFs larger than memory threshold
      if (fileSizeMB > MAX_MEMORY_LOAD_MB || fileSizeMB === 0) {
        console.log(`Large PDF detected (${fileSizeMB.toFixed(2)} MB > ${MAX_MEMORY_LOAD_MB} MB), using signed URL approach`);
        
        const fullPath = foundBucket ? `${foundBucket}/${foundPath}` : request.filePath;
        const { text: extractedText, error: extractError } = await extractTextFromLargePdfWithSignedUrl(
          supabase,
          fullPath,
          request.mimeType
        );
        
        if (extractError && !extractedText) {
          console.error(`Large PDF extraction failed: ${extractError}`);
          
          // Update database with error if requested
          if (request.updateDatabase !== false) {
            await updateDocumentRecord(
              supabase,
              request.documentId,
              '',
              request.targetTable || 'archival_documents',
              extractError
            );
          }
          
          return new Response(
            JSON.stringify({
              success: false,
              documentId: request.documentId,
              error: 'Large PDF extraction failed',
              details: extractError,
              originalSizeMB: fileSizeMB
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
        console.log(`Large PDF processed via signed URL in ${processingTime}ms, extracted ${extractedText.length} characters`);
        
        return new Response(
          JSON.stringify({
            success: true,
            documentId: request.documentId,
            extractedTextLength: extractedText.length,
            extractedText: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''),
            originalSizeMB: fileSizeMB,
            message: `Large PDF processed via signed URL in ${processingTime}ms`
          } as ConversionResult),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Standard flow for smaller files or non-PDFs
    let fileContent: Blob;
    let originalSizeMB = 0;

    // Get file content
    if (request.directFileContentBase64) {
      // Decode base64 content
      const binaryString = atob(request.directFileContentBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileContent = new Blob([bytes], { type: request.mimeType });
      originalSizeMB = fileContent.size / (1024 * 1024);
      console.log(`Using direct base64 content, size: ${originalSizeMB.toFixed(2)} MB`);
    } else if (request.filePath) {
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
      originalSizeMB = fileContent.size / (1024 * 1024);
      console.log(`Retrieved file from storage, size: ${originalSizeMB.toFixed(2)} MB`);
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: 'No file content provided',
          details: 'Either filePath or directFileContentBase64 must be provided'
        } as ConversionResult),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if file is too large for memory processing
    if (originalSizeMB > MAX_FILE_SIZE_MB) {
      return new Response(
        JSON.stringify({
          success: false,
          documentId: request.documentId,
          error: `File too large: ${originalSizeMB.toFixed(2)} MB exceeds ${MAX_FILE_SIZE_MB} MB limit`,
          originalSizeMB
        } as ConversionResult),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle image resize if requested or if file is large
    const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff'].includes(request.mimeType);
    let resizedImageBase64: string | undefined;
    let resizedSizeMB: number | undefined;

    if (isImage && (request.resizeIfLarge || originalSizeMB > RESIZE_THRESHOLD_MB)) {
      console.log(`Image resize triggered: resizeIfLarge=${request.resizeIfLarge}, size=${originalSizeMB.toFixed(2)}MB`);
      
      const resizeResult = await resizeImageWithAI(fileContent, request.mimeType, {
        maxWidthPx: request.maxWidthPx,
        maxHeightPx: request.maxHeightPx,
        targetSizeMB: request.targetSizeMB || TARGET_RESIZE_MB,
        outputFormat: request.outputFormat,
        quality: request.quality
      });

      if (resizeResult.resizedBase64 && !resizeResult.error) {
        resizedImageBase64 = resizeResult.resizedBase64;
        resizedSizeMB = resizeResult.newSizeMB;
        
        // If only resizing was requested (no text extraction), return early
        if (request.extractText === false) {
          const processingTime = Date.now() - startTime;
          return new Response(
            JSON.stringify({
              success: true,
              documentId: request.documentId,
              resizedImage: `data:${request.outputFormat || 'image/jpeg'};base64,${resizedImageBase64}`,
              originalSizeMB,
              resizedSizeMB,
              message: `Image resized successfully in ${processingTime}ms`
            } as ConversionResult),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (resizeResult.error) {
        console.warn(`Resize failed: ${resizeResult.error}, proceeding with original`);
      }
    }

    // Skip text extraction if explicitly disabled
    if (request.extractText === false) {
      const processingTime = Date.now() - startTime;
      return new Response(
        JSON.stringify({
          success: true,
          documentId: request.documentId,
          originalSizeMB,
          message: `File processed in ${processingTime}ms (text extraction skipped)`
        } as ConversionResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert document (extract text)
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

    const result: ConversionResult = {
      success: true,
      documentId: request.documentId,
      extractedTextLength: extractedText.length,
      extractedText: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''),
      originalSizeMB,
      message: `Document converted successfully in ${processingTime}ms`
    };

    // Include resized image info if applicable
    if (resizedImageBase64) {
      result.resizedImage = `data:${request.outputFormat || 'image/jpeg'};base64,${resizedImageBase64}`;
      result.resizedSizeMB = resizedSizeMB;
    }

    return new Response(
      JSON.stringify(result),
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
