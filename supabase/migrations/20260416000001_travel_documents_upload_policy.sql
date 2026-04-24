-- Fix: authenticated users could not upload to travel-documents bucket.
-- The bucket had a SELECT policy but no INSERT policy, so itinerary PDF uploads
-- from CreateItineraryDialog were blocked by storage RLS before parse-travel-itinerary
-- was ever invoked.

CREATE POLICY "Authenticated users can upload travel documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'travel-documents');

CREATE POLICY "Authenticated users can delete travel documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'travel-documents');
