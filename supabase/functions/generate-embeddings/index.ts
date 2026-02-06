import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getUserFromRequest } from "../_shared/supabase-client.ts";

/**
 * Generate embeddings for archival documents and signals.
 * Chunks text, generates OpenAI embeddings, stores in global_chunks.
 * 
 * Actions:
 *   - embed_document: Embed a specific archival document
 *   - embed_all_documents: Batch embed all unembedded documents
 *   - embed_signals: Embed recent signals for semantic search
 */

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  if (!text || text.length === 0) return chunks;
  
  // Split by paragraphs first for natural boundaries
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from end of previous chunk
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + '\n\n' + para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  
  // If no paragraphs produced chunks, do character-based chunking
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      chunks.push(text.slice(i, i + chunkSize));
    }
  }
  
  return chunks;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000), // Token limit safety
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Embedding API error:', response.status, errText);
    if (response.status === 429) {
      throw new Error('RATE_LIMIT: Embedding API rate limited. Try again shortly.');
    }
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { userId, error: authError } = await getUserFromRequest(req);
    if (!userId) {
      return errorResponse(authError || 'Authentication required', 401);
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const { action, document_id, limit } = await req.json();
    const supabase = createServiceClient();

    if (action === 'embed_document') {
      if (!document_id) return errorResponse('document_id required', 400);

      // Fetch the document
      const { data: doc, error: docErr } = await supabase
        .from('archival_documents')
        .select('id, filename, content_text, summary, keywords, date_of_document')
        .eq('id', document_id)
        .single();

      if (docErr || !doc) return errorResponse('Document not found', 404);
      if (!doc.content_text) return errorResponse('Document has no extracted text', 400);

      // Check if already embedded
      const { data: existingDoc } = await supabase
        .from('global_docs')
        .select('id')
        .eq('source_id', doc.id)
        .eq('source_type', 'archival_document')
        .maybeSingle();

      let globalDocId: string;

      if (existingDoc) {
        globalDocId = existingDoc.id;
        // Delete old chunks for re-embedding
        await supabase.from('global_chunks').delete().eq('doc_id', globalDocId);
      } else {
        // Create global_doc record
        const { data: newDoc, error: insertErr } = await supabase
          .from('global_docs')
          .insert({
            title: doc.filename,
            content: doc.content_text,
            source_type: 'archival_document',
            source_id: doc.id,
            metadata: {
              summary: doc.summary,
              keywords: doc.keywords,
              date_of_document: doc.date_of_document,
            },
          })
          .select('id')
          .single();

        if (insertErr) throw new Error(`Failed to create doc record: ${insertErr.message}`);
        globalDocId = newDoc.id;
      }

      // Chunk and embed
      const chunks = chunkText(doc.content_text);
      let embeddedCount = 0;

      for (let i = 0; i < chunks.length; i++) {
        try {
          const embedding = await generateEmbedding(chunks[i], OPENAI_API_KEY);
          
          await supabase.from('global_chunks').insert({
            doc_id: globalDocId,
            chunk_index: i,
            content: chunks[i],
            embedding: JSON.stringify(embedding),
            metadata: {
              source_filename: doc.filename,
              chunk_of: chunks.length,
              date_of_document: doc.date_of_document,
            },
          });
          embeddedCount++;
        } catch (e) {
          console.error(`Failed to embed chunk ${i}:`, e);
          if ((e as Error).message.includes('RATE_LIMIT')) {
            // Wait and retry once
            await new Promise(r => setTimeout(r, 2000));
            try {
              const embedding = await generateEmbedding(chunks[i], OPENAI_API_KEY);
              await supabase.from('global_chunks').insert({
                doc_id: globalDocId,
                chunk_index: i,
                content: chunks[i],
                embedding: JSON.stringify(embedding),
                metadata: { source_filename: doc.filename },
              });
              embeddedCount++;
            } catch { /* skip this chunk */ }
          }
        }
      }

      return successResponse({
        success: true,
        document_id: doc.id,
        global_doc_id: globalDocId,
        total_chunks: chunks.length,
        embedded_chunks: embeddedCount,
      });
    }

    if (action === 'embed_all_documents') {
      const batchLimit = limit || 10;

      // Find archival documents without embeddings
      const { data: allDocs } = await supabase
        .from('archival_documents')
        .select('id')
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(batchLimit);

      if (!allDocs?.length) return successResponse({ success: true, message: 'No documents to embed', embedded: 0 });

      // Check which are already embedded
      const { data: embeddedDocs } = await supabase
        .from('global_docs')
        .select('source_id')
        .eq('source_type', 'archival_document');

      const embeddedIds = new Set((embeddedDocs || []).map(d => d.source_id));
      const toEmbed = allDocs.filter(d => !embeddedIds.has(d.id));

      let results = { total: toEmbed.length, success: 0, failed: 0 };

      for (const doc of toEmbed) {
        try {
          // Recursively call ourselves for each document
          const { data: docData } = await supabase
            .from('archival_documents')
            .select('id, filename, content_text, summary, keywords, date_of_document')
            .eq('id', doc.id)
            .single();

          if (!docData?.content_text) { results.failed++; continue; }

          const { data: newDoc } = await supabase
            .from('global_docs')
            .insert({
              title: docData.filename,
              content: docData.content_text,
              source_type: 'archival_document',
              source_id: docData.id,
              metadata: {
                summary: docData.summary,
                keywords: docData.keywords,
                date_of_document: docData.date_of_document,
              },
            })
            .select('id')
            .single();

          if (!newDoc) { results.failed++; continue; }

          const chunks = chunkText(docData.content_text);
          for (let i = 0; i < chunks.length; i++) {
            const embedding = await generateEmbedding(chunks[i], OPENAI_API_KEY);
            await supabase.from('global_chunks').insert({
              doc_id: newDoc.id,
              chunk_index: i,
              content: chunks[i],
              embedding: JSON.stringify(embedding),
              metadata: { source_filename: docData.filename },
            });
            // Small delay to avoid rate limits
            if (i % 5 === 4) await new Promise(r => setTimeout(r, 500));
          }
          results.success++;
        } catch (e) {
          console.error(`Failed to embed doc ${doc.id}:`, e);
          results.failed++;
        }
      }

      return successResponse({ success: true, ...results });
    }

    if (action === 'embed_signals') {
      const signalLimit = limit || 50;

      // Get recent signals with text content
      const { data: signals } = await supabase
        .from('signals')
        .select('id, normalized_text, category, severity, location, entity_tags, created_at')
        .not('normalized_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(signalLimit);

      if (!signals?.length) return successResponse({ success: true, message: 'No signals to embed', embedded: 0 });

      // Check already embedded
      const { data: embeddedSignals } = await supabase
        .from('global_docs')
        .select('source_id')
        .eq('source_type', 'signal');

      const embeddedIds = new Set((embeddedSignals || []).map(d => d.source_id));
      const toEmbed = signals.filter(s => !embeddedIds.has(s.id));

      let results = { total: toEmbed.length, success: 0, failed: 0 };

      for (const signal of toEmbed) {
        try {
          const signalText = `[${signal.category || 'uncategorized'}] ${signal.normalized_text}`;

          const { data: newDoc } = await supabase
            .from('global_docs')
            .insert({
              title: `Signal: ${signal.normalized_text?.substring(0, 80)}`,
              content: signalText,
              source_type: 'signal',
              source_id: signal.id,
              metadata: {
                category: signal.category,
                severity: signal.severity,
                location: signal.location,
                entity_tags: signal.entity_tags,
              },
            })
            .select('id')
            .single();

          if (!newDoc) { results.failed++; continue; }

          // Signals are typically short, single chunk
          const embedding = await generateEmbedding(signalText, OPENAI_API_KEY);
          await supabase.from('global_chunks').insert({
            doc_id: newDoc.id,
            chunk_index: 0,
            content: signalText,
            embedding: JSON.stringify(embedding),
            metadata: {
              signal_id: signal.id,
              category: signal.category,
              severity: signal.severity,
            },
          });
          results.success++;

          // Rate limit protection
          if (results.success % 10 === 0) await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.error(`Failed to embed signal ${signal.id}:`, e);
          results.failed++;
        }
      }

      return successResponse({ success: true, ...results });
    }

    return errorResponse('Invalid action. Use: embed_document, embed_all_documents, embed_signals', 400);
  } catch (error) {
    console.error('Error in generate-embeddings:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
