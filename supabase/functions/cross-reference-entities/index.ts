import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

async function extractNamesFromPDF(base64Data: string, columnName: string): Promise<string[]> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    throw new Error('LOVABLE_API_KEY not configured for PDF parsing');
  }

  // Extract the base64 content
  const pdfBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a document parser specializing in extracting names from documents. 
Extract all person names, organization names, or entity names from the document.
Focus on names that appear in lists, tables, or as subjects of the document.
If a specific column or field named "${columnName}" exists, prioritize names from there.
Return ONLY a JSON array of strings containing the names, nothing else.
Example: ["John Smith", "Acme Corporation", "Jane Doe"]`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract all names from this PDF document. Look for any column or section labeled "${columnName}" if present.`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${pdfBase64}`
              }
            }
          ]
        }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI Gateway error:', response.status, errorText);
    throw new Error(`Failed to parse PDF: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '[]';
  
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse AI response as JSON:', content);
    return content.split('\n')
      .map((line: string) => line.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((line: string) => line.length > 0 && line.length < 100);
  }
}

function extractNamesFromExcel(bytes: Uint8Array, columnName: string): string[] {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(firstSheet);

  console.log(`Parsed ${data.length} rows from Excel file`);

  const names: string[] = [];
  for (const row of data) {
    const rowData = row as Record<string, any>;
    const name = rowData[columnName];
    if (name && typeof name === 'string') {
      names.push(name.trim());
    }
  }
  return names;
}

// Import xlsx dynamically
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { fileData, columnName, fileType } = await req.json();

    if (!fileData) {
      throw new Error('No file data provided');
    }

    const supabaseClient = createServiceClient();

    let names: string[] = [];
    const isPDF = fileType === 'application/pdf' || fileData.includes('data:application/pdf');

    if (isPDF) {
      console.log('Processing PDF file with AI extraction');
      names = await extractNamesFromPDF(fileData, columnName);
    } else {
      console.log('Processing Excel file');
      // Convert base64 to array buffer for Excel
      const base64Data = fileData.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      names = extractNamesFromExcel(bytes, columnName);
    }

    console.log(`Extracted ${names.length} names to check`);

    // Fetch all entities for comparison
    const { data: entities, error: entitiesError } = await supabaseClient
      .from('entities')
      .select('id, name, type, risk_level, aliases')
      .eq('is_active', true);

    if (entitiesError) {
      throw entitiesError;
    }

    console.log(`Checking against ${entities?.length || 0} entities`);

    // Cross-reference names with entities using fuzzy matching
    const results = names.map(name => {
      const nameLower = name.toLowerCase().trim();
      
      // Check for exact name match or alias match
      const matchedEntity = entities?.find(entity => {
        const entityNameLower = entity.name.toLowerCase().trim();
        
        // Exact match
        if (entityNameLower === nameLower) {
          return true;
        }
        
        // Partial match (name contains or is contained)
        if (entityNameLower.includes(nameLower) || nameLower.includes(entityNameLower)) {
          return true;
        }
        
        // Check aliases
        if (entity.aliases) {
          return entity.aliases.some((alias: string) => {
            const aliasLower = alias.toLowerCase().trim();
            return aliasLower === nameLower || 
                   aliasLower.includes(nameLower) || 
                   nameLower.includes(aliasLower);
          });
        }
        
        return false;
      });

      if (matchedEntity) {
        return {
          name,
          matched: true,
          entityId: matchedEntity.id,
          entityName: matchedEntity.name,
          entityType: matchedEntity.type,
          riskLevel: matchedEntity.risk_level
        };
      }

      return {
        name,
        matched: false
      };
    });

    const matchCount = results.filter(r => r.matched).length;
    console.log(`Found ${matchCount} matches out of ${names.length} names`);

    return successResponse({
      success: true,
      results,
      summary: {
        total: names.length,
        matched: matchCount,
        unmatched: names.length - matchCount
      }
    });

  } catch (error) {
    console.error('Cross-reference error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
