import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function for retrying AI API calls with exponential backoff
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries = 3,
  context = 'AI API'
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Success or client error (don't retry 4xx except 429)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }
      
      // Rate limit or server error - retry
      if (response.status === 429 || response.status >= 500) {
        console.warn(`${context} returned ${response.status}, attempt ${attempt}/${maxRetries}`);
        lastError = new Error(`${context} error: ${response.status}`);
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`${context} attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error(`${context} failed after ${maxRetries} attempts`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Health check endpoint for pipeline tests
    if (body.health_check) {
      return new Response(
        JSON.stringify({ 
          status: 'healthy', 
          function: 'process-stored-document',
          timestamp: new Date().toISOString() 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { documentId } = body;
    
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'Missing documentId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document: ${documentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error('No AI API key configured (GEMINI_API_KEY or OPENAI_API_KEY required)');
    }

    // Get feedback-based learning context
    let learningContext: any = { adjustedThreshold: 0.3, avoidKeywords: [], guidance: '' };
    try {
      const { data: learningData } = await supabase.functions.invoke('adaptive-confidence-adjuster');
      if (learningData) {
        learningContext = learningData;
        console.log(`Using adjusted threshold: ${learningContext.adjustedThreshold}, FP rate: ${learningContext.falsePositiveRate}`);
      }
    } catch (e) {
      console.warn('Could not fetch learning context, using defaults:', e);
    }

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('archival_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error(`Document not found: ${docError?.message}`);
    }

    console.log(`Found document: ${document.filename}`);

    // CRITICAL: Early file size check to prevent memory exhaustion
    // Edge functions have 150MB memory limit - base64 encoding doubles file size
    // Files >10MB will exceed safe memory limits when processed
    const MAX_SAFE_SIZE_MB = 10;
    const fileSizeMB = document.file_size / (1024 * 1024);
    
    if (fileSizeMB > MAX_SAFE_SIZE_MB) {
      console.log(`File too large for in-memory processing: ${fileSizeMB.toFixed(1)}MB > ${MAX_SAFE_SIZE_MB}MB limit`);
      
      // Update document with size-based skip message
      await supabase
        .from('archival_documents')
        .update({
          processing_status: 'completed',
          content_text: document.content_text && document.content_text.length > 100
            ? document.content_text
            : `[Large document: ${document.filename} (${fileSizeMB.toFixed(1)}MB). This file exceeds the ${MAX_SAFE_SIZE_MB}MB processing limit for in-memory analysis. The file is stored and accessible but text extraction was skipped to prevent system resource exhaustion. For full content analysis, please split into smaller files or use external document processing services.]`,
          metadata: {
            ...(document.metadata ?? {}),
            entities_processed: true,
            skipped_reason: 'file_too_large',
            file_size_mb: fileSizeMB.toFixed(1),
            max_safe_size_mb: MAX_SAFE_SIZE_MB,
            processed_at: new Date().toISOString(),
          },
        })
        .eq('id', documentId);

      return new Response(
        JSON.stringify({
          success: true,
          documentId,
          message: `Document too large for in-memory processing (${fileSizeMB.toFixed(1)}MB). Metadata saved.`,
          skipped: true,
          reason: 'file_size_exceeds_limit',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const preferredBucket =
      (document.metadata as any)?.storage_bucket && typeof (document.metadata as any)?.storage_bucket === 'string'
        ? (document.metadata as any).storage_bucket
        : 'archival-documents';

    const candidateBuckets = Array.from(
      new Set([
        preferredBucket,
        // Backward-compat for older AI chat uploads that stored the file in ai-chat-attachments
        'ai-chat-attachments',
        'archival-documents',
      ].filter(Boolean))
    );

    // Download file from storage (try a small set of known buckets)
    let fileData: Blob | null = null;
    let resolvedBucket: string | null = null;
    const bucketErrors: Record<string, string> = {};

    for (const bucket of candidateBuckets) {
      const { data, error } = await supabase.storage.from(bucket).download(document.storage_path);
      if (!error && data) {
        fileData = data;
        resolvedBucket = bucket;
        break;
      }
      bucketErrors[bucket] = error?.message ?? 'Unknown error';
    }

    // If we had to fall back to a different bucket, persist it for future processing
    if (fileData && resolvedBucket && preferredBucket !== resolvedBucket) {
      try {
        await supabase
          .from('archival_documents')
          .update({
            metadata: {
              ...(document.metadata ?? {}),
              storage_bucket: resolvedBucket,
            },
          })
          .eq('id', documentId);
      } catch (e) {
        console.warn('Failed to persist resolved storage bucket (non-fatal):', e);
      }
    }

    if (!fileData) {
      console.error(
        `Storage download error for ${document.filename} (path=${document.storage_path}):`,
        bucketErrors
      );

      // Mark record so agents/users don't see null content_text
      await supabase
        .from('archival_documents')
        .update({
          processing_status: 'failed',
          content_text:
            document.content_text ??
            `[Document processing failed: could not download the file from storage. path=${document.storage_path}]`,
          metadata: {
            ...(document.metadata ?? {}),
            entities_processed: false,
            processing_error: `Failed to download from storage. Tried buckets: ${candidateBuckets.join(', ')}`,
            bucket_errors: bucketErrors,
            processed_at: new Date().toISOString(),
          },
        })
        .eq('id', documentId);

      const notFound = Object.values(bucketErrors).some((m) =>
        String(m).toLowerCase().includes('not found') || String(m).toLowerCase().includes('does not exist')
      );

      if (notFound) {
        return new Response(
          JSON.stringify({
            error: 'File not found in storage',
            documentId,
            storage_path: document.storage_path,
            tried_buckets: candidateBuckets,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Failed to download file from storage. Tried buckets: ${candidateBuckets.join(', ')}`);
    }

    console.log(`Downloaded file: ${document.filename} (bucket=${resolvedBucket})`);

    let textContent = '';
    
    // Extract text based on file type (LIMIT to first 100KB)
    if (document.file_type.includes('text') || document.file_type.includes('json')) {
      const arrayBuffer = await fileData.arrayBuffer();
      const decoder = new TextDecoder();
      // Limit to 100KB
      textContent = decoder.decode(arrayBuffer.slice(0, 100 * 1024));
    } else if (document.file_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
               document.file_type === 'application/msword') {
      // Word documents (.docx, .doc)
      console.log('Extracting text from Word document...');
      
      // For .docx files (ZIP-based Office Open XML)
      // CRITICAL: DOCX is a ZIP file - we MUST read the ENTIRE file to access the central directory
      // Slicing breaks the ZIP structure since the directory is at the END of the file
      if (document.file_type.includes('openxmlformats')) {
        try {
          // Check file size - limit to 25MB to avoid memory issues
          const maxDocxSize = 25 * 1024 * 1024;
          if (fileData.size > maxDocxSize) {
            console.log(
              `DOCX too large (${(fileData.size / 1024 / 1024).toFixed(1)}MB), skipping full extraction`
            );
            textContent = `[Large Word document: ${document.filename} (${(
              fileData.size /
              1024 /
              1024
            ).toFixed(1)}MB). Please use archival upload for full processing.]`;
          } else {
            // Read the ENTIRE file to preserve ZIP structure
            const arrayBuffer = await fileData.arrayBuffer();
            console.log(`Loading DOCX file: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);

            // Import JSZip for unzipping .docx
            const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
            const zip = await JSZip.loadAsync(arrayBuffer);

            // Extract document.xml which contains the text content
            const documentXml = await zip.file('word/document.xml')?.async('string');

            if (documentXml) {
              // Extract text with paragraph preservation
              textContent = documentXml
                // Add newlines before paragraphs
                .replace(/<w:p[^>]*>/g, '\n')
                // Extract text from <w:t> tags
                .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1')
                // Remove all remaining XML tags
                .replace(/<[^>]+>/g, '')
                // Decode common XML entities
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                // Clean up whitespace
                .replace(/\n\s*\n/g, '\n\n')
                .trim()
                .slice(0, 200000); // Allow up to 200K chars for large docs

              console.log(`Extracted ${textContent.length} characters from Word document`);
            } else {
              console.warn('No document.xml found in DOCX');
              textContent = `[Word document: ${document.filename}. Could not extract content - document may be corrupted.]`;
            }
          }
        } catch (error) {
          console.error('Error extracting Word document:', error);
          textContent = `[Word document extraction failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }]`;
        }

        // Some DOCX uploads are effectively scanned documents embedded as images.
        // If we extracted little/no text, fall back to AI-based extraction using a signed URL (or base64 for smaller files).
        if (textContent.length < 50) {
          try {
            console.log('DOCX text extraction produced minimal content; attempting AI-based extraction...');

            const candidateBucketsForDocx = Array.from(
              new Set([
                resolvedBucket,
                (document.metadata as any)?.storage_bucket,
                'ai-chat-attachments',
                'archival-documents',
              ].filter(Boolean))
            ) as string[];

            let signedDocUrl: string | null = null;
            for (const bucket of candidateBucketsForDocx) {
              const { data: signedData, error: signedError } = await supabase.storage
                .from(bucket)
                .createSignedUrl(document.storage_path, 60 * 10);
              if (!signedError && signedData?.signedUrl) {
                signedDocUrl = signedData.signedUrl;
                console.log(`Created signed URL for DOCX from bucket: ${bucket}`);
                break;
              }
            }

            // If signed URL creation fails, fall back to base64 for smaller files.
            const useBase64Fallback = !signedDocUrl && fileData.size <= 20 * 1024 * 1024;
            let docxRef: string | null = signedDocUrl;
            if (useBase64Fallback) {
              const docxBytes = await fileData.arrayBuffer();
              const base64Docx = encodeBase64(new Uint8Array(docxBytes));
              docxRef = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Docx}`;
              console.log(`Sending DOCX as base64 (${(base64Docx.length / 1024 / 1024).toFixed(2)}MB)`);
            }

            if (docxRef) {
              const visionResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${GEMINI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gemini-2.5-flash',
                  messages: [
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: `Extract the full readable text from this Word document (DOCX): "${document.filename}".\n\nIf the pages are images/scans, perform OCR. Preserve headings and paragraph breaks. Return ONLY the extracted text.`,
                        },
                        {
                          type: 'image_url',
                          image_url: { url: docxRef },
                        },
                      ],
                    },
                  ],
                  max_tokens: 8000,
                }),
              });

              if (visionResponse.ok) {
                const visionData = await visionResponse.json();
                const extracted = visionData.choices?.[0]?.message?.content;
                if (typeof extracted === 'string' && extracted.trim().length > 100) {
                  textContent = extracted.trim().slice(0, 200000);
                  console.log(`AI-based DOCX extraction successful: ${textContent.length} characters`);
                } else {
                  console.warn('AI-based DOCX extraction returned minimal content');
                }
              } else {
                const errText = await visionResponse.text();
                console.error(`AI DOCX extraction error ${visionResponse.status}: ${errText}`);
              }
            } else {
              console.warn('Could not create signed URL for DOCX and file too large for base64 fallback');
            }
          } catch (fallbackError) {
            console.error('AI-based DOCX extraction failed:', fallbackError);
          }
        }
      } else {
        // For older .doc files, try basic text extraction (slice is OK for binary .doc)
        const arrayBuffer = await fileData.slice(0, 500 * 1024).arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
        textContent = text
          .replace(/[^\x20-\x7E\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50000);
        console.log(`Extracted ${textContent.length} characters from legacy Word document`);
      }
    } else if (document.file_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
               document.file_type === 'application/vnd.ms-excel') {
      // Excel documents (.xlsx, .xls)
      console.log('Extracting text from Excel document...');
      
      // For .xlsx files (ZIP-based Office Open XML)
      // CRITICAL: XLSX is a ZIP file - we MUST read the ENTIRE file for valid ZIP structure
      if (document.file_type.includes('openxmlformats')) {
        try {
          const maxXlsxSize = 15 * 1024 * 1024; // 15MB limit for Excel
          if (fileData.size > maxXlsxSize) {
            console.log(`XLSX too large (${(fileData.size / 1024 / 1024).toFixed(1)}MB), skipping extraction`);
            textContent = `[Large Excel document: ${document.filename} (${(fileData.size / 1024 / 1024).toFixed(1)}MB). Please use archival upload for full processing.]`;
          } else {
            // Read the ENTIRE file to preserve ZIP structure
            const arrayBuffer = await fileData.arrayBuffer();
            console.log(`Loading XLSX file: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
            
            const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
            const zip = await JSZip.loadAsync(arrayBuffer);
            
            // Extract shared strings (contains cell text values)
            const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
            
            if (sharedStringsXml) {
              // Extract text from shared strings
              const textMatches = sharedStringsXml.match(/<t[^>]*>([^<]*)<\/t>/g);
              if (textMatches) {
                textContent = textMatches
                  .map(match => match.replace(/<[^>]+>/g, ''))
                  .join(' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 100000);
                
                console.log(`Extracted ${textContent.length} characters from Excel document`);
              }
            }
            
            // Also try to extract from worksheet if shared strings is empty
            if (!textContent) {
              const sheet1Xml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
              if (sheet1Xml) {
                const cellMatches = sheet1Xml.match(/<v[^>]*>([^<]*)<\/v>/g);
                if (cellMatches) {
                  textContent = cellMatches
                    .map(match => match.replace(/<[^>]+>/g, ''))
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 100000);
                  
                  console.log(`Extracted ${textContent.length} characters from Excel worksheet`);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error extracting Excel document:', error);
          textContent = `[Excel extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}]`;
        }
      } else {
        // For older .xls files, try basic text extraction (slicing is OK for binary .xls)
        const arrayBuffer = await fileData.slice(0, 500 * 1024).arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
        textContent = text
          .replace(/[^\x20-\x7E\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50000);
        console.log(`Extracted ${textContent.length} characters from legacy Excel document`);
      }
    } else if (document.file_type === 'application/pdf') {
      console.log('Extracting text from PDF...');

      // Primary: AI vision via base64 data URL
      // pdfjs-dist does not work in Deno; signed URLs rejected by gateway for PDFs
      // Gateway requires data:application/pdf;base64,... format
      try {
        const fileSizeMB = document.file_size / (1024 * 1024);
        // Real-world testing: 5MB PDF OOMs. Blob download already uses ~N MB,
        // then arrayBuffer + base64 + JSON.stringify adds ~3.7x N more.
        // Safe threshold: 3MB raw → ~14MB total memory footprint
        const MAX_PDF_MB = 3;

        if (fileSizeMB > MAX_PDF_MB) {
          console.log(`PDF too large for edge function processing (${fileSizeMB.toFixed(1)}MB > ${MAX_PDF_MB}MB limit)`);
          textContent = `[PDF document: ${document.filename} (${fileSizeMB.toFixed(1)}MB). Exceeds processing limit. Content stored for manual review.]`;
        } else {
          console.log(`Processing PDF (${fileSizeMB.toFixed(1)}MB) via AI extraction...`);
          
          // Step 1: Convert blob → base64 string, then release intermediate buffers
          const ab = await fileData.arrayBuffer();
          const pdfBase64 = encodeBase64(new Uint8Array(ab));
          // ab and Uint8Array can now be GC'd (we only need pdfBase64)
          
          console.log(`Sending ${(pdfBase64.length / (1024 * 1024)).toFixed(2)}MB base64 to AI...`);

          // Use only 1 retry to avoid OOM from multiple in-flight requests
          const extractResp = await fetchWithRetry(
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GEMINI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gemini-2.5-flash',
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Extract ALL readable text from this PDF document "${document.filename}".

INSTRUCTIONS:
1. Extract complete text content — do NOT summarize.
2. Preserve structure: headings, paragraphs, tables (use | for columns), bullet points.
3. If pages are scanned images, perform OCR.
4. Mark unclear text with [?].
5. Return ONLY the extracted text, no commentary.`
                    },
                    {
                      type: 'image_url',
                      image_url: { url: `data:application/pdf;base64,${pdfBase64}` }
                    }
                  ]
                }],
                max_tokens: 16000
              }),
            },
            1, // Single attempt — retries double memory usage
            'PDF AI extraction'
          );

          if (extractResp.ok) {
            const extractData = await extractResp.json();
            const extracted = extractData.choices?.[0]?.message?.content?.trim();
            if (extracted && extracted.length > 50) {
              textContent = extracted.slice(0, 200000);
              console.log(`AI PDF extraction successful: ${textContent.length} characters`);
            } else {
              console.warn('AI PDF extraction returned minimal content');
            }
          } else {
            const errText = await extractResp.text();
            console.error(`AI PDF extraction error ${extractResp.status}: ${errText.substring(0, 300)}`);
          }
        }
      } catch (primaryError) {
        console.error('Primary PDF extraction failed:', primaryError);
      }

      // Fallback: lightweight heuristic for small text-based PDFs (1MB cap)
      if (!textContent || textContent.length < 100) {
        try {
          const smallSlice = fileData.size > 1024 * 1024 ? fileData.slice(0, 1024 * 1024) : fileData;
          const arrayBuffer = await smallSlice.arrayBuffer();
          const pdfString = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));

          const textMatches = pdfString.match(/BT(.*?)ET/gs);
          if (textMatches && textMatches.length > 0) {
            let extractedText = '';
            for (const match of textMatches.slice(0, 1500)) {
              const parenStrings = match.match(/\((?:\\.|[^\\)])*\)/g);
              if (parenStrings) {
                for (const str of parenStrings) {
                  const text = str.slice(1, -1);
                  const decoded = text
                    .replace(/\\n/g, ' ')
                    .replace(/\\r/g, ' ')
                    .replace(/\\t/g, ' ')
                    .replace(/\\\(/g, '(')
                    .replace(/\\\)/g, ')')
                    .replace(/\\\\/g, '\\');
                  extractedText += decoded + ' ';
                }
              }
            }

            const cleaned = extractedText
              .replace(/\s+/g, ' ')
              .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 50000);

            const commonWords = ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'been', 'has', 'will', 'would', 'could', 'should', 'not', 'but', 'what', 'which', 'when', 'where', 'who', 'how', 'all', 'each', 'every', 'some', 'such', 'than', 'very', 'about', 'into', 'over', 'after', 'before', 'security', 'report', 'threat', 'risk', 'incident'];
            const lowerText = cleaned.toLowerCase();
            const foundCommonWords = commonWords.filter(w => lowerText.includes(` ${w} `));

            if (foundCommonWords.length >= 8) {
              textContent = cleaned;
              console.log(`Heuristic PDF extraction: ${textContent.length} chars, ${foundCommonWords.length} common words`);
            } else {
              console.log(`Heuristic extraction produced garbage (${foundCommonWords.length} common words)`);
            }
          }
        } catch (heuristicErr) {
          console.warn('Heuristic PDF fallback failed:', heuristicErr);
        }
      }
      
      // Ultimate fallback for PDFs where all extraction failed
      if (!textContent || textContent.length < 100) {
        const fileSizeMB = document.file_size / (1024 * 1024);
        textContent = `[PDF document: ${document.filename} (${fileSizeMB.toFixed(1)}MB). Automated text extraction was unsuccessful. The document is stored and can be analyzed on-demand via the AI assistant.]`;
        console.warn('All PDF extraction attempts failed — stored placeholder');
      }
    } else if (document.file_type.startsWith('image/')) {
      // Image files (JPEG, PNG, WebP, GIF, BMP, TIFF, etc.)
      console.log(`Processing image file: ${document.filename} (${document.file_type})`);
      
      try {
        const imageBytes = await fileData.arrayBuffer();
        const imageUint8 = new Uint8Array(imageBytes);
        const imageSizeMB = imageUint8.length / (1024 * 1024);
        
        // Gemini supports images up to ~20MB via base64
        const MAX_IMAGE_MB = 10;
        if (imageSizeMB > MAX_IMAGE_MB) {
          console.log(`Image too large for vision analysis: ${imageSizeMB.toFixed(1)}MB`);
          textContent = `[Image file: ${document.filename} (${imageSizeMB.toFixed(1)}MB). File exceeds the ${MAX_IMAGE_MB}MB limit for vision analysis. The file is stored and accessible.]`;
        } else {
          const imageBase64 = encodeBase64(imageUint8);
          console.log(`Sending image for vision analysis: ${imageSizeMB.toFixed(2)}MB`);
          
          const visionResp = await fetchWithRetry(
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GEMINI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gemini-2.5-flash',
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Analyze this image "${document.filename}" thoroughly.

INSTRUCTIONS:
1. If the image contains text (documents, screenshots, signs, labels, handwriting), perform OCR and extract ALL readable text. Preserve structure, headings, paragraphs, tables (use | for columns), and bullet points.
2. If the image is a photograph, diagram, chart, or visual content, provide a detailed description including: subjects, objects, locations, text visible, colors, layout, and any security-relevant details.
3. If the image contains both text and visual elements, do BOTH: extract all text AND describe the visual content.
4. Mark unclear or uncertain text with [?].
5. Do NOT summarize - extract and describe everything visible.

Return the full extracted text and/or description.`
                    },
                    {
                      type: 'image_url',
                      image_url: { url: `data:${document.file_type};base64,${imageBase64}` }
                    }
                  ]
                }],
                max_tokens: 8000
              }),
            },
            3,
            'Image Vision Analysis'
          );
          
          if (visionResp.ok) {
            const visionData = await visionResp.json();
            const extracted = visionData.choices?.[0]?.message?.content?.trim();
            if (extracted && extracted.length > 10) {
              textContent = extracted.slice(0, 200000);
              console.log(`Image analysis successful: ${textContent.length} characters extracted`);
            } else {
              console.warn('Image vision analysis returned minimal content');
              textContent = `[Image file: ${document.filename}. Vision analysis returned no meaningful content. The image may be blank or contain only abstract graphics.]`;
            }
          } else {
            const errText = await visionResp.text();
            console.error(`Image vision analysis failed ${visionResp.status}: ${errText.substring(0, 300)}`);
            
            // Try Pro model as fallback
            console.log('Trying Gemini Pro fallback for image analysis...');
            const proResp = await fetchWithRetry(
              'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${GEMINI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gemini-2.5-pro',
                  messages: [{
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: `Extract all text and describe all visual content in this image "${document.filename}". Perform OCR if it contains text. Be thorough and detailed.`
                      },
                      {
                        type: 'image_url',
                        image_url: { url: `data:${document.file_type};base64,${imageBase64}` }
                      }
                    ]
                  }],
                  max_tokens: 8000
                }),
              },
              2,
              'Image Vision Pro Fallback'
            );
            
            if (proResp.ok) {
              const proData = await proResp.json();
              const proContent = proData.choices?.[0]?.message?.content?.trim();
              if (proContent && proContent.length > 10) {
                textContent = proContent.slice(0, 200000);
                console.log(`Pro fallback image analysis successful: ${textContent.length} chars`);
              }
            }
            
            if (!textContent || textContent.length < 50) {
              textContent = `[Image analysis failed for: ${document.filename}. The image is stored and accessible but could not be analyzed.]`;
            }
          }
        }
      } catch (imageError) {
        console.error('Image processing error:', imageError);
        textContent = `[Image processing failed for: ${document.filename}. Error: ${imageError instanceof Error ? imageError.message : 'Unknown error'}. The file is stored and accessible.]`;
      }
    }

    console.log(`Text content ready for AI analysis (${textContent.length} chars)`);

    // Fetch existing entities for matching (limit to most relevant ones)
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50); // Only send most recent 50 entities to keep prompt size manageable
    
    const entityContext = (existingEntities || []).map(e => 
      `${e.name} (${e.type})${e.aliases && e.aliases.length > 0 ? ` aka ${e.aliases.join(', ')}` : ''}`
    ).join('\n');
    
    console.log(`Loaded ${existingEntities?.length || 0} existing entities for matching`);

    // Fetch learning context from adaptive adjuster
    let adjustedThreshold = 0.4; // Lower threshold for intelligence reports (not too conservative)
    let learningGuidance = '';
    let falsePositiveNames: Array<{ name: string; count: number }> = [];
    let falsePositiveTypes: Array<{ type: string; count: number }> = [];
    let falsePositivePhrases: Array<{ phrase: string; count: number }> = [];
    
    try {
      const { data: adjusterData } = await supabase.functions.invoke('adaptive-confidence-adjuster');
      if (adjusterData?.success) {
        // Use the adaptive threshold but cap it at 0.5 to not be too restrictive for intel reports
        adjustedThreshold = Math.min(0.5, adjusterData.recommendations.recommended_threshold);
        learningGuidance = adjusterData.recommendations.learning_guidance || '';
        falsePositiveNames = adjusterData.recommendations.false_positive_patterns?.top_names || [];
        falsePositiveTypes = adjusterData.recommendations.false_positive_patterns?.top_types || [];
        falsePositivePhrases = adjusterData.recommendations.false_positive_patterns?.top_context_phrases || [];
        console.log(`Using adjusted threshold: ${adjustedThreshold} with ${falsePositiveNames.length} known FP patterns`);
      }
    } catch (e) {
      console.warn('Could not fetch adaptive threshold, using default 0.4:', e);
    }

    // Get false positive examples to teach AI what NOT to extract
    const { data: rejectedSuggestions } = await supabase
      .from('entity_suggestions')
      .select('suggested_name, suggested_type, context, confidence')
      .eq('status', 'rejected')
      .order('created_at', { ascending: false })
      .limit(20);

    const fpExamples = (rejectedSuggestions || []).map(ex => 
      `✗ REJECTED: "${ex.suggested_name}" (${ex.suggested_type}) from context: "${ex.context?.substring(0, 100)}"`
    ).join('\n');

    const entitySuggestions: Array<{
      suggested_name: string;
      suggested_type: string;
      confidence: number;
      context: string;
      source_id: string;
      source_type: string;
      matched_entity_id?: string | null;
      suggested_aliases?: string[];
    }> = [];

    // Only process if we have meaningful content
    if (textContent.length < 50) {
      console.log('Document too short for entity extraction');
      await supabase
        .from('archival_documents')
        .update({
          content_text: textContent, // Store whatever text we have
          metadata: {
            ...(document.metadata ?? {}),
            entities_processed: true,
            processing_note: 'Document too short for analysis',
            processed_at: new Date().toISOString(),
            text_extracted: true,
            text_length: textContent.length
          }
        })
        .eq('id', documentId);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          documentId,
          entitiesFound: 0,
          note: 'Document too short'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare text sample (max 20000 chars for AI processing - increased for better extraction)
    const sampleText = textContent.slice(0, 20000);

    console.log('Calling Lovable AI for entity extraction (with retry)...');

    // Build the entity extraction request body (shared between Gemini and OpenAI)
    const entityExtractionBody = {
      model: GEMINI_API_KEY ? 'gemini-2.5-flash' : 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an elite intelligence analyst conducting comprehensive entity extraction and strategic analysis. Your mission is to extract EVERY relevant intelligence element with full context, relationships, and strategic significance.

🎯 CONFIDENCE THRESHOLD: ${adjustedThreshold.toFixed(2)} (but err on the side of inclusion)

KNOWN ENTITIES IN DATABASE (check for matches):
${entityContext}

═══════════════════════════════════════════════════════════
📋 COMPREHENSIVE EXTRACTION FRAMEWORK
═══════════════════════════════════════════════════════════

1. **PEOPLE** (Extract with FULL professional context):
   ✓ Name + All credentials (PhD, MD, BSc, MSc, PE, etc.)
   ✓ Full titles and organizational affiliations
   ✓ Role/position in the narrative
   ✓ Professional background (if mentioned)
   ✓ Stance/position (supporting, opposing, neutral, advocating)
   Examples: "Dr. Sarah Johnson, PhD (Environmental Toxicology), UC Berkeley"
             "Chief John Smith, Indigenous Environmental Network"
             "Michael Roberts, Lead Researcher, XYZ Institute"

2. **ORGANIZATIONS** (All types, with context):
   ✓ Advocacy groups, NGOs, think tanks
   ✓ Research institutions, universities, labs
   ✓ Government agencies (all levels: federal, provincial, municipal)
   ✓ Indigenous communities, First Nations, tribal councils
   ✓ Corporations, industry groups, trade associations
   ✓ Media outlets, publishers
   ✓ Coalitions, alliances, partnerships
   ✓ Their role: supporter, opponent, neutral, funder, partner
   
3. **LOCATIONS** (Geographic intelligence):
   ✓ Countries, provinces/states, cities, towns
   ✓ Specific facilities, plants, sites, installations
   ✓ Project locations, study areas
   ✓ Areas of concern (pollution zones, impact areas)
   ✓ Indigenous territories, traditional lands
   ✓ GPS coordinates (lat/long if mentioned)
   ✓ Township/Range/Section identifiers (e.g., TWP 69 RGE 21 W5M)

4. **INFRASTRUCTURE** (Physical assets & facilities - CRITICAL FOR MAPS):
   ✓ Production pods, well pads, well sites
   ✓ Pipelines, gathering systems, transmission lines
   ✓ Compressor stations, pump stations
   ✓ Processing plants, gas plants, refineries
   ✓ Tank farms, storage facilities
   ✓ Roads, access routes, ROWs (right-of-ways)
   ✓ Power lines, substations
   ✓ Metering stations, valve sites
   ✓ Injection wells, disposal wells
   ✓ Flare stacks, vents
   ✓ Camp facilities, modular buildings
   ✓ Equipment identifiers (pod numbers, well IDs, UWI numbers)

5. **EVENTS** (Temporal intelligence):
   ✓ Protests, demonstrations, rallies
   ✓ Public meetings, hearings, consultations
   ✓ Conferences, symposiums, webinars
   ✓ Press conferences, media events
   ✓ Research presentations, paper publications
   ✓ Legal actions, court cases, regulatory proceedings
   ✓ Construction phases, drilling schedules
   ✓ Operational milestones

6. **INITIATIVES & CAMPAIGNS** (Strategic activity):
   ✓ Research programs and studies
   ✓ Advocacy campaigns and movements
   ✓ Monitoring projects and watchdog activities
   ✓ Legal challenges and regulatory interventions
   ✓ Public awareness/education campaigns
   ✓ Petition drives, letter-writing campaigns
   ✓ Development projects, expansion plans

7. **CLAIMS, CONCERNS & ALLEGATIONS** (Intelligence content):
   ✓ Health impacts claimed (specific conditions, populations affected)
   ✓ Environmental concerns (pollution, contamination, ecosystem damage)
   ✓ Safety issues and risks identified
   ✓ Regulatory violations alleged
   ✓ Corporate misconduct claims
   ✓ Transparency/accountability concerns
   ✓ Indigenous rights violations alleged

8. **CYBER/DIGITAL ASSETS** (Technical):
   ✓ Domains, websites, IP addresses
   ✓ Email addresses, phone numbers
   ✓ SCADA systems, control systems
   ✓ Software platforms, monitoring systems
   ✓ Vehicles (if identified)

9. **STRATEGIC RELATIONSHIPS** (Network intelligence):
   ✓ Funding relationships (who funds whom)
   ✓ Partnerships and collaborations
   ✓ Opposition dynamics (who opposes whom)
   ✓ Support networks (who supports whom)
   ✓ Employment/affiliation connections
   ✓ Co-authorship and joint initiatives
   ✓ Operator/owner relationships
   ✓ Contractor/service provider relationships

10. **DOCUMENTS & EVIDENCE** (Referenced materials):
    ✓ Studies, reports, white papers cited
    ✓ Legal documents, permits, filings
    ✓ Media articles, press releases
    ✓ Letters, submissions, testimonies
    ✓ Scientific papers, research publications
    ✓ Maps, surveys, engineering drawings

11. **KEY NARRATIVE ELEMENTS** (Strategic framing):
    ✓ Main arguments being made
    ✓ Evidence presented (studies, data, testimony)
    ✓ Tactics employed (legal, media, grassroots)
    ✓ Goals and objectives stated
    ✓ Timelines and deadlines mentioned

═══════════════════════════════════════════════════════════
🗺️ MAP & GEOGRAPHIC DOCUMENT SPECIAL HANDLING
═══════════════════════════════════════════════════════════

FOR MAPS, SITE PLANS, AND GEOGRAPHIC DOCUMENTS:
✓ Extract ALL labeled features (pods, wells, pipelines, roads, etc.)
✓ Capture naming conventions (e.g., "Pod 1A", "Well Pad 14-21")
✓ Note geographic boundaries and areas
✓ Extract coordinate systems and datums if shown
✓ Identify scale and coverage area
✓ Capture legend/key information
✓ Extract dates shown on the map
✓ Identify operator/owner information
✓ Note any safety/exclusion zones
✓ Capture infrastructure connections (what connects to what)

MAP ENTITY TYPES TO USE:
- "infrastructure" for: wells, pads, pods, pipelines, facilities
- "location" for: geographic areas, townships, sections, regions
- "organization" for: operators, contractors, service companies
- "other" for: equipment IDs, UWI numbers, license numbers

═══════════════════════════════════════════════════════════
🎯 ANALYSIS APPROACH (Think like an intelligence analyst)
═══════════════════════════════════════════════════════════

FOR EACH ENTITY EXTRACTED:
1. **Name**: Use full, formal name with identifiers
2. **Type**: Most specific applicable type (infrastructure for physical assets)
3. **Confidence**: Be realistic but inclusive (>= ${adjustedThreshold.toFixed(2)})
4. **Context**: Rich, descriptive context explaining:
   - What they're doing in this document
   - Their position/stance
   - Their significance
   - Key quotes or actions attributed to them
   - For infrastructure: location, connections, status
5. **Aliases**: Variations, acronyms, short forms, alternative IDs
6. **Attributes**: Any additional intelligence (roles, affiliations, positions)

FOR RELATIONSHIPS:
- Map connections explicitly (A connects to B, C operated by D)
- Note the nature and strength of relationships
- Capture temporal aspects (when relationships formed/ended)
- For infrastructure: note physical connections and dependencies

STRATEGIC EXTRACTION RULES:
✅ **Be Comprehensive**: Extract EVERYTHING that provides intelligence value
✅ **Capture Context**: Don't just extract names, extract their significance
✅ **Full Credentials**: Always include titles, degrees, organizational affiliations
✅ **Network Mapping**: Identify all connections and relationships
✅ **Position Analysis**: Note whether entities support/oppose/are neutral
✅ **Evidence Chain**: Track who cites what evidence
✅ **Temporal Awareness**: Note when things happened or are planned
✅ **Infrastructure Mapping**: For maps, extract ALL labeled features

❌ **Only Skip**:
- Generic role terms without names ("a researcher", "the manager")
- Common words that happen to be capitalized
- Document formatting artifacts
- Your own analytical comments

INTELLIGENCE PRIORITY:
🔴 HIGH: Opposition actors, coordinated campaigns, legal threats, media strategies, critical infrastructure
🟡 MEDIUM: Academic research, community concerns, regulatory engagement, secondary infrastructure
🟢 LOW: Neutral references, background context

When uncertain → EXTRACT (intelligence value > precision in this context)`
          },
          {
            role: 'user',
            content: `Conduct a comprehensive intelligence analysis of this document. Extract EVERY entity, relationship, claim, and strategic element.

DOCUMENT CONTENT:
${sampleText}

EXTRACTION MISSION:
1. Extract ALL named entities with full professional context
2. Map ALL relationships between entities
3. Capture ALL claims, concerns, and allegations made
4. Identify strategic elements (campaigns, initiatives, tactics)
5. Note positions and stances (who supports/opposes what)
6. Extract evidence cited (studies, data, documents referenced)
7. Temporal intelligence (events, timelines, deadlines)

ANALYSIS DEPTH:
- Name every person with their credentials and affiliations
- Name every organization with their role in the narrative
- Identify every location with context
- Extract every claim with who made it
- Map every relationship between entities
- Note every event with timing and significance

CONFIDENCE GUIDELINE: Aim for ${adjustedThreshold.toFixed(2)}+ but be inclusive. Better to capture intelligence than miss it.

Think like a professional intelligence analyst reading an opposition research document. What would you want to know?`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_entities_and_relationships",
              description: "Extract security entities and detect relationships between them",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Entity name or identifier" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "facility", "pipeline", "well", "domain", "ip_address", "email", "phone", "vehicle", "equipment", "other"],
                          description: "Entity type - use 'infrastructure' for production pods, well pads, pipelines; 'facility' for plants, stations; 'well' for individual wells; 'equipment' for specific equipment"
                        },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        context: { type: "string", description: "Where entity appears in incident" },
                        aliases: {
                          type: "array",
                          items: { type: "string" },
                          description: "Alternative names or identifiers"
                        }
                      },
                      required: ["name", "type", "confidence", "context"]
                    }
                  },
                  relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        entity_a: { type: "string", description: "First entity name" },
                        entity_b: { type: "string", description: "Second entity name" },
                        relationship_type: { 
                          type: "string",
                          description: "Type of relationship (e.g., 'targeted', 'employed_by', 'located_at', 'communicates_with')"
                        },
                        context: { type: "string", description: "How they're related in the text" },
                        confidence: { type: "number", minimum: 0, maximum: 1 }
                      },
                      required: ["entity_a", "entity_b", "relationship_type", "context", "confidence"]
                    }
                  }
                },
                required: ["entities", "relationships"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_entities_and_relationships" } }
    };

    // Try Gemini first, fall back to OpenAI if rate limited
    const callEntityExtractionAI = async (useOpenAIFallback = false): Promise<Response> => {
      const endpoint = (!GEMINI_API_KEY || useOpenAIFallback)
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      const key = (!GEMINI_API_KEY || useOpenAIFallback) ? OPENAI_API_KEY! : GEMINI_API_KEY!;
      const model = (!GEMINI_API_KEY || useOpenAIFallback) ? 'gpt-4o-mini' : 'gemini-2.5-flash';
      console.log(`Calling ${useOpenAIFallback ? 'OpenAI' : 'Gemini'} for entity extraction...`);
      return fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entityExtractionBody, model }),
      }, 3, `Entity Extraction (${useOpenAIFallback ? 'OpenAI' : 'Gemini'})`);
    };

    let aiResponse = await callEntityExtractionAI();

    // Fall back to OpenAI if Gemini is rate limited
    if (!aiResponse.ok && aiResponse.status === 429 && GEMINI_API_KEY && OPENAI_API_KEY) {
      console.log('Gemini rate limited, falling back to OpenAI gpt-4o-mini...');
      aiResponse = await callEntityExtractionAI(true);
    }

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded - please try again later');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted - please add credits to continue');
      }

      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI response received');

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.log('No tool call in AI response');
    } else {
      try {
        const extractedData = JSON.parse(toolCall.function.arguments);
        const entities = extractedData.entities || [];
        const relationships = extractedData.relationships || [];
        
        console.log(`AI extracted ${entities.length} entities and ${relationships.length} relationships`);

      // Filter out false positives - document metadata and generic terms
      const documentTitleWords = document.filename
        .toLowerCase()
        .replace(/\.[^.]+$/, '') // Remove extension
        .split(/[\s_-]+/);
      
      const filteredEntities = entities.filter((entity: any) => {
        // Safety check
        if (!entity.name || typeof entity.name !== 'string') {
          console.log(`Filtering out invalid entity: ${JSON.stringify(entity)}`);
          return false;
        }
        
        const nameLower = entity.name.toLowerCase();
        
        // Skip if entity name appears in document filename
        if (documentTitleWords.some((word: string) => word.length > 3 && nameLower.includes(word))) {
          console.log(`Filtering out filename match: ${entity.name}`);
          return false;
        }
        
        // Skip generic terms and software names
        const genericTerms = [
          'document', 'report', 'file', 'attachment', 'pdf', 'word', 'excel',
          'microsoft', 'office', 'page', 'section', 'appendix', 'exhibit',
          'table', 'figure', 'chart', 'graph', 'image', 'photo', 'template',
          'form', 'worksheet', 'spreadsheet', 'presentation', 'slide'
        ];
        
        if (genericTerms.some(term => nameLower === term || nameLower.endsWith(term))) {
          console.log(`Filtering out generic term: ${entity.name}`);
          return false;
        }
        
        // Skip single words that are too short (likely not real entities)
        if (!entity.name.includes(' ') && entity.name.length < 3) {
          console.log(`Filtering out too short: ${entity.name}`);
          return false;
        }
        
        // Skip if entity name is just numbers (unless it's phone/IP type)
        if (/^\d+$/.test(entity.name) && !['phone', 'ip_address'].includes(entity.type)) {
          console.log(`Filtering out number-only: ${entity.name}`);
          return false;
        }
        
        return true;
      });
      
      console.log(`After filtering: ${filteredEntities.length} entities (removed ${entities.length - filteredEntities.length})`);

      // Check for existing suggestions to avoid duplicates
      const { data: existingSuggestions } = await supabase
        .from('entity_suggestions')
        .select('suggested_name, suggested_type')
        .eq('source_type', 'archival_document')
        .in('status', ['pending', 'approved']);
      
      const existingSet = new Set(
        (existingSuggestions || []).map(s => `${s.suggested_name.toLowerCase()}:${s.suggested_type}`)
      );

      // Convert to entity suggestions using adaptive threshold
      for (const entity of filteredEntities) {
        if (entity.confidence < adjustedThreshold) {
          console.log(`Skipping low confidence entity: ${entity.name} (${entity.confidence} < ${adjustedThreshold})`);
          continue;
        }
        
        const key = `${entity.name.toLowerCase()}:${entity.type}`;
        if (existingSet.has(key)) {
          console.log(`Skipping duplicate: ${entity.name}`);
          continue;
        }
        
        // Match to existing entities by name/alias
        let matchedId = null;
        const nameLower = entity.name.toLowerCase();
        for (const existing of (existingEntities || [])) {
          if (existing.name.toLowerCase() === nameLower) {
            matchedId = existing.id;
            console.log(`Matched ${entity.name} to existing entity ${existing.id}`);
            break;
          }
          if (existing.aliases) {
            for (const alias of existing.aliases) {
              if (alias.toLowerCase() === nameLower) {
                matchedId = existing.id;
                console.log(`Matched ${entity.name} to existing entity ${existing.id} via alias`);
                break;
              }
            }
          }
        }
        
        entitySuggestions.push({
          suggested_name: entity.name,
          suggested_type: entity.type,
          confidence: entity.confidence,
          context: entity.context || `Found in ${document.filename}`,
          source_id: documentId,
          source_type: 'archival_document',
          matched_entity_id: matchedId,
          suggested_aliases: entity.aliases || []
        });
      }
      
      // Store detected relationships for processing after entities are created/matched
      if (relationships.length > 0) {
        console.log(`Storing ${relationships.length} detected relationships`);
        
        // Store relationships in document metadata for later processing
        await supabase
          .from('archival_documents')
          .update({
            metadata: {
              ...(document.metadata ?? {}),
              detected_relationships: relationships,
              relationships_detected_at: new Date().toISOString()
            }
          })
          .eq('id', documentId);
      }
      } catch (processingError) {
        console.error('Error processing entities:', processingError);
        console.error('Error details:', processingError instanceof Error ? processingError.message : 'Unknown error');
      }
    }

    console.log(`Found ${entitySuggestions.length} high-confidence entities`);

    // Insert entity suggestions
    if (entitySuggestions.length > 0) {
      const { error: suggestError } = await supabase
        .from('entity_suggestions')
        .insert(entitySuggestions);

      if (suggestError) {
        console.error('Error inserting entity suggestions:', suggestError);
      }
    }

    // Update document with entity mentions AND extracted text content
    const entityNames = entitySuggestions.map(e => e.suggested_name);
    await supabase
      .from('archival_documents')
      .update({
        processing_status: 'completed',
        content_text: textContent, // Store the extracted text for AI analysis
        entity_mentions: entityNames,
        metadata: {
          ...(document.metadata ?? {}),
          entities_processed: true,
          entities_processed_at: new Date().toISOString(),
          text_extracted: true,
          text_length: textContent.length
        }
      })
      .eq('id', documentId);

    console.log(`Successfully processed document: ${document.filename}`);

    // ═══ DISSEMINATION: Share key findings with specialist agents ═══
    let disseminatedTo: string[] = [];
    if (textContent && textContent.length > 100) {
      try {
        console.log('Disseminating document findings to agent network...');
        
        // Build a concise summary for agent memory (max 2000 chars)
        const summaryForAgents = textContent.substring(0, 2000);
        const docSummary = document.summary || `Document: ${document.filename}`;
        const entityList = entityNames.length > 0 ? ` | Entities: ${entityNames.slice(0, 10).join(', ')}` : '';
        const memoryContent = `DOCUMENT INTAKE: "${document.filename}" (${document.file_type}, ${(document.file_size / 1024).toFixed(0)}KB). ${docSummary}${entityList}\n\nKey content: ${summaryForAgents}`;
        
        // Determine which agents should receive this based on content keywords
        const contentLower = textContent.toLowerCase();
        const agentTargets: { callSign: string; reason: string }[] = [];
        
        // Always notify AEGIS-CMD (command hub)
        agentTargets.push({ callSign: 'AEGIS-CMD', reason: 'command_hub' });
        
        // Route to specialists based on content
        if (/cyber|malware|apt|phish|ransomware|breach|cve|exploit|zero.day/i.test(contentLower)) {
          agentTargets.push({ callSign: 'NEO', reason: 'cyber_content' });
        }
        if (/financ|launder|fraud|aml|sanction|crypto|money/i.test(contentLower)) {
          agentTargets.push({ callSign: 'CERBERUS', reason: 'financial_crime' });
        }
        if (/extremis|terror|radicali|violen|ideology|threat actor/i.test(contentLower)) {
          agentTargets.push({ callSign: 'MERIDIAN', reason: 'threat_content' });
        }
        if (/supply.chain|vendor|third.party|procurement|logistics/i.test(contentLower)) {
          agentTargets.push({ callSign: 'OUROBOROS', reason: 'supply_chain' });
        }
        if (/physical|security|patrol|surveillance|access.control|perimeter/i.test(contentLower)) {
          agentTargets.push({ callSign: 'ARGUS', reason: 'physical_security' });
        }
        if (/investig|case|evidence|witness|suspect|forensic/i.test(contentLower)) {
          agentTargets.push({ callSign: 'BIRD-DOG', reason: 'investigation' });
        }
        if (/geopolit|nation.state|sanction|embassy|diplomatic|conflict/i.test(contentLower)) {
          agentTargets.push({ callSign: 'MERIDIAN', reason: 'geopolitical' });
        }
        if (/vuln|pentest|red.team|offensive|exploit|attack.surface/i.test(contentLower)) {
          agentTargets.push({ callSign: 'WRAITH', reason: 'offensive_security' });
        }
        
        // Deduplicate
        const seen = new Set<string>();
        const uniqueTargets = agentTargets.filter(t => {
          if (seen.has(t.callSign)) return false;
          seen.add(t.callSign);
          return true;
        });
        
        // Write memory entries for each targeted agent
        const memoryInserts = uniqueTargets.map(target => ({
          agent_call_sign: target.callSign,
          content: memoryContent,
          memory_type: 'document_intake',
          entities: entityNames.slice(0, 20),
          tags: ['document_upload', document.file_type.split('/').pop() || 'unknown', target.reason],
          confidence: 0.8,
          client_id: document.client_id || null,
        }));
        
        const { error: memError } = await supabase
          .from('agent_investigation_memory')
          .insert(memoryInserts);
        
        if (memError) {
          console.error('Failed to disseminate to agent memory:', memError);
        } else {
          disseminatedTo = uniqueTargets.map(t => t.callSign);
          console.log(`Disseminated document findings to ${disseminatedTo.length} agents: ${disseminatedTo.join(', ')}`);
        }
        
        // Log the dissemination action for audit trail
        await supabase.from('autonomous_actions_log').insert({
          trigger_source: 'process-stored-document',
          action_type: 'document_dissemination',
          status: memError ? 'failed' : 'completed',
          action_details: {
            document_id: documentId,
            filename: document.filename,
            agents_targeted: uniqueTargets,
            entities_count: entityNames.length,
            text_length: textContent.length,
          },
          error_message: memError?.message || null,
        });
        
      } catch (dissemError) {
        console.error('Dissemination error (non-fatal):', dissemError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        documentId,
        entitiesFound: entitySuggestions.length,
        disseminatedTo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-stored-document function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
