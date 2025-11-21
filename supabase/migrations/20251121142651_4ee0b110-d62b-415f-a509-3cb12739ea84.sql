-- Create storage bucket for travel documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'travel-documents',
  'travel-documents',
  false,
  10485760, -- 10MB limit
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for travel documents
CREATE POLICY "Analysts and admins can upload travel documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'travel-documents' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Analysts and admins can view travel documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'travel-documents' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Analysts and admins can delete travel documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'travel-documents' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );