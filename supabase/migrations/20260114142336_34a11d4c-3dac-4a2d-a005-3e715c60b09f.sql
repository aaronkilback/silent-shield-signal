-- =====================================================
-- SECURITY FIX: Tighten RLS Policies on Sensitive Tables
-- Drop ALL existing policies first, then create secure ones
-- =====================================================

-- 1. NOTIFICATION_PREFERENCES: Drop all existing policies
DROP POLICY IF EXISTS "Users can view notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can update notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can insert notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can delete notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Authenticated users can view notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Authenticated users can manage notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can only view their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can only insert their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can only update their own notification preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can only delete their own notification preferences" ON public.notification_preferences;

-- Create secure notification_preferences policies
CREATE POLICY "Users can only view their own notification preferences"
ON public.notification_preferences FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own notification preferences"
ON public.notification_preferences FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own notification preferences"
ON public.notification_preferences FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own notification preferences"
ON public.notification_preferences FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 2. PROFILES: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can only view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Create secure profiles policies
CREATE POLICY "Users can view own or admin can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  auth.uid() = id 
  OR public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Users can update own profile only"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile only"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 3. DOCUMENT_ENTITY_MENTIONS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Users can view document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Analysts can view document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Only admins and analysts can view document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Only admins and analysts can insert document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Only admins and analysts can update document entity mentions" ON public.document_entity_mentions;
DROP POLICY IF EXISTS "Only admins and analysts can delete document entity mentions" ON public.document_entity_mentions;

-- Create secure document_entity_mentions policies
CREATE POLICY "Admins and analysts can view document entity mentions"
ON public.document_entity_mentions FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert document entity mentions"
ON public.document_entity_mentions FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update document entity mentions"
ON public.document_entity_mentions FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can delete document entity mentions"
ON public.document_entity_mentions FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

-- 4. MONITORING_HISTORY: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view monitoring history" ON public.monitoring_history;
DROP POLICY IF EXISTS "Users can view monitoring history" ON public.monitoring_history;
DROP POLICY IF EXISTS "Analysts can view monitoring history" ON public.monitoring_history;
DROP POLICY IF EXISTS "Only admins and analysts can view monitoring history" ON public.monitoring_history;
DROP POLICY IF EXISTS "Only admins can insert monitoring history" ON public.monitoring_history;

-- Create secure monitoring_history policies
CREATE POLICY "Admins and analysts can view monitoring history"
ON public.monitoring_history FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can insert monitoring history"
ON public.monitoring_history FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 5. ENTITY_RELATIONSHIPS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view entity relationships" ON public.entity_relationships;
DROP POLICY IF EXISTS "Users can view entity relationships" ON public.entity_relationships;
DROP POLICY IF EXISTS "Only admins and analysts can view entity relationships" ON public.entity_relationships;
DROP POLICY IF EXISTS "Only admins and analysts can manage entity relationships" ON public.entity_relationships;

-- Create secure entity_relationships policies
CREATE POLICY "Admins and analysts can view entity relationships"
ON public.entity_relationships FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert entity relationships"
ON public.entity_relationships FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update entity relationships"
ON public.entity_relationships FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can delete entity relationships"
ON public.entity_relationships FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

-- 6. ARCHIVAL_DOCUMENTS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Users can view archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Only admins and analysts can view archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Only admins and analysts can insert archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Only admins and analysts can update archival documents" ON public.archival_documents;
DROP POLICY IF EXISTS "Only admins and analysts can delete archival documents" ON public.archival_documents;

-- Create secure archival_documents policies
CREATE POLICY "Admins and analysts can view archival documents"
ON public.archival_documents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert archival documents"
ON public.archival_documents FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update archival documents"
ON public.archival_documents FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can delete archival documents"
ON public.archival_documents FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 7. INGESTED_DOCUMENTS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view ingested documents" ON public.ingested_documents;
DROP POLICY IF EXISTS "Users can view ingested documents" ON public.ingested_documents;
DROP POLICY IF EXISTS "Only admins and analysts can view ingested documents" ON public.ingested_documents;
DROP POLICY IF EXISTS "Only admins and analysts can insert ingested documents" ON public.ingested_documents;
DROP POLICY IF EXISTS "Only admins and analysts can update ingested documents" ON public.ingested_documents;

