import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Download file from storage (first 100KB for entity detection)
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('archival-documents')
      .download(document.storage_path);

    if (downloadError) {
      console.error(`Storage download error for ${document.filename}:`, downloadError);
      
      // If file doesn't exist in storage, mark as processed to avoid retry loops
      if (downloadError.message?.includes('not found') || downloadError.message?.includes('does not exist')) {
        await supabase
          .from('archival_documents')
          .update({
            metadata: {
              ...document.metadata,
              entities_processed: true,
              processing_error: 'File not found in storage',
              processed_at: new Date().toISOString()
            }
          })
          .eq('id', documentId);
        
        return new Response(
          JSON.stringify({ 
            error: 'File not found in storage',
            documentId 
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    console.log(`Downloaded file: ${document.filename}`);

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
      
      const arrayBuffer = await fileData.slice(0, 500 * 1024).arrayBuffer(); // Limit to 500KB
      
      // For .docx files (ZIP-based Office Open XML)
      if (document.file_type.includes('openxmlformats')) {
        try {
          // Import JSZip for unzipping .docx
          const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
          const zip = await JSZip.loadAsync(arrayBuffer);
          
          // Extract document.xml which contains the text content
          const documentXml = await zip.file('word/document.xml')?.async('string');
          
          if (documentXml) {
            // Extract text between XML tags
            const textMatches = documentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
            if (textMatches) {
              textContent = textMatches
                .map(match => match.replace(/<[^>]+>/g, ''))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 50000);
              
              console.log(`Extracted ${textContent.length} characters from Word document`);
            }
          }
        } catch (error) {
          console.error('Error extracting Word document:', error);
          textContent = '';
        }
      } else {
        // For older .doc files, try basic text extraction
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
      
      const arrayBuffer = await fileData.slice(0, 500 * 1024).arrayBuffer(); // Limit to 500KB
      
      // For .xlsx files (ZIP-based Office Open XML)
      if (document.file_type.includes('openxmlformats')) {
        try {
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
                .slice(0, 50000);
              
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
                  .slice(0, 50000);
                
                console.log(`Extracted ${textContent.length} characters from Excel worksheet`);
              }
            }
          }
        } catch (error) {
          console.error('Error extracting Excel document:', error);
          textContent = '';
        }
      } else {
        // For older .xls files, try basic text extraction
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
      
      // Limit PDF read to first 200KB to prevent memory issues
      const arrayBuffer = await fileData.slice(0, 200 * 1024).arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const pdfString = new TextDecoder('latin1').decode(uint8Array);
      
      // Extract text between BT (Begin Text) and ET (End Text) markers
      const textMatches = pdfString.match(/BT(.*?)ET/gs);
      if (textMatches && textMatches.length > 0) {
        let extractedText = '';
        for (const match of textMatches.slice(0, 500)) { // Limit to first 500 text blocks
          const parenStrings = match.match(/\(([^)]*)\)/g);
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
          .replace(/[^\x20-\x7E\s]/g, '')
          .trim()
          .slice(0, 50000); // Hard limit at 50K chars
        
        console.log(`Extracted ${textContent.length} characters from PDF text streams`);
      } else {
        textContent = pdfString
          .replace(/[\x00-\x1F\x7F-\xFF]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50000);
        console.log(`Fallback: extracted ${textContent.length} characters`);
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
            ...document.metadata,
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

4. **EVENTS** (Temporal intelligence):
   ✓ Protests, demonstrations, rallies
   ✓ Public meetings, hearings, consultations
   ✓ Conferences, symposiums, webinars
   ✓ Press conferences, media events
   ✓ Research presentations, paper publications
   ✓ Legal actions, court cases, regulatory proceedings

5. **INITIATIVES & CAMPAIGNS** (Strategic activity):
   ✓ Research programs and studies
   ✓ Advocacy campaigns and movements
   ✓ Monitoring projects and watchdog activities
   ✓ Legal challenges and regulatory interventions
   ✓ Public awareness/education campaigns
   ✓ Petition drives, letter-writing campaigns

6. **CLAIMS, CONCERNS & ALLEGATIONS** (Intelligence content):
   ✓ Health impacts claimed (specific conditions, populations affected)
   ✓ Environmental concerns (pollution, contamination, ecosystem damage)
   ✓ Safety issues and risks identified
   ✓ Regulatory violations alleged
   ✓ Corporate misconduct claims
   ✓ Transparency/accountability concerns
   ✓ Indigenous rights violations alleged

7. **INFRASTRUCTURE & TECHNICAL** (Cyber/physical):
   ✓ Domains, websites, IP addresses
   ✓ Email addresses, phone numbers
   ✓ Physical infrastructure (pipelines, towers, facilities)
   ✓ Systems, networks, software platforms
   ✓ Vehicles (if identified)

8. **STRATEGIC RELATIONSHIPS** (Network intelligence):
   ✓ Funding relationships (who funds whom)
   ✓ Partnerships and collaborations
   ✓ Opposition dynamics (who opposes whom)
   ✓ Support networks (who supports whom)
   ✓ Employment/affiliation connections
   ✓ Co-authorship and joint initiatives

9. **DOCUMENTS & EVIDENCE** (Referenced materials):
   ✓ Studies, reports, white papers cited
   ✓ Legal documents, permits, filings
   ✓ Media articles, press releases
   ✓ Letters, submissions, testimonies
   ✓ Scientific papers, research publications

10. **KEY NARRATIVE ELEMENTS** (Strategic framing):
    ✓ Main arguments being made
    ✓ Evidence presented (studies, data, testimony)
    ✓ Tactics employed (legal, media, grassroots)
    ✓ Goals and objectives stated
    ✓ Timelines and deadlines mentioned

═══════════════════════════════════════════════════════════
🎯 ANALYSIS APPROACH (Think like an intelligence analyst)
═══════════════════════════════════════════════════════════

FOR EACH ENTITY EXTRACTED:
1. **Name**: Use full, formal name with credentials
2. **Type**: Most specific applicable type
3. **Confidence**: Be realistic but inclusive (>= ${adjustedThreshold.toFixed(2)})
4. **Context**: Rich, descriptive context explaining:
   - What they're doing in this document
   - Their position/stance
   - Their significance
   - Key quotes or actions attributed to them
5. **Aliases**: Variations, acronyms, short forms
6. **Attributes**: Any additional intelligence (roles, affiliations, positions)

FOR RELATIONSHIPS:
- Map connections explicitly (A funds B, C opposes D)
- Note the nature and strength of relationships
- Capture temporal aspects (when relationships formed/ended)

STRATEGIC EXTRACTION RULES:
✅ **Be Comprehensive**: Extract EVERYTHING that provides intelligence value
✅ **Capture Context**: Don't just extract names, extract their significance
✅ **Full Credentials**: Always include titles, degrees, organizational affiliations
✅ **Network Mapping**: Identify all connections and relationships
✅ **Position Analysis**: Note whether entities support/oppose/are neutral
✅ **Evidence Chain**: Track who cites what evidence
✅ **Temporal Awareness**: Note when things happened or are planned

❌ **Only Skip**:
- Generic role terms without names ("a researcher", "the manager")
- Common words that happen to be capitalized
- Document formatting artifacts
- Your own analytical comments

INTELLIGENCE PRIORITY:
🔴 HIGH: Opposition actors, coordinated campaigns, legal threats, media strategies
🟡 MEDIUM: Academic research, community concerns, regulatory engagement
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
                        name: { type: "string", description: "Entity name" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
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
              ...document.metadata,
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
          ...document.metadata,
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
