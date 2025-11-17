-- Add police file number field to investigations
ALTER TABLE public.investigations 
ADD COLUMN police_file_number TEXT;