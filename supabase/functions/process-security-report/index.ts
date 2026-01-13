import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizeExtractedText(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .trim();
}

// Helper to convert Uint8Array to base64 without stack overflow
function uint8ToBase64(uint8: Uint8Array): string {
  const chunkSize = 8192;
  let result = '';
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

// Maximum file size for AI extraction (10MB - larger files will exceed memory limits)
const MAX_AI_EXTRACT_SIZE = 10 * 1024 * 1024;

// Word document MIME types
const WORD_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.ms-word',
];

function isWordDocument(fileType: string, filename?: string): boolean {
  if (WORD_MIME_TYPES.some(mime => fileType.includes(mime))) return true;
  if (filename) {
    const lower = filename.toLowerCase();
    return lower.endsWith('.docx') || lower.endsWith('.doc');
  }
  return false;
}

// Extract text from Word documents using AI
async function extractTextFromWord(blob: Blob, apiKey: string, filename?: string): Promise<string> {
  console.log('Starting Word document text extraction using Gemini Vision...');
  
  if (blob.size > MAX_AI_EXTRACT_SIZE) {
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Word document is too large (${sizeMB}MB). Maximum supported size is 10MB.`);
  }
  
  // Convert to base64
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64Doc = uint8ToBase64(uint8Array);
  
  console.log(`Word document size: ${blob.size} bytes`);
  
  // Determine MIME type
  const mimeType = filename?.toLowerCase().endsWith('.doc') 
    ? 'application/msword' 
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Word extraction attempt ${attempt}/${maxRetries}...`);
      
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-pro',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are a document text extractor. Extract ALL text from this Word document.

INSTRUCTIONS:
- Extract every word, number, and piece of text from the document
- Preserve the general structure (paragraphs, sections, headers, bullet points)
- Include tables, lists, and any formatted content
- Do NOT summarize or interpret - just extract the raw text
- Maintain the reading order (top to bottom)
- If there are multiple sections or pages, extract text from all of them

Output ONLY the extracted text, nothing else.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Doc}`
                  }
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Word extraction attempt ${attempt} failed:`, response.status, errorText.slice(0, 300));
        
        if (response.status >= 500 && attempt < maxRetries) {
          console.log(`Retrying after ${attempt * 2} seconds...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        
        throw new Error(`AI service temporarily unavailable (${response.status}). Please try again in a few minutes.`);
      }

      const result = await response.json();
      const extractedText = result.choices?.[0]?.message?.content || '';
      
      if (!extractedText || extractedText.length < 50) {
        throw new Error('Could not extract sufficient text from Word document. The file may be corrupted or empty.');
      }
      
      console.log(`Word extraction successful: ${extractedText.length} characters`);
      return normalizeExtractedText(extractedText);
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (lastError.message.includes('insufficient') || lastError.message.includes('corrupted')) {
        throw lastError;
      }
      
      if (attempt < maxRetries) {
        console.log(`Retrying after error: ${lastError.message.slice(0, 100)}`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error('Word extraction failed after all retries');
}

// OCR using Gemini Vision for scanned/image-based PDFs
async function extractTextWithOCR(pdfBlob: Blob, apiKey: string): Promise<string> {
  console.log('Starting OCR extraction using Gemini Vision...');
  
  // Check file size before processing
  if (pdfBlob.size > MAX_AI_EXTRACT_SIZE) {
    const sizeMB = (pdfBlob.size / (1024 * 1024)).toFixed(1);
    throw new Error(`PDF is too large for OCR (${sizeMB}MB). Maximum supported size is 10MB. Please try uploading a smaller document or a PDF with selectable text.`);
  }
  
  // Convert PDF to base64
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const base64Pdf = uint8ToBase64(uint8Array);
  
  console.log(`PDF size for OCR: ${pdfBlob.size} bytes`);
  
  // Retry logic for transient errors
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`OCR attempt ${attempt}/${maxRetries}...`);
      
      // Use Gemini Vision to extract text from the PDF
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-pro',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are an OCR system. Extract ALL text from this PDF document. 

INSTRUCTIONS:
- Extract every word, number, and piece of text visible in the document
- Preserve the general structure (paragraphs, sections, headers)
- Include tables, lists, and any formatted content
- Do NOT summarize or interpret - just extract the raw text
- If there are multiple pages, extract text from all of them
- Maintain the reading order (top to bottom, left to right)

Output ONLY the extracted text, nothing else.`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:application/pdf;base64,${base64Pdf}`
                  }
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OCR attempt ${attempt} failed:`, response.status, errorText.slice(0, 300));
        
        // Check for retryable errors (5xx)
        if (response.status >= 500 && attempt < maxRetries) {
          console.log(`Retrying after ${attempt * 2} seconds...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        
        throw new Error(`AI service temporarily unavailable (${response.status}). Please try again in a few minutes.`);
      }

      const result = await response.json();
      const extractedText = result.choices?.[0]?.message?.content || '';
      
      if (!extractedText || extractedText.length < 100) {
        throw new Error('OCR produced insufficient text. The document may be unreadable or corrupted.');
      }
      
      console.log(`OCR extracted ${extractedText.length} characters`);
      return normalizeExtractedText(extractedText);
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry if it's a content issue
      if (lastError.message.includes('insufficient text') || lastError.message.includes('unreadable')) {
        throw lastError;
      }
      
      if (attempt < maxRetries) {
        console.log(`Retrying after error: ${lastError.message.slice(0, 100)}`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error('OCR failed after all retries');
}

// Improved PDF text extraction using pdfjs (reliable for most PDFs)
async function extractPdfTextImproved(blob: Blob): Promise<{ text: string; isScanned: boolean }> {
  const maxPdfBytes = 12 * 1024 * 1024; // safety cap
  const blobToRead = blob.size > maxPdfBytes ? blob.slice(0, maxPdfBytes) : blob;
  const arrayBuffer = await blobToRead.arrayBuffer();

  console.log(`Processing PDF: ${blob.size} bytes, reading ${arrayBuffer.byteLength} bytes for extraction`);

  // Primary: pdfjs extraction
  try {
      const pdfjsLib: any = await import('https://esm.sh/pdfjs-dist@4.2.67/legacy/build/pdf.mjs');
      // Required in Deno even when disableWorker=true (pdfjs checks this getter)
      if (pdfjsLib?.GlobalWorkerOptions) {
        // esm.sh provides a real module entry for the legacy worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.2.67/legacy/build/pdf.worker.min.mjs';
      }

      const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      disableWorker: true,
    });

    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages || 0, 30);

    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const pageText = (tc.items || [])
        .map((it: any) => (typeof it?.str === 'string' ? it.str : ''))
        .join(' ');
      if (pageText.trim()) pages.push(pageText);
    }

    const text = pages
      .join('\n\n')
      .replace(/\s+/g, ' ')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 200) {
      console.log(`pdfjs extraction successful: ${text.length} characters (${maxPages}/${pdf.numPages} pages)`);
      return { text, isScanned: false };
    }

    console.warn('pdfjs extraction returned insufficient content');
  } catch (pdfJsError) {
    console.warn('pdfjs extraction error:', pdfJsError);
  }

  // Fallback: heuristic extraction from PDF operators
  console.log('Falling back to basic PDF text extraction...');
  const uint8 = new Uint8Array(arrayBuffer);
  const pdfString = new TextDecoder('latin1').decode(uint8);
  let extractedText = '';

  const textBlocks = pdfString.match(/BT([\s\S]*?)ET/g) || [];
  for (const block of textBlocks.slice(0, 1500)) {
    const parenStrings = block.match(/\((?:\\.|[^\\)])*\)/g) || [];
    for (const str of parenStrings) {
      const t = str
        .slice(1, -1)
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      extractedText += t + ' ';
    }

    if (extractedText.length > 200000) break;
  }

  extractedText = extractedText
    .replace(/\s+/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Validate extracted text quality - check for REAL English words, not just character patterns
  // Common English words that should appear in any real document
  const commonWords = ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'been', 'being', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'not', 'but', 'what', 'which', 'when', 'where', 'who', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about', 'into', 'over', 'after', 'before', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'only', 'also', 'security', 'report', 'threat', 'risk', 'incident', 'company', 'organization', 'project', 'information'];
  
  const lowerText = extractedText.toLowerCase();
  const foundCommonWords = commonWords.filter(w => lowerText.includes(` ${w} `) || lowerText.startsWith(`${w} `) || lowerText.endsWith(` ${w}`));
  const realWordCount = foundCommonWords.length;
  
  console.log(`Fallback extraction: ${extractedText.length} chars, found ${realWordCount}/${commonWords.length} common English words`);

  // Require at least 10 common English words to consider it readable text
  if (extractedText.length < 200 || realWordCount < 10) {
    // Return indication that this is a scanned PDF
    return { text: '', isScanned: true };
  }

  return { text: extractedText, isScanned: false };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, textContent } = await req.json();
    
    if (!documentId && !textContent) {
      return new Response(
        JSON.stringify({ error: 'Either documentId or textContent is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing security report${documentId ? ` for document ${documentId}` : ''}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    let content = textContent;
    let document: any = null;
    let clientId: string | null = null;

    // If documentId provided, fetch the document
    if (documentId) {
      const { data: doc, error: docError } = await supabase
        .from('archival_documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Document not found: ${docError?.message}`);
      }

      document = doc;
      clientId = doc.client_id;

      // Check if content_text exists and is meaningful (not raw PDF binary or garbage)
      // Must have:
      // 1. Sufficient length
      // 2. Not raw PDF markers
      // 3. Contains actual English words (multiple 4+ letter words with spaces)
      // 4. Low ratio of special characters (garbage text has high special char ratio)
      const contentSample = doc.content_text?.slice(0, 1000) || '';
      const wordMatches = contentSample.match(/\b[a-zA-Z]{4,}\b/g) || [];
      const specialCharCount = (contentSample.match(/[^a-zA-Z0-9\s.,;:'"!?()-]/g) || []).length;
      const specialCharRatio = contentSample.length > 0 ? specialCharCount / contentSample.length : 1;
      
      // Common English words that should appear in readable text
      const commonWords = ['the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'are', 'was', 'were', 'been', 'has', 'report', 'security', 'risk'];
      const hasCommonWords = commonWords.some(word => 
        contentSample.toLowerCase().includes(` ${word} `) || contentSample.toLowerCase().startsWith(`${word} `)
      );
      
      // OCR content starts with "==Start of OCR" and is always valid
      const isOcrContent = doc.content_text?.startsWith('==Start of OCR') || false;
      
      const hasValidContent = doc.content_text && 
        doc.content_text.length > 500 && 
        !doc.content_text.includes('content not processed') &&
        !doc.content_text.startsWith('%PDF') && // Not raw PDF data
        (isOcrContent || ( // Either OCR content (always valid) or meets quality checks
          wordMatches.length >= 10 && // At least 10 words of 4+ letters
          specialCharRatio < 0.15 && // Less than 15% special characters
          hasCommonWords // Contains common English words
        ));

      console.log(`Content validation: words=${wordMatches.length}, specialCharRatio=${specialCharRatio.toFixed(2)}, hasCommonWords=${hasCommonWords}, valid=${hasValidContent}`);

      if (!content && hasValidContent) {
        content = doc.content_text;
        console.log('Using existing valid content_text');
      } else if (!content) {
        console.log(`Re-extracting content - content appears to be garbage or missing`);
        // Need to extract text from file
        console.log('Content not extracted yet, downloading file...');
        
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('archival-documents')
          .download(doc.storage_path);

        if (downloadError) {
          throw new Error(`Failed to download file: ${downloadError.message}`);
        }

        // Extract text based on file type
        if (doc.file_type === 'application/pdf') {
          console.log('Extracting text from PDF using improved extractor...');
          try {
            const extractionResult = await extractPdfTextImproved(fileData);

            if (extractionResult.isScanned) {
              // PDF is scanned/image-based - attempt OCR
              console.log('PDF is scanned/image-based. Attempting OCR with Gemini Vision...');
              
              try {
                content = await extractTextWithOCR(fileData, LOVABLE_API_KEY);
                console.log(`OCR successfully extracted ${content.length} characters`);
                
                // Update metadata to indicate OCR was used
                await supabase
                  .from('archival_documents')
                  .update({
                    metadata: {
                      ...(doc.metadata ?? {}),
                      ocr_used: true,
                      ocr_date: new Date().toISOString()
                    }
                  })
                  .eq('id', documentId);
              } catch (ocrError) {
                console.error('OCR extraction failed:', ocrError);
                return new Response(
                  JSON.stringify({
                    success: false,
                    error: `OCR failed: ${ocrError instanceof Error ? ocrError.message : 'Unknown error'}. The document may be too large, corrupted, or unreadable.`,
                    isImageBased: true,
                    ocrAttempted: true,
                    documentId
                  }),
                  { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            } else {
              content = extractionResult.text;
              console.log(`Extracted ${content.length} characters from PDF`);
            }

            if (!content || content.trim().length < 200) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: 'Could not extract sufficient text from the PDF. The document may be corrupted or contain only images without readable text.',
                  isImageBased: true,
                  documentId
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          } catch (pdfError) {
            console.error('PDF parsing error:', pdfError);
            const errorMsg = pdfError instanceof Error ? pdfError.message : 'Unknown error';
            throw new Error(`Failed to parse PDF: ${errorMsg}`);
          }
        } else if (isWordDocument(doc.file_type, doc.filename)) {
          // Word document extraction
          console.log('Extracting text from Word document using AI...');
          try {
            content = await extractTextFromWord(fileData, LOVABLE_API_KEY, doc.filename);
            console.log(`Extracted ${content.length} characters from Word document`);
            
            // Update metadata to indicate AI extraction was used
            await supabase
              .from('archival_documents')
              .update({
                metadata: {
                  ...(doc.metadata ?? {}),
                  ai_extraction_used: true,
                  extraction_date: new Date().toISOString()
                }
              })
              .eq('id', documentId);
          } catch (wordError) {
            console.error('Word extraction failed:', wordError);
            const errorMsg = wordError instanceof Error ? wordError.message : 'Unknown error';
            throw new Error(`Failed to extract text from Word document: ${errorMsg}`);
          }
        } else if (doc.file_type.includes('text')) {
          content = await fileData.text();
        } else {
          throw new Error(`Unsupported file type: ${doc.file_type}. Please upload PDF, Word (.docx/.doc), or text files.`);
        }

        // Update document with extracted text
        await supabase
          .from('archival_documents')
          .update({
            content_text: content.slice(0, 50000), // Store first 50k chars
            metadata: {
              ...doc.metadata,
              text_extracted: true,
              extraction_date: new Date().toISOString()
            }
          })
          .eq('id', documentId);
        
        console.log(`Extracted ${content.length} characters from ${doc.filename}`);
      }
    }

    if (!content || content.length < 100) {
      throw new Error('Document content is too short to analyze. Please ensure the document contains readable text.');
    }

    console.log(`Content length: ${content.length} characters`);

    // Fetch existing entities for context
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases')
      .eq('is_active', true)
      .limit(100);
    
    const entityContext = (existingEntities || []).map(e => 
      `${e.name} (${e.type})${e.aliases && e.aliases.length > 0 ? ` aka ${e.aliases.join(', ')}` : ''}`
    ).join('\n');

    // Fetch client info if available
    let clientContext = '';
    if (clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('name, monitoring_keywords')
        .eq('id', clientId)
        .single();
      
      if (client) {
        clientContext = `CLIENT: ${client.name}\nMONITORING KEYWORDS: ${client.monitoring_keywords?.join(', ') || 'None'}`;
      }
    }

    console.log('Calling AI to extract security intelligence...');

    // Limit content for AI processing
    const sampleText = content.slice(0, 30000);

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: `You are an expert security intelligence analyst. Extract structured intelligence from security reports.

KNOWN ENTITIES IN DATABASE:
${entityContext}

${clientContext}

EXTRACT THE FOLLOWING:

1. **ENTITIES** - Named people, organizations, locations, infrastructure:
   - Match against existing entities when possible
   - Include confidence score (0.0-1.0)
   - Provide context where mentioned

2. **THREAT SIGNALS** - Security-relevant events, activities, concerns:
   - Category: protest, surveillance, work_interruption, sabotage, violence, data_exposure, social_sentiment, health_concern, regulatory, legal, operational, environmental, cyber
   - Severity: low, medium, high, critical
   - Description of the threat/activity
   - Location if mentioned
   - Confidence score (0.0-1.0)
   - Related entity names

3. **RISK ASSESSMENTS** - Overall risk ratings and factors:
   - Risk level: LOW, MEDIUM, HIGH, CRITICAL
   - Specific threat factors assessed
   - Deductions/analysis provided

4. **INCIDENTS** - Events requiring immediate attention:
   - Only create for HIGH or CRITICAL severity
   - Priority: p1, p2, p3, p4
   - Description of what happened
   - Impact assessment

IMPORTANT:
- Be precise - only extract information explicitly stated
- Confidence must be >= 0.6
- Match entity names to existing entities when possible
- Group related signals
- Only create incidents for significant events`
          },
          {
            role: 'user',
            content: `Analyze this security report and extract all intelligence:

${sampleText}

Extract entities, threat signals, risk assessments, and any incidents requiring attention.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_security_intelligence",
              description: "Extract structured security intelligence from report",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Entity name" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
                        },
                        description: { type: "string" },
                        aliases: { type: "array", items: { type: "string" } },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        context: { type: "string", description: "Context where entity was mentioned" },
                        matched_entity_id: { type: "string", description: "ID of existing entity if matched" },
                        risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        threat_score: { type: "integer", minimum: 0, maximum: 100 }
                      },
                      required: ["name", "type", "confidence"]
                    }
                  },
                  signals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { 
                          type: "string",
                          enum: ["protest", "surveillance", "work_interruption", "sabotage", "violence", "data_exposure", "social_sentiment", "health_concern", "regulatory", "legal", "operational", "environmental", "cyber"]
                        },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        description: { type: "string" },
                        location: { type: "string" },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        entity_names: { type: "array", items: { type: "string" } },
                        context: { type: "string" }
                      },
                      required: ["category", "severity", "description", "confidence"]
                    }
                  },
                  risk_assessment: {
                    type: "object",
                    properties: {
                      overall_risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
                      threat_factors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            factor: { type: "string" },
                            level: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }
                          }
                        }
                      },
                      deductions: { type: "string" }
                    }
                  },
                  incidents: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        priority: { type: "string", enum: ["p1", "p2", "p3", "p4"] },
                        description: { type: "string" },
                        impact: { type: "string" },
                        related_signal_descriptions: { type: "array", items: { type: "string" } }
                      },
                      required: ["priority", "description"]
                    }
                  }
                },
                required: ["entities", "signals"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_security_intelligence" } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const intelligence = JSON.parse(toolCall.function.arguments);
    console.log(`Extracted: ${intelligence.entities?.length || 0} entities, ${intelligence.signals?.length || 0} signals, ${intelligence.incidents?.length || 0} incidents`);

    const results = {
      entities_created: 0,
      signals_created: 0,
      incidents_created: 0,
      entity_suggestions_created: 0
    };

    // Process entities - create suggestions for review
    if (intelligence.entities && intelligence.entities.length > 0) {
      console.log(`Processing ${intelligence.entities.length} extracted entities...`);
      
      for (const entity of intelligence.entities) {
        if (entity.confidence < 0.6) {
          console.log(`Skipping entity "${entity.name}" - confidence ${entity.confidence} below threshold`);
          continue;
        }

        // Check if entity already exists
        let matchedEntityId = entity.matched_entity_id;
        if (!matchedEntityId) {
          const { data: existingEntity } = await supabase
            .from('entities')
            .select('id')
            .ilike('name', entity.name)
            .single();
          
          if (existingEntity) {
            matchedEntityId = existingEntity.id;
            console.log(`Entity "${entity.name}" matched to existing entity ${matchedEntityId}`);
          }
        }

        // Create entity suggestion with source_type that matches UI expectations
        const suggestionData = {
          source_id: documentId || 'manual',
          source_type: 'archival_document', // Changed from 'security_report' to match UI
          suggested_name: entity.name,
          suggested_type: entity.type,
          confidence: entity.confidence,
          context: entity.context || entity.description,
          suggested_aliases: entity.aliases || [],
          suggested_attributes: {
            risk_level: entity.risk_level,
            threat_score: entity.threat_score,
            description: entity.description
          },
          matched_entity_id: matchedEntityId,
          status: 'pending'
        };

        console.log(`Creating entity suggestion for "${entity.name}" (${entity.type})`);
        
        const { error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert(suggestionData);

        if (suggestionError) {
          console.error(`Error creating suggestion for "${entity.name}":`, suggestionError);
        } else {
          results.entity_suggestions_created++;
          console.log(`Created entity suggestion for "${entity.name}"`);
        }
      }
    }

    // Process signals
    const createdSignalIds: string[] = [];
    if (intelligence.signals && intelligence.signals.length > 0) {
      for (const signal of intelligence.signals) {
        if (signal.confidence < 0.6) continue;

        // Find matching entities
        const entityIds: string[] = [];
        if (signal.entity_names && signal.entity_names.length > 0) {
          for (const entityName of signal.entity_names) {
            const { data: matchedEntity } = await supabase
              .from('entities')
              .select('id')
              .ilike('name', entityName)
              .single();
            
            if (matchedEntity) {
              entityIds.push(matchedEntity.id);
            }
          }
        }

        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            category: signal.category,
            severity: signal.severity || 'medium',
            normalized_text: signal.description,
            location: signal.location,
            confidence: signal.confidence,
            client_id: clientId,
            auto_correlated_entities: entityIds,
            raw_json: {
              source: 'security_report',
              context: signal.context,
              entity_names: signal.entity_names,
              document_id: documentId
            },
            status: 'new',
            is_test: false
          })
          .select()
          .single();

        if (!signalError && newSignal) {
          results.signals_created++;
          createdSignalIds.push(newSignal.id);

          // Create entity mentions for matched entities
          if (entityIds.length > 0) {
            const mentions = entityIds.map(entityId => ({
              entity_id: entityId,
              signal_id: newSignal.id,
              confidence: signal.confidence,
              context: signal.context || signal.description
            }));

            await supabase.from('entity_mentions').insert(mentions);
          }
        }
      }
    }

    // Process incidents
    if (intelligence.incidents && intelligence.incidents.length > 0) {
      for (const incident of intelligence.incidents) {
        // Find related signal
        let signalId = null;
        if (incident.related_signal_descriptions && incident.related_signal_descriptions.length > 0) {
          for (const desc of incident.related_signal_descriptions) {
            const { data: matchedSignal } = await supabase
              .from('signals')
              .select('id')
              .contains('normalized_text', desc)
              .limit(1)
              .single();
            
            if (matchedSignal) {
              signalId = matchedSignal.id;
              break;
            }
          }
        }

        // If no signal matched, use first created signal
        if (!signalId && createdSignalIds.length > 0) {
          signalId = createdSignalIds[0];
        }

        const { error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signalId,
            client_id: clientId,
            priority: incident.priority,
            status: 'open',
            opened_at: new Date().toISOString(),
            timeline_json: [{
              timestamp: new Date().toISOString(),
              action: 'created',
              note: `Auto-created from security report: ${incident.description}`,
              metadata: { impact: incident.impact }
            }],
            is_test: false
          });

        if (!incidentError) {
          results.incidents_created++;
        }
      }
    }

    // Update document metadata if documentId provided
    if (documentId) {
      const safeContentText =
        typeof content === 'string' && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(content.slice(0, 800))
          ? content.slice(0, 50000)
          : null;

      await supabase
        .from('archival_documents')
        .update({
          // Overwrite any previously-stored binary/garbage preview text so the UI stops showing "unintelligible"
          content_text: safeContentText,
          metadata: {
            ...(((document?.metadata as any) ?? {}) as Record<string, unknown>),
            // Preserve/mark text extraction state so UI doesn't report "unintelligible" due to stale flags
            text_extracted: safeContentText ? true : true,
            text_length: typeof content === 'string' ? content.length : undefined,

            intelligence_processed: true,
            processed_at: new Date().toISOString(),
            extraction_results: results,
            risk_assessment: intelligence.risk_assessment
          },
          summary: intelligence.risk_assessment?.deductions || null
        })
        .eq('id', documentId);
    }

    console.log('Processing complete:', results);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Security report processed successfully',
        results,
        risk_assessment: intelligence.risk_assessment
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-security-report function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
