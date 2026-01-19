import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    
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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      throw new Error('LOVABLE_API_KEY not configured');
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
              const base64Docx = base64Encode(new Uint8Array(docxBytes).buffer);
              docxRef = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Docx}`;
              console.log(`Sending DOCX as base64 (${(base64Docx.length / 1024 / 1024).toFixed(2)}MB)`);
            }

            if (docxRef) {
              const visionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'google/gemini-2.5-flash',
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

      // Primary: pdfjs-based extraction (more reliable than regex parsing)
      try {
        const maxPdfBytes = 12 * 1024 * 1024; // safety cap
        const blobToRead = fileData.size > maxPdfBytes ? fileData.slice(0, maxPdfBytes) : fileData;
        const arrayBuffer = await blobToRead.arrayBuffer();

         const pdfjsLib: any = await import('https://esm.sh/pdfjs-dist@4.2.67/legacy/build/pdf.mjs');
         // Required in Deno even when disableWorker=true
         if (pdfjsLib?.GlobalWorkerOptions) {
           // esm.sh provides a real module entry for the legacy worker
           pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.2.67/legacy/build/pdf.worker.min.mjs';
         }

         const loadingTask = pdfjsLib.getDocument({
           data: new Uint8Array(arrayBuffer),
           disableWorker: true,
         });

        const pdf = await loadingTask.promise;
        const maxPages = Math.min(pdf.numPages || 0, 25);

        const pages: string[] = [];
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const tc = await page.getTextContent();
          const pageText = (tc.items || [])
            .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
            .join(' ');
          if (pageText.trim()) pages.push(pageText);
        }

        textContent = pages
          .join('\n\n')
          .replace(/\s+/g, ' ')
          // Keep only readable ASCII + whitespace to avoid binary garbage
          .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200000);

        console.log(
          `Extracted ${textContent.length} characters from PDF using pdfjs (${maxPages}/${pdf.numPages} pages)`
        );
      } catch (pdfJsError) {
        console.warn('pdfjs extraction failed, falling back to heuristic extraction:', pdfJsError);

        // Fallback: heuristic extraction from PDF text operators
        const arrayBuffer = await fileData.slice(0, 1024 * 1024).arrayBuffer(); // 1MB
        const uint8Array = new Uint8Array(arrayBuffer);
        const pdfString = new TextDecoder('latin1').decode(uint8Array);

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

          textContent = extractedText
            .replace(/\s+/g, ' ')
            .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 50000);

          // Validate text quality - check for real English words
          const commonWords = ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'been', 'has', 'will', 'would', 'could', 'should', 'not', 'but', 'what', 'which', 'when', 'where', 'who', 'how', 'all', 'each', 'every', 'some', 'such', 'than', 'very', 'about', 'into', 'over', 'after', 'before', 'security', 'report', 'threat', 'risk', 'incident'];
          const lowerText = textContent.toLowerCase();
          const foundCommonWords = commonWords.filter(w => lowerText.includes(` ${w} `));
          
          if (foundCommonWords.length < 8) {
            console.log(`PDF text extraction produced garbage (only ${foundCommonWords.length} common words found). This appears to be a scanned/image-based PDF.`);
            textContent = ''; // Clear garbage text
          } else {
            console.log(`Extracted ${textContent.length} characters from PDF text streams (fallback), ${foundCommonWords.length} common words found`);
          }
        } else {
          // Raw extraction usually produces garbage for image-based PDFs
          console.log('No text streams found in PDF - likely image-based/scanned document');
          textContent = '';
        }
      }
      
      // If text extraction failed or produced garbage, try vision-based analysis
      if (!textContent || textContent.length < 100) {
        console.log('PDF appears to be image-based. Attempting vision-based analysis...');
        
        try {
          const fileSizeMB = document.file_size / (1024 * 1024);
          const maxSizeMB = 100; // Gemini supports up to 100MB via signed URLs
          
          if (fileSizeMB > maxSizeMB) {
            console.log(`PDF too large for processing (${fileSizeMB.toFixed(1)}MB > ${maxSizeMB}MB limit)`);
            textContent = `[This PDF is too large for processing (${fileSizeMB.toFixed(1)}MB > ${maxSizeMB}MB limit). File: ${document.filename}. Please split into smaller files.]`;
          } else {
            console.log(`Processing ${fileSizeMB.toFixed(1)}MB PDF using signed URL approach...`);
            
            // Use signed URLs for PDFs to avoid memory pressure with large files
            // This allows processing files up to 100MB without loading into memory
            const meta: any = document.metadata ?? {};
            const preferredBucket = typeof meta.storage_bucket === 'string' && meta.storage_bucket.trim().length
              ? meta.storage_bucket.trim()
              : 'archival-documents';
            
            const candidateBuckets = Array.from(
              new Set([
                preferredBucket,
                'archival-documents',
                'ai-chat-attachments',
              ].filter(Boolean))
            );
            
            let signedPdfUrl: string | null = null;
            let usedBucket: string | null = null;
            
            for (const bucket of candidateBuckets) {
              const { data: signedData, error: signedError } = await supabase.storage
                .from(bucket)
                .createSignedUrl(document.storage_path, 60 * 10); // 10 minute expiry
              
              if (!signedError && signedData?.signedUrl) {
                signedPdfUrl = signedData.signedUrl;
                usedBucket = bucket;
                console.log(`Created signed URL for PDF from bucket: ${bucket}`);
                break;
              }
            }
            
            if (!signedPdfUrl) {
              console.error('Failed to create signed URL, falling back to base64 for smaller files');
              
              // Only use base64 fallback for files under 20MB
              if (fileSizeMB <= 20) {
                const pdfBytes = await fileData.arrayBuffer();
                const base64Pdf = base64Encode(new Uint8Array(pdfBytes).buffer);
                
                console.log(`Sending PDF as base64 (${(base64Pdf.length / 1024 / 1024).toFixed(2)}MB)`);
                
                const visionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'google/gemini-2.5-flash',
                    messages: [{
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: `You are analyzing the document "${document.filename}" which is a PDF file.

