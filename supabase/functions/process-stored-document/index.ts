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
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    console.log(`Downloaded file: ${document.filename}`);

    let textContent = '';
    
    // Extract text based on file type
    if (document.file_type.includes('text') || document.file_type.includes('json')) {
      // Read first 100KB of text files
      const arrayBuffer = await fileData.slice(0, 100 * 1024).arrayBuffer();
      textContent = new TextDecoder().decode(arrayBuffer);
    } else if (document.file_type === 'application/pdf') {
      // For PDFs, we'll just use filename and any existing content
      textContent = document.filename + ' ' + (document.content_text || '');
    }

    console.log(`Extracted ${textContent.length} characters`);

    // Entity detection logic (same as process-archival-documents)
    const entitySuggestions: Array<{
      suggested_name: string;
      suggested_type: string;
      confidence: number;
      context: string;
      source_id: string;
      source_type: string;
    }> = [];

    const sampleText = textContent.slice(0, 500);
    
    // Email pattern
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = sampleText.match(emailPattern) || [];
    
    for (const email of emails.slice(0, 5)) {
      entitySuggestions.push({
        suggested_name: email,
        suggested_type: 'email',
        confidence: 0.9,
        context: `Found in document: ${document.filename}`,
        source_id: documentId,
        source_type: 'archival_document'
      });
    }

    // Phone pattern
    const phonePattern = /\b(\+?1[-.]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    const phones = sampleText.match(phonePattern) || [];
    
    for (const phone of phones.slice(0, 5)) {
      entitySuggestions.push({
        suggested_name: phone,
        suggested_type: 'phone',
        confidence: 0.85,
        context: `Found in document: ${document.filename}`,
        source_id: documentId,
        source_type: 'archival_document'
      });
    }

    // Organization pattern (capitalized words before Inc, Corp, LLC, Ltd)
    const orgPattern = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s+(Inc\.|Corp\.|LLC|Ltd\.?|Corporation|Company)\b/g;
    const orgs = sampleText.match(orgPattern) || [];
    
    for (const org of orgs.slice(0, 5)) {
      entitySuggestions.push({
        suggested_name: org,
        suggested_type: 'organization',
        confidence: 0.8,
        context: `Found in document: ${document.filename}`,
        source_id: documentId,
        source_type: 'archival_document'
      });
    }

    // Person pattern (Title + Name, e.g., "Mr. John Smith", "Dr. Jane Doe")
    const personPattern = /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g;
    const persons = sampleText.match(personPattern) || [];
    
    for (const person of persons.slice(0, 5)) {
      entitySuggestions.push({
        suggested_name: person,
        suggested_type: 'person',
        confidence: 0.75,
        context: `Found in document: ${document.filename}`,
        source_id: documentId,
        source_type: 'archival_document'
      });
    }

    console.log(`Found ${entitySuggestions.length} potential entities`);

    // Insert entity suggestions
    if (entitySuggestions.length > 0) {
      const { error: suggestError } = await supabase
        .from('entity_suggestions')
        .insert(entitySuggestions);

      if (suggestError) {
        console.error('Error inserting entity suggestions:', suggestError);
      }
    }

    // Update document with entity mentions
    const entityNames = entitySuggestions.map(e => e.suggested_name);
    await supabase
      .from('archival_documents')
      .update({
        entity_mentions: entityNames,
        metadata: {
          ...document.metadata,
          entities_processed: true,
          entities_processed_at: new Date().toISOString()
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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
