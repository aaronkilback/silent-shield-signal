-- Add 'archived' to the signal_status enum for historical-but-useful signals
ALTER TYPE signal_status ADD VALUE IF NOT EXISTS 'archived';
