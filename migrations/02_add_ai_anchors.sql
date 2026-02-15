-- Add AI anchors column to track Gemini's initial predictions
-- This allows comparison between AI predictions and user corrections for learning
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS ai_anchors jsonb DEFAULT '[]'::jsonb;
