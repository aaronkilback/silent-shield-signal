-- Create table for signal merge proposals
CREATE TABLE IF NOT EXISTS public.signal_merge_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  duplicate_signal_ids UUID[] NOT NULL,
  similarity_scores NUMERIC[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  proposed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES auth.users(id),
  merge_rationale TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.signal_merge_proposals ENABLE ROW LEVEL SECURITY;

-- Analysts and admins can view merge proposals
CREATE POLICY "Analysts and admins can view merge proposals"
  ON public.signal_merge_proposals
  FOR SELECT
  USING (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role)
  );

-- Service role can manage merge proposals
CREATE POLICY "Service role can manage merge proposals"
  ON public.signal_merge_proposals
  FOR ALL
  USING (true);

-- Analysts and admins can update merge proposals (approve/reject)
CREATE POLICY "Analysts and admins can update merge proposals"
  ON public.signal_merge_proposals
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'analyst'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role)
  );

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_signal_merge_proposals_status 
  ON public.signal_merge_proposals(status);
CREATE INDEX IF NOT EXISTS idx_signal_merge_proposals_primary_signal 
  ON public.signal_merge_proposals(primary_signal_id);

-- Add updated_at trigger
CREATE TRIGGER update_signal_merge_proposals_updated_at
  BEFORE UPDATE ON public.signal_merge_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();