This document may contain maps, diagrams, tables, or image-based content.
Analyze ALL pages thoroughly and extract every piece of visible text, data, labels, legends, and geographic/infrastructure information.

EXTRACT ALL VISIBLE INFORMATION:
1. Road names, highway numbers, access routes
2. Milepost (MP) markers and their values/ranges
3. Pipeline corridors, facilities, infrastructure
4. Grid references, map sheet numbers
5. Geographic features, waterways, landmarks
6. Company names, operators, ownership info
7. Scale information, coordinates, compass directions
8. Legend items, symbols, and their meanings

Be comprehensive - list all details visible in the document.`
                        },
                        {
                          type: 'image_url',
                          image_url: { 
                            url: `data:application/pdf;base64,${base64Pdf}` 
                          }
                        }
                      ]
                    }],
                    max_tokens: 8000
                  }),
                });
                
                if (visionResponse.ok) {
                  const visionData = await visionResponse.json();
                  const visionContent = visionData.choices?.[0]?.message?.content;
                  if (visionContent && visionContent.length > 100) {
                    textContent = `[VISION ANALYSIS - Map/Image Document: ${document.filename}]\n\n${visionContent}`;
                    console.log(`Base64 PDF analysis successful: ${textContent.length} characters`);
                  }
                }
              } else {
                textContent = `[PDF could not be processed - signed URL creation failed and file too large for base64. File: ${document.filename}. Size: ${fileSizeMB.toFixed(1)}MB]`;
              }
            } else {
              // Use signed URL approach - no memory overhead for large files
              console.log(`Sending PDF via signed URL to Gemini...`);
              
              const visionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'google/gemini-2.5-flash',
                  messages: [{
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: `You are analyzing the document "${document.filename}" which is a PDF file (${fileSizeMB.toFixed(1)}MB).

This document may contain maps, diagrams, tables, or image-based content.
Analyze ALL pages thoroughly and extract every piece of visible text, data, labels, legends, and geographic/infrastructure information.

EXTRACT ALL VISIBLE INFORMATION:
1. Road names, highway numbers, access routes
2. Milepost (MP) markers and their values/ranges
3. Pipeline corridors, facilities, infrastructure
4. Grid references, map sheet numbers
5. Geographic features, waterways, landmarks
6. Company names, operators, ownership info
7. Scale information, coordinates, compass directions
8. Legend items, symbols, and their meanings

Be comprehensive - list all details visible in the document.`
                      },
                      {
                        type: 'image_url',
                        image_url: { 
                          url: signedPdfUrl 
                        }
                      }
                    ]
                  }],
                  max_tokens: 8000
                }),
              });

              if (visionResponse.ok) {
                const visionData = await visionResponse.json();
                const visionContent = visionData.choices?.[0]?.message?.content;
                if (visionContent && visionContent.length > 100) {
                  textContent = `[VISION ANALYSIS - Map/Image Document: ${document.filename}]\n\n${visionContent}`;
                  console.log(`Signed URL PDF analysis successful: ${textContent.length} characters`);
                } else {
                  console.warn('PDF analysis returned minimal content');
                }
              } else {
                const errText = await visionResponse.text();
                console.error(`Vision API error ${visionResponse.status}: ${errText}`);
                
                // Fallback: Try with gemini-2.5-pro for more complex documents
                if (visionResponse.status === 400 || visionResponse.status === 415) {
                  console.log('Retrying with Gemini 2.5 Pro...');
                  const fallbackResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      model: 'google/gemini-2.5-pro',
                      messages: [{
                        role: 'user',
                        content: [
                          {
                            type: 'text',
                            text: `Analyze this map/infrastructure document "${document.filename}" and extract all visible content including roads, mileposts, pipelines, and geographic information.`
                          },
                          {
                            type: 'image_url',
                            image_url: {
                              url: signedPdfUrl
                            }
                          }
                        ]
                      }],
                      max_tokens: 8000
                    }),
                  });

                  if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    const fallbackContent = fallbackData.choices?.[0]?.message?.content;
                    if (fallbackContent && fallbackContent.length > 100) {
                      textContent = `[VISION ANALYSIS - Map/Image Document: ${document.filename}]\n\n${fallbackContent}`;
                      console.log(`Fallback PDF analysis successful: ${textContent.length} characters`);
                    }
                  }
                }
              }
            }
            
            if (!textContent || textContent.length < 100) {
              textContent = `[Image-based PDF could not be fully analyzed. File: ${document.filename}. Size: ${fileSizeMB.toFixed(1)}MB]`;
            }
          }
        } catch (visionError) {
          console.error('Vision processing error:', visionError);
          textContent = `[This PDF appears to be image-based/scanned and vision analysis encountered an error. File: ${document.filename}. Error: ${visionError instanceof Error ? visionError.message : 'Unknown error'}]`;
        }
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

    console.log('Calling Lovable AI for entity extraction...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro', // Use more powerful model for better extraction
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
      }),
    });

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

    return new Response(
      JSON.stringify({ 
        success: true,
        documentId,
        entitiesFound: entitySuggestions.length
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
