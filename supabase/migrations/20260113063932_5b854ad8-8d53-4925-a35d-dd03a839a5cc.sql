-- Add avatar_image column for storing agent profile images
ALTER TABLE public.ai_agents
ADD COLUMN IF NOT EXISTS avatar_image text;

COMMENT ON COLUMN public.ai_agents.avatar_image IS 'URL to agent avatar/profile image (AI-generated or uploaded)';

-- Create storage bucket for agent avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-avatars', 'agent-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to agent avatars
CREATE POLICY "Agent avatars are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'agent-avatars');

-- Allow authenticated users to upload agent avatars
CREATE POLICY "Authenticated users can upload agent avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'agent-avatars' AND auth.role() = 'authenticated');

-- Allow authenticated users to update agent avatars
CREATE POLICY "Authenticated users can update agent avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'agent-avatars' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete agent avatars
CREATE POLICY "Authenticated users can delete agent avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'agent-avatars' AND auth.role() = 'authenticated');