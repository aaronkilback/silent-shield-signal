-- Add storage policies for ai-chat-attachments bucket to allow authenticated users

-- Allow authenticated users to upload to ai-chat-attachments
CREATE POLICY "Authenticated users can upload ai chat attachments"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'ai-chat-attachments' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to view ai chat attachments
CREATE POLICY "Authenticated users can view ai chat attachments"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'ai-chat-attachments' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete their own ai chat attachments
CREATE POLICY "Authenticated users can delete ai chat attachments"
ON storage.objects FOR DELETE
TO public
USING (
  bucket_id = 'ai-chat-attachments' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update ai chat attachments
CREATE POLICY "Authenticated users can update ai chat attachments"
ON storage.objects FOR UPDATE
TO public
USING (
  bucket_id = 'ai-chat-attachments' 
  AND auth.role() = 'authenticated'
);