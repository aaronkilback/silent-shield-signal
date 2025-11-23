-- Create storage bucket for AI chat attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-chat-attachments',
  'ai-chat-attachments',
  false,
  20971520, -- 20MB limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own files
CREATE POLICY "Users can upload their own AI chat attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ai-chat-attachments' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to view their own files
CREATE POLICY "Users can view their own AI chat attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'ai-chat-attachments' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow service role full access for AI processing
CREATE POLICY "Service role can manage AI chat attachments"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'ai-chat-attachments')
WITH CHECK (bucket_id = 'ai-chat-attachments');