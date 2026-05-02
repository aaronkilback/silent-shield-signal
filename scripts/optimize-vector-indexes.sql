-- ── Vector index optimization ──────────────────────────────────────────────
-- Replaces IVFFLAT(lists=50) with HNSW on the chat-memory tables and adds
-- HNSW where missing. HNSW beats IVFFLAT on recall+latency at every scale
-- we care about, and IVFFLAT lists=50 with very few rows performs near-
-- linear-scan. Every chat turn does a vector recall, so this is hot path.
--
-- Run this in the Supabase SQL Editor.
--
-- CONCURRENTLY can't run inside a transaction; the SQL Editor wraps each
-- statement separately, so as long as you DON'T paste this inside a BEGIN;
-- block the CONCURRENTLY clauses will work. If your dashboard runs the
-- whole thing in one txn, drop the CONCURRENTLY keywords (you'll briefly
-- block writes during build, but the tables are tiny).
-- ───────────────────────────────────────────────────────────────────────────

-- §1 — agent_conversation_memory (chat episodic memory)
-- Was: ivfflat lists=50. Switch to HNSW for sub-ms ANN at low cardinality.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_agent_conversation_memory_embedding;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_agent_conv_memory_embedding;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_conv_memory_embedding_hnsw
  ON public.agent_conversation_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- §2 — agent_chat_beliefs (chat semantic beliefs)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_agent_chat_beliefs_embedding;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_agent_chat_beliefs_claim_embedding;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_chat_beliefs_embedding_hnsw
  ON public.agent_chat_beliefs
  USING hnsw (claim_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- §3 — Anything else the audit flagged with no ANN index. Safe to run
-- because of IF NOT EXISTS — if the index already exists this is a no-op.
-- Add tables here if the audit shows them as `— NONE —`.

-- signals.content_embedding → already HNSW per migration 20260401000010
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_content_embedding_hnsw
  ON public.signals
  USING hnsw (content_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- expert_knowledge.embedding → already HNSW
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expert_knowledge_embedding_hnsw
  ON public.expert_knowledge
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- agent_specialty_embeddings.embedding → already HNSW
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_spec_embedding_hnsw
  ON public.agent_specialty_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- agent_investigation_memory.embedding → already HNSW
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_inv_memory_embedding_hnsw
  ON public.agent_investigation_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- §4 — ANALYZE so the planner sees the new indexes immediately
ANALYZE public.agent_conversation_memory;
ANALYZE public.agent_chat_beliefs;
ANALYZE public.signals;
ANALYZE public.expert_knowledge;
ANALYZE public.agent_specialty_embeddings;
ANALYZE public.agent_investigation_memory;

-- §5 — Verify (paste this output back to me)
SELECT
  c.relname AS tablename,
  i.relname AS indexname,
  am.amname AS method,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_index x
JOIN pg_class c ON c.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE am.amname IN ('hnsw','ivfflat')
  AND n.nspname = 'public'
ORDER BY tablename, indexname;
