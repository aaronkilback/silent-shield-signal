-- Create investigations table
CREATE TABLE public.investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_number TEXT NOT NULL UNIQUE,
  maximo_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  prepared_by UUID REFERENCES auth.users(id),
  synopsis TEXT,
  information TEXT,
  recommendations TEXT,
  file_status TEXT DEFAULT 'open',
  client_id UUID REFERENCES public.clients(id),
  created_by_name TEXT,
  CONSTRAINT investigations_file_status_check CHECK (file_status IN ('open', 'under_review', 'closed'))
);

-- Create investigation persons table
CREATE TABLE public.investigation_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  company TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT investigation_persons_status_check CHECK (status IN ('complainant', 'witness', 'suspect', 'other'))
);

-- Create investigation entries table
CREATE TABLE public.investigation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE CASCADE,
  entry_text TEXT NOT NULL,
  entry_timestamp TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create investigation attachments table
CREATE TABLE public.investigation_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID REFERENCES public.investigations(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  description TEXT,
  CONSTRAINT investigation_attachments_file_type_check CHECK (file_type IN ('image', 'video', 'audio', 'document', 'other'))
);

-- Create storage bucket for investigation files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('investigation-files', 'investigation-files', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigation_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for investigations
CREATE POLICY "Analysts and admins can view investigations"
  ON public.investigations FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage investigations"
  ON public.investigations FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for investigation persons
CREATE POLICY "Analysts and admins can view investigation persons"
  ON public.investigation_persons FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage investigation persons"
  ON public.investigation_persons FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for investigation entries
CREATE POLICY "Analysts and admins can view investigation entries"
  ON public.investigation_entries FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage investigation entries"
  ON public.investigation_entries FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for investigation attachments
CREATE POLICY "Analysts and admins can view investigation attachments"
  ON public.investigation_attachments FOR SELECT
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Analysts and admins can manage investigation attachments"
  ON public.investigation_attachments FOR ALL
  USING (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for investigation files
CREATE POLICY "Analysts and admins can upload investigation files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'investigation-files' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Analysts and admins can view investigation files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'investigation-files' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Analysts and admins can delete investigation files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'investigation-files' AND
    (has_role(auth.uid(), 'analyst'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

-- Trigger for updated_at
CREATE TRIGGER update_investigations_updated_at
  BEFORE UPDATE ON public.investigations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_investigation_entries_updated_at
  BEFORE UPDATE ON public.investigation_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();