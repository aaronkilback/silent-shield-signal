import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rules-based classification
const RULES = {
  p1: {
    keywords: ['credible threat', 'weapon', 'kidnap', 'active shooter', 'bomb'],
    severity: 'critical',
    priority: 'p1',
    shouldOpenIncident: true
  },
  p2: {
    keywords: ['suspicious', 'prowler', 'tamper', 'breach attempt', 'intrusion'],
    severity: 'high',
    priority: 'p2',
    shouldOpenIncident: true
  }
};

function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p1.severity,
        priority: RULES.p1.priority,
        shouldOpenIncident: RULES.p1.shouldOpenIncident,
        matchedRule: 'p1',
        matchedKeyword: keyword
      };
    }
  }
  
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p2.severity,
        priority: RULES.p2.priority,
        shouldOpenIncident: RULES.p2.shouldOpenIncident,
        matchedRule: 'p2',
        matchedKeyword: keyword
      };
    }
  }
  
  return {
    severity: null,
    priority: null,
    shouldOpenIncident: false,
    matchedRule: null,
    matchedKeyword: null
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file, filename, mimeType, location } = await req.json();
    
    if (!file || !filename) {
      return new Response(
        JSON.stringify({ error: 'File and filename are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing document:', filename, mimeType);

    // Check file size before processing (15MB limit due to memory constraints)
    const estimatedSize = (file.length * 3) / 4; // Base64 to bytes approximation
    const MAX_SIZE = 15 * 1024 * 1024; // 15MB
    
    if (estimatedSize > MAX_SIZE) {
      console.error(`File too large: ${(estimatedSize / 1024 / 1024).toFixed(2)}MB`);
      return new Response(
        JSON.stringify({ 
          error: `File too large (${(estimatedSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 15MB due to processing memory limits. Please use the Archival Upload feature for larger documents.`
        }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 file
    let binaryData: Uint8Array;
    try {
      binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    } catch (decodeError) {
      console.error('Base64 decode error:', decodeError);
      return new Response(
        JSON.stringify({ error: 'Invalid file encoding' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    let text = '';

    // Handle different file types
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown' || filename.endsWith('.txt') || filename.endsWith('.csv') || filename.endsWith('.md')) {
      text = new TextDecoder().decode(binaryData);
    } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      // For PDFs, avoid full text extraction to prevent memory issues
      // Just create a basic signal with metadata
      text = `PDF document uploaded: ${filename}. Size: ${(binaryData.length / 1024).toFixed(1)}KB. Use Archival Upload for full content extraction.`;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      const docxText = new TextDecoder().decode(binaryData);
      text = docxText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        text = `DOCX document: ${filename}. Raw content length: ${binaryData.length} bytes. Manual review recommended.`;
      }
    } else {
      text = `Document uploaded: ${filename} (${mimeType}). Size: ${binaryData.length} bytes. Manual review required.`;
    }

    console.log('Extracted text length:', text.length);

    // Limit text to prevent memory issues (5MB max)
    const MAX_TEXT_LENGTH = 5000000;
    if (text.length > MAX_TEXT_LENGTH) {
      console.log(`Text too large (${text.length} chars), truncating to ${MAX_TEXT_LENGTH}`);
      text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Document truncated - full content exceeds 5MB processing limit. Consider splitting large documents.]';
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Apply rules-based classification
    const rulesResult = applyRules(text);
    console.log('Rules classification:', rulesResult);

    // Get all clients for matching
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, monitoring_keywords')
      .eq('status', 'active');

    // Simple client matching based on keywords
    let matchedClientId = null;
    if (clients && clients.length > 0) {
      for (const client of clients) {
        const keywords = client.monitoring_keywords || [];
        const clientNameLower = client.name.toLowerCase();
        const textLower = text.toLowerCase();
        
        if (textLower.includes(clientNameLower)) {
          matchedClientId = client.id;
          console.log('Client matched by name:', client.name);
          break;
        }
        
        for (const keyword of keywords) {
          if (textLower.includes(keyword.toLowerCase())) {
            matchedClientId = client.id;
            console.log('Client matched by keyword:', keyword);
            break;
          }
        }
        
        if (matchedClientId) break;
      }
    }

    // Insert the signal
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .insert({
        normalized_text: text,
        location: location || null,
        category: 'document_upload',
        severity: rulesResult.severity || 'low',
        confidence: 0.7,
        client_id: matchedClientId,
        raw_json: {
          source: 'document_upload',
          filename: filename,
          mimeType: mimeType,
          rulesMatched: rulesResult.matchedRule,
          matchedKeyword: rulesResult.matchedKeyword,
        },
        status: 'new',
        is_test: false,
      })
      .select()
      .single();

    if (signalError) {
      console.error('Error creating signal:', signalError);
      throw signalError;
    }

    console.log('Signal created:', signal.id);

    // Check for entity mentions
    const { data: entities } = await supabase
      .from('entities')
      .select('id, name, aliases')
      .eq('is_active', true);

    if (entities && entities.length > 0) {
      const textLower = text.toLowerCase();
      const mentions = [];

      for (const entity of entities) {
        const names = [entity.name, ...(entity.aliases || [])];
        for (const name of names) {
          if (textLower.includes(name.toLowerCase())) {
            mentions.push({
              entity_id: entity.id,
              signal_id: signal.id,
              confidence: 0.8,
              context: text.substring(0, 500),
            });
            console.log('Entity mention detected:', entity.name);
            break;
          }
        }
      }

      if (mentions.length > 0) {
        await supabase.from('entity_mentions').insert(mentions);
      }
    }

    // Auto-open incident if rules match
    if (rulesResult.shouldOpenIncident) {
      console.log('Auto-opening incident for signal:', signal.id);
      
      const { error: incidentError } = await supabase
        .from('incidents')
        .insert({
          signal_id: signal.id,
          client_id: matchedClientId,
          priority: rulesResult.priority || 'p3',
          status: 'open',
          opened_at: new Date().toISOString(),
          is_test: false,
        });

      if (incidentError) {
        console.error('Error creating incident:', incidentError);
      }
    }

    console.log('Document processed successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Document processed and signal created',
        signalId: signal.id,
        clientMatched: matchedClientId ? true : false,
        incidentCreated: rulesResult.shouldOpenIncident
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in parse-document function:', error);
    
    // Check if it's a memory error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isMemoryError = errorMessage.toLowerCase().includes('memory') || 
                          errorMessage.toLowerCase().includes('out of range') ||
                          errorMessage.toLowerCase().includes('out of memory');
    
    if (isMemoryError) {
      console.error('Memory limit exceeded during document processing');
    }
    
    return new Response(
      JSON.stringify({ 
        error: isMemoryError 
          ? 'Document too large to process in memory. Please use the Archival Upload feature for large documents (supports up to 100MB with advanced processing).' 
          : errorMessage 
      }),
      { 
        status: isMemoryError ? 413 : 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
