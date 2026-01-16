-- 1) Add policy to let viewers read entity_content
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'entity_content' 
      AND policyname = 'Viewers can view entity content'
  ) THEN
    CREATE POLICY "Viewers can view entity content"
    ON public.entity_content
    FOR SELECT
    TO authenticated
    USING (
      is_super_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'analyst'::app_role)
      OR has_role(auth.uid(), 'viewer'::app_role)
    );
  END IF;
END $$;

-- 2) Add policy to let users manage their own feedback events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'feedback_events' 
      AND policyname = 'Users can manage their own feedback events'
  ) THEN
    CREATE POLICY "Users can manage their own feedback events"
    ON public.feedback_events
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;