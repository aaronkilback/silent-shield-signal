import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

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

// Extract text from Word documents by unzipping the DOCX XML — no AI needed
async function extractTextFromWord(blob: Blob, _apiKey: string, filename?: string): Promise<string> {
  console.log(`Starting Word document text extraction via JSZip for: ${filename}`);

  const fileSizeMB = blob.size / (1024 * 1024);

  if (blob.size > 50 * 1024 * 1024) {
    return `[Large Word document: ${filename || 'document'} (${fileSizeMB.toFixed(1)}MB). File stored successfully. For full text extraction of documents over 50MB, please split into smaller files.]`;
  }

  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  try {
    const zip = await JSZip.loadAsync(uint8Array);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new Error('Could not find word/document.xml inside DOCX — file may be corrupt or is a .doc (old binary format).');
    }

    const text = documentXml
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (!text || text.length < 50) {
      throw new Error('Could not extract sufficient text from Word document. The file may be empty or corrupted.');
    }

    console.log(`Word extraction successful: ${text.length} characters`);
    return normalizeExtractedText(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Word extraction failed:', msg);
    throw new Error(`Failed to extract text from Word document: ${msg}`);
  }
}

// Maximum size for base64 OCR - edge functions have 150MB memory, base64 doubles size
// We can safely handle up to ~50MB PDFs with some buffer
const MAX_OCR_SIZE = 50 * 1024 * 1024;

// OCR using OpenAI Files API + Responses API (the only correct way to OCR a PDF with OpenAI)
async function extractTextWithOCR(
  pdfBlob: Blob,
  apiKey: string,
  filename = 'document.pdf'
): Promise<string> {
  const fileSizeMB = pdfBlob.size / (1024 * 1024);
  console.log(`Starting OCR via Files API + Responses API (${fileSizeMB.toFixed(2)}MB)...`);

  if (pdfBlob.size > MAX_OCR_SIZE) {
    throw new Error(`PDF is too large for OCR (${fileSizeMB.toFixed(1)}MB). Max is ${MAX_OCR_SIZE / (1024 * 1024)}MB.`);
  }

  // Step 1: Upload to OpenAI Files API
  const formData = new FormData();
  formData.append('file', pdfBlob, filename);
  formData.append('purpose', 'user_data');

  const uploadResp = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error(`Files API upload failed (${uploadResp.status}): ${err.slice(0, 200)}`);
  }

  const uploadData = await uploadResp.json();
  const fileId = uploadData.id;
  console.log(`Uploaded to Files API: ${fileId}`);

  // Step 2: Poll until processed (usually 2–10s)
  let fileReady = false;
  for (let poll = 0; poll < 10; poll++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusResp = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (statusResp.ok) {
      const s = await statusResp.json();
      if (s.status === 'processed') { fileReady = true; break; }
      if (s.status === 'error') break;
    }
  }

  // Clean up file regardless of outcome
  const cleanup = () => fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE', headers: { 'Authorization': `Bearer ${apiKey}` },
  }).catch(() => {});

  if (!fileReady) {
    cleanup();
    throw new Error('PDF file was not processed by OpenAI in time. Try again.');
  }

  // Step 3: Extract text via Responses API with input_file
  const ocrResp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `Extract ALL readable text from this PDF document "${filename}". Preserve headings, paragraphs, tables, and lists. Return ONLY the extracted text.` },
          { type: 'input_file', file_id: fileId },
        ],
      }],
      max_output_tokens: 16000,
    }),
  });

  cleanup();

  if (!ocrResp.ok) {
    const err = await ocrResp.text();
    throw new Error(`Responses API OCR failed (${ocrResp.status}): ${err.slice(0, 200)}`);
  }

  const ocrData = await ocrResp.json();
  const outputMessage = ocrData.output?.find((o: any) => o.type === 'message');
  const extractedText = outputMessage?.content?.find((c: any) => c.type === 'output_text')?.text?.trim() || '';

  if (!extractedText || extractedText.length < 100) {
    throw new Error('OCR produced insufficient text. The document may be unreadable or corrupted.');
  }

  console.log(`OCR extracted ${extractedText.length} characters`);
  return normalizeExtractedText(extractedText);
}

