import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import JSZip from "npm:jszip@3.10.1";

const RULES = {
  p1: { keywords: ['credible threat', 'weapon', 'kidnap', 'active shooter', 'bomb'], severity: 'critical', priority: 'p1', shouldOpenIncident: true },
  p2: { keywords: ['suspicious', 'prowler', 'tamper', 'breach attempt', 'intrusion'], severity: 'high', priority: 'p2', shouldOpenIncident: true }
};

function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return { severity: RULES.p1.severity, priority: RULES.p1.priority, shouldOpenIncident: RULES.p1.shouldOpenIncident, matchedRule: 'p1', matchedKeyword: keyword };
    }
  }
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return { severity: RULES.p2.severity, priority: RULES.p2.priority, shouldOpenIncident: RULES.p2.shouldOpenIncident, matchedRule: 'p2', matchedKeyword: keyword };
    }
  }
  return { severity: null, priority: null, shouldOpenIncident: false, matchedRule: null, matchedKeyword: null };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { file, filename, mimeType, location, client_id: explicitClientId } = await req.json();
    
    if (!file || !filename) {
      return errorResponse('File and filename are required', 400);
    }

    console.log('Processing document:', filename, mimeType);

    const estimatedSize = (file.length * 3) / 4;
    const isPDF = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
    const MAX_SIZE = isPDF ? 10 * 1024 * 1024 : 8 * 1024 * 1024;
    
    if (estimatedSize > MAX_SIZE) {
      return successResponse({ error: `File too large. Maximum size is ${isPDF ? '10MB' : '8MB'}. Please use Archival Upload.`, success: false });
    }

    let binaryData: Uint8Array;
    try {
      const decoded = atob(file);
      binaryData = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) binaryData[i] = decoded.charCodeAt(i);
    } catch (decodeError) {
      return successResponse({ error: 'Invalid file encoding', success: false });
    }

    let text = '';

    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown' || filename.endsWith('.txt') || filename.endsWith('.csv') || filename.endsWith('.md')) {
      text = new TextDecoder().decode(binaryData);
    } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      text = `PDF document uploaded: ${filename}. Size: ${(binaryData.length / 1024).toFixed(1)}KB. Use Archival Upload for full content extraction.`;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      try {
        const zip = await JSZip.loadAsync(binaryData);
        const documentXml = await zip.file('word/document.xml')?.async('string');
        if (documentXml) {
          text = documentXml.replace(/<w:p[^>]*>/g, '\n').replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n\s*\n/g, '\n\n').trim();
        } else {
          text = `DOCX document: ${filename}. Could not extract content.`;
        }
      } catch (zipError) {
        text = `DOCX document: ${filename}. Extraction failed. Manual review recommended.`;
      }
    } else {
      text = `Document uploaded: ${filename} (${mimeType}). Size: ${binaryData.length} bytes. Manual review required.`;
    }

    const MAX_TEXT_LENGTH = 5000000;
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Document truncated]';
    }

    const supabase = createServiceClient();
    const rulesResult = applyRules(text);

    let matchedClientId = explicitClientId || null;
    
    if (explicitClientId) {
      const { data: clientCheck } = await supabase.from('clients').select('id, name').eq('id', explicitClientId).single();
      if (!clientCheck) matchedClientId = null;
    }
    
    if (!matchedClientId) {
      const { data: clients } = await supabase.from('clients').select('id, name, monitoring_keywords').eq('status', 'active');
      if (clients) {
        for (const client of clients) {
          const textLower = text.toLowerCase();
          if (textLower.includes(client.name.toLowerCase())) { matchedClientId = client.id; break; }
          for (const keyword of client.monitoring_keywords || []) {
            if (textLower.includes(keyword.toLowerCase())) { matchedClientId = client.id; break; }
          }
          if (matchedClientId) break;
        }
      }
    }

    // Generate title from document text (first sentence or first 100 chars)
    const docTitle = (() => {
      if (!text || text.length === 0) return `Document Upload: ${filename}`;
      const dotPos = text.indexOf('.');
      if (dotPos > 0 && dotPos <= 100) return text.substring(0, dotPos + 1);
      if (text.length > 100) return text.substring(0, 97) + '...';
      return text;
    })();

    const { data: signal, error: signalError } = await supabase.from('signals').insert({
      title: docTitle,
      normalized_text: text, location: location || null, category: 'document_upload',
      severity: rulesResult.severity || 'low', confidence: 0.7, client_id: matchedClientId,
      raw_json: { source: 'document_upload', filename, mimeType, rulesMatched: rulesResult.matchedRule, matchedKeyword: rulesResult.matchedKeyword },
      status: 'new', is_test: false
    }).select().single();

    if (signalError) throw signalError;

    const { data: entities } = await supabase.from('entities').select('id, name, aliases').eq('is_active', true);
    if (entities) {
      const textLower = text.toLowerCase();
      const mentions = [];
      for (const entity of entities) {
        for (const name of [entity.name, ...(entity.aliases || [])]) {
          if (textLower.includes(name.toLowerCase())) {
            mentions.push({ entity_id: entity.id, signal_id: signal.id, confidence: 0.8, context: text.substring(0, 500) });
            break;
          }
        }
      }
      if (mentions.length > 0) await supabase.from('entity_mentions').insert(mentions);
    }

    if (rulesResult.shouldOpenIncident) {
      await supabase.from('incidents').insert({
        signal_id: signal.id, client_id: matchedClientId, priority: rulesResult.priority || 'p3',
        status: 'open', opened_at: new Date().toISOString(), is_test: false
      });
    }

    return successResponse({ success: true, message: 'Document processed', signalId: signal.id, clientMatched: !!matchedClientId, incidentCreated: rulesResult.shouldOpenIncident });
  } catch (error) {
    console.error('Error in parse-document:', error);
    return successResponse({ error: error instanceof Error ? error.message : 'Unknown error', success: false });
  }
});
