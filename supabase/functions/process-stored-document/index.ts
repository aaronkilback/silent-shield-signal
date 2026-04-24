import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
// NOTE: pdfjs-dist is loaded dynamically inside the PDF extraction block to avoid
// crashing the entire function on cold start if the CDN import is slow or fails.

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

// All heavy processing lives in this function, called via EdgeRuntime.waitUntil
// so the HTTP response is sent immediately (< 1s) regardless of how long processing takes.
async function processDocumentBackground(documentId: string) {

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // Get feedback-based learning context
    let learningContext: any = { adjustedThreshold: 0.7, avoidKeywords: [], guidance: '' };
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
          content_text: document.content_text && document.content_text.length > 100
            ? document.content_text
            : `[Large document: ${document.filename} (${fileSizeMB.toFixed(1)}MB). This file exceeds the ${MAX_SAFE_SIZE_MB}MB processing limit for in-memory analysis. The file is stored and accessible but text extraction was skipped to prevent system resource exhaustion. For full content analysis, please split into smaller files or use external document processing services.]`,
          metadata: {
            ...(document.metadata ?? {}),
            entities_processed: true,
            text_extracted: true,
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
          content_text:
            document.content_text ??
            `[Document processing failed: could not download the file from storage. path=${document.storage_path}]`,
          metadata: {
            ...(document.metadata ?? {}),
            entities_processed: false,
            text_extracted: false,
            file_missing: true,
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
              const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
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

      // Primary: pdf.js with disableWorker=true — same approach used by fortress-document-converter.
      // Works for text-based PDFs (embedded text layer). For scanned/image-only PDFs,
      // falls back to OpenAI Vision OCR on the first page rendered as an image.
      try {
        const fileSizeMB = document.file_size / (1024 * 1024);
        const MAX_PDF_MB = 8;

        if (fileSizeMB > MAX_PDF_MB) {
          console.log(`PDF too large for edge function processing (${fileSizeMB.toFixed(1)}MB > ${MAX_PDF_MB}MB limit)`);
          textContent = `[PDF document: ${document.filename} (${fileSizeMB.toFixed(1)}MB). Exceeds processing limit. Content stored for manual review.]`;
        } else {
          console.log(`Processing PDF (${fileSizeMB.toFixed(1)}MB) via pdf.js...`);
          const pdfBytes = await fileData.arrayBuffer();
          const uint8 = new Uint8Array(pdfBytes);

          // Dynamic import — keeps it out of the module init critical path
          const pdfjsLib = await import('https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs');
          await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs');
          try { (pdfjsLib as any).GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'; } catch (_e) { /* non-fatal */ }

          const pdf = await (pdfjsLib as any).getDocument({ data: uint8, disableWorker: true }).promise;
          const totalPages = Number(pdf?.numPages || 0);
          const maxPages = Math.min(totalPages, 150); // cap to avoid timeout

          const pageTexts: string[] = [];
          for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const pageContent = await page.getTextContent();
            const pageText = (pageContent?.items ?? [])
              .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
              .filter((s: string) => s.trim().length > 0)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (pageText) pageTexts.push(pageText);
          }

          const extracted = pageTexts.join('\n');
          if (extracted.trim().length >= 50) {
            textContent = extracted.slice(0, 200000);
            console.log(`pdf.js extracted ${textContent.length} chars from ${maxPages}/${totalPages} pages`);
          } else {
            console.log(`pdf.js found no text layer (${extracted.length} chars) — PDF may be scanned/image-only`);
          }
        }
      } catch (pdfJsError) {
        console.error('pdf.js extraction error:', pdfJsError instanceof Error ? pdfJsError.message : pdfJsError);
      }

      // Fallback for scanned/image-only PDFs: use OpenAI Vision on the first few pages
      // by uploading to Files API and using the Responses API with gpt-4o
      if (!textContent || textContent.length < 100) {
        const fileSizeMB = document.file_size / (1024 * 1024);
        if (fileSizeMB <= 8) {
          try {
            console.log('PDF has no text layer — attempting AI OCR via Files API + Responses API...');
            const pdfBytes2 = await fileData.arrayBuffer();
            const pdfBlob = new Blob([pdfBytes2], { type: 'application/pdf' });
            const formData = new FormData();
            formData.append('file', pdfBlob, document.filename || 'document.pdf');
            formData.append('purpose', 'user_data');

            const uploadResp = await fetch('https://api.openai.com/v1/files', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
              body: formData,
            });

            if (uploadResp.ok) {
              const uploadData = await uploadResp.json();
              const fileId = uploadData.id;
              console.log(`Uploaded scanned PDF: ${fileId}, polling for ready state...`);

              // Wait for file to be processed (usually 2-5 seconds)
              let fileReady = false;
              for (let poll = 0; poll < 8; poll++) {
                await new Promise(r => setTimeout(r, 2000));
                const statusResp = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
                  headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
                });
                if (statusResp.ok) {
                  const s = await statusResp.json();
                  if (s.status === 'processed') { fileReady = true; break; }
                  if (s.status === 'error') break;
                }
              }

              if (fileReady) {
                const ocrResp = await fetchWithRetry('https://api.openai.com/v1/responses', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'gpt-4o',
                    input: [{
                      role: 'user',
                      content: [
                        {
                          type: 'input_text',
                          text: `Extract ALL readable text from this scanned PDF document "${document.filename}". Preserve structure. Return ONLY the extracted text.`,
                        },
                        { type: 'input_file', file_id: fileId },
                      ],
                    }],
                    max_output_tokens: 16000,
                  }),
                }, 1, 'PDF OCR Responses API');

                // Clean up file
                fetch(`https://api.openai.com/v1/files/${fileId}`, {
                  method: 'DELETE', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
                }).catch(() => {});

                if (ocrResp.ok) {
                  const ocrData = await ocrResp.json();
                  const outputMessage = ocrData.output?.find((o: any) => o.type === 'message');
                  const ocrText = outputMessage?.content?.find((c: any) => c.type === 'output_text')?.text?.trim();
                  if (ocrText && ocrText.length > 50 && !ocrText.includes("I'm unable to")) {
                    textContent = ocrText.slice(0, 200000);
                    console.log(`PDF OCR via Responses API successful: ${textContent.length} chars`);
                  } else {
                    console.warn('PDF OCR via Responses API returned no useful content');
                  }
                } else {
                  console.error(`PDF OCR Responses API error ${ocrResp.status}`);
                }
              } else {
                console.warn('PDF not processed in time for OCR');
                fetch(`https://api.openai.com/v1/files/${fileId}`, {
                  method: 'DELETE', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
                }).catch(() => {});
              }
            } else {
              console.warn(`PDF Files API upload failed: ${uploadResp.status}`);
            }
          } catch (ocrError) {
            console.error('PDF AI OCR fallback failed:', ocrError instanceof Error ? ocrError.message : ocrError);
          }
        }
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
            'https://api.openai.com/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
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
              'https://api.openai.com/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
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
    let adjustedThreshold = 0.7;
    let learningGuidance = '';
    let falsePositiveNames: Array<{ name: string; count: number }> = [];
    let falsePositiveTypes: Array<{ type: string; count: number }> = [];
    let falsePositivePhrases: Array<{ phrase: string; count: number }> = [];

    try {
      const { data: adjusterData } = await supabase.functions.invoke('adaptive-confidence-adjuster');
      if (adjusterData?.success) {
        adjustedThreshold = Math.max(0.7, adjusterData.recommendations.recommended_threshold ?? 0.7);
        learningGuidance = adjusterData.recommendations.learning_guidance || '';
        falsePositiveNames = adjusterData.recommendations.false_positive_patterns?.top_names || [];
        falsePositiveTypes = adjusterData.recommendations.false_positive_patterns?.top_types || [];
        falsePositivePhrases = adjusterData.recommendations.false_positive_patterns?.top_context_phrases || [];
        console.log(`Using adjusted threshold: ${adjustedThreshold} with ${falsePositiveNames.length} known FP patterns`);
      }
    } catch (e) {
      console.warn('Could not fetch adaptive threshold, using default 0.7:', e);
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
      model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an elite intelligence analyst conducting comprehensive entity extraction and strategic analysis. Your mission is to extract EVERY relevant intelligence element with full context, relationships, and strategic significance.

🎯 CONFIDENCE THRESHOLD: ${adjustedThreshold.toFixed(2)} — only include entities with strong, explicit evidence. Err on the side of precision, not inclusion. When uncertain, omit.

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
3. **Confidence**: Be precise — only score >= ${adjustedThreshold.toFixed(2)} for entities with clear, explicit evidence
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
✅ **Be Selective**: Extract only entities with clear, named, specific identity
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

When uncertain → OMIT`
          },
          {
            role: 'user',
            content: `Analyze this document and extract only high-confidence, specifically named entities.

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

CONFIDENCE GUIDELINE: Only include entities at ${adjustedThreshold.toFixed(2)}+ confidence. When uncertain, omit.

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

    // Entity extraction via OpenAI
    const callEntityExtractionAI = async (): Promise<Response> => {
      console.log('Calling OpenAI for entity extraction...');
      return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entityExtractionBody, model: 'gpt-4o-mini' }),
      }, 3, 'Entity Extraction');
    };

    let aiResponse = await callEntityExtractionAI();

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Entity extraction AI error:', aiResponse.status, errorText.substring(0, 300));
      // Non-fatal: document text is already extracted; entity extraction failure
      // should not fail the whole function and cause the frontend to show an error.
      console.warn('Skipping entity extraction due to AI error — document text will still be stored');
      // Jump past entity processing; entitySuggestions remains []
    }

    const aiData = aiResponse.ok ? await aiResponse.json() : null;
    if (aiData) console.log('AI response received');

    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
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

        // Locations and infrastructure are rarely useful as monitored entities —
        // only keep them if confidence is very high
        const lowValueTypes = ['location', 'infrastructure', 'facility', 'address'];
        if (lowValueTypes.includes((entity.type || '').toLowerCase()) && entity.confidence < 0.85) {
          console.log(`Filtering out low-value type ${entity.type}: ${entity.name}`);
          return false;
        }

        return true;
      });
      
      console.log(`After filtering: ${filteredEntities.length} entities (removed ${entities.length - filteredEntities.length})`);

      // Check for existing suggestions to avoid duplicates (across all sources and statuses)
      const { data: existingSuggestions } = await supabase
        .from('entity_suggestions')
        .select('suggested_name, suggested_type')
        .in('status', ['pending', 'approved', 'rejected']);
      
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

    // ═══ BACKGROUND ENRICHMENT ═══
    // Knowledge bank, monitoring proposals, signal generation, and agent dissemination
    // are fire-and-forget — they run AFTER we return the 200 OK so the user isn't
    // waiting for 3 sequential AI calls.
    const backgroundEnrichment = async () => {

    // Skip enrichment if already completed — prevents duplicate KB entries, signals,
    // and monitoring proposals when a document is reprocessed for entity extraction.
    if (document.metadata?.enrichment_completed) {
      console.log('Skipping background enrichment — already completed for this document');
      return;
    }

    // ═══ KNOWLEDGE BANK: Extract key findings into expert_knowledge ═══
    if (textContent && textContent.length > 200) {
      try {
        console.log('Generating knowledge bank entries from document...');

        const kbResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a security intelligence analyst. Extract 3-5 key findings from a document for a corporate security knowledge base. Return ONLY a valid JSON array, no markdown.',
              },
              {
                role: 'user',
                content: `Extract 3-5 key intelligence findings from this document.

DOCUMENT: "${document.filename}"
CONTENT:
${textContent.substring(0, 8000)}

Return a JSON array. Each object:
{
  "title": "Concise finding title (under 120 chars)",
  "content": "Detailed finding with context (200-500 chars)",
  "domain": "one of: physical_security|cyber|executive_protection|crisis_management|threat_intelligence|geopolitical|financial_crime|compliance|general",
  "subdomain": "specific subtopic",
  "tags": ["tag1", "tag2"]
}

Only extract genuinely valuable intelligence insights. Skip boilerplate and generic filler.`,
              },
            ],
            max_tokens: 2000,
            temperature: 0.3,
          }),
        });

        if (kbResp.ok) {
          const kbData = await kbResp.json();
          let kbContent = kbData.choices?.[0]?.message?.content || '[]';
          kbContent = kbContent.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

          let kbEntries: any[] = [];
          try { kbEntries = JSON.parse(kbContent); } catch { /* skip */ }

          if (Array.isArray(kbEntries) && kbEntries.length > 0) {
            const kbInserts = kbEntries.slice(0, 5).map((entry: any) => ({
              domain: entry.domain || 'threat_intelligence',
              subdomain: entry.subdomain || 'document_upload',
              knowledge_type: 'document_derived',
              // expert_name attribution lets the knowledge-synthesizer track and credit
              // library documents as a distinct source in agent belief formation.
              expert_name: 'library_document',
              title: (entry.title || `Finding from ${document.filename}`).substring(0, 200),
              content: entry.content || '',
              applicability_tags: entry.tags || [],
              citation: `Extracted from uploaded document: ${document.filename} (${new Date().toISOString().split('T')[0]})`,
              confidence_score: 0.75,
            }));

            const { data: kbData, error: kbErr } = await supabase
              .from('expert_knowledge')
              .insert(kbInserts)
              .select('id');
            if (kbErr) {
              console.error('Knowledge bank insert error:', kbErr.message);
            } else {
              console.log(`Generated ${kbInserts.length} knowledge bank entries`);
              // Embed each entry so semantic search (search_expert_knowledge_semantic)
              // can find it. generate-embeddings doesn't support expert_knowledge so
              // we embed inline. Failures are non-fatal.
              if (kbData && kbData.length > 0) {
                await Promise.all(kbInserts.map(async (entry: any, i: number) => {
                  if (!kbData[i]?.id) return;
                  try {
                    const embResp = await fetch('https://api.openai.com/v1/embeddings', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        model: 'text-embedding-3-small',
                        input: `${entry.title}\n${entry.content}`.substring(0, 8000),
                      }),
                    });
                    if (embResp.ok) {
                      const embData = await embResp.json();
                      await supabase
                        .from('expert_knowledge')
                        .update({ embedding: embData.data[0].embedding })
                        .eq('id', kbData[i].id);
                    }
                  } catch (e) {
                    console.warn(`Embedding failed for knowledge entry ${i} (non-fatal):`, e);
                  }
                }));
                console.log(`Embedded ${kbData.length} knowledge bank entries for semantic search`);
              }
            }
          }
        }
      } catch (kbError) {
        console.error('Knowledge bank generation error (non-fatal):', kbError);
      }
    }

    // ═══ SCAN SOURCE DISCOVERY: Extract domains/URLs as monitoring proposals ═══
    if (textContent && textContent.length > 200 && document.client_id) {
      try {
        const urlMatches = textContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g) || [];
        const domainMatches = textContent.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|gov|edu|io|co|info|news|mil|int)\b/gi) || [];

        const uniqueDomains = [...new Set([
          ...urlMatches.map((u: string) => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean),
          ...domainMatches,
        ])].filter((d: any) =>
          d && d.length > 5 &&
          !['supabase.co', 'openai.com', 'anthropic.com', 'googleapis.com', 'microsoft.com', 'w3.org'].some(skip => d.includes(skip))
        ) as string[];

        if (uniqueDomains.length > 0) {
          const sourceProposals = uniqueDomains.slice(0, 5).map((domain: string) => ({
            client_id: document.client_id,
            proposal_type: 'add_keyword',
            proposed_value: domain,
            proposed_by_agent: 'PROCESS-DOCUMENT',
            reasoning: `Domain extracted from uploaded document: ${document.filename}. May be a relevant source for ongoing monitoring.`,
            confidence: 0.6,
            source_evidence: {
              document_id: documentId,
              filename: document.filename,
              extracted_at: new Date().toISOString(),
            },
          }));

          const { error: propErr } = await supabase.from('monitoring_proposals').insert(sourceProposals);
          if (propErr) {
            console.error('Monitoring proposals insert error:', propErr.message);
          } else {
            console.log(`Generated ${sourceProposals.length} monitoring proposals from document sources`);
          }
        }
      } catch (sourceError) {
        console.error('Scan source discovery error (non-fatal):', sourceError);
      }
    }

    // ═══ SIGNAL GENERATION: Create signal if content is threat-relevant ═══
    if (textContent && textContent.length > 200 && document.client_id) {
      try {
        const threatPattern = /\b(?:threat|attack|breach|compromise|hostile|adversary|terror|extremi|weapon|assassin|kidnap|surveil|stalk|bomb|shooting|violence|intrusion|hack|malware|ransom|phish|fraud|launder|sanction|exploit|arson|poison|abduct)\b/i;

        if (threatPattern.test(textContent)) {
          console.log('Threat-relevant content detected — generating signal from document...');

          const signalText = `DOCUMENT INTELLIGENCE: "${document.filename}" uploaded. Key content: ${textContent.substring(0, 2000)}`;

          const { error: sigErr } = await supabase.functions.invoke('ingest-signal', {
            body: {
              text: signalText,
              client_id: document.client_id,
              sourceType: 'document_upload',
              source_url: `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/storage/v1/object/public/archival-documents/${document.storage_path}`,
              sourceData: {
                document_id: documentId,
                filename: document.filename,
                file_type: document.file_type,
              },
            },
          });

          if (sigErr) {
            console.error('Signal generation error:', sigErr);
          } else {
            console.log('Signal generated from threat-relevant document content');
          }
        }
      } catch (signalError) {
        console.error('Signal generation error (non-fatal):', signalError);
      }
    }

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

    // Mark enrichment as complete so reprocessing skips this block.
    // Fetch fresh metadata first to avoid overwriting flags set during entity extraction.
    // Always preserve text_extracted and entities_processed even if the fetch fails.
    const { data: freshDoc } = await supabase.from('archival_documents').select('metadata').eq('id', documentId).single();
    await supabase.from('archival_documents').update({
      metadata: {
        ...(freshDoc?.metadata ?? {}),
        text_extracted: true,
        entities_processed: true,
        enrichment_completed: true,
      }
    }).eq('id', documentId);

    }; // end backgroundEnrichment

    // Already inside EdgeRuntime.waitUntil — just await directly so the runtime
    // stays alive until ALL enrichment (knowledge bank, signals, dissemination) finishes.
    await backgroundEnrichment();

    console.log(`[process-stored-document] Background processing completed for: ${documentId}`);
}

