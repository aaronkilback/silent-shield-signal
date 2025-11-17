-- Add feedback columns to entity_photos
ALTER TABLE entity_photos 
ADD COLUMN IF NOT EXISTS feedback_rating smallint CHECK (feedback_rating IN (-1, 1)),
ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
ADD COLUMN IF NOT EXISTS feedback_by uuid REFERENCES profiles(id);

-- Add feedback columns to entity_content
ALTER TABLE entity_content
ADD COLUMN IF NOT EXISTS feedback_rating smallint CHECK (feedback_rating IN (-1, 1)),
ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
ADD COLUMN IF NOT EXISTS feedback_by uuid REFERENCES profiles(id);

-- Add feedback columns to entity_relationships
ALTER TABLE entity_relationships
ADD COLUMN IF NOT EXISTS feedback_rating smallint CHECK (feedback_rating IN (-1, 1)),
ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
ADD COLUMN IF NOT EXISTS feedback_by uuid REFERENCES profiles(id);

-- Add index for faster feedback queries
CREATE INDEX IF NOT EXISTS idx_entity_photos_feedback ON entity_photos(entity_id, feedback_rating) WHERE feedback_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_content_feedback ON entity_content(entity_id, feedback_rating) WHERE feedback_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_relationships_feedback ON entity_relationships(entity_a_id, feedback_rating) WHERE feedback_rating IS NOT NULL;