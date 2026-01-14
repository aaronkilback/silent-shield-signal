-- =====================================================
-- SECURITY FIX: Replace overly permissive "Service role" policies
-- These policies incorrectly used "public" role instead of "service_role"
-- =====================================================

-- 1. ARCHIVAL_DOCUMENTS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage archival documents" ON public.archival_documents;
CREATE POLICY "Service role can manage archival documents"
ON public.archival_documents FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. DOCUMENT_ENTITY_MENTIONS: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to doc_entity_mentions" ON public.document_entity_mentions;
CREATE POLICY "Service role can manage document entity mentions"
ON public.document_entity_mentions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 3. DOCUMENT_HASHES: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage document hashes" ON public.document_hashes;
CREATE POLICY "Service role manages document hashes"
ON public.document_hashes FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. DUPLICATE_DETECTIONS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage duplicate detections" ON public.duplicate_detections;
CREATE POLICY "Service role manages duplicate detections"
ON public.duplicate_detections FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5. ENTITY_CONTENT: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage entity content" ON public.entity_content;
CREATE POLICY "Service role manages entity content"
ON public.entity_content FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 6. ENTITY_MENTIONS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage mentions" ON public.entity_mentions;
CREATE POLICY "Service role manages entity mentions"
ON public.entity_mentions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 7. ENTITY_NOTIFICATIONS: Fix service role policy
DROP POLICY IF EXISTS "Service role can create notifications" ON public.entity_notifications;
CREATE POLICY "Service role manages entity notifications"
ON public.entity_notifications FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 8. ENTITY_RELATIONSHIPS: Fix service role policy (keep the good ones we created, fix the service one)
DROP POLICY IF EXISTS "Service role can manage all relationships" ON public.entity_relationships;
CREATE POLICY "Service role manages entity relationships"
ON public.entity_relationships FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 9. ENTITY_SUGGESTIONS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage entity suggestions" ON public.entity_suggestions;
CREATE POLICY "Service role manages entity suggestions"
ON public.entity_suggestions FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 10. FEEDBACK_EVENTS: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to feedback_events" ON public.feedback_events;
CREATE POLICY "Service role manages feedback events"
ON public.feedback_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 11. INCIDENT_ENTITIES: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to incident_entities" ON public.incident_entities;
CREATE POLICY "Service role manages incident entities"
ON public.incident_entities FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 12. INCIDENT_SIGNALS: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to incident_signals" ON public.incident_signals;
CREATE POLICY "Service role manages incident signals"
ON public.incident_signals FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 13. INGESTED_DOCUMENTS: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to ingested_documents" ON public.ingested_documents;
CREATE POLICY "Service role manages ingested documents"
ON public.ingested_documents FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 14. INTELLIGENCE_CONFIG: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to intelligence_config" ON public.intelligence_config;
CREATE POLICY "Service role manages intelligence config"
ON public.intelligence_config FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 15. KNOWLEDGE_BASE_ARTICLES: Fix service role policy
DROP POLICY IF EXISTS "Service role can access articles" ON public.knowledge_base_articles;
CREATE POLICY "Service role manages knowledge base articles"
ON public.knowledge_base_articles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 16. KNOWLEDGE_BASE_CATEGORIES: Fix policy - keep public read but restrict write
DROP POLICY IF EXISTS "Anyone can view published categories" ON public.knowledge_base_categories;
CREATE POLICY "Authenticated users can view knowledge base categories"
ON public.knowledge_base_categories FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role manages knowledge base categories"
ON public.knowledge_base_categories FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 17. LEARNING_PROFILES: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to learning_profiles" ON public.learning_profiles;
CREATE POLICY "Service role manages learning profiles"
ON public.learning_profiles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 18. MONITORING_HISTORY: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage monitoring history" ON public.monitoring_history;
CREATE POLICY "Service role manages monitoring history"
ON public.monitoring_history FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 19. NOTIFICATION_PREFERENCES: Fix service role policy (for edge functions)
DROP POLICY IF EXISTS "Service role can read notification preferences" ON public.notification_preferences;
CREATE POLICY "Service role manages notification preferences"
ON public.notification_preferences FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 20. PROCESSING_QUEUE: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage queue" ON public.processing_queue;
CREATE POLICY "Service role manages processing queue"
ON public.processing_queue FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 21. SIGNAL_CORRELATION_GROUPS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage correlation groups" ON public.signal_correlation_groups;
CREATE POLICY "Service role manages signal correlation groups"
ON public.signal_correlation_groups FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 22. SIGNAL_DOCUMENTS: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to signal_documents" ON public.signal_documents;
CREATE POLICY "Service role manages signal documents"
ON public.signal_documents FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 23. SIGNAL_MERGE_PROPOSALS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage merge proposals" ON public.signal_merge_proposals;
CREATE POLICY "Service role manages signal merge proposals"
ON public.signal_merge_proposals FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 24. SOURCE_RELIABILITY_METRICS: Fix service role policy
DROP POLICY IF EXISTS "Service role can manage source reliability" ON public.source_reliability_metrics;
CREATE POLICY "Service role manages source reliability metrics"
ON public.source_reliability_metrics FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 25. SOURCES: Fix service role policy
DROP POLICY IF EXISTS "Service role full access to sources" ON public.sources;
CREATE POLICY "Service role manages sources"
ON public.sources FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 26. AUTOMATION_METRICS: Fix service role policy (already had service_role but let's ensure it's correct)
DROP POLICY IF EXISTS "Service role can manage metrics" ON public.automation_metrics;
CREATE POLICY "Service role manages automation metrics"
ON public.automation_metrics FOR ALL
TO service_role
USING (true)
WITH CHECK (true);