// Minimal HTTP handler — returns 200 immediately, all work runs in background
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body.health_check) {
      return new Response(
        JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── kb_backfill: re-run knowledge bank extraction for processed documents ──
    // Finds archival_documents that don't yet have a 'library_document' entry in
    // expert_knowledge, runs AI extraction + embedding for each, and returns a
    // summary. Safe to call multiple times — checks citation before inserting.
    if (body.kb_backfill) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      const supabase = createClient(supabaseUrl, supabaseKey);
      const since = body.since_days ? `${body.since_days}d` : '30d';
      const sinceDays = body.since_days ?? 30;
      const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

      const { data: docs, error: docsErr } = await supabase
        .from('archival_documents')
        .select('id, filename, content_text, metadata')
        .gte('created_at', sinceDate)
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (docsErr) {
        return new Response(JSON.stringify({ error: docsErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Get filenames that already have library_document entries
      const { data: existing } = await supabase
        .from('expert_knowledge')
        .select('citation')
        .eq('expert_name', 'library_document')
        .gte('created_at', sinceDate);
      const alreadyDone = new Set((existing || []).map((e: any) => e.citation));

      // Build list of docs that need processing
      const docsToProcess = (docs || []).filter(doc => {
        if (!doc.content_text || doc.content_text.length < 200) return false;
        const prefix = `Extracted from uploaded document: ${doc.filename}`;
        return ![...alreadyDone].some(c => c?.startsWith(prefix));
      });
      const skipped = (docs?.length ?? 0) - docsToProcess.length;

      // Return immediately — process all docs in parallel in the background
      const processAll = async () => {
        await Promise.allSettled(docsToProcess.map(async (doc) => {
          const textContent: string = doc.content_text;
          const expectedCitationPrefix = `Extracted from uploaded document: ${doc.filename}`;
          try {
            const kbResp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(30000),
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: 'You are a security intelligence analyst. Extract 3-5 key findings from a document for a corporate security knowledge base. Return ONLY a valid JSON array, no markdown.' },
                  { role: 'user', content: `Extract 3-5 key intelligence findings from this document.\n\nDOCUMENT: "${doc.filename}"\nCONTENT:\n${textContent.substring(0, 8000)}\n\nReturn a JSON array. Each object:\n{\n  "title": "Concise finding title (under 120 chars)",\n  "content": "Detailed finding with context (200-500 chars)",\n  "domain": "one of: physical_security|cyber|executive_protection|crisis_management|threat_intelligence|geopolitical|financial_crime|compliance|general",\n  "subdomain": "specific subtopic",\n  "tags": ["tag1", "tag2"]\n}\n\nOnly extract genuinely valuable intelligence insights. Skip boilerplate.` },
                ],
                max_tokens: 2000,
                temperature: 0.3,
              }),
            });
            if (!kbResp.ok) { console.warn(`[kb_backfill] OpenAI ${kbResp.status} for ${doc.filename}`); return; }

            const kbData = await kbResp.json();
            let kbContent = (kbData.choices?.[0]?.message?.content || '[]').replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
            let kbEntries: any[] = [];
            try { kbEntries = JSON.parse(kbContent); } catch { return; }
            if (!Array.isArray(kbEntries) || kbEntries.length === 0) return;

            const kbInserts = kbEntries.slice(0, 5).map((entry: any) => ({
              domain: entry.domain || 'threat_intelligence',
              subdomain: entry.subdomain || 'document_upload',
              knowledge_type: 'document_derived',
              expert_name: 'library_document',
              title: (entry.title || `Finding from ${doc.filename}`).substring(0, 200),
              content: entry.content || '',
              applicability_tags: entry.tags || [],
              citation: `${expectedCitationPrefix} (${new Date().toISOString().split('T')[0]})`,
              confidence_score: 0.75,
            }));

            const { data: inserted, error: insertErr } = await supabase.from('expert_knowledge').insert(kbInserts).select('id');
            if (insertErr) { console.error(`[kb_backfill] Insert error for ${doc.filename}:`, insertErr.message); return; }
            console.log(`[kb_backfill] ${doc.filename}: inserted ${kbInserts.length} entries`);

            // Embed in parallel
            await Promise.allSettled((inserted || []).map(async (row: any, i: number) => {
              try {
                const embResp = await fetch('https://api.openai.com/v1/embeddings', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                  signal: AbortSignal.timeout(10000),
                  body: JSON.stringify({ model: 'text-embedding-3-small', input: `${kbInserts[i].title}\n${kbInserts[i].content}`.substring(0, 8000) }),
                });
                if (embResp.ok) {
                  const embData = await embResp.json();
                  await supabase.from('expert_knowledge').update({ embedding: embData.data[0].embedding }).eq('id', row.id);
                }
              } catch { /* non-fatal */ }
            }));
            console.log(`[kb_backfill] ${doc.filename}: embeddings generated`);
          } catch (e: any) {
            console.error(`[kb_backfill] Error processing ${doc.filename}:`, e.message);
          }
        }));
        console.log(`[kb_backfill] Complete. Processed ${docsToProcess.length} docs.`);
      };

      try {
        (EdgeRuntime as any).waitUntil(processAll());
      } catch {
        processAll().catch(e => console.error('[kb_backfill] Background error:', e));
      }

      return new Response(
        JSON.stringify({
          status: 'processing',
          message: `Backfilling ${docsToProcess.length} documents in background (${skipped} already done). Check function logs for progress.`,
          docs_queued: docsToProcess.map(d => d.filename),
          since,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { documentId, sync } = body;
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'Missing documentId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // sync:true runs processing synchronously and returns the result — for diagnostics only
    if (sync) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      try {
        await processDocumentBackground(documentId);
        const { data: doc } = await supabase
          .from('archival_documents')
          .select('filename, content_text, metadata, entity_mentions')
          .eq('id', documentId)
          .single();
        return new Response(
          JSON.stringify({
            success: true,
            doc: {
              filename: doc?.filename,
              content_text_preview: (doc?.content_text || '').substring(0, 200),
              content_text_length: (doc?.content_text || '').length,
              metadata: doc?.metadata,
              entity_mention_count: doc?.entity_mentions?.length ?? 0,
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({ success: false, error: err.message, stack: err.stack }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[process-stored-document] Queuing background processing for: ${documentId}`);
    try {
      (EdgeRuntime as any).waitUntil(
        processDocumentBackground(documentId).catch(e =>
          console.error('[process-stored-document] Background error:', e)
        )
      );
    } catch (_e) {
      processDocumentBackground(documentId).catch(e =>
        console.error('[process-stored-document] Background error (fallback):', e)
      );
    }
    return new Response(
      JSON.stringify({ success: true, documentId, processing: 'background' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[process-stored-document] Handler error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
