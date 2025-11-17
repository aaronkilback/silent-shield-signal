import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileData, columnName } = await req.json();

    if (!fileData) {
      throw new Error('No file data provided');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Convert base64 to array buffer
    const base64Data = fileData.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Parse Excel file
    const workbook = XLSX.read(bytes, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet);

    console.log(`Parsed ${data.length} rows from Excel file`);

    // Extract names from specified column
    const names: string[] = [];
    for (const row of data) {
      const rowData = row as Record<string, any>;
      const name = rowData[columnName];
      if (name && typeof name === 'string') {
        names.push(name.trim());
      }
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

    // Cross-reference names with entities
    const results = names.map(name => {
      const nameLower = name.toLowerCase();
      
      // Check for exact name match or alias match
      const matchedEntity = entities?.find(entity => {
        if (entity.name.toLowerCase() === nameLower) {
          return true;
        }
        
        // Check aliases
        if (entity.aliases) {
          return entity.aliases.some((alias: string) => 
            alias.toLowerCase() === nameLower
          );
        }
        
        return false;
      });

      if (matchedEntity) {
        return {
          name,
          matched: true,
          entityId: matchedEntity.id,
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

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: {
          total: names.length,
          matched: matchCount,
          unmatched: names.length - matchCount
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Cross-reference error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