-- Create secure ingested_documents policies
CREATE POLICY "Admins and analysts can view ingested documents"
ON public.ingested_documents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert ingested documents"
ON public.ingested_documents FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update ingested documents"
ON public.ingested_documents FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

-- 8. SIGNALS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view signals" ON public.signals;
DROP POLICY IF EXISTS "Users can view signals" ON public.signals;
DROP POLICY IF EXISTS "Only admins and analysts can view signals" ON public.signals;
DROP POLICY IF EXISTS "Only admins and analysts can insert signals" ON public.signals;
DROP POLICY IF EXISTS "Only admins and analysts can update signals" ON public.signals;
DROP POLICY IF EXISTS "Only admins and analysts can delete signals" ON public.signals;

-- Create secure signals policies
CREATE POLICY "Admins and analysts can view signals"
ON public.signals FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert signals"
ON public.signals FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update signals"
ON public.signals FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can delete signals"
ON public.signals FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 9. ENTITIES: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view entities" ON public.entities;
DROP POLICY IF EXISTS "Users can view entities" ON public.entities;
DROP POLICY IF EXISTS "Only admins and analysts can view entities" ON public.entities;
DROP POLICY IF EXISTS "Only admins and analysts can insert entities" ON public.entities;
DROP POLICY IF EXISTS "Only admins and analysts can update entities" ON public.entities;
DROP POLICY IF EXISTS "Only admins and analysts can delete entities" ON public.entities;

-- Create secure entities policies
CREATE POLICY "Admins and analysts can view entities"
ON public.entities FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert entities"
ON public.entities FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update entities"
ON public.entities FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can delete entities"
ON public.entities FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 10. INCIDENTS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view incidents" ON public.incidents;
DROP POLICY IF EXISTS "Users can view incidents" ON public.incidents;
DROP POLICY IF EXISTS "Only admins and analysts can view incidents" ON public.incidents;
DROP POLICY IF EXISTS "Only admins and analysts can insert incidents" ON public.incidents;
DROP POLICY IF EXISTS "Only admins and analysts can update incidents" ON public.incidents;
DROP POLICY IF EXISTS "Only admins and analysts can delete incidents" ON public.incidents;

-- Create secure incidents policies
CREATE POLICY "Admins and analysts can view incidents"
ON public.incidents FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert incidents"
ON public.incidents FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update incidents"
ON public.incidents FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can delete incidents"
ON public.incidents FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 11. CLIENTS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view clients" ON public.clients;
DROP POLICY IF EXISTS "Users can view clients" ON public.clients;
DROP POLICY IF EXISTS "Only admins and analysts can view clients" ON public.clients;
DROP POLICY IF EXISTS "Only admins can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Only admins can update clients" ON public.clients;
DROP POLICY IF EXISTS "Only admins can delete clients" ON public.clients;

-- Create secure clients policies
CREATE POLICY "Admins and analysts can view clients"
ON public.clients FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can insert clients"
ON public.clients FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Admins can update clients"
ON public.clients FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Admins can delete clients"
ON public.clients FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);

-- 12. INVESTIGATIONS: Drop all existing policies
DROP POLICY IF EXISTS "Authenticated users can view investigations" ON public.investigations;
DROP POLICY IF EXISTS "Users can view investigations" ON public.investigations;
DROP POLICY IF EXISTS "Only admins and analysts can view investigations" ON public.investigations;
DROP POLICY IF EXISTS "Only admins and analysts can insert investigations" ON public.investigations;
DROP POLICY IF EXISTS "Only admins and analysts can update investigations" ON public.investigations;
DROP POLICY IF EXISTS "Only admins and analysts can delete investigations" ON public.investigations;

-- Create secure investigations policies
CREATE POLICY "Admins and analysts can view investigations"
ON public.investigations FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can insert investigations"
ON public.investigations FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins and analysts can update investigations"
ON public.investigations FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'analyst')
);

CREATE POLICY "Admins can delete investigations"
ON public.investigations FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  OR public.has_role(auth.uid(), 'super_admin')
);