// PDF text extraction - uses heuristic parsing (pdfjs has worker issues in Deno)
async function extractPdfTextImproved(blob: Blob): Promise<{ text: string; isScanned: boolean }> {
  const maxPdfBytes = 12 * 1024 * 1024; // safety cap
  const blobToRead = blob.size > maxPdfBytes ? blob.slice(0, maxPdfBytes) : blob;
  const arrayBuffer = await blobToRead.arrayBuffer();

  console.log(`Processing PDF: ${blob.size} bytes, reading ${arrayBuffer.byteLength} bytes for extraction`);

  // Heuristic extraction from PDF operators (works without external dependencies)
  console.log('Extracting text using heuristic PDF parser...');
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

  // Validate extracted text quality - check for REAL English words
  const commonWords = ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'been', 'being', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'not', 'but', 'what', 'which', 'when', 'where', 'who', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about', 'into', 'over', 'after', 'before', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'only', 'also', 'security', 'report', 'threat', 'risk', 'incident', 'company', 'organization', 'project', 'information'];
  
  const lowerText = extractedText.toLowerCase();
  const foundCommonWords = commonWords.filter(w => lowerText.includes(` ${w} `) || lowerText.startsWith(`${w} `) || lowerText.endsWith(` ${w}`));
  const realWordCount = foundCommonWords.length;
  
  console.log(`Heuristic extraction: ${extractedText.length} chars, found ${realWordCount}/${commonWords.length} common English words`);

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

Deno.serve(async (req) => {
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

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    

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
        
        // Resolve bucket — AEGIS chat uploads land in ai-chat-attachments, not archival-documents
        const preferredBucket = (doc.metadata as any)?.storage_bucket || 'archival-documents';
        const bucketsToTry = Array.from(new Set([preferredBucket, 'ai-chat-attachments', 'archival-documents']));
        let fileData: Blob | null = null;
        let downloadError: any = null;
        for (const bucket of bucketsToTry) {
          const { data, error } = await supabase.storage.from(bucket).download(doc.storage_path);
          if (!error && data) { fileData = data; downloadError = null; break; }
          downloadError = error;
        }
        if (!fileData) {
          throw new Error(`Failed to download file: ${downloadError?.message} (tried: ${bucketsToTry.join(', ')})`);
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
                content = await extractTextWithOCR(fileData, OPENAI_API_KEY);
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
            content = await extractTextFromWord(fileData, OPENAI_API_KEY, doc.filename);
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
    const sampleText = content.slice(0, 100000);

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: `You are an expert security intelligence analyst. Extract structured intelligence from security reports.

KNOWN ENTITIES IN DATABASE:
${entityContext}

${clientContext}

EXTRACT THE FOLLOWING:

1. **ENTITIES** - Extract ALL named people, organizations, locations, infrastructure, groups mentioned anywhere in the report:
   - Extract EVERY person name mentioned, even if only mentioned once
   - Extract EVERY organization, company, group, or collective name
   - Extract EVERY location name (cities, provinces, regions, facilities, landmarks)
   - Match against existing entities when possible
   - Include confidence score (0.0-1.0) - use 0.5+ for names clearly mentioned in the text
   - Provide context where mentioned
   - Do NOT skip names just because they seem minor - extract ALL of them

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
- Extract EVERY named entity in the document - people, organizations, groups, locations, infrastructure
- Do NOT skip entities - it is better to extract too many than too few
- Use confidence 0.5 for entities mentioned once, higher for repeated mentions
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
        if (entity.confidence < 0.3) {
          console.log(`Skipping entity "${entity.name}" - confidence ${entity.confidence} below threshold`);
          continue;
        }

        // Check if entity already exists - validate matched_entity_id is a real UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let matchedEntityId = entity.matched_entity_id && uuidRegex.test(entity.matched_entity_id) 
          ? entity.matched_entity_id 
          : null;
        
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
          matched_entity_id: matchedEntityId || null,
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

        // Generate content hash for dedup
        const signalText = signal.description || '';
        const hashData = new TextEncoder().encode(signalText);
        const hashBuffer = await crypto.subtle.digest('SHA-256', hashData);
        const contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        // Check for duplicate
        const { data: existingSignal } = await supabase
          .from('signals')
          .select('id')
          .eq('content_hash', contentHash)
          .limit(1)
          .maybeSingle();

        if (existingSignal) {
          console.log(`Skipping duplicate signal: ${signal.description?.substring(0, 60)}`);
          continue;
        }

        // Check rejected hashes
        const { data: rejectedHash } = await supabase
          .from('rejected_content_hashes')
          .select('id')
          .eq('content_hash', contentHash)
          .limit(1)
          .maybeSingle();

        if (rejectedHash) {
          console.log(`Skipping rejected signal: ${signal.description?.substring(0, 60)}`);
          continue;
        }

        // Resolve source_id for "News Monitor" or fallback
        let resolvedSourceId: string | null = null;
        const { data: srcRow } = await supabase
          .from('sources')
          .select('id')
          .eq('name', 'News Monitor')
          .limit(1)
          .maybeSingle();
        if (srcRow) resolvedSourceId = srcRow.id;

        // Generate a proper title from description
        const signalTitle = (() => {
          if (!signalText || signalText.length === 0) return 'Security Report Signal';
          const dotPos = signalText.indexOf('.');
          if (dotPos > 0 && dotPos <= 120) return signalText.substring(0, dotPos + 1);
          if (signalText.length > 120) return signalText.substring(0, 117) + '...';
          return signalText;
        })();

        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            title: signalTitle,
            source_id: resolvedSourceId,
            category: signal.category,
            severity: signal.severity || 'medium',
            normalized_text: signal.description,
            content_hash: contentHash,
            location: signal.location,
            confidence: signal.confidence,
            client_id: clientId,
            auto_correlated_entities: entityIds,
            raw_json: {
              source: 'security_report',
              context: signal.context,
              entity_names: signal.entity_names,
              document_id: documentId,
              url: null,
              source_url: null,
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

    // Write document intelligence to expert_knowledge so agents can build beliefs from it.
    // Each document becomes a knowledge entry attributed to 'document:{documentId}'.
    if (content && content.length > 200 && documentId) {
      try {
        const docFilename = (document as any)?.filename || 'document';
        const riskDomain = (() => {
          const ra = intelligence.risk_assessment;
          const deductions = (ra?.deductions || '').toLowerCase();
          if (deductions.includes('cyber') || deductions.includes('malware') || deductions.includes('phish')) return 'cyber_security';
          if (deductions.includes('protest') || deductions.includes('indigenous') || deductions.includes('pipeline')) return 'physical_security';
          if (deductions.includes('travel') || deductions.includes('journey')) return 'travel_security';
          if (deductions.includes('executive') || deductions.includes('vip') || deductions.includes('protection')) return 'executive_protection';
          return 'threat_intelligence';
        })();

        const knowledgeEntries = [
          {
            expert_name: `document:${documentId}`,
            domain: riskDomain,
            subdomain: 'document_intelligence',
            knowledge_type: 'report_analysis',
            title: `Security Report: ${docFilename}`,
            content: content.slice(0, 8000),
            confidence_score: 0.75,
            source_type: 'archival_document',
            source_url: null,
            is_active: true,
          },
        ];

        // Add risk assessment as a separate entry if meaningful
        const riskText = intelligence.risk_assessment?.deductions;
        if (riskText && riskText.length > 100) {
          knowledgeEntries.push({
            expert_name: `document:${documentId}`,
            domain: riskDomain,
            subdomain: 'risk_assessment',
            knowledge_type: 'analytical_conclusion',
            title: `Risk Assessment: ${docFilename}`,
            content: riskText.slice(0, 4000),
            confidence_score: 0.80,
            source_type: 'archival_document',
            source_url: null,
            is_active: true,
          });
        }

        // Delete any prior entries for this document so re-processing replaces them cleanly
        await supabase.from('expert_knowledge').delete().eq('expert_name', `document:${documentId}`);
        const { error: kErr } = await supabase.from('expert_knowledge').insert(knowledgeEntries);
        if (kErr) console.warn('[process-security-report] expert_knowledge write failed (non-fatal):', kErr.message);
        else {
          console.log(`[process-security-report] Wrote ${knowledgeEntries.length} entries to expert_knowledge for agent belief synthesis`);
          // Fire belief synthesis in background so agents pick up this document's intelligence
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          fetch(`${supabaseUrl}/functions/v1/knowledge-synthesizer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ mode: 'beliefs', since_hours: 1, include_human_experts: true }),
          }).catch(() => {});
        }
      } catch (kEx) {
        console.warn('[process-security-report] expert_knowledge pipeline failed (non-fatal):', kEx);
      }
    }

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
