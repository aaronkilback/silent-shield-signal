-- Create storage bucket for bug report screenshots
INSERT INTO storage.buckets (id, name, public) 
VALUES ('bug-screenshots', 'bug-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for bug screenshots
CREATE POLICY "Bug screenshots are publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'bug-screenshots');

CREATE POLICY "Authenticated users can upload bug screenshots" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'bug-screenshots' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can update their own bug screenshots" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'bug-screenshots' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can delete their own bug screenshots" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'bug-screenshots' 
  AND auth.role() = 'authenticated